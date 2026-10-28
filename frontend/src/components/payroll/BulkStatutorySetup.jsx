import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Pagination, Table, TableHeader, TableBody, TableRow, TableCell } from '../ui';
import { getStatutorySetupCandidates, getCompanyDeductionSetups, applyCompanyDeductionSetup } from '../../api/payrollProfilesApi';
import definitions from '../../../../shared/hrEmployeeCategories.json';
import { setupLabel } from './setupLabels';
const message = e => e?.response?.data?.message || e?.message || 'Setup failed';

export default function BulkStatutorySetup({ user, onUpdated }) {
  const client = useQueryClient();
  const [filters, setFilters] = useState({ search: '', department: '', employee_category: '', unconfigured_only: 'true' });
  const [page, setPage] = useState(1), [selected, setSelected] = useState([]), [results, setResults] = useState([]);
  const [from, setFrom] = useState(''), [setup, setSetup] = useState(null), [setupSearch, setSetupSearch] = useState(''), [setupPage, setSetupPage] = useState(1);
  const [evidence, setEvidence] = useState(''), [ack, setAck] = useState(false);
  const setups = useQuery({ queryKey: ['company-deduction-setups', user.id, setupSearch, setupPage], queryFn: async () => (await getCompanyDeductionSetups({ search: setupSearch, page: setupPage, limit: 20 })).data.result });
  const params = { search: filters.search, ...(filters.department ? { department: filters.department } : {}), ...(filters.employee_category ? { employee_category: filters.employee_category } : {}), unconfigured_only: filters.unconfigured_only };
  const candidates = useQuery({ queryKey: ['statutory-bulk-candidates', user.id, filters, page], queryFn: async () => (await getStatutorySetupCandidates({ ...params, page, limit: 20 })).data.result });
  const changeFilter = (key, value) => { setFilters(old => ({ ...old, [key]: value })); setPage(1); setSelected([]); setAck(false); setResults([]); };
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['statutory-bulk-candidates'] });
    client.invalidateQueries({ queryKey: ['statutory-profile-history'] });
    client.invalidateQueries({ queryKey: ['payroll-employee-review'] });
    client.invalidateQueries({ queryKey: ['payroll-sheet-register'] });
    client.invalidateQueries({ queryKey: ['salary-register'] });
    onUpdated?.();
  };
  const save = useMutation({ mutationFn: () => applyCompanyDeductionSetup({
    employees: selected.map(e => ({ employee_id: e.id, expected_version: 0 })), setup_id: setup.id,
    effective_from: from, evidence_reference: evidence.trim()
  }), onSuccess: r => {
    const rows = r.data.result.results.map(r => ({ ...r, employee_name: selected.find(e => e.id === r.employee_id)?.employee_name })); setResults(rows);
    const succeeded = new Set(rows.filter(e => e.success).map(e => e.employee_id));
    setSelected(items => items.filter(e => !succeeded.has(e.id))); setAck(false); refresh();
  } });
  const selectGroup = useMutation({ mutationFn: async () => {
    const all = []; let next = 1;
    do {
      const data = (await getStatutorySetupCandidates({ ...params, unconfigured_only: 'true', page: next, limit: 100 })).data.result;
      if (data.total > 100) throw new Error('More than 100 employees match. Narrow the department, category or search before selecting the group.');
      all.push(...data.employees); if (all.length >= data.total) break; next++;
    } while (next <= 100);
    return all;
  }, onSuccess: rows => { setSelected(rows.filter(eligible)); setAck(false); } });
  const busy = save.isPending || selectGroup.isPending;
  const eligible = e => e.profile_version === 0 && e.employee_category !== 'Local Daily-Wage Workers' && (!setup?.effective_to || e.joining_date <= setup.effective_to);
  const pageEligible = (candidates.data?.employees || []).filter(eligible);
  const valid = setup && from && from >= setup.effective_from && (!setup.effective_to || from <= setup.effective_to) && selected.length > 0 && selected.length <= 100 && selected.every(eligible);
  const setupOptions = [...(setups.data?.setups || [])];
  if (setup && !setupOptions.some(s => s.id === setup.id)) setupOptions.unshift(setup);
  return (
    <section aria-label="Bulk statutory setup" className="glass-panel rounded-2xl border border-white/10 p-6 space-y-6 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-white/5">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-100">Assign deduction setup to employees</h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Batch Setup
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Select employees, choose their company deduction setup and set a start date. EPF/ESI enrolment comes from Employee Management. Existing setups are protected; use the individual employee section for changes.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-950/40 border border-white/5 space-y-3">
        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block">Candidate Filters</span>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input label="Find employees" value={filters.search} disabled={busy} onChange={e => changeFilter('search', e.target.value)} />
          <Select label="Department" value={filters.department} disabled={busy} options={[{ value: '', label: 'All departments' }, ...['SNP Factory', 'Fabric Factory', 'Head Office', 'Projects'].map(v => ({ value: v, label: v }))]} onChange={e => changeFilter('department', e.target.value)} />
          <Select label="Employee category" value={filters.employee_category} disabled={busy} options={[{ value: '', label: 'All categories' }, ...[...definitions.map(d => d.category), 'Projects Department Employees'].map(v => ({ value: v, label: v }))]} onChange={e => changeFilter('employee_category', e.target.value)} />
          <Select label="Setup status" value={filters.unconfigured_only} disabled={busy} options={[{ value: 'true', label: 'Needs initial setup' }, { value: 'false', label: 'All active employees' }]} onChange={e => changeFilter('unconfigured_only', e.target.value)} />
        </div>
      </div>

      {candidates.isPending ? (
        <div role="status" className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-xs text-slate-400 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          Loading bulk setup employees…
        </div>
      ) : candidates.isError ? (
        <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center justify-between">
          <span>{message(candidates.error)}</span>
          <Button size="sm" onClick={() => candidates.refetch()}>Retry bulk employees</Button>
        </div>
      ) : (
        <>
          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-bold border border-amber-500/20 font-mono">
                {selected.length} selected
              </span>
              <span className="text-slate-500 text-xs">·</span>
              <span className="text-xs text-slate-300">
                <strong className="text-white font-mono">{candidates.data.eligible_total}</strong> needing setup in this group
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button disabled={busy || !candidates.data.eligible_total} variant="secondary" size="sm" onClick={() => selectGroup.mutate()}>
                Select all needing setup in this group
              </Button>
              <Button disabled={busy || !selected.length} variant="ghost" size="sm" onClick={() => { setSelected([]); setAck(false); }}>
                Clear selection
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell isHeader className="w-12">
                    <input
                      type="checkbox"
                      aria-label="Select eligible employees on this page"
                      disabled={busy || !pageEligible.length}
                      checked={pageEligible.length > 0 && pageEligible.every(e => selected.some(s => s.id === e.id))}
                      onChange={e => {
                        setSelected(old => e.target.checked ? [...old.filter(s => !pageEligible.some(p => p.id === s.id)), ...pageEligible] : old.filter(s => !pageEligible.some(p => p.id === s.id)));
                        setAck(false);
                      }}
                      className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-slate-900"
                    />
                  </TableCell>
                  <TableCell isHeader>Employee</TableCell>
                  <TableCell isHeader>Category / department</TableCell>
                  <TableCell isHeader>Joined</TableCell>
                  <TableCell isHeader>Existing pay enrolment</TableCell>
                  <TableCell isHeader>Profile</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.data.employees.map(e => (
                  <TableRow key={e.id} className="hover:bg-white/[0.02] transition-colors">
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Bulk select ${e.employee_code}`}
                        disabled={busy || (!eligible(e) && !selected.some(s => s.id === e.id))}
                        checked={selected.some(s => s.id === e.id)}
                        onChange={event => {
                          setSelected(old => event.target.checked ? [...old, e] : old.filter(s => s.id !== e.id));
                          setAck(false);
                        }}
                        className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-slate-900"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-slate-100">{e.employee_name}</div>
                      <div className="text-xs text-slate-400 font-mono">{e.employee_code}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-200">{e.employee_category}</div>
                      <div className="text-xs text-slate-400">{e.department}</div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-slate-300">{e.joining_date}</span>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-0.5">
                        <div className="text-slate-300">EPF: {e.epf_enrolment == null ? 'Not recorded' : e.epf_enrolment ? 'Enrolled' : 'Not enrolled'}</div>
                        <div className="text-slate-300">ESI: {e.esi_enrolment == null ? 'Not recorded' : e.esi_enrolment ? 'Enrolled' : 'Not enrolled'}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {e.employee_category === 'Local Daily-Wage Workers' ? (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-slate-800 text-slate-300 border border-slate-700">
                          No deduction setup required
                        </span>
                      ) : e.profile_version ? (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
                          Setup recorded — protected
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-amber-950/40 text-amber-400 border border-amber-800/40">
                          Needs setup
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!candidates.data.employees.length && <p className="text-xs text-slate-400">No employees match this bulk setup filter.</p>}
          <Pagination currentPage={page} totalPages={Math.max(1, Math.ceil(candidates.data.total / 20))} onPageChange={setPage} />
        </>
      )}

      {/* Setup Assignment Form */}
      <div className="p-5 rounded-2xl bg-slate-950/40 border border-white/5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400"></span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">Assignment Configuration</h3>
        </div>

        <Input label="Find deduction setup" value={setupSearch} disabled={busy} onChange={e => { setSetupSearch(e.target.value); setSetupPage(1); }} />
        {setups.isPending ? (
          <p role="status" className="text-xs text-slate-400">Loading deduction setups…</p>
        ) : setups.isError ? (
          <div role="alert" className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center justify-between">
            <span>{message(setups.error)}</span>
            <Button size="sm" onClick={() => setups.refetch()}>Retry deduction setups</Button>
          </div>
        ) : (
          <>
            {!setups.data.total && <p className="text-xs text-slate-400">No company setups found. Accounts can create one in Company deduction setup.</p>}
            <Select
              label="Deduction setup"
              value={setup?.id || ''}
              disabled={busy}
              options={[{ value: '', label: 'Choose company deduction setup' }, ...setupOptions.map(s => ({ value: s.id, label: setupLabel(s) }))]}
              onChange={e => { setSetup(setupOptions.find(s => s.id === e.target.value) || null); setAck(false); }}
            />
            <Pagination currentPage={setupPage} totalPages={Math.max(1, Math.ceil(setups.data.total / 20))} onPageChange={setSetupPage} />
          </>
        )}

        <Input
          label="Employee setup applies from"
          type="date"
          required
          value={from}
          min={setup?.effective_from}
          max={setup?.effective_to || undefined}
          disabled={busy}
          onChange={e => { setFrom(e.target.value); setAck(false); }}
        />
        <p className="text-[11px] text-slate-400">
          Up to 100 employees per batch. Each setup starts on the later of this date and the employee’s joining date. Existing history is protected.
        </p>

        <details className="group rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400 group-open:text-slate-200 flex items-center justify-between select-none">
            Supporting details (optional)
          </summary>
          <div className="pt-3">
            <Input label="Employee setup supporting reference" maxLength={2000} value={evidence} disabled={busy} onChange={e => { setEvidence(e.target.value); setAck(false); }} />
          </div>
        </details>

        {/* Assignment Preview */}
        <div aria-label="Assignment preview" className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/[0.05] to-transparent p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-400">Assignment Preview</span>
            <span className="font-bold text-slate-200 font-mono">{selected.length} employees selected</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-slate-300">
            <p><strong className="text-slate-400">Setup:</strong> {setup ? setupLabel(setup) : 'Choose a setup'}</p>
            <p><strong className="text-slate-400">Applies from:</strong> {from || 'Choose a date'}</p>
          </div>
          <p className="text-[11px] text-slate-400">
            EPF/ESI enrolment comes from employee records. Saving confirms this assignment as Accounts.
          </p>
          {setup?.effective_to && (
            <p className="text-[11px] text-amber-400/90">
              This setup ends on {setup.effective_to}; a later period needs a new setup.
            </p>
          )}
        </div>
      </div>

      {/* Confirmation & Submission */}
      <label className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/5 cursor-pointer text-xs text-slate-200 hover:bg-white/[0.04] transition select-none">
        <input
          type="checkbox"
          checked={ack}
          disabled={busy}
          onChange={e => setAck(e.target.checked)}
          className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-slate-900"
        />
        <span>I confirm this setup and start date apply to the selected employees.</span>
      </label>

      <Button
        variant="amber"
        loading={save.isPending}
        disabled={busy || !valid || !ack || setups.isError}
        onClick={() => save.mutate()}
        className="w-full sm:w-auto"
      >
        Apply to selected employees
      </Button>

      {(save.error || selectGroup.error) && (
        <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300">
          {message(save.error || selectGroup.error)}
        </div>
      )}

      {!!results.length && (
        <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-900/30 space-y-2">
          <p role="status" className="text-xs font-bold text-emerald-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Assignment completed. Recalculate affected draft salaries to use the changes.
          </p>
          <ul aria-label="Employee setup results" className="text-xs space-y-1.5 pt-2 border-t border-emerald-900/30">
            {results.map(r => (
              <li key={r.employee_id} className="flex items-center gap-2 text-slate-300">
                <span className={`w-1.5 h-1.5 rounded-full ${r.success ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                <span>
                  {r.employee_name || r.employee_code || 'Selected employee'}: {r.success ? `Setup applied from ${r.effective_from}` : `Not applied (${r.status}) — ${r.message}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
