I pulled the current `subcontractor-ledger` branch before planning. The head is still `e9cc21af318c6152ce9bc1b461e21e9206581136` (`backend drafts and frontend fixes`).

I also followed the attached **Milestone + Contract + Adversarial Gate** format rather than treating this as a high-level feature outline.  In particular, the plan below uses explicit state transitions, milestone gates, failure/recovery analysis, data-integrity boundaries, API contracts, and proof-of-completion as required by that format.  

# Phase 4B Execution Plan

## Subcontractor Estimate Approval, Revision & Reopen

**Frozen baseline:** `e9cc21af318c6152ce9bc1b461e21e9206581136`

**Phase objective:** Extend the Phase 4A Draft implementation into a complete, auditable ZO/HO approval workflow supporting revision requests, rejection, Final Approval, reopen, immutable approved history, `ADDITION`, signed `ADJUSTMENT`, row-level approval, and effective-scope validation.

**Hard boundary:** Phase 4B does **not** synchronize Cost Estimate or mutate Finance.

---

# 1. AUTHORITATIVE FEATURE CONTRACT

## 1.1 Purpose

A Subcontractor Estimate defines the subcontract work that Projects authorizes for a Work Order.

Phase 4A established:

```text
WO
 ↓
Subcontract Estimate
 ↓
Draft BASE contributions
```

Phase 4B establishes:

```text
Draft
 ↓
JE submission
 ↓
ZO review
 ↓
HO review
 ↓
Final Approved authorized subcontract scope
 ↓
optional reopen
 ↓
ADDITION / ADJUSTMENT
 ↓
ZO + HO approval
 ↓
new Final Approved effective scope
```

Phase 4B ends when the subcontract scope is authorized and valid negative adjustments have passed the read-only Finance-consumption guard.

It does **not** consume that authorization downstream.

---

## 1.2 Canonical identities

These remain authoritative:

```text
Subcontract Work
    subcontract_work_master.id

Subcontractor
    subcontractor_master.id

Estimate
    project_subcontract_estimates.subcontract_estimate_id

Contribution
    project_subcontract_estimate_lines.line_id
```

Display strings are never financial identity.

The current foundation already stores these UUID relationships directly and uses restrictive FKs.

---

## 1.3 Contribution semantics

### BASE

Initial subcontract allocation.

```text
qty > 0
rate > 0
amount = round(qty × rate, 2) > 0
adjusts_line_id = NULL
```

Only used before the first Final Approval.

### ADDITION

New scope introduced after an approved estimate is reopened.

```text
qty > 0
rate > 0
amount = round(qty × rate, 2) > 0
adjusts_line_id = NULL
```

### ADJUSTMENT

Signed correction against previously Final Approved scope.

```text
qty != 0
rate > 0
amount = round(qty × rate, 2)

adjusts_line_id IS NOT NULL
```

Examples:

```text
Approved BASE:
400 × ₹100 = ₹40,000

Negative correction:
ADJUSTMENT -50 × ₹100 = -₹5,000

Effective:
350 / ₹35,000
```

and:

```text
Approved BASE:
400 × ₹100

Correction:
ADJUSTMENT +20 × ₹100

Effective:
420 / ₹42,000
```

Positive correction is `ADJUSTMENT`; genuinely new scope is `ADDITION`.

The current schema already anticipates all three entry kinds and `adjusts_line_id`, but its ADJUSTMENT constraint is currently only structural; Phase 4B must add the business guards.

---

## 1.4 Immutable approved history

This is the primary Phase 4B invariant:

> Once a contribution has participated in a Final Approved revision, its historical business fields and approval history cannot be destructively modified or deleted.

Corrections are represented by new contributions.

Never:

```text
Approved BASE ₹40,000
        ↓ UPDATE
Approved BASE ₹35,000
```

Instead:

```text
BASE       +₹40,000   immutable
ADJUSTMENT  -₹5,000   append-only
────────────────────
Effective   ₹35,000
```

---

## 1.5 Adjustment target contract

Every `ADJUSTMENT` must reference `adjusts_line_id`.

The target must:

```text
exist
AND belong to same estimate
AND therefore same WO
AND same subcontractor_id
AND same subcontract_work_id
AND have participated in a previous Final Approved revision
AND not be an unapproved line from the current revision
```

These are DB/transactional invariants, not frontend-only validation.

---

## 1.6 Effective scope

For a logical:

```text
estimate
+ subcontractor_id
+ subcontract_work_id
```

effective approved scope is:

```text
Effective Qty
 =
Σ approved BASE.qty
+ Σ approved ADDITION.qty
+ Σ approved ADJUSTMENT.qty
```

and:

```text
Effective Amount
 =
Σ approved BASE.amount
+ Σ approved ADDITION.amount
+ Σ approved ADJUSTMENT.amount
```

Before Final Approval:

```text
Effective Qty >= 0
Effective Amount >= 0
```

Calculate using authoritative stored amounts, not recomputed client values.

---

## 1.7 Finance-consumption invariant

Business invariant:

```text
New Effective Approved Amount
>=
Already Financially Consumed Amount
```

However, the current Finance lifecycle represents reservations through subcontractor-ledger `REQUISITION_APPROVAL` records and transitions them among `RESERVED`, `SETTLED`, and `RELEASED`. Phase 4B may read this existing lifecycle through one canonical, read-only transactional consumption primitive; it must not invent a second commitment model or mutate Finance.

The primitive must count each commitment once by current state:

```sql
consumed(scope) =
SUM(active REQUISITION_APPROVAL amounts)
WHERE settlement_status IN ('RESERVED', 'SETTLED')
```

`RELEASED` commitments are excluded. The scope is the normalized `work_order_no + subcontractor_id + subcontract_work_id`.

Negative adjustments may be drafted, submitted, reviewed, and Final Approved when the transactional guard confirms:

```text
new_effective_approved_amount >= financially_consumed_amount
```

If the guard fails, return a business-level 422 such as `SUBCONTRACT_SCOPE_BELOW_FINANCIAL_CONSUMPTION`.

---

## 1.8 Server authority

### Phase 4A reconciliation replacement

The existing `save_subcontract_estimate_draft_lines` RPC is intentionally Draft-only and always creates `BASE` rows. Phase 4B must not silently add revision behavior to that Draft-specific contract.

Add a state-aware transactional primitive, preferably:

```text
reconcile_subcontract_estimate_lines(...)
```

with these rules:

```text
Draft:
  new rows must be BASE

ZO Revision Requested / HO Revision Requested:
  unapproved current-generation rows may be edited
  historically Final Approved rows remain immutable

Estimate Reopened:
  BASE is prohibited
  ADDITION and ADJUSTMENT are allowed
```

Existing Phase 4A callers remain compatible until workflow callers and tests migrate; the new primitive must own all Phase 4B revision semantics.

Server/DB owns:

```text
amount
entry_kind legality
adjusts_line_id legality
workflow status
revision
row approval fields
approval actors
approval timestamps
workflow actors
workflow timestamps
last_approved_amount
effective-scope validation
audit log
```

Client supplies only legitimate action inputs such as:

```text
qty
rate
subcontractor_id
subcontract_work_id
rate_reference
remarks
adjusts_line_id where appropriate
review decision
review remarks
expected_updated_at / concurrency token
```

Phase 4A currently accepts several server-controlled properties in its Zod line shape but ignores them downstream. Phase 4B should tighten the workflow-specific schemas rather than expanding that pattern.

---

# 2. ROLE / ACTION AUTHORIZATION MATRIX

| Action                       |  JE |  ZO |  HO | Admin | Staff | Accounts |
| ---------------------------- | :-: | :-: | :-: | :---: | :---: | :------: |
| View permitted estimate      |  ✓  |  ✓  |  ✓  |   ✓   |   ✗   |     ✗    |
| Create initial Draft         |  ✓  |  ✗  |  ✗  |   ✓   |   ✗   |     ✗    |
| Edit unapproved contribution |  ✓  |  ✗  |  ✗  |   ✓   |   ✗   |     ✗    |
| Submit / resubmit            |  ✓  |  ✗  |  ✗  |   ✓   |   ✗   |     ✗    |
| Open ZO review               |  ✗  |  ✓  |  ✗  |   ✓   |   ✗   |     ✗    |
| Set ZO row decision          |  ✗  |  ✓  |  ✗  |   ✓   |   ✗   |     ✗    |
| ZO approve header            |  ✗  |  ✓  |  ✗  |   ✓   |   ✗   |     ✗    |
| ZO request revision          |  ✗  |  ✓  |  ✗  |   ✓   |   ✗   |     ✗    |
| ZO reject                    |  ✗  |  ✓  |  ✗  |   ✓   |   ✗   |     ✗    |
| Open HO review               |  ✗  |  ✗  |  ✓  |   ✓   |   ✗   |     ✗    |
| Set HO row decision          |  ✗  |  ✗  |  ✓  |   ✓   |   ✗   |     ✗    |
| HO Final Approve             |  ✗  |  ✗  |  ✓  |   ✓   |   ✗   |     ✗    |
| HO request revision          |  ✗  |  ✗  |  ✓  |   ✓   |   ✗   |     ✗    |
| HO reject                    |  ✗  |  ✗  |  ✓  |   ✓   |   ✗   |     ✗    |
| Reopen Final Approved        |  ✗  |  ✗  |  ✓  |   ✓   |   ✗   |     ✗    |
| Create ADDITION/ADJUSTMENT   |  ✓  |  ✗  |  ✗  |   ✓   |   ✗   |     ✗    |
| Modify approved history      |  ✗  |  ✗  |  ✗  |   ✗   |   ✗   |     ✗    |

### Hard authorization invariants

JE actions require an **active WO mapping at action time**.

ZO actions require the WO to remain in that ZO's active mapped scope at action time.

HO has global Projects review visibility.

Admin can execute workflow actions but cannot bypass immutable-history, effective-scope, adjustment-target, or concurrency invariants.

The existing Phase 4A visibility helper already differentiates JE, ZO, HO and Admin using `work_order_mappings` and `je_zo_mappings`; Phase 4B should reuse the business concept, but critical workflow RPCs must independently validate the actor rather than trusting controller prechecks.

---

# 3. STATE MACHINE / LIFECYCLE

The status vocabulary should reuse the existing Cost Estimate enum, which already contains all required statuses including `Estimate Reopened`.

## 3.1 Valid transitions

| Current               | Actor    | Action              | Result                |
| --------------------- | -------- | ------------------- | --------------------- |
| Draft                 | JE/Admin | SUBMIT              | Submitted             |
| Submitted             | ZO/Admin | OPEN_REVIEW         | Under ZO Review       |
| Under ZO Review       | ZO/Admin | ZO_APPROVE          | ZO Approved           |
| Under ZO Review       | ZO/Admin | ZO_REQUEST_REVISION | ZO Revision Requested |
| Under ZO Review       | ZO/Admin | ZO_REJECT           | Rejected by ZO        |
| ZO Revision Requested | JE/Admin | RESUBMIT            | Submitted             |
| ZO Approved           | HO/Admin | OPEN_REVIEW         | Under HO Review       |
| Under HO Review       | HO/Admin | HO_APPROVE          | Final Approved        |
| Under HO Review       | HO/Admin | HO_REQUEST_REVISION | HO Revision Requested |
| Under HO Review       | HO/Admin | HO_REJECT           | Rejected by HO        |
| HO Revision Requested | JE/Admin | RESUBMIT            | Submitted             |
| Final Approved        | HO/Admin | REOPEN              | Estimate Reopened     |
| Estimate Reopened     | JE/Admin | RESUBMIT            | Submitted             |

### Important HO revision rule

HO revision does **not** return directly to HO.

```text
HO Revision Requested
       ↓ JE modifies
Submitted
       ↓
ZO review again
       ↓
HO review again
```

Every modified version that becomes Final Approved therefore receives both ZO and HO review.

---

## 3.2 Mutability matrix

| Status                | Existing unapproved rows   | Previously Final Approved rows | New rows                                             |
| --------------------- | -------------------------- | ------------------------------ | ---------------------------------------------------- |
| Draft                 | Editable                   | N/A                            | BASE                                                 |
| Submitted             | Locked                     | Locked                         | No                                                   |
| Under ZO Review       | Review fields only         | Locked                         | No                                                   |
| ZO Revision Requested | Editable                   | Locked                         | BASE if revision 0; ADDITION/ADJUSTMENT after reopen |
| ZO Approved           | Locked                     | Locked                         | No                                                   |
| Under HO Review       | Review fields only         | Locked                         | No                                                   |
| HO Revision Requested | Editable                   | Locked                         | BASE if revision 0; ADDITION/ADJUSTMENT after reopen |
| Final Approved        | Locked                     | Locked                         | No                                                   |
| Estimate Reopened     | N/A/current delta editable | Locked                         | ADDITION/ADJUSTMENT only                             |
| Rejected              | Locked                     | Locked                         | No                                                   |

The edit decision must therefore depend on both **header state and contribution history**, not header state alone.

---

## 3.3 Revision semantics

Freeze:

```text
Initial approval generation
estimate_revision = 0

Final Approved → REOPEN
estimate_revision = 1

Second reopen
estimate_revision = 2
```

ZO/HO correction loops do **not** increment `estimate_revision`.

This deliberately differs from the current Cost Estimate `submitEstimate`, which calculates `estimate_revision + 1` during submission.

Do **not** blindly reuse that Cost Estimate behavior.

`revision_cycle` in the existing subcontract revision log may continue tracking reviewer correction cycles independently. The foundation already has `subcontract_estimate_revision_log`, including stage, deadline, resubmission metadata and a one-active-revision constraint.

---

# 4. CURRENT REPOSITORY BASELINE

The latest migration set ends at `081_fix_subcontract_estimate_draft_reconciliation.sql`; 076–081 establish the normalized foundation, work identity protection and Draft CRUD.  Migrations are forward-only and tracked through `_migration_log`; already-applied files are skipped, so Phase 4B must add new migrations rather than editing 076–081.

### Existing Subcontract Estimate backend

Current routes expose:

```text
GET  /summary
GET  /init
GET  /
POST /
GET  /:id
PUT  /:id/lines
```

with readers JE/ZO/HO/Admin and Draft writers JE/Admin.

Current controller already implements:

```text
WO visibility
JE mapping checks
ZO mapped-WO visibility
HO/Admin visibility
Draft creation
Draft retrieval
Draft reconciliation RPC
optimistic conflict → 409
```

### Existing database foundation

Already available:

```text
project_subcontract_estimates
project_subcontract_estimate_lines
subcontract_estimate_revision_log

line:
  entry_kind
  adjusts_line_id
  zo_office_approve
  zo_remarks
  ho_office_approve
  ho_remarks

header:
  estimate_status
  estimate_revision
  last_approved_amount
  JE/ZO/HO actor/date/remarks fields
```

### Existing adjacent Cost Estimate workflow

Cost Estimate already provides useful patterns for:

```text
submit
open review
row approval
review completion
revision requests
rejection
Final Approval
reopen
optimistic status transition
```

Its controller also demonstrates conditional status updates to detect concurrent workflow changes.

### REUSE

Reuse:

```text
estimate_status_enum
row_approval_enum
estimate-status.js
approval-status.js
requireRole
verifyJwt
validateRequest
WO mapping concepts
revision deadline conventions where business-compatible
existing UI vocabulary
existing table/Badge/Button components
Phase 4A optimistic concurrency strategy
service_role-only transactional RPC pattern
DB contract manifests
```

Current row approval constants are `Approve` / `Not Approve`.

### DO NOT REUSE BLINDLY

Do not blindly copy:

```text
Cost Estimate revision increment-on-submit
Cost Estimate material-line validation
Cost Estimate quotation logic
Cost Estimate manual-item semantics
legacy "Sub Contractor" string identity
legacy Finance balance source
any controller-only transaction composed from multiple Supabase writes
```

### LEGACY RISKS

The major cross-module risk remains Finance.

Migrations 047–069 already implement a mature legacy subcontractor ledger lifecycle, while 076 merely added normalized UUID columns alongside it.

Therefore Phase 4B must not:

```text
credit subcontractor balances
change ledger capacity
reinterpret existing requisitions
switch Finance identity
```

---

# 5. DEPENDENCY-ORDERED MILESTONES

## M1 — Workflow Persistence & Immutable-History Foundation

### Objective

Create the DB primitives required to represent workflow history and distinguish current-revision contributions from previously Final Approved contributions.

### Dependencies

Phase 4A frozen at current head.

### Likely files

```text
backend/src/db/migrations/082_subcontract_estimate_workflow_foundation.sql
backend/tests/manifests/schemaAllowlist.json
backend/tests/manifests/indexAllowlist.json
backend/tests/manifests/rpcAllowlist.json
generated contract manifests
backend/tests/vitest/regression/subcontractEstimateWorkflow.test.js
```

Exact migration naming may follow repository convention, but do not modify 076–081.

### Implementation requirements

Add an append-only workflow action table, recommended:

```text
project_subcontract_estimate_workflow_log

id
subcontract_estimate_id
revision
from_status
to_status
action
actor
actor_role
remarks
created_at
```

Allowed action vocabulary:

```text
SUBMIT
RESUBMIT
OPEN_ZO_REVIEW
ZO_APPROVE
ZO_REQUEST_REVISION
ZO_REJECT
OPEN_HO_REVIEW
HO_APPROVE
HO_REQUEST_REVISION
HO_REJECT
REOPEN
```

Add the minimum provenance necessary to determine that a line has participated in Final Approval.

Do **not** infer “historically approved” from its current row approval fields alone, because those fields can be reset for a current review generation.

Preferred approach: immutable approval-generation provenance, e.g. line-level approved revision/generation metadata or an immutable approval snapshot relation.

The implementation must make this query unambiguous:

```text
Was line X already part of a Final Approved generation?
```

without inspecting mutable current status.

Create DB-level protection preventing destructive mutation/deletion of historically Final Approved contributions.

### Security

Workflow log:

```text
no UPDATE
no DELETE
backend service role inserts through workflow RPC
no direct browser mutation
```

### Acceptance criteria

* [ ] Historical Final Approved status of a contribution is queryable unambiguously.
* [ ] Workflow log is append-only.
* [ ] Every workflow log references a real estimate and actor.
* [ ] Approved contribution core fields cannot be destructively changed.
* [ ] Approved contribution cannot be deleted.
* [ ] Existing Phase 4A Draft records remain valid.
* [ ] No Finance or Cost Estimate behavior changes.
* [ ] New tables/RPCs/indexes are added to DB contract manifests.

### Mandatory tests

**GIVEN** an ordinary Draft BASE line, **WHEN** it is edited, **THEN** editing remains permitted.

**GIVEN** a contribution marked as historically Final Approved, **WHEN** direct SQL attempts to change qty/rate/contractor/work/entry_kind/adjusts target, **THEN** DB rejects it.

**GIVEN** approved history, **WHEN** direct deletion is attempted, **THEN** DB rejects it.

**GIVEN** a workflow-log row, **WHEN** UPDATE or DELETE is attempted, **THEN** it is rejected.

### Exit gate

M1 contract/regression tests PASS and independent schema review finds no path for destructive approved-history mutation.

---

## M2 — Transactional Submit & Review State Machine

### Objective

Implement workflow transitions atomically.

### Likely files

```text
083_subcontract_estimate_workflow_rpcs.sql
subcontractEstimates.controller.js
subcontractEstimates.routes.js
subcontractEstimates.schema.js
workflow/subcontract-estimate-rules.js
constants/subcontract-estimate-actions.js
RPC manifests/tests
```

### Implementation requirements

Do not implement workflow as:

```text
controller:
UPDATE header
UPDATE lines
INSERT log
...
```

Use transactional RPCs for actions that modify multiple workflow objects.

Each workflow RPC must:

```text
lock header FOR UPDATE
validate actor active
validate actor role
validate current mapping where applicable
validate expected state
validate expected_updated_at/version
perform line/header changes
append workflow log
update audit fields
commit atomically
```

Submit requires at least one valid current contribution.

Opening review and completing review must use compare-and-transition semantics.

ZO/HO row decisions may use a dedicated transactional batch RPC.

### Revision request behavior

Request revision must:

```text
require remarks
set appropriate header state
create/maintain subcontract_estimate_revision_log
append workflow action log
unlock only eligible current-generation contributions
preserve approved history
```

Only one active revision request may exist; the current foundation already enforces this through a partial unique index.

### Rejection

Reject must:

```text
require remarks
be terminal for that workflow attempt
append immutable workflow event
not delete estimate/lines
```

### Acceptance criteria

* [ ] Every valid state transition is implemented.
* [ ] Every invalid state transition is rejected.
* [ ] Mapping/role validation occurs inside transactional workflow.
* [ ] Every successful transition creates exactly one workflow event.
* [ ] Failed transition creates no partial event/state.
* [ ] Duplicate concurrent action cannot transition twice.
* [ ] Revision remarks mandatory.
* [ ] Rejection remarks mandatory.
* [ ] JE cannot edit while submitted/reviewing.
* [ ] HO revision returns modified estimate through ZO.
* [ ] `estimate_revision` is not incremented for reviewer correction loops.

### Mandatory tests

GIVEN Draft, WHEN JE submits twice concurrently, THEN one succeeds and the other receives conflict.

GIVEN Submitted estimate, WHEN HO attempts ZO review, THEN rejected.

GIVEN ZO outside mapped scope, WHEN direct API/RPC is attempted, THEN rejected.

GIVEN Under HO Review, WHEN HO requests revision without remarks, THEN 422.

GIVEN HO Revision Requested, WHEN JE resubmits, THEN state returns to Submitted, not directly Under HO Review.

### Exit gate

Complete state-machine tests PASS before row-level UI work begins.

---

## M3 — Row-Level ZO/HO Review

### Objective

Implement explicit contribution review.

### Requirements

ZO review modifies only:

```text
zo_office_approve
zo_remarks
```

HO review modifies only:

```text
ho_office_approve
ho_remarks
```

for contributions requiring approval in the current generation.

Previously Final Approved historical contributions remain locked and do not require reapproval.

ZO/HO review completion must distinguish:

```text
Approve
Not Approve
unreviewed/null
```

Header approval cannot succeed until all required current contributions satisfy the stage's row-level approval contract.

A `Not Approve` row prevents header approval and should drive Request Revision/Reject rather than silently being ignored.

### Acceptance criteria

* [ ] ZO cannot modify HO decision fields.
* [ ] HO cannot rewrite ZO decisions.
* [ ] Historical rows cannot be re-reviewed.
* [ ] Current-generation rows all require ZO approval.
* [ ] Current-generation rows all require HO approval before Final Approval.
* [ ] Missing decisions block header approval.
* [ ] `Not Approve` blocks header approval.
* [ ] Batch review is transactional.
* [ ] Review decisions are attributable.

### Mandatory tests

GIVEN 3 current rows with only 2 ZO decisions, WHEN ZO submits approval, THEN 422.

GIVEN one `Not Approve`, WHEN ZO approves header, THEN blocked.

GIVEN reopened estimate containing 20 historical rows + 2 new rows, WHEN ZO reviews, THEN only 2 new rows require decisions.

### Exit gate

Row-level DB/API tests PASS.

---

## M4 — Reopen + ADDITION/ADJUSTMENT

### Objective

Implement append-only post-approval revisions.

### Reopen transaction

Only:

```text
Final Approved
→ HO/Admin REOPEN
→ Estimate Reopened
```

Reopen must atomically:

```text
lock estimate
verify actor
verify Final Approved
increment estimate_revision exactly once
preserve last approved amount
preserve all existing lines
preserve approval history
append REOPEN event with mandatory reason
make new revision available for delta rows
```

### New row rules

In `Estimate Reopened`:

```text
BASE       prohibited
ADDITION   allowed
ADJUSTMENT allowed
```

Existing approved lines remain immutable.

### ADJUSTMENT validation

Inside transaction:

```text
adjusts_line_id required
target exists
target same estimate
target historically Final Approved
target same contractor
target same work
target not current unapproved row
qty != 0
rate > 0
amount = round(qty × rate, 2)
```

### Effective-scope validation

At Final Approval calculate effective scope including proposed current revision.

Reject if any logical contractor/work scope yields:

```text
qty < 0
OR
amount < 0
```

### Negative Finance guard

If the current revision contains any downward monetary adjustment, the Final Approval transaction must call the canonical read-only consumption primitive for every affected contractor/work scope and require:

```text
new effective approved amount >= consumed amount
```

If the proposed scope is below consumption, reject with HTTP 422 and a stable business code such as:

```text
SUBCONTRACT_SCOPE_BELOW_FINANCIAL_CONSUMPTION
```

The guard must run inside the same transaction as Final Approval. Phase 4B must not mutate balances, requisitions, settlements, or ledger records.

### Acceptance criteria

* [ ] Reopen only from Final Approved.
* [ ] Revision increments exactly once.
* [ ] Reopen reason mandatory.
* [ ] Historical rows preserved.
* [ ] New BASE prohibited.
* [ ] ADDITION works.
* [ ] Positive ADJUSTMENT works.
* [ ] Negative ADJUSTMENT can be drafted/reviewed.
* [ ] Invalid adjustment target rejected transactionally.
* [ ] Effective qty cannot Final Approve negative.
* [ ] Effective amount cannot Final Approve negative.
* [ ] Downward monetary adjustment cannot Final Approve before Finance guard exists.
* [ ] No Finance table is mutated.

### Mandatory tests

Include same-estimate/different-contractor target, same-contractor/different-work target, current-revision target, nonexistent target, positive adjustment, negative adjustment, over-reduction, repeated adjustment, and reopen twice concurrently.

### Exit gate

All reopen/adjustment invariants PASS at DB level.

---

## M5 — Frontend Workflow & Review Experience

### Objective

Expose the state machine without exposing illegal actions.

### Routes

Keep:

```text
/subcontract-estimates
/subcontract-estimates/:id
/subcontract-estimates/:id/edit
```

Do not create separate duplicate modules for every role unless existing ERP conventions require it.

### List page

Add:

```text
status filtering
status badges
role/state-aware primary action
revision
updated date
```

Example:

```text
JE + Draft                  → Edit
JE + Revision Requested     → Revise
ZO + Submitted              → Review
HO + ZO Approved            → Review
Any reader + Final Approved → View
HO/Admin + Final Approved   → View/Reopen
```

### Detail/review page

Separate:

```text
Approved History
Current Revision Changes
Workflow History
```

For reopened estimates:

```text
Previously Approved Scope
─────────────────────────
locked historical contributions

Current Revision #N
─────────────────────────
ADDITION / ADJUSTMENT rows

Previous Approved Amount
Current Delta
Projected Effective Amount
```

### Revision UX

Request Revision / Reject dialogs require remarks.

Review UI must show unresolved row decisions before enabling header approval.

### Editing reopened estimate

JE gets:

```text
+ Addition
+ Adjustment
```

For Adjustment, select the approved target first; contractor/work should derive from the target and not be independently spoofable.

### Historical inactive masters

Continue Phase 4A behavior: historical inactive references remain displayable.

### Async selectors

This is also the appropriate point to replace the temporary `limit:1000` master preload with reusable server-side searchable selectors rather than carrying the arbitrary ceiling deeper into the workflow.

### Acceptance criteria

* [ ] No role sees an action it cannot perform.
* [ ] Direct route protection mirrors backend.
* [ ] Review UI is read-only except review controls.
* [ ] Approved rows visibly locked.
* [ ] Reopened delta visually distinct.
* [ ] Adjustment target controls prevent identity mismatch.
* [ ] Workflow log visible.
* [ ] Revision/rejection/reopen remarks captured.
* [ ] Master selectors have no hard record ceiling.
* [ ] Backend remains authoritative regardless of UI restrictions.

### Exit gate

Frontend build passes and manual role matrix/UAT passes.

---

## M6 — Failure Recovery & Concurrency Hardening

### Objective

Verify workflow remains correct under real operational failure.

This milestone is mandatory, not cleanup.

Test:

```text
timeout after successful submit
double-click submit
two reviewers open same estimate
JE mapping removed while form open
ZO mapping removed while review open
role changed while screen open
reopen from two sessions
revision requested while stale HO tab remains open
master deactivated during revision
adjustment target changed/approved state stale
refresh after transition
retry after committed request whose response was lost
```

All workflow write APIs should support stale-state detection through `expected_updated_at`, expected state, or equivalent version semantics.

### Exit gate

No partial transitions and no duplicate workflow events under tested retry/concurrency cases.

---

## M7 — Regression, UAT & Freeze

Run:

```text
npm run test:contracts:db
npm run test:regression
npm run test:local
frontend build
```

plus dedicated Phase 4B regression suite.

Verify Phase 4A Draft CRUD still works.

Verify Cost Estimate unchanged.

Verify existing Finance ledger/reservation behavior unchanged.

No Phase 4B test should depend on generated Cost Estimate contributions.

---

# 6. FAILURE & RECOVERY MATRIX

| Scenario                             | Expected behavior                                                | Recovery                          | Required test |
| ------------------------------------ | ---------------------------------------------------------------- | --------------------------------- | ------------- |
| Submit committed, HTTP response lost | Exactly one transition/log                                       | Reload shows Submitted            | Yes           |
| Submit double-click                  | One success, one conflict/idempotent response                    | Reload                            | Yes           |
| Two ZOs review same version          | Stale second mutation rejected                                   | Reload latest                     | Yes           |
| Mapping removed after page load      | Action rejected server/DB-side                                   | Return read-only                  | Yes           |
| Role changed after page load         | Action rejected                                                  | Re-auth/reload                    | Yes           |
| Revision request + stale approval    | Stale approval rejected                                          | Reload                            | Yes           |
| Two HO reopen requests               | Revision increments once                                         | Second gets conflict              | Yes           |
| Master becomes inactive              | Existing historical/current persisted reference remains readable | New inactive selection prohibited | Yes           |
| Invalid adjustment target            | Entire save rejected                                             | Correct target                    | Yes           |
| Final approval fails scope guard     | No partial approvals/log/status                                  | Correct revision                  | Yes           |
| Negative adjustment reaches HO       | Final Approval blocked until Finance primitive exists            | Keep Under HO Review              | Yes           |
| Audit insert fails                   | Workflow transition rolls back                                   | Retry                             | Yes           |

---

# 7. DATA INTEGRITY & TRANSACTION BOUNDARIES

## Atomic operations

Each of these must be one DB transaction:

```text
submit/resubmit
open review
batch row review
ZO final review action
HO final review action
request revision
reject
reopen
save reopened revision
Final Approval
workflow log insertion accompanying any action
```

### Frontend invariants

Frontend handles:

```text
action visibility
form usability
confirmation
remarks collection
displaying projected totals
displaying locked history
```

Frontend does **not** enforce financial truth.

### Backend invariants

Backend handles:

```text
request validation
HTTP semantics
role prechecks
error mapping
response shaping
```

### Database invariants

DB handles:

```text
actor validity
mapping validity for critical writes
state transition legality
row locking
concurrency
approved-history immutability
entry-kind legality
adjustment-target legality
server amount
effective-scope guard
workflow log atomicity
revision increment
Final Approval
```

This separation is important because the current Phase 4A architecture already correctly puts draft reconciliation and stale-write protection in an RPC rather than relying on React/controller state.

---

# 8. FRONTEND CONTRACT

The frontend action matrix must be mechanically derived from:

```text
role
+
current estimate status
+
mapping/access
+
current revision/history
```

Do not use role alone.

Minimum screens:

```text
List
Detail
Draft/Revision Editor
ZO Review
HO Review
Reopen confirmation
Workflow History
```

These may share components/routes.

Approved historical rows should render immutable approval metadata.

Current revision rows should show:

```text
Entry Kind
Target (if adjustment)
Qty
Rate
Signed Amount
ZO decision
HO decision
Remarks
```

Never hide negative signs on ADJUSTMENT amounts.

---

# 9. API CONTRACT

Recommended extension of the existing `/api/v1/auth/subcontract-estimates` namespace:

| Endpoint                                              | Roles          | Purpose                                   |
| ----------------------------------------------------- | -------------- | ----------------------------------------- |
| `POST /:id/submit`                                    | JE/Admin       | Submit/resubmit                           |
| `PATCH /:id/review`                                   | ZO/HO/Admin    | Open appropriate review                   |
| `PATCH /:id/lines/:lineId/review` or batch equivalent | ZO/HO/Admin    | Row review                                |
| `POST /:id/submit-review`                             | ZO/HO/Admin    | Complete stage approval                   |
| `POST /:id/request-revision`                          | ZO/HO/Admin    | Request revision                          |
| `POST /:id/reject`                                    | ZO/HO/Admin    | Reject                                    |
| `POST /:id/reopen`                                    | HO/Admin       | Reopen Final Approved                     |
| `PUT /:id/lines`                                      | JE/Admin       | State-aware Draft/revision reconciliation |
| `GET /:id/workflow-history`                           | JE/ZO/HO/Admin | Audit history                             |

Prefer matching the Cost Estimate endpoint vocabulary where semantics match; don't match it where semantics differ.

### Error semantics

```text
400 malformed request/UUID
401 unauthenticated
403 actor/role/mapping/state permission denied
404 estimate/line/target not found
409 stale/concurrent/already-transitioned state
422 business invariant violation
```

Examples of 422:

```text
missing rows
missing revision reason
unreviewed rows
invalid adjustment target relationship
effective scope below zero
downward adjustment Final Approval currently blocked
```

Audit fields and workflow statuses must never be client-controlled.

---

# 10. ADVERSARIAL TEST MATRIX

| Area             | Required attacks                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Authorization    | JE acts on unmapped WO; ZO acts outside zone; HO performs ZO action; Accounts direct API; Admin attempts immutable-history rewrite |
| State machine    | approve Draft; reopen Submitted; resubmit Final Approved; review Rejected; repeated Final Approval                                 |
| Row review       | incomplete decisions; `Not Approve`; HO overwrites ZO; historical row re-review                                                    |
| Integrity        | cross-estimate line ID; adjustment target different contractor; different work; current-revision target; nonexistent target        |
| Numeric          | zero adjustment; zero rate; huge numeric; signed amount spoof; client amount spoof                                                 |
| History          | UPDATE approved BASE; DELETE approved ADDITION; mutate old approval                                                                |
| Concurrency      | double submit; two row reviews; simultaneous reopen; stale revision save                                                           |
| Recovery         | timeout-after-commit; refresh; retry; network loss                                                                                 |
| Master lifecycle | referenced contractor/work deactivated during revision                                                                             |
| Cross-module     | Cost Estimate unchanged; Finance balances unchanged; requisitions unchanged; ledger unchanged                                      |

---

# 11. OUT OF SCOPE

Hard Phase 4B exclusions:

```text
Cost Estimate generated rows
Cost Estimate aggregation by subcontract_work_id
weighted CE rate
cost_estimate_subcontract_contributions population
Finance capacity credit
Finance capacity mutation
Payment Requisition enforcement against normalized scope
subcontractor balance migration/cutover
ledger identity migration
settlement changes
PowerBI/reporting
```

The minimum read-only Finance-consumption primitive required to validate negative adjustments is in scope. Finance write-side migration/cutover remains Phase 6.

Phase 4B may prepare provenance required by Phase 5/6 but must not activate downstream behavior.

---

# 12. IMPLEMENTATION ORDER

```text
M1 Workflow DB + immutable provenance
        ↓
DB contract tests
        ↓
ADVERSARIAL DB REVIEW
        ↓
M2 State-machine RPC/API
        ↓
workflow tests
        ↓
STATE-MACHINE REVIEW
        ↓
M3 Row-level review
        ↓
row approval tests
        ↓
AUTHORIZATION REVIEW
        ↓
M4 Reopen + Addition + Adjustment
        ↓
effective-scope/adversarial tests
        ↓
FINANCIAL-INVARIANT REVIEW
        ↓
M5 Frontend
        ↓
build + role UAT
        ↓
FRONTEND CONTRACT REVIEW
        ↓
M6 Failure/concurrency
        ↓
adversarial suite
        ↓
M7 full regression/UAT
        ↓
PHASE 4B FREEZE
```

Suggested PR/commit boundaries:

```text
feat(subcontract-estimates): add workflow audit foundation
feat(subcontract-estimates): add transactional approval workflow
feat(subcontract-estimates): add row-level review
feat(subcontract-estimates): add reopen and signed adjustments
feat(subcontract-estimates): add workflow frontend
test(subcontract-estimates): harden workflow and concurrency contracts
```

Do not combine Phase 5 CE synchronization into the last 4B PR.

---

# 13. PROOF-OF-COMPLETION MATRIX

The implementation agent must fill this with exact file/RPC/test evidence:

| Requirement                      | Implementation Evidence | Test Evidence | Status            |
| -------------------------------- | ----------------------- | ------------- | ----------------- |
| State machine                    | TBD                     | TBD           | FAIL until proven |
| Role matrix                      | TBD                     | TBD           | FAIL until proven |
| Row-level ZO approval            | TBD                     | TBD           | FAIL until proven |
| Row-level HO approval            | TBD                     | TBD           | FAIL until proven |
| Revision requests                | TBD                     | TBD           | FAIL until proven |
| Rejection                        | TBD                     | TBD           | FAIL until proven |
| Immutable approved history       | TBD                     | TBD           | FAIL until proven |
| Workflow action log              | TBD                     | TBD           | FAIL until proven |
| Reopen                           | TBD                     | TBD           | FAIL until proven |
| ADDITION                         | TBD                     | TBD           | FAIL until proven |
| Signed ADJUSTMENT                | TBD                     | TBD           | FAIL until proven |
| Adjustment target guards         | TBD                     | TBD           | FAIL until proven |
| Effective-scope guards           | TBD                     | TBD           | FAIL until proven |
| Negative-adjustment Finance gate | TBD                     | TBD           | FAIL until proven |
| Concurrency                      | TBD                     | TBD           | FAIL until proven |
| Frontend authorization           | TBD                     | TBD           | FAIL until proven |
| Phase 4A regression              | TBD                     | TBD           | FAIL until proven |
| No CE mutation                   | TBD                     | TBD           | FAIL until proven |
| No Finance mutation              | TBD                     | TBD           | FAIL until proven |

This is intentionally strict: the attached planning format requires implementation and test evidence rather than treating “looks functional” as completion. 

---

# 14. FINAL RELEASE GATE

Phase 4B is complete only when:

* [ ] Every role/action pair is tested.
* [ ] Every valid state transition is tested.
* [ ] Every invalid transition is rejected.
* [ ] ZO/HO row-level approval is enforced.
* [ ] Revision-request loops preserve correct authority order.
* [ ] HO revision passes back through ZO.
* [ ] Approved contribution history is immutable at DB level.
* [ ] Reopen increments generation exactly once.
* [ ] Reopen never converts approved history back into Draft.
* [ ] New BASE after reopen is impossible.
* [ ] ADDITION semantics pass.
* [ ] Positive ADJUSTMENT semantics pass.
* [ ] Negative ADJUSTMENT drafting/review passes.
* [ ] Invalid adjustment targets fail.
* [ ] Effective qty/amount cannot become negative at Final Approval.
* [ ] Downward monetary adjustment cannot Final Approve before canonical Finance guard.
* [ ] Workflow audit log is complete and append-only.
* [ ] Concurrent actions cannot double-transition.
* [ ] Timeout/retry scenarios do not duplicate actions.
* [ ] JE/ZO mapping changes are enforced at action time.
* [ ] Frontend actions exactly match backend authorization.
* [ ] Historical inactive masters remain readable.
* [ ] Master selectors no longer have an arbitrary hard record ceiling.
* [ ] DB/RPC/index manifests include new objects.
* [ ] `npm run test:contracts:db` passes.
* [ ] `npm run test:regression` passes.
* [ ] `npm run test:local` passes.
* [ ] Frontend production build passes.
* [ ] Phase 4A Draft CRUD remains intact.
* [ ] Cost Estimate behavior remains unchanged.
* [ ] Finance balance/ledger/requisition behavior remains unchanged.
* [ ] No Phase 5/6 behavior has leaked into 4B.
* [ ] Fresh independent adversarial review has no P1/P2 findings.

## One architectural point I would freeze before implementation

There is one place where the implementation agent must **not improvise**: how a line is permanently marked as having participated in a Final Approved generation.

The existing schema gives lines mutable ZO/HO approval fields, but that alone is insufficient to distinguish:

```text
historically Final Approved contribution
```

from:

```text
currently approved by reviewers in an unfinished generation
```

So **M1 must explicitly introduce immutable Final-Approval provenance**. Once that exists, almost every difficult 4B rule—history locking, adjustment targeting, reopen review scope, effective-scope computation—becomes mechanically enforceable instead of inferred.

That is the main architectural improvement I would insist on before Codex starts M2.
