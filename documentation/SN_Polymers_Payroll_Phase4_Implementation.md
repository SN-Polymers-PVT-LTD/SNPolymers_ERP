# Payroll Phase 4 — employee review and guarded final locking

Implemented on `employee_management` against v1.4, starting from `36b52dd`.
No commit or push. This phase does not authorize financial finalization, payment,
statutory liability posting, or bank disbursement.

## Contract and workflow

The employee row remains the decision unit. New workflow states extend the
existing `payroll_run_employees`; they do not mirror approval in a separate
mutable sheet. The existing immutable source/content versions and append-only
`payroll_action_history` remain authoritative.

| Actor/action | From | Result |
|---|---|---|
| Original FM / calculate factory | Draft, Calculated, Returned | Calculated, new immutable diagnostic revision |
| Original Accounts / calculate office | Draft, Calculated, Returned | Calculated, new immutable diagnostic revision |
| Original FM / submit | Calculated | Pending Accounts Review |
| Independent Accounts / verify-forward factory | Pending Accounts Review | Pending HO Approval |
| Original Accounts / submit office | Calculated | Pending HO Approval, no redundant Accounts self-review |
| Accounts / return factory | Pending Accounts Review | Returned to Creator, mandatory reason |
| HO/Admin / return | Pending HO Approval | Returned to Creator, mandatory reason |
| Original preparer / correct | Draft, Calculated, Returned | Draft, new content version and correction reason |
| Original preparer / recalculate/resubmit factory | Returned or corrected Draft | Calculated then Pending Accounts Review again, including HO returns |
| Original preparer / recalculate/resubmit office | Returned or corrected Draft | Calculated then Pending HO Approval |
| Original preparer / withdraw unapproved row | Draft, Calculated, Returned | Cancelled Draft, audited and immutable |
| Independent HO/Admin / approve-and-lock check | Pending HO Approval | Explicit lock blockers; state stays pending, no financial writes |

The same FM identity can prepare SNP and Fabric; each factory requires a current
explicit payroll grant. Another FM may read a granted row but cannot become its
originating preparer. Current role, active status and grants are checked in the
existing backend middleware and again inside the transactional RPC.

Admin's legacy Phase 1 draft-authoring APIs remain available under their original
permissions. New Phase 4 submission requires the actual FM/Accounts originating
preparer. Existing Admin-created drafts are not silently reassigned. A general
ownership handoff is deliberately not invented in this phase.

V1.4 §11.1 leaves entitlement rejection/void and optional Hold semantics subject
to policy sign-off. No Rejected/On Hold or reopen-after-lock transition is added.
Unapproved withdrawal is separate from rejecting an employee's entitlement.

## Versioning, audit and source freshness

Migration **111_payroll_employee_review_workflow.sql** is forward-only; 104–110
are unchanged. It adds:

- `review_version` for action compare-and-swap, separate from `current_version`
  for source/content corrections, plus current submission/Accounts provenance.
- Immutable `payroll_review_revisions`: source JSON, database SHA-256 token,
  Phase 3 fingerprint, calculation snapshot, content version, preparer, timestamp
  and revision reason. Composite keys tie every snapshot to its employee row and
  original content version.
- Review metadata on existing action history: actor role, before/after states,
  reason and exact content/review/calculation revisions. History is append-only.
- Row-state/identity guards, a review queue index, and uniqueness of successful
  action events per employee review version.

Each action locks only its employee row and compares both expected versions.
Calculate and final-check payloads are derived by the server from the existing
Phase 3 engine; strict HTTP schemas forbid source JSON, calculation JSON, actor,
salary, rate or net overrides. Database action JSON keys are allowlisted too.
The database compares the backend source JSON with a newly resolved authoritative
snapshot inside the same action transaction; changed sources roll back the action.
Submission and forwarding compare the stored database token and expected Phase 3
fingerprint. A stale row must return to preparation and receive a fresh revision.

Review-only status/provenance counters are excluded from the review source token,
so an employee's own Submit/Forward/Return does not invalidate its calculation.
Unrelated employees do not enter its source snapshot. Content versions, notes,
source facts, dated masters and employee-month plans still invalidate it.
Cancelled rows are excluded from month plans in both review snapshots and the
reused calculation engine.

Migration **112_payroll_review_source_recovery.sql** separates review metadata
from preview source availability. A source parameter failure (SQLSTATE `22023`,
including a legacy period exceeding the 24-month preview limit) returns
`source_error: {code, sqlstate, message}` with metadata and immutable histories.
The API returns `current_preview: null`, `source_stale: null` (unknown), no current
source comparisons or assignment candidates, and excludes calculation,
submission, forwarding and final-check actions until sources resolve. Authorized
correction, withdrawal and return remain available. The UI displays the error,
retains saved salary evidence and recovery controls, and supports retrying sources.
Actor, current run scope and historical evidence scope checks remain mandatory;
authorization and missing-row failures remain HTTP errors. Transactional action
validation and financial gates are unchanged. The RPC signature is unchanged,
so schema/RPC/index manifests require no new entries.

Recovery regression coverage includes the PostgreSQL detail read, an HTTP
oversized-draft correction/withdrawal cycle with scope denial and calculation
rejection, and the UI recovery controls, saved evidence and source retry.
Verification: complete isolated payroll suite **150/150**; focused review and
DB schema/RPC/index suites **26/26**; PayrollReview UI suite **9/9**; frontend
production build passed.

Returns preserve their stage and exact revision. Corrections can refresh a
canonical assignment ID only from the employee's current evidenced history, for
the same immutable run/group/department/date interval. They refresh pay-history
references through the existing draft snapshot builder. There are no manual pay
inputs and no attendance/leave updates. Different periods/classifications require
an appropriately scoped new draft rather than rewriting historical identity.
Return/correct/withdraw operations do not require a successful monetary source
resolution, allowing safe withdrawal of unsupported legacy intervals.

## Final-lock transaction and safeguards

The only final-approval operation is the per-employee `approve_lock` check. It:

1. Rechecks active HO/Admin role, pending HO state, both expected versions and
independent identity from the creator, submitter and factory Accounts verifier.
   The existing Employee Master ERP-user link also forbids review of the actor's
   own salary, even if a different preparer submitted it. No profile is invented.
2. Locks the employee and serializes relevant employee/month keys in date order.
3. Re-resolves sources, checks the submitted token/fingerprint and the fresh
   server calculation; the source snapshot covers published policies, effective
   salary history, Locked attendance and finalized leave.
4. Checks complete gross/net readiness, applicable calculation blockers, current
   employee statutory profile, overlapping finalized coverage and posted monthly
   entitlement/allocation dependencies.
5. Returns `PAYROLL_LOCK_BLOCKED` and appends a `LOCK_BLOCKED` event. It never
   changes the row to Locked, creates coverage/allocation/month liabilities, marks
   payment eligibility or touches any bank balance.

An unconditional **FINANCIAL_FINALIZATION_DISABLED** database blocker remains,
alongside **STATUTORY_MONTH_FINALIZATION_NOT_IMPLEMENTED**. Even a forged
service-role result claiming a complete net and no blockers cannot activate it.
All three Phase 1 posting triggers remain enabled. Direct attempts to write
Locked status are denied, and terminal rows reject edits/deletion. Locked
snapshots must never be recalculated or returned, including by Admin.

A later phase must implement evidenced statutory profiles and canonical employee
scopes, verified scheme-specific calculations/rounding, complete net salary,
statutory-month accumulator/reconciliation and atomic immutable financial posting
before changing these guards. It must coordinate concurrent source/policy changes
with actual finalization; Phase 4's diagnostic review is not a financial
reservation. Do not enable locking by removing a trigger or setting a UI flag.

## API and UI

- `GET /hr/payroll/review/queue`: role-scoped pagination and optional run/status
  filters; relevant parent summaries and per-row permitted actions.
- `GET /hr/payroll/rows/:rowId/review`: current diagnostic, saved revisions,
  changes between revisions, source-stale signal, correction notes, action history
  and applicable assignment IDs. Full private source JSON/database tokens are not
  exposed. Historical snapshot factory scopes are also reauthorized before read.
- `POST /hr/payroll/rows/:rowId/review`: one strict action and both expected
  versions. Final checks return HTTP 422 with prerequisites; stale actions return
  409; authorization/state checks remain database authoritative.
- `POST /hr/payroll/review/bulk`: at most 50 typed employee requests, each using
  its own RPC transaction. Returns individual action, success, status and error/
  blockers. Successful peers survive a stale or denied employee. Invalid transport
  payloads reject before any action. No whole-sheet approval RPC exists.

`/hr/payroll/review` is accessible to FM, Accounts, HO/Admin only. It includes
canonical group/period draft creation and evidenced candidate selection through
the existing Phase 1 APIs for FM/Accounts, employee queues, reasoned corrections,
source-backed salary diagnostics, submitted-revision comparisons, immutable
history, safe bulk controls and explicit independent results. Empty/loading/error
states support retry. JE/ZO direct navigation and calls are denied.

The shared `SalaryPreview` component is extracted from the Phase 3 page and used
by both screens, retaining package evidence, LOP/statutory blockers and month
reconciliation. Review caches include actor ID and role. Both old run read APIs
and new review read APIs derive parent status/counts; stored `payroll_runs.status`
remains an immutable legacy container flag, exposed separately as
`container_status`. Parent progress never drives a child transition. Amounts are
labelled diagnostics, not approved liabilities. Payment status is **NOT_ELIGIBLE**,
separate from approval state. No payment, settlement or statutory-posting UI exists.

## Files and verification

New migration, review domain/validation/controller, review API/page, shared salary
view and draft-preparation component, isolated fixtures, unit/PostgreSQL/API/UI
regressions and this report. Existing routes, navigation, payroll test script and
schema/RPC/index manifests are extended. No dependency was added. No Accounts,
HR employee, attendance or leave production workflow is changed.

- Full affected payroll suite: **149 tests / 13 files passed** on the isolated
  payroll stack, including the Phase 1–3 suites, PostgreSQL review/concurrency,
  API review/bulk/stale-token cases and independent unit contracts.
- Complete backend unit suite: **164 tests / 19 files passed**. The final payroll
  run also includes the updated self-review unit assertions.
- Complete backend integration: **969 passed / 1 failed (970 tests, 123 files)**.
  The unchanged Projects Health enrichment case returns 500 because PostgREST
  reports `URI too long` on this reused fixture database. This was already
  reproduced before Phase 4; no analytics source/test change was made.
- Full contracts: **47 passed / 1 failed (48 tests)**. API serialization of the
  same unchanged Projects Health endpoint hits that same URI-length failure.
  Schema, RPC, index, deployment and boot contracts passed. The broad backend
  verification is explicitly not fully green.
- The initial complete frontend run passed **1,098 tests / 155 files**. A later
  final run encountered a 5-second timeout in the unchanged ExcessFundReturns
  workflow test. Its unchanged focused rerun passed **3 tests**, and the final
  complete frontend run passed **1,099 tests / 155 files**.
- Final targeted schema/RPC/index and Employee Management/pay-structure checks:
  **24 tests / 5 files passed** after the final snapshot constraints.
- Production build passed with CI's configured API URL. Lint has zero errors and
  one existing SubcontractEstimates `activeFilters` hook warning.
- All **10 migration 111 function bodies** match the live isolated database.
  Snapshot identity/version constraints are validated. All four new public RPCs
  are service-only; the two internal helpers are private. All three financial
  posting triggers remain enabled. The updated manifests cover **57 tables,
  50 RPCs and 86 indexes**; schema and RPC manifests match live metadata.
- The shared stack remains at 115 employees and two runs, with no 110/111
  migrations or review RPC. It was not reset, migrated or stopped. The isolated
  stack is left running and fixture data is preserved.
- `git diff --check` passed. Graphify AST update retains the two existing semantic
  nodes without `source_file`; no semantic evidence was regenerated.

Primary implementation files:

- `backend/src/db/migrations/111_payroll_employee_review_workflow.sql`
- `backend/src/domain/payroll/review.js` and the cancelled-row filter in `preview.js`
- `backend/src/controllers/payrollReview.controller.js`
- `backend/src/validation/payrollReview.schema.js`, `routes/payroll.routes.js`
- `frontend/src/api/payrollReviewApi.js`, `pages/hr/PayrollReview.jsx`
- `frontend/src/components/payroll/SalaryPreview.jsx`, `PayrollDraftEditor.jsx`
- Existing `PayrollPreviews.jsx`, App routes/navigation and role tests
- `backend/tests/helpers/payrollReviewFixtures.js` and review unit/DB/API suites
- Review/preparation UI suites, backend payroll script and generated manifests

Remaining prerequisites/deferred work: evidenced employee statutory profiles and
canonical employee scopes; verified statutory deduction/net calculation and
scheme-specific rounding; statutory-month accumulation and final reconciliation;
an atomic immutable salary/coverage/allocation posting implementation. Rejection,
Hold and ownership handoff need explicit policy approval. Bank payments,
disbursements, settlement/reconciliation and statutory liability posting are
outside Phase 4 and were not implemented. No commit or push was performed.
