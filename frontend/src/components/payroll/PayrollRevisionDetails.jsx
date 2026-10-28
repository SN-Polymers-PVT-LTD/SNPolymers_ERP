import React from 'react';

const words = {
  FIXED_DIVISOR: 'Fixed number of days', ACTUAL_CALENDAR_DAYS: 'Actual days in the month',
  CONTRACTUAL_MONTHLY_GROSS: 'Agreed monthly gross', UNRESOLVED: 'Not configured',
  GROSS: 'Monthly gross salary', CONTRACTUAL_BASE: 'Agreed monthly gross', DAILY_WAGES: 'Daily wage earnings', BASIC: 'Basic pay',
  HALF_UP: 'Nearest amount (half rounds up)', FLOOR: 'Round down', CEIL: 'Round up',
  APPLICABLE: 'Applies', NOT_APPLICABLE: 'Does not apply',
};
const label = value => words[value] || String(value).replaceAll('_', ' ').toLowerCase();
const displayDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(`${value}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : value;
const money = value => value === null || value === undefined || value === '' ? 'Not configured' : `₹${value}`;
const fields = data => {
  const config = data.data?.configuration || data.configuration || {};
  const value = { ...data, ...data.data };
  const entries = [
    ['Scheme', value.scheme], ['Establishment', value.establishment], ['State', value.jurisdiction],
    ['Applies to', value.group_code ? label(value.group_code) : !value.scheme ? 'All monthly-salaried employees' : null],
    ['Effective from', displayDate(value.effective_from)], ['Effective to', displayDate(value.effective_to) || 'Ongoing'],
    ['Employee contribution', config.employee_rate != null ? `${config.employee_rate}%` : null],
    ['Employer contribution', config.employer_rate != null ? `${config.employer_rate}%` : null],
    ['Contribution wage ceiling', config.wage_ceiling != null ? money(config.wage_ceiling) : null],
    ['Eligibility threshold', config.eligibility_ceiling != null ? money(config.eligibility_ceiling) : null],
    ['Minimum contribution', config.contribution_minimum != null ? money(config.contribution_minimum) : null],
    ['Contribution cap', config.contribution_cap != null ? money(config.contribution_cap) : null],
    ['Wage components', config.included_components?.map(label).join(', ')],
    ['Unpaid-leave calculation', value.lop_method ? `${label(value.lop_method)}${value.lop_method === 'FIXED_DIVISOR' ? ` (${value.lop_fixed_divisor ?? 'not configured'} days)` : ''}` : null],
    ['Joining / leaving calculation', value.partial_month_proration_method ? `${label(value.partial_month_proration_method)}${value.partial_month_proration_method === 'FIXED_DIVISOR' ? ` (${value.partial_month_fixed_divisor ?? 'not configured'} days)` : ''}` : null],
    ['Sandwich deduction', typeof value.sandwich_enabled === 'boolean' ? value.sandwich_enabled ? 'Enabled' : 'Disabled' : null],
    ['Change reason', value.reason], ['Approval reference', value.approval_reference],
    ['Supporting reference', value.verification_reference], ['Reviewed by', value.advisor_name],
  ];
  return entries.filter(([, v]) => v !== null && v !== undefined && v !== '');
};

export default function PayrollRevisionDetails({ revision, before }) {
  const entries = fields(revision);
  const previous = before ? Object.fromEntries(fields(before)) : null;
  const slabs = revision.data?.slabs || revision.slabs || [];
  return <div className="space-y-5">
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
      {entries.map(([name, value]) => <div key={name} className="min-w-0 border-b border-slate-200 dark:border-white/10 pb-3">
        <dt className="text-xs text-slate-500 dark:text-slate-400 mb-1">{name}</dt>
        <dd className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">
          {previous?.[name] !== undefined && previous[name] !== value && <span className="block text-xs font-normal text-slate-500 mb-1">Previously: {previous[name]}</span>}
          {value}
        </dd>
      </div>)}
    </dl>
    {!!slabs.length && <details className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Professional tax slabs ({slabs.length})</summary>
      <div className="overflow-x-auto mt-4"><table className="w-full text-sm text-left">
        <thead><tr>{['Month', 'Monthly wages from', 'Monthly wages below', 'Deduction'].map(name => <th key={name} className="p-3 font-semibold">{name}</th>)}</tr></thead>
        <tbody>{slabs.map((slab, i) => <tr key={i} className="border-t border-slate-200 dark:border-white/10">
          <td className="p-3">{['January','February','March','April','May','June','July','August','September','October','November','December'][slab.month - 1] || 'Not specified'}</td>
          <td className="p-3">{money(slab.lower_bound)}</td><td className="p-3">{slab.upper_bound == null ? 'No upper limit' : money(slab.upper_bound)}</td><td className="p-3">{money(slab.deduction_amount)}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
  </div>;
}
