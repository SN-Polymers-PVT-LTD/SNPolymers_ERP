import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Input, Select, Table, TableBody, TableCell, TableHeader, TableRow } from '../components/ui';
import { getSubcontractEstimate, reviewSubcontractEstimateRows, transitionSubcontractEstimateWorkflow } from '../api/subcontractEstimatesApi';
import { useAuth } from '../components/AuthContext';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const SubcontractEstimateView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [estimate, setEstimate] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [remarks, setRemarks] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => getSubcontractEstimate(id).then(response => {
    const next = response.data.estimate;
    setEstimate(next);
    const current = next.project_subcontract_estimate_lines || [];
    const reviewStage = next.estimate_status === 'Under ZO Review' ? 'ZO' : next.estimate_status === 'Under HO Review' ? 'HO' : null;
    setDecisions(Object.fromEntries(current.map(line => [line.line_id, reviewStage === 'HO' ? line.ho_office_approve || '' : line.zo_office_approve || ''])));
    setRemarks(Object.fromEntries(current.map(line => [line.line_id, reviewStage === 'HO' ? line.ho_remarks || '' : line.zo_remarks || ''])));
  }).catch(e => setError(e.response?.data?.message || 'Failed to load estimate.'));

  useEffect(() => { load(); }, [id]);

  const lines = estimate?.project_subcontract_estimate_lines || [];
  const currentLines = useMemo(() => lines.filter(line => line.final_approved_revision == null), [lines]);
  const stage = estimate?.estimate_status === 'Under ZO Review' ? 'ZO' : estimate?.estimate_status === 'Under HO Review' ? 'HO' : null;
  const canReview = stage && ((stage === 'ZO' && ['zo', 'admin'].includes(user?.role)) || (stage === 'HO' && ['ho', 'admin'].includes(user?.role)));
  const canEdit = ['je', 'admin'].includes(user?.role) && ['Draft', 'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'].includes(estimate?.estimate_status);

  const workflow = async (action) => {
    let actionRemarks = null;
    if (['ZO_REQUEST_REVISION', 'ZO_REJECT', 'HO_REQUEST_REVISION', 'HO_REJECT', 'REOPEN'].includes(action)) {
      actionRemarks = window.prompt('Enter mandatory remarks:');
      if (!actionRemarks?.trim()) return;
    }
    setSaving(true); setError('');
    try {
      const response = await transitionSubcontractEstimateWorkflow(id, { action, remarks: actionRemarks, expected_updated_at: estimate.updated_at });
      setEstimate(response.data.estimate); await load();
    } catch (e) { setError(e.response?.data?.message || 'Workflow action failed.'); }
    finally { setSaving(false); }
  };

  const saveDecisions = async () => {
    const approvals = currentLines.filter(line => decisions[line.line_id]).map(line => ({
      line_id: line.line_id,
      approve_status: decisions[line.line_id],
      remarks: remarks[line.line_id] || null
    }));
    setSaving(true); setError('');
    try {
      const response = await reviewSubcontractEstimateRows(id, { stage, approvals, expected_updated_at: estimate.updated_at });
      setEstimate(response.data.estimate); await load();
    } catch (e) { setError(e.response?.data?.message || 'Failed to save row decisions.'); }
    finally { setSaving(false); }
  };

  if (error && !estimate) return <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>;
  if (!estimate) return <div className="text-sm text-slate-400">Loading estimate…</div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-5">
      <div><span className="text-[10px] uppercase tracking-widest text-amber-500">Projects Module</span><h1 className="text-3xl font-extrabold text-slate-100">Subcontract Estimate</h1></div>
      <div className="flex flex-wrap gap-2">
        {canEdit && <Button onClick={() => navigate(`/subcontract-estimates/${id}/edit`)}>Edit Draft</Button>}
        {estimate.estimate_status === 'Draft' && ['je', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('SUBMIT')}>Submit</Button>}
        {estimate.estimate_status === 'Estimate Reopened' && ['je', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('SUBMIT_REOPENED')}>Submit Revision</Button>}
        {estimate.estimate_status === 'Submitted' && ['zo', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('OPEN_ZO_REVIEW')}>Open ZO Review</Button>}
        {estimate.estimate_status === 'ZO Approved' && ['ho', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('OPEN_HO_REVIEW')}>Open HO Review</Button>}
        {canReview && <Button disabled={saving || !currentLines.some(line => decisions[line.line_id])} onClick={saveDecisions}>Save Row Decisions</Button>}
        {stage === 'ZO' && canReview && <><Button variant="secondary" disabled={saving || currentLines.some(line => decisions[line.line_id] !== 'Approve')} onClick={() => workflow('ZO_APPROVE')}>Approve Header</Button><Button variant="ghost" disabled={saving} onClick={() => workflow('ZO_REQUEST_REVISION')}>Request Revision</Button><Button variant="ghost" disabled={saving} onClick={() => workflow('ZO_REJECT')}>Reject</Button></>}
        {stage === 'HO' && canReview && <><Button variant="secondary" disabled={saving || currentLines.some(line => decisions[line.line_id] !== 'Approve')} onClick={() => workflow('HO_APPROVE')}>Final Approve</Button><Button variant="ghost" disabled={saving} onClick={() => workflow('HO_REQUEST_REVISION')}>Request Revision</Button><Button variant="ghost" disabled={saving} onClick={() => workflow('HO_REJECT')}>Reject</Button></>}
        {estimate.estimate_status === 'Final Approved' && ['ho', 'admin'].includes(user?.role) && <Button variant="secondary" disabled={saving} onClick={() => workflow('REOPEN')}>Reopen</Button>}
      </div>
    </div>
    {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
    <div className="grid grid-cols-2 gap-4 rounded-xl bg-white/[0.03] p-5 md:grid-cols-4"><div><span className="text-xs text-slate-500">Work Order</span><div className="font-mono text-white">{estimate.work_order_no}</div></div><div><span className="text-xs text-slate-500">Status</span><div><Badge variant="slate">{estimate.estimate_status}</Badge></div></div><div><span className="text-xs text-slate-500">Revision</span><div className="text-white">{estimate.estimate_revision}</div></div><div><span className="text-xs text-slate-500">Server Total</span><div className="font-bold text-amber-300">{money(estimate.estimate_amount)}</div></div></div>
    <Table containerClassName="min-w-[1200px]"><TableHeader><TableRow hover={false}><TableCell isHeader>Subcontractor</TableCell><TableCell isHeader>Work</TableCell><TableCell isHeader>Unit</TableCell><TableCell isHeader>Qty</TableCell><TableCell isHeader>Rate</TableCell><TableCell isHeader>Amount</TableCell><TableCell isHeader>Kind</TableCell><TableCell isHeader>ZO Decision</TableCell><TableCell isHeader>HO Decision</TableCell><TableCell isHeader>Remarks</TableCell></TableRow></TableHeader><TableBody>{lines.map(line => { const historical = line.final_approved_revision != null; return <TableRow key={line.line_id}><TableCell>{line.subcontractor?.subcontractor_name || 'Historical subcontractor'}</TableCell><TableCell>{line.subcontract_work?.material_details || 'Historical work'}</TableCell><TableCell>{line.subcontract_work?.unit || '—'}</TableCell><TableCell>{line.qty}</TableCell><TableCell>{money(line.rate)}</TableCell><TableCell>{money(line.amount)}</TableCell><TableCell>{line.entry_kind}{historical && <span className="ml-1 text-xs text-slate-500">(locked)</span>}</TableCell><TableCell>{canReview && stage === 'ZO' && !historical ? <Select value={decisions[line.line_id] || ''} onChange={e => setDecisions(current => ({ ...current, [line.line_id]: e.target.value }))} options={[{ value: '', label: 'Pending' }, { value: 'Approve', label: 'Approve' }, { value: 'Not Approve', label: 'Not Approve' }]} /> : line.zo_office_approve || '—'}</TableCell><TableCell>{canReview && stage === 'HO' && !historical ? <Select value={decisions[line.line_id] || ''} onChange={e => setDecisions(current => ({ ...current, [line.line_id]: e.target.value }))} options={[{ value: '', label: 'Pending' }, { value: 'Approve', label: 'Approve' }, { value: 'Not Approve', label: 'Not Approve' }]} /> : line.ho_office_approve || '—'}</TableCell><TableCell>{canReview && !historical && decisions[line.line_id] === 'Not Approve' ? <Input value={remarks[line.line_id] || ''} onChange={e => setRemarks(current => ({ ...current, [line.line_id]: e.target.value }))} placeholder="Required reason" /> : line.zo_remarks || line.ho_remarks || '—'}</TableCell></TableRow>; })}{!lines.length && <TableRow><TableCell colSpan={10}>No contributions.</TableCell></TableRow>}</TableBody></Table>
  </div>;
};

export default SubcontractEstimateView;
