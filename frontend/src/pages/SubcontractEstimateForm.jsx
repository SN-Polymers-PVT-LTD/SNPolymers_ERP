import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AsyncMasterSelect, Button, Input, Select } from '../components/ui';
import { createSubcontractEstimate, getSubcontractEstimate, getSubcontractEstimateInit, reconcileSubcontractEstimateLines } from '../api/subcontractEstimatesApi';
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
  const updateKind = (index, value) => setLines(rows => rows.map((row, i) => i === index ? { ...row, entry_kind: value, adjusts_line_id: value === 'ADJUSTMENT' ? row.adjusts_line_id : null } : row));
  const historical = line => line.final_approved_revision != null;
  const targetOptions = lines.filter(historical).map(line => ({ value: line.line_id, subcontractor_id: line.subcontractor_id, subcontract_work_id: line.subcontract_work_id, label: `${line.subcontractor?.subcontractor_name || 'Subcontractor'} · ${line.subcontract_work?.material_details || 'Work'} · ${line.amount}` }));
  const updateTarget = (index, targetId) => setLines(rows => rows.map((row, i) => {
    if (i !== index) return row;
    const target = targetOptions.find(option => option.value === targetId);
    return { ...row, adjusts_line_id: targetId || null, subcontractor_id: target?.subcontractor_id || row.subcontractor_id, subcontract_work_id: target?.subcontract_work_id || row.subcontract_work_id };
  }));

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
      const payloadLines = current.estimate_status === 'Draft' ? lines : lines.filter(line => !historical(line));
      const response = await reconcileSubcontractEstimateLines(current.subcontract_estimate_id, { expected_updated_at: current.updated_at, lines: payloadLines });
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

  const showAdjustTarget = Boolean(reconciliationAuthoring && revisionAuthoring);

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="flex items-center justify-between border-b border-white/5 pb-5">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-amber-500">Projects Module</span>
          <h1 className="text-3xl font-extrabold text-slate-100">{editing ? 'Edit Subcontract Estimate' : 'New Subcontract Estimate'}</h1>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : revisionAuthoring ? 'Save Revision' : 'Save Draft'}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!editing ? (
        <div className="glass-card rounded-2xl p-5 border border-white/10 bg-slate-900/40">
          <Select
            label="Work Order"
            value={workOrderNo}
            onChange={e => setWorkOrderNo(e.target.value)}
            required
            options={[
              { value: '', label: 'Select Work Order' },
              ...workOrders.map(w => ({
                value: w.work_order_no,
                label: `${w.work_order_no}${w.site_details ? ` · ${w.site_details}` : ''}`
              }))
            ]}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 rounded-2xl border border-white/10 bg-slate-900/40 p-5 text-sm">
          <div>
            <span className="text-[10px] uppercase font-mono tracking-widest text-slate-500 block mb-1">Work Order</span>
            <div className="font-mono text-base font-bold text-white">{estimate?.work_order_no}</div>
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono tracking-widest text-slate-500 block mb-1">Server Total</span>
            <div className="font-mono text-base font-bold text-amber-300">
              ₹{Number(estimate?.estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      )}

      {/* Subcontract Line Items Table */}
      <div className="glass-card rounded-2xl p-6 border border-white/10 shadow-2xl relative overflow-hidden backdrop-blur-xl bg-slate-900/40">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 border-b border-white/5 pb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              Subcontract Line Items
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Specify subcontractors, work scopes, rates, and estimated quantities
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines(rows => [...rows, blankLine(revisionAuthoring ? 'ADDITION' : 'BASE')])}
          >
            + Add Line
          </Button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/5 bg-slate-950/20">
          <table className="w-full text-left border-collapse min-w-[1250px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03] text-[9px] uppercase tracking-widest text-slate-400 font-mono">
                <th className="py-3 px-3 w-10 text-center">#</th>
                <th className="py-3 px-3 w-60 min-w-[200px]">Subcontractor</th>
                <th className="py-3 px-3 w-72 min-w-[240px]">Subcontract Work</th>
                <th className="py-3 px-3 w-28 text-center">Type</th>
                {showAdjustTarget && <th className="py-3 px-3 w-60 min-w-[200px]">Adjusts Target</th>}
                <th className="py-3 px-3 w-28 text-right">Qty</th>
                <th className="py-3 px-3 w-32 text-right">Rate (₹)</th>
                <th className="py-3 px-3 w-36">Rate Ref</th>
                <th className="py-3 px-3 min-w-[180px]">Remarks</th>
                <th className="py-3 px-3 w-32 text-right">Amount (₹)</th>
                <th className="py-3 px-3 w-20 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs text-slate-300">
              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={showAdjustTarget ? 11 : 10}
                    className="py-12 text-center text-slate-500 text-sm font-medium"
                  >
                    No subcontract line items added yet. Click &ldquo;+ Add Line&rdquo; to add one.
                  </td>
                </tr>
              ) : (
                lines.map((line, index) => {
                  const locked = historical(line);
                  return (
                    <tr
                      key={line.line_id || `new-${index}`}
                      className={`hover:bg-white/[0.02] transition-colors duration-150 ${locked ? 'opacity-70 bg-white/[0.01]' : ''}`}
                    >
                      <td className="py-2.5 px-3 text-center font-mono text-slate-500 text-xs">
                        {index + 1}
                      </td>
                      <td className="py-2.5 px-3">
                        <AsyncMasterSelect
                          size="sm"
                          value={line.subcontractor_id || ''}
                          disabled={locked || (line.entry_kind === 'ADJUSTMENT' && Boolean(line.adjusts_line_id))}
                          onChange={value => {
                            setLines(rows => rows.map((row, i) => i === index ? {
                              ...row,
                              subcontractor_id: value,
                              subcontract_work_id: '',
                              subcontract_work: null
                            } : row));
                          }}
                          fetchOptions={getSubcontractors}
                          persistedOption={line.subcontractor}
                          getOptionValue={item => item.id}
                          getOptionLabel={item => item.subcontractor_name}
                          placeholder="Search subcontractors…"
                          required
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <AsyncMasterSelect
                          key={`work-select-${line.subcontractor_id || 'none'}-${index}`}
                          size="sm"
                          value={line.subcontract_work_id || ''}
                          disabled={locked || (line.entry_kind === 'ADJUSTMENT' && Boolean(line.adjusts_line_id)) || !line.subcontractor_id}
                          onChange={value => update(index, 'subcontract_work_id', value)}
                          fetchOptions={params => getSubcontractWorks({ ...params, subcontractor_id: line.subcontractor_id || undefined })}
                          persistedOption={line.subcontract_work}
                          getOptionValue={item => item.id}
                          getOptionLabel={item => `${item.material_details} · ${item.unit}`}
                          placeholder={line.subcontractor_id ? "Search qualified work types…" : "Select subcontractor first"}
                          emptyMessage="No work types configured for this contractor"
                          required
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        {reconciliationAuthoring && revisionAuthoring && !locked ? (
                          <Select
                            size="sm"
                            value={line.entry_kind || 'ADDITION'}
                            onChange={e => updateKind(index, e.target.value)}
                            options={[
                              { value: 'ADDITION', label: 'Addition' },
                              { value: 'ADJUSTMENT', label: 'Adjustment' }
                            ]}
                          />
                        ) : (
                          <div className="px-2.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-center font-mono text-xs font-semibold text-slate-300">
                            {line.entry_kind || 'BASE'}
                          </div>
                        )}
                      </td>
                      {showAdjustTarget && (
                        <td className="py-2.5 px-3">
                          {!locked && line.entry_kind === 'ADJUSTMENT' ? (
                            <Select
                              size="sm"
                              value={line.adjusts_line_id || ''}
                              onChange={e => updateTarget(index, e.target.value)}
                              options={[{ value: '', label: 'Select target' }, ...targetOptions]}
                              required
                            />
                          ) : (
                            <span className="text-slate-600 text-center block text-xs font-mono">—</span>
                          )}
                        </td>
                      )}
                      <td className="py-2.5 px-3">
                        <Input
                          size="sm"
                          type="number"
                          step="0.0001"
                          min={line.entry_kind === 'ADJUSTMENT' ? undefined : '0.0001'}
                          placeholder="Qty"
                          value={line.qty}
                          disabled={locked}
                          onChange={e => update(index, 'qty', e.target.value)}
                          required
                          className="text-right font-mono"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <Input
                          size="sm"
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          placeholder="Rate"
                          value={line.rate}
                          disabled={locked}
                          onChange={e => update(index, 'rate', e.target.value)}
                          required
                          className="text-right font-mono"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <Input
                          size="sm"
                          placeholder="e.g. LOCAL"
                          value={line.rate_reference || ''}
                          disabled={locked}
                          onChange={e => update(index, 'rate_reference', e.target.value)}
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <Input
                          size="sm"
                          placeholder="Remarks / scope"
                          value={line.remarks || ''}
                          disabled={locked}
                          onChange={e => update(index, 'remarks', e.target.value)}
                        />
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-200 text-right whitespace-nowrap">
                        ₹{currencyAmount(line).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {!locked ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 text-xs"
                            onClick={() => setLines(rows => rows.filter((_, i) => i !== index))}
                          >
                            Remove
                          </Button>
                        ) : (
                          <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded border border-white/5">
                            Locked
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 mt-4 border-t border-white/5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines(rows => [...rows, blankLine(revisionAuthoring ? 'ADDITION' : 'BASE')])}
          >
            + Add Line
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-mono">
              {revisionAuthoring ? 'Revision preview' : 'Draft preview'}:
            </span>
            <span className="text-xl font-extrabold text-amber-300 font-mono">
              ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </form>
  );
};

export default SubcontractEstimateForm;
