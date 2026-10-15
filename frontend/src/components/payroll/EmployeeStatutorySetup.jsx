import BulkStatutorySetup from './BulkStatutorySetup';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../AuthContext';
import { Button, Input, Select, Pagination } from '../ui';
import {
  getStatutoryEmployees,
  getStatutoryProfileContext,
  getEmployeeStatutoryProfiles,
  recordEmployeeStatutoryProfiles
} from '../../api/payrollProfilesApi';

const schemes = ['EPF', 'ESI', 'PT'];
const blank = () => ({
  effective_from: '',
  effective_to: null,
  verification_status: 'UNVERIFIED',
  advisor_name: null,
  verification_reference: null,
  verified_on: null,
  schemes: Object.fromEntries(schemes.map(s => [s, { statutory_scope_id: null, applicability: 'NOT_APPLICABLE', enrolled: null, basis_reference: '' }]))
});
const message = e => e?.response?.data?.message || e.message;

export default function EmployeeStatutorySetup({initialEmployeeId='',onEmployeeChange}) {
  const { user } = useAuth();
  const allowed = ['admin', 'accounts'].includes(user?.role);
  const client = useQueryClient();

  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [search, setSearch] = useState('');
  const [employeePage, setEmployeePage] = useState(1);
  const [scopeSearch, setScopeSearch] = useState('');
  const [scopePage, setScopePage] = useState(1);
  const [editor, setEditor] = useState(null);
  const [reason, setReason] = useState('');


  const employees = useQuery({
    queryKey: ['statutory-profile-employees', user?.id, search, employeePage],
    enabled: allowed,
    queryFn: async () => (await getStatutoryEmployees({ search, page: employeePage, limit: 20 })).data.result
  });

  const context = useQuery({
    queryKey: ['statutory-profile-scopes', user?.id, scopeSearch, scopePage],
    enabled: allowed,
    queryFn: async () => (await getStatutoryProfileContext({ search: scopeSearch, page: scopePage, limit: 20 })).data.result
  });

  const history = useQuery({
    queryKey: ['statutory-profile-history', user?.id, employeeId],
    enabled: allowed && !!employeeId,
    queryFn: async () => (await getEmployeeStatutoryProfiles(employeeId)).data.result
  });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['statutory-bulk-candidates'] });
    client.invalidateQueries({ queryKey: ['statutory-profile-scopes'] });
    client.invalidateQueries({ queryKey: ['statutory-profile-history'] });
  };

  const save = useMutation({
    mutationFn: () => recordEmployeeStatutoryProfiles(editor.employeeId, {
      expected_version: editor.version,
      intervals: editor.intervals.map(v => ({ ...v, schemes: Object.fromEntries(Object.entries(v.schemes).map(([s, data]) => [s, { ...data, applicability: s === 'PT' && history.data?.employee_category !== 'Local Daily-Wage Workers' ? 'APPLICABLE' : s !== 'PT' && history.data?.enrolment_managed_by_pay_structure && data.statutory_scope_id ? 'APPLICABLE' : 'NOT_APPLICABLE', enrolled: s === 'PT' || history.data?.enrolment_managed_by_pay_structure ? null : false }])) })),
      evidence_reference: reason.trim()
    }),
    onSuccess: () => {
      setEditor(null);
      setReason('');
      refresh();
    }
  });

  const scopeOptions = value => [
    { value: '', label: 'Unresolved / no canonical scope' },
    ...(context.data?.scopes || []).map(s => ({ value: s.id, label: `${s.jurisdiction_code} / ${s.establishment_code}` })),
    ...((value && !(context.data?.scopes || []).some(s => s.id === value)) ? [{ value, label: `Recorded canonical ID: ${value}` }] : [])
  ];

  const edit = (index, next, invalidate = false) =>
    setEditor(old => ({
      ...old,
      intervals: old.intervals.map((v, i) =>
        i !== index ? v : invalidate
          ? { ...next, verification_status: 'UNVERIFIED', advisor_name: null, verification_reference: null, verified_on: null }
          : next
      )
    }));

  const busy = save.isPending;

  if (!allowed) {
    return (
      <div className="p-6">
        <p role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300">
          Accounts or Admin employee payroll setup access is required.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 text-slate-200 p-4 sm:p-6 max-w-7xl mx-auto">
      <div><h2 className="text-xl font-bold">Employee payroll setup</h2><p className="text-sm text-slate-400">Assign an employee's state / establishment mapping and effective dates. Enrolment comes from Employee Management; statutory rates and shared mappings are maintained in the Statutory Deduction Master.</p></div>
      {/* Top Stats Overview Card */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02] flex justify-around items-center text-center divide-x divide-white/5">
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Canonical Scopes</span>
          <span className="text-2xl font-black text-slate-100 font-mono">{context.data?.total ?? '—'}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">Payroll Employees</span>
          <span className="text-2xl font-black text-amber-400 font-mono">{employees.data?.total ?? '—'}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-sky-500 block mb-1">Timeline Version</span>
          <span className="text-2xl font-black text-sky-400 font-mono">
            {employeeId ? (history.data?.version !== undefined ? `v${history.data.version}` : 'Loading…') : 'None Selected'}
          </span>
        </div>
      </div>

      {/* Status & Error Alerts */}
      {save.isSuccess && (
        <div role="status" className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          Employee payroll setup saved. Recalculate affected draft salaries to use the updated setup.
        </div>
      )}
      {[save.error].filter(Boolean).map((e, i) => (
        <div key={i} role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {message(e)}
        </div>
      ))}

      <section className="space-y-3" aria-label="Available state and establishment mappings">
        <Input label="Find state / establishment mapping" value={scopeSearch} onChange={e=>{setScopeSearch(e.target.value);setScopePage(1);}}/>
        {context.isPending?<p role="status">Loading state / establishment mappings…</p>:context.isError?<p role="alert">{message(context.error)} <Button onClick={()=>context.refetch()}>Retry mappings</Button></p>:<Pagination currentPage={scopePage} totalPages={Math.max(1,Math.ceil(context.data.total/20))} onPageChange={setScopePage}/>}
      </section>
      <BulkStatutorySetup user={user} scopeOptions={scopeOptions} onUpdated={refresh} />

      {history.data?.employee_category === 'Local Daily-Wage Workers' && <p role="status">Local Daily-Wage Workers have no EPF, ESI or PT deductions. No statutory setup is required.</p>}
      {/* 1. Employee Selection & Profile Timeline */}
      <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-6 shadow-xl">
        <div className="flex items-center gap-2 text-amber-500">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-200">1. Employee Selection & Statutory Timeline</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <Input label="Employee search" value={search} onChange={e => { setSearch(e.target.value); setEmployeePage(1); }} />
          {employees.isPending ? (
            <p role="status" className="text-xs text-slate-400 py-3">Loading employees…</p>
          ) : employees.isError ? (
            <div role="alert" className="text-xs text-red-400 flex items-center gap-3 py-2">
              <span>{message(employees.error)}</span>
              <Button size="sm" variant="secondary" onClick={() => employees.refetch()}>Retry employees</Button>
            </div>
          ) : (
            <Select
              label="Payroll employee"
              value={employeeId}
              disabled={busy}
              options={[
                { value: '', label: 'Select an employee' },
                ...employees.data.employees.map(e => ({ value: e.id, label: `${e.employee_code} / ${e.employee_name}` })),
                ...((employeeId && !employees.data.employees.some(e => e.id === employeeId)) ? [{ value: employeeId, label: `Selected employee: ${employeeId}` }] : [])
              ]}
              onChange={e => {
                setEmployeeId(e.target.value);
                onEmployeeChange?.(e.target.value);
                setEditor(null);
                save.reset();
                setReason('');
              }}
            />
          )}
        </div>

        {!employees.isPending && !employees.isError && employees.data && !employees.data.employees.length && (
          <p className="text-xs text-slate-500 italic">No employees match.</p>
        )}

        {!employees.isPending && !employees.isError && employees.data && (
          <Pagination currentPage={employeePage} totalPages={Math.max(1, Math.ceil(employees.data.total / 20))} onPageChange={setEmployeePage} />
        )}

        {employeeId && (
          <div className="pt-4 border-t border-white/5 space-y-4">
            {history.isPending ? (
              <p role="status" className="text-xs text-slate-400">Loading statutory profile history…</p>
            ) : history.isError ? (
              <div role="alert" className="text-xs text-red-400 flex items-center gap-3">
                <span>{message(history.error)}</span>
                <Button size="sm" variant="secondary" onClick={() => history.refetch()}>Retry profile history</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-0.5">Timeline Status</span>
                    <p className="text-sm font-semibold text-slate-200">
                      Current profile timeline version: <span className="font-mono text-amber-400">{history.data.version}</span>
                    </p>
                  </div>
                  <Button
                    variant="amber"
                    disabled={busy || history.data?.employee_category === 'Local Daily-Wage Workers'}
                    onClick={() => {
                      save.reset();
                      setEditor({
                        employeeId,
                        version: history.data.version,
                        intervals: structuredClone(history.data.revisions.at(-1)?.intervals || [blank()])
                      });
                      setReason('');
                    }}
                  >
                    Prepare complete profile timeline
                  </Button>
                </div>

                <details className="group rounded-2xl border border-white/5 bg-black/20 overflow-hidden transition-all duration-200">
                  <summary className="p-4 cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-amber-400 flex items-center justify-between">
                    <span>Immutable employee profile history and evidence</span>
                    <span className="text-slate-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="p-4 border-t border-white/5 bg-slate-950/60 overflow-x-auto">
                    <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">{JSON.stringify(history.data.revisions, null, 2)}</pre>
                  </div>
                </details>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Timeline Editor Modal/Container */}
      {editor && (
        <form className="glass-panel p-6 rounded-3xl border border-amber-500/20 bg-amber-500/[0.01] space-y-6 shadow-xl" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
          <div className="border-b border-white/5 pb-4">
            <h2 className="font-extrabold text-lg text-slate-100">Complete dated timeline — expected version {editor.version}</h2>
            <p className="text-xs text-slate-400 mt-1">
              Preserve all applicable historical intervals. Changes to dates, scope, applicability or enrolment clear verification for that interval and require renewed Accounts confirmation. Existing HR enrolment flags are not overwritten.
            </p>
          </div>

          <div className="space-y-6">
            {editor.intervals.map((v, index) => (
              <fieldset key={index} className="glass-panel p-5 rounded-2xl border border-white/10 space-y-5 bg-slate-950/40 relative">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <legend className="text-xs font-extrabold uppercase tracking-wider text-amber-400">Profile interval {index + 1}</legend>
                  {editor.intervals.length > 1 && (
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => setEditor(old => ({ ...old, intervals: old.intervals.filter((_, i) => i !== index) }))}>
                      Remove interval {index + 1}
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label={`Interval ${index + 1} effective from`} type="date" required value={v.effective_from} onChange={e => edit(index, { ...v, effective_from: e.target.value }, true)} />
                  <Input label={`Interval ${index + 1} effective to (blank is ongoing)`} type="date" value={v.effective_to || ''} onChange={e => edit(index, { ...v, effective_to: e.target.value || null }, true)} />
                </div>

                <div className="space-y-4 pt-2">
                  <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Statutory Scheme Applicability & Scopes</h4>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {schemes.map(s => (
                      <div key={s} className="glass-panel p-4 rounded-xl border border-white/5 space-y-3 bg-white/[0.01]">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400/90 block border-b border-white/5 pb-1.5">{s} Scheme</span>
                        <p className="text-xs text-slate-400">{s === 'PT' ? (history.data?.employee_category === 'Local Daily-Wage Workers' ? 'Not applicable: Local Daily-Wage Workers.' : 'Automatically applicable; deduction is determined by the configured PT slab.') : (history.data?.enrolment_managed_by_pay_structure ? 'Enrolment and applicability are read from Employee Management for this interval.' : 'Not applicable: Casual/Local workers are excluded.')}</p>
                        {(s === 'PT' ? history.data?.employee_category !== 'Local Daily-Wage Workers' : history.data?.enrolment_managed_by_pay_structure) && <Select label={`Interval ${index + 1} ${s} scope`} value={v.schemes[s].statutory_scope_id || ''} options={scopeOptions(v.schemes[s].statutory_scope_id)} onChange={e => edit(index, { ...v, schemes: { ...v.schemes, [s]: { ...v.schemes[s], statutory_scope_id: e.target.value || null } } }, true)} />}
                        <Input label={`Interval ${index + 1} ${s} basis reference`} required maxLength={2000} value={v.schemes[s].basis_reference} onChange={e => edit(index, { ...v, schemes: { ...v.schemes, [s]: { ...v.schemes[s], basis_reference: e.target.value } } }, true)} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-panel p-4 rounded-xl border border-white/5 space-y-3 bg-white/[0.01]">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 block border-b border-white/5 pb-1.5">Verification & Accounts Confirmation</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select label={`Interval ${index + 1} verification`} value={v.verification_status} options={['UNVERIFIED', 'ACCOUNTS_CONFIRMED', ...(v.verification_status === 'ADVISOR_VERIFIED' ? ['ADVISOR_VERIFIED'] : [])].map(a => ({ value: a, label: a }))} onChange={e => edit(index, { ...v, verification_status: e.target.value, advisor_name: null, verification_reference: null, verified_on: null })} />
                    {['ADVISOR_VERIFIED', 'ACCOUNTS_CONFIRMED'].includes(v.verification_status) && (
                      ['advisor_name', 'verification_reference', 'verified_on'].map(key => (
                        <Input key={key} label={`Interval ${index + 1} ${key === 'advisor_name' ? 'setup confirmed by' : key.replaceAll('_', ' ')}`} type={key === 'verified_on' ? 'date' : 'text'} required value={v[key] || ''} onChange={e => edit(index, { ...v, [key]: e.target.value || null })} />
                      ))
                    )}
                  </div>
                </div>
              </fieldset>
            ))}
          </div>

          <div className="pt-4 border-t border-white/5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="secondary" disabled={busy || editor.intervals.length >= 100} onClick={() => setEditor(old => ({ ...old, intervals: [...old.intervals, blank()] }))}>
                Add dated interval
              </Button>
            </div>
            <Input label="Profile correction / evidence reference" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} />
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" variant="amber" disabled={busy || !reason.trim()}>
                Record profile timeline
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditor(null)}>
                Cancel profile edit
              </Button>
            </div>
          </div>
        </form>
      )}


    </div>
  );
}
