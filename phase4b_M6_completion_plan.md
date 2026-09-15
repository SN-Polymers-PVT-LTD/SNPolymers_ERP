# Phase 4B M6 Completion Plan

## Scope

M6 hardens the already implemented Phase 4B workflow against operational failure, stale browser state, authorization changes, and concurrent writers. It does not introduce a new workflow model or downstream Cost Estimate/Finance behavior.

The current M6 regression already proves:

- a committed `SUBMIT` retried with the old timestamp creates no second transition;
- two sessions opening the same ZO review produce one success and one `P4B13` stale conflict;
- stale row review is rejected with `P4B23` without changing the row;
- two concurrent `REOPEN` calls produce one revision and one conflict/state rejection;
- workflow log events are not duplicated.

## Trace of the current implementation

### Database authority

The write paths are implemented as transactional PostgreSQL functions:

- `backend/src/db/migrations/083_subcontract_estimate_workflow_rpcs.sql`
  - locks the estimate with `FOR UPDATE`;
  - checks `expected_updated_at`;
  - validates the current actor and JE/ZO mapping;
  - performs status/approval changes and workflow-log insertion in one transaction.
- `backend/src/db/migrations/084_subcontract_estimate_row_review.sql`
  - locks the estimate and each submitted line;
  - checks review-stage state, actor role, ZO mapping, stale timestamp, and historical-line immutability.
- `backend/src/db/migrations/085_subcontract_estimate_reopen_and_delta_lines.sql`
  - locks the estimate for reopen, revision-line reconciliation, and reopened submission;
  - validates active masters for new selections;
  - permits persisted inactive references only when editing an existing line;
  - locks and validates adjustment targets.

### Backend boundary

- `backend/src/routes/subcontractEstimates.routes.js` applies JWT, route roles, and Zod validation.
- `backend/src/controllers/subcontractEstimates.controller.js` maps database conflict/business codes to HTTP responses, including `409` for stale state.
- `backend/src/validation/subcontractEstimates.schema.js` requires `expected_updated_at` on every workflow write payload.

The database remains authoritative if a browser holds a stale JWT, stale role, stale mapping, or stale estimate version. Controller route checks are not sufficient by themselves and must remain secondary.

### Frontend boundary

- `frontend/src/pages/SubcontractEstimateForm.jsx` owns draft/reopened editing and submits the loaded `updated_at`.
- `frontend/src/pages/SubcontractEstimateView.jsx` owns review actions, row decisions, reopen, and reload-after-action behavior.
- `frontend/src/api/subcontractEstimatesApi.js` owns the authenticated write calls.
- `frontend/src/App.jsx` separates reader routes from JE/Admin editor routes.

The frontend currently displays a conflict error but does not yet provide a consistent reload/recovery affordance after a `409`. M6 should improve that UX without weakening server conflict handling.

## Contract discrepancy to resolve before M7

The execution plan describes a canonical read-only Finance-consumption primitive. M6 resolves this by treating the locked, in-transaction ledger query inside `transition_subcontract_estimate_workflow` during `HO_APPROVE` as that primitive. It is transactionally read-only, locks the matching ledger rows before summing, counts only current `RESERVED`/`SETTLED` commitments once, and does not mutate Finance. A separately named SQL function is not required for this phase. This decision must remain documented before M7 freeze and must not expand into Cost Estimate synchronization or Finance write-side migration.

## Completion workstreams

### M6.1 Authorization changes during an open session

Add DB-backed regression coverage using real temporary JE/ZO users and mappings:

1. Load a Draft as JE, deactivate/remove the JE Work Order mapping, then attempt `SUBMIT` and draft-line save. Expect authorization rejection and no status/line mutation.
2. Open ZO review, deactivate/remove the ZO mapping, then attempt row review and header approval. Expect `P4B21/P4B25` or the existing mapped HTTP `403`; verify no row or status change.
3. Load a review page, change the actor from the required role or deactivate the actor, then attempt the action. Expect rejection from the RPC even if the old JWT would still pass the route middleware.
4. Verify Admin remains intentionally exempt from Work Order mapping checks but still must be active.

Primary files:

- `backend/tests/vitest/regression/subcontractEstimateFailureRecovery.test.js`
- `backend/src/db/migrations/083_subcontract_estimate_workflow_rpcs.sql`
- `backend/src/db/migrations/084_subcontract_estimate_row_review.sql`
- `backend/src/db/migrations/085_subcontract_estimate_reopen_and_delta_lines.sql`

### M6.2 Stale revision and approval races

Extend the M6 suite to prove:

1. A ZO revision request committed from one session causes a stale HO approval from an already-open tab to fail with `409` and leaves the estimate in the revision-requested state.
2. A stale `SUBMIT_REOPENED` request cannot reset approvals or add a workflow event.
3. A stale `reconcile_subcontract_estimate_lines` request cannot delete, update, or insert current revision rows.
4. Two simultaneous row-review batches cannot partially overwrite one another; exactly one stale batch is rejected.
5. A Final Approval scope/Finance-consumption failure leaves status, approvals, `last_approved_amount`, and workflow history unchanged.

Primary files:

- `backend/tests/vitest/regression/subcontractEstimateFailureRecovery.test.js`
- `backend/tests/vitest/regression/subcontractEstimateReopen.test.js`
- `backend/tests/vitest/regression/subcontractEstimateRowReview.test.js`
- `backend/src/controllers/subcontractEstimates.controller.js`

### M6.3 Master lifecycle races

Test the distinction between persisted historical identity and new selection:

1. Deactivate the contractor/work master after the form has loaded but before saving an existing current line. The existing UUID reference remains valid and readable.
2. Attempt to add a new line using the inactive contractor/work. The RPC rejects it with `P4B48` and leaves all existing lines untouched.
3. Deactivate a historical approved master and reload the detail endpoint. The response still contains the UUID and the UI renders the inactive label.
4. Attempt an adjustment whose target is not historically approved, belongs to another scope, or is being submitted from a stale revision. The entire reconciliation must fail atomically.

Primary files:

- `backend/src/db/migrations/085_subcontract_estimate_reopen_and_delta_lines.sql`
- `backend/src/controllers/subcontractEstimates.controller.js`
- `frontend/src/pages/SubcontractEstimateForm.jsx`
- `frontend/src/pages/SubcontractEstimateView.jsx`
- `backend/tests/vitest/regression/subcontractEstimateReopen.test.js`

### M6.4 Recovery UX and API contract

Make conflict recovery consistent across all write actions:

1. Keep `409` as the stable response for stale estimate versions.
2. On a frontend `409`, retain the user’s unsaved form locally, reload the authoritative estimate, and show an explicit “estimate changed; review latest version before retrying” message.
3. After a successful transition, reload the detail response rather than relying only on the mutation response.
4. Ensure retrying after a lost response is safe: the second request must surface a conflict or an already-completed state, never duplicate a workflow log.
5. Verify browser refresh after every transition shows the persisted status, revision, row approvals, and workflow history.

Likely frontend files:

- `frontend/src/pages/SubcontractEstimateForm.jsx`
- `frontend/src/pages/SubcontractEstimateView.jsx`
- `frontend/src/api/subcontractEstimatesApi.js`

Likely backend contract test files:

- `backend/tests/vitest/regression/subcontractEstimateFailureRecovery.test.js`
- `backend/tests/vitest/contracts/apiResponseShape.test.js`

### M6.5 Atomic failure proof

Cover rollback rather than trying to manufacture arbitrary infrastructure failures in production SQL:

- invalid actor, mapping, state, stale version, invalid adjustment target, and negative effective scope must leave no partial status/row/log changes;
- failed Final Approval must not alter Finance ledger rows, requisitions, or balances;
- workflow-log counts must increase only when the corresponding transition commits.

If a test-only database fault injection is needed for an insert failure, isolate it to a disposable test session or a dedicated test migration. Do not weaken the append-only workflow-log trigger or add production fault switches.

## Test matrix and acceptance criteria

The dedicated M6 suite should finish with at least these groups:

| Group | Required evidence |
|---|---|
| Retry | committed submit/reopen/review retried safely |
| Concurrency | two review writers and two reopen writers serialize correctly |
| Authorization | mapping removal, actor deactivation, and role change are rejected by DB authority |
| Revision | stale approval/save/submission cannot mutate newer revision state |
| Masters | inactive persisted references remain readable; new inactive selections fail |
| Integrity | adjustment target and negative-scope failures are atomic |
| Recovery | `409` responses and refreshed UI state are actionable |
| Cross-module | no Cost Estimate or Finance mutation occurs in Phase 4B tests |

M6 exits only when:

1. every workflow write path has a tested stale-state/version guard;
2. authorization changes after page load are rejected at the database boundary;
3. no tested failure leaves a partial transition or duplicate workflow event;
4. frontend conflict recovery is explicit and preserves user safety;
5. focused M6, Phase 4B regression, backend contract, and frontend build/test gates pass.

## Execution order

1. Extend the DB-backed M6 fixture with authorization and stale-revision cases.
2. Add inactive-master and adjustment-target race coverage.
3. Implement frontend `409` recovery/reload behavior.
4. Add API-level response assertions for stale conflicts and authorization failures.
5. Run focused M6 tests, then Phase 4B regressions and frontend tests/build.
6. Review the diff for accidental Cost Estimate/Finance scope leakage before M7.
