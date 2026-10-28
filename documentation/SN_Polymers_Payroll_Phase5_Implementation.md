# Payroll Phase 5 — registers, reporting and diagnostic payslips

Implemented on `employee_management` against the v1.4 business contract, especially
§§11.4, 13, 14 and 17.5. Financial finalization, payment, bank debits, statutory
posting and accounting settlement remain disabled. No commits or pushes are part
of this delivery.

## Architecture and evidence

Forward-only migration **113_payroll_saved_salary_register.sql** adds one
service-role-only reporting RPC, `get_payroll_salary_register`. No new tables,
salary engine, payment state machine or approval workflow were introduced.
Existing immutable `payroll_review_revisions` supply saved calculation amounts;
existing salary rows supply current review states, versions and return reasons.

The register distinguishes `NO_CALCULATION`, `SAVED_DIAGNOSTIC`,
`SUPERSEDED_CONTENT`, `WITHDRAWN` and `LOCKED_SNAPSHOT_UNAVAILABLE`. Corrected
content cannot inherit amounts from an earlier calculation revision. Cancelled
rows and Locked rows without a genuine final financial snapshot do not contribute
salary amounts. The register retains historical employee name/code from the
calculation where present and the canonical employee/row/run UUIDs.

Every displayed amount is saved diagnostic evidence. `source_freshness` is
`NOT_REVALIDATED`: publishing a new master or changing attendance/leave cannot
silently rewrite saved amounts. Use the existing review screen to compare current
sources, revalidate and recalculate. Multi-period/date filters select **whole
salary rows intersecting the interval**, including their original full periods;
they do not invent proration. Overlapping drafts can duplicate entitlement, so
these subtotals are explicitly not liabilities or payment instructions.

Summaries group every filtered row by department and review state, independent
of the current page. PostgreSQL numeric sums return decimal strings. Known gross
subtotals show only available gross values, with the number of known rows; a
complete gross total is unavailable when any row in that group lacks gross.
LOP is reported only when the saved gross calculation is complete. EPF, ESI, PT
and net remain null/unavailable because statutory profiles, deductions and final
net calculations are not complete; they are never replaced by zero.

## UI and endpoints

`/hr/payroll/register` provides search by employee name/code, department/group,
review-state and intersecting period filters, pagination, department/state totals,
and preparation/review progress (Draft, Calculated, Accounts pending, HO pending,
Returned, Locked, Withdrawn). Current return reasons remain visible.

Employee drill-down navigates to `/hr/payroll/review?row=<uuid>`, reusing the Phase 4
review APIs, correction controls, revision comparisons, source references and
reviewer history. The shared `SalaryPreview` now displays agreed contractual
components as readable evidence, including blocked Special Packages; these are
not additional earnings and do not modify calculations.

Authenticated reporting endpoints:

- `GET /hr/payroll/reports/register`: filters plus page/limit (maximum 100).
- `GET /hr/payroll/reports/export`: the same filters; `format=xlsx|html` and
  `report=register|departments`; export pagination/client monetary inputs rejected.
- `GET /hr/payroll/rows/:rowId/payslip?mode=diagnostic|official`.

The current database actor role is checked in the backend and RPC. FM sees both
SNP/Fabric only through current grants, never office payroll. Explicit forbidden
run/department selections fail; broad selections omit unauthorized rows. Saved
cross-factory calculation evidence is excluded when any referenced department is
outside the FM's grants. Role and grant changes cannot be preserved by an older
session token. Report reads serialize with grant revocation and use one data
snapshot for rows and totals. Report/export responses use `Cache-Control: no-store`.
No reporting RPC is executable by anon/authenticated database roles.

## Export formats

Excel salary registers include Report Information, Salary Register, Salary
Components, Source Evidence, and Department Summary worksheets. Columns use the
client sample's employee/category, salary, LOP, statutory and net terminology,
with explicit periods, groups, review/payment status, revision and fingerprint.
There are no hardcoded statutory rates, invented attendance counts or example
spreadsheet deductions. Contractual BASIC/STAFF_WELFARE/other components appear
as separately labelled component evidence rather than additional earned amounts.

Department exports include information and department/state summaries. Printable
HTML summaries respect the selected report type: department reports contain only
aggregate tables; register reports also include employee rows. Both include filters,
department/state totals, generation time and the diagnostic notice; open the downloaded document and use browser print
(or Save as PDF). Diagnostic employee payslips can be printed from the register.

All monetary cells are **exact decimal text**, including values beyond Excel's
numeric precision. Excel formula-leading text is escaped, HTML values are escaped,
and long source evidence is split into ordered parts of at most 30,000 characters
rather than truncated. Empty selections produce valid headers and no fabricated
totals. Up to 10,000 matching rows are supported; larger selections return HTTP
413 `PAYROLL_EXPORT_TOO_LARGE` before generating bytes, with a request to narrow
the period/department. Register workbooks also reject more than 100,000 component
lines with `PAYROLL_EXPORT_DETAILS_TOO_LARGE` before workbook allocation, protecting
Excel row limits and export memory. No partial export is silently presented as
complete.

## Payslip restrictions and recovery

Diagnostic payslips use the saved immutable calculation for the current content
version and are visibly marked **DIAGNOSTIC PREVIEW — NOT AN OFFICIAL PAYSLIP**.
They show original periods/months, components, LOP, blockers, source references,
review/payment state and unavailable net salary. They are unavailable for missing
or superseded calculations, withdrawn rows, and Locked rows lacking a final
financial snapshot. Current source errors are displayed without removing saved
evidence.

Official mode always returns HTTP 409 `OFFICIAL_PAYSLIP_UNAVAILABLE`. The present
schema has no enabled finalization or certified immutable Locked financial
snapshot. Neither a diagnostic revision nor a row merely labelled Locked is
sufficient proof. Future official output must explicitly bind to that snapshot;
it must never resolve live sources or reinterpret an old salary.

Migration **112_payroll_review_source_recovery.sql** is retained: the detail read
returns metadata/history and structured `source_error` for source parameter
failures, while scope/authorization errors still fail closed. Correction,
withdrawal and return can remain available without resolving a salary preview;
calculation and source-dependent approvals are withheld. No ownership transfer
was introduced for legacy Admin-created drafts. They remain visible with their
original owner and the existing permitted actions; handoff requires a separately
approved policy.

## Files and verification

New implementation files:

- `backend/src/db/migrations/113_payroll_saved_salary_register.sql`
- `backend/src/controllers/payrollReports.controller.js`
- `backend/src/domain/payroll/reports.js`
- `backend/src/validation/payrollReports.schema.js`
- `frontend/src/api/payrollReportsApi.js`
- `frontend/src/pages/hr/PayrollRegister.jsx`
- `frontend/src/components/payroll/PayrollPayslip.jsx`

Existing payroll routes, test command, RPC allowlist/manifest, App routes,
Sidebar, shared SalaryPreview and Review deep-link initialization were extended.
The previously uncommitted migration 112 recovery implementation/tests are
preserved. Graphify's generated graph was updated after code changes.

Regression coverage includes exact all-page register totals, review-state and
multi-period selections, withdrawn/superseded exclusions, access/grant revocation,
malicious search/export values, exact large decimals, empty/large exports and
explicit oversize rejection, evidence chunking, diagnostic/official payslip
restrictions, legacy Admin ownership, role navigation, pagination, filtered
exports, printing and correction recovery. Executed verification (12 October 2026):

- Complete isolated payroll suites: **169/169**, 15 files.
- Backend unit suites: **177/177**, 20 files.
- Database schema/RPC/index plus employee/pay-structure regressions: **24/24**, 5 files.
- Attendance, leave, Accounts lifecycle and export compatibility: **84/84**, 5 files
  (before the final two export-unit additions, which passed in the final payroll run).
- Affected payroll preparation, previews, review, reporting and navigation UI: **119/119**, 5 files.
- Full frontend: **1114/1115**, 155 of 156 files passed. The remaining failure is
  unchanged `Requisitions.workflow.test.jsx`, JE create/retry modal dismissal at
  line 103. It also reproduces on a temporary untouched archive of Phase 4 commit
  `c17dfc7` (**6/7** in that file), confirming it is outside this change.
- Final production build passed. Lint: zero errors, one existing
  `SubcontractEstimates.jsx:128` hook-dependency warning. `git diff --check` passed.

The shared fixture stack was not migrated, stopped or reset. Isolated payroll
Supabase remains running; tests only clean up/deactivate their own synthetic
records. Generated manifests contain 57 tables, 51 RPCs and 86 indexes.

## Remaining prerequisites

Genuine employee statutory profiles/canonical enrolment scope, legally validated
applicable deductions and statutory-month reconciliation, complete final net,
monthly entitlement/coverage finalization, and an immutable Locked financial
snapshot are still required before official payslips or financial register
exports can be enabled. Payment allocation/disbursement, bank debits, statutory
liabilities and accounting settlement remain outside Phase 5. Diagnostic exports
must not be imported as payment instructions.
