# Factory Manager Daily Attendance — Phase 4 + 5

Implemented on `employee_management`. This pass adds the FM attendance vertical slice to the existing Phase 1/2 roles/masters and Phase 3 persistence. The newer client decision remains authoritative: **Local Double Duty has zero OT, including duty beyond 24 hours; FM explicitly classifies duty without a duration threshold.**

## API and access

All paths below are under `/api/v1/auth/hr/attendance`. Routes use `verifyJwt`, the existing live HR-role guard and strict Zod validation. Current session identity supplies RPC actor IDs; clients cannot supply actors, source, workflow state, calculated hours or revision IDs.

| Method / path | Behaviour | Access |
| --- | --- | --- |
| GET `/roster?date=&employee_category=` | Active Employee Master roster, joined on/before date; factory categories only | FM, Admin, HO |
| GET `/sheet?date=&employee_category=` | Side-effect-free load; missing sheet returns `sheet: null` | FM, Admin, HO |
| GET `/sheets/:sheetId` | Stored sheet/rows, narrow employee identity, linked/covering factory leave, saved rule hours/holiday availability | FM, Admin, HO |
| GET `/sheets/:sheetId/history?page=&limit=` | Paginated sheet/row/covering or previously linked factory-leave audit events with actor names | FM, Admin, HO |
| POST `/sheets` | Create or populate editable sheet through existing idempotent RPC | FM, Admin |
| PUT `/sheets/:sheetId/rows` | Atomic nonempty batch of employee-keyed patches | FM, Admin |
| POST `/sheets/:sheetId/leave` | Create (`leave_id: null`) or edit Pending factory range request and link its daily row atomically | FM, Admin |
| POST `/sheets/:sheetId/submit` | Submit/resubmit through existing lifecycle RPC | FM, Admin |

FM's backend mount allowlist is extended only for this attendance router. Existing employee administration, Permanent Pay Structure, generic audit, project and financial boundaries are preserved. Sheet/history UUIDs scope reads to the factory attendance domain; self-service leave and employee/pay master audits are excluded. Roster/row reads fetch bounded database pages internally to avoid PostgREST's 1000-row truncation. History pagination has a deterministic timestamp/UUID order. Row audit links preserve request history after explicit unlinking and later range corrections.

Stable database error mappings: missing entity 404 `ATTENDANCE_NOT_FOUND`; authorization 403 `FACTORY_ACCESS_DENIED`; overlapping leave 409 `LEAVE_RANGE_CONFLICT`; protected state/business conflict 409 `ATTENDANCE_CONFLICT` (including submitting a row detached from an active covering leave); invalid database values 400 `INVALID_ATTENDANCE`. Zod validation uses the existing 400 response format. Unknown database failures produce a generic 500.

## Transaction and UI design

Migration **098** adds only the service-only `save_hr_factory_attendance_leave` RPC. It takes the existing category locks, unlinks the selected editable row, invokes the existing leave-save RPC, and links/maps its leave status while clearing duty timestamps, duty type and holiday eligibility. Every change and append-only audit event commits together. Invalid ranges, overlap, other protected linked dates, role/state failures and audit insertion failure roll back the entire operation. Other linked sheets remain guarded; changing a Pending request's type/range cannot silently change them.

No Phase 3 table/calculation/lifecycle definitions were replaced. Local pay/holiday rules, effective revision resolution, timestamp calculations, locking and leave rejection semantics remain database-owned. A new request must cover the selected sheet date and its employee must already belong to the sheet roster. Existing Approved range leave can be explicitly attached through the bulk row patch, without creating another request.

`/factory-attendance` reuses TanStack Query, `authApi`, shared controls/tables/pagination, and existing role guards. Daily Attendance appears in desktop/mobile Factory navigation, the Factory dock, and the FM dashboard. HO can read; FM/Admin can edit Draft/Returned sheets. Full local datetime inputs are explicitly India time; outgoing values contain `+05:30`. Exit date is entered explicitly for overnight/24-hour duty. Only edited fields are sent; saved Actual/OT Hours and applicable standard hours come from the database.

Mark All Present initializes unmarked rows (Local defaults to Single Duty) and preserves recorded exceptions/leave. It does not invent timestamps. Save Draft must precede submission or independent leave entry; date/category selectors and daily controls are protected during writes/leave entry. Failed saves retain user edits. Submit uses the saved sheet; no implicit save followed by submit. Submitted/Locked sheets are read-only; Returned sheets show the last return remarks and allow explicit correction/resubmission. Rejected leave stays unchanged until FM corrects the row. History is opt-in and paginated.

This pass does not add HO approval/return/review endpoints or UI, a monthly calendar, profile self-service leave, payroll, uploads or reopening. The browser correction test exercises existing Phase 3 HO RPCs directly on synthetic local records.

## Files

Added:

- `backend/src/db/migrations/098_hr_factory_attendance_leave_entry.sql`
- `backend/src/routes/hrAttendance.routes.js`
- `backend/src/controllers/hrAttendance.controller.js`
- `backend/src/validation/hrAttendance.schema.js`
- `backend/tests/vitest/regression/hrAttendanceApi.test.js`
- `frontend/src/api/hrAttendanceApi.js`
- `frontend/src/pages/hr/DailyAttendance.jsx`
- `frontend/src/pages/hr/DailyAttendance.test.jsx`
- `frontend/src/pages/hr/DailyAttendance.integration.test.jsx`
- this handoff document

Updated:

- `backend/src/app.js`, `backend/src/middleware/verifyJwt.js`
- `backend/tests/manifests/rpcAllowlist.json`, `rpcManifest.generated.js` (schema/index manifests regenerated without changes)
- `frontend/src/App.jsx`, `frontend/src/App.test.jsx`
- `frontend/src/components/Sidebar.jsx`, `TopNavbar.jsx`
- `frontend/src/pages/Dashboard.jsx`

## Verification — 30 September 2026

- Fresh local Docker Supabase: all 106 ordered migrations applied, including 098; RPC manifest regenerated (25 tracked functions).
- Backend: **28 files / 201 tests passed**, covering all unit/contracts, attendance/leave foundation and concurrency, new attendance API (14 cases), factory masters, employees, permanent pay, and auth regressions. The composed RPC has explicit audit-failure rollback and anon/authenticated denial tests.
- Frontend focused: **4 files / 78 tests passed** (App routes/navigation, Daily Attendance interactions, real API-wrapper integration, Factory Masters).
- Full frontend run with two workers: **976/977 passed**. The existing requisition workflow retry test timed out; its isolated rerun passed all seven cases. An earlier default-worker run had three route-loading timeouts, all passing when rerun together. No unrelated workflow/test timing refactor was made.
- Changed frontend files pass ESLint. Full frontend lint reports zero errors and one existing hook-dependency warning in `SubcontractEstimates.jsx`; production build passes with the local API URL. `git diff --check` passes.
- Running local backend/frontend browser walkthrough: create/load, Mark All Present, overnight 10h/2h OT, Management Issue, medical leave save, submission freeze, HO rejection without automatic Absent, explicit FM correction/resubmission/history, Local 24h Double Duty with zero OT, horizontal table scrolling, HO read-only access and JE direct-route denial.

Focused reproduction, with Docker Supabase running and ordered migrations applied:

```bash
cd backend
TELEGRAM_BOT_TOKEN= GMAIL_USER= GMAIL_APP_PASSWORD= ADMIN_EMAIL= \
  node_modules/.bin/vitest run tests/vitest/unit tests/vitest/contracts \
  tests/vitest/regression/hrAttendanceApi.test.js tests/vitest/regression/hrAttendanceLeave.test.js \
  tests/vitest/regression/hrFactoryMasters.test.js tests/vitest/regression/hrEmployees.test.js \
  tests/vitest/regression/hrPayStructures.test.js tests/vitest/regression/authWhitelist.test.js
cd ../frontend
node_modules/.bin/vitest run src/App.test.jsx src/pages/hr/DailyAttendance.test.jsx \
  src/pages/hr/DailyAttendance.integration.test.jsx src/pages/hr/FactoryMasters.test.jsx
VITE_API_URL=http://localhost:5000/api/v1/auth npm run build
```

No business-rule clarification blocks the next authorized phase. The full frontend sweep's timing failure remains a verification limitation. Temporary backend/frontend servers and Docker Supabase were stopped after verification, with Docker data backed up. Synthetic browser accounts/employees were deactivated and their sessions revoked; audit/attendance history was preserved. No commit or push was made.
