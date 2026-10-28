import StatutoryStateField from '../../components/payroll/StatutoryStateField';
import PTSlabEditor from '../../components/payroll/PTSlabEditor';
import React, { useState } from 'react';
import { statutoryComponents, newStatutoryConfiguration, statutoryPreset, applyStatutoryPreset, contributionBasis, withContributionBasis, standardStatutorySettings } from '../../components/payroll/statutoryPresets';
import { Input, Select, Button } from '../../components/ui';
const choiceLabels = { UNRESOLVED:'Needs review', FIXED_DIVISOR:'Fixed number of days', ACTUAL_CALENDAR_DAYS:'Actual days in the month', CALENDAR_WEIGHTED_WITH_RESIDUAL:'Reconcile split runs to the monthly salary', NO_PAYABLE_ENTITLEMENT_ZERO:'Zero only when the entire month has no payable entitlement', MONTHLY_CONFIRMED:'Confirmed monthly agreement', WORK_CALENDAR:'Use approved work calendar', EXCLUDE_PAID_CALENDAR_DAYS:'Preserve evidenced paid rest days', HALF_UP:'Nearest amount (half rounds up)', HALF_EVEN:'Nearest amount (half rounds to even)', DOWN:'Round down', UP:'Round up', DAILY:'Each day', LINE:'Each line', AGGREGATE:'Combined amount', MONTH:'Monthly amount' };
const opts = values => values.map(value => ({ value, label: choiceLabels[value] || value.replaceAll('_',' ') }));
export function Choice({ label, value, values, onChange }) { return <Select label={label} value={value} options={opts(values)} onChange={e => onChange(e.target.value)} />; }
export function RoundingFields({ label, value, onChange }) {
  return (
    <fieldset className="border border-white/10 rounded-xl p-3 space-y-3 bg-black/20">
      <legend className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">{label} rounding</legend>
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
          This changes the approved Fixed 30 LOP method. Future publication requires business approval.
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
        <Button
          variant="secondary"
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
        <p className="text-xs text-slate-400 leading-relaxed">
          Sets rounding to two decimal places (half up), reconciles split runs, preserves evidenced paid rest days, and pays zero only for a month with no payable entitlement. Salary methods and published rules stay unchanged.
        </p>
        <p className="text-xs text-slate-300 font-medium">
          Current unpaid-leave rounding: <span className="text-amber-400">{data.rounding.lop.method.replaceAll('_', ' ')}</span>
          {data.rounding.lop.precision === null ? '' : `, ${data.rounding.lop.precision} decimal places`}.
        </p>
        {data.partial_month_proration_method === 'WORK_CALENDAR' && (
          <p role="alert" className="text-xs text-red-400 font-medium">
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
          <Choice
            label="Weekly offs inside explicit leave"
            value={data.leave_weekly_off_method}
            values={['UNRESOLVED', 'WORK_CALENDAR', 'EXCLUDE_PAID_CALENDAR_DAYS']}
            onChange={value => set('leave_weekly_off_method', value)}
          />
          <div className="col-span-full">
            <Input
              label="Work calendar evidence reference"
              value={data.work_calendar_reference || ''}
              onChange={e => set('work_calendar_reference', e.target.value || null)}
              helperText="Publish dated paid/unpaid calendar evidence through payroll review; a text reference alone is insufficient."
            />
          </div>
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
          <span className="text-xs font-bold uppercase tracking-wider">Synthetic Reference Comparison</span>
        </div>
        <p className="text-xs text-slate-300">
          Synthetic reference only: ₹30,000 gross, two unpaid days, aggregate HALF UP rounding to two places.
        </p>
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-black/20">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] text-slate-400 uppercase text-[10px] tracking-wider border-b border-white/5">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 font-mono">Fixed 30 LOP</th>
                <th className="px-3 py-2 font-mono">Optional actual-days LOP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-200">
              <tr>
                <td className="px-3 py-2 font-medium">February 2026 (28)</td>
                <td className="px-3 py-2 font-mono text-amber-300">₹2,000.00</td>
                <td className="px-3 py-2 font-mono text-slate-300">₹2,142.86</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">October 2026 (31)</td>
                <td className="px-3 py-2 font-mono text-amber-300">₹2,000.00</td>
                <td className="px-3 py-2 font-mono text-slate-300">₹1,935.48</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400">
          These are fixed examples, not a calculation of your draft. Review the selected methods before publication.
        </p>
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
export function StatutoryFields({ data, setData }) {
 const [advanced, setAdvanced] = useState(false);
 const [timingOverride, setTimingOverride] = useState(false);
 const [appliedDate, setAppliedDate] = useState(null);
 const set = (key, value) => setData({ ...data, [key]: value });
 const c = data.configuration;
 const config = (key, value) => set('configuration', { ...c, [key]: value });
 const isPT = data.scheme === 'PT';
 const preset = statutoryPreset(data.scheme, data.effective_from);
 const basis = contributionBasis(c.included_components);
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
  <Choice label="Scheme" value={data.scheme} values={['EPF', 'ESI', 'PT']} onChange={changeScheme} />
  <StatutoryStateField data={data} onChange={setData} />
  <Input id="statutory-rule-establishment" label="Establishment" required maxLength={120} value={data.establishment} onChange={e => set('establishment', e.target.value)} />
  <p className="col-span-full text-xs text-slate-400">Use the factory or office name. Link the published rule to your company deduction setup after publication.</p>
  {!isPT && <section aria-label="Standard preset" className="col-span-full rounded-xl border border-sky-500/30 p-4 space-y-3">
   <h3 className="font-semibold">Start with a standard preset</h3>
   {preset ? <>
    <p>{preset.title}: employee {preset.values.employee_rate}%, employer {preset.values.employer_rate}%, {data.scheme === 'EPF' ? 'wage ceiling' : 'eligibility ceiling'} ₹{preset.values.wage_ceiling || preset.values.eligibility_ceiling}.</p>
    <p className="text-xs">{preset.note} <a className="underline" href={preset.source} target="_blank" rel="noreferrer">Official reference</a></p>
    <Button onClick={() => { setData(applyStatutoryPreset(data, preset)); setAppliedDate(data.effective_from); }}>Apply standard preset</Button>
    {preset.reviewAfter && (!data.effective_to || data.effective_to > preset.reviewAfter) && <p role="alert" className="text-amber-400">This date range crosses a preset boundary. Set an end date by {preset.reviewAfter} and review a separate revision for later months.</p>}
   </> : <p>{data.effective_from ? 'No standard preset for this date. Review the applicable rules and enter custom values; transition months need separate review.' : 'Choose an effective start date to see the dated preset.'}</p>}
   {dateChanged && <p role="alert" className="text-amber-400">The effective date changed after applying a preset. Review the rates and ceiling, then reapply the dated preset if appropriate.</p>}
   <p className="text-xs text-slate-400">Apply sets the scheme numbers and standard calculation settings. Choose the wage basis separately.</p>
  </section>}
  {!isPT && <>
   <Input label="employee rate (%)" required inputMode="decimal" value={c.employee_rate ?? ''} onChange={e => config('employee_rate', e.target.value || null)} helperText="Deducted from the employee’s contribution wages." />
   <Input label="employer rate (%)" required inputMode="decimal" value={c.employer_rate ?? ''} onChange={e => config('employer_rate', e.target.value || null)} helperText="Company contribution, recorded separately from take-home salary." />
   {data.scheme === 'EPF' && c.calculation_method === 'CAPPED_WAGE_PERCENTAGE' && <Input label="Wage ceiling (₹)" required={c.calculation_method === 'CAPPED_WAGE_PERCENTAGE'} inputMode="decimal" value={c.wage_ceiling ?? ''} onChange={e => config('wage_ceiling', e.target.value || null)} helperText="Maximum wage amount used for contributions under a capped rule." />}
   {data.scheme === 'ESI' && ['WAGE_CEILING', 'ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility) && <Input label="Eligibility ceiling (₹)" required={['WAGE_CEILING', 'ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility)} inputMode="decimal" value={c.eligibility_ceiling ?? ''} onChange={e => config('eligibility_ceiling', e.target.value || null)} helperText="Coverage threshold; it does not cap contribution wages." />}
  </>}
  {hasRetiredComponents && <p role="alert" className="col-span-full text-amber-400">This rule uses retired salary components. Select a supported wage basis before saving; no amounts have been converted automatically.</p>}
  <div className="col-span-full space-y-2">
   <Select label="Contribution wage basis" required value={customBasis || (basis === 'DAILY_WAGE' && !isPT) ? 'CUSTOM' : basis} options={[
    { value: '', label: 'Choose the approved wage basis' },
    { value: 'GROSS_ONLY', label: 'Monthly gross salary' },
    ...(isPT ? [{ value: 'DAILY_WAGE', label: 'Daily wage earnings' }] : []),
    { value: 'CUSTOM', label: 'Custom approved components' }
   ]} onChange={e => {
    const value = e.target.value;
    setCustomBasis(value === 'CUSTOM');
    if (value === 'CUSTOM') setAdvanced(true);
    else set('configuration', withContributionBasis(c, value === 'GROSS_ONLY' ? ['PACKAGE_BALANCE'] : value ? [value] : []));
   }} />
   <p className="text-xs text-slate-400">Choose the approved wages for this scheme. Monthly gross uses the agreed salary amount. The calculation settings are summarized below.</p>
   {(basis === 'CUSTOM' || customBasis) && <p className="text-xs">Included: {c.included_components.map(name => name.replaceAll('_', ' ')).join(', ') || 'none — select components below'}.</p>}
  </div>
  {isPT && <PTSlabEditor slabs={data.slabs} effectiveFrom={data.effective_from} onChange={slabs => set('slabs', slabs)} />}
  {legacyLimits && <div role="alert" className="col-span-full border border-amber-500/30 rounded-xl p-3 space-y-2">
   <p>Saved contribution limits are unsupported by calculation. Minimum: {c.contribution_minimum ?? 'none'}; cap: {c.contribution_cap ?? 'none'}. These values have been preserved.</p>
   <Button onClick={() => set('configuration', { ...c, contribution_minimum: null, contribution_cap: null })}>Remove unsupported contribution limits</Button>
  </div>}
  <section aria-label="Calculation settings" className="col-span-full rounded-xl border border-white/10 p-4 space-y-2 text-xs">
   <h3 className="font-semibold text-sm">Calculation settings</h3>
   <p>{statutoryLabels[c.eligibility] || 'Eligibility needs review'}{['WAGE_CEILING', 'ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility) && c.eligibility_ceiling !== null ? ` · eligibility threshold ₹${c.eligibility_ceiling}` : ''}.</p>
   <p>{statutoryLabels[c.calculation_method] || 'Calculation method needs review'}{c.calculation_method === 'CAPPED_WAGE_PERCENTAGE' && c.wage_ceiling !== null ? ` · contribution wage cap ₹${c.wage_ceiling}` : ''}.</p>
   {!isPT && <p>Rounding: {statutoryLabels[c.rounding.method] || 'needs review'}; {c.rounding.precision ?? 'unspecified'} decimal places, {statutoryLabels[c.rounding.stage] || 'needs review'}.</p>}
   <p>{c.lop_wage_basis === 'PROPORTIONAL_COMPONENTS' ? 'Unpaid salary reduces the selected monthly wages proportionally.' : 'Unpaid-salary allocation needs review.'} {c.arrears_period === 'CURRENT_RUN_MONTH' ? 'Included arrears count in the month they are paid.' : 'Arrears period needs review.'}</p>
   <p>{c.conditions === 'NONE' ? 'No additional exemptions.' : 'Saved exemption conditions are unresolved or unsupported.'} {statutoryLabels[c.collection_timing] || 'Collection timing needs review'}.</p>
   {needsAdvancedReview && <p role="alert" className="text-amber-400">This saved rule has unresolved or unsupported calculation settings. Use standard calculation settings and review the displayed values before saving.</p>}
   <Button size="sm" variant="secondary" onClick={() => setData(standardStatutorySettings(data))}>Use standard calculation settings</Button>
   <p className="text-slate-400">Existing custom values are preserved unless you use this action or apply a preset. Rates, selected wages and bonus/arrears decisions stay as entered.</p>
  </section>
  <details open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)} className="col-span-full border border-white/10 rounded-xl p-4">
   <summary className="cursor-pointer font-semibold">Advanced settings — wage extras and adjustments</summary>
   <div className="grid sm:grid-cols-2 gap-4 pt-4">
    <fieldset className="space-y-2"><legend>Contribution wage components</legend>{statutoryComponents.filter(name => name !== 'ADJUSTMENTS').map(name => <label key={name} className="block text-sm"><input type="checkbox" checked={c.included_components.includes(name)} onChange={e => {
     const current = c.included_components.filter(x => statutoryComponents.includes(x));
     const included = e.target.checked ? [...current, name] : current.filter(x => x !== name);
     setCustomBasis(false); set('configuration', withContributionBasis(c, included));
    }} /> {{ PACKAGE_BALANCE: 'Monthly gross salary', DAILY_WAGE: 'Daily wage earnings', OVERTIME: 'Overtime', HOLIDAY_PREMIUM: 'Holiday premium' }[name]}</label>)}</fieldset>
    <fieldset className="space-y-3"><legend>Bonus and arrears treatment</legend>
     {!c.adjustment_basis && <><p>This saved rule uses the old adjustment setup. Choose bonus and arrears treatment before processing affected payroll.</p><Button onClick={() => set('configuration', { ...withContributionBasis(c, c.included_components.filter(x => x !== 'ADJUSTMENTS')), adjustment_basis: newStatutoryConfiguration().adjustment_basis })}>Set bonus and arrears treatment</Button></>}
     {c.adjustment_basis && ['BONUS', 'SALARY_ARREARS'].map(type => <StatutoryChoice key={type} label={`${type === 'BONUS' ? 'Bonus' : 'Salary arrears'} contribution treatment`} value={c.adjustment_basis[type]} values={['UNRESOLVED', 'INCLUDE', 'EXCLUDE']} onChange={treatment => config('adjustment_basis', { ...c.adjustment_basis, [type]: treatment })} />)}
     <p className="text-xs">Review inclusion before processing a bonus or salary arrears. {c.adjustment_basis ? 'Advance recoveries are saved as separate salary deductions.' : 'Set up these treatments to enable advance recovery calculations.'}</p>
    </fieldset>
    <div className="col-span-full space-y-3">
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={timingOverride || c.collection_timing === 'MONTH_CLOSE'} onChange={e => {
      setTimingOverride(e.target.checked); if (!e.target.checked) config('collection_timing', 'INCREMENTAL_MONTHLY');
     }} /> Change collection timing for split runs</label>
     {(timingOverride || c.collection_timing === 'MONTH_CLOSE') && <StatutoryChoice label="Collection timing" value={c.collection_timing || 'UNRESOLVED'} values={[...(!['INCREMENTAL_MONTHLY', 'MONTH_CLOSE'].includes(c.collection_timing) ? ['UNRESOLVED'] : []), 'INCREMENTAL_MONTHLY', 'MONTH_CLOSE']} onChange={value => config('collection_timing', value)} />}
     <p className="text-xs text-slate-400">Normally deductions reconcile with each payroll run. Month-end collection blocks earlier runs until the month is complete.</p>
    </div>
   </div>
  </details>
  <p className="col-span-full text-xs text-slate-400">Accounts confirmation is recorded automatically when you save, using your account, save date and change reason. Publication still requires review.</p>
 </>;
}
