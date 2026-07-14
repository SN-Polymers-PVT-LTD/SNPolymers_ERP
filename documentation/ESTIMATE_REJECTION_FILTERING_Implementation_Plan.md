# Refinements Plan — Restricting Estimate Creation to Rejected or Empty Work Orders

This document outlines the implementation plan to restrict Cost Estimate creation so that a Work Order is eligible ONLY if it has no existing estimates, or if its existing estimate has been terminal rejected (either `'Rejected by ZO'` or `'Rejected by HO'`). 

For any other estimate statuses (e.g. `'Draft'`, `'Submitted'`, `'Under ZO Review'`, `'ZO Approved'`, `'Under HO Review'`, `'Final Approved'`), the Work Order is blocked.

---

## Technical Inspection & Source of Truth

We inspected the database schema and RPCs to verify how the states are represented:
1. **Rejected by ZO**: Represented by `estimate_status = 'Rejected by ZO'`.
2. **Accepted by ZO but rejected by HO**: Represented by `estimate_status = 'Rejected by HO'`. In the workflow, an estimate must first be ZO-approved to enter HO review where it can be rejected.
3. **No other tables/fields** track the terminal state of rejection. The `estimate_status` column of `project_cost_estimates` is the single source of truth.

---

## Proposed Changes

### 1. Backend Modifications

#### [MODIFY] [estimates.core.controller.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/controllers/estimates.core.controller.js)

* **Update `getEstimateInitData(req, res)`**:
  - Fetch estimate records that are **not** rejected.
  - Query:
    ```javascript
    supabase.from('project_cost_estimates')
      .select('work_order_no')
      .not('estimate_status', 'in', '("Rejected by ZO","Rejected by HO")')
    ```
  - Any Work Order returned by this query is added to the `blockedWorkOrders` set.
  - This effectively hides Work Orders with active (Draft, Submitted, Under Review) or Final Approved estimates from the dropdown list.

* **Update `createEstimate(req, res)`**:
  - Modify the active estimate check query.
  - Query:
    ```javascript
    const { data: activeEstimates, error: activeError } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id')
      .eq('work_order_no', work_order_no)
      .not('estimate_status', 'in', `("${ESTIMATE_STATUS.REJECTED_BY_ZO}","${ESTIMATE_STATUS.REJECTED_BY_HO}")`);
    ```
  - If any row is returned, the backend rejects the request with `409 Conflict` (or appropriate error message).

---

## Verification Plan

### Automated Tests
- Add tests in `backend/tests/vitest/milestones/milestone_p7_estimate_refinements.test.js`:
  - Check that a Work Order with a `'Final Approved'` estimate is excluded from the dropdown init endpoint.
  - Check that a Work Order with a `'Draft'` estimate is excluded.
  - Check that a Work Order with a `'Rejected by ZO'` estimate is included.
  - Check that a Work Order with a `'Rejected by HO'` estimate is included.

### Manual Verification
1. Open the New Cost Estimate page. Verify that Work Orders with existing Approved or Draft estimates are hidden.
2. Verify that Work Orders with Rejected estimates are shown.
