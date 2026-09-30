# Attendance and leave — Phase 3 database foundation

This phase builds on migrations 093–096 on `employee_management`. Approved sources are `SN_Polymers_Factory_Attendance_Leave_Business_Rules_Workflow_Final.md`, all ten sheets of the final client workbook, and the subsequent user clarifications. Single/Double Duty is explicitly classified by FM; no duration threshold is imposed.

There are no new Express routes, controllers for this module, frontend views, uploads, reopening workflow, or payroll amounts. Permanent Pay Structure and Phase 1/2 role/master definitions are unchanged.

## Tables and invariants

Migration `097_hr_attendance_leave_foundation.sql` adds:

| Table | Stored facts and relationships |
| --- | --- |
| `hr_attendance_sheets` | Unique attendance date/category; Draft/Submitted/Returned for Correction/HO Reviewed/Locked state; submission count; submit/return/review/lock actors, times, and remarks. Four factory categories only. |
| `hr_attendance_rows` | Unique sheet/employee; Employee Master UUID; nullable unmarked status; full entry/exit timestamps; DB-owned actual/OT hours; local duty type; holiday eligibility; optional direct leave-request UUID; applicable pay-rule/wage revision UUIDs; remarks and change actor/time. |
| `hr_leave_requests` | One employee/date-range request; category at recording time; Factory Manager/Self-Service source; type, reason, Pending/Approved/Rejected decision, pay treatment, and recording/decision actors/times. |

Foreign keys use canonical Employee Master/account/master UUIDs and restrict deletion. No employee names, salary values, or duplicate account/category master records are introduced. Pay treatment exists on the leave request, rather than being stored again on each attendance row. Sheet/row identity is immutable and deletion is prohibited; decided leave requests are immutable.

Pending/Approved ranges use a partial GiST exclusion constraint on employee/date range. Dates are inclusive: ranges sharing a day overlap. Rejected requests no longer reserve the range. `btree_gist` is the supporting database extension. Queue, employee-calendar, leave-link, sheet uniqueness, row uniqueness, and exclusion indexes are included in generated contracts.

## Calculations and configuration snapshots

Attendance timestamps are `timestamptz`. RPC inputs require full timestamps with explicit offsets; attendance date is the entry date in `Asia/Kolkata`. Exit must be later than entry. Same-day, overnight, and 24-hour duty are stored as one row, without splitting midnight crossings.

The database sets:

```text
Actual Hours = elapsed timestamp seconds / 3600

For non-Local categories and Local Single Duty:
OT Hours     = max(0, Actual Hours - applicable Standard Duty Hours)

For Local Double Duty:
OT Hours     = 0
```

Double Duty is a separate duty and pay classification for Local Daily-Wage Workers and does not accumulate OT. No OT-after-24h or Double-Duty-plus-OT stacking is applied. Double Duty continues to retain its configurable Double Duty Multiplier in the Pay Rule Master for downstream payroll consumption.

No rounding is applied to the stored attendance facts. OT Enabled remains pay-rule configuration for later payroll; it does not replace the approved hours formula.

Applicable revision IDs are the latest category revision effective on/before the sheet date. Row edits and submission refresh them while the sheet is editable. Submission refreshes every row under the Phase 2 master locks, so an applicable revision added during drafting is resolved consistently. Submitted/locked records retain their persisted references and calculations. Permanent categories never receive a wage-master reference.

Unmarked/partial working rows can be saved as drafts. Submission requires all statuses, applicable rules, wages for wage-based categories, valid complete working timestamps, Local working duty classification, and leave links for leave statuses. Management Issue may record reduced hours or a complete stoppage; a partial timestamp pair cannot be submitted. Non-working rows have blank timestamps and zero hours. Local holiday eligibility and paid leave are rejected. Duty classification is local-only and applies to working rows, without an invented duration threshold; Local Double Duty yields zero OT hours, while Local Single Duty records OT beyond applicable standard duty hours (normally 12h).

## Transactional operations

All five RPCs are executable only by `service_role`. The three tables give that role SELECT only, with no direct INSERT/UPDATE/DELETE privileges. Anonymous/authenticated database roles cannot access the tables or execute these operations. RPCs are security definers with fixed search paths; actors must be supplied from the authenticated backend identity, never accepted as an end-user field. Database guards resolve and lock the actor's current active ERP account/role.

| RPC | Actor / effect |
| --- | --- |
| `populate_hr_attendance_sheet(p_date,p_category,p_actor_id)` | FM/Admin; create/reuse an editable sheet and populate eligible rows atomically. |
| `save_hr_attendance_rows(p_sheet_id,p_rows,p_actor_id)` | FM/Admin; atomically apply a strict batch of partial row edits and calculate hours/revision IDs. |
| `transition_hr_attendance_sheet(p_sheet_id,p_action,p_remarks,p_actor_id)` | FM/Admin submit; HO/Admin return or review. `review` performs HO Reviewed and Locked in the same transaction. |
| `save_hr_leave_request(p_leave_id,p_employee_id,p_source,p_from_date,p_to_date,p_leave_type,p_reason,p_pay_treatment,p_actor_id)` | Create or edit Pending leave. FM/Admin records factory leave; a linked HO/Projects employee records their own self-service leave. Null leave ID creates a request. |
| `decide_hr_leave_request(p_leave_id,p_decision,p_pay_treatment,p_remarks,p_actor_id)` | HO/Admin; decide once and return all affected submitted sheets on rejection atomically. |

Row-edit payload keys are `employee_id`, `attendance_status`, `entry_timestamp`, `exit_timestamp`, `duty_type`, `holiday_pay_eligible`, `leave_request_id`, and `remarks`. Omitted keys preserve the existing value; explicit null clears nullable fields. Hours, revision IDs, identity/audit fields, and unknown keys are rejected. Batches containing an invalid row roll back completely.

Factory operations serialize per category, acquiring the category lock, then the existing pay-rule and wage-master locks, before sheet/leave writes. Leave writes additionally serialize per employee. This prevents overlapping exclusion-index insert probes from deadlocking and makes row edits, submission, review/return, and leave date/decision changes consistent. Different categories/employees can proceed independently within this scope.

Roster population includes only Active employees of that category whose joining date is at/before the sheet date. New eligible employees require population before submission. Previously recorded rows are preserved if directory status changes later. New roster rows reuse a covering Pending/Approved factory leave request; otherwise they remain unmarked. They never default to Present.

Active status gates population; it does not prevent recording leave to correct an existing historical row after employee inactivity. The actor must still be active/authorized, and the leave cannot begin before the employee's joining date.

## Lifecycle and leave

```text
Draft -> Submitted -> HO Reviewed -> Locked
Submitted -> Returned for Correction -> Submitted
```

Review and locking create separate audit events but commit together. A deferred constraint trigger prevents a transaction from committing HO Reviewed without Locked. Submission/return require appropriate current roles, and return requires remarks. Submitted sheets/rows are frozen until returned; Locked sheets/rows cannot be edited, deleted, or reopened.

Leave links must belong to the row employee, have the factory source/category, cover the sheet date, and match the applicable leave status/type/treatment. A request may be decided before the daily sheets for its range exist; later population references the same request. Compensatory Off and other ordinary exceptions do not create approval entities.

Pending leave facts linked to a Submitted sheet cannot be edited until return. Changes cannot shrink a range or change its type in a way that invalidates an existing link. Pending linked leave blocks locking. Approved leave must have a final Paid/Unpaid treatment, consistent with an explicit Paid/Unpaid attendance status. Medical Leave may have either approved treatment. Local treatment is always Unpaid.

The original requested type is preserved when HO decides pay treatment. For example, a Paid Leave request approved as Unpaid remains that request; its final attendance status must be Unpaid Leave. HO returns an already-submitted sheet for FM to correct explicitly before review/lock. Later population of a new sheet uses the approved treatment. Medical requests retain Medical Leave attendance status with either treatment. Approval itself does not silently edit attendance rows.

Rejection preserves the leave request and attendance statuses. It returns affected Submitted sheets with decision remarks; draft/returned sheets already remain editable. Rejected links block resubmission until FM explicitly corrects the attendance/leave facts. No conversion to Absent occurs.

## Audit and verification

Existing append-only `audit_log` receives full previous/new snapshots and UUID actors for sheet creation/transitions, attendance creation/edits, and leave creation/changes/decisions. Audit insertion failure rolls back the business operation. Two new module labels (`HR Attendance`, `HR Leave`) are excluded from non-Admin generic analytics/audit reads, preserving the existing HR privacy pattern until Phase 4 provides scoped history reads.

Local Docker verification on 30 September 2026:

- Migration 097 applied after the existing 104 migrations; the final SQL also executed in full inside a rollback-only transaction.
- Phase 3 regression suite: 30 tests passed, including seven separate-connection concurrency cases, privilege boundaries, Supabase service-only RPC invocation, direct SQL guards, overlap conflicts, forced audit-failure rollbacks, historical correction, and requested-type/pay-treatment preservation.
- All backend unit/contracts plus attendance, factory master, employee, permanent-pay, and auth-whitelist regressions: 27 files / 187 tests passed.
- Schema/RPC/index manifests regenerated; `git diff --check` passed.

Reproduction from `backend/` with local Docker Supabase running and migrations applied:

```bash
GMAIL_USER= GMAIL_APP_PASSWORD= ADMIN_EMAIL= TELEGRAM_BOT_TOKEN= node_modules/.bin/vitest run \
  tests/vitest/unit tests/vitest/contracts \
  tests/vitest/regression/hrAttendanceLeave.test.js \
  tests/vitest/regression/hrFactoryMasters.test.js \
  tests/vitest/regression/hrEmployees.test.js \
  tests/vitest/regression/hrPayStructures.test.js \
  tests/vitest/regression/authWhitelist.test.js
```

Phase 4 should add narrow authenticated API reads/wrappers around these operations, use current session actor IDs, map PostgreSQL validation/uniqueness/exclusion errors to stable 4xx responses, enforce scoped reads, and extend the FM backend mount allowlist when its attendance/leave routes actually exist. No backend allowlist extension is needed for this DB-only phase. There is no outstanding business-rule clarification or database blocker for Phase 4.
