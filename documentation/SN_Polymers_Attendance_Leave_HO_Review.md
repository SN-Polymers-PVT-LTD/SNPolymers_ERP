# Phase 6 — HO attendance review and factory leave decisions

This implementation follows the approved final business-rule MD and all ten workbook sheets, plus subsequent client decisions: Local Single Duty remains the FM default; Double Duty has zero OT. No Phase 7 calendar, profile leave, payroll or payment features are included.

## Workflow and access

HO/Admin open **Factory → Attendance Review**, filter the queue by date range, factory category and Submitted/Returned for Correction/Locked state, then open a stored daily category sheet. Draft sheets are excluded. The queue counts persisted attendance rows; it does not substitute today's Employee Master roster. It includes Present, Absent, Leave/Medical, Comp Off, Management Issue, Holiday Eligible, summed stored OT, submitter name, state and relevant HO remarks. Ordering and pagination are deterministic.

Detail shows read-only attendance facts, India-time timestamps, stored Actual/OT Hours, Local duty type, holiday eligibility, exceptions, linked range leave, named recording/decision actors and scoped paginated history. HO does not re-enter attendance facts. Live active-role checks protect every endpoint; FM, JE, ZO and Accounts cannot use the HO queue/detail/actions. FM's existing backend module boundary and daily-entry workflow are unchanged.

Pending factory leave can be decided from a Submitted sheet that actually links that request. Approvals require a final Paid/Unpaid treatment; Local treatment is forced to Unpaid by the new scoped database wrapper and independently protected by existing guards. Rejection requires remarks. Requested leave type, dates and attendance facts remain unchanged.

- Rejection atomically returns every linked Submitted sheet using the existing leave guard.
- Approval with a different required attendance treatment atomically returns every affected linked Submitted sheet using the new approval correction trigger. Medical Leave retains its attendance status under either final pay treatment.
- Returned sheets require explicit FM correction and resubmission. A leave decision never automatically changes a row to Absent or another status.
- HO may return a Submitted sheet with required remarks, or **Review & Lock** when valid.
- Review readiness uses the existing database validator. The final transition validates again and writes HO Reviewed then Locked in the same transaction. The existing deferred constraint prevents committing an intermediate HO Reviewed state. There is no independent Lock endpoint, reopening or unlocking.
- Submitted rows remain frozen; Locked sheets and decided leave remain immutable. All exceptions are reviewed with the sheet, without separate approval entities.

## Persistence and transactions

Forward migration `099_hr_attendance_ho_review.sql` adds no tables, salary fields or payroll amounts. It retains Phase 3 persistence and effective-dated master references.

| Function | Responsibility |
| --- | --- |
| `hr_factory_leave_approval_correction()` | Private AFTER UPDATE trigger; returns submitted linked sheets whose attendance treatment differs from approved pay treatment. No attendance-row writes. |
| `decide_hr_factory_sheet_leave(...)` | Service-only HO/Admin decision wrapper; locks the existing category and sheet, requires Submitted state and a correctly linked factory request, then reuses `decide_hr_leave_request`. |
| `get_hr_attendance_review_state(...)` | Service-only HO/Admin read; excludes never-submitted sheets and invokes the existing lock validator for UI readiness. Validation conflicts become a blocking reason; unexpected errors propagate. |
| `get_hr_attendance_review_queue(...)` | Service-only HO/Admin paginated read; database aggregation over filtered sheet rows and UUID submitter enrichment. Strict date/category/state/pagination checks. |

Existing category/master/employee advisory locks serialize decisions, returns, submissions and reviews. Approval correction, rejection correction and audit inserts commit with the leave decision; any audit failure rolls back the business operation. Existing append-only `audit_log` records decisions, returns, edits/resubmissions, review and lock with the authenticated UUID actor. Existing scoped history retains previously linked leave history after explicit unlinking. No new approval or history entity is introduced. Review readiness is advisory; the transactional mutation remains authoritative if another operator acts after detail loads.

## API

All paths are relative to `/api/v1/auth/hr/attendance`; all new endpoints require HO/Admin.

| Method/path | Input / result |
| --- | --- |
| `GET /review-queue` | Optional `from_date`, `to_date`, `employee_category`, `status`, `page`, `limit`; returns summary sheets and pagination. |
| `GET /sheets/:sheetId/review-detail` | Stored sheet, rows with linked leave, `review.can_review`/`blocking_reason`, and UUID-to-display-name actor map. |
| `POST /sheets/:sheetId/leaves/:leaveId/decision` | `{ decision: Approved\|Rejected, pay_treatment: Paid\|Unpaid, remarks? }`; returns decided request. Rejection remarks required. |
| `POST /sheets/:sheetId/return` | `{ remarks }`; returns Returned for Correction sheet. |
| `POST /sheets/:sheetId/review` | `{ remarks? }`; returns Locked sheet after atomic review. |

Existing `GET /sheets/:sheetId/history` supplies scoped, paginated audit history. Actors are server-owned. Strict Zod schemas reject extra fields; existing database error mapping provides stable 400 validation, 403 authorization, 404 missing/scoped identity and 409 state/integrity conflicts. No FM allowlist expansion is needed because these paths stay within the attendance router and have additional HO-only guards.

## Files

- New migration: `backend/src/db/migrations/099_hr_attendance_ho_review.sql`.
- Backend: `hrAttendance.controller.js`, `hrAttendance.routes.js`, `hrAttendance.schema.js`.
- RPC contracts: `backend/tests/manifests/rpcAllowlist.json`, `rpcManifest.generated.js`. Schema/index regeneration produced no changes.
- Tests: new `backend/tests/vitest/regression/hrAttendanceReview.test.js`; existing `hrAttendanceLeave.test.js` now expects automatic return for changed approval treatment.
- Frontend: new `AttendanceReviewQueue.jsx`, `AttendanceReviewDetail.jsx`, `AttendanceReview.test.jsx`; existing `hrAttendanceApi.js`, `App.jsx`, `App.test.jsx`, `Sidebar.jsx`, `TopNavbar.jsx`.
- This handoff document.

## Verification

Local Docker Supabase was started and all ordered migrations applied. Backend unit/contracts and attendance, factory master, Employee Master, Permanent Pay Structure and auth-whitelist regressions passed: **29 files / 213 tests**. These include service-only privileges, live role/session reassignment, HTTP access matrix, queue summary/filter/page contracts, linked-request scope, approval/rejection, Local Unpaid, automatic returns, explicit correction/resubmission, atomic review/lock, no committed HO Reviewed, locked immutability, separate-connection concurrency and forced audit rollback.

Full frontend tests passed: **146 files / 992 tests**. New review tests exercise the real API wrappers with transport fixtures; App tests verify HO/Admin navigation and FM/JE/ZO/Accounts denial. Existing FM interaction/integration tests remain green. Final focused rechecks passed: 56 database/API tests, 84 frontend tests, and 61 App navigation tests after extending queue/detail denial coverage. Production build passed. ESLint reported zero errors and one existing `SubcontractEstimates.jsx` hook-dependency warning.

Browser verification against the local backend/database used synthetic HO/FM accounts and two submitted sheets. Verified queue counts, overnight timestamps and stored hours, paid medical approval then Review & Lock with named audit actors; verified rejection leaves Medical Leave unchanged while returning the sheet, FM explicitly corrects to Absent, resubmits, and HO locks submission 2. Temporary sessions/accounts are deactivated and local servers/stack stopped after verification; audit records are preserved.

No business-rule blocker was found for Phase 7. Phase 7 remains unimplemented. No commit or push is performed.
