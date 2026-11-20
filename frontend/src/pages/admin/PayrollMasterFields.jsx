import StatutoryStateField from '../../components/payroll/StatutoryStateField';
import PTSlabEditor from '../../components/payroll/PTSlabEditor';
import React, { useState } from 'react';
import { statutoryComponents, newStatutoryConfiguration, statutoryPreset, applyStatutoryPreset, contributionBasis, withContributionBasis, standardStatutorySettings } from '../../components/payroll/statutoryPresets';
import { Input, Select, Button, FormattedCurrencyInput } from '../../components/ui';
import { formatIndianCurrency } from '../../utils/currencyFormatter';
const choiceLabels = { UNRESOLVED:'Needs review', FIXED_DIVISOR:'Fixed number of days', ACTUAL_CALENDAR_DAYS:'Actual days in the month', CALENDAR_WEIGHTED_WITH_RESIDUAL:'Reconcile split runs to the monthly salary', NO_PAYABLE_ENTITLEMENT_ZERO:'Zero only when the entire month has no payable entitlement', MONTHLY_CONFIRMED:'Confirmed monthly agreement', WORK_CALENDAR:'Use approved work calendar', EXCLUDE_PAID_CALENDAR_DAYS:'Preserve evidenced paid rest days', HALF_UP:'Nearest amount (half rounds up)', HALF_EVEN:'Nearest amount (half rounds to even)', DOWN:'Round down', UP:'Round up', DAILY:'Each day', LINE:'Each line', AGGREGATE:'Combined amount', MONTH:'Monthly amount' };
const opts = values => values.map(value => ({ value, label: choiceLabels[value] || value.replaceAll('_',' ') }));
export function Choice({ label, value, values, onChange }) { return <Select label={label} value={value} options={opts(values)} onChange={e => onChange(e.target.value)} />; }
export function RoundingFields({ label, value, onChange }) {
  return (
    <fieldset className="border border-white/10 rounded-xl p-3 space-y-3 bg-black/20">
      <legend className="sr-only">{label} rounding</legend>
      <p aria-hidden="true" className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">{label} rounding</p>
      <Choice
        label={`${label} rounding method`}
        value={value.method}
        values={['UNRESOLVED', 'HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']}
        onChange={method => onChange(method === 'UNRESOLVED' ? { method, precision: null, stage: 'UNRESOLVED' } : { ...value, method })}
      />
      {value.method !== 'UNRESOLVED' && (
        <>
          <Input
            label={`${label} precision`}
            type="number"
            min="0"
            max="6"
            value={value.precision ?? ''}
            onChange={e => onChange({ ...value, precision: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <Choice
            label={`${label} rounding stage`}
            value={value.stage}
            values={['UNRESOLVED', 'DAILY', 'LINE', 'AGGREGATE', 'MONTH']}
            onChange={stage => onChange({ ...value, stage })}
          />
        </>
      )}
    </fieldset>
  );
}

function sampleLeaveDeduction(divisor, rounding) {
  const { method, precision, stage } = rounding;
  if (!['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'].includes(method) ||
      !Number.isInteger(precision) || precision < 0 || precision > 6 ||
      !['DAILY', 'AGGREGATE', 'MONTH'].includes(stage)) return 'Needs review';

  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(divisor));
  if (!match) return 'Needs review';
  const fraction = match[2] || '';
  const denominator = BigInt(match[1] + fraction);
  if (denominator === 0n) return 'Needs review';

  const daily = stage === 'DAILY';
  const scale = 10n ** BigInt(precision);
  const numerator = (daily ? 30000n : 60000n) * scale * 10n ** BigInt(fraction.length);
  const units = numerator / denominator;
  const remainder = numerator % denominator;
  const half = remainder * 2n;
  const roundUp = (method === 'UP' && remainder > 0n) ||
    (method === 'HALF_UP' && half >= denominator) ||
    (method === 'HALF_EVEN' && (half > denominator || (half === denominator && units % 2n === 1n)));
  const total = (units + (roundUp ? 1n : 0n)) * (daily ? 2n : 1n);
  const decimals = precision ? String(total % scale).padStart(precision, '0') : '';
  return `₹${(total / scale).toLocaleString('en-IN')}.${decimals.padEnd(2, '0')}`;
}

export function PolicyFields({ data, setData, groups }) {
  const set = (key, value) => setData({ ...data, [key]: value });
  return (
    <>
      <Select
        label="Applies to"
        value={data.group_code || ''}
        options={[
          { value: '', label: 'All monthly-salaried employees (default)' },
          ...groups.filter(g => g.is_permanent !== false).map(g => ({ value: g.code, label: g.code }))
        ]}
        onChange={e => set('group_code', e.target.value || null)}
      />

      <div className="col-span-full p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-200 flex items-center gap-2.5">
        <svg className="w-4 h-4 text-sky-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="font-medium">Full eligible month: contractual monthly gross, for 28/29/30/31 days. No sandwich policy.</p>
      </div>

      <Choice
        label="Unpaid-leave deduction"
        value={data.lop_method}
        values={['FIXED_DIVISOR', 'ACTUAL_CALENDAR_DAYS']}
        onChange={value => setData({ ...data, lop_method: value, lop_fixed_divisor: value === 'FIXED_DIVISOR' ? '' : null })}
      />

      {data.lop_method === 'FIXED_DIVISOR' && (
        <Input
          label="Days used for unpaid leave"
          required
          inputMode="decimal"
          value={data.lop_fixed_divisor ?? ''}
          onChange={e => set('lop_fixed_divisor', e.target.value)}
        />
      )}

      {data.lop_method === 'ACTUAL_CALENDAR_DAYS' && (
        <p className="text-amber-400 text-xs col-span-full font-medium">
          This changes the approved Fixed 30 reference method. Future publication requires business approval.
        </p>
      )}

      <Choice
        label="Joining/leaving salary calculation"
        value={data.partial_month_proration_method}
        values={['UNRESOLVED', 'FIXED_DIVISOR', 'ACTUAL_CALENDAR_DAYS', ...(data.partial_month_proration_method === 'WORK_CALENDAR' ? ['WORK_CALENDAR'] : [])]}
        onChange={value => setData({ ...data, partial_month_proration_method: value, partial_month_fixed_divisor: value === 'FIXED_DIVISOR' ? '' : null })}
      />

      {data.partial_month_proration_method === 'FIXED_DIVISOR' && (
        <Input
          label="Days used for joining/leaving"
          value={data.partial_month_fixed_divisor ?? ''}
          onChange={e => set('partial_month_fixed_divisor', e.target.value)}
        />
      )}

      <section aria-label="Calculation settings" className="col-span-full rounded-2xl border border-sky-500/30 bg-sky-500/[0.04] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-slate-100">Calculation settings</h3>
          <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 bg-sky-500/10 px-2.5 py-0.5 rounded-full border border-sky-500/20">
            Standard Configuration
          </span>
        </div>
        <p className="text-xs text-slate-300">
          Unpaid leave and joining/leaving use independent methods. Overtime is configured in factory attendance rules.
        </p>
        <div className="pt-0.5">
          <Button
            type="button"
            size="sm"
            icon={
              <svg aria-hidden="true" className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            }
            className="bg-white dark:bg-sky-950/40 hover:bg-sky-50 dark:hover:bg-sky-900/60 text-sky-950 dark:text-sky-200 border border-sky-400/50 dark:border-sky-500/40 hover:border-sky-500 dark:hover:border-sky-400 shadow-sm hover:shadow transition-all duration-200 active:scale-[0.98] inline-flex items-center gap-1.5"
            onClick={() => setData({
              ...data,
              split_period_allocation_method: 'CALENDAR_WEIGHTED_WITH_RESIDUAL',
              full_month_unpaid_treatment: 'NO_PAYABLE_ENTITLEMENT_ZERO',
              leave_weekly_off_method: 'EXCLUDE_PAID_CALENDAR_DAYS',
              monetary_rounding_method: 'HALF_UP_2',
              rounding: Object.fromEntries(['lop', 'proration', 'allocation'].map(key => [key, { method: 'HALF_UP', precision: 2, stage: 'AGGREGATE' }]))
            })}
          >
            Use standard calculation settings
          </Button>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Sets rounding to two decimal places (half up), reconciles split runs, uses the approved work calendar for paid rest days, and pays zero only for a month with no payable entitlement. Salary methods and published rules stay unchanged.
        </p>
        <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
          Current unpaid-leave rounding: <span className="text-amber-500 dark:text-amber-400">{data.rounding.lop.method.replaceAll('_', ' ')}</span>
          {data.rounding.lop.precision === null ? '' : `, ${data.rounding.lop.precision} decimal places`}.
        </p>
        {data.partial_month_proration_method === 'WORK_CALENDAR' && (
          <p role="alert" className="text-xs text-red-500 dark:text-red-400 font-medium">
            This existing joining/leaving method is unsupported by the calculator. Select fixed days or actual calendar days.
          </p>
        )}
      </section>

      <details className="col-span-full rounded-2xl border border-white/10 bg-slate-900/40 p-4 transition-all">
        <summary className="cursor-pointer font-semibold text-xs uppercase tracking-wider text-slate-300 hover:text-slate-100 flex items-center justify-between">
          <span>Additional rules and rounding</span>
          <span className="text-[10px] text-slate-500 font-normal">Click to expand / collapse</span>
        </summary>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/5">
          <Choice
            label="Split-run allocation"
            value={data.split_period_allocation_method}
            values={['UNRESOLVED', 'CALENDAR_WEIGHTED_WITH_RESIDUAL']}
            onChange={value => set('split_period_allocation_method', value)}
          />
          <Choice
            label="Full-month unpaid treatment"
            value={data.full_month_unpaid_treatment}
            values={['UNRESOLVED', 'NO_PAYABLE_ENTITLEMENT_ZERO']}
            onChange={value => set('full_month_unpaid_treatment', value)}
          />
          <p className="col-span-full text-[11px] text-slate-400">
            The zero exception requires evidence that every employment day has no payable entitlement. Paid rest days are preserved.
          </p>
          <Choice
            label="Special Package period"
            value={data.special_package_period || 'UNRESOLVED'}
            values={['UNRESOLVED', 'MONTHLY_CONFIRMED']}
            onChange={value => set('special_package_period', value)}
          />
          <Select
            label="Weekly offs inside explicit leave"
            value={data.leave_weekly_off_method === 'EXCLUDE_PAID_CALENDAR_DAYS' ? 'EXCLUDE_PAID_CALENDAR_DAYS' : 'UNRESOLVED'}
            options={[
              { value: 'UNRESOLVED', label: 'Needs review' },
              { value: 'EXCLUDE_PAID_CALENDAR_DAYS', label: 'Use approved work calendar' }
            ]}
            onChange={event => set('leave_weekly_off_method', event.target.value)}
          />
          <div className="col-span-full grid sm:grid-cols-3 gap-3">
            {['lop', 'proration', 'allocation'].map(key => (
              <RoundingFields
                key={key}
                label={key}
                value={data.rounding[key]}
                onChange={value => set('rounding', { ...data.rounding, [key]: value })}
              />
            ))}
          </div>
        </div>
      </details>

      <div className="col-span-full border border-amber-500/20 bg-amber-500/[0.02] rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-amber-400">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-wider">Unpaid-leave comparison</span>
        </div>
        <p className="text-xs text-slate-300">
          Example with ₹30,000 monthly salary and two chargeable unpaid days. Both columns use your draft’s rounding settings.
        </p>
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-black/20">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-slate-400 uppercase text-[10px] tracking-wider border-b border-white/5">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 font-mono">Fixed 30 reference</th>
                <th className="px-3 py-2 font-mono">Your draft</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              {[['February 2026', 28], ['September 2026', 30], ['October 2026', 31]].map(([month, days]) => (
                <tr key={month}>
                  <td className="px-3 py-2 font-medium">{month} ({days})</td>
                  <td className="px-3 py-2 font-mono">{sampleLeaveDeduction(30, data.rounding.lop)}</td>
                  <td className="px-3 py-2 font-mono">{sampleLeaveDeduction(
                    data.lop_method === 'FIXED_DIVISOR' ? data.lop_fixed_divisor :
                      data.lop_method === 'ACTUAL_CALENDAR_DAYS' ? days : null,
                    data.rounding.lop
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
const statutoryLabels = {
 UNRESOLVED: 'Needs review', ENROLLED: 'Enrolled employees', WAGE_CEILING: 'Monthly eligibility threshold',
 ENROLLED_AND_WAGE_CEILING: 'Enrolled employees within monthly threshold', JURISDICTION_PROFILE: 'State and employee tax profile',
 QUALIFYING_WAGE_PERCENTAGE: 'Percentage of contribution wages', CAPPED_WAGE_PERCENTAGE: 'Percentage of wages up to the ceiling', SLABS: 'State slab table',
 NONE: 'No additional exemptions', PROFILE_EXEMPTIONS: 'Profile exemptions (unsupported)',
 INCLUDE: 'Include in contribution wages', EXCLUDE: 'Exclude from contribution wages', DEDUCTION_ONLY: 'Separate salary deduction',
 INCREMENTAL_MONTHLY: 'Collect with each run; reconcile monthly', MONTH_CLOSE: 'Collect at month end',
 PROPORTIONAL_COMPONENTS: 'Reduce selected wages in proportion to unpaid salary', CURRENT_RUN_MONTH: 'Month in which arrears are paid',
 HALF_UP: 'Nearest rupee / decimal (half rounds up)', HALF_EVEN: 'Nearest rupee / decimal (half rounds to even)', DOWN: 'Round down', UP: 'Round up',
 MONTH: 'Monthly liability', AGGREGATE: 'Aggregate liability', DAILY: 'Daily (unsupported for contributions)', LINE: 'Each line (unsupported for contributions)'
};
function StatutoryChoice({ label, value, values, onChange }) {
 return <Select label={label} value={value} options={values.map(value => ({ value, label: statutoryLabels[value] || value }))} onChange={e => onChange(e.target.value)} />;
}
const editableWageComponents = ['PACKAGE_BALANCE', 'DAILY_WAGE'];

export function StatutoryFields({ data, setData, guided = false }) {
 const [advanced, setAdvanced] = useState(false);
 const [standardSettingsFeedback, setStandardSettingsFeedback] = useState(null);
 const [timingOverride, setTimingOverride] = useState(false);
 const [appliedDate, setAppliedDate] = useState(null);
 const set = (key, value) => setData({ ...data, [key]: value });
 const c = data.configuration;
 const config = (key, value) => set('configuration', { ...c, [key]: value });
 const isPT = data.scheme === 'PT';
 const preset = statutoryPreset(data.scheme, data.effective_from);
 const savedFactoryEarnings = c.included_components.filter(name => name === 'OVERTIME' || name === 'HOLIDAY_PREMIUM');
 const basis = contributionBasis(c.included_components.filter(name => !savedFactoryEarnings.includes(name)));
 const setWageBasis = components => set('configuration', withContributionBasis(c, [...components, ...savedFactoryEarnings]));
 const fixedEsiBasis = data.scheme === 'ESI' && (basis === 'GROSS_ONLY' || c.included_components.length === 0);
 const hasRetiredComponents = c.included_components.some(name => !statutoryComponents.includes(name));
 const [customBasis, setCustomBasis] = useState(false);
 const changeScheme = scheme => {
  setAppliedDate(null); setCustomBasis(false); setTimingOverride(false);
  setData({ ...data, scheme, slabs: [], configuration: newStatutoryConfiguration(scheme) });
 };
 const legacyLimits = c.contribution_minimum !== null || c.contribution_cap !== null;
 const dateChanged = appliedDate && appliedDate !== data.effective_from;
 const needsAdvancedReview = c.lop_wage_basis !== 'PROPORTIONAL_COMPONENTS' || c.arrears_period !== 'CURRENT_RUN_MONTH' || !['INCREMENTAL_MONTHLY', 'MONTH_CLOSE'].includes(c.collection_timing) || c.conditions !== 'NONE' || c.eligibility === 'UNRESOLVED' || c.calculation_method === 'UNRESOLVED' || c.rounding.method === 'UNRESOLVED' || !['MONTH', 'AGGREGATE'].includes(c.rounding.stage);
 return <>
  {!guided && <>
  <Choice label="Scheme" value={data.scheme} values={['EPF', 'ESI', 'PT']} onChange={changeScheme} />
  <StatutoryStateField data={data} onChange={setData} />
  <Input id="statutory-rule-establishment" label="Establishment" required maxLength={120} value={data.establishment} onChange={e => set('establishment', e.target.value)} />
  <p className="col-span-full text-xs text-slate-400">Use the factory or office name. Link the published rule to your company deduction setup after publication.</p>
  </>}
  {!isPT && <section aria-label="Standard preset" className={`col-span-full space-y-4 rounded-xl border p-5 ${guided ? 'border-teal-200 bg-teal-50 text-teal-950 [body.dark_&]:border-teal-400/40 [body.dark_&]:bg-teal-950 [body.dark_&]:text-teal-100' : 'border-sky-500/30'}`}>
   <h3 className="font-semibold">{data.scheme} standard preset</h3>
   {preset ? <>
    <p>Employee {preset.values.employee_rate}% · Employer {preset.values.employer_rate}% · {data.scheme === 'EPF' ? 'wage ceiling' : 'eligibility ceiling'} ₹{formatIndianCurrency(preset.values.wage_ceiling || preset.values.eligibility_ceiling)}.</p>
    <p className="text-xs">{preset.note} <a className="underline underline-offset-2" href={preset.source} target="_blank" rel="noreferrer"> {data.scheme === 'EPF' ? (preset.id === 'EPF-15000' ? 'EPFO ₹15,000 reference' : 'PIB ₹25,000 announcement') : 'Official reference'}</a></p>
    <Button onClick={() => { setData(applyStatutoryPreset(data, preset)); setAppliedDate(data.effective_from); }}>Apply standard preset</Button>
    {preset.reviewAfter && (!data.effective_to || data.effective_to > preset.reviewAfter) && <p role="alert" className="text-amber-400">Use this preset through {preset.reviewAfter}. Review a separate rule for later months.</p>}
   </> : <p>{data.effective_from ? 'No standard preset for this date. Review the applicable rules and enter custom values; transition months need separate review.' : 'Choose an effective start date to see the dated preset.'}</p>}
   {dateChanged && <p role="alert" className="text-amber-400">The effective date changed after applying a preset. Review the rates and ceiling, then reapply the dated preset if appropriate.</p>}
   {!fixedEsiBasis && <p className="text-xs text-slate-400">Choose the wage basis after applying.</p>}
  </section>}
  {!isPT && <>
   <Input label="employee rate (%)" required inputMode="decimal" value={c.employee_rate ?? ''} onChange={e => config('employee_rate', e.target.value || null)} helperText="Deducted from the employee’s contribution wages." />
   <Input label="employer rate (%)" required inputMode="decimal" value={c.employer_rate ?? ''} onChange={e => config('employer_rate', e.target.value || null)} helperText="Company contribution, recorded separately from take-home salary." />
   {data.scheme === 'EPF' && <Select
    label="EPF contribution basis"
    value={c.calculation_method}
    options={[
     { value: 'CAPPED_WAGE_PERCENTAGE', label: 'Capped at the wage ceiling' },
     { value: 'QUALIFYING_WAGE_PERCENTAGE', label: 'Uncapped qualifying wages' },
     ...(c.calculation_method === 'UNRESOLVED' ? [{ value: 'UNRESOLVED', label: 'Needs review' }] : []),
    ]}
    onChange={e => set('configuration', { ...c, calculation_method: e.target.value,
     wage_ceiling: e.target.value === 'QUALIFYING_WAGE_PERCENTAGE' ? null : c.wage_ceiling })}
   />}
   {data.scheme === 'EPF' && c.calculation_method === 'CAPPED_WAGE_PERCENTAGE' && <FormattedCurrencyInput label="Wage ceiling (₹)" required={c.calculation_method === 'CAPPED_WAGE_PERCENTAGE'} inputMode="decimal" value={c.wage_ceiling ?? ''} onValueChange={value => config('wage_ceiling', value || null)} helperText="Maximum wage amount used for contributions under a capped rule." />}
   {data.scheme === 'ESI' && ['WAGE_CEILING', 'ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility) && <FormattedCurrencyInput label="Eligibility ceiling (₹)" required={['WAGE_CEILING', 'ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility)} inputMode="decimal" value={c.eligibility_ceiling ?? ''} onValueChange={value => config('eligibility_ceiling', value || null)} helperText="Coverage threshold; it does not cap contribution wages." />}
  </>}
  {hasRetiredComponents && <p role="alert" className="col-span-full text-amber-400">This rule uses retired salary components. Select a supported wage basis before saving; no amounts have been converted automatically.</p>}
  <div className="col-span-full space-y-2">
   {fixedEsiBasis ? <dl>
    <dt className="text-xs font-semibold">Wage basis</dt>
    <dd className="mt-1 font-semibold">Monthly gross salary</dd>
   </dl> : <>
   <Select label={guided ? "Which earnings count?" : "Contribution wage basis"} required value={(isPT && customBasis) || (!isPT && basis === 'DAILY_WAGE') ? 'CUSTOM' : basis} options={[
    { value: '', label: 'Choose the approved wage basis' },
    { value: 'GROSS_ONLY', label: 'Monthly gross salary' },
    ...(isPT ? [{ value: 'DAILY_WAGE', label: 'Daily wage earnings' }] : []),
    ...(isPT ? [{ value: 'CUSTOM', label: 'Custom approved components' }] :
      ['CUSTOM', 'DAILY_WAGE'].includes(basis) ? [{ value: 'CUSTOM', label: 'Saved custom wage basis' }] : [])
   ]} onChange={e => {
    const value = e.target.value;
    setCustomBasis(value === 'CUSTOM');
    if (value === 'CUSTOM') setAdvanced(true);
    else setWageBasis(value === 'GROSS_ONLY' ? ['PACKAGE_BALANCE'] : value ? [value] : []);
   }} />
   <p className="text-xs text-slate-400">Choose the approved wages for this scheme. Monthly gross uses the agreed salary amount. The calculation settings are summarized below.</p>
   </>}
   {savedFactoryEarnings.length > 0 && <p className="text-xs">This rule also includes previously configured factory earnings.</p>}
  </div>
  {isPT && <PTSlabEditor slabs={data.slabs} effectiveFrom={data.effective_from} onChange={slabs => set('slabs', slabs)} />}
  {legacyLimits && <div role="alert" className="col-span-full border border-amber-500/30 rounded-xl p-3 space-y-2">
   <p>Saved contribution limits are unsupported by calculation. Minimum: {c.contribution_minimum ?? 'none'}; cap: {c.contribution_cap ?? 'none'}. These values have been preserved.</p>
   <Button onClick={() => set('configuration', { ...c, contribution_minimum: null, contribution_cap: null })}>Remove unsupported contribution limits</Button>
  </div>}
  <section aria-label="Calculation settings" className="col-span-full space-y-5 rounded-xl border border-blue-200 bg-blue-50 p-5 text-slate-900 [body.dark_&]:border-blue-400/40 [body.dark_&]:bg-slate-800 [body.dark_&]:text-slate-100">
   <h3 className="font-semibold">Calculation settings</h3>
   <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
    <div>
     <dt className="mb-1 font-semibold">Coverage</dt>
     <dd>{statutoryLabels[c.eligibility] || 'Needs review'}{['WAGE_CEILING', 'ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility) && c.eligibility_ceiling !== null ? ` · threshold ₹${formatIndianCurrency(c.eligibility_ceiling)}` : ''}</dd>
     <dd className="mt-1">{c.conditions === 'NONE' ? 'No additional exemptions' : 'Exemptions need review'}</dd>
    </div>
    <div>
     <dt className="mb-1 font-semibold">Calculation</dt>
     <dd>{statutoryLabels[c.calculation_method] || 'Needs review'}{c.calculation_method === 'CAPPED_WAGE_PERCENTAGE' && c.wage_ceiling !== null ? ` · contribution wage cap ₹${formatIndianCurrency(c.wage_ceiling)}` : ''}</dd>
    </div>
    {!isPT && <div>
     <dt className="mb-1 font-semibold">Rounding</dt>
     <dd>{statutoryLabels[c.rounding.method] || 'Needs review'} · {c.rounding.precision ?? 'unspecified'} decimal places · {statutoryLabels[c.rounding.stage] || 'Needs review'}</dd>
    </div>}
    <div>
     <dt className="mb-1 font-semibold">Collection</dt>
     <dd>{statutoryLabels[c.collection_timing] || 'Needs review'}</dd>
    </div>
    <div>
     <dt className="mb-1 font-semibold">Unpaid leave</dt>
     <dd>{c.lop_wage_basis === 'PROPORTIONAL_COMPONENTS' ? 'Reduce monthly wages proportionally' : 'Needs review'}</dd>
    </div>
   </dl>
   {needsAdvancedReview && <p role="alert" className="text-sm text-amber-800 [body.dark_&]:text-amber-300">Review unresolved settings before saving.</p>}
   <div className="space-y-2 border-t border-blue-200 pt-4 [body.dark_&]:border-white/15">
     <Button
       type="button"
       size="sm"
       icon={
         <svg aria-hidden="true" className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
         </svg>
       }
       className="bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-white/15 hover:border-slate-400 dark:hover:border-white/30 shadow-sm hover:shadow transition-all duration-200 active:scale-[0.98] inline-flex items-center gap-1.5"
       onClick={() => {
         const next = standardStatutorySettings(data);
         const before = JSON.stringify(c);
         const after = JSON.stringify(next.configuration);
         setStandardSettingsFeedback({ configuration: after, changed: before !== after });
         if (before !== after) setData(next);
       }}
     >
       Use standard calculation settings
     </Button>
     <p className="text-xs">Applies scheme defaults to this draft. Keeps your rates and wage selections.</p>
     <div role="status" className="text-sm font-semibold text-blue-900 [body.dark_&]:text-blue-200">
      {standardSettingsFeedback?.configuration === JSON.stringify(c) &&
        (standardSettingsFeedback.changed ? 'Standard settings applied to this draft.' : 'This draft already uses the standard settings.')}
     </div>
   </div>
  </section>
    {!c.adjustment_basis && <div className="col-span-full space-y-2">
     <p>Confirm that advance recoveries are separate salary deductions.</p>
     <Button onClick={() => set('configuration', {
      ...withContributionBasis(c, c.included_components.filter(x => x !== 'ADJUSTMENTS')),
      adjustment_basis: newStatutoryConfiguration().adjustment_basis,
     })}>Set advance recovery treatment</Button>
    </div>}
  {isPT && <details open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)} className="col-span-full border border-white/10 rounded-xl p-4">
   <summary className="cursor-pointer font-semibold">Advanced settings</summary>
   <div className="grid sm:grid-cols-2 gap-4 pt-4">
    <fieldset className="space-y-2"><legend>Contribution wage components</legend>{editableWageComponents.map(name => <label key={name} className="block text-sm"><input type="checkbox" checked={c.included_components.includes(name)} onChange={e => {
     const current = c.included_components.filter(x => editableWageComponents.includes(x) || x === 'ADJUSTMENTS');
     const included = e.target.checked ? [...current, name] : current.filter(x => x !== name);
     setCustomBasis(false); setWageBasis(included);
    }} /> {{ PACKAGE_BALANCE: 'Monthly gross salary', DAILY_WAGE: 'Daily wage earnings' }[name]}</label>)}</fieldset>
    <div className="col-span-full space-y-3">
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={timingOverride || c.collection_timing === 'MONTH_CLOSE'} onChange={e => {
      setTimingOverride(e.target.checked); if (!e.target.checked) config('collection_timing', 'INCREMENTAL_MONTHLY');
     }} /> Change collection timing for split runs</label>
     {(timingOverride || c.collection_timing === 'MONTH_CLOSE') && <StatutoryChoice label="Collection timing" value={c.collection_timing || 'UNRESOLVED'} values={[...(!['INCREMENTAL_MONTHLY', 'MONTH_CLOSE'].includes(c.collection_timing) ? ['UNRESOLVED'] : []), 'INCREMENTAL_MONTHLY', 'MONTH_CLOSE']} onChange={value => config('collection_timing', value)} />}
     <p className="text-xs text-slate-400">Normally deductions reconcile with each payroll run. Month-end collection blocks earlier runs until the month is complete.</p>
    </div>
   </div>
  </details>}
  <p className="col-span-full text-xs text-slate-400">Accounts confirmation is recorded automatically when you save, using your account, save date and change reason. Publication still requires review.</p>
 </>;
}
