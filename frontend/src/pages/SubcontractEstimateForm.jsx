import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AsyncMasterSelect, Button, Input, Select } from '../components/ui';
import { createSubcontractEstimate, getSubcontractEstimate, getSubcontractEstimateInit, reconcileSubcontractEstimateLines, saveSubcontractEstimateLines } from '../api/subcontractEstimatesApi';
import { getSubcontractors, getSubcontractWorks } from '../api/subcontractMastersApi';

const blankLine = (entry_kind = 'BASE') => ({ subcontractor_id: '', subcontract_work_id: '', qty: '', rate: '', rate_reference: '', remarks: '', entry_kind, adjusts_line_id: null });
const currencyAmount = (line) => Math.round(((Number(line.qty) || 0) * (Number(line.rate) || 0) + Number.EPSILON) * 100) / 100;

const SubcontractEstimateForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const [estimate, setEstimate] = useState(null);
  const [workOrders, setWorkOrders] = useState([]);
  const [lines, setLines] = useState([]);
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) getSubcontractEstimate(id).then(response => {
      const next = response.data.estimate;
      setEstimate(next);
      setLines(next.project_subcontract_estimate_lines || []);
    }).catch(e => setError(e.response?.data?.message || 'Failed to load estimate.'));
    else getSubcontractEstimateInit().then(response => setWorkOrders(response.data.availableWorkOrders || []))
      .catch(e => setError(e.response?.data?.message || 'Failed to load Work Orders.'));
  }, [editing, id]);

  const status = estimate?.estimate_status;
  const revisionAuthoring = Number(estimate?.estimate_revision || 0) > 0;
  const reconciliationAuthoring = status && status !== 'Draft';
  const total = useMemo(() => lines.reduce((sum, line) => sum + currencyAmount(line), 0), [lines]);
  const update = (index, key, value) => setLines(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const historical = line => line.final_approved_revision != null;
  const targetOptions = lines.filter(historical).map(line => ({ value: line.line_id, label: `${line.subcontractor?.subcontractor_name || 'Subcontractor'} · ${line.subcontract_work?.material_details || 'Work'} · ${line.amount}` }));

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    let current = estimate;
    try {
      if (!current) {
        const created = await createSubcontractEstimate({ work_order_no: workOrderNo });
        current = created.data.estimate;
        setEstimate(current);
        navigate(`/subcontract-estimates/${current.subcontract_estimate_id}/edit`, { replace: true });
      }
      const saveLines = current.estimate_status === 'Draft' ? saveSubcontractEstimateLines : reconcileSubcontractEstimateLines;
      const payloadLines = current.estimate_status === 'Draft' ? lines : lines.filter(line => !historical(line));
      const response = await saveLines(current.subcontract_estimate_id, { expected_updated_at: current.updated_at, lines: payloadLines });
      setEstimate(response.data.estimate);
      setLines(response.data.estimate.project_subcontract_estimate_lines || []);
    } catch (e) {
      if (e.response?.status === 409 && current?.subcontract_estimate_id) {
        try {
          const latest = await getSubcontractEstimate(current.subcontract_estimate_id);
          setEstimate(latest.data.estimate);
          setError('This estimate changed in another session. The latest server version is loaded; review your unsaved lines before retrying.');
        } catch (reloadError) {
          setError(reloadError.response?.data?.message || 'The estimate changed and could not be reloaded. Refresh before retrying.');
        }
      } else {
        setError(e.response?.data?.message || 'Failed to save estimate lines.');
      }
    } finally {
      setSaving(false);
    }
  };

  return <form onSubmit={save} className="space-y-6">
    <div className="flex items-center justify-between border-b border-white/5 pb-5">
      <div><span className="text-[10px] uppercase tracking-widest text-amber-500">Projects Module</span><h1 className="text-3xl font-extrabold text-slate-100">{editing ? 'Edit Subcontract Estimate' : 'New Subcontract Estimate'}</h1></div>
      <Button type="submit" disabled={saving}>{saving ? 'Saving…' : revisionAuthoring ? 'Save Revision' : 'Save Draft'}</Button>
    </div>
    {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
    {!editing ? <Select label="Work Order" value={workOrderNo} onChange={e => setWorkOrderNo(e.target.value)} required options={[{ value: '', label: 'Select Work Order' }, ...workOrders.map(w => ({ value: w.work_order_no, label: `${w.work_order_no}${w.site_details ? ` · ${w.site_details}` : ''}` }))]} /> : <div className="grid grid-cols-2 gap-4 rounded-xl bg-white/[0.03] p-4 text-sm"><div><span className="text-slate-500">Work Order</span><div className="font-mono text-white">{estimate?.work_order_no}</div></div><div><span className="text-slate-500">Server Total</span><div className="font-bold text-amber-300">₹{Number(estimate?.estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div></div></div>}
    <div className="space-y-3">
      {lines.map((line, index) => {
        const locked = historical(line);
        return <div key={line.line_id || `new-${index}`} className="grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 md:grid-cols-7">
          <AsyncMasterSelect value={line.subcontractor_id || ''} disabled={locked} onChange={value => update(index, 'subcontractor_id', value)} fetchOptions={getSubcontractors} persistedOption={line.subcontractor} getOptionValue={item => item.id} getOptionLabel={item => item.subcontractor_name} placeholder="Search subcontractors…" required />
          <AsyncMasterSelect value={line.subcontract_work_id || ''} disabled={locked} onChange={value => update(index, 'subcontract_work_id', value)} fetchOptions={getSubcontractWorks} persistedOption={line.subcontract_work} getOptionValue={item => item.id} getOptionLabel={item => `${item.material_details} · ${item.unit}`} placeholder="Search subcontract work…" required />
          {reconciliationAuthoring && revisionAuthoring && !locked ? <Select value={line.entry_kind || 'ADDITION'} onChange={e => update(index, 'entry_kind', e.target.value)} options={[{ value: 'ADDITION', label: 'Addition' }, { value: 'ADJUSTMENT', label: 'Adjustment' }]} /> : <Input value={line.entry_kind || 'BASE'} disabled />}
          {reconciliationAuthoring && revisionAuthoring && !locked && line.entry_kind === 'ADJUSTMENT' ? <Select value={line.adjusts_line_id || ''} onChange={e => update(index, 'adjusts_line_id', e.target.value || null)} options={[{ value: '', label: 'Select target' }, ...targetOptions]} required /> : <div />}
          <Input type="number" step="0.0001" min={line.entry_kind === 'ADJUSTMENT' ? undefined : '0.0001'} placeholder="Qty" value={line.qty} disabled={locked} onChange={e => update(index, 'qty', e.target.value)} required />
          <Input type="number" step="0.0001" min="0.0001" placeholder="Rate" value={line.rate} disabled={locked} onChange={e => update(index, 'rate', e.target.value)} required />
          <Input placeholder="Rate reference" value={line.rate_reference || ''} disabled={locked} onChange={e => update(index, 'rate_reference', e.target.value)} />
          <Input placeholder="Remarks" value={line.remarks || ''} disabled={locked} onChange={e => update(index, 'remarks', e.target.value)} />
          <div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-300">₹{currencyAmount(line).toFixed(2)}</span>{!locked && <Button type="button" size="sm" variant="ghost" onClick={() => setLines(rows => rows.filter((_, i) => i !== index))}>Remove</Button>}</div>
        </div>;
      })}
      <div className="flex items-center justify-between"><Button type="button" variant="secondary" onClick={() => setLines(rows => [...rows, blankLine(revisionAuthoring ? 'ADDITION' : 'BASE')])}>+ Add line</Button><span className="text-lg font-bold text-amber-300">{revisionAuthoring ? 'Revision preview' : 'Draft preview'}: ₹{total.toFixed(2)}</span></div>
    </div>
  </form>;
};

export default SubcontractEstimateForm;
