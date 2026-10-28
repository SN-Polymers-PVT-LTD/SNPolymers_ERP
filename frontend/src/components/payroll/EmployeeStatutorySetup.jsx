import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../AuthContext';
import { Button, Input, Select, Pagination } from '../ui';
import { getStatutoryEmployees, getEmployeeStatutoryProfiles, recordEmployeeStatutoryProfiles, getCompanyDeductionSetups } from '../../api/payrollProfilesApi';
import BulkStatutorySetup from './BulkStatutorySetup';
import { setupLabel } from './setupLabels';
const schemes = ['EPF', 'ESI', 'PT'];
const message = e => e?.response?.data?.message || e?.message;
const blank = () => ({ effective_from: '', effective_to: null, verification_status: 'UNVERIFIED', advisor_name: null, verification_reference: null, verified_on: null,
  schemes: Object.fromEntries(schemes.map(s => [s, { statutory_scope_id: null, applicability: 'NOT_APPLICABLE', enrolled: null, basis_reference: 'Accounts employee deduction setup' }])) });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export default function EmployeeStatutorySetup({ initialEmployeeId = '', onEmployeeChange }) {
  const { user } = useAuth(), client = useQueryClient(), allowed = user?.role === 'accounts';
  const [employeeId, setEmployeeId] = useState(initialEmployeeId), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [setupSearch, setSetupSearch] = useState(''), [setupPage, setSetupPage] = useState(1), [chosen, setChosen] = useState({});
  const [editor, setEditor] = useState(null), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const employees = useQuery({ queryKey: ['statutory-profile-employees', user?.id, search, page], enabled: allowed, queryFn: async () => (await getStatutoryEmployees({ search, page, limit: 20 })).data.result });
  const history = useQuery({ queryKey: ['statutory-profile-history', user?.id, employeeId], enabled: allowed && !!employeeId, queryFn: async () => (await getEmployeeStatutoryProfiles(employeeId)).data.result });
  const setups = useQuery({ queryKey: ['company-deduction-setups', user?.id, setupSearch, setupPage], enabled: allowed, queryFn: async () => (await getCompanyDeductionSetups({ search: setupSearch, page: setupPage, limit: 20 })).data.result });
  const save = useMutation({ mutationFn: () => recordEmployeeStatutoryProfiles(employeeId, {
    expected_version: editor.version, evidence_reference: reason.trim() || 'Accounts employee deduction setup',
    intervals: editor.intervals.map(({ changed, setupId: _setupId, ...v }) => {
      if (!changed && v.verification_status !== 'UNVERIFIED') return v;
      const evidence = reason.trim() || 'Accounts employee deduction setup';
      return { ...v, verification_status: 'ACCOUNTS_CONFIRMED', advisor_name: user.display_name || user.name || 'Accounts', verification_reference: evidence, verified_on: today(),
        schemes: Object.fromEntries(schemes.map(s => [s, { ...v.schemes[s], applicability: s === 'PT' || (history.data?.enrolment_managed_by_pay_structure && v.schemes[s].statutory_scope_id) ? 'APPLICABLE' : 'NOT_APPLICABLE', enrolled: s === 'PT' || history.data?.enrolment_managed_by_pay_structure ? null : false, basis_reference: evidence }])) };
    })
  }), onSuccess: () => {
    setEditor(null); setConfirmed(false);
    for (const key of ['statutory-bulk-candidates', 'statutory-profile-history', 'payroll-employee-review', 'payroll-sheet-register', 'salary-register']) client.invalidateQueries({ queryKey: [key] });
  } });
  const edit = (index, patch) => { setEditor(old => ({ ...old, intervals: old.intervals.map((v, i) => i === index ? { ...v, ...patch, changed: true } : v) })); setConfirmed(false); save.reset(); };
  if (!allowed) return <p role="alert">Employee payroll setup is maintained by Accounts only.</p>;
  const local = history.data?.employee_category === 'Local Daily-Wage Workers';
  const available = [...(setups.data?.setups || [])];
  for (const c of Object.values(chosen)) if (!available.some(s => s.id === c.id)) available.push(c);
  const valid = editor?.intervals.every(v => v.effective_from && (!v.effective_to || v.effective_to >= v.effective_from) && (!v.changed || v.schemes.PT.statutory_scope_id));
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Stats Overview Card */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02] flex justify-around items-center text-center divide-x divide-white/5">
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Total Employees</span>
          <span className="text-2xl font-black text-slate-100 font-mono">{employees.data?.total ?? '—'}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">Company Setups</span>
          <span className="text-2xl font-black text-amber-400 font-mono">{setups.data?.total ?? '—'}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 block mb-1">Active Status</span>
          <span className="text-xs font-bold text-emerald-300 font-mono">
            {employeeId ? (local ? 'Local Worker' : history.data?.version ? `Setup v${history.data.version}` : 'Needs Setup') : 'Select Employee'}
          </span>
        </div>
      </div>

      {/* Policy & Guidance Notice */}
      <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span>
          <h2 className="text-sm font-bold text-amber-400">Employee payroll setup</h2>
        </div>
        <p className="text-slate-300">
          Accounts assigns company deduction setups to employees. Employee details, pay structures and EPF/ESI enrolment remain in Employee Management.
        </p>
        <p className="text-slate-400 text-[11px]">
          Published company deduction setups govern individual EPF, ESI, and PT deductions. Dated intervals are strictly tracked with audit versioning.
        </p>
      </div>

      {/* Bulk Setup Component */}
      <BulkStatutorySetup user={user} />

      {/* Individual Employee Setup */}
      <section className="glass-panel p-6 rounded-2xl border border-white/10 space-y-6 shadow-xl backdrop-blur-md" aria-label="Individual employee setup">
        <div className="flex items-center gap-3 pb-4 border-b border-white/5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-100">View or change employee setup</h3>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                Individual Record
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Select an employee to inspect active deduction history or configure individual dated changes.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Employee search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          {employees.isPending ? (
            <div role="status" className="flex items-center text-xs text-slate-400 h-10">Loading employees…</div>
          ) : employees.isError ? (
            <div role="alert" className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center justify-between">
              <span>{message(employees.error)}</span>
              <Button size="sm" onClick={() => employees.refetch()}>Retry employees</Button>
            </div>
          ) : (
            <div>
              <Select
                label="Payroll employee"
                value={employeeId}
                options={[
                  { value: '', label: 'Select an employee' },
                  ...employees.data.employees.map(e => ({ value: e.id, label: `${e.employee_code} / ${e.employee_name}` })),
                  ...(employeeId && !employees.data.employees.some(e => e.id === employeeId) ? [{ value: employeeId, label: 'Selected employee' }] : [])
                ]}
                onChange={e => {
                  setEmployeeId(e.target.value);
                  onEmployeeChange?.(e.target.value);
                  setEditor(null);
                  setConfirmed(false);
                  save.reset();
                }}
              />
              {!employees.data.employees.length && <p className="text-xs text-slate-400 mt-1">No employees match.</p>}
            </div>
          )}
        </div>

        {employees.data && (
          <Pagination currentPage={page} totalPages={Math.max(1, Math.ceil(employees.data.total / 20))} onPageChange={setPage} />
        )}

        {employeeId && (history.isPending ? (
          <div role="status" className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-xs text-slate-400 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
            Loading employee setup…
          </div>
        ) : history.isError ? (
          <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center justify-between">
            <span>{message(history.error)}</span>
            <Button size="sm" onClick={() => history.refetch()}>Retry employee setup</Button>
          </div>
        ) : (
          <div className="p-5 rounded-2xl bg-slate-950/40 border border-white/5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-0.5">Status Overview</span>
                <p className="text-sm font-semibold text-slate-200">
                  {local ? 'No deduction setup required for Local Daily-Wage Workers.' : history.data.version ? 'Setup recorded. Review the dated history before making changes.' : 'Needs setup.'}
                </p>
              </div>
              <Button
                disabled={local || save.isPending}
                variant="amber"
                size="sm"
                onClick={() => {
                  setEditor({ version: history.data.version, intervals: structuredClone(history.data.revisions.at(-1)?.intervals || [blank()]) });
                  setReason('');
                  setConfirmed(false);
                  save.reset();
                }}
              >
                Change employee setup
              </Button>
            </div>

            <details className="group rounded-xl border border-white/5 bg-slate-900/40 overflow-hidden">
              <summary className="flex items-center justify-between p-3.5 cursor-pointer select-none text-xs font-bold text-slate-300 hover:text-white transition">
                <span>Employee setup history</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400 font-mono">
                  {history.data.revisions.length} {history.data.revisions.length === 1 ? 'revision' : 'revisions'}
                </span>
              </summary>
              <div className="p-3.5 pt-0 space-y-2.5 border-t border-white/5">
                {!history.data.revisions.length && <p className="text-xs text-slate-400 pt-2">No setup recorded.</p>}
                {history.data.revisions.map((r, n) => (
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-2 text-xs" key={r.id || n}>
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-200">Saved {r.created_at || ''} · {r.evidence_reference || 'Employee deduction setup'}</p>
                      <span className="text-[10px] font-mono text-amber-400 font-bold">Rev {r.version ?? n + 1}</span>
                    </div>
                    <div className="space-y-1">
                      {r.intervals.map((v, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-slate-300 p-2 rounded-lg bg-white/[0.02]">
                          <span className="font-mono">{v.effective_from} to {v.effective_to || 'ongoing'}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${v.verification_status === 'UNVERIFIED' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                            {v.verification_status === 'UNVERIFIED' ? 'Needs confirmation' : 'Confirmed'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))}
      </section>

      {/* Editor Modal / Form */}
      {editor && (
        <form className="glass-panel p-6 rounded-2xl border border-amber-500/20 bg-slate-900/60 space-y-5 shadow-2xl" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
          <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg text-slate-100">Change employee deduction setup</h3>
              <p className="text-xs text-slate-400 mt-1">
                Keep earlier dated entries when adding a change. Payroll history is retained with every save.
              </p>
            </div>
          </div>

          <Input label="Find setup for employee change" value={setupSearch} onChange={e => { setSetupSearch(e.target.value); setSetupPage(1); }} />
          {setups.isError && (
            <div role="alert" className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center justify-between">
              <span>{message(setups.error)}</span>
              <Button size="sm" onClick={() => setups.refetch()}>Retry setups</Button>
            </div>
          )}
          {setups.isPending && <p role="status" className="text-xs text-slate-400">Loading company setups…</p>}
          {setups.data && <Pagination currentPage={setupPage} totalPages={Math.max(1, Math.ceil(setups.data.total / 20))} onPageChange={setSetupPage} />}

          <div className="space-y-4">
            {editor.intervals.map((v, index) => (
              <fieldset key={index} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 space-y-3" disabled={save.isPending}>
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <legend className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono">Entry {index + 1}</legend>
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
                  <Input label={`Entry ${index + 1} applies from`} type="date" required value={v.effective_from} onChange={e => edit(index, { effective_from: e.target.value })} />
                  <Input label={`Entry ${index + 1} applies until (optional)`} type="date" value={v.effective_to || ''} onChange={e => edit(index, { effective_to: e.target.value || null })} />
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
              <Input label="Employee change supporting reference" value={reason} maxLength={2000} onChange={e => { setReason(e.target.value); setConfirmed(false); }} />
            </div>
          </details>

          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 cursor-pointer text-xs text-slate-200 hover:bg-white/[0.04] transition select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-slate-900"
            />
            <span>I confirm these dated employee deduction settings.</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="amber" disabled={save.isPending || !valid || !confirmed}>
              Save employee setup
            </Button>
            <Button variant="ghost" disabled={save.isPending} onClick={() => setEditor(null)}>
              Cancel change
            </Button>
          </div>
        </form>
      )}

      {save.isError && (
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
    </div>
  );
}
