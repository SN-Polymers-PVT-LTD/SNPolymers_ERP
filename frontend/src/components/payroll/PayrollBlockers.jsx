import React from 'react';
import { groupPayrollBlockers } from './groupPayrollBlockers';

export const labels = {
  // Calendar & Holidays
  LEAVE_CALENDAR_ENTITLEMENT_REQUIRED: 'Published holiday/leave calendar entry required',
  APPROVED_HOLIDAY_CALENDAR_REQUIRED: 'Publish the approved paid-holiday calendar entry',
  APPROVED_CALENDAR_REQUIRED: 'Publish the approved work calendar entry',
  CONFLICTING_CALENDAR_ENTITLEMENT: 'Conflicting holiday/leave entitlement on calendar',
  PERMANENT_HOLIDAY_BASE_REQUIRED: 'Factory Masters: complete permanent holiday pay setup',
  HOLIDAY_RULE_REQUIRED: 'Factory Masters: enable holiday pay rule',
  HOLIDAY_FULL_DUTY_REQUIRED: 'Full duty required for holiday pay entitlement',
  LOCAL_HOLIDAY_FORBIDDEN: 'Holiday pay not applicable to local daily workers',

  // Gross & Calculation
  COMPLETE_GROSS_REQUIRED: 'Complete gross calculation required before deductions',
  FINAL_NET_SALARY_REQUIRED: 'Complete statutory deductions for final take-home pay',
  NEGATIVE_GROSS_FORBIDDEN: 'Deductions exceed earnings (negative gross pay)',

  // Factory Masters & Overtime
  STRUCTURED_SHORT_HOURS_RULE_REQUIRED: 'Factory Masters: confirm missing-hours treatment',
  STRUCTURED_STOPPAGE_RULE_REQUIRED: 'Factory Masters: confirm management stoppage pay',
  PAID_DAILY_LEAVE_BASIS_REQUIRED: 'Factory Masters: complete paid-leave wage setup',
  SALARY_DERIVED_OT_BASIS_REQUIRED: 'Factory Masters: complete salary-derived OT calculation setup',
  FACTORY_OT_CONFIGURATION_REQUIRED: 'Factory Masters: OT calculation setup is incomplete',
  FACTORY_ROUNDING_POLICY_REQUIRED: 'Factory Masters: confirm OT rounding settings',
  DAILY_WAGE_MASTER_REQUIRED: 'Factory Masters: daily wage master required',
  MISSING_OR_OUTDATED_FACTORY_RULE: 'Factory Masters: pay rule revision is missing or outdated',
  MISSING_OR_OUTDATED_WAGE: 'Factory Masters: wage revision is missing or outdated',
  PAY_HISTORY_OUTDATED: 'FM: correct draft sources, then recalculate',
  COMP_OFF_PAY_RULE_REQUIRED: 'Factory Masters: compensatory off pay rule required',

  // Attendance & Duty
  ATTENDANCE_NOT_LOCKED: 'Attendance awaiting lock',
  MISSING_LOCKED_ATTENDANCE: 'Locked attendance missing',
  ATTENDANCE_CLASSIFICATION_REQUIRED: 'Attendance: status classification required',
  ATTENDANCE_ASSIGNMENT_MISMATCH: 'Attendance: assignment department/category mismatch',
  ATTENDANCE_LEAVE_CONFLICT: 'Attendance: shift conflicts with approved leave request',
  MISSING_LEAVE_SOURCE: 'Attendance: leave request record missing or unapproved',
  DUTY_TIMESTAMPS_REQUIRED: 'Attendance: entry and exit duty timestamps required',
  OVERLAPPING_DUTY_TIMESTAMPS: 'Attendance: overlapping duty timestamps detected',
  DOUBLE_DUTY_OT_CONFLICT: 'Attendance: double duty shift cannot include overtime',
  LOCAL_DUTY_TYPE_REQUIRED: 'Attendance: duty type must be Single or Double Duty',
  COMP_OFF_EVIDENCE_REQUIRED: 'Attendance: compensatory off shift evidence required',
  MAX_DUTY_DURATION_RULE_REQUIRED: 'Attendance: duty duration exceeds maximum allowed hours',

  // Leave
  LEAVE_PAYMENT_UNRESOLVED: 'Leave: payment treatment unresolved (must be Paid or Unpaid)',
  LOCAL_PAID_LEAVE_FORBIDDEN: 'Leave: paid leave not allowed for local category',
  LEAVE_WEEKLY_OFF_CLASSIFICATION_REQUIRED: 'Leave: weekly-off classification required',

  // Admin & Assignment
  MISSING_PAY_SOURCE: 'Admin: salary effective dates missing',
  MISSING_POLICY: 'Admin: salary calculation policy missing',
  INVALID_PAY_SOURCE: 'Admin: salary source is suspended, draft, or invalid',
  SALARY_CHANGE_PRORATION_REQUIRED: 'Admin: mid-month salary change requires proration policy',
  AMBIGUOUS_MONTH_POLICY: 'Admin: conflicting calculation policies found for month',
  ASSIGNMENT_HISTORY_REQUIRED: 'Admin: record dated payroll assignment history',

  // Statutory & Accounts
  STATUTORY_PROFILE_REQUIRED: 'Accounts: deduction setup required',
  EMPLOYEE_STATUTORY_PROFILE_REQUIRED: 'Accounts: employee statutory profile required',
  STATUTORY_PROFILE_PERIOD_COVERAGE_REQUIRED: 'Accounts: dated statutory profile coverage missing',
  AMBIGUOUS_EMPLOYEE_STATUTORY_PROFILE: 'Accounts: multiple overlapping statutory profiles',
  STATUTORY_SCOPE_REQUIRED: 'Accounts: statutory jurisdiction & establishment required',
  CANONICAL_SCOPE_REQUIRED: 'Accounts: canonical statutory scope link required',
  EMPLOYEE_CANONICAL_SCOPE_REQUIRED: 'Accounts: link employee to canonical statutory scope',
  VERIFIED_EMPLOYEE_PROFILE_REQUIRED: 'Accounts: statutory profile requires advisor verification',
  CONFIRMED_EMPLOYEE_PROFILE_REQUIRED: 'Accounts: statutory profile requires accounts confirmation',
  STATUTORY_RATE_REQUIRED: 'Accounts: statutory contribution rates missing',
  STATUTORY_MONTH_ROUNDING_REQUIRED: 'Accounts: statutory rounding rule required',
  STATUTORY_ELIGIBILITY_RULE_REQUIRED: 'Accounts: statutory eligibility rule required',
  STATUTORY_PT_SLAB_REQUIRED: 'Accounts: professional tax slab schedule required',
  STATUTORY_MONTH_CLOSE_REQUIRED: 'Accounts: close-of-month timing required for statutory deduction'
};

export function formatBlockerTitle(code) {
  if (!code) return '';
  if (labels[code]) return labels[code];
  return code
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export default function PayrollBlockers({ blockers = [] }) {
  const groups = groupPayrollBlockers(blockers);

  return (
    <div className="space-y-2 text-xs">
      <ul className="space-y-1.5" role="list">
        {groups.map((g, i) => {
          const title = formatBlockerTitle(g.code);
          return (
            <li key={`${g.code}-${i}`} className="flex items-start gap-2 leading-relaxed text-slate-800 dark:text-amber-200">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-slate-900 dark:text-amber-100">
                  {title}
                </span>
                {g.dates.length > 0 ? (
                  <span className="ml-2 inline-flex flex-wrap items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold bg-amber-500/15 text-amber-900 dark:text-amber-200 border border-amber-500/25">
                    {g.dates.length === 1 ? (
                      g.dates[0]
                    ) : (
                      <>
                        <span>{g.dates.length} affected dates</span>
                        <span className="text-amber-700/70 dark:text-amber-400/70">
                          ({g.dates[0]} → {g.dates.at(-1)})
                        </span>
                      </>
                    )}
                  </span>
                ) : g.count > 1 ? (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold bg-amber-500/15 text-amber-900 dark:text-amber-200 border border-amber-500/25">
                    {g.count} checks
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {blockers.length > 0 && (
        <details className="group mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/20 text-xs overflow-hidden transition-all">
          <summary className="cursor-pointer select-none px-3 py-2 font-medium text-amber-900 dark:text-amber-300 hover:bg-amber-500/10 flex items-center justify-between gap-2 transition-colors">
            <span className="flex items-center gap-2">
              <svg
                className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 transition-transform group-open:rotate-90 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              <span>Daily diagnostic details ({blockers.length})</span>
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70">
              Audit log
            </span>
          </summary>
          <div className="p-2.5 border-t border-amber-500/20 max-h-52 overflow-y-auto space-y-1.5">
            {blockers.map((b, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-amber-500/15 text-slate-800 dark:text-slate-200"
              >
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-xs text-slate-900 dark:text-amber-100">
                    {formatBlockerTitle(b.code)}
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                    {b.code}
                  </span>
                  {b.field && (
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-500/20">
                      {b.field}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] text-slate-600 dark:text-slate-400 shrink-0">
                  {b.date && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-900 dark:text-amber-200 border border-amber-500/25">
                      {b.date}
                    </span>
                  )}
                  {b.reference && (
                    <span
                      className="text-[10px] text-slate-500 max-w-xs truncate"
                      title={typeof b.reference === 'object' ? JSON.stringify(b.reference) : String(b.reference)}
                    >
                      {typeof b.reference === 'object' ? JSON.stringify(b.reference) : String(b.reference)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
