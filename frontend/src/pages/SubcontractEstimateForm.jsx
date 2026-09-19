import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Select, SearchableSelect, Modal } from '../components/ui';
import {
  createSubcontractEstimate,
  getSubcontractEstimate,
  getSubcontractEstimateInit,
  reconcileSubcontractEstimateLines,
  transitionSubcontractEstimateWorkflow
} from '../api/subcontractEstimatesApi';
import { getSubcontractors, fetchAllActiveSubcontractors } from '../api/subcontractMastersApi';
import { useTheme } from '../components/ThemeContext';

const blankLine = (entry_kind = 'BASE') => ({
  subcontractor_id: '',
  subcontractor: null,
  subcontract_work_id: '',
  subcontract_work: null,
  qty: '',
  rate: '',
  rate_reference: '',
  remarks: '',
  entry_kind,
  adjusts_line_id: null
});

const currencyAmount = (line) => Math.round(((Number(line.qty) || 0) * (Number(line.rate) || 0) + Number.EPSILON) * 100) / 100;

const SubcontractEstimateForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const { isDark } = useTheme();

  const [estimate, setEstimate] = useState(null);
  const [workOrders, setWorkOrders] = useState([]);
  const [lines, setLines] = useState([]);
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);

  // Per-line search query state for in-memory combobox filtering
  const [searchQueries, setSearchQueries] = useState({});

  // TanStack Query: auto-paginates all pages of active subcontractors and caches in memory
  const {
    data: subcontractors = [],
    isLoading: loadingSubcontractors,
    error: subcontractorsError,
    refetch: refetchSubcontractors
  } = useQuery({
    queryKey: ['subcontractors-active-catalog'],
    queryFn: () => fetchAllActiveSubcontractors(getSubcontractors),
    staleTime: 5 * 60 * 1000
  });

  useEffect(() => {
    if (editing) {
      getSubcontractEstimate(id).then(response => {
        const next = response.data.estimate;
        setEstimate(next);
        setLines(next.project_subcontract_estimate_lines || []);
      }).catch(e => setError(e.response?.data?.message || 'Failed to load estimate.'));
    } else {
      getSubcontractEstimateInit().then(response => {
        setWorkOrders(response.data.availableWorkOrders || []);
      }).catch(e => setError(e.response?.data?.message || 'Failed to load Work Orders.'));
    }
  }, [editing, id]);

  const status = estimate?.estimate_status;
  const isReopened = status === 'Estimate Reopened';
  const isRevisionRequested = ['ZO Revision Requested', 'HO Revision Requested'].includes(status);
  const revisionAuthoring = Number(estimate?.estimate_revision || 0) > 0;
  const reconciliationAuthoring = status && status !== 'Draft';
  const total = useMemo(() => lines.reduce((sum, line) => sum + currencyAmount(line), 0), [lines]);
  const historical = line => line.final_approved_revision != null;

  const targetOptions = lines.filter(historical).map(line => ({
    value: line.line_id,
    subcontractor_id: line.subcontractor_id,
    subcontract_work_id: line.subcontract_work_id,
    label: `${line.subcontractor?.subcontractor_name || 'Subcontractor'} · ${line.subcontract_work?.material_details || 'Work'} · ₹${currencyAmount(line)}`
  }));

  // Track lines modified in the current editing session (Correction #1)
  const [sessionEditedLines, setSessionEditedLines] = useState({});

  const markLineEdited = (index) => {
    setSessionEditedLines(prev => ({ ...prev, [index]: true }));
  };

  // Filter state for lines in revision mode ('all' | 'needs_correction' | 'protected')
  const [formFilter, setFormFilter] = useState('all');

  const update = (index, key, value) => {
    markLineEdited(index);
    setLines(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  };

  const updateKind = (index, value) => {
    markLineEdited(index);
    setLines(rows => rows.map((row, i) => i === index ? {
      ...row,
      entry_kind: value,
      adjusts_line_id: value === 'ADJUSTMENT' ? row.adjusts_line_id : null
    } : row));
  };

  const updateTarget = (index, targetId) => {
    markLineEdited(index);
    setLines(rows => rows.map((row, i) => {
      if (i !== index) return row;
      const target = targetOptions.find(option => option.value === targetId);
      const targetSub = subcontractors.find(s => s.id === target?.subcontractor_id) || target?.subcontractor;
      const targetWork = (targetSub?.capabilities || [])
        .map(c => c.subcontract_work)
        .find(w => w?.id === target?.subcontract_work_id) || target?.subcontract_work;
      return {
        ...row,
        adjusts_line_id: targetId || null,
        subcontractor_id: target?.subcontractor_id || row.subcontractor_id,
        subcontractor: targetSub || row.subcontractor,
        subcontract_work_id: target?.subcontract_work_id || row.subcontract_work_id,
        subcontract_work: targetWork || row.subcontract_work
      };
    }));
  };

  const handleSaveError = (e, current) => {
    if (e.response?.status === 409 && current?.subcontract_estimate_id) {
      getSubcontractEstimate(current.subcontract_estimate_id).then(latest => {
        setEstimate(latest.data.estimate);
        setError('This estimate changed in another session. The latest server version is loaded; review your unsaved lines before retrying.');
      }).catch(reloadError => {
        setError(reloadError.response?.data?.message || 'The estimate changed and could not be reloaded. Refresh before retrying.');
      });
    } else {
      setError(e.response?.data?.message || e.message || 'Failed to save estimate lines.');
    }
  };

  const performSave = async () => {
    let current = estimate;
    if (!current?.subcontract_estimate_id) {
      if (!workOrderNo) throw new Error('Please select a Work Order.');
      const created = await createSubcontractEstimate({ work_order_no: workOrderNo });
      current = created.data.estimate;
      setEstimate(current);
      navigate(`/subcontract-estimates/${current.subcontract_estimate_id}/edit`, { replace: true });
    }
    const payloadLines = current.estimate_status === 'Draft' ? lines : lines.filter(line => !historical(line));
    const response = await reconcileSubcontractEstimateLines(current.subcontract_estimate_id, {
      expected_updated_at: current.updated_at,
      lines: payloadLines
    });
    const updated = response.data.estimate;
    setEstimate(updated);
    setLines(updated.project_subcontract_estimate_lines || []);
    setSessionEditedLines({});
    return updated;
  };

  const handleSaveDraft = async (e) => {
    if (e) e.preventDefault();
    if (saving || submitting) return;
    setError('');
    setSaving(true);
    try {
      await performSave();
    } catch (err) {
      handleSaveError(err, estimate);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitClick = (e) => {
    if (e) e.preventDefault();
    if (saving || submitting) return;
    setError('');

    if (subcontractorsError) {
      setError('Cannot submit estimate: full subcontractor catalog failed to load. Please retry loading first.');
      return;
    }

    if (!editing && !workOrderNo) {
      setError('Please select a Work Order before submitting.');
      return;
    }
    if (lines.length === 0) {
      setError('Please add at least one subcontract line item before submitting.');
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (historical(line)) continue;

      if (!line.subcontractor_id) {
        setError(`Line #${i + 1}: Please select a subcontractor.`);
        return;
      }

      // Ensure subcontractor is active
      const sub = subcontractors.find(s => s.id === line.subcontractor_id);
      if (sub && sub.is_active === false) {
        setError(`Line #${i + 1}: Subcontractor "${sub.subcontractor_name}" is inactive. Please select an active contractor.`);
        return;
      }

      if (!line.subcontract_work_id) {
        setError(`Line #${i + 1}: Please select a subcontract work.`);
        return;
      }

      // Verify selected work is among the contractor's active capabilities
      const qualified = (sub?.capabilities || []).map(c => c.subcontract_work).filter(w => w && w.is_active !== false);
      if (!qualified.some(w => w.id === line.subcontract_work_id)) {
        setError(`Line #${i + 1}: The selected work scope is not qualified or active for this subcontractor.`);
        return;
      }

      const qty = Number(line.qty);
      if (line.entry_kind === 'ADJUSTMENT') {
        if (!qty) {
          setError(`Line #${i + 1}: Quantity must be non-zero for an adjustment.`);
          return;
        }
      } else if (!qty || qty <= 0) {
        setError(`Line #${i + 1}: Quantity must be greater than 0.`);
        return;
      }

      const rate = Number(line.rate);
      if (!rate || rate <= 0) {
        setError(`Line #${i + 1}: Rate must be greater than 0.`);
        return;
      }
    }

    setShowConfirmSubmit(true);
  };

  const executeSubmit = async () => {
    if (saving || submitting) return;
    setShowConfirmSubmit(false);
    setError('');
    setSubmitting(true);
    let savedEstimate = null;

    try {
      savedEstimate = await performSave();
    } catch (saveErr) {
      setSubmitting(false);
      handleSaveError(saveErr, estimate);
      return;
    }

    try {
      const action = isReopened ? 'SUBMIT_REOPENED' : isRevisionRequested ? 'RESUBMIT' : 'SUBMIT';
      await transitionSubcontractEstimateWorkflow(savedEstimate.subcontract_estimate_id, {
        action,
        expected_updated_at: savedEstimate.updated_at
      });
      navigate(`/subcontract-estimates/${savedEstimate.subcontract_estimate_id}`);
    } catch (workflowErr) {
      // Estimate was successfully saved and preserved in state; allow one-click retry
      setError(
        workflowErr.response?.data?.message ||
        workflowErr.message ||
        'Estimate lines saved successfully, but workflow submission failed. Click "Submit Estimate" to retry.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const showAdjustTarget = Boolean(reconciliationAuthoring && revisionAuthoring);

  // Active subcontractor options for local search in-memory
  const activeSubcontractorOptions = useMemo(() => {
    return subcontractors
      .filter(s => s.is_active !== false)
      .map(s => ({
        value: s.id,
        label: s.subcontractor_name,
        item: s
      }));
  }, [subcontractors]);

  return (
    <form onSubmit={handleSaveDraft} className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-amber-500 font-mono">Projects Module</span>
          <h1 className="text-3xl font-extrabold text-slate-100">{editing ? 'Edit Subcontract Estimate' : 'New Subcontract Estimate'}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={saving || submitting}
            onClick={handleSaveDraft}
          >
            {saving ? 'Saving…' : revisionAuthoring ? 'Save Revision' : 'Save Draft'}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || submitting || lines.length === 0 || loadingSubcontractors || Boolean(subcontractorsError)}
            onClick={handleSubmitClick}
            className="bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-600 hover:to-amber-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(245,158,11,0.2)]"
          >
            {submitting ? 'Submitting…' : isReopened ? 'Submit Revision' : isRevisionRequested ? 'Resubmit Estimate' : 'Submit Estimate'}
          </Button>
        </div>
      </div>

      {subcontractorsError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 flex items-center justify-between gap-4">
          <div>
            <span className="font-bold block text-rose-200">Failed to load complete subcontractor catalog</span>
            <span>{subcontractorsError.message || 'An error occurred while loading active subcontractors.'}</span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => refetchSubcontractors()}
            className="shrink-0"
          >
            Retry Loading
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!editing ? (
        <div className={`rounded-2xl p-5 border ${isDark ? 'bg-slate-900/40 border-white/10' : 'bg-white/90 border-slate-200 shadow-sm'}`}>
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
        <div className={`grid grid-cols-2 gap-4 rounded-2xl border p-5 text-sm ${isDark ? 'bg-slate-900/40 border-white/10' : 'bg-white/90 border-slate-200 shadow-sm'}`}>
          <div>
            <span className="text-[10px] uppercase font-mono tracking-widest text-slate-500 block mb-1">Work Order</span>
            <div className={`font-mono text-base font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{estimate?.work_order_no}</div>
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono tracking-widest text-slate-500 block mb-1">Server Total</span>
            <div className="font-mono text-base font-bold text-amber-500 dark:text-amber-300">
              ₹{Number(estimate?.estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      )}

      {isRevisionRequested && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
            ⚠️ {status === 'HO Revision Requested' ? 'HO Revision Requested' : 'ZO Revision Requested'}
          </div>
          <div className="text-sm text-slate-200">
            <span className="font-semibold text-amber-300">
              {status === 'HO Revision Requested' ? 'HO Revision Remarks: ' : 'ZO Revision Remarks: '}
            </span>
            <span>
              {status === 'HO Revision Requested'
                ? estimate?.ho_remarks || 'Please revise the estimate lines as requested by HO.'
                : estimate?.zo_remarks || 'Please revise the estimate lines as requested by ZO.'}
            </span>
          </div>
        </div>
      )}

      {/* Subcontract Line Items Table */}
      <div className={`rounded-2xl p-6 border shadow-2xl relative overflow-hidden backdrop-blur-xl ${isDark ? 'bg-slate-900/40 border-white/10' : 'bg-white/90 border-slate-200/80 shadow-slate-200/50'}`}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 border-b border-white/5 pb-4">
          <div>
            <h3 className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
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
            disabled={loadingSubcontractors || Boolean(subcontractorsError)}
            onClick={() => setLines(rows => [...rows, blankLine(revisionAuthoring ? 'ADDITION' : 'BASE')])}
          >
            + Add Line
          </Button>
        </div>

        {/* Quick Review Filter in Revision Mode */}
        {isRevisionRequested && (
          <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-2">Filter View:</span>
            <button
              type="button"
              onClick={() => setFormFilter('all')}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${
                formFilter === 'all'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'
              }`}
            >
              All Lines ({lines.length})
            </button>
            <button
              type="button"
              onClick={() => setFormFilter('needs_correction')}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${
                formFilter === 'needs_correction'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'
              }`}
            >
              Requires Correction ({
                lines.filter(l => (status === 'HO Revision Requested' ? l.ho_office_approve === 'Not Approve' : l.zo_office_approve === 'Not Approve')).length
              })
            </button>
            <button
              type="button"
              onClick={() => setFormFilter('protected')}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${
                formFilter === 'protected'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'
              }`}
            >
              Protected ({
                lines.filter(l => historical(l) || (l.ho_office_approve === 'Approve' || ((status === 'ZO Revision Requested' || status === 'Estimate Reopened') && l.zo_office_approve === 'Approve'))).length
              })
            </button>
          </div>
        )}

        <div className={`overflow-x-auto rounded-xl border ${isDark ? 'border-white/5 bg-slate-950/20' : 'border-slate-200/70 bg-slate-50/50'}`}>
          <table className="w-full text-left border-collapse min-w-[1250px]">
            <thead>
              <tr className={`border-b text-[9px] uppercase tracking-widest font-mono ${isDark ? 'border-white/10 bg-white/[0.03] text-slate-400' : 'border-slate-200 bg-slate-100/80 text-slate-600'}`}>
                <th className="py-3 px-3 w-10 text-center">#</th>
                <th className="py-3 px-3 w-64 min-w-[220px]">Subcontractor</th>
                <th className="py-3 px-3 w-72 min-w-[250px]">Subcontract Work</th>
                <th className="py-3 px-3 w-28 text-center">Type</th>
                {showAdjustTarget && <th className="py-3 px-3 w-60 min-w-[200px]">Adjusts Target</th>}
                <th className="py-3 px-3 w-28 text-right">Qty</th>
                <th className="py-3 px-3 w-32 text-right">Rate (₹)</th>
                <th className="py-3 px-3 w-36">Rate Ref</th>
                <th className="py-3 px-3 min-w-[180px]">Remarks</th>
                {isRevisionRequested && <th className="py-3 px-3 w-52">Review Status</th>}
                <th className="py-3 px-3 w-32 text-right">Amount (₹)</th>
                <th className="py-3 px-3 w-20 text-center">Action</th>
              </tr>
            </thead>
            <tbody className={`divide-y text-xs ${isDark ? 'divide-white/5 text-slate-300' : 'divide-slate-200 text-slate-800'}`}>
              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={(showAdjustTarget ? 11 : 10) + (isRevisionRequested ? 1 : 0)}
                    className="py-12 text-center text-slate-500 text-sm font-medium"
                  >
                    No subcontract line items added yet. Click &ldquo;+ Add Line&rdquo; to add one.
                  </td>
                </tr>
              ) : (
                lines
                  .map((line, index) => ({ line, index }))
                  .filter(({ line }) => {
                    const locked = historical(line) || (
                      line.ho_office_approve === 'Approve' ||
                      ((status === 'ZO Revision Requested' || status === 'Estimate Reopened') &&
                        line.zo_office_approve === 'Approve')
                    );
                    if (!isRevisionRequested || formFilter === 'all') return true;
                    if (formFilter === 'protected') return locked;
                    if (formFilter === 'needs_correction') {
                      return !locked && (status === 'HO Revision Requested'
                        ? line.ho_office_approve === 'Not Approve'
                        : line.zo_office_approve === 'Not Approve');
                    }
                    return true;
                  })
                  .map(({ line, index }) => {
                  // Final-approved history is immutable. A ZO-approved row
                  // is protected in a ZO revision; an HO-approved row is
                  // protected in an HO revision. JE can still correct an
                  // HO-rejected row that had passed ZO.
                  const locked = historical(line) || (
                    line.ho_office_approve === 'Approve' ||
                    ((status === 'ZO Revision Requested' || status === 'Estimate Reopened') &&
                      line.zo_office_approve === 'Approve')
                  );

                  // 1. Resolve selected contractor from the cached catalog by subcontractor_id
                  const resolvedSub = subcontractors.find(s => s.id === line.subcontractor_id);
                  const displaySub = resolvedSub || (locked ? line.subcontractor : null);

                  // 2. Build local search options for active contractors
                  const subOptions = [...activeSubcontractorOptions];
                  if (!locked && line.subcontractor && !subOptions.some(o => o.value === line.subcontractor.id)) {
                    subOptions.unshift({
                      value: line.subcontractor.id,
                      label: `${line.subcontractor.subcontractor_name} (Inactive)`,
                      item: line.subcontractor
                    });
                  }

                  // 3. Resolve qualified works from the resolved subcontractor's capabilities
                  const qualifiedWorks = (resolvedSub?.capabilities || [])
                    .map(cap => cap.subcontract_work)
                    .filter(w => w && w.is_active !== false);

                  // If locked or historical line has an existing work scope, preserve it for display
                  if (locked && line.subcontract_work && !qualifiedWorks.some(w => w.id === line.subcontract_work.id)) {
                    qualifiedWorks.unshift(line.subcontract_work);
                  }

                  let workOptions = [];
                  if (!line.subcontractor_id) {
                    workOptions = [{ value: '', label: 'Select subcontractor first' }];
                  } else if (qualifiedWorks.length === 0) {
                    workOptions = [{ value: '', label: 'No work types configured for contractor' }];
                  } else {
                    workOptions = [
                      { value: '', label: 'Select Subcontract Work' },
                      ...qualifiedWorks.map(w => ({
                        value: w.id,
                        label: `${w.material_details} · ${w.unit}`
                      }))
                    ];
                  }

                  // Visible text calculation for searchable input
                  const currentQuery = searchQueries[index];
                  const visibleSubText = currentQuery !== undefined
                    ? currentQuery
                    : (displaySub?.subcontractor_name || '');

                  return (
                    <tr
                      key={line.line_id || `new-${index}`}
                      className={`transition-colors duration-150 ${isDark ? 'hover:bg-white/[0.02]' : 'hover:bg-slate-100/60'} ${locked ? (isDark ? 'opacity-70 bg-white/[0.01]' : 'opacity-70 bg-slate-100/40') : ''}`}
                    >
                      <td className="py-2.5 px-3 text-center font-mono text-slate-500 text-xs">
                        {index + 1}
                      </td>
                      <td className="py-2.5 px-3">
                        {locked ? (
                          <div className="font-semibold text-xs py-2 px-3 bg-white/[0.03] rounded-xl border border-white/5">
                            {displaySub?.subcontractor_name || 'Subcontractor'}
                          </div>
                        ) : (
                          <SearchableSelect
                            size="sm"
                            placeholder={loadingSubcontractors ? 'Loading catalog…' : 'Search active subcontractor…'}
                            disabled={locked || (line.entry_kind === 'ADJUSTMENT' && Boolean(line.adjusts_line_id)) || loadingSubcontractors || Boolean(subcontractorsError)}
                            options={subOptions}
                            value={visibleSubText}
                            onChange={(typed) => {
                              setSearchQueries(prev => ({ ...prev, [index]: typed }));
                              // If typed text diverges from the current committed contractor name, clear the selection and cascaded work
                              if (resolvedSub && typed.trim().toLowerCase() !== resolvedSub.subcontractor_name.toLowerCase()) {
                                markLineEdited(index);
                                setLines(rows => rows.map((row, i) => i === index ? {
                                  ...row,
                                  subcontractor_id: '',
                                  subcontractor: null,
                                  subcontract_work_id: '',
                                  subcontract_work: null
                                } : row));
                              }
                            }}
                            onBlur={() => {
                              // On blur without pick, reset query text to match committed state
                              setSearchQueries(prev => {
                                const copy = { ...prev };
                                delete copy[index];
                                return copy;
                              });
                            }}
                            onSelect={(opt) => {
                              markLineEdited(index);
                              setSearchQueries(prev => {
                                const copy = { ...prev };
                                delete copy[index];
                                return copy;
                              });
                              // Clear work type when changing subcontractor
                              setLines(rows => rows.map((row, i) => i === index ? {
                                ...row,
                                subcontractor_id: opt.value,
                                subcontractor: opt.item || null,
                                subcontract_work_id: '',
                                subcontract_work: null
                              } : row));
                            }}
                            required
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {locked ? (
                          <div className="font-medium text-xs py-2 px-3 bg-white/[0.03] rounded-xl border border-white/5">
                            {line.subcontract_work ? `${line.subcontract_work.material_details} · ${line.subcontract_work.unit}` : 'Historical work'}
                          </div>
                        ) : (
                          <Select
                            size="sm"
                            value={line.subcontract_work_id || ''}
                            disabled={locked || (line.entry_kind === 'ADJUSTMENT' && Boolean(line.adjusts_line_id)) || !line.subcontractor_id || qualifiedWorks.length === 0}
                            onChange={e => {
                              markLineEdited(index);
                              const selectedWorkId = e.target.value;
                              const selectedWork = qualifiedWorks.find(w => w.id === selectedWorkId);
                              setLines(rows => rows.map((row, i) => i === index ? {
                                ...row,
                                subcontract_work_id: selectedWorkId,
                                subcontract_work: selectedWork || null
                              } : row));
                            }}
                            options={workOptions}
                            required
                          />
                        )}
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
                          <div className={`px-2.5 py-2 rounded-xl border text-center font-mono text-xs font-semibold ${isDark ? 'bg-white/[0.04] border-white/10 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
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
                            <span className="text-slate-500 text-center block text-xs font-mono">—</span>
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
                      {isRevisionRequested && (
                        <td className="py-2.5 px-3">
                          {locked ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Protected
                            </span>
                          ) : (status === 'HO Revision Requested' ? line.ho_office_approve === 'Not Approve' : line.zo_office_approve === 'Not Approve') ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                  Requires Correction
                                </span>
                                {sessionEditedLines[index] && (
                                  <span className="text-[9px] font-bold uppercase text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded">
                                    (Corrected)
                                  </span>
                                )}
                              </div>
                              {status === 'HO Revision Requested' && line.ho_remarks && (
                                <p className="text-[10px] text-rose-300 italic font-sans max-w-[190px] break-words">
                                  HO: {line.ho_remarks}
                                </p>
                              )}
                              {status !== 'HO Revision Requested' && line.zo_remarks && (
                                <p className="text-[10px] text-rose-300 italic font-sans max-w-[190px] break-words">
                                  ZO: {line.zo_remarks}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500 font-mono text-xs">—</span>
                          )}
                        </td>
                      )}
                      <td className={`py-2.5 px-3 font-mono font-bold text-right whitespace-nowrap ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>
                        ₹{currencyAmount(line).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {!locked ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 px-2 py-1 text-xs"
                            onClick={() => setLines(rows => rows.filter((_, i) => i !== index))}
                          >
                            Remove
                          </Button>
                        ) : (
                          <span className={`text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded border ${isDark ? 'text-slate-500 bg-white/[0.04] border-white/5' : 'text-slate-600 bg-slate-100 border-slate-200'}`}>
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

        {/* Footer actions & preview */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 mt-4 border-t border-white/5">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loadingSubcontractors || Boolean(subcontractorsError)}
              onClick={() => setLines(rows => [...rows, blankLine(revisionAuthoring ? 'ADDITION' : 'BASE')])}
            >
              + Add Line
            </Button>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-mono">
                {revisionAuthoring ? 'Revision preview' : 'Draft preview'}:
              </span>
              <span className="text-xl font-extrabold text-amber-500 dark:text-amber-300 font-mono">
                ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving || submitting}
                onClick={handleSaveDraft}
              >
                {saving ? 'Saving…' : revisionAuthoring ? 'Save Revision' : 'Save Draft'}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={saving || submitting || lines.length === 0 || loadingSubcontractors || Boolean(subcontractorsError)}
                onClick={handleSubmitClick}
                className="bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-600 hover:to-amber-500 text-slate-950 font-bold"
              >
                {submitting ? 'Submitting…' : isReopened ? 'Submit Revision' : isRevisionRequested ? 'Resubmit Estimate' : 'Submit Estimate'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Estimate Submission */}
      <Modal
        isOpen={showConfirmSubmit}
        onClose={() => !submitting && setShowConfirmSubmit(false)}
        title={isReopened ? 'Submit Subcontract Revision?' : isRevisionRequested ? 'Resubmit Subcontract Estimate?' : 'Submit Subcontract Estimate?'}
        subtitle="Work Order Actions"
        size="sm"
        footer={
          <div className="flex gap-3 w-full">
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => setShowConfirmSubmit(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={submitting}
              onClick={executeSubmit}
              className="flex-1 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-600 hover:to-amber-500 text-slate-950 font-bold shadow-[0_0_20px_rgba(245,158,11,0.25)]"
            >
              {submitting ? 'Submitting…' : 'Confirm & Submit'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 dark:text-amber-400 mb-4 animate-pulse">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
            {isReopened
              ? 'Submit this revised subcontract estimate for ZO review? Unapproved lines will be submitted for verification.'
              : isRevisionRequested
              ? 'Resubmit this subcontract estimate with revisions for ZO review?'
              : 'Submit this subcontract estimate for ZO review? You will be able to track the review decisions and workflow progress on the estimate view screen.'}
          </p>
        </div>
      </Modal>
    </form>
  );
};

export default SubcontractEstimateForm;
