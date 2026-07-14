# Refinements Plan — Hide Work Orders with Final Approved Estimates

This document outlines the implementation plan to ensure that Work Orders with existing estimates in any status (including `'Final Approved'`), except `'Rejected by ZO'` and `'Rejected by HO'`, are hidden from the Junior Engineer's dropdown list when creating a new Cost Estimate, and are blocked from creation on the backend.

---

## Proposed Changes

### 1. Backend Modifications

#### [MODIFY] [estimates.core.controller.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/controllers/estimates.core.controller.js)

* **Update `getEstimateInitData(req, res)`**:
  - Modify the Supabase query fetching active estimates.
  - Change the exclusion list from:
    `not('estimate_status', 'in', '("Final Approved","Rejected by ZO","Rejected by HO")')`
    to:
    `not('estimate_status', 'in', '("Rejected by ZO","Rejected by HO")')`
  - This ensures that work orders with `'Final Approved'` estimates are classified as blocked and hidden from the dropdown.

* **Update `createEstimate(req, res)`**:
  - Modify the Supabase query fetching active estimates.
  - Change the exclusion check from:
    `not('estimate_status', 'in', '("Final Approved","Rejected by ZO","Rejected by HO")')`
    to:
    `not('estimate_status', 'in', '("Rejected by ZO","Rejected by HO")')`
  - This enforces server-side validation blocking the creation of a new estimate on a project that already has a `'Final Approved'` estimate.

---

## Verification Plan

### Automated Tests
- Create test cases in `backend/tests/vitest/milestones/milestone_p7_estimate_refinements.test.js` to cover:
  - If a project has a `'Final Approved'` estimate, its work order is hidden from `getEstimateInitData` results.
  - If a project has a `'Final Approved'` estimate, attempting to call `createEstimate` returns `409 Conflict` (already exists).

### Manual Verification
1. Verify that a work order with a `'Final Approved'` estimate does not appear in the "Work Order Number" dropdown on the New Cost Estimate page.
2. Verify that a work order with a `'Rejected by ZO'` estimate does appear in the dropdown.
