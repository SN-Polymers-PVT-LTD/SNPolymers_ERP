import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Pagination, Modal } from '../ui';
import {
  getEmployeeStatutoryProfiles,
  recordEmployeeStatutoryProfiles,
  getCompanyDeductionSetups
} from '../../api/payrollProfilesApi';
import { setupLabel } from './setupLabels';

const schemes = ['EPF', 'ESI', 'PT'];
const message = e => e?.response?.data?.message || e?.message;
const blank = () => ({
  effective_from: '',
  effective_to: null,
  verification_status: 'UNVERIFIED',
  advisor_name: null,
  verification_reference: null,
  verified_on: null,
  schemes: Object.fromEntries(schemes.map(s => [s, { statutory_scope_id: null, applicability: 'NOT_APPLICABLE', enrolled: null, basis_reference: 'Accounts employee deduction setup' }]))
});
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function EmployeeSetupDrawer({
  employeeId,
  onClose,
  user,
  employeeSummary = null,
}) {
  const client = useQueryClient();
  const allowed = user?.role === 'accounts';

  const [setupSearch, setSetupSearch] = useState('');
  const [setupPage, setSetupPage] = useState(1);
  const [chosen, setChosen] = useState({});
  const [editor, setEditor] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const history = useQuery({
    queryKey: ['statutory-profile-history', user?.id, employeeId],
    enabled: allowed && !!employeeId,
    queryFn: async () => (await getEmployeeStatutoryProfiles(employeeId)).data.result
  });

  const setups = useQuery({
    queryKey: ['company-deduction-setups', user?.id, setupSearch, setupPage],
    enabled: allowed,
    queryFn: async () => (await getCompanyDeductionSetups({ search: setupSearch, page: setupPage, limit: 20 })).data.result
  });

  const save = useMutation({
    mutationFn: () => recordEmployeeStatutoryProfiles(employeeId, {
      expected_version: editor.version,
      evidence_reference: reason.trim() || 'Accounts employee deduction setup',
      intervals: editor.intervals.map(({ changed, setupId: _setupId, ...v }) => {
        if (!changed && v.verification_status !== 'UNVERIFIED') return v;
        const evidence = reason.trim() || 'Accounts employee deduction setup';
        return {
          ...v,
          verification_status: 'ACCOUNTS_CONFIRMED',
          advisor_name: user.display_name || user.name || 'Accounts',
          verification_reference: evidence,
          verified_on: today(),
          schemes: Object.fromEntries(schemes.map(s => [
            s,
            {
              ...v.schemes[s],
              applicability: s === 'PT' || (history.data?.enrolment_managed_by_pay_structure && v.schemes[s].statutory_scope_id) ? 'APPLICABLE' : 'NOT_APPLICABLE',
              enrolled: s === 'PT' || history.data?.enrolment_managed_by_pay_structure ? null : false,
              basis_reference: evidence
            }
          ]))
        };
      })
    }),
    onSuccess: () => {
      setEditor(null);
      setConfirmed(false);
      for (const key of ['statutory-bulk-candidates', 'statutory-profile-history', 'payroll-employee-review', 'payroll-sheet-register', 'salary-register', 'statutory-profile-employees']) {
        client.invalidateQueries({ queryKey: [key] });
      }
    }
  });

  const edit = (index, patch) => {
    setEditor(old => ({
      ...old,
      intervals: old.intervals.map((v, i) => i === index ? { ...v, ...patch, changed: true } : v)
    }));
    setConfirmed(false);
    save.reset();
  };

  const local = history.data?.employee_category === 'Local Daily-Wage Workers' || employeeSummary?.employee_category === 'Local Daily-Wage Workers';
  const available = [...(setups.data?.setups || [])];
  for (const c of Object.values(chosen)) {
    if (!available.some(s => s.id === c.id)) available.push(c);
  }

  const valid = editor?.intervals.every(v => v.effective_from && (!v.effective_to || v.effective_to >= v.effective_from) && (!v.changed || v.schemes.PT.statutory_scope_id));

  if (!employeeId) return null;

  const employeeName = employeeSummary?.employee_name || history.data?.employee_name || 'Employee payroll setup';
  const employeeCode = employeeSummary?.employee_code || history.data?.employee_code;
  const department = employeeSummary?.department || history.data?.department;
  const category = employeeSummary?.employee_category || history.data?.employee_category;

  return (
    <Modal
      title={employeeName}
      subtitle={[employeeCode, department, category].filter(Boolean).join(' · ')}
      size="xl"
      role="dialog"
      aria-modal="true"
      aria-label="Employee statutory setup details"
      closeLabel="Close employee setup"
      closeDisabled={save.isPending}
      onClose={() => { if (!save.isPending) onClose(); }}
    >
        {/* Drawer Scrollable Body */}
        <div className="space-y-6">
          {history.isPending ? (
            <div role="status" className="p-8 text-center text-xs text-slate-400 space-y-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse inline-block"></span>
              <p>Loading employee setup…</p>
            </div>
          ) : history.isError ? (
            <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center justify-between">
              <span>{message(history.error)}</span>
              <Button size="sm" onClick={() => history.refetch()}>Retry</Button>
            </div>
          ) : (
            <>
              {/* Status Overview Card */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Current Status</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono ${
                    local
                      ? 'bg-slate-800 text-slate-300 border border-slate-700'
                      : history.data.version
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {local ? 'Local Worker (Exempt)' : history.data.version ? `Active Setup v${history.data.version}` : 'Needs Initial Setup'}
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  {local
                    ? 'No deduction setup required for Local Daily-Wage Workers.'
                    : history.data.version
                    ? 'Setup recorded. Review the dated history before making changes.'
                    : 'No statutory deduction profile has been configured for this employee.'}
                </p>

                {/* Pay Structure Enrolment Overview */}
                {history.data?.enrolment_managed_by_pay_structure && (
                  <div className="pt-2 border-t border-white/5 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded-lg bg-black/20 border border-white/5">
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">EPF Enrolment</span>
                      <span className="font-semibold text-slate-200">
                        {history.data?.epf_enrolment === true ? 'Enrolled (Pay Structure)' : history.data?.epf_enrolment === false ? 'Not Enrolled' : 'Derived'}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-black/20 border border-white/5">
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">ESI Enrolment</span>
                      <span className="font-semibold text-slate-200">
                        {history.data?.esi_enrolment === true ? 'Enrolled (Pay Structure)' : history.data?.esi_enrolment === false ? 'Not Enrolled' : 'Derived'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action: Open Editor if not editing */}
              {!editor && (
                <div className="flex justify-end">
                  <Button
                    disabled={local || save.isPending}
                    variant="amber"
                    onClick={() => {
                      setEditor({
                        version: history.data.version,
                        intervals: structuredClone(history.data.revisions.at(-1)?.intervals || [blank()])
                      });
                      setReason('');
                      setConfirmed(false);
                      save.reset();
                    }}
                  >
                    Change employee setup
                  </Button>
                </div>
              )}

              {/* Revision History */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs uppercase font-extrabold tracking-wider text-slate-300">
                    Setup History & Audit Log
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400 font-bold">
                    {history.data.revisions.length} {history.data.revisions.length === 1 ? 'revision' : 'revisions'}
                  </span>
                </div>

                {!history.data.revisions.length ? (
                  <div className="p-4 rounded-xl border border-dashed border-white/5 text-center text-xs text-slate-500">
                    No historical revisions found.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {history.data.revisions.map((r, n) => (
                      <div className="p-3.5 rounded-xl bg-slate-950/40 border border-white/5 space-y-2 text-xs" key={r.id || n}>
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-slate-200">
                            Saved {r.created_at || ''} · {r.evidence_reference || 'Employee deduction setup'}
                          </p>
                          <span className="text-[10px] font-mono text-amber-400 font-bold">
                            Rev {r.version ?? n + 1}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {r.intervals.map((v, i) => (
                            <div key={i} className="flex items-center justify-between text-xs text-slate-300 p-2 rounded-lg bg-white/[0.02]">
                              <span className="font-mono text-[11px]">{v.effective_from} to {v.effective_to || 'ongoing'}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                v.verification_status === 'UNVERIFIED'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              }`}>
                                {v.verification_status === 'UNVERIFIED' ? 'Needs confirmation' : 'Confirmed'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form / Interval Editor */}
              {editor && (
                <form
                  className="rounded-2xl border border-amber-500/25 bg-slate-950/60 p-5 space-y-4 shadow-xl"
                  onSubmit={e => { e.preventDefault(); save.mutate(); }}
                >
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      Configure Dated Changes
                    </h3>
                    <span className="text-[10px] text-slate-400 font-mono">v{editor.version} → v{editor.version + 1}</span>
                  </div>

                  <Input
                    label="Find setup for employee change"
                    value={setupSearch}
                    onChange={e => { setSetupSearch(e.target.value); setSetupPage(1); }}
                  />

                  {setups.isError && (
                    <div role="alert" className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center justify-between">
                      <span>{message(setups.error)}</span>
                      <Button size="sm" onClick={() => setups.refetch()}>Retry setups</Button>
                    </div>
                  )}
                  {setups.isPending && <p role="status" className="text-xs text-slate-400">Loading company setups…</p>}
                  {setups.data && <Pagination currentPage={setupPage} totalPages={Math.max(1, Math.ceil(setups.data.total / 20))} onPageChange={setSetupPage} />}

                  <div className="space-y-3">
                    {editor.intervals.map((v, index) => (
                      <fieldset key={index} className="rounded-xl border border-white/10 bg-black/20 p-3.5 space-y-3" disabled={save.isPending}>
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <legend className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono">
                            Entry {index + 1}
                          </legend>
                          {editor.intervals.length > 1 && (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setEditor(old => ({ ...old, intervals: old.intervals.filter((_, i) => i !== index) }));
                                setConfirmed(false);
                              }}
                            >
                              Remove entry {index + 1}
                            </Button>
                          )}
                        </div>

                        <Select
                          label={`Entry ${index + 1} deduction setup`}
                          value={v.setupId || ''}
                          options={[
                            { value: '', label: !v.setupId && v.schemes.PT.statutory_scope_id ? 'Keep previously recorded setup' : 'Choose company deduction setup' },
                            ...available.map(c => ({ value: c.id, label: setupLabel(c) }))
                          ]}
                          onChange={e => {
                            const c = available.find(c => c.id === e.target.value);
                            if (!c) {
                              edit(index, { setupId: '', schemes: Object.fromEntries(schemes.map(s => [s, { ...v.schemes[s], statutory_scope_id: null }])) });
                              return;
                            }
                            setChosen(old => ({ ...old, [c.id]: c }));
                            edit(index, {
                              setupId: c.id,
                              effective_from: v.effective_from && v.effective_from >= c.effective_from ? v.effective_from : c.effective_from,
                              effective_to: c.effective_to || null,
                              schemes: Object.fromEntries(schemes.map(s => [s, { ...v.schemes[s], statutory_scope_id: c[`${s.toLowerCase()}_revision_id`] ? c.statutory_scope_id : null }]))
                            });
                          }}
                        />

                        <div className="grid sm:grid-cols-2 gap-3">
                          <Input
                            label={`Entry ${index + 1} applies from`}
                            type="date"
                            required
                            value={v.effective_from}
                            onChange={e => edit(index, { effective_from: e.target.value })}
                          />
                          <Input
                            label={`Entry ${index + 1} applies until (optional)`}
                            type="date"
                            value={v.effective_to || ''}
                            onChange={e => edit(index, { effective_to: e.target.value || null })}
                          />
                        </div>
                      </fieldset>
                    ))}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={save.isPending || editor.intervals.length >= 100}
                    onClick={() => { setEditor(old => ({ ...old, intervals: [...old.intervals, blank()] })); setConfirmed(false); }}
                  >
                    Add dated change
                  </Button>

                  <details className="group rounded-xl border border-white/5 bg-slate-900/40 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-400 group-open:text-slate-200 flex items-center justify-between select-none">
                      Supporting details (optional)
                    </summary>
                    <div className="pt-3">
                      <Input
                        label="Employee change supporting reference"
                        value={reason}
                        maxLength={2000}
                        onChange={e => { setReason(e.target.value); setConfirmed(false); }}
                      />
                    </div>
                  </details>

                  <label className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 cursor-pointer text-xs text-slate-200 hover:bg-white/[0.04] transition select-none">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-slate-900"
                    />
                    <span>I confirm these dated employee deduction settings.</span>
                  </label>

                  <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/5">
                    <Button type="submit" variant="amber" disabled={save.isPending || !valid || !confirmed}>
                      Save employee setup
                    </Button>
                    <Button variant="ghost" disabled={save.isPending} onClick={() => setEditor(null)}>
                      Cancel change
                    </Button>
                  </div>
                </form>
              )}

              {save.error && (
                <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <span>{message(save.error)}</span>
                </div>
              )}

              {save.isSuccess && (
                <div role="status" className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span>Employee payroll setup saved. Recalculate affected draft salaries to use the updated setup.</span>
                </div>
              )}
            </>
          )}
        </div>
    </Modal>
  );
}
