import React, { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input } from '../../components/ui';
import { formatIndianCurrency, groupProfessionalTaxSchedules } from '../../components/payroll/professionalTaxSchedules';
import StatutoryStateField from '../../components/payroll/StatutoryStateField';
import { newStatutoryConfiguration, statutoryDraftInput } from '../../components/payroll/statutoryPresets';
import {
  getCompanyDeductionSetups, getGuidedDeductionDraft, listGuidedDeductionDrafts,
  saveGuidedDeductionDraft, reviewGuidedDeductionDraft, publishGuidedDeductionDraft,
} from '../../api/payrollProfilesApi';
import PayrollMasters from './PayrollMasters';
import { StatutoryFields } from './PayrollMasterFields';

const names = { EPF: 'EPF', ESI: 'ESI', PT: 'Professional Tax' };
const steps = ['Company', 'Deduction rules', 'Review & publish'];
const assignment = '/admin/employee-management?tab=payroll-setup';
const panel = 'glass-panel rounded-2xl border border-slate-200/70 dark:border-white/10 p-5 sm:p-6';
const blank = () => ({ establishment: '', state_id: null, jurisdiction: '', effective_from: '', rules: {} });
const response = request => request.then(({ data }) => data.result);
const problem = error => error?.response?.data?.message || error?.message;
const displayDate = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : 'Ongoing';
const issueLabels = {
  INITIAL_SETUP_LOCKED_PAYROLL: 'Locked payroll overlaps this period. Choose a different start date.',
  INITIAL_SETUP_ALREADY_PUBLISHED: 'An existing published rule prevents historical initial setup.',
  FUTURE_MONTH_START_REQUIRED: 'Choose the first day of a future month, or request historical initial setup.',
  RULE_NOT_PUBLISHABLE: 'Review the rule settings and dates.',
  MISSING_WAGE_BASIS: 'Choose the salary amount used for deductions.',
};
const issueText = issue => {
  if (typeof issue === 'string') {
    if (/^[a-f0-9-]{36}$/i.test(issue)) return 'A published rule already covers part of this date range.';
    return issueLabels[issue] || issue.replaceAll('_', ' ');
  }
  return issue.message || issueLabels[issue.code] || String(issue.field || issue.code || 'Check the rule configuration.').replaceAll('_', ' ');
};
const earningsLabels = {
  PACKAGE_BALANCE: 'Monthly gross salary',
  DAILY_WAGE: 'Daily wage earnings',
  OVERTIME: 'Overtime',
  HOLIDAY_PREMIUM: 'Holiday premium',
  ADJUSTMENTS: 'Adjustments',
};
const currency = value => value == null || value === '' ? 'Not entered' : `₹${formatIndianCurrency(value)}`;

function TaxSchedules({ slabs }) {
  if (!slabs.length) return <p className="text-sm">No tax ranges entered.</p>;
  return <details>
    <summary className="cursor-pointer text-sm font-semibold">View salary ranges and monthly tax</summary>
    {groupProfessionalTaxSchedules(slabs).map(({ months, rows }) => <div key={months[0]} className="mt-3">
      <h4 className="text-sm font-semibold">{months.length === 12 ? 'Every month' : months.join(', ')}</h4>
      <table className="mt-1 w-full text-left text-sm">
        <thead><tr><th scope="col">Monthly earnings</th><th scope="col">Tax</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-slate-200 dark:border-white/10">
          <td className="py-1">{currency(row.lower_bound)}{row.upper_bound === null ? ' and above' : ` to under ${currency(row.upper_bound)}`}</td>
          <td>{currency(row.deduction_amount)}</td>
        </tr>)}</tbody>
      </table>
    </div>)}
  </details>;
}

function RuleSummary({ rule }) {
  const c = rule.configuration;
  return <>
    {rule.scheme === 'PT' ? <TaxSchedules slabs={rule.slabs} /> : <>
      <p className="text-sm">Employee {c.employee_rate ?? '—'}% · Employer {c.employer_rate ?? '—'}%</p>
      <p className="text-sm">{rule.scheme === 'EPF' ? 'Contribution wage cap' : 'Eligibility threshold'} {currency(rule.scheme === 'EPF' ? c.wage_ceiling : c.eligibility_ceiling)}</p>
    </>}
    <p className="text-sm">Earnings used · {c.included_components.map(component => earningsLabels[component]).join(', ') || 'Choose earnings'}</p>
    <p className="text-xs text-slate-600 dark:text-slate-300">{displayDate(rule.effective_from)} → {displayDate(rule.effective_to)}</p>
  </>;
}

function PublishedSetup({ setup, onExit }) {
  return <section className={panel}>
    <p role="status" className="font-semibold text-emerald-700 dark:text-emerald-400">Company deductions are ready.</p>
    <h2 className="mt-2 text-xl font-bold">{setup.establishment_name}</h2>
    <p className="mt-1">{displayDate(setup.effective_from)} → {displayDate(setup.effective_to)}</p>
    <div className="mt-5 flex flex-wrap gap-3">
      <Link className="inline-flex items-center rounded-xl bg-yellow-500 px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-950 shadow-md shadow-yellow-500/20 hover:bg-yellow-400" to={assignment}>Assign to employees</Link>
      <Button variant="glass" onClick={onExit}>Back to company deductions</Button>
    </div>
  </section>;
}

function GuidedEditor({ initial, onExit, onSave, userId }) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(() => initial ? {
    ...initial.data,
    jurisdiction: initial.data.jurisdiction || Object.values(initial.data.rules)[0]?.jurisdiction || '',
    rules: Object.fromEntries(Object.entries(initial.data.rules).map(([scheme, rule]) => [
      scheme, { ...rule, effective_from: rule.effective_from === initial.data.effective_from ? '' : rule.effective_from },
    ])),
  } : blank());
  const [step, setStep] = useState(initial?.data && Object.keys(initial.data.rules).length ? 1 : 0);
  const [active, setActive] = useState(initial ? Object.keys(initial.data.rules)[0] || 'EPF' : 'EPF');
  const [checked, setChecked] = useState(null);
  const [historical, setHistorical] = useState(Boolean(initial?.data.initial_setup));
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [published, setPublished] = useState(null);
  const [error, setError] = useState('');
  const retry = useRef(null);
  const [dirty, setDirty] = useState(!initial);
  const set = next => { setForm(next); setDirty(true); setChecked(null); setError(''); };
  const changeStep = next => { setStep(next); setError(''); };
  const save = useMutation({ mutationFn: data => response(saveGuidedDeductionDraft({ id: saved?.id ?? null, expected_version: saved?.version ?? 0, data })) });
  const review = useMutation({ mutationFn: draft => response(reviewGuidedDeductionDraft(draft.id, { expected_version: draft.version, initial_setup: historical })) });
  const publish = useMutation({ mutationFn: body => response(publishGuidedDeductionDraft(saved.id, body)) });
  const busy = save.isPending || review.isPending || publish.isPending;
  const companyReady = Boolean(form.establishment.trim() && form.state_id && form.jurisdiction && form.effective_from);
  const selected = Object.keys(names).filter(scheme => form.rules[scheme]);
  const missingInputs = selected.filter(scheme => {
    const rule = form.rules[scheme];
    return !rule.reason.trim() || !rule.configuration.included_components.length;
  });
  const selectedRule = form.rules[active];
  const reviewReady = checked?.publishable && checked.review_token;
  const refreshDrafts = () => client.invalidateQueries({ queryKey: ['guided-deduction-drafts'] });
  const scope = scheme => ({ scheme, establishment: form.establishment.trim(), state_id: form.state_id, jurisdiction: form.jurisdiction });
  const ruleFor = scheme => {
    const rule = form.rules[scheme];
    return { ...rule, ...scope(scheme), effective_from: rule.effective_from || form.effective_from };
  };
  const toggleRule = () => {
    const rules = { ...form.rules };
    if (selectedRule) delete rules[active];
    else rules[active] = { ...scope(active), effective_from: '', effective_to: null, reason: '', slabs: [], configuration: newStatutoryConfiguration(active) };
    set({ ...form, rules });
  };
  const editRule = rule => set({ ...form, rules: { ...form.rules, [active]: rule } });
  const saveDraft = async () => {
    if (saved && !dirty) return saved;
    const rules = Object.fromEntries(selected.map(scheme => [scheme, statutoryDraftInput(ruleFor(scheme))]));
    const next = await save.mutateAsync({ establishment: form.establishment.trim(), state_id: form.state_id, effective_from: form.effective_from, jurisdiction: form.jurisdiction, initial_setup: historical, rules });
    client.setQueryData(['guided-deduction-draft', userId, next.id], next);
    setSaved(next);
    setDirty(false);
    refreshDrafts();
    onSave(next);
    return next;
  };
  const runReview = async () => {
    setError(''); setChecked(null); setConfirmed(false);
    if (missingInputs.length) {
      setActive(missingInputs[0]);
      changeStep(1);
      setError(`Choose which earnings count and enter a change reason for ${missingInputs.map(scheme => names[scheme]).join(', ')}.`);
      return;
    }
    try {
      const draft = await saveDraft();
      const result = await review.mutateAsync(draft);
      setChecked(result);
      setStep(2);
    } catch (e) { setError(problem(e)); }
  };
  const submit = async () => {
    const body = { expected_version: saved.version, initial_setup: historical, review_token: checked.review_token, approval_reference: reference.trim() };
    const signature = JSON.stringify(body);
    if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    setError('');
    try {
      const result = await publish.mutateAsync({ ...body, idempotency_key: retry.current.key });
      setPublished(result.setup);
      refreshDrafts();
      for (const key of ['company-deduction-setups', 'company-deduction-options', 'payroll-masters', 'statutory-profile-scopes']) client.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      if (e.response?.status === 409) { setChecked(null); setConfirmed(false); }
      setError(problem(e));
    }
  };

  if (published) return <PublishedSetup setup={published} onExit={onExit} />;

  return <div className="space-y-5">
    <nav aria-label="Setup steps" className="grid gap-2 sm:grid-cols-3">
      {steps.map((name, index) => <button type="button" key={name} aria-current={step === index ? 'step' : undefined} disabled={busy || index >= step} onClick={() => changeStep(index)} className={`rounded-xl border p-3 text-left font-semibold ${index === step ? 'border-yellow-500 bg-yellow-500/10' : 'border-slate-200 dark:border-white/10'}`}>{name}</button>)}
    </nav>
    <fieldset disabled={busy} className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <section className={`${panel} space-y-4`}>
        <h2 className="text-xl font-bold">{steps[step]}</h2>
        {step === 0 && <>
          <Input label="Establishment" required maxLength={120} value={form.establishment} onChange={e => set({ ...form, establishment: e.target.value })} />
          <StatutoryStateField data={form} onChange={set} />
          <Input label="Setup start date" type="date" required value={form.effective_from} onChange={e => set({ ...form, effective_from: e.target.value })} />
        </>}
        {step === 1 && <>
          <div className="grid gap-2 sm:grid-cols-3" aria-label="Deduction rules">
            {Object.entries(names).map(([scheme, name]) => {
              const rule = form.rules[scheme];
              const ready = rule?.reason.trim() && rule.configuration.included_components.length &&
                (scheme === 'PT' ? rule.slabs.length : rule.configuration.employee_rate !== null && rule.configuration.employer_rate !== null && (scheme === 'EPF' ? rule.configuration.wage_ceiling : rule.configuration.eligibility_ceiling) !== null);
              return <button type="button" key={scheme} aria-pressed={scheme === active} onClick={() => setActive(scheme)} className={`rounded-xl border p-3 text-left ${scheme === active ? 'border-yellow-500 bg-yellow-500/10' : 'border-slate-200 dark:border-white/10'}`}>
                <span className="block font-semibold">{name}</span><span className="text-xs">{rule ? ready ? 'Ready for review' : 'Needs input' : 'Excluded'}</span>
              </button>;
            })}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!selectedRule} onChange={toggleRule} /> Include {names[active]}</label>
          {selectedRule && <>
            <details className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <summary className="cursor-pointer font-semibold">Effective dates</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Input label="Rule start date override" type="date" value={selectedRule.effective_from} placeholder={form.effective_from} helperText={`Defaults to ${displayDate(form.effective_from)}.`} onChange={e => editRule({ ...selectedRule, effective_from: e.target.value })} />
                <Input label="Rule end date" type="date" value={selectedRule.effective_to || ''} helperText="Leave blank for ongoing." onChange={e => editRule({ ...selectedRule, effective_to: e.target.value || null })} />
              </div>
            </details>
            <div className="grid gap-4 sm:grid-cols-2"><StatutoryFields key={active} guided data={ruleFor(active)} setData={rule => editRule({ ...rule, effective_from: selectedRule.effective_from })} /></div>
            <Input label="Change reason" required maxLength={2000} value={selectedRule.reason} onChange={e => editRule({ ...selectedRule, reason: e.target.value })} />
          </>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={historical} onChange={e => { setHistorical(e.target.checked); setDirty(true); setChecked(null); }} /> First setup for a past period</label>
        </>}
        {step === 2 && <>
          <p role="status" className="font-semibold">{reviewReady ? 'Ready to publish' : checked ? 'Some settings need attention' : 'Review again before publishing'}</p>
          {(checked?.blockers || []).filter(issue => !issue.scheme).map((issue, i) => <p role="alert" key={i}>{issueText(issue)}</p>)}
          {selected.map(scheme => {
            const result = checked?.rules?.[scheme];
            const issues = [...(checked?.blockers || []).filter(issue => issue.scheme === scheme), ...(result?.blockers || []), ...(result?.conflicts || [])];
            return <div key={scheme} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{names[scheme]}</h3><Button variant="glass" size="sm" onClick={() => { setActive(scheme); changeStep(1); }}>Edit {names[scheme]}</Button></div>
              <RuleSummary rule={ruleFor(scheme)} />
              {issues.map((issue, index) => <p role="alert" key={index} className="text-sm text-red-700 dark:text-red-300">{issueText(issue)}</p>)}
              {(result?.configuration_warnings || []).map((issue, index) => <p key={index} className="text-sm text-amber-800 dark:text-amber-300">{issueText(issue)}</p>)}
            </div>;
          })}
          {reviewReady && !form.rules.PT && <p className="rounded-xl border border-amber-500/40 p-3 text-sm text-amber-800 dark:text-amber-300">Add a Professional Tax rule before assigning this setup to anyone other than local daily-wage workers.</p>}
          {reviewReady && <>
            <Input label="Approval reference" helperText="Enter the document or internal reference confirming these rules." required maxLength={2000} value={reference} onChange={e => setReference(e.target.value)} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I checked the rates, dates and applicable salary basis.</label>
          </>}
        </>}
      </section>
      <aside className={`${panel} h-fit space-y-3`}>
        <h2 className="font-bold">Setup summary</h2>
        <p className="font-semibold">{form.establishment.trim() || 'New company setup'}</p>
        <p className="text-sm">{form.jurisdiction || 'Choose a state'}</p>
        <p className="text-sm">{form.effective_from ? `From ${displayDate(form.effective_from)}` : 'Choose a start date'}{checked?.publishable && ` · ${checked.effective_to ? `through ${displayDate(checked.effective_to)}` : 'Ongoing'}`}</p>
        <p className="text-sm">{selected.map(scheme => names[scheme]).join(' · ') || 'No deductions selected'}</p>
        <p className="text-xs text-slate-600 dark:text-slate-300">Employee enrolment is recorded separately in Employee Management.</p>
      </aside>
    </fieldset>
    {error && <p role="alert" className="rounded-xl border border-red-400/40 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    <footer className="flex flex-wrap justify-between gap-3">
      <Button variant="glass" disabled={busy} onClick={() => step ? changeStep(step - 1) : onExit()}>{step ? 'Back' : 'Back to company deductions'}</Button>
      <div className="flex flex-wrap gap-2">
        {step < 2 && <Button variant="glass" disabled={busy || !companyReady || (saved && !dirty)} onClick={async () => { setError(''); try { await saveDraft(); } catch (e) { setError(problem(e)); } }}>{saved && !dirty ? 'Draft saved' : 'Save draft'}</Button>}
        {step === 0 && <Button variant="yellow" disabled={!companyReady || busy} onClick={() => changeStep(1)}>Continue to deduction rules</Button>}
        {step === 1 && <Button variant="yellow" disabled={!companyReady || !selected.length || busy} loading={review.isPending} onClick={runReview}>Continue to review</Button>}
        {step === 2 && (reviewReady ? <Button variant="yellow" loading={publish.isPending} disabled={busy || !reference.trim() || !confirmed} onClick={submit}>Publish setup</Button>
          : <Button variant="yellow" loading={review.isPending} disabled={busy} onClick={runReview}>Review again</Button>)}
      </div>
    </footer>
  </div>;
}

function SetupList({ title, query, page, setPage, children, empty }) {
  return <section className={panel}>
    <h2 className="mb-4 text-lg font-bold">{title}</h2>
    {query.isPending ? <p role="status">Loading…</p> : query.isError ? <div role="alert"><p>{problem(query.error)}</p><Button onClick={() => query.refetch()}>Retry</Button></div> : <>
      {query.data.total === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{empty}</p> : children(query.data)}
      {(page > 1 || query.data.total > query.data.limit) && <div className="mt-4 flex items-center gap-3"><Button variant="glass" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="glass" disabled={page * query.data.limit >= query.data.total} onClick={() => setPage(page + 1)}>Next</Button></div>}
    </>}
  </section>;
}

function CompanyDeductionsHome({ userId }) {
  const [params, setParams] = useSearchParams();
  const edit = params.get('draft');
  const [publishedPage, setPublishedPage] = useState(1);
  const [draftPage, setDraftPage] = useState(1);
  const [visible, setVisible] = useState(null);
  const [createdDraft, setCreatedDraft] = useState(null);
  const published = useQuery({ queryKey: ['company-deduction-setups', userId, 'guided', publishedPage], enabled: !edit, queryFn: () => response(getCompanyDeductionSetups({ page: publishedPage, limit: 10 })) });
  const drafts = useQuery({ queryKey: ['guided-deduction-drafts', userId, draftPage], enabled: !edit, queryFn: () => response(listGuidedDeductionDrafts({ page: draftPage, limit: 10 })) });
  const draft = useQuery({ queryKey: ['guided-deduction-draft', userId, edit], enabled: Boolean(edit && edit !== 'new'), queryFn: () => response(getGuidedDeductionDraft(edit)) });
  const exit = () => { setVisible(null); setCreatedDraft(null); setDraftPage(1); setParams({}); };
  const saveLocation = saved => {
    if (edit === 'new') {
      setCreatedDraft(saved.id);
      setParams({ draft: saved.id }, { replace: true });
    }
  };
  return <div className="space-y-5 text-slate-900 dark:text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/10">
      <div><h1 className="text-3xl font-extrabold tracking-tight">Company Deductions</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Set up EPF, ESI and professional tax for your company.</p></div>
      {!edit && <div className="flex flex-wrap items-center gap-3"><Link className="text-sm font-semibold underline underline-offset-4" to="?view=history">Published history</Link><Button variant="yellow" onClick={() => { setCreatedDraft(null); setParams({ draft: 'new' }); }}>New company setup</Button></div>}
    </header>
    {edit ? edit === 'new' || (draft.isSuccess && !draft.data.publication)
      ? <GuidedEditor key={edit === createdDraft ? 'new' : edit} initial={edit === 'new' ? null : draft.data} onExit={exit} onSave={saveLocation} userId={userId} />
      : draft.data?.publication?.result?.setup ? <PublishedSetup setup={draft.data.publication.result.setup} onExit={exit} />
      : <div className={panel}>{draft.isError ? <p role="alert">{problem(draft.error)}</p> : draft.isSuccess ? <p>This setup has already been published.</p> : <p role="status">Loading draft…</p>}
        <Button variant="glass" onClick={exit}>Back to company deductions</Button></div>
      : <>
        <SetupList title="Published setups" query={published} page={publishedPage} setPage={setPublishedPage} empty="No company setups have been published.">
          {({ setups }) => <div className="divide-y divide-slate-200 dark:divide-white/10">{setups.map(setup => {
            const schemes = [['EPF', setup.epf_revision_id], ['ESI', setup.esi_revision_id], ['PT', setup.pt_revision_id]].filter(([, id]) => id);
            return <article key={setup.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto] sm:items-center">
              <div><h3 className="font-semibold">{setup.establishment_name}</h3><p className="text-sm">{setup.state_name}</p></div>
              <div><p className="text-sm">{displayDate(setup.effective_from)} → {displayDate(setup.effective_to)}</p><p className="text-xs">{schemes.map(([scheme]) => names[scheme]).join(' · ')}</p></div>
              <div className="flex flex-wrap items-center gap-2"><Button variant="glass" size="sm" aria-expanded={visible === setup.id} onClick={() => setVisible(visible === setup.id ? null : setup.id)}>{visible === setup.id ? 'Hide details' : 'View setup'}</Button><Link className="text-sm font-semibold underline underline-offset-4" to={assignment}>Assign to employees</Link></div>
              {visible === setup.id && <div className="flex flex-wrap gap-4 sm:col-span-full"><p className="text-sm">Approval reference · {setup.evidence_reference || 'None recorded'}</p><Link className="text-sm underline" to="?view=history">Open revision history</Link></div>}
            </article>;
          })}</div>}
        </SetupList>
        <SetupList title="Draft setups" query={drafts} page={draftPage} setPage={setDraftPage} empty="No saved drafts.">
          {({ drafts: rows }) => <div className="divide-y divide-slate-200 dark:divide-white/10">{rows.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><h3 className="font-semibold">{row.establishment}</h3><p className="text-sm">{row.state_name} · Updated {displayDate(row.updated_at)}</p></div><Button variant="glass" onClick={() => setParams({ draft: row.id })}>Resume</Button></article>)}</div>}
        </SetupList>
      </>}
  </div>;
}

export default function CompanyDeductions() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (user?.role !== 'accounts') return <p role="alert">Company deductions are maintained by Accounts.</p>;
  if (params.get('view') === 'history' || params.has('modal')) return <div className="space-y-4">
    <Link className="text-sm font-semibold underline" to="/admin/payroll/statutory">Back to company deductions</Link>
    <PayrollMasters kind="statutory" />
  </div>;
  return <CompanyDeductionsHome userId={user.id} />;
}
