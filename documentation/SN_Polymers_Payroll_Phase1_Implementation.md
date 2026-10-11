# Payroll Phase 1 foundation

Implemented on `employee_management`, using the root file
`SN_Polymers_Payroll_Business_Rules_v1_4.md` (version 1.4, 11 October 2026).
The requested `documentation/` copy does not exist. The original specification
and pre-existing Graphify modifications are preserved.

## Existing contracts and detected gaps

HR migrations 093–103 provide UUID-based employees, immediate permanent-pay
revision activation/suspension, effective-dated wage/rule revisions, six factory
attendance rosters, immutable Locked attendance and decided leave. Current
Employee Master category/department/status and joining date cannot reconstruct
historical transfers or exits. Permanent-pay creation timestamps and status are
not evidence of payroll-effective dates. There is no existing factory-user
mapping: attendance and master permissions are role-wide. Existing Accounts
requisitions have parent sheets, individual item review/return, audited
resubmission and bank-debit/payment effects in their own transactions.

Migration 104 adds payroll tables and functions without calling or replacing any
Accounts, attendance, leave, authentication or permanent-pay workflow RPC.
Employee UUIDs and EPF/ESI enrolment flags remain intact. The sole additional HR
constraint is `(pay_structure.id, employee_id)` uniqueness for an ownership FK;
an AFTER UPDATE observation trigger retains both sides of future Employee Master
assignment/status/joining-date changes without inventing effective dates.

## Resolving source dependencies

1. **Permanent pay dates:** an Admin records a complete evidenced applicability
   timeline against existing pay revision IDs. Effective start/end dates are
   mandatory, finite, inclusive and nonoverlapping within a timeline revision.
   No timestamps are converted to historical salary dates. Active, Suspended
   and Superseded compensation records can be historically applicable only when
   Admin explicitly supplies evidence; Draft pay records are rejected. Suspension
   timing must also be evidenced. Existing/new HR pay APIs retain their immediate
   lifecycle and remain usable without payroll dates. Undated revisions are
   readable in HR but cannot be resolved as dated payroll sources.
2. **Employment history:** independent complete assignment timeline revisions
   record canonical category/group/department, explicit bounded applicability,
   joining date evidence and optional actual employment exit date. Gaps, inactive
   intervals and unknown exit dates are not synthesized. An exit date is inclusive
   for the recorded assignment boundary; payable-day/proration semantics remain
   unresolved. Transfers/category changes append a replacement complete timeline,
   retaining prior revision IDs and all existing HR records. Observed directory
   changes always state `effective_date_known=false`; observation timestamps are
   never employment-effective dates.
3. **FM factory access:** Admin-only append-only grant/revoke events authorize
   SNP Factory and/or Fabric Factory payroll. No implicit grants or seeded users.
   Backend verifies current role; service-only RPCs independently recheck active
   account and current department grant. Factory scope changes and actions share
   a transaction advisory lock; current account reads lock role/activation state.
   Admin can manage any draft, with actor events; Accounts creates office drafts;
   FM creates only authorized factory drafts; HO has read access. Accounts/HO can
   read scoped payroll drafts company-wide. This does not widen existing HR pay
   screens or alter existing attendance permissions. Phase 1 reads expose source
   references and identity, not salary amounts.
4. **Attendance/leave consumption:** new row versions link only actual Locked
   attendance with matching category/factory/employee/date and finalized Approved
   or Rejected leave with a final Paid/Unpaid treatment. Pending leave and missing
   attendance never mean zero pay. Legacy null-department attendance is not
   assigned to a factory. Wage/rule IDs come from the Locked attendance row.
   This is reference capture, not full readiness validation; all drafts explicitly
   report `NOT_CALCULATED`. No upstream facts are changed by payroll operations.
5. **Coverage versus entitlement:** employee-level global GiST date exclusion
   rejects inclusive overlaps across groups/runs. Adjacent dates are permitted.
   The separate employee/month entitlement key prevents duplicate monthly ledgers;
   allocation keys are per entitlement/employee row. Posting to coverage,
   entitlements and allocations is deliberately blocked in Phase 1 by table
   privileges and triggers. No finalization RPC exists. Real financial caps,
   monthly segment reconciliation and atomic postings require a future migration.
6. **Accounts concepts:** reuse numbered parent containers/individual salary-row
   decisions, version-specific return/review audit and independent resubmission
   concepts later. Do not reuse Accounts approval, bank-balance or payment RPCs.
   Phase 1 stores UUID run identifiers; display numbering is future UX work.

## Schema and API surface

Migrations: `backend/src/db/migrations/104_payroll_phase1_foundation.sql` and
`105_payroll_expected_version_conflicts.sql`. Migration 105 uses `PY409` for
expected stale versions, avoiding PostgREST/Hasql serialization-error retries.
The existing migration runner executes SQL and its migration-log entry together.
No employee data, compensation, rates, scope grants or dated history are seeded.
Only canonical group/category/department classification metadata is seeded:
12 group codes, 13 allowed group/department pairs, covering the ten current
categories plus the legacy Projects category.

| Tables | Foundation |
|---|---|
| `payroll_groups`, `payroll_group_departments` | Canonical group/category and group/department composite FKs |
| `payroll_source_history_revisions`, `payroll_employee_assignments`, `payroll_permanent_pay_applicability` | Complete versioned evidenced timelines, identity/ownership FKs, range exclusions |
| `payroll_employee_observations` | Before/after directory facts, unknown effective date |
| `payroll_factory_scope_events` | Append-only explicit grants and revocations |
| `payroll_policy_master_revisions` | Draft-only named LOP methods, independent partial-month method, unresolved rounding/full-unpaid/weekly-off policy; no publication or seeded policy |
| `payroll_work_calendar_days` | Draft-only evidenced day classifications, unresolved compensation; no seeded calendar |
| `payroll_runs`, `payroll_run_employees` | Draft-only containers/employee approval-unit foundations; one employee per run; bounded dates and assignment scope |
| `payroll_row_versions`, `payroll_source_links`, `payroll_action_history` | Immutable versions, typed source FKs, actor history, deferred current-version FK |
| `payroll_employee_coverage` | Global employee finalized-date exclusion; writes disabled |
| `payroll_employee_month_entitlements`, `payroll_month_allocations` | Independent monthly keys, NUMERIC money groundwork, unresolved/zero allocation state; writes disabled |

All payroll tables have RLS enabled. PUBLIC/anon/authenticated/service_role have
no direct table permissions. Only allowlisted permission-checked RPCs execute
for service_role. Helper EXECUTE privileges and history sequence access are
revoked. Historical/version/configuration rows reject UPDATE/DELETE. Browser
roles cannot call payroll RPCs with forged actor IDs. Trusted backend calls derive
actor UUID from the existing authenticated session. No statutory amount/rate or
calculated net inputs exist in the API.

Routes use `verifyJwt`, current-role checking, `requireRole`, strict Zod validation:

| Endpoint under `/api/v1/auth/hr/payroll` | Purpose |
|---|---|
| `GET /context` | Authorized group/department metadata, workflows disabled |
| `POST /factory-scopes` | Admin grant/revoke with reason |
| `POST /source-history` | Admin complete assignment/permanent-pay timeline revision with evidence |
| `GET /employees/:employeeId/source-history` | Admin reads timelines and observations |
| `POST /runs` | Create authorized Draft container |
| `GET /runs/:runId` | Scoped paginated employee rows, immutable versions/source links |
| `GET /runs/:runId/candidates` | Latest evidenced historical assignment intervals and intersecting pay applicability; no present-day Active filter |
| `POST /runs/:runId/employees` | Add one employee from latest assignment timeline, creator/Admin only |
| `PATCH /rows/:rowId/note` | Append note/source-reference revision using `expected_version`; creator/Admin only |

Expected source/constraint errors map to 400, permission failures to 403, absent
records to 404, duplicate/overlap/stale-version conflicts to 409. No approval,
submission, lock, bank, payment, policy publication or calculation route exists.

## Deliberate Phase 1 limits and compatibility risks

- Known source intervals require explicit finite end dates. Open-ended or unknown
  history is not interpreted as continuing forever. Admin must provide an
  evidenced bounded timeline for each supported payroll period.
- Timeline correction sends the complete replacement timeline, including still
  valid intervals; omitted intervals become unknown in the latest revision, while
  all earlier evidence remains readable. This maintenance API has no UI yet.
- Unknown assignment employees are excluded from candidates and explicitly
  labelled as such in the response. Candidate count counts assignment intervals,
  not necessarily unique employees. The caller must not claim directory completeness.
- A Phase 1 salary row covers one assignment interval within a run. Calculation
  of multiple assignment/pay segments in one employee row is Phase 2 work.
- New Employee Master changes retain before/after snapshots but do not fabricate
  a transfer/exit effective date or automatically update the payroll timeline.
- Policy/calendar storage is structural and inaccessible through ordinary write
  APIs in this phase. Publication/version supersession/active-policy resolution
  must be implemented and tested before calculation; no policy is currently active.
  Fixed30 remains the confirmed business LOP rule, not a seeded production policy.
- Month ledgers cannot post money. Uniqueness is not an implemented allocation
  formula or a claim that monthly overpayment reconciliation is complete.
- Source fingerprints currently identify reference snapshots. Full source-value
  hashes, financial snapshots and source invalidation at review are future work.
- Past HR changes before migration 104 are not backfilled from timestamps or
  guessed audit history. Legacy/null-factory evidence remains unresolved.
- The existing HR guard still blocks Permanent-to-Casual/Local reclassification
  when permanent-pay history exists. Historical payroll timelines can retain
  evidenced category segments; this phase does not redefine the current HR
  reclassification lifecycle. Resolve that contract separately before operational
  category-transfer support.
- No frontend files change. The shared JWT FM module allowlist admits only the new payroll route; its RPCs still enforce explicit factory grants. Existing permanent-pay and attendance APIs retain
  their contracts; payroll adds storage overhead for future directory changes.

## Remaining business decisions and Phase 2 recommendation

Before affected calculation: obtain evidenced pay/assignment/exit dates, actual
FM factory grants and salary-visibility policy; resolve join/exit/revision day
counts, weekly offs inside explicit leave ranges, month allocation/residuals,
full-month unpaid exceptions, rounding, factory closures/stoppage/short-hours,
overnight attribution, special-package classification, and statutory applicability,
contribution bases/thresholds/PT jurisdiction/month-close. Payment mechanics and
recoveries remain later phases. No guessed compensation default is executable.

Phase 2 should implement source readiness with dated blockers, segment-aware
historical eligibility/pay-source resolution, reviewed calendar/policy publication,
and deterministic non-payable factory previews. Keep statutory/adjustment rules
explicitly unresolved where necessary. Approval/locking/month posting and payment
remain disabled until their separate approved phases and verification gates.

## Verification

See the final execution results appended below. Tests use synthetic local-only
fixtures; they do not assert production salary/statutory policy or real payroll
approval. The coverage concurrency test uses two PostgreSQL connections against
an isolated `LIKE ... INCLUDING ALL` copy of the production coverage constraint;
production Phase 1 gates remain enabled. This proves exclusion concurrency, not
an approval transaction that has intentionally not been implemented.

### Executed results — 11 October 2026

| Check | Actual result |
|---|---|
| Existing `bash scripts/test-local.sh` focused database run | 10/10 passed before additional legacy/concurrency assertions |
| Final focused Vitest payroll database + HTTP + validation files | **19/19 passed**, 3 files; includes legacy Projects reclassification and actual blocked overlap on two connections |
| Targeted compatibility Vitest run | **176/176 passed**, 16 files: payroll tests, 9 existing HR suites, Accounts lifecycle/close review, credit-payment invariant, authentication whitelist; the final additional payroll test was verified separately |
| `npm run test:contracts:db` after both migrations | **32/32 passed**, 7 files |
| `npm run test:contracts` | **16/16 passed**, 2 files, after rerunning outside socket/subprocess sandbox restrictions |
| `npm run generate:manifests` | Generated 51 schema tables, 37 RPC signatures and 74 allowlisted indexes from local PostgreSQL |
| Migration runner | All 112 migrations through 104 passed on a fresh local database; 105 then applied successfully; already-applied files skipped |
| Frontend `npm run build` | Passed; no frontend source changed |
| `node --check` for changed backend JS; `git diff --check` | Passed |
| `graphify update .` | Completed AST refresh; pre-existing semantic-node metadata and community-label warnings remain |

Initial HTTP tests exposed the missing shared FM module allowlist entry and
PostgREST retries caused by using serialization SQLSTATE `40001` for business
version conflicts. Both are corrected and verified. The index generator exposed
PostgreSQL's identifier truncation on the month-ledger unique index; its allowlist
now uses the database's real name. Initial deploy/app-boot tests failed with
sandbox `listen EPERM` / `spawnSync EPERM`; the elevated rerun passed. No unresolved
test failure remains in the checks listed above. Full repository regression and
full payroll calculation/approval/payment acceptance suites were not run or
claimed complete.

**Local harness limitation:** `test-local.sh` searches CLI status output for
`API URL`, but the installed CLI emits `API_URL`. It misidentified an already
running stack as newly started and stopped it with `--no-backup`. Restarting
initialized a fresh local database. All repository migrations were reapplied and
the stack is left running; prior local fixture data was not restored. No remote
or production database was used. The harness was not changed as unrelated scope.
Existing OTP contract tests log Telegram test-chat delivery failures/fallback;
they pass, but those logs are not evidence of a payroll notification feature.

### Changed files

- `backend/src/db/migrations/104_payroll_phase1_foundation.sql`
- `backend/src/db/migrations/105_payroll_expected_version_conflicts.sql`
- `backend/src/controllers/payroll.controller.js`
- `backend/src/routes/payroll.routes.js`
- `backend/src/validation/payroll.schema.js`
- `backend/src/app.js`
- `backend/src/middleware/verifyJwt.js`
- `backend/tests/vitest/regression/payrollFoundation.test.js`
- `backend/tests/vitest/regression/payrollApi.test.js`
- `backend/tests/vitest/unit/payrollValidation.test.js`
- `backend/tests/manifests/manifestScope.json`
- `backend/tests/manifests/rpcAllowlist.json`
- `backend/tests/manifests/indexAllowlist.json`
- `backend/tests/manifests/schemaManifest.generated.js`
- `backend/tests/manifests/rpcManifest.generated.js`
- `backend/tests/manifests/indexManifest.generated.js`
- `documentation/SN_Polymers_Payroll_Phase1_Implementation.md`
- Graphify refresh: `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`,
  `graphify-out/manifest.json` (the first two already had user changes).

The untracked root specification is unchanged. No commit, push or PR was made.
