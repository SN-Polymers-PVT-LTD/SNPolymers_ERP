# ZO Fund Request & HO Approval Process — Updated Flow Implementation Plan

> **Status:** Draft — Pending approval.
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Builds on:** Phase 1 (auth, fund reports) + Phase 2 (estimates) + Phase 3 (fund requests) + Phase 4 (requisitions) + Phase 7 (zonal office mappings & ledgers)
> **Reference:** ZO Fund Request & HO Approval Process — Updated Complete Process Flow

---

## Background & Scope

This implementation plan refines the **ZO Fund Request and HO Approval Process** to enforce work order mapping, status allowlists, cumulative funding ceilings, ownership transfer history preservation, and database transaction safety. 

### Core Business Rules & Clarifications
1. **Work Order Current Ownership**: 
   - Authoritative source: `projects_master.zo_user_id = authorised_users.mobile_number`.
   - On Fund Request creation, the system shows and validates only Work Orders owned by the logged-in ZO.
   - The ZO is stored directly on the Fund Request record as a **frozen historical association**.
2. **Preservation on Transfer**:
   - If a Work Order's ownership is transferred (`ZO-A` to `ZO-B`), all historical Fund Requests, approvals, and ledger entries raised by `ZO-A` remain frozen and associated with `ZO-A`.
   - Any new requests are created under the new owner (`ZO-B`).
3. **Work Order Funding History Continuance**:
   - The cumulative HO-approved funding capacity belongs to the **Work Order** itself, not to the Zonal Officer.
   - Transferring a Work Order does **not** reset its cumulative funding calculations.
4. **Work Order Status Gate**:
   - Status `Running` (Active) and `Complete Under Maintenance` (Under Maintenance) are eligible for fund requests.
   - Status `Closed` (Inactive) is blocked.
5. **Atomic Transaction & Duplicate Check**:
   - Approvals are processed in a single transaction in `approve_fund_request_transact`.
   - Duplicate postings are blocked by checking if a ledger entry with `reference_type = 'FUND_REQUEST'` and `reference_id = p_fund_request_id` already exists, rolling back the transaction if true.
6. **Cumulative Funding Ceiling**:
   - The total Cost Estimate Amount (`projects_master.work_order_value`) is a hard ceiling for cumulative HO-approved amounts.
   - `Remaining Capacity = Work Order Value - Total Cumulative HO-Approved amount for that Work Order`.
   - Validation occurs at both creation (ZO) and approval (HO) to prevent race conditions.

---

## Role Architecture

| Role | Responsibility |
|---|---|
| `zo` | **Creates** fund requests for mapped Active/Under Maintenance WOs within the current remaining capacity. Views own requests. |
| `ho` | **Reviews** fund requests. Performs **Approve** (with approved amount and transfer account) or **Hold** (no balance changes). |
| `admin` | Full access. Can request on behalf of a ZO, or approve/hold requests. |

---

## Resolved Design Decisions

### Q1 — How is Work Order ownership defined, and what happens if ownership changes?

**Resolution:**
- Defined by: `projects_master.zo_user_id = authorised_users.mobile_number`.
- Only show and allow creation for WOs owned by the logged-in ZO.
- Stored as a frozen historical association on the fund request. If the WO is later transferred from ZO-A to ZO-B, previous requests, approvals, and ledger entries remain with ZO-A. New requests are logged for ZO-B.
- The remaining capacity is calculated against the Work Order value: `Remaining WO Capacity = WO Value - Cumulative HO-Approved amount`. The history of allocations stays with the Work Order.

### Q2 — What Work Order statuses are eligible for Fund Requests?

**Resolution:**
- Status `Running` (Active) and `Complete Under Maintenance` (Under Maintenance) are eligible.
- Status `Closed` (Inactive) is blocked.
- Both frontend dropdown filtering and backend controller validations enforce this.

### Q3 — How are duplicate HO approvals prevented?

**Resolution:**
- The transaction `approve_fund_request_transact` queries `zo_fund_ledger` to check if a record with `reference_type = 'FUND_REQUEST'` and `reference_id = p_fund_request_id` already exists.
- If it exists, the transaction fails and rolls back. This prevents double-credits and duplicate `ALLOCATION` entries.

### Q4 — How is the Work Order / Cost Estimate funding limit enforced?

**Resolution:**
- **ZO Creation Rule**: `ZO_FR_Amount <= Remaining WO Funding Capacity`.
- **HO Approval Rule**: `Previous Cumulative HO-Approved Amount + New HO Approved Amount <= Total Cost Estimate Amount`.
- Calculations are performed inside the database transaction to prevent concurrent approvals from exceeding the WO value.

---

## Proposed Changes

### Component 1 — Database Migration

#### [NEW] [30_update_approve_fund_request_rpc.sql](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/db/migrations/30_update_approve_fund_request_rpc.sql)

Drops the existing version of `approve_fund_request_transact` and replaces it with an atomically safe version implementing the new validations.

```sql
-- ===========================================================================
-- Migration 30: ZO Fund Request & HO Approval — Atomic Transactions & Validations
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Drop existing function to avoid signature conflicts
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.approve_fund_request_transact(UUID, NUMERIC, VARCHAR, VARCHAR, TEXT);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Re-create approve_fund_request_transact with enhanced validations
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_fund_request_transact(
    p_fund_request_id UUID,
    p_approved_amount NUMERIC,
    p_transfer_from_account VARCHAR,
    p_actioned_by VARCHAR,
    p_remarks TEXT
)
RETURNS public.fund_requests AS $$
DECLARE
    v_fr public.fund_requests;
    v_wo_value NUMERIC(18,2);
    v_cumulative_approved NUMERIC(18,2);
    v_balance public.zo_balances;
BEGIN
    -- A. Lock fund request row and verify it exists
    SELECT * INTO v_fr 
      FROM public.fund_requests 
     WHERE fund_request_id = p_fund_request_id 
       FOR UPDATE;
       
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fund request not found.';
    END IF;

    -- B. Verify request status is Pending or Hold
    IF v_fr.request_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Fund request status must be Pending or Hold.';
    END IF;

    -- C. Fetch Work Order Value from projects_master
    SELECT work_order_value INTO v_wo_value 
      FROM public.projects_master 
     WHERE work_order_no = v_fr.work_order_no;
     
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated Work Order not found in projects_master.';
    END IF;

    -- D. Duplicate Posting Check: Verify no ALLOCATION ledger entry already exists for this Fund Request
    IF EXISTS (
        SELECT 1 
          FROM public.zo_fund_ledger 
         WHERE reference_type = 'FUND_REQUEST' 
           AND reference_id = p_fund_request_id
    ) THEN
        RAISE EXCEPTION 'Duplicate Posting Check Failed: Allocation ledger entry already exists for this Fund Request.';
    END IF;

    -- E. Recalculate Work Order remaining funding capacity
    SELECT COALESCE(SUM(approve_ho_amount), 0.00) INTO v_cumulative_approved
      FROM public.fund_requests
     WHERE work_order_no = v_fr.work_order_no
       AND request_status = 'Approved';

    -- F. Validate Approved Amount
    IF p_approved_amount <= 0.00 THEN
        RAISE EXCEPTION 'Approved amount must be positive and greater than zero.';
    END IF;

    IF p_approved_amount > v_fr.zo_fr_amount THEN
        RAISE EXCEPTION 'Approved amount (₹%) cannot exceed the requested amount (₹%).', 
            p_approved_amount, v_fr.zo_fr_amount;
    END IF;

    IF (v_cumulative_approved + p_approved_amount) > v_wo_value THEN
        RAISE EXCEPTION 'Approved amount (₹%) exceeds the remaining Work Order capacity (₹%).', 
            p_approved_amount, (v_wo_value - v_cumulative_approved);
    END IF;

    -- G. Validate Transfer Account is provided
    IF p_transfer_from_account IS NULL OR p_transfer_from_account = '' THEN
        RAISE EXCEPTION 'Transfer account is required for approval.';
    END IF;

    -- H. Initialize balance cache row with ON CONFLICT DO NOTHING if missing
    INSERT INTO public.zo_balances (zo_user_id, available_balance)
    VALUES (v_fr.zo_user_id, 0.00)
    ON CONFLICT (zo_user_id) DO NOTHING;

    -- I. Lock ZO balance row for update
    SELECT * INTO v_balance 
      FROM public.zo_balances 
     WHERE zo_user_id = v_fr.zo_user_id 
       FOR UPDATE;

    -- J. Increase Zonal available balance
    UPDATE public.zo_balances 
       SET available_balance = available_balance + p_approved_amount, 
           updated_at = now()
     WHERE zo_user_id = v_fr.zo_user_id;

    -- K. Create Fund Ledger Entry (credit allocation)
    INSERT INTO public.zo_fund_ledger (
        zo_user_id,
        transaction_type,
        reference_type,
        reference_id,
        amount,
        work_order_no,
        created_by
    ) VALUES (
        v_fr.zo_user_id,
        'ALLOCATION',
        'FUND_REQUEST',
        p_fund_request_id,
        p_approved_amount,
        v_fr.work_order_no,
        p_actioned_by
    );

    -- L. Update Fund Request Record status to 'Approved'
    UPDATE public.fund_requests
       SET request_status = 'Approved',
           approve_ho_amount = p_approved_amount,
           transfer_from_account = p_transfer_from_account::transfer_account_enum,
           approve_ho_user_id = p_actioned_by,
           approve_ho_date = now(),
           ho_remarks = p_remarks,
           updated_at = now()
     WHERE fund_request_id = p_fund_request_id
    RETURNING * INTO v_fr;

    RETURN v_fr;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Grant Permissions
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.approve_fund_request_transact TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_fund_request_transact TO service_role;
```

---

### Component 2 — Backend Controllers

#### [MODIFY] [fundRequests.controller.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/controllers/fundRequests.controller.js)

1. In `createFundRequest`:
   - Fetch the project details: `work_order_value` and `status` and `zo_user_id`.
   - Update project validations:
     - Check status is `Running` or `Complete Under Maintenance`. Reject with `400` if not.
     - Calculate cumulative approved amounts:
       ```javascript
       const { data: approvedRequests, error: approvedError } = await supabase
         .from('fund_requests')
         .select('approve_ho_amount')
         .eq('work_order_no', work_order_no.trim())
         .eq('request_status', 'Approved');
       
       if (approvedError) throw approvedError;
       const cumulativeApproved = approvedRequests.reduce((sum, r) => sum + Number(r.approve_ho_amount || 0), 0);
       const remainingCapacity = Number(project.work_order_value) - cumulativeApproved;
       ```
     - Enforce:
       ```javascript
       if (amount > remainingCapacity) {
         return res.status(400).json({
           success: false,
           message: `Requested amount (₹${amount.toLocaleString('en-IN')}) cannot exceed the remaining Work Order funding capacity (₹${remainingCapacity.toLocaleString('en-IN')}).`
         });
       }
       ```
2. In `actOnFundRequest`:
   - Fetch project's `work_order_value` and re-calculate cumulative approved requests.
   - Enforce remaining capacity check:
     - `hoAmount <= remainingCapacity`
     - `hoAmount <= fr.zo_fr_amount`
     - `hoAmount > 0`
   - Handle `action === 'Hold'` by clearing transfer values.

---

### Component 3 — Frontend UI

#### [MODIFY] [RequestDetailPanel.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/components/fundRequests/RequestDetailPanel.jsx)

1. **New Request Form Mode (`isCreate === true`)**:
   - Fetch the projects owned by the ZO via `getProjects()` in a `useEffect`.
   - Filter projects locally so they match:
     - `p.zo_user_id === user.mobile_number`
     - `p.status === 'Running' || p.status === 'Complete Under Maintenance'`
   - Fetch all `Approved` fund requests to calculate the remaining capacity of the selected Work Order before form submission.
   - Render a select dropdown for `Work Order`.
   - Display:
     - Work Order Value
     - Total HO-Approved Amount
     - Remaining WO Funding Capacity
   - Enforce client-side validation that requested amount does not exceed the remaining capacity.

2. **Detail/Review Mode (`isCreate === false`)**:
   - Fetch requesting ZO's Global Available Balance by calling `getZonalBalances()`. Match where `zo_user_id === request.zo_user_id`.
   - Fetch project cost values and existing approved requests to calculate remaining capacity.
   - Display:
     - Zonal Office
     - Fund Request Number
     - Work Order
     - Requested Amount
     - ZO Remarks
     - Work Order Value
     - Cumulative HO-Approved Amount
     - Remaining WO Funding Capacity
     - Current Global ZO Available Balance
   - **HO Approvals Form Section**:
     - Pre-fill `approve_ho_amount` with `zo_fr_amount`.
     - Disable/Clear inputs (`approve_ho_amount`, `transfer_from_account`) if HO selects the `Hold` action type.
     - Validate that `approve_ho_amount <= remainingCapacity` before enabling approval submission.

#### [MODIFY] [FundRequestTable.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/components/fundRequests/FundRequestTable.jsx)

- Add a **Work Order No** column next to the Fund Request No column to improve visibility of mapped projects in the dashboard.
- Display `req.work_order_no || '—'` in each table row.

---

## Verification Plan

### Automated Tests

- Verify that the operational test suite (`backend/tests/vitest/milestones/milestone_p7_m6.test.js`) still passes:
  ```bash
  npx vitest run tests/vitest/milestones/milestone_p7_m6.test.js
  ```
- Run UAT API tests:
  ```bash
  node tests/milestones/test_milestone_p7_api.js
  ```

### Manual Verification
1. Log in as a Zonal Officer. Click **New Request**.
   - Verify that only your mapped Work Orders with status `Running` or `Complete Under Maintenance` appear in the dropdown.
   - Verify that selecting a Work Order displays its correct Work Order Value, Total HO-Approved Amount, and Remaining WO Funding Capacity.
   - Try requesting an amount greater than the remaining capacity. Verify that submission is blocked by frontend validation.
2. Log in as an HO User. Open the pending Fund Request.
   - Verify that Zonal Office, Request No, Work Order, Requested Amount, Work Order Value, Remaining Capacity, and Current Global ZO Available Balance are displayed.
   - Select **Hold**. Verify that amount and transfer account fields are disabled, and saving leaves Zonal Balance and ledgers unchanged.
   - Select **Approve**. Enter an approved amount exceeding the remaining capacity. Verify that saving is blocked.
   - Approve with a valid amount. Verify that the ZO's Global Available Balance increases by the approved amount, and one `ALLOCATION` ledger entry is logged with the correct Work Order association.
