import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Pagination } from '../ui';
import { getCompanyDeductionSetups, applyCompanyDeductionSetup, previewCompanyDeductionSetup } from '../../api/payrollProfilesApi';
import InPageSelect from '../ui/InPageSelect';
import { setupLabel } from './setupLabels';

const message = e => e?.response?.data?.message || e?.message || 'Setup assignment failed';

const schemes = [
  ['EPF', 'epf_revision_id', 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100'],
  ['ESI', 'esi_revision_id', 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100'],
  ['PT', 'pt_revision_id', 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'],
];

const setupOption = setup => ({
  value: setup.id,
  label: setupLabel(setup),
  detail: <span className="mt-1 flex flex-wrap gap-1.5">
    {schemes.filter(([, key]) => setup[key]).map(([name, , color]) =>
      <span key={name} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{name}</span>
    )}
  </span>,
});

const defaultEffectiveFrom = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};

export default function StatutoryAssignmentModal({
  isOpen,
  onClose,
  selectedEmployees = [],
  user,
  onSuccess
}) {
  const client = useQueryClient();
  const [setupPage, setSetupPage] = useState(1);
  const [setup, setSetup] = useState(null);
  const [ptSetup, setPtSetup] = useState(null);
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom());
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [results, setResults] = useState([]);

  // Fetch company deduction setups
  const setups = useQuery({
    queryKey: ['company-deduction-setups', user?.id, setupPage],
    enabled: isOpen && !!user,
    queryFn: async () => (await getCompanyDeductionSetups({ search: '', page: setupPage, limit: 20 })).data.result
  });

  const needsPt = Boolean(setup && !setup.pt_revision_id);
  const ptSetups = useQuery({
    queryKey: ['company-deduction-setups', user?.id, 'pt', setup?.establishment_name, setup?.state_id],
    enabled: isOpen && !!user && needsPt,
    queryFn: async () => {
      const params = { search: setup.establishment_name, limit: 100 };
      const first = (await getCompanyDeductionSetups({ ...params, page: 1 })).data.result;
      const remaining = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / params.limit) - 1) },
        async (_, index) => (await getCompanyDeductionSetups({ ...params, page: index + 2 })).data.result));
      return [first, ...remaining].flatMap(page => page.setups).filter(option =>
        option.pt_revision_id && option.state_id &&
        option.establishment_name.trim().toLowerCase() === setup.establishment_name.trim().toLowerCase() &&
        (!setup.state_id || option.state_id === setup.state_id));
    },
  });

  // Reset form when modal opens with new selection
  useEffect(() => {
    if (isOpen) {
      setSetup(null);
      setPtSetup(null);
      setSetupPage(1);
      setEffectiveFrom(defaultEffectiveFrom());
      setEvidence('');
      setConfirmed(false);
      setResults([]);
    }
  }, [isOpen, selectedEmployees.length]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const eligibleEmployees = selectedEmployees.filter(e => e.employee_category !== 'Local Daily-Wage Workers' && e.profile_version === 0);
  const hasIneligible = eligibleEmployees.length < selectedEmployees.length;

  const canPreview = setup && effectiveFrom && (!setup.effective_from || effectiveFrom >= setup.effective_from) &&
    (!setup.effective_to || effectiveFrom <= setup.effective_to) &&
    (!needsPt || (ptSetup && effectiveFrom >= ptSetup.effective_from && (!ptSetup.effective_to || effectiveFrom <= ptSetup.effective_to))) &&
    eligibleEmployees.length > 0 &&
    eligibleEmployees.length <= 100;

  const assignment = {
    employees: eligibleEmployees.map(e => ({ employee_id: e.id, expected_version: 0 })),
    setup_id: setup?.id,
    ...(ptSetup && { pt_setup_id: ptSetup.id }),
    effective_from: effectiveFrom,
  };
  const preview = useQuery({
    queryKey: ['company-deduction-date-preview', user?.id, assignment],
    enabled: Boolean(isOpen && canPreview),
    queryFn: async () => (await previewCompanyDeductionSetup(assignment)).data.result,
  });
  const proposals = canPreview ? preview.data?.proposals : undefined;
  const valid = Boolean(proposals?.length && !preview.isFetching && !preview.isError && proposals.every(row => !row.issue));

  const save = useMutation({
    mutationFn: () => applyCompanyDeductionSetup({
      ...assignment,
      confirmed_dates: preview.data.dates,
      evidence_reference: evidence.trim()
    }),
    onError: error => {
      setConfirmed(false);
      if (error?.response?.status === 409) preview.refetch();
    },
    onSuccess: r => {
      const rows = (r.data.result.results || []).map(row => ({
        ...row,
        employee_name: selectedEmployees.find(e => e.id === row.employee_id)?.employee_name,
        employee_code: selectedEmployees.find(e => e.id === row.employee_id)?.employee_code
      }));
      setResults(rows);
      setConfirmed(false);

      // Invalidate relevant queries
      for (const key of ['statutory-bulk-candidates', 'statutory-profile-history', 'payroll-employee-review', 'payroll-sheet-register', 'salary-register', 'statutory-profile-employees']) {
        client.invalidateQueries({ queryKey: [key] });
      }

      onSuccess?.(rows);
    }
  });

  if (!isOpen) return null;

  const setupOptions = setups.data?.setups || [];

  const succeededCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const allFailed = results.length > 0 && succeededCount === 0;
  const isPartial = results.length > 0 && succeededCount > 0 && failedCount > 0;
  const allSucceeded = results.length > 0 && failedCount === 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Assign deduction setup"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={() => { if (!save.isPending) onClose(); }}
      />

      {/* Modal Dialog Content */}
      <div className="relative w-full max-w-xl max-h-[90vh] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col z-10 overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-4 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-100">Assign Company Deduction Setup</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                  {selectedEmployees.length} {selectedEmployees.length === 1 ? 'employee' : 'employees'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Apply a published statutory deduction setup and dated effective start.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={save.isPending}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Target Employees Preview Card */}
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block">
              Selected Target ({selectedEmployees.length})
            </span>
            {selectedEmployees.length === 1 ? (
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-slate-200">{selectedEmployees[0].employee_name}</span>
                  <span className="text-slate-400 font-mono ml-2">({selectedEmployees[0].employee_code})</span>
                </div>
                <span className="text-slate-400 text-[11px]">{selectedEmployees[0].department || selectedEmployees[0].employee_category}</span>
              </div>
            ) : (
              <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1.5 p-1">
                {selectedEmployees.map(e => (
                  <span
                    key={e.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-800/80 text-slate-200 border border-slate-700/60 font-mono"
                  >
                    <span>{e.employee_code}</span>
                    <span className="text-slate-400 text-[10px] font-sans">({e.employee_name})</span>
                  </span>
                ))}
              </div>
            )}
            {hasIneligible && (
              <p className="text-[11px] text-amber-400/90 pt-1 border-t border-white/5">
                Note: Local daily workers and already configured employees are skipped to protect existing records.
              </p>
            )}
          </div>

          {/* Setup Selection */}
          <div className="space-y-3">
            <InPageSelect inline
              label="Company deduction setup"
              value={setup?.id || ''}
              disabled={save.isPending || setups.isPending}
              options={[
                { value: '', label: setups.isPending ? 'Loading company setups…' : setupOptions.length ? 'Choose company deduction setup' : 'No company setups available' },
                ...(setup && !setupOptions.some(option => option.id === setup.id) ? [setup] : [])
                  .concat(setupOptions).map(setupOption),
              ]}
              onChange={value => {
                setSetup(setupOptions.find(item => item.id === value) || null);
                setPtSetup(null);
                setConfirmed(false);
              }}
            />
            {setups.isError && (
              <div role="alert" className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-slate-300 flex items-center justify-between">
                <span>{message(setups.error)}</span>
                <Button size="sm" onClick={() => setups.refetch()}>Retry setups</Button>
              </div>
            )}
            {setups.data?.total > 20 && (
              <Pagination currentPage={setupPage} totalPages={Math.ceil(setups.data.total / 20)} onPageChange={setSetupPage} />
            )}
          </div>

          {needsPt && <div className="space-y-2">
            <InPageSelect inline
              label="Professional Tax setup"
              value={ptSetup?.id || ''}
              disabled={save.isPending || ptSetups.isPending || ptSetups.isError}
              options={[
                { value: '', label: ptSetups.isPending ? 'Loading PT setups…' : 'Choose a state PT setup' },
                ...(ptSetups.data || []).map(setupOption),
              ]}
              onChange={value => {
                setPtSetup(ptSetups.data?.find(option => option.id === value) || null);
                setConfirmed(false);
              }}
            />
            <p className="text-xs">Select the setup for the state that applies to these employees.</p>
            {ptSetups.isError && <Button size="sm" onClick={() => ptSetups.refetch()}>Retry PT setups</Button>}
            {ptSetups.isSuccess && !ptSetups.data.length && <p role="status">Publish a Professional Tax setup for this establishment first.</p>}
          </div>}

          {/* Effective From Date */}
          <div className="space-y-1.5">
            <Input
              label="Effective start date"
              type="date"
              required
              value={effectiveFrom}
              min={setup?.effective_from}
              max={setup?.effective_to || undefined}
              disabled={save.isPending}
              onChange={e => { setEffectiveFrom(e.target.value); setConfirmed(false); }}
            />
            <p className="text-[11px] text-slate-400">
              Payroll checks this date against each employee’s joining date and salary history.
            </p>
            {setup?.effective_to && (
              <p className="text-[11px] text-amber-400/90">
                Setup valid until {setup.effective_to}. Coverage after this date will require a subsequent setup.
              </p>
            )}
          </div>

          {/* Supporting Evidence Reference */}
          <Input
            label="Supporting reference (optional)"
            maxLength={2000}
            value={evidence}
            disabled={save.isPending}
            placeholder="e.g. Accounts employee deduction setup"
            onChange={e => { setEvidence(e.target.value); setConfirmed(false); }}
          />

          {canPreview && preview.isFetching && <p role="status" className="text-xs">Checking employee start dates…</p>}
          {canPreview && preview.isError && (
            <div role="alert" className="text-xs">
              {message(preview.error)} <Button size="sm" onClick={() => preview.refetch()}>Retry date check</Button>
            </div>
          )}
          {!!proposals?.length && (
            <section aria-label="Proposed employee start dates" className="rounded-xl border border-slate-300 p-3 text-xs">
              <h3 className="font-semibold">Proposed employee start dates</h3>
              <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                {proposals.map(row => {
                  const employee = eligibleEmployees.find(item => item.id === row.employee_id);
                  return <li key={row.employee_id}>
                    {employee?.employee_name || employee?.employee_code} · {row.effective_from}
                    {row.issue ? <span className="text-red-700 dark:text-red-300"> · {row.issue}</span>
                      : row.effective_from > row.requested_from && <span className="text-amber-800 dark:text-amber-300"> · Salary history starts {row.pay_from}.</span>}
                  </li>;
                })}
              </ul>
            </section>
          )}

          {/* Confirmation Checkbox */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 cursor-pointer text-xs text-slate-200 hover:bg-white/[0.04] transition select-none">
            <input
              type="checkbox"
              checked={confirmed === preview.data?.dates}
              disabled={save.isPending || !valid}
              onChange={e => setConfirmed(e.target.checked ? preview.data.dates : false)}
              className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-slate-900"
            />
            <span>I confirm this setup and the proposed start dates apply to the selected {selectedEmployees.length === 1 ? 'employee' : 'employees'}.</span>
          </label>

          {/* Error / Results Display */}
          {save.isError && (
            <div role="alert" className="p-3.5 bg-red-950/25 border border-red-900/40 rounded-xl text-xs text-red-300">
              {message(save.error)}
            </div>
          )}

          {results.length > 0 && (
            <div className={`p-4 rounded-xl border space-y-2 text-xs ${
              allFailed
                ? 'bg-red-950/25 border-red-900/40 text-red-300'
                : isPartial
                ? 'bg-amber-950/25 border-amber-900/40 text-amber-300'
                : 'bg-emerald-950/20 border-emerald-900/30 text-emerald-300'
            }`}>
              <p role={allFailed ? 'alert' : 'status'} className="font-bold flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${allFailed ? 'bg-red-500' : isPartial ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                <span>
                  {allFailed
                    ? (failedCount === 1 ? 'Assignment failed. Could not apply setup to the employee.' : `Assignment failed for all ${failedCount} employees.`)
                    : isPartial
                    ? `Partial assignment: ${succeededCount} succeeded, ${failedCount} failed.`
                    : 'Assignment completed successfully! Recalculate affected draft salaries to apply changes.'}
                </span>
              </p>
              <ul aria-label="Assignment results breakdown" className="space-y-1 pt-2 border-t border-white/10 max-h-36 overflow-y-auto">
                {results.map(r => (
                  <li key={r.employee_id} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.success ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                    <span className={!r.success ? 'text-red-200' : 'text-slate-300'}>
                      {r.employee_name || r.employee_code || 'Employee'}: {r.success ? `Setup applied from ${r.effective_from}` : `Failed (${r.status}) — ${r.message}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-white/10 bg-slate-950/60 flex items-center justify-between gap-3 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            disabled={save.isPending}
            onClick={onClose}
          >
            {allSucceeded ? 'Close' : 'Cancel'}
          </Button>

          <Button
            variant="amber"
            size="sm"
            loading={save.isPending}
            disabled={save.isPending || !valid || confirmed !== preview.data?.dates || allSucceeded}
            onClick={() => save.mutate()}
          >
            {selectedEmployees.length > 1 ? `Apply to ${selectedEmployees.length} employees` : 'Apply setup'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
