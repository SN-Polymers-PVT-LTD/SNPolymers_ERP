# Phase 4 Runtime Freeze Matrix

This document records the canonical runtime surface installed by migration 093.
Migrations 076–092 remain historical and are not edited.

| Concern | Canonical application path | Canonical database path | Protected state/invariant |
| --- | --- | --- | --- |
| Estimate line authoring | `PUT /subcontract-estimates/:id/lines` | `reconcile_subcontract_estimate_lines` | Draft/revision 0 uses `BASE`; revision > 0/reopened uses `ADDITION`/signed `ADJUSTMENT`; approved history is immutable; optimistic timestamp check |
| Estimate workflow | `POST /subcontract-estimates/:id/workflow` | `transition_subcontract_estimate_workflow` | State transition authorization, row approvals, provenance stamping, one workflow event, ordered financial scope locks and consumption guard |
| Row review | `POST /subcontract-estimates/:id/review-rows` | `review_subcontract_estimate_rows` | JE/ZO/HO role and scope checks, row-level approval, optimistic concurrency |
| Reopen | `POST /subcontract-estimates/:id/workflow` with `REOPEN` | `reopen_subcontract_estimate` | Existing approved lineage is reopened; revision increments; audit event is atomic |
| Reopened submission | `POST /subcontract-estimates/:id/workflow` with `SUBMIT_REOPENED` | `submit_reopened_subcontract_estimate` | Dedicated reopened path; ordinary `SUBMIT` is not used |
| Finance reservation boundary | Existing Finance caller | `approve_requisition_transact` | Finance implementation remains wrapped; subcontract scopes use canonical UUID identity and the shared advisory lock |
| Financial consumption | HO Final Approval | `get_subcontract_financial_consumption` | Counts active reserved commitments and actual payment amounts once; released commitments excluded |

## Shared tables and locking

- Estimate lineage: `project_subcontract_estimates` and
  `project_subcontract_estimate_lines`.
- Canonical master identity: `subcontractor_master.id` and
  `subcontract_work_master.id`.
- Finance identity: `requisitions.subcontractor_id`,
  `requisitions.subcontract_work_id`, and matching normalized ledger IDs.
- Finance/HO serialization: `lock_subcontract_financial_scope(work_order_no,
  subcontractor_id, subcontract_work_id)`, acquired in deterministic UUID order.
- Work identity first-use protection: migration 092 trigger locks the Work Master
  identity once an estimate line references it.

## Obsolete-path disposition

- `save_subcontract_estimate_draft_lines`: removed from runtime, routes, frontend,
  tests, and RPC manifests; its historical definitions remain only in migrations
  080/081.
- `transition_subcontract_estimate_workflow_unlocked`: retired by migration 093;
  no application/test caller remains. Historical definitions remain in migration
  history only.
- `approve_requisition_transact_unlocked`: intentionally retained as the private
  Finance implementation behind `approve_requisition_transact`; Phase 4 does not
  refactor Finance.

## Verification record

The focused clean-database Phase 4 runtime run applied migrations 001–093 and
passed 6 files / 15 tests:

- `subcontractEstimateDraft.test.js`
- `subcontractEstimateWorkflow.test.js`
- `subcontractEstimateReopen.test.js`
- `subcontractEstimateFailureRecovery.test.js`
- `subcontractEstimateProductionConcurrency.test.js`
- `subcontractWorkIdentityConcurrency.test.js`

The full local backend integration suite passed 96 files / 699 tests against
migration 093. The DB contract suite passed 7 files / 32 tests, and the
frontend production build completed successfully.

Migration-path verification also passed: a clean database was applied through
092 and then received only 093. The resulting inventory contained the two
canonical functions with `SECURITY DEFINER` and the expected arguments, while
both retired estimate/workflow function names were absent.
