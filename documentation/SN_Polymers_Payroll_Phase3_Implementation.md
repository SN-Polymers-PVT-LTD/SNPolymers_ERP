# Payroll Phase 3 — read-only calculation previews

Implemented against v1.4 on `employee_management`, starting from `75eca09`.
The initial Phase 3 implementation is now recorded in `9fc2427`. Review
corrections to that baseline remain uncommitted; no commit/push was made during
this review. This phase stops at diagnostic salary previews.

## Architecture and inputs

Migration **109_payroll_read_only_preview_sources.sql** adds the private decimal
JSON serializer and two service-only RPCs:

- `get_payroll_preview_sources(row_id, actor_id)`: current database role and
  department/factory-grant checks, followed by one SQL statement/MVCC snapshot
  containing the existing draft employee row, latest complete evidenced
  assignment/pay histories, dated pay structures, attendance, leave, factory
  masters, published policies, an empty statutory-rule list until evidenced
  employee profiles exist, other
  employee/month draft rows and existing finalized coverage/month ledger state.
- `list_payroll_preview_runs(actor_id, page, limit)`: a paginated selection using
  existing foundation scope rules. FM sees explicitly granted factories;
  Accounts/HO/Admin retain their existing payroll read scope.

History, not today's employee category/status or latest salary alone, determines
applicability. Superseded salary structures remain usable through their evidenced
historical applicability. Missing/conflicting dates, changed assignment/pay
history, non-Locked/duplicate/misattributed attendance, missing or changed wage/
rule references, pending or overlapping leave and mismatched attendance/leave
references produce explicit dated blockers. A historical null-factory Local
sheet is not reassigned. Source numeric fields, including fractional duty hours,
cross JSON as decimal strings.

Permanent previews retrieve whole affected calendar months for entitlement/LOP
reconciliation. Daily-wage previews retrieve requested dates plus previous-day
CO evidence. Cross-department evidence is subject to current read scope checks,
including the prior duty. Preview source windows are bounded to approximately
24 months to prevent unbounded source scans. No required attendance/calendar
entitlement is inferred from a missing sheet.

The pure engine is split into `exact`, `sources`, `factory`, `permanent`,
`reconciliation`, `statutory` and `preview` under `backend/src/domain/payroll/`.
It reuses Phase 2 `resolveMaster` and `calculationReadiness`; no second policy or
statutory configuration system was added. Rational BigInt arithmetic retains
repeating daily/hourly rates until the configured rounding stage. HALF_UP uses
nearest/ties away from zero; HALF_EVEN uses nearest/ties even; DOWN truncates
toward zero; UP rounds away from zero. Precision and rounding placement come
from the published policy, never browser input. LOP supports DAILY rounding and
AGGREGATE/MONTH rounding. A published LINE LOP policy remains valid master data
but returns `LOP_LINE_ROUNDING_UNSUPPORTED` when LOP is needed, pending an approved
definition of a deduction line. It is never silently treated as monthly rounding.

## Implemented formulas

| Case | Preview formula / behavior |
|---|---|
| SNP/Fabric Casual Present | Effective daily wage once, plus eligible OT/premium |
| Casual holiday work | Base + `(holiday_multiplier − 1) × daily wage`; 1.5 means **1.5 total**, not 2.5 |
| Local Single Duty | Effective daily wage once, plus enabled eligible stored OT |
| Local Double Duty | Effective daily wage × configured double-duty multiplier (2 in test fixtures); OT must be zero; no holiday premium |
| Fixed Hourly OT | Stored OT hours × effective fixed hourly rate |
| Daily-wage-derived OT | Stored OT hours × `(daily wage / standard duty hours) × OT multiplier` |
| Daily-wage Absent or approved Unpaid leave | Zero earned day units; no second LOP deduction |
| Full eligible permanent month | One agreed contractual monthly gross, independent of 28/29/30/31 days |
| Fixed-divisor LOP | Dated monthly gross / published fixed divisor × distinct chargeable unpaid dates; approved Fixed30 remains unchanged |
| Explicit Actual Calendar Days LOP | Dated monthly gross / days in that date's calendar month × unpaid dates; never selected as a fallback |
| Approved Paid permanent leave | Remains within contractual base, no extra paid-leave line and no LOP |
| Permanent Compensatory Off | Existing prior-day Locked ≥24-hour evidence required; remains within base with no extra rest earnings |
| Split permanent month | Only the explicitly published calendar-weighted/residual method with configured rounding and a complete nonoverlapping plan: rounded prior allocations, final contractual residual |

Unpaid dates are a set: an absence/leave cannot create duplicate LOP. Separate
requests do not insert intervening sandwich days. Overlapping requests are
blocked rather than choosing one decision. LOP spans are split by actual month
and dated pay/policy revisions. DAILY rounding remains distinct from aggregate
month rounding. Split LOP is assigned to the runs containing those dates, with
month rounding residual on the last LOP-bearing row; incomplete or conflicting
allocation plans remain blocked.

Contract components are shown independently in each month's
`contract_diagnostics`, with the pay-structure ID, agreed amount, pay basis,
named package balance and `diagnostic_only: true`. This evidence survives a
blocked Special Package entitlement or dated salary change and is visible in
the UI's monthly reconciliation. Components are **not** added again to a full
contractual-base line. Dated salary changes retain their segment sources and dated LOP inputs,
but an unresolved changeover/proration cannot produce an approved entitlement.
February full-unpaid residual and October negative candidates are exposed as
literal diagnostics and blocked; there is no clamp or automatic method switch.

Month reconciliation counts every employee run across groups, checks distinct
period coverage separately from contractual entitlement, reports posted base
and remaining unallocated entitlement, and preserves an exact final residual.
These are read-only plans, not reservations. Existing posted coverage/month
amounts require a future reconciliation design instead of being overwritten.
Concurrent previews can produce the same estimate; they never reserve/pay it.

## Explicit policy and statutory boundaries

The following remain blocked where relevant:

- Missing/unpublished policy, required unresolved rounding, or fractional-cent
  factory results without an approved factory rounding rule. Exact factory
  currency results are shown without an invented rounding default.
- Join/exit/transfer day classification and salary-change proration. Selecting a
  method enum alone does not settle the remaining day-count/changeover decisions.
- Full-month unpaid treatment and negative gross. Explicit Sunday/known weekly-
  off leave classification needs an approved executable rule/calendar. Draft
  calendar descriptions do not approve it.
- Special Package period confirmation: agreed amount/components are shown as
  evidence, but a free-text reference does not establish monthly applicability.
- Executable management-stoppage/short-hours treatment, Casual Paid-leave wage
  basis and daily-wage CO pay. Existing free-text fields are never evaluated as
  formulas. Duty beyond 24 hours requires a supported maximum-duration rule.
- Permanent salary-derived OT and holiday daily base. The LOP divisor is not
  silently reused for these different monetary questions. Fixed Hourly permanent
  OT is supported when the relevant source facts are ready.
- Employee statutory profiles and canonical employee scope assignments. Migration
  108 provides canonical **master** bindings, not employee applicability. The
  source RPC therefore deliberately returns a null employee profile and an empty
  statutory-rule array for every preview role. Forward migration 110 removes the
  original broad statutory-master read; unrelated canonical scopes, establishment
  details and advisor metadata cannot enter previews or their fingerprints.
  A future employee-profile resolver must filter by applicable schemes/canonical
  scopes and return only calculation evidence authorized for the requesting role.

Statutory readiness reuses canonical Phase 2 resolution where an independently
verified profile supplies a scope. It preserves dated EPF/ESI enrolment flags,
separates employer contributions from employee deductions, and returns explicit
missing-profile/scope/rule blockers. Resolving a master is not legal eligibility
or a payable contribution. With current 104–108 data, EPF/ESI/PT deductions and
**final net salary remain null**, not guessed zero. No employee profile, rate,
advance/recovery, adjustment amount or statutory treatment is seeded. Statutory
calculation remains unactivated pending the missing profile/legal-rule workflow.

## API/UI and freshness

- `GET /api/v1/auth/hr/payroll/runs?page=1&limit=20`
- `POST /api/v1/auth/hr/payroll/rows/:rowId/preview`
  accepts only `{}` or `{expected_source_fingerprint: "<sha256>"}`. Actor identity
  comes from the authenticated session. Amount/rate/actor overrides are rejected.
- Admin, Accounts, HO and explicitly scoped FM can read previews. JE/ZO, inactive
  users and revoked scopes are denied by the current database-backed checks.
- The response includes earnings/LOP lines, exact ratios and decimal amounts,
  source IDs, dated salary/policy references, enrolment, warnings, responsible-
  team blockers and monthly reconciliation. `gross_after_lop` is null if earnings
  are not ready; a known subtotal is not represented as final payable salary.
- SHA-256 fingerprints canonicalize source objects and include engine version,
  row version, all relevant dates/revisions/decisions and month-plan state.
  An expected fingerprint mismatch returns **409 STALE_PAYROLL_PREVIEW**. There
  is no preview/result database write; the old Phase 1 MD5 audit is unchanged.
- `/hr/payroll/previews` uses existing authApi/TanStack Query/UI components, scoped
  run selection and paginated employee rows. It displays readiness, earnings,
  deductions, source/policy references and month plans. Stale figures are cleared
  and may be regenerated; a late response cannot attach to a newly selected run.
  No approval/lock/payment controls are present.

All coverage, monthly entitlement and allocation posting gates remain enabled.
No attendance/leave facts, salary versions, payroll master rules, Accounts
requisitions or bank balances are changed by a preview.

## Files and compatibility

Added migration 109 and forward correction 110; domain modules; `payrollPreview.controller.js`;
`payrollPreviewApi.js`; `PayrollPreviews.jsx`; pure fixtures and calculation/DB/
HTTP/UI tests. Extended existing payroll routes/schema, the payroll test command,
App/Sidebar route permissions and the RPC manifest allowlist/generated manifest
(46 RPCs). Existing migrations 104–108 are unchanged. No dependency was added.

The broad suite exposed two pre-existing fixtures selecting an arbitrary account
or an Admin without an active filter. Only those two test queries were changed to
select a current active Admin. Authorization and subcontractor business logic
were not changed. Both fixture suites then passed all 22 tests on the reused
isolated database. Synthetic accounts remain deactivated after payroll HTTP
fixtures; the fix does not weaken cleanup or authorization guards.

## Initial Phase 3 verification and remaining risks

- Payroll local suite: **116 tests / 10 files passed**.
- Complete backend unit suite: **154 tests / 18 files passed**.
- Static deployment/boot contracts: **16 tests / 2 files passed**.
- Database contracts: **32 tests / 7 files passed**.
- New preview/route UI suite: **84 tests / 2 files passed**, including all allowed
  roles and JE/ZO direct-route denial. Payroll page/master UI passed separately.
- Frontend lint: zero errors, one existing SubcontractEstimates hook warning.
- Production build: passed with CI's configured API URL.
- Complete backend integration suite: **947 tests / 121 files passed**, using
  `LOCAL_SUPABASE_TEST_PROFILE=payroll` and the isolated payroll database.
- Complete frontend suite: **1,080 tests / 153 files passed**. An initial
  unrelated Requisitions modal wait failed; its unchanged focused suite and the
  subsequent complete runs passed.
- At initial verification, all three migration 109 function bodies matched the isolated database. Preview
  RPC execution is restricted to the service role; the decimal serializer stays
  private. Existing allocation, coverage and entitlement posting gates remain
  enabled. The shared local database was not migrated or stopped.
- Graphify AST update and `git diff --check` passed.

Risks before later phases: obtain signed calendar/proration/full-unpaid/
package-period/factory-pay decisions and real statutory profile/legal evidence;
reconcile anonymized client salary registers in shadow mode. Read-only plans are
not concurrent financial reservations. Any future locking must atomically
revalidate versions, scope, source fingerprint, monthly allocations, statutory
month state and immutable coverage; this phase provides no locking shortcut.
Bank/payment integration, approval, locking and statutory posting remain outside
Phase 3. No new commit or push was performed during this review.

## Review corrections to 9fc2427

- Migration 110 replaces only the source RPC's statutory-master read with an
  empty array while no employee profiles exist. Migration 109 is unchanged.
  Current role/factory scope checks, numeric serialization, service-only RPC
  permissions and the single-snapshot source query remain intact.
- LINE LOP is an explicit scenario blocker; neither a rounded deduction nor
  rounded candidate gross is returned under that unsupported stage. No-LOP
  scenarios still work. DAILY gives 6.68 for the two-day 100.10/30 example;
  MONTH/AGGREGATE gives 6.67. Split runs cannot bypass the LINE blocker.
- Agreed totals and component evidence live in `contract_diagnostics` independently
  of allocated earnings, including multiple dated package sources. They have no
  effect on earnings totals. The existing monthly reconciliation UI renders them
  even when package applicability blocks all contractual-base lines.
- Focused payroll suite: **124 tests / 10 files passed** on the isolated stack.
- Complete backend unit suite: **158 tests / 18 files passed**.
- Preview UI suite: **6 tests / 1 file passed**.
- Complete integration suite: **950 passed / 1 failed (951 tests)**. The unchanged
  `projectsHealth.test.js` HO enrichment case returns 500 because PostgREST
  reports `URI too long`; the focused unchanged file reproduced the failure.
- All contract suites: **47 passed / 1 failed (48 tests)**. The API serialization
  test for the same Projects Health endpoint hits the same URI-length failure.
  Schema/RPC/index and deployment/boot contracts passed. Analytics production
  code and its tests were left unchanged; these runs are not fully green.
- Live RPC body matches migration 110; the existing 46-function RPC signature
  manifest still matches. anon/authenticated cannot execute the source RPC;
  service_role can. All three financial posting gates remain enabled.
- `git diff --check` and Graphify AST update passed. Graphify still reports the
  two existing semantic nodes without `source_file`; this review did not rebuild
  or alter their semantic evidence.

The new disclosure fixtures publish and canonically bind unrelated, overlapping
EPF/ESI rules, exercise Admin/Accounts/HO/scoped Factory Manager access, and verify
both an empty statutory-rule source list and an unchanged employee fingerprint.
Those fixtures run inside transactions and are rolled back; no employee statutory
profile or legal rate is introduced into production.
