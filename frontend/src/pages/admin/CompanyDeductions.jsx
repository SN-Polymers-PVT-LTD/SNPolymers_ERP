import React, { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input, Select } from '../../components/ui';
import { InPageSelectContext } from '../../components/ui/Select';
import { formatIndianCurrency, groupProfessionalTaxSchedules } from '../../components/payroll/professionalTaxSchedules';
import StatutoryStateField from '../../components/payroll/StatutoryStateField';
import { newStatutoryConfiguration, statutoryDraftInput } from '../../components/payroll/statutoryPresets';
import {
  getCompanyDeductionOptions, getCompanyDeductionSetups, getGuidedDeductionDraft, listGuidedDeductionDrafts,
  saveGuidedDeductionDraft, reviewGuidedDeductionDraft, publishGuidedDeductionDraft,
} from '../../api/payrollProfilesApi';
import PayrollMasters from './PayrollMasters';
import { StatutoryFields } from './PayrollMasterFields';

const names = { EPF: 'EPF', ESI: 'ESI', PT: 'Professional Tax' };
const deductionColors = {
  EPF: 'border-indigo-300 bg-indigo-50 text-indigo-950 [body.dark_&]:border-indigo-400/50 [body.dark_&]:bg-indigo-950 [body.dark_&]:text-indigo-100',
  ESI: 'border-emerald-300 bg-emerald-50 text-emerald-950 [body.dark_&]:border-emerald-400/50 [body.dark_&]:bg-emerald-950 [body.dark_&]:text-emerald-100',
  PT: 'border-amber-300 bg-amber-50 text-amber-950 [body.dark_&]:border-amber-400/50 [body.dark_&]:bg-amber-950 [body.dark_&]:text-amber-100',
};
const steps = ['Deductions & scope', 'Deduction rules', 'Review & publish'];
const factories = ['Fabric Factory', 'S.N. Polymers Factory'];
const assignment = '/acct-requisitions/payroll-setup';
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
  'adjustment_basis.RECOVERY': 'Advance recovery treatment needs review.',
  MISSING_WAGE_BASIS: 'Choose the salary amount used for deductions.',
};
const hiddenConfigurationWarningFields = new Set([
  'adjustment_basis.BONUS',
  'adjustment_basis.SALARY_ARREARS',
  'adjustment_basis.REIMBURSEMENT',
]);
const visibleConfigurationWarning = issue => !hiddenConfigurationWarningFields.has(issue.field);
const issueText = issue => {
  if (typeof issue === 'string') {
    if (/^[a-f0-9-]{36}$/i.test(issue)) return 'A published rule already covers part of this date range.';
    return issueLabels[issue] || issue.replaceAll('_', ' ');
  }
  return issue.message || issueLabels[issue.code] || issueLabels[issue.field] || String(issue.field || issue.code || 'Check the rule configuration.').replaceAll('_', ' ');
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
      <p className="text-sm">{rule.scheme === 'EPF'
        ? c.calculation_method === 'QUALIFYING_WAGE_PERCENTAGE' ? 'No contribution cap' : `Contribution wage cap ${currency(c.wage_ceiling)}`
        : `Eligibility threshold ${currency(c.eligibility_ceiling)}`}</p>
    </>}
    <p className="text-sm">Earnings used · {c.included_components.map(component => earningsLabels[component]).join(', ') || (rule.scheme === 'ESI' ? 'Monthly gross salary' : 'Choose earnings')}</p>
    <p className="text-xs text-slate-600 dark:text-slate-300">{displayDate(rule.effective_from)} → {displayDate(rule.effective_to)}</p>
  </>;
}

function PublishedSetup({ setup, setups, onExit }) {
  return <section className={panel}>
    <p role="status" className="font-semibold text-emerald-700 dark:text-emerald-400">Company deductions are ready.</p>
    <h2 className="mt-2 text-xl font-bold">{setups?.length > 1 ? setups.map(item => item.establishment_name).join(' · ') : setup.establishment_name}</h2>
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
    pan_india: Boolean(initial.data.pan_india && (initial.data.rules.EPF || initial.data.rules.ESI)),
    jurisdiction: initial.data.jurisdiction || Object.values(initial.data.rules)[0]?.jurisdiction || '',
    rules: Object.fromEntries(Object.entries(initial.data.rules).map(([scheme, rule]) => [
      scheme, { ...rule, effective_from: rule.effective_from === initial.data.effective_from ? '' : rule.effective_from },
    ])),
  } : blank());
  const [step, setStep] = useState(initial?.data && Object.keys(initial.data.rules).length ? 1 : 0);
  const [active, setActive] = useState(initial ? Object.keys(initial.data.rules)[0] || 'EPF' : 'EPF');
  const [showPublished, setShowPublished] = useState(false);
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
  const supportsPanIndia = Boolean(form.rules.EPF || form.rules.ESI);
  const panIndia = supportsPanIndia && form.pan_india;
  const nationwideOnly = panIndia && !form.rules.PT;
  const stateId = nationwideOnly ? null : form.state_id;
  const jurisdiction = nationwideOnly ? 'Pan India' : form.jurisdiction;
  const companyReady = Boolean(form.establishment.trim() && (nationwideOnly || (stateId && jurisdiction)) && form.effective_from);
  const publishedOptions = useQuery({
    queryKey: ['guided-published-options', userId, stateId, form.effective_from],
    enabled: companyReady && showPublished && step === 1,
    queryFn: async () => {
      const params = { state_id: stateId || undefined, date: form.effective_from, limit: 100 };
      const first = await response(getCompanyDeductionOptions({ ...params, page: 1 }));
      const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / 100) - 1) },
        (_, index) => response(getCompanyDeductionOptions({ ...params, page: index + 2 }))));
      return [first, ...rest].flatMap(page => page.rules);
    },
  });
  const selected = Object.keys(names).filter(scheme => form.rules[scheme]);
  const missingInputs = selected.filter(scheme => {
    const rule = form.rules[scheme];
    return !rule.revision_id && (!rule.reason.trim() || (scheme !== 'ESI' && !rule.configuration.included_components.length));
  });
  const selectedRule = form.rules[active];
  const reviewReady = checked?.publishable && checked.review_token;
  const refreshDrafts = () => client.invalidateQueries({ queryKey: ['guided-deduction-drafts'] });
  const scope = scheme => ({ scheme, establishment: form.establishment.trim(), state_id: stateId, jurisdiction });
  const ruleFor = scheme => {
    const rule = form.rules[scheme];
    return { ...rule, ...scope(scheme), effective_from: rule.effective_from || form.effective_from };
  };
  const newRule = scheme => ({ ...scope(scheme), effective_from: '', effective_to: null, reason: '', slabs: [], configuration: newStatutoryConfiguration(scheme) });
  const toggleRule = scheme => {
    const rules = { ...form.rules };
    if (rules[scheme]) delete rules[scheme];
    else rules[scheme] = newRule(scheme);
    set({ ...form, rules, pan_india: Boolean((rules.EPF || rules.ESI) && panIndia) });
  };
  const editRule = rule => set({ ...form, rules: { ...form.rules, [active]: rule } });
  const saveDraft = async () => {
    const esi = form.rules.ESI;
    const needsEsiDefault = esi && !esi.revision_id && !esi.configuration.included_components.length;
    if (saved && !dirty && !needsEsiDefault) return saved;
    const rules = Object.fromEntries(selected.map(scheme => {
      const rule = form.rules[scheme];
      return [scheme, rule.revision_id ? { revision_id: rule.revision_id }
        : { ...statutoryDraftInput(ruleFor(scheme)), ...(rule.shared || (panIndia && scheme !== 'PT') ? { shared: true } : {}) }];
    }));
    const next = await save.mutateAsync({ establishment: form.establishment.trim(), state_id: stateId, effective_from: form.effective_from, jurisdiction, initial_setup: historical, ...(panIndia ? { pan_india: true } : {}), ...(form.all_factories ? { all_factories: true } : {}), rules });
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
    const body = { expected_version: saved.version, initial_setup: historical, review_token: checked.review_token, approval_reference: reference.trim() || null };
    const signature = JSON.stringify(body);
    if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    setError('');
    try {
      const result = await publish.mutateAsync({ ...body, idempotency_key: retry.current.key });
      setPublished(result);
      refreshDrafts();
      for (const key of ['company-deduction-setups', 'company-deduction-options', 'guided-published-options', 'payroll-masters', 'statutory-profile-scopes']) client.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      if (e.response?.status === 409) { setChecked(null); setConfirmed(false); }
      setError(problem(e));
    }
  };

  if (published) return <PublishedSetup setup={published.setup} setups={published.setups} onExit={onExit} />;

  return <InPageSelectContext.Provider value={true}><div className="space-y-5">
    <nav aria-label="Setup steps" className="grid gap-2 sm:grid-cols-3">
      {steps.map((name, index) => <button type="button" key={name} aria-current={step === index ? 'step' : undefined} disabled={busy || index >= step} onClick={() => changeStep(index)} className={`rounded-xl border p-3 text-left font-semibold ${index === step ? 'border-yellow-500 bg-yellow-500/10' : 'border-slate-200 dark:border-white/10'}`}>{name}</button>)}
    </nav>
    <fieldset disabled={busy} className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <section className={`${panel} relative space-y-4 has-[[data-select-menu-open]]:z-10`}>
        <h2 className="text-xl font-bold">{steps[step]}</h2>
        {step === 0 && <>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Which deductions are you setting up?</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.entries(names).map(([scheme, name]) => (
                <label key={scheme} className="flex items-center gap-2 rounded-xl bg-emerald-100 p-3 text-sm font-semibold text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200">
                  <input type="checkbox" checked={!!form.rules[scheme]} onChange={() => toggleRule(scheme)} />
                  Include {name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-3 rounded-xl bg-indigo-100/70 p-3 dark:bg-indigo-400/10">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={Boolean(form.all_factories)} onChange={e => set({
              ...form, all_factories: e.target.checked, establishment: e.target.checked ? 'All factories' : '',
            })} />
            All factories
          </label>
          {form.all_factories ? <p className="text-sm">{factories.join(' · ')}{!nationwideOnly && '. Select the state these factories share.'}</p> : <Input label="Establishment" required maxLength={120} value={form.establishment} onChange={e => set({ ...form, establishment: e.target.value })} />}
          </div>
          <div className="space-y-3 rounded-xl bg-blue-100/70 p-3 dark:bg-blue-400/10">
            <StatutoryStateField data={form} matchByName={false} label={form.rules.PT && !supportsPanIndia ? "State" : "Jurisdiction / State"} panIndia={supportsPanIndia} onChange={next => {
              if (next.pan_india && !panIndia) {
                next = { ...next, rules: Object.fromEntries(selected.map(scheme => [
                  scheme, scheme !== 'PT' && form.rules[scheme].revision_id ? newRule(scheme) : form.rules[scheme],
                ])) };
              }
              set(next);
            }} />
            {panIndia && form.rules.PT && <>
              <p className="text-sm">Pan India applies to EPF and ESI. Select the establishment state for assignments and Professional Tax.</p>
              <StatutoryStateField data={form} matchByName={false} label="Establishment state" onChange={set} />
            </>}
          </div>
          <div className="rounded-xl bg-amber-100/70 p-3 dark:bg-amber-400/10">
          <Input label="Setup start date" type="date" required value={form.effective_from} onChange={e => set({ ...form, effective_from: e.target.value })} />
          </div>
        </>}
        {step === 1 && <>
          <div className="grid gap-2 sm:grid-cols-3" aria-label="Deduction rules">
            {selected.map(scheme => {
              const name = names[scheme];
              const rule = form.rules[scheme];
              const ready = rule?.revision_id || rule?.reason?.trim() && (scheme === 'ESI' || rule.configuration.included_components.length) &&
                (scheme === 'PT' ? rule.slabs.length : rule.configuration.employee_rate !== null && rule.configuration.employer_rate !== null && (scheme === 'EPF' ? rule.configuration.calculation_method === 'QUALIFYING_WAGE_PERCENTAGE' || rule.configuration.wage_ceiling !== null : rule.configuration.eligibility_ceiling !== null));
              return <button type="button" key={scheme} aria-pressed={scheme === active} onClick={() => setActive(scheme)} className={`rounded-xl border p-3 text-left ${deductionColors[scheme]} ${scheme === active ? 'ring-2 ring-current ring-inset' : 'hover:shadow-sm'}`}>
                <span className="block font-semibold">{name}</span><span className="text-xs">{rule ? ready ? 'Ready for review' : 'Needs input' : 'Excluded'}</span>
              </button>;
            })}
          </div>
          {selectedRule && <section aria-label={`${names[active]} rule editor`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 [body.dark_&]:border-white/15 [body.dark_&]:bg-slate-900 [body.dark_&]:text-slate-100">
            <div className="flex flex-wrap gap-2">
              <Button variant="glass" onClick={() => setShowPublished(true)}>Use published rule</Button>
              {(showPublished || selectedRule.revision_id) && <Button variant="glass" onClick={() => {
                if (selectedRule.revision_id) editRule(newRule(active));
                setShowPublished(false);
              }}>Create new rule</Button>}
            </div>
            {showPublished && <Select
              label={`Published ${names[active]} rule`}
              value={selectedRule.revision_id || ''}
              options={[{ value: '', label: 'Choose a published rule' }, ...(publishedOptions.data || [])
                .filter(rule => rule.scheme === active && (!panIndia || active === 'PT' || rule.jurisdiction === 'Pan India') && (rule.establishment === 'Shared rule'
                  || (!form.all_factories && rule.establishment.toLowerCase() === form.establishment.trim().toLowerCase())))
                .map(rule => ({ value: rule.id, label: `${rule.jurisdiction} · ${rule.establishment} · Revision ${rule.revision_number}` }))]}
              onChange={e => editRule(e.target.value ? { revision_id: e.target.value } : newRule(active))}
            />}
            {showPublished && publishedOptions.isError && <p role="alert">{problem(publishedOptions.error)}</p>}
            {selectedRule?.revision_id && !showPublished && <p className="text-sm">Using a saved published rule.</p>}
            {selectedRule && !selectedRule.revision_id && <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(form.all_factories || (panIndia && active !== 'PT') || selectedRule.shared)} disabled={form.all_factories || (panIndia && active !== 'PT')}
                  onChange={e => editRule({ ...selectedRule, shared: e.target.checked })} />
                {active === 'PT' ? 'Share across establishments in this state' : 'Pan India'}
              </label>
              <details className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-950 [body.dark_&]:border-indigo-400/40 [body.dark_&]:bg-indigo-950 [body.dark_&]:text-indigo-100">
                <summary className="cursor-pointer font-semibold">Effective dates</summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Input label="Rule start date override" type="date" value={selectedRule.effective_from || form.effective_from} helperText={`Defaults to the setup start date of ${displayDate(form.effective_from)}.`} onChange={e => editRule({ ...selectedRule, effective_from: e.target.value })} />
                  <Input label="Rule end date" type="date" value={selectedRule.effective_to || ''} helperText="Leave blank for ongoing." onChange={e => editRule({ ...selectedRule, effective_to: e.target.value || null })} />
                </div>
              </details>
              <div className="mt-6 grid gap-x-5 gap-y-6 sm:grid-cols-2"><StatutoryFields key={active} guided data={ruleFor(active)} setData={rule => editRule({ ...rule, effective_from: selectedRule.effective_from })} /></div>
              <Input label="Change reason" required maxLength={2000} value={selectedRule.reason} onChange={e => editRule({ ...selectedRule, reason: e.target.value })} />
            </>}
          </section>}
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
              {result?.reused && <p className="text-sm font-semibold">Reused published rule</p>}
              {(!form.rules[scheme].revision_id || result?.rule) && <RuleSummary rule={result?.rule || ruleFor(scheme)} />}
              {issues.map((issue, index) => <p role="alert" key={index} className="text-sm text-red-700 dark:text-red-300">{issueText(issue)}</p>)}
              {(result?.configuration_warnings || []).filter(visibleConfigurationWarning).map((issue, index) => <p key={index} className="text-sm text-amber-800 dark:text-amber-300">{issueText(issue)}</p>)}
            </div>;
          })}
          {reviewReady && !form.rules.PT && <p className="rounded-xl border border-amber-500/40 p-3 text-sm text-amber-800 dark:text-amber-300">Choose a separate state Professional Tax setup when assigning this setup to employees who require PT.</p>}
          {reviewReady && <>
            <Input label="Approval reference (optional)" helperText="Add a document or internal reference if available." maxLength={2000} value={reference} onChange={e => setReference(e.target.value)} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I checked the rates, dates and applicable salary basis.</label>
          </>}
        </>}
      </section>
      <aside className={`${panel} h-fit space-y-3`}>
        <h2 className="font-bold">Setup summary</h2>
        <p className="rounded-lg bg-indigo-100 px-3 py-2 text-sm font-semibold text-indigo-900 dark:bg-indigo-400/15 dark:text-indigo-200">{form.all_factories ? factories.join(' · ') : form.establishment.trim() || 'New company setup'}</p>
        <p className="rounded-lg bg-blue-100 px-3 py-2 text-sm font-bold text-blue-950 dark:bg-blue-400/15 dark:text-blue-200">{jurisdiction || 'Choose a state'}</p>
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">{form.effective_from ? `From ${displayDate(form.effective_from)}` : 'Choose a start date'}{checked?.publishable && ` · ${checked.effective_to ? `through ${displayDate(checked.effective_to)}` : 'Ongoing'}`}</p>
        <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200">{selected.map(scheme => names[scheme]).join(' · ') || 'No deductions selected'}</p>
        <p className="text-xs text-slate-600 dark:text-slate-300">Employee enrolment is recorded separately in Employee Management.</p>
      </aside>
    </fieldset>
    {error && <p role="alert" className="rounded-xl border border-red-400/40 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    <footer className="flex flex-wrap justify-between gap-3">
      <Button variant="glass" disabled={busy} onClick={() => step ? changeStep(step - 1) : onExit()}>{step ? 'Back' : 'Back to company deductions'}</Button>
      <div className="flex flex-wrap gap-2">
        {step < 2 && <Button variant="glass" disabled={busy || !companyReady || (saved && !dirty)} onClick={async () => { setError(''); try { await saveDraft(); } catch (e) { setError(problem(e)); } }}>{saved && !dirty ? 'Draft saved' : 'Save draft'}</Button>}
        {step === 0 && <Button variant="yellow" disabled={!companyReady || !selected.length || busy} onClick={() => { setActive(selected.includes(active) ? active : selected[0]); changeStep(1); }}>Continue to deduction rules</Button>}
        {step === 1 && <Button variant="yellow" disabled={!companyReady || !selected.length || busy} loading={review.isPending} onClick={runReview}>Continue to review</Button>}
        {step === 2 && (reviewReady ? <Button variant="yellow" loading={publish.isPending} disabled={busy || !confirmed} onClick={submit}>Publish setup</Button>
          : <Button variant="yellow" loading={review.isPending} disabled={busy} onClick={runReview}>Review again</Button>)}
      </div>
    </footer>
  </div></InPageSelectContext.Provider>;
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
      : draft.data?.publication?.result?.setup ? <PublishedSetup setup={draft.data.publication.result.setup} setups={draft.data.publication.result.setups} onExit={exit} />
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
