import StatutoryScopeManager from '../../components/payroll/StatutoryScopeManager';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input, Select, Modal, Pagination, Badge } from '../../components/ui';
import {
  listPayrollMasters,
  savePayrollMaster,
  previewPayrollPublication,
  publishPayrollMaster,
  resolvePayrollMaster
} from '../../api/payrollMastersApi';
import { PolicyFields, StatutoryFields, Choice } from './PayrollMasterFields';

const unresolved = () => ({ method: 'UNRESOLVED', precision: null, stage: 'UNRESOLVED' });
const defaults = kind => kind === 'policies' ? {
  group_code: null,
  effective_from: '',
  effective_to: '',
  reason: '',
  monthly_entitlement_method: 'CONTRACTUAL_MONTHLY_GROSS',
  lop_method: 'FIXED_DIVISOR',
  lop_fixed_divisor: '30',
  partial_month_proration_method: 'UNRESOLVED',
  partial_month_fixed_divisor: null,
  split_period_allocation_method: 'UNRESOLVED',
  full_month_unpaid_treatment: 'UNRESOLVED',
  leave_weekly_off_method: 'UNRESOLVED',
  monetary_rounding_method: 'UNRESOLVED',
  sandwich_enabled: false,
  work_calendar_reference: null,
  rounding: { lop: unresolved(), proration: unresolved(), allocation: unresolved() }
} : {
  scheme: 'EPF',
  jurisdiction: '',
  establishment: '',
  effective_from: '',
  effective_to: null,
  reason: '',
  verification_status: 'UNVERIFIED',
  advisor_name: null,
  verification_reference: null,
  verified_on: null,
  slabs: [],
  configuration: {
    adjustment_basis: { SALARY_ARREARS: 'UNRESOLVED', BONUS: 'UNRESOLVED', REIMBURSEMENT: 'UNRESOLVED', RECOVERY: 'UNRESOLVED' },
    employee_rate: null,
    employer_rate: null,
    included_components: [],
    excluded_components: ['BASIC', 'STAFF_WELFARE', 'OTHER_FIXED', 'PACKAGE_BALANCE', 'DAILY_WAGE', 'OVERTIME', 'HOLIDAY_PREMIUM', 'ADJUSTMENTS'],
    eligibility: 'UNRESOLVED',
    eligibility_ceiling: null,
    wage_ceiling: null,
    contribution_minimum: null,
    contribution_cap: null,
    calculation_method: 'UNRESOLVED',
    rounding: unresolved(),
    aggregation: 'CALENDAR_MONTH',
    effective_rule: 'MONTH_START',
    conditions: 'UNRESOLVED'
  }
};

const message = e => e?.response?.data?.issues?.map(i => `${i.path?.join('.') || 'Configuration'}: ${i.message}`).join(' • ') || e?.response?.data?.message || e.message;
const json = value => JSON.stringify(value, null, 2);

export default function PayrollMasters({ kind = 'policies' }) {
  const { user } = useAuth();
  const client = useQueryClient();

  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(null);
  const [approval, setApproval] = useState('');
  const [ack, setAck] = useState(false);
  const [success, setSuccess] = useState('');
  const [lookup, setLookup] = useState({ date: '', group_code: 'HO_STAFF', scheme: 'EPF', jurisdiction: '', establishment: '' });

  const canWrite = user?.role === 'admin' || (kind === 'statutory' && user?.role === 'accounts');
  const query = useQuery({
    queryKey: ['payroll-masters', kind, page],
    enabled: canWrite,
    queryFn: async () => (await listPayrollMasters(kind, { page, limit: 20 })).data.result
  });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['payroll-masters'] });
    client.invalidateQueries({ queryKey: ['payroll-master-resolve'] });
  };

  const save = useMutation({
    mutationFn: body => savePayrollMaster(kind, body),
    onSuccess: () => {
      setEditor(null);
      refresh();
      setSuccess('Draft saved. Publication is required before diagnostic calculations use it.');
    }
  });

  const inspect = useMutation({
    mutationFn: id => previewPayrollPublication(kind, id),
    onSuccess: r => {
      setPreview(r.data.result);
      setApproval('');
      setAck(false);
    }
  });

  const publish = useMutation({
    mutationFn: () => publishPayrollMaster(kind, preview.revision.id, {
      expected_version: preview.revision.version,
      preview_token: preview.preview_token,
      approval_reference: approval
    }),
    onSuccess: () => {
      setPreview(null);
      refresh();
      setSuccess('Revision published. Historical rule values are preserved; financial workflows remain disabled.');
    }
  });

  const resolve = useMutation({
    mutationFn: () => resolvePayrollMaster(kind, kind === 'policies'
      ? { date: lookup.date, group_code: lookup.group_code }
      : { date: lookup.date, scheme: lookup.scheme, jurisdiction: lookup.jurisdiction, establishment: lookup.establishment })
  });

  const updateDraft = data => {
    const financial = value => JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !['reason', 'verification_status', 'advisor_name', 'verification_reference', 'verified_on'].includes(key))));
    if (kind === 'statutory' && financial(editor.data) !== financial(data)) {
      data = { ...data, verification_status: 'UNVERIFIED', advisor_name: null, verification_reference: null, verified_on: null };
    }
    setEditor({ ...editor, data });
  };

  const title = kind === 'policies' ? 'Payroll Policy Master' : 'Statutory Deduction Master';

  if (!canWrite) {
    return (
      <div className="p-6">
        <p role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300">
          Current Admin access is required.
        </p>
      </div>
    );
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  return (
    <div className="space-y-8 text-slate-200 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header Section */}
      <header className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">Admin / Payroll Management</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">{title}</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              {kind === 'policies'
                ? 'Manage LOP, prorations, monetary roundings, and canonical attendance calendars.'
                : 'Configure statutory deduction masters, contribution ceilings, slabs, and evidence-verified scopes.'}
            </p>
          </div>
          <Button
            variant="amber"
            onClick={() => {
              save.reset();
              setEditor({ id: null, expected_version: 0, data: defaults(kind) });
              setSuccess('');
            }}
          >
            Create draft
          </Button>
        </div>

        {/* In-Page Navigation Tabs */}
        <nav className="flex gap-6 border-b border-white/5 my-3">
          {user?.role === 'admin' && (
            <Link
              to="/admin/payroll/policies"
              className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
                kind === 'policies' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Payroll Policy Master
            </Link>
          )}
          <Link
            to="/admin/employee-management?tab=payroll-setup"
            className="pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-all duration-200"
          >
            Employee Payroll Setup
          </Link>
          <Link
            to="/admin/payroll/statutory"
            className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
              kind === 'statutory' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Statutory Deduction Master
          </Link>
        </nav>
      </header>

      {kind==='statutory' && <StatutoryScopeManager/>}

      {/* Top Stats Overview Card */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-gradient-to-r from-white/[0.02] to-amber-500/[0.02] flex justify-around items-center text-center divide-x divide-white/5">
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Total Revisions</span>
          <span className="text-2xl font-black text-slate-100 font-mono">{query.data?.total ?? '—'}</span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 block mb-1">Draft Revisions</span>
          <span className="text-2xl font-black text-amber-400 font-mono">
            {query.data?.revisions ? query.data.revisions.filter(r => r.status === 'DRAFT').length : '—'}
          </span>
        </div>
        <div className="flex-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400 block mb-1">Published Revisions</span>
          <span className="text-2xl font-black text-emerald-300 font-mono">
            {query.data?.revisions ? query.data.revisions.filter(r => r.status === 'PUBLISHED').length : '—'}
          </span>
        </div>
      </div>

      {/* Policy & Diagnostic Notice Card */}
      <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs space-y-1">
        <p className="text-amber-400 font-medium">
          {kind === 'policies'
            ? 'Fixed 30 is the currently approved permanent LOP business method. A draft or this label is not a published database revision. Select approved joining/leaving, split-run and no-payable-entitlement rules explicitly.'
            : 'Rates are not seeded. Accounts confirms configured rules with recorded setup evidence. Employer contributions remain separate from employee deductions.'}
        </p>
        <p className="text-slate-400">
          Published masters feed salary diagnostics. Financial locking, withholding and payment remain disabled. Casual/Local wages continue to use their factory masters.
        </p>
      </div>

      {/* Status & Error Feedback */}
      {success && (
        <div role="status" className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          {success}
        </div>
      )}
      {[save.error, inspect.error, publish.error].filter(Boolean).map((e, i) => (
        <div key={i} role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {message(e)}
        </div>
      ))}

      {/* Revisions Workspace */}
      {query.isPending ? (
        <p role="status" className="text-xs text-slate-400 py-6 text-center">Loading revisions…</p>
      ) : query.isError ? (
        <div role="alert" className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 flex items-center justify-between">
          <span>{message(query.error)}</span>
          <Button size="sm" variant="secondary" onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {!query.data.revisions.length && (
            <div className="glass-panel p-8 rounded-3xl border border-white/5 text-center text-xs text-slate-500 uppercase tracking-widest font-extrabold">
              No master revisions. Create an evidenced draft; nothing is published automatically.
            </div>
          )}

          {['DRAFT', 'PUBLISHED'].map(status => {
            const revs = query.data.revisions.filter(r => r.status === status);
            return (
              <section key={status} className="glass-panel p-6 rounded-3xl border border-white/5 space-y-4 shadow-xl">
                <div className="flex items-center gap-2 text-amber-500">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <h2 className="font-bold text-xs uppercase tracking-widest text-slate-200">
                    {status === 'DRAFT' ? 'Draft revisions' : 'Published revision history'}
                  </h2>
                </div>

                <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/[0.02] border-b border-white/10 text-[10px] uppercase font-extrabold tracking-wider text-slate-400">
                        <tr>
                          <th className="px-4 py-3.5">Scope</th>
                          <th className="px-4 py-3.5">Status / revision</th>
                          <th className="px-4 py-3.5">Effective dates</th>
                          <th className="px-4 py-3.5">Rules / verification</th>
                          <th className="px-4 py-3.5">Publisher / date</th>
                          <th className="px-4 py-3.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {revs.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-slate-500 italic">
                              No {status.toLowerCase()} revisions recorded.
                            </td>
                          </tr>
                        ) : (
                          revs.map(r => (
                            <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                              <td className="px-4 py-3.5 font-medium text-slate-200">
                                {r.group_code || (kind === 'policies' ? 'Global default' : `${r.scheme} / ${r.jurisdiction} / ${r.establishment}`)}
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-2">
                                  <Badge variant={r.status === 'PUBLISHED' ? 'emerald' : 'amber'}>{r.status}</Badge>
                                  <span className="font-mono text-xs text-slate-300">{r.revision_number || `Draft v${r.version}`}</span>
                                  {r.status === 'PUBLISHED' && (
                                    <span className="text-[10px] font-bold text-slate-500">
                                      ({r.effective_from > today ? 'Future' : r.effective_to < today ? 'Historical' : 'Current published'})
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3.5 font-mono text-slate-300">
                                {r.effective_from} – {r.effective_to || 'ongoing'}
                              </td>
                              <td className="px-4 py-3.5 text-slate-300">
                                {kind === 'policies' ? `${r.lop_method} ${r.lop_fixed_divisor ?? ''}` : r.verification_status}
                              </td>
                              <td className="px-4 py-3.5 text-slate-400 text-[11px]">
                                <span className="font-medium text-slate-300">{r.published_by || 'Unpublished'}</span>
                                {r.published_at && <span className="block text-slate-500 font-mono mt-0.5">{r.published_at}</span>}
                              </td>
                              <td className="px-4 py-3.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <Button size="sm" variant="secondary" onClick={() => setSelected(r)}>History / details</Button>
                                  {r.status === 'DRAFT' && (
                                    <>
                                      <Button size="sm" onClick={() => { save.reset(); setEditor({ id: r.id, expected_version: r.version, data: structuredClone(r.data) }); }}>Edit draft</Button>
                                      <Button size="sm" variant="amber" loading={inspect.isPending} onClick={() => { publish.reset(); inspect.mutate(r.id); }}>Review publication</Button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            );
          })}

          <Pagination currentPage={page} totalPages={Math.max(1, Math.ceil(query.data.total / 20))} onPageChange={setPage} />
        </div>
      )}

      {/* Historical Revision Resolver Container */}
      <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-4 shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h2 className="font-bold text-xs uppercase tracking-widest text-slate-200">Resolve published historical revision</h2>
        </div>

        <form className="space-y-4" onSubmit={e => { e.preventDefault(); resolve.mutate(); }}>
          <div className="grid sm:grid-cols-3 gap-4">
            <Input label="Resolution date" type="date" required value={lookup.date} onChange={e => setLookup({ ...lookup, date: e.target.value })} />
            {kind === 'policies' ? (
              <Select label="Resolution group" value={lookup.group_code} options={(query.data?.groups || []).map(g => ({ value: g.code, label: g.code }))} onChange={e => setLookup({ ...lookup, group_code: e.target.value })} />
            ) : (
              <>
                <Choice label="Resolution scheme" value={lookup.scheme} values={['EPF', 'ESI', 'PT']} onChange={scheme => setLookup({ ...lookup, scheme })} />
                <Input label="Resolution jurisdiction" required value={lookup.jurisdiction} onChange={e => setLookup({ ...lookup, jurisdiction: e.target.value })} />
                <Input label="Resolution establishment" required value={lookup.establishment} onChange={e => setLookup({ ...lookup, establishment: e.target.value })} />
              </>
            )}
          </div>
          <Button type="submit" variant="primary" loading={resolve.isPending}>Resolve revision</Button>
        </form>

        {resolve.error && <p role="alert" className="text-red-400 text-xs">{message(resolve.error)}</p>}
        {resolve.data && (
          <div className="p-4 rounded-xl border border-white/5 bg-slate-950/60 overflow-x-auto">
            <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">{json(resolve.data.data.result)}</pre>
          </div>
        )}
      </div>

      {/* Edit Draft Revision Modal */}
      {editor && (
        <Modal title="Edit draft revision" size="xl" onClose={() => !save.isPending && setEditor(null)} closeDisabled={save.isPending}>
          <form onSubmit={e => { e.preventDefault(); save.mutate(editor); }} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Effective from" type="date" required value={editor.data.effective_from} onChange={e => updateDraft({ ...editor.data, effective_from: e.target.value })} />
              <Input label="Effective to" type="date" required={kind === 'policies'} value={editor.data.effective_to || ''} onChange={e => updateDraft({ ...editor.data, effective_to: e.target.value || (kind === 'statutory' ? null : '') })} />
              {kind === 'policies' ? (
                <PolicyFields data={editor.data} setData={updateDraft} groups={query.data?.groups || []} />
              ) : (
                <StatutoryFields data={editor.data} setData={updateDraft} />
              )}
              <Input label="Change reason" required maxLength={2000} value={editor.data.reason} onChange={e => setEditor({ ...editor, data: { ...editor.data, reason: e.target.value } })} />
            </div>
            {save.error && <p role="alert" className="text-red-400 text-xs">{message(save.error)}</p>}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
              <Button type="submit" variant="amber" loading={save.isPending}>Save draft</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirm Master Publication Modal */}
      {preview && (
        <Modal title="Confirm master publication" size="xl" onClose={() => !publish.isPending && setPreview(null)} closeDisabled={publish.isPending}>
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
              Future month start required. Published values remain immutable. An overlapping predecessor’s future applicability ends the day before this revision; historical dates remain unchanged.
            </div>
            <p className="text-slate-300">
              Affected draft rows: <span className="font-mono font-bold text-amber-400">{preview.affected_draft_rows}</span>. {kind === 'statutory' ? 'This includes every draft in the date range; employee jurisdiction mapping is required before calculation.' : 'Counted for the policy group and date range.'}
            </p>

            <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-200 pt-2">Configuration changes</h3>
            <div className="glass-panel rounded-xl border border-white/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.02] border-b border-white/10 text-[10px] uppercase font-extrabold text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Before</th>
                      <th className="px-3 py-2">After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {preview.diff.map(d => (
                      <tr key={d.field}>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-300">{d.field}</td>
                        <td className="px-3 py-2"><pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-400">{json(d.before)}</pre></td>
                        <td className="px-3 py-2"><pre className="whitespace-pre-wrap font-mono text-[11px] text-amber-300">{json(d.after)}</pre></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <h3 className="font-extrabold text-sm uppercase tracking-wider text-amber-400 pt-2">Configuration warnings</h3>
            <pre className="p-3 rounded-xl border border-white/5 bg-slate-950/60 overflow-x-auto text-amber-300 text-xs font-mono whitespace-pre-wrap">{json(preview.configuration_warnings || [])}</pre>

            <h3 className="font-extrabold text-sm uppercase tracking-wider text-amber-400 pt-2">Publication blockers</h3>
            <pre className="p-3 rounded-xl border border-white/5 bg-slate-950/60 overflow-x-auto text-amber-300 text-xs font-mono whitespace-pre-wrap">{json(preview.blockers)}</pre>
            <p className="text-slate-400">Required unresolved rules block the affected employee scenario after publication. Statutory revisions cannot publish with blockers.</p>

            <h3 className="font-extrabold text-sm uppercase tracking-wider text-red-400 pt-2">Effective-date conflicts</h3>
            <pre className="p-3 rounded-xl border border-white/5 bg-slate-950/60 overflow-x-auto text-red-300 text-xs font-mono whitespace-pre-wrap">{json(preview.conflicts)}</pre>

            <div className="pt-3 border-t border-white/5 space-y-3">
              <Input label="Supporting approval reference" required value={approval} onChange={e => setApproval(e.target.value)} />
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 font-medium">
                <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="rounded border-slate-700 text-amber-500 focus:ring-amber-500" />
                <span>I reviewed the rules, scope, dates and impact. Previously locked payroll will not change.</span>
              </label>
            </div>

            {publish.error && <p role="alert" className="text-red-400 text-xs">{message(publish.error)}</p>}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
              <Button disabled={!preview.publishable || !approval.trim() || !ack} loading={publish.isPending} variant="amber" onClick={() => publish.mutate()}>
                Publish revision
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Revision History & Details Modal */}
      {selected && (
        <Modal title="Revision history and audit" size="xl" onClose={() => setSelected(null)}>
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl border border-white/5 bg-slate-950/60 overflow-x-auto">
              <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">{json(selected)}</pre>
            </div>
            <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-200">Audit events</h3>
            <div className="p-4 rounded-xl border border-white/5 bg-slate-950/60 overflow-x-auto">
              <pre className="text-xs font-mono text-slate-400 whitespace-pre-wrap">
                {json((query.data?.events || []).filter(e => e.policy_revision_id === selected.id || e.statutory_revision_id === selected.id))}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
