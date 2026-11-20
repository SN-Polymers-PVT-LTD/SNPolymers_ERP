# Factory work calendar

Approved workflow: one factory selection, Sunday off from an explicit start date, and dated day-off/working-day exceptions. No monthly publication. Admin/HO and active Factory Managers save immediately; Accounts can read. Factory Managers retain access to both factories under migration 131; no separate grant system is introduced. This supersedes the older proposal for manual monthly calendar publication for factories only.

## Resolution and pay

The read-only backend resolver supplies each applicable date on demand: latest date exception, then existing published evidence, then Sunday off/weekday working. RESET removes the override and exposes existing evidence or the normal week. Before initialization, only existing explicit evidence applies. No automatic setup or UAT changes are made by migrations.

Permanent weekly offs/holidays retain monthly salary, never an additional daily wage. Casual/Local off days do not automatically earn wages; approved paid daily leave still uses the existing decision/evidence path. A working day does not mean attendance Present. Missing attendance is permitted only on an explicitly resolved managed off day without a leave request; duplicate, unlocked and conflicting rows remain blockers. Actual worked duties retain attendance, overtime and category rules. Local holiday pay remains forbidden. Holiday duty still requires the attendance eligibility flag; a managed calendar also validates that an added holiday exists. No automatic substitute Monday for a Sunday holiday.

A paid rest day excludes a full-day absence from LOP, but does not erase a missing-hours deduction for an actual short worked duty. Calendar resolution is per dated assignment department/group, including factory transfers. Date arithmetic uses business dates without timezone shifts.

## Audit and locking

Migrations 162/163/164 add append-only factory_calendar_revisions, expected-version saves, scoped private resolution and permission checks. Existing published calendar days remain untouched. Once a managed calendar covers a date, the older publisher cannot bypass its audited writer. Historical exceptions may be recorded on/after the start date if no locked source window is affected. Permanent locked split runs protect complete source months; daily runs protect their interval. Shared factory-calendar advisory fences acquired by payroll review/finalization conflict with exclusive calendar writes. Revision IDs/date/classification/entitlement participate in saved source evidence and change detection.

Unsubmitted drafts refresh on the existing next open/focus/source-check mechanism. Submitted, returned and locked snapshots retain existing workflow protection. Saving a calendar does not approve attendance, leave, payroll, cutoff or payments.

## UI

Factory Masters: Work Calendar. Enable Sunday off with Applies from; select a month; add a named day off, mark a working date or restore the normal schedule. Read-only roles cannot save. Payroll detail links to this page; cutoff remains independent. Office calendars retain their older explicit publishing path pending a separately scoped change.

## Verification

Local tests cover recurring Sundays/leap years, overrides/reset, legacy precedence, factory isolation and daily entitlement, authorization/stale version/immutability, source RPC integration, source locking, locked-month boundaries, missing attendance and short-duty deductions. Frontend tests cover initial setup, exception save conflict, read-only roles, loading/retry and shared navigation. Run generated schema/RPC/index contracts against isolated local Supabase. Development/UAT deployment and human payroll acceptance are separate from isolated local verification.
