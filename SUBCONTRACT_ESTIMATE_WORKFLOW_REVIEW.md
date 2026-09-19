# Cost Estimate and Subcontractor Estimate Workflow Review

Review date: 19 September 2026
Scope: documentation-only review on branch subcontractor-ledger. No application source, schema, migration, configuration, or test files were modified.

## 1. Executive summary

Cost Estimate is the established project-cost workflow. It has a clear draft-to-submit path, row-level ZO and HO decisions, revision deadlines and auto-resubmission, a specific reopen state, server-side pagination, and a dedicated revision-history endpoint. Its frontend keeps row approval fields intact while the backend applies role-sensitive item locking.

Subcontractor Estimate follows the same broad stages, but its prior implementation cleared both ZO and HO row decisions whenever a JE saved mutable current-revision lines, including an unchanged row. Its workflow transition also cleared those fields on resubmission. Phase 1 has repaired both paths with server-side comparison and retention wrappers.

The recommended repair is narrow: preserve decisions and remarks for unchanged, still-eligible lines; reset only lines that changed in a review-relevant way; make resubmission reset only the applicable stage; and expose bounded/paginated history rather than returning the full estimate history with every detail response. The Cost Estimate locking and retention pattern is the reference, not an instruction to copy its legacy SQL wholesale.

Phase 1 validation passed 10 backend regression files and 40 tests, plus 4 affected frontend form tests. The remaining open review finding is unbounded detail-history payload (P3). Ambiguous business decisions remain limited to reopened non-final inheritance and adjustment-target review scope.

## 2. Source inventory and effective SQL migration map

### Cost Estimate source inventory

| Layer | Reviewed source | Responsibility |
|---|---|---|
| Routes | backend/src/routes/estimates.routes.js | JWT, role gates, CRUD, item save, submit, reviews, revision history |
| Validation | backend/src/validation/estimate.schema.js | Header, item, submit, review and rejection-remark contracts |
| Header/controller | backend/src/controllers/estimates.core.controller.js | Create, list, current detail, project/master lookup |
| Items/controller | backend/src/controllers/estimates.items.controller.js | Draft item validation/persistence and row approvals |
| Workflow/controller | backend/src/controllers/estimates.workflow.controller.js | Revision request, deadline handling, history, reopen |
| API/frontend | frontend/src/api/estimatesApi.js | Client transport and query shape |
| Forms/views | frontend/src/pages/Estimates.jsx, EstimateForm.jsx, EstimateView.jsx | List, draft, submit, review and reopen UI |
| Effective SQL | backend/src/db/migrations/078_subcontract_cost_estimate_integration.sql; 080_cost_estimate_tombstone_review_semantics.sql | Final row-review semantics and generated subcontract tombstone exclusion |

Migration 080 is the effective authority for submit_zo_review and submit_ho_review. Migration 078 remains relevant for submit_row_approvals and for the Cost Estimate to subcontract contribution integration. The later migration must be treated as overriding overlapping earlier definitions.

### Subcontractor Estimate source inventory

| Layer | Reviewed source | Responsibility |
|---|---|---|
| Routes | backend/src/routes/subcontractEstimates.routes.js | Detail/list, reconcile, workflow and review APIs |
| Controller | backend/src/controllers/subcontractEstimates.controller.js | Detail/list orchestration, RPC invocation, Cost Estimate sync trigger |
| Validation | backend/src/validation/subcontractEstimate.schema.js | Header, line, workflow and review body contracts |
| API/frontend | frontend/src/api/subcontractEstimatesApi.js | Client transport |
| Forms/views | frontend/src/pages/SubcontractorEstimateForm.jsx, SubcontractorEstimateView.jsx, SubcontractorEstimates.jsx | Draft/reconciliation, current/historical display, review/reopen interactions |
| Effective SQL | backend/src/db/migrations/077_subcontract_estimate_workflow.sql | Final row review, reopen, reopened submit, reconciliation, transition workflow definitions |
| Integration SQL | backend/src/db/migrations/078_subcontract_cost_estimate_integration.sql | Generated Cost Estimate contribution behavior |

Migration 077 contains several redefinitions. Its final definitions of reconcile_subcontract_estimate_lines and transition_subcontract_estimate_workflow are the effective behavior; earlier occurrences in that same file are not sufficient evidence.

## 3. Complete Cost Estimate implementation review

### Creation and draft persistence

POST /api/estimates creates a Draft header after project-closure, work-order mapping, and active-estimate checks. The form creates the header first when needed, then saves lines through PUT /api/estimates/:id/items. The frontend initializes from server detail or local cached form state and uses already-loaded catalog mappings instead of fetching per field edit.

saveDraftItems validates material master identity and units. It reads existing rows before applying changes, then enforces row locks:

| Existing item condition | JE | ZO | HO/Admin |
|---|---:|---:|---:|
| HO approved | locked | locked | locked |
| HO decision present | locked | locked | permitted only where workflow allows |
| ZO approved | locked | permitted | permitted |
| New item in ZO/HO revision | locked | locked | admin exception |

The server persists the exact stored ZO and HO approval fields and remarks for editable existing lines. It only deletes omitted lines after applying the same lock checks. This is the key decision-retention behavior missing from the Subcontractor Estimate reconciliation RPC.

Risk: item saving consists of several database actions rather than one explicit transaction. A mid-operation failure can leave a partial item state, although validation is performed before most writes.

### Submit and state progression

The form saves the header/items before POST /api/estimates/:id/submit. The backend/RPC path validates stage and status before transition. The frontend catch text is generic; if saving succeeded and only submit failed, it may tell the user only that submission failed without making the persisted draft state conspicuous.

The review model is row-level. The effective SQL gates ZO completion on all active, non-tombstone rows being decided and approved. HO similarly requires all eligible rows to be decided and prevents an HO approval where the ZO decision is not approval. A rejection creates the applicable revision path rather than allowing a partial approval to silently finalise the estimate.

Migration 080 excludes generated SUBCONTRACT_ESTIMATE rows with both zero quantity and zero amount from the review denominator. This avoids a generated tombstone blocking review of a Cost Estimate after an upstream subcontract contribution changes.

### ZO and HO row review

The review schema requires remarks when a decision is rejection. submit_row_approvals validates line identifiers, stage and role before invoking the SQL workflow. Migration 078 submits individual row decisions; migration 080 provides the final header-level completion semantics. The UI locks generated rows and, in the relevant revision stage, rows already approved at that stage.

This implementation distinguishes a row that is approved, a row needing a decision, and a generated zero-scope tombstone. That distinction is important when using Cost Estimate as a behavioral reference.

### Revision, resubmission, deadline and automatic behavior

The workflow controller records revision requests with the requested stage, actor, remarks, and deadline. Revision history is retrieved separately through GET /api/estimates/:id/revisions and enriched with actor information. The UI renders a deadline timer and disables normal non-admin edits after expiry.

The implementation includes auto-resubmission behavior associated with elapsed active revision deadlines. UI text labels distinguish an automatic resubmission from a normal actor-triggered event. Revisions retain row-level decisions where the item lock rules say they remain valid; they are not globally erased simply because one other row is amended.

### Reopen

POST /api/estimates/:id/reopen is limited to HO/Admin, requires no active revision, creates an HO revision record with the reopen sentinel deadline, retains last approved amount, clears header-level approval metadata and sets Estimate Reopened. Existing row decisions and comments are retained; individual edit and review restrictions then determine what can be modified.

The Cost Estimate flow therefore represents reopen as a genuine editable and resubmittable state rather than silently replacing it with Draft.

### Current detail, history, list and master data

GET /api/estimates/:id returns current header, items, active revision deadline, names and summary. It deliberately does not return all revision history; that is the dedicated revisions endpoint. GET list uses exact-count server pagination and range handling, then evaluates active deadlines for returned records. The client applies some local filtering/search only to the fetched page, so it is not a global search guarantee.

Master/catalog data supports the form through initial lookup endpoints and cached maps. This avoids N-plus-one browser requests while editing a large estimate.

### Cost Estimate reference conclusions

Cost Estimate provides three applicable patterns:

1. Retain stored decisions and remarks for an unchanged editable line.
2. Enforce locks before deletion as well as update.
3. Separate current detail from history retrieval and use server-side pagination for list data.

Its multiple-write draft save and generic submit error text should not be copied as a desired contract.

## 4. Complete Subcontractor Estimate implementation review

### Creation, reconciliation and line semantics

The Subcontractor Estimate detail uses canonical subcontract work, subcontractor and assignment identity. The frontend saves through reconcile_subcontract_estimate_lines and filters historical lines when it prepares revision saves.

The effective reconciliation RPC allows JE/Admin editing in Draft, ZO Revision, HO Revision and Reopened statuses. It locks the header, validates version, maps actor entitlement, classifies BASE, ADDITION and signed ADJUSTMENT contribution semantics, and protects final-approved history. Deleting omitted mutable lines is supported.

Migration 087 retains migration 077 behind private legacy function names and installs public wrappers. Reconciliation locks the estimate and each persisted submitted line, then compares the persisted and proposed subcontractor, work, quantity, rate, calculated amount, rate reference, remarks, entry kind and adjustment target. Only an exactly unchanged row has its prior ZO/HO decisions and remarks restored. A corrected row remains reset for fresh ZO then HO review.

### Submission and review

The final transition_subcontract_estimate_workflow RPC validates mutable line readiness and transitions Draft or revision records through submit, ZO review and HO review. It creates workflow/revision records and, at final HO approval, stamps final_approved_revision and calculates/persists financial scope. Row review requires role and assignment mapping, requires remarks for Not Approve, prevents HO approval without ZO approval, and records appropriate history.

The Phase 1 public transition wrapper captures non-final row decisions before normal submission/resubmission and restores them after the legacy transition. Corrected rows are already null from reconciliation, so they remain pending. Every JE submission, including an HO-requested correction, still routes through Submitted and ZO review before HO review.

The controller invokes syncEditableCostEstimateForWorkOrderBestEffort after an HO approval. A failure in the downstream Cost Estimate synchronization does not roll back the already committed subcontract workflow RPC, so it must be monitored/retried as an integration concern.

### Reopen and resubmit

reopen_subcontract_estimate requires HO/Admin and a final-approved header, increments revision, writes a log record and updates the header. Migration 087 also wraps the still-supported submit_reopened_subcontract_estimate route so it does not erase an unchanged non-final row merely on submission. New reopened ADDITION and ADJUSTMENT rows remain undecided.

Whether a reopened estimate should preserve approvals for unchanged lines is a business rule that needs an explicit decision. It is not automatically resolved by copying the normal Cost Estimate behavior because subcontract financial contribution semantics are distinct.

### Detail, history and UI behavior

The detail selection returns current lines plus the complete project_subcontract_estimate_workflow_log and subcontract_estimate_revision_log collections. The view separates current/historical lines, performs a save before certain header revision/rejection actions, and reloads on 409 concurrency responses.

This is functional for small histories but unbounded over time. Unlike Cost Estimate, the detail endpoint does not separate or paginate long-running workflow history.

The form uses a five-minute active-subcontractor query cache. It sends current nonhistorical lines, but the backend’s unconditional nulling means client-side historical filtering alone cannot protect current decisions.

## 5. Comparison matrix

| Concern | Cost Estimate | Subcontractor Estimate | Assessment |
|---|---|---|---|
| Canonical identity | Project/work-order plus catalog items | Canonical subcontract work and subcontractor IDs | Both use IDs appropriately |
| Draft save | Retains stored decisions/remarks on existing editable items | Clears all decisions/remarks on every mutable line update | P1 divergence |
| Omitted line deletion | Checks locks before deletion | Deletes mutable nonfinal omitted lines | Subcontract needs decision-retention consideration |
| ZO review | All eligible active rows must be decided/approved | Role-mapped row review and transition checks | Broadly aligned |
| HO review | Requires ZO approval before HO approval | Explicitly rejects HO approval without ZO approval | Broadly aligned |
| Rejection remarks | Schema required | RPC required | Aligned |
| Revision deadline | Active deadline, timer, automatic resubmission | Workflow revision logs; verify browser deadline UX separately | Partially evidenced |
| Reopen | Retains item decisions; header state reopens | Header/revision only, then resubmit clears nonfinal decisions | Business decision plus P1 effect |
| Final immutability | HO-approved items locked | final_approved_revision history protected | Aligned intent |
| Generated subcontract rows | Tombstone exclusion in Cost review | Upstream source of generated rows | Integration-specific |
| Current detail/history | Detail excludes history; dedicated history route | Detail returns all history | P3 scalability divergence |
| List pagination | Server count/range | Server count/range | Aligned |

## 6. Detailed end-to-end scenarios

| Scenario | Expected result | Evidence/status |
|---|---|---|
| A. JE corrects line B while unchanged A was ZO approved | A retains ZO approval; only changed B returns to review as required | Verified defect: reconcile clears A |
| B. JE corrects line B while unchanged A was HO approved but not final history | A retains valid decision subject to stage lock | Verified defect: reconcile clears A |
| C. JE resubmits after a targeted correction | Only affected stage/changed lines are reset | Verified defect: transition clears all mutable decisions |
| D. JE reopens/edits after final approval | Preserve final history; decide whether unchanged new current lines retain review decisions | Business rule unresolved |
| E. ZO attempts approval without all eligible rows decided | Block completion | Verified by effective SQL gate |
| F. HO attempts to approve a row lacking ZO approval | Blocked | Verified by review RPC |
| G. Rejection without remarks | Validation failure | Verified by schema/RPC contracts |
| H. Generated zero-quantity/zero-amount subcontract tombstone in Cost Estimate | Does not block Cost Estimate review completion | Verified by migration 080 |

Runtime evidence: backend/scripts/test-local.sh passed the focused subcontract workflow, concurrency, failure-recovery and Phase 5 Cost Estimate integration suites: 7 files, 24 tests. The tests did not establish browser-level acceptance for every Cost Estimate path above.

## 7. Confirmed defects and gaps

### Resolved in Phase 1: reconciliation destroyed unchanged current approvals

Migration 087 corrects this by retaining decisions/remarks only after server-side equivalence comparison. During a ZO revision, a ZO-approved current row cannot be changed or omitted. During an HO revision, an HO-approved row cannot be changed or omitted; a ZO-approved/HO-rejected row remains editable so it can satisfy the required correction path.

Impact: reviewers repeat work; a JE can unintentionally invalidate an approval; workflow state becomes dependent on unrelated edits. This violates the Cost Estimate reference pattern and the expected row-level approval model.

### Resolved in Phase 1: resubmit performed an indiscriminate approval reset

The Phase 1 transition wrapper retains captured decisions for non-final rows at SUBMIT and RESUBMIT. No client-supplied unchanged flag is accepted. Rows changed by reconciliation have null decisions and must receive ZO approval before HO approval.

Impact: same outcome at a second entry point. The decision must be stage-aware and change-aware.

### P3. Detail response returns unbounded history

Subcontractor Estimate detail selects complete workflow and revision logs with the current estimate. Cost Estimate instead retrieves revision history separately. Long-lived estimates can increasingly inflate detail payload and render work.

Impact: performance and UI scalability risk, not current accounting corruption.

## 8. Ambiguous business rules requiring a product decision

1. Material-change definition: Which fields reset review approval: work/subcontractor identity, category, quantity, rate, amount, tax, effective date, beneficiary data, or only financial contribution fields?
2. Reopen semantics: In a new reopened revision, do unchanged non-final rows inherit prior approvals, or must every row be reconsidered? Final-approved historical rows remain immutable either way.
3. Adjustment review scope: Does a signed ADJUSTMENT require full re-review of its BASE/ADDITION target, or only of the adjustment line and recalculated aggregate?

Until resolved, the safest default is to retain approval only when the stored and proposed review-relevant field set is identical and the line remains eligible at the current stage.

## 9. Surgical Subcontractor Estimate refactor specification

1. Completed: migration 087 wraps reconciliation with server-side field comparison and exact decision retention for unchanged rows.
2. Completed: corrected rows reset both review stages; unchanged rows retain decisions and remarks.
3. Completed: wrappers cover normal submit, revision resubmit and the supported reopened-submit route.
4. Completed: approved current rows cannot be edited or omitted according to the active revision stage.
5. Preserved: final_approved_revision history, concurrency checks, financial scope locks, ledger behavior and Cost Estimate integration.
6. Deferred: paginate subcontract workflow/history separately from detail.

## 10. Regression and E2E test matrix

| Test | Layer | Expected assertion |
|---|---|---|
| Save B while approved A unchanged | DB RPC | A decision/remark survive; B follows material-change rule |
| Resubmit after B correction | DB RPC | Unchanged A is not reset |
| Change one HO-approved current line | DB RPC | Locked/allowed behavior follows role and stage contract |
| Omit a protected line | DB RPC | Delete is rejected |
| ZO completion with undecided line | DB RPC | Header transition rejected |
| HO approval without ZO approval | DB RPC | Review rejected |
| Not Approve without remark | API/DB | Stable 4xx validation failure |
| Reopen and submit | DB/API | Final history immutable; adopted inheritance rule tested |
| BASE, ADDITION, ADJUSTMENT | DB/API | Contribution and target linkage remain correct |
| Cost generated tombstone | DB/API | Zero-scope row excluded from Cost review denominator |
| History pagination | API/frontend | Bounded detail; history pages ordered and complete |
| Save-then-submit failure UX | Browser | Persisted draft state is visible and recoverable |
| Role/assignment route access | Browser/API | JE, ZO, HO, admin visibility and backend enforcement align |

Phase 1 evidence: backend/scripts/test-local.sh passed subcontractEstimateApprovalRetention, Draft, RowReview, Workflow, Reopen, FailureRecovery, ProductionConcurrency, phase5CostEstimateIntegration, subcontractorLedgerCanonical and subcontractorLedgerCanonicalStatement: 10 files and 40 tests. frontend npx vitest run src/pages/SubcontractEstimateForm.test.jsx passed 4 tests.

## 11. Limitations

This is a static source and effective-migration review supplemented by the focused local test run. It did not modify data or test a production/staging tenant. Cost Estimate browser behavior was traced from code but not exercised as a complete live browser scenario in this review. Database function behavior is based on the repository’s migration ordering and requires a fresh local/staging migration application to validate deployment drift if the database has out-of-band changes.

The document distinguishes implemented workflow rules from business-policy choices. Phase 1 intentionally does not choose whether unchanged non-final rows in every reopened business case inherit approval, nor whether an ADJUSTMENT requires re-review of its target contribution. The retained existing behavior is limited to preventing submission-time erasure; future policy changes should be explicit and separately tested.
