import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Input, Modal, Select, Table, TableBody, TableCell, TableHeader, TableRow, TextArea } from '../components/ui';
import { getSubcontractEstimate, reviewSubcontractEstimateRows, transitionSubcontractEstimateWorkflow } from '../api/subcontractEstimatesApi';
import { useAuth } from '../components/AuthContext';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const decisionOptions = [{ value: '', label: 'Pending' }, { value: 'Approve', label: 'Approve' }, { value: 'Not Approve', label: 'Not Approve' }];
const actionLabel = action => ({ ZO_REQUEST_REVISION: 'Request ZO revision', ZO_REJECT: 'Reject estimate', HO_REQUEST_REVISION: 'Request HO revision', HO_REJECT: 'Reject estimate', REOPEN: 'Reopen estimate' }[action] || 'Confirm workflow action');

const SubcontractEstimateView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [estimate, setEstimate] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [remarks, setRemarks] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [remarkDialog, setRemarkDialog] = useState({ action: null, value: '' });

  const load = useCallback(() => getSubcontractEstimate(id).then(response => {
    const next = response.data.estimate;
    setEstimate(next);
    const current = next.project_subcontract_estimate_lines || [];
    const reviewStage = next.estimate_status === 'Under ZO Review' ? 'ZO' : next.estimate_status === 'Under HO Review' ? 'HO' : null;
    setDecisions(Object.fromEntries(current.map(line => [line.line_id, reviewStage === 'HO' ? line.ho_office_approve || '' : line.zo_office_approve || ''])));
    setRemarks(Object.fromEntries(current.map(line => [line.line_id, reviewStage === 'HO' ? line.ho_remarks || '' : line.zo_remarks || ''])));
  }).catch(e => setError(e.response?.data?.message || 'Failed to load estimate.')), [id]);

  useEffect(() => { load(); }, [load]);

  const lines = useMemo(() => estimate?.project_subcontract_estimate_lines || [], [estimate]);
  const historicalLines = useMemo(() => lines.filter(line => line.final_approved_revision != null), [lines]);
  const currentLines = useMemo(() => lines.filter(line => line.final_approved_revision == null), [lines]);
  const workflowLog = useMemo(() => [...(estimate?.project_subcontract_estimate_workflow_log || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [estimate]);
  const stage = estimate?.estimate_status === 'Under ZO Review' ? 'ZO' : estimate?.estimate_status === 'Under HO Review' ? 'HO' : null;
  const canReview = stage && ((stage === 'ZO' && ['zo', 'admin'].includes(user?.role)) || (stage === 'HO' && ['ho', 'admin'].includes(user?.role)));
  const canEdit = ['je', 'admin'].includes(user?.role) && ['Draft', 'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'].includes(estimate?.estimate_status);
  const isReopened = estimate?.estimate_status === 'Estimate Reopened';
  const isRevisionRequested = ['ZO Revision Requested', 'HO Revision Requested'].includes(estimate?.estimate_status);
  const currentDelta = currentLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const projectedAmount = Number(estimate?.estimate_amount || 0);
  const missingDecisionRemarks = currentLines.some(line => decisions[line.line_id] === 'Not Approve' && !remarks[line.line_id]?.trim());

  const executeWorkflow = async (action, actionRemarks = null) => {
    setSaving(true); setError('');
    try {
      const response = await transitionSubcontractEstimateWorkflow(id, { action, remarks: actionRemarks, expected_updated_at: estimate.updated_at });
      setEstimate(response.data.estimate);
      setRemarkDialog({ action: null, value: '' });
      await load();
    } catch (e) {
      if (e.response?.status === 409) {
        await load();
        setError('This estimate changed in another session. The latest server version is loaded. Review it before retrying.');
      } else setError(e.response?.data?.message || 'Workflow action failed.');
    }
    finally { setSaving(false); }
  };

  const workflow = action => {
    if (['ZO_REQUEST_REVISION', 'ZO_REJECT', 'HO_REQUEST_REVISION', 'HO_REJECT', 'REOPEN'].includes(action)) {
      setRemarkDialog({ action, value: '' });
      return;
    }
    executeWorkflow(action);
  };

  const saveDecisions = async () => {
    const approvals = currentLines.filter(line => decisions[line.line_id]).map(line => ({ line_id: line.line_id, approve_status: decisions[line.line_id], remarks: remarks[line.line_id] || null }));
    setSaving(true); setError('');
    try {
      const response = await reviewSubcontractEstimateRows(id, { stage, approvals, expected_updated_at: estimate.updated_at });
      setEstimate(response.data.estimate); await load();
    } catch (e) {
      if (e.response?.status === 409) {
        await load();
        setError('These decisions were based on an older estimate version. The latest server version is loaded.');
      } else setError(e.response?.data?.message || 'Failed to save row decisions.');
    }
    finally { setSaving(false); }
  };

  if (error && !estimate) return <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>;
  if (!estimate) return <div className="text-sm text-slate-400">Loading estimate…</div>;

  const renderLineTable = (displayLines, reviewable = false) => <Table containerClassName="min-w-[1200px]"><TableHeader><TableRow hover={false}><TableCell isHeader>Subcontractor</TableCell><TableCell isHeader>Work</TableCell><TableCell isHeader>Unit</TableCell><TableCell isHeader>Qty</TableCell><TableCell isHeader>Rate</TableCell><TableCell isHeader>Amount</TableCell><TableCell isHeader>Kind</TableCell><TableCell isHeader>ZO Decision</TableCell><TableCell isHeader>HO Decision</TableCell><TableCell isHeader>Remarks</TableCell></TableRow></TableHeader><TableBody>{displayLines.map(line => {
    const historical = line.final_approved_revision != null;
    const editableReview = reviewable && canReview && !historical;
    return <TableRow key={line.line_id}><TableCell>{line.subcontractor?.subcontractor_name || 'Historical subcontractor'}{line.subcontractor?.is_active === false && <span className="ml-1 text-[10px] text-amber-400">(Inactive)</span>}</TableCell><TableCell>{line.subcontract_work?.material_details || 'Historical work'}{line.subcontract_work?.is_active === false && <span className="ml-1 text-[10px] text-amber-400">(Inactive)</span>}</TableCell><TableCell>{line.subcontract_work?.unit || '—'}</TableCell><TableCell>{line.qty}</TableCell><TableCell>{money(line.rate)}</TableCell><TableCell>{money(line.amount)}</TableCell><TableCell><span>{line.entry_kind}</span>{historical && <span className="ml-1 text-xs text-slate-500">(locked, rev {line.final_approved_revision})</span>}{line.adjusts_line_id && <div className="text-[10px] text-slate-500">adjusts approved line</div>}</TableCell><TableCell>{editableReview && stage === 'ZO' ? <Select value={decisions[line.line_id] || ''} onChange={e => setDecisions(current => ({ ...current, [line.line_id]: e.target.value }))} options={decisionOptions} /> : line.zo_office_approve || '—'}</TableCell><TableCell>{editableReview && stage === 'HO' ? <Select value={decisions[line.line_id] || ''} onChange={e => setDecisions(current => ({ ...current, [line.line_id]: e.target.value }))} options={decisionOptions} /> : line.ho_office_approve || '—'}</TableCell><TableCell>{editableReview && decisions[line.line_id] === 'Not Approve' ? <Input value={remarks[line.line_id] || ''} onChange={e => setRemarks(current => ({ ...current, [line.line_id]: e.target.value }))} placeholder="Required reason" /> : line.zo_remarks || line.ho_remarks || '—'}</TableCell></TableRow>;
  })}{!displayLines.length && <TableRow><TableCell colSpan={10}>No contributions.</TableCell></TableRow>}</TableBody></Table>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-5"><div><span className="text-[10px] uppercase tracking-widest text-amber-500">Projects Module</span><h1 className="text-3xl font-extrabold text-slate-100">Subcontract Estimate</h1><p className="mt-1 text-xs text-slate-400">Read-only history with role- and state-aware review controls.</p></div><div className="flex flex-wrap gap-2">{canEdit && <Button onClick={() => navigate(`/subcontract-estimates/${id}/edit`)}>{isReopened ? 'Edit Revision' : 'Edit Draft'}</Button>}{estimate.estimate_status === 'Draft' && ['je', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('SUBMIT')}>Submit</Button>}{isRevisionRequested && ['je', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('RESUBMIT')}>Resubmit</Button>}{isReopened && ['je', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('SUBMIT')}>Submit Revision</Button>}{estimate.estimate_status === 'Submitted' && ['zo', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('OPEN_ZO_REVIEW')}>Open ZO Review</Button>}{estimate.estimate_status === 'ZO Approved' && ['ho', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('OPEN_HO_REVIEW')}>Open HO Review</Button>}{canReview && <Button disabled={saving || !currentLines.length || missingDecisionRemarks || currentLines.some(line => !decisions[line.line_id])} onClick={saveDecisions}>Save Row Decisions</Button>}{stage === 'ZO' && canReview && <><Button variant="secondary" disabled={saving || !currentLines.length || currentLines.some(line => decisions[line.line_id] !== 'Approve')} onClick={() => workflow('ZO_APPROVE')}>Approve Header</Button><Button variant="ghost" disabled={saving} onClick={() => workflow('ZO_REQUEST_REVISION')}>Request Revision</Button><Button variant="ghost" disabled={saving} onClick={() => workflow('ZO_REJECT')}>Reject</Button></>}{stage === 'HO' && canReview && <><Button variant="secondary" disabled={saving || !currentLines.length || currentLines.some(line => decisions[line.line_id] !== 'Approve')} onClick={() => workflow('HO_APPROVE')}>Final Approve</Button><Button variant="ghost" disabled={saving} onClick={() => workflow('HO_REQUEST_REVISION')}>Request Revision</Button><Button variant="ghost" disabled={saving} onClick={() => workflow('HO_REJECT')}>Reject</Button></>}{estimate.estimate_status === 'Final Approved' && ['ho', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('REOPEN')}>Reopen</Button>}</div></div>
    {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
    <div className="grid grid-cols-2 gap-4 rounded-xl bg-white/[0.03] p-5 md:grid-cols-4"><div><span className="text-xs text-slate-500">Work Order</span><div className="font-mono text-white">{estimate.work_order_no}</div></div><div><span className="text-xs text-slate-500">Status</span><div><Badge variant={estimate.estimate_status === 'Final Approved' ? 'emerald' : isReopened ? 'amber' : 'slate'}>{estimate.estimate_status}</Badge></div></div><div><span className="text-xs text-slate-500">Revision</span><div className="text-white">{estimate.estimate_revision}</div></div><div><span className="text-xs text-slate-500">Projected Total</span><div className="font-bold text-amber-300">{money(projectedAmount)}</div></div></div>
    {isReopened && <div className="grid gap-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 md:grid-cols-3"><div><span className="text-xs text-slate-500">Previous approved amount</span><div className="font-semibold text-slate-100">{money(estimate.last_approved_amount)}</div></div><div><span className="text-xs text-slate-500">Current revision delta</span><div className="font-semibold text-amber-300">{money(currentDelta)}</div></div><div><span className="text-xs text-slate-500">Projected effective amount</span><div className="font-semibold text-emerald-300">{money(projectedAmount)}</div></div></div>}
    <section className="space-y-3"><div><h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Current Revision Changes</h2><p className="text-xs text-slate-500">Unapproved rows are the only rows available to review or revise.</p></div>{renderLineTable(currentLines, true)}</section>
    <section className="space-y-3"><div><h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Approved History</h2><p className="text-xs text-slate-500">Final-approved contributions are immutable and remain visible for audit.</p></div>{renderLineTable(historicalLines)}</section>
    <section className="space-y-3"><div><h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Workflow History</h2></div><Table containerClassName="min-w-[900px]"><TableHeader><TableRow hover={false}><TableCell isHeader>When</TableCell><TableCell isHeader>Action</TableCell><TableCell isHeader>Transition</TableCell><TableCell isHeader>Actor</TableCell><TableCell isHeader>Remarks</TableCell></TableRow></TableHeader><TableBody>{workflowLog.map(event => <TableRow key={event.id}><TableCell>{new Date(event.created_at).toLocaleString('en-IN')}</TableCell><TableCell>{event.action}</TableCell><TableCell><Badge variant="slate">{event.from_status} → {event.to_status}</Badge></TableCell><TableCell>{event.actor} ({event.actor_role})</TableCell><TableCell>{event.remarks || '—'}</TableCell></TableRow>)}{!workflowLog.length && <TableRow><TableCell colSpan={5}>No workflow events recorded.</TableCell></TableRow>}</TableBody></Table></section>
    {remarkDialog.action && <Modal title={actionLabel(remarkDialog.action)} subtitle="Mandatory remarks" onClose={() => !saving && setRemarkDialog({ action: null, value: '' })} footer={<><Button variant="ghost" disabled={saving} onClick={() => setRemarkDialog({ action: null, value: '' })}>Cancel</Button><Button disabled={saving || !remarkDialog.value.trim()} onClick={() => executeWorkflow(remarkDialog.action, remarkDialog.value.trim())}>Confirm</Button></>}><TextArea autoFocus label="Remarks" required rows={5} value={remarkDialog.value} onChange={e => setRemarkDialog(current => ({ ...current, value: e.target.value }))} placeholder="Enter the reason for this workflow action" helperText="These remarks are stored in the immutable workflow history." /></Modal>}
  </div>;
};

export default SubcontractEstimateView;
