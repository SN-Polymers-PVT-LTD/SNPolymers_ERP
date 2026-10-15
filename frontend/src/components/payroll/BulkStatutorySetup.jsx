import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Pagination, Table, TableHeader, TableBody, TableRow, TableCell } from '../ui';
import { getStatutorySetupCandidates, bulkRecordStatutoryProfiles } from '../../api/payrollProfilesApi';
import definitions from '../../../../shared/hrEmployeeCategories.json';
const schemes = ['EPF', 'ESI', 'PT'];
const blankSchemes = () => Object.fromEntries(schemes.map(s => [s, { statutory_scope_id: null, applicability: 'UNRESOLVED', enrolled: null }]));
const payManaged = e => ['office', 'permanent'].includes(definitions.find(d => d.category === e.employee_category)?.type) || e.employee_category === 'Projects Department Employees';
const message = e => e?.response?.data?.message || e?.message || 'Setup failed';

export default function BulkStatutorySetup({ user, scopeOptions, onUpdated }) {
  const client = useQueryClient();
  const [filters, setFilters] = useState({ search: '', department: '', employee_category: '', unconfigured_only: 'true' });
  const [page, setPage] = useState(1), [selected, setSelected] = useState([]), [results, setResults] = useState([]);
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [sharedScope, setSharedScope] = useState('');
  const [common, setCommon] = useState(blankSchemes), [evidence, setEvidence] = useState('');
  const [verification, setVerification] = useState('UNVERIFIED'), [owner, setOwner] = useState(''), [verifiedOn, setVerifiedOn] = useState(''), [ack, setAck] = useState(false);
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
  const save = useMutation({ mutationFn: () => bulkRecordStatutoryProfiles({
    employees: selected.map(e => ({ employee_id: e.id, expected_version: 0 })),
    interval: { effective_from: from, effective_to: to || null, verification_status: verification,
      advisor_name: verification === 'ACCOUNTS_CONFIRMED' ? owner.trim() : null,
      verification_reference: verification === 'ACCOUNTS_CONFIRMED' ? evidence.trim() : null,
      verified_on: verification === 'ACCOUNTS_CONFIRMED' ? verifiedOn : null,
      schemes: Object.fromEntries(schemes.map(s => [s, { ...common[s], applicability: needsScope(s) ? 'APPLICABLE' : 'NOT_APPLICABLE', enrolled: s === 'PT' || selected.some(payManaged) ? null : false, basis_reference: evidence.trim() }])) },
    evidence_reference: evidence.trim()
  }), onSuccess: r => {
    const rows = r.data.result.results; setResults(rows);
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
  const eligible = e => e.profile_version === 0 && e.employee_category !== 'Local Daily-Wage Workers' && (!to || e.joining_date <= to);
  const pageEligible = (candidates.data?.employees || []).filter(eligible);
  const needsScope = scheme => scheme === 'PT' ? selected.some(e => e.employee_category !== 'Local Daily-Wage Workers') : selected.some(e => payManaged(e) && e[scheme === 'EPF' ? 'epf_enrolment' : 'esi_enrolment'] !== false);
  const valid = from && (!to || to >= from) && evidence.trim() && selected.length > 0 && selected.length <= 100 && selected.every(eligible)
    && schemes.every(s => !needsScope(s) || common[s].statutory_scope_id)
    && (verification !== 'ACCOUNTS_CONFIRMED' || (owner.trim() && verifiedOn));
  const editScheme = (scheme, key, value) => { setCommon(old => ({ ...old, [scheme]: { ...old[scheme], [key]: value } })); setAck(false); setVerification('UNVERIFIED'); };
  return <section aria-label="Bulk statutory setup" className="glass-panel rounded-3xl border border-amber-500/20 p-5 sm:p-6 space-y-5">
    <div><h2 className="text-lg font-bold">Apply common statutory setup to a group</h2>
      <p className="text-xs text-slate-400 mt-2">Set shared employee facts once. Permanent/office EPF and ESI enrolment comes from Employee Management automatically. Rates and formulas stay in the deduction master. Existing profiles are protected; use the individual timeline below for exceptions and changes.</p></div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Input label="Bulk employee search" value={filters.search} disabled={busy} onChange={e => changeFilter('search', e.target.value)} />
      <Select label="Bulk department" value={filters.department} disabled={busy} options={[{ value: '', label: 'All departments' }, ...['SNP Factory', 'Fabric Factory', 'Head Office', 'Projects'].map(v => ({ value: v, label: v }))]} onChange={e => changeFilter('department', e.target.value)} />
      <Select label="Bulk employee category" value={filters.employee_category} disabled={busy} options={[{ value: '', label: 'All categories' }, ...[...definitions.map(d => d.category), 'Projects Department Employees'].map(v => ({ value: v, label: v }))]} onChange={e => changeFilter('employee_category', e.target.value)} />
      <Select label="Bulk profile filter" value={filters.unconfigured_only} disabled={busy} options={[{ value: 'true', label: 'Needs initial setup' }, { value: 'false', label: 'All active employees' }]} onChange={e => changeFilter('unconfigured_only', e.target.value)} />
    </div>
    {candidates.isPending ? <p role="status">Loading bulk setup employees…</p> : candidates.isError ? <div role="alert">{message(candidates.error)} <Button onClick={() => candidates.refetch()}>Retry bulk employees</Button></div> : <>
      <div className="flex flex-wrap items-center gap-3"><p className="text-sm">{selected.length} selected · {candidates.data.eligible_total} needing setup in this group</p><Button disabled={busy || !candidates.data.eligible_total} variant="secondary" onClick={() => selectGroup.mutate()}>Select all needing setup in this group</Button><Button disabled={busy || !selected.length} variant="ghost" onClick={() => { setSelected([]); setAck(false); }}>Clear bulk selection</Button></div>
      <Table><TableHeader><TableRow><TableCell isHeader><input type="checkbox" aria-label="Select eligible employees on this page" disabled={busy || !pageEligible.length} checked={pageEligible.length > 0 && pageEligible.every(e => selected.some(s => s.id === e.id))} onChange={e => { setSelected(old => e.target.checked ? [...old.filter(s => !pageEligible.some(p => p.id === s.id)), ...pageEligible] : old.filter(s => !pageEligible.some(p => p.id === s.id))); setAck(false); }} /></TableCell><TableCell isHeader>Employee</TableCell><TableCell isHeader>Category / department</TableCell><TableCell isHeader>Joined</TableCell><TableCell isHeader>Existing pay enrolment</TableCell><TableCell isHeader>Profile</TableCell></TableRow></TableHeader>
        <TableBody>{candidates.data.employees.map(e => <TableRow key={e.id}><TableCell><input type="checkbox" aria-label={`Bulk select ${e.employee_code}`} disabled={busy || (!eligible(e) && !selected.some(s => s.id === e.id))} checked={selected.some(s => s.id === e.id)} onChange={event => { setSelected(old => event.target.checked ? [...old, e] : old.filter(s => s.id !== e.id)); setAck(false); }} /></TableCell><TableCell>{e.employee_name}<div className="text-xs text-slate-400">{e.employee_code}</div></TableCell><TableCell>{e.employee_category}<div className="text-xs text-slate-400">{e.department}</div></TableCell><TableCell>{e.joining_date}</TableCell><TableCell>EPF: {e.epf_enrolment == null ? 'Not recorded' : e.epf_enrolment ? 'Enrolled' : 'Not enrolled'}<br />ESI: {e.esi_enrolment == null ? 'Not recorded' : e.esi_enrolment ? 'Enrolled' : 'Not enrolled'}</TableCell><TableCell>{e.employee_category === 'Local Daily-Wage Workers' ? 'No statutory setup required' : e.profile_version ? `Existing v${e.profile_version} — protected` : 'Needs setup'}</TableCell></TableRow>)}</TableBody></Table>
      {!candidates.data.employees.length && <p>No employees match this bulk setup filter.</p>}
      <Pagination currentPage={page} totalPages={Math.max(1, Math.ceil(candidates.data.total / 20))} onPageChange={setPage} />
    </>}
    <div className="grid sm:grid-cols-2 gap-4"><Input label="Common profile effective from" type="date" value={from} disabled={busy} onChange={e => { setFrom(e.target.value); setAck(false); setVerification('UNVERIFIED'); }} /><Input label="Common profile effective to (optional)" type="date" value={to} disabled={busy} onChange={e => { setTo(e.target.value); setAck(false); setVerification('UNVERIFIED'); }} /></div>
    <p className="text-xs text-slate-400">Select up to 100 employees per batch. Each new profile starts on the later of this date and the employee’s joining date. Existing timelines are never replaced.</p>
    <div className="flex flex-wrap items-end gap-3"><Select label="Shared statutory scope" value={sharedScope} disabled={busy} options={scopeOptions(sharedScope)} onChange={e => setSharedScope(e.target.value)} /><Button disabled={busy || !sharedScope} variant="secondary" onClick={() => { setCommon(old => Object.fromEntries(schemes.map(s => [s, { ...old[s], statutory_scope_id: sharedScope }]))); setAck(false); setVerification('UNVERIFIED'); }}>Use this scope for EPF, ESI and PT</Button></div>
    <div className="grid lg:grid-cols-3 gap-4">{schemes.map(s => <fieldset key={s} className="rounded-xl border border-white/10 p-4 space-y-3"><legend className="font-bold px-2">{s}</legend><p className="text-xs">{s === 'PT' ? 'Automatic: applicable to everyone except Local Daily-Wage Workers.' : 'Automatic: permanent/office Employee Management enrolment only. Casual/Local workers are excluded.'}</p>{needsScope(s) && <Select label={`Common ${s} scope`} value={common[s].statutory_scope_id || ''} disabled={busy} options={scopeOptions(common[s].statutory_scope_id)} onChange={e => editScheme(s, 'statutory_scope_id', e.target.value || null)} />}</fieldset>)}</div>
    <Input label="Common setup evidence reference" value={evidence} maxLength={2000} disabled={busy} helperText="Used as the shared basis for each scheme and the profile audit reference." onChange={e => { setEvidence(e.target.value); setAck(false); setVerification('UNVERIFIED'); }} />
    <Select label="Common setup confirmation" value={verification} disabled={busy} options={[{ value: 'UNVERIFIED', label: 'Unverified' }, { value: 'ACCOUNTS_CONFIRMED', label: 'Accounts confirmed' }]} onChange={e => { setVerification(e.target.value); setAck(false); }} />
    {verification === 'ACCOUNTS_CONFIRMED' && <div className="grid sm:grid-cols-2 gap-4"><Input label="Common setup confirmed by" value={owner} disabled={busy} maxLength={120} onChange={e => { setOwner(e.target.value); setAck(false); }} /><Input label="Common setup confirmed on" type="date" value={verifiedOn} disabled={busy} onChange={e => { setVerifiedOn(e.target.value); setAck(false); }} /></div>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} />I checked that these common facts apply to every selected employee; individual exceptions are excluded.</label>
    <Button variant="amber" loading={save.isPending} disabled={busy || !valid || !ack} onClick={() => save.mutate()}>Apply common setup to selected employees</Button>
    {(save.error || selectGroup.error) && <p role="alert" className="text-red-400">{message(save.error || selectGroup.error)}</p>}
    {!!results.length && <ul aria-label="Bulk statutory setup results" className="text-xs space-y-2">{results.map(r => <li key={r.employee_id}>{r.employee_id}: {r.success ? `Profile created from ${r.effective_from}` : `Not applied (${r.status}) — ${r.message}`}</li>)}</ul>}
  </section>;
}
