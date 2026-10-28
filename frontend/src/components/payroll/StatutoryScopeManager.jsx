import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../AuthContext';
import { Input, Select, Button, Pagination, Table, TableHeader, TableBody, TableRow, TableCell } from '../ui';
import { getStatutoryStates, getCompanyDeductionSetups, getCompanyDeductionOptions, saveCompanyDeductionSetup } from '../../api/payrollProfilesApi';
import { setupLabel } from './setupLabels';

const schemes = ['EPF', 'ESI', 'PT'];
const message = e => e?.response?.data?.message || e?.message;
const ruleLabel = r => `${r.scheme} · ${r.establishment} · from ${r.effective_from}${r.effective_to ? ` to ${r.effective_to}` : ''}`;

export default function StatutoryScopeManager() {
  const { user } = useAuth(), client = useQueryClient();
  const allowed = user?.role === 'accounts';
  const [state, setState] = useState(''), [establishment, setEstablishment] = useState(''), [from, setFrom] = useState('');
  const [rules, setRules] = useState({}), [evidence, setEvidence] = useState('');
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [rulePage, setRulePage] = useState(1);
  const states = useQuery({ queryKey: ['statutory-states'], enabled: allowed, queryFn: async () => (await getStatutoryStates()).data.result });
  const setups = useQuery({ queryKey: ['company-deduction-setups', user?.id, search, page], enabled: allowed, queryFn: async () => (await getCompanyDeductionSetups({ search, page, limit: 20 })).data.result });
  const options = useQuery({ queryKey: ['company-deduction-options', user?.id, state, from, rulePage], enabled: allowed && !!state && !!from, queryFn: async () => (await getCompanyDeductionOptions({ state_id: state, date: from, page: rulePage, limit: 20 })).data.result });
  const save = useMutation({
    mutationFn: () => saveCompanyDeductionSetup({ state_id: state, establishment: establishment.trim(), effective_from: from, rules: Object.fromEntries(Object.entries(rules).map(([s, r]) => [s, r.id])), evidence_reference: evidence.trim() }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['company-deduction-setups'] });
      client.invalidateQueries({ queryKey: ['company-deduction-options'] });
      client.invalidateQueries({ queryKey: ['statutory-profile-scopes'] });
      setRules({}); setEstablishment(''); setEvidence('');
    }
  });
  const changeContext = fn => { fn(); setRules({}); setRulePage(1); save.reset(); };
  if (!allowed) return null;
  const busy = save.isPending;

  return (
    <div className="space-y-6">
      {/* Create / Configure Setup Card */}
      <section aria-label="Company deduction setup" className="glass-panel p-6 rounded-2xl border border-white/10 space-y-6 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-3 pb-4 border-b border-white/5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">Company deduction setup</h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                Scope Mapping
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Choose the establishment, state and published deduction rules once, then assign this setup to employees. Accounts maintains these settings.
            </p>
          </div>
        </div>

        <form className="space-y-5" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
          {/* Base Scope Selection Grid */}
          <div className="p-4 rounded-xl bg-slate-950/40 border border-white/5 space-y-3">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block">Scope Parameters</span>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <Input
                  label="Establishment"
                  list="deduction-establishments"
                  required
                  maxLength={120}
                  value={establishment}
                  disabled={busy}
                  onChange={e => { setEstablishment(e.target.value); save.reset(); }}
                  helperText="Choose an existing name or enter the company/unit name."
                />
                <datalist id="deduction-establishments">
                  {[...new Set((setups.data?.setups || []).map(s => s.establishment_name))].map(name => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <Select
                  label="State"
                  required
                  disabled={busy || states.isPending || states.isError}
                  value={state}
                  options={[{ value: '', label: 'Select state' }, ...(states.data || []).map(s => ({ value: s.id, label: s.name }))]}
                  onChange={e => changeContext(() => setState(e.target.value))}
                />
              </div>
              <div>
                <Input
                  label="Company setup applies from"
                  type="date"
                  required
                  value={from}
                  disabled={busy}
                  onChange={e => changeContext(() => setFrom(e.target.value))}
                />
              </div>
            </div>
          </div>

          {states.isPending && (
            <div role="status" className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              Loading states…
            </div>
          )}
          {states.isError && (
            <div role="alert" className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center justify-between">
              <span>{message(states.error)}</span>
              <Button size="sm" onClick={() => states.refetch()}>Retry states</Button>
            </div>
          )}

          {!state || !from ? (
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-slate-400 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Select a state and start date to see published deduction rules.</span>
            </div>
          ) : options.isPending ? (
            <div role="status" className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-xs text-slate-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              Loading deduction rules…
            </div>
          ) : options.isError ? (
            <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 flex items-center justify-between">
              <span>{message(options.error)}</span>
              <Button size="sm" onClick={() => options.refetch()}>Retry deduction rules</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {!options.data.total && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  No confirmed published rules cover this state and date. Create and publish the required deduction rules below, then return here.
                </div>
              )}

              {/* Scheme Deduction Rules 3-Column Grid */}
              <div className="grid md:grid-cols-3 gap-4">
                {schemes.map(s => {
                  const available = options.data.rules.filter(r => r.scheme === s);
                  if (rules[s] && !available.some(r => r.id === rules[s].id)) available.unshift(rules[s]);
                  return (
                    <div key={s} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono">{s} Scheme</span>
                        <span className="text-[10px] text-slate-500">{available.length} available</span>
                      </div>
                      <Select
                        label={`${s} deduction rule`}
                        value={rules[s]?.id || ''}
                        disabled={busy}
                        options={[{ value: '', label: 'Not included in this setup' }, ...available.map(r => ({ value: r.id, label: ruleLabel(r) }))]}
                        onChange={e => {
                          setRules(old => {
                            const next = { ...old };
                            const r = available.find(r => r.id === e.target.value);
                            if (r) next[s] = r; else delete next[s];
                            return next;
                          });
                          save.reset();
                        }}
                      />
                      {rules[s] && (
                        <details className="group rounded-xl border border-white/5 bg-slate-900/40 p-2.5">
                          <summary className="cursor-pointer text-xs font-semibold text-slate-400 group-open:text-slate-200 flex items-center justify-between select-none">
                            <span>View {s} rates</span>
                          </summary>
                          <dl className="text-xs space-y-1.5 pt-2 border-t border-white/5 mt-1">
                            {[
                              ['Employee rate (%)', 'employee_rate'],
                              ['Employer rate (%)', 'employer_rate'],
                              ['Wage ceiling (₹)', 'wage_ceiling'],
                              ['Eligibility ceiling (₹)', 'eligibility_ceiling']
                            ].map(([label, key]) => (
                              <div key={key} className="flex items-center justify-between text-slate-300">
                                <dt className="text-slate-400">{label}</dt>
                                <dd className="font-mono font-semibold text-amber-300">{rules[s].data?.configuration?.[key] ?? 'Not configured'}</dd>
                              </div>
                            ))}
                          </dl>
                          {s === 'PT' && (
                            <p className="text-[11px] text-slate-400 pt-1.5 border-t border-white/5 mt-1.5">
                              {rules[s].data?.slabs?.length || 0} published tax slabs. View the deduction rule below for slab details.
                            </p>
                          )}
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>

              <Pagination currentPage={rulePage} totalPages={Math.max(1, Math.ceil(options.data.total / 20))} onPageChange={setRulePage} />
              <p className="text-[11px] text-slate-400">
                Include each scheme needed by the employees who will use this setup. EPF/ESI enrolment still comes from Employee Management.
              </p>
            </div>
          )}

          <details className="group rounded-xl border border-white/5 bg-slate-900/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-400 group-open:text-slate-200 flex items-center justify-between select-none">
              Supporting details (optional)
            </summary>
            <div className="pt-3">
              <Input
                label="Company setup supporting reference"
                maxLength={2000}
                value={evidence}
                disabled={busy}
                onChange={e => setEvidence(e.target.value)}
                helperText="Document or approval reference. Accounts and the save time are recorded automatically."
              />
            </div>
          </details>

          <Button
            type="submit"
            variant="amber"
            disabled={busy || !state || !from || !establishment.trim() || !Object.keys(rules).length || options.isError || options.isPending}
            className="w-full sm:w-auto"
          >
            Save deduction setup
          </Button>

          {save.isError && (
            <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300">
              {message(save.error)}
            </div>
          )}
          {save.isSuccess && (
            <div role="status" className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>Company deduction setup saved. You can now assign it to employees.</span>
            </div>
          )}
        </form>
      </section>

      {/* Saved Setups Tabular Section */}
      <section className="glass-panel p-6 rounded-2xl border border-white/10 space-y-4 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <h3 className="font-bold text-base text-slate-100">Saved company setups</h3>
            <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 text-xs font-mono font-semibold">
              {setups.data?.total ?? 0} total
            </span>
          </div>
          <div className="w-full sm:w-72">
            <Input
              label="Find company deduction setup"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {setups.isPending ? (
          <div role="status" className="p-6 text-center text-xs text-slate-400">Loading company setups…</div>
        ) : setups.isError ? (
          <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center justify-between">
            <span>{message(setups.error)}</span>
            <Button size="sm" onClick={() => setups.refetch()}>Retry company setups</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-white/5 bg-slate-950/40">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableCell isHeader>Establishment</TableCell>
                    <TableCell isHeader>State</TableCell>
                    <TableCell isHeader>Effective Dates</TableCell>
                    <TableCell isHeader>Included Schemes</TableCell>
                    <TableCell isHeader>Setup Reference</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {setups.data?.setups?.map(s => (
                    <TableRow key={s.id} className="hover:bg-white/[0.02] transition-colors">
                      <TableCell>
                        <div className="font-semibold text-slate-100">{s.establishment_name}</div>
                      </TableCell>
                      <TableCell>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium font-mono">
                          {s.state_name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-slate-300">
                          {s.effective_from} to {s.effective_to || 'ongoing'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {schemes.map(k => s[`${k.toLowerCase()}_revision_id`] ? (
                            <span key={k} className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                              {k}
                            </span>
                          ) : null)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-slate-300 font-mono">{setupLabel(s)}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {schemes.filter(k => s[`${k.toLowerCase()}_revision_id`]).join(', ')}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!setups.data?.setups?.length && (
                <div className="p-8 text-center text-xs text-slate-400">
                  No company deduction setups found.
                </div>
              )}
            </div>

            <Pagination currentPage={page} totalPages={Math.max(1, Math.ceil(setups.data.total / 20))} onPageChange={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}
