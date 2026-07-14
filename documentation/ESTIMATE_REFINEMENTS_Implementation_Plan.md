# Refinements Plan — Cost Estimate Restructuring & Validations

This document presents the technical implementation plan for refinements to the Cost Estimates module. It includes restricting work order assignments for Junior Engineers, displaying the Grand Total Cost instead of the Materials Cost at the table footer, and enriching the Estimate Summary panel with budget checks, variances, and status counts.

---

## Proposed Changes

### 1. Backend Controller Restructuring

#### [MODIFY] [estimates.core.controller.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/controllers/estimates.core.controller.js)

* **Refine `getEstimateInitData(req, res)`**:
  - Restrict available work orders if the user has the `je` role.
  - Query `work_order_mappings` table for the requesting JE (`req.user.mobile_number`) where `is_active = true`.
  - Filter `runningProjects` to include only projects whose `work_order_no` is present in the JE's active work order list.
  - For other roles (HO, Admin), retain the default behavior (showing all running projects not blocked by an active estimate).

* **Refine `createEstimate(req, res)`**:
  - Add security validation check before header creation.
  - If `req.user.role` is `je`, query `work_order_mappings` to verify if they are actively mapped to the selected `work_order_no`.
  - Return `403 Forbidden` if the mapping does not exist or is inactive.

---

### 2. Frontend User Interface Modifications

#### [MODIFY] [EstimateView.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/EstimateView.jsx)

* **Refine Table Footer Summary (Line 750)**:
  - Replace the label `Total Materials Cost` with `Grand Total Cost`.
  - Change the displayed value from `getCategoryTotal('Materials')` to `summary?.gross_total`.

* **Enrich "3. Estimate Summary" Card**:
  - Currently displays only category-wise costs and the gross total.
  - Update the panel to display:
    1. **Work Order Value**: fetched from `estimate.projects_master?.work_order_value`.
    2. **Grand Total Estimate**: `summary?.gross_total`.
    3. **Variance**: Calculated as `Variance = (Grand Total Estimate) - (Work Order Value)`.
    4. **Budget Check Indicator**:
       - If `Grand Total Estimate` $\le$ `Work Order Value`: Render a badge `[✓ Within Budget]` in green text.
       - If `Grand Total Estimate` $>$ `Work Order Value`: Render a warning badge `[⚠ Exceeds Budget]` in amber/red text, displaying the overage amount and percentage.
    5. **Category Cost Breakdown**: (Materials, Labour, Transport, Miscellaneous).
    6. **Line Item Status Breakdown**:
       - Render counts for:
         - **Total Items**: `items.length`
         - **Approved Items**: items with status `'Approve'` from ZO/HO.
         - **Rejected Items**: items with status `'Not Approve'` from ZO/HO.
         - **Pending Items**: items awaiting action.

---

## Verification Plan

### Automated Tests
- Create a test file `backend/tests/vitest/milestones/milestone_p7_estimate_refinements.test.js` covering:
  - Fetching `/estimates/init` as a JE user returns only their mapped work orders.
  - Creating an estimate for an unmapped work order as a JE user returns `403 Forbidden`.
  - Creating an estimate for a mapped work order successfully creates the draft.

### Manual Verification
1. Log in as a JE user. Go to the new estimate page, verify that the Work Order dropdown lists only the Work Orders explicitly mapped to you.
2. In the Estimate detail view, verify the footer below the table displays the correct Grand Total of all items.
3. Verify the Summary card shows the project budget comparison, variance calculation, and line item approvals summary dynamically.
