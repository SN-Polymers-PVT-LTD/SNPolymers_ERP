# ZO Fund Request & HO Approval Process — Milestone-Driven Execution Plan

> **Status:** Approved & Frozen. This document details the sequential, dependency-ordered execution plan for implementing the ZO Fund Request and HO Approval process flow.
>
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Assumed existing:** Phase 1 (auth, fund reports) + Phase 2 (estimates) + Phase 3 (fund requests) + Phase 4 (requisitions) + Phase 7 (zonal office mappings & ledgers)
> **Process flow source:** Approved ZO Fund Request & HO Approval Complete Process Flow

---

## Role Authorization Matrix

| Action / Module | Admin | HO (Head Office) | ZO (Zonal Office) | JE (Junior Engineer) |
|---|---|---|---|---|
| **Fund Request Dropdown** | View All Projects | View All Projects | Filtered: Mapped WOs & Status Active/Maintenance | No Access |
| **Fund Request Creation** | Create on behalf of any ZO | Create on behalf of any ZO | Create Own (Must be owned WO & within Remaining capacity) | No Access |
| **Act on Request (Approve/Hold)** | Full Access | Full Access | No Access | No Access |
| **Global ZO Balance Credit** | Triggered on HO approval | Triggered on HO approval | Read Own Balance | No Access |
| **ALLOCATION Ledger Entry** | Read All | Read All | Read Own | No Access |

---

## Known Design Decisions & Constraints

1. **Current Work Order Owner**: Mapped via `projects_master.zo_user_id = authorised_users.mobile_number`.
2. **Transfer Association**: Transferring a Work Order from `ZO-A` to `ZO-B` does not reset its cumulative approved amount. Existing Fund Requests, approvals, and ledger logs stay frozen and historically associated with `ZO-A`. Only new Fund Requests are raised by `ZO-B` under the remaining capacity.
3. **Status Allowlist**: The backend controller and database triggers must use `status IN ('Running', 'Complete Under Maintenance')`. WOs with status `Closed` are blocked.
4. **Hold Action**: Marking a request as `Hold` must update the status but perform NO database balance updates and write NO ledger entries.
5. **Transactional Ceiling Safety**: Remaining WO Funding Capacity is calculated dynamically as:
   `Remaining capacity = Cost Estimate Amount - Cumulative HO-Approved Fund Amount`
   Calculations are verified both during creation (ZO) and at the transaction commit moment (HO) using row-level locking (`SELECT FOR UPDATE`).

---

## Milestone Overview

| # | Milestone | Primary Layer | Depends On |
|---|---|---|---|
| M1 | Database Transaction Migration | Database (Supabase) | Migration 29 Applied |
| M2 | Backend API Logic Refactoring | Backend API | M1 |
| M3 | Frontend Form Refactoring | Frontend UI | M2 |
| M4 | Integration & Acceptance Testing | QA / Testing | M3 |

---

## M1 — Database Transaction Migration

### Objective
Deploy the updated PL/pgSQL database function migration `30_update_approve_fund_request_rpc.sql` to enforce transaction-safe approvals, row-level locking, remaining capacity calculation, and duplicate ledger posting checks.

### Files Created or Modified
* `backend/src/db/migrations/30_update_approve_fund_request_rpc.sql` **[NEW]**

### Database Work
```sql
-- Migration 30: ZO Fund Request & HO Approval — Atomic Transactions & Validations
-- DB: PostgreSQL (Supabase)

DROP FUNCTION IF EXISTS public.approve_fund_request_transact(UUID, NUMERIC, VARCHAR, VARCHAR, TEXT);

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

GRANT EXECUTE ON FUNCTION public.approve_fund_request_transact TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_fund_request_transact TO service_role;
```

### Test Cases

| ID | Test | Input | Expected Result | Layer |
|---|---|---|---|---|
| M1-TC-01 | Recompile RPC | Apply migration | Function compiles successfully without syntax errors | DB |
| M1-TC-02 | Locked balance increment | Call RPC for pending request | `zo_balances.available_balance` increases correctly | DB |
| M1-TC-03 | Duplicate ledger protection | Call RPC on request already approved | Exception raised: Duplicate posting check failed | DB |
| M1-TC-04 | Exceed WO limit protection | Call RPC with amount > WO limit | Exception raised: Approved amount exceeds remaining WO capacity | DB |
| M1-TC-05 | Missing transfer account protection | Call RPC with empty transfer account | Exception raised: Transfer account is required for approval | DB |

### Acceptance Criteria
- [ ] Database function `approve_fund_request_transact` successfully compiles.
- [ ] Zonal balance update, ledger insert, and status change run inside an atomic block.
- [ ] Database-level unique constraint on `zo_fund_ledger (reference_type, reference_id)` remains active.

---

## M2 — Backend API Logic Refactoring

### Objective
Update backend validation and controllers to recalculate remaining capacity and validate requested and approved amounts against it.

### Files Created or Modified
* `backend/src/controllers/fundRequests.controller.js` **[MODIFY]**

### Backend Work

#### `createFundRequest` updates
* Fetch the project details: `work_order_value`, `status`, and `zo_user_id` by joining/querying `projects_master`.
* Validate that project status is `Running` or `Complete Under Maintenance`. Reject with `400` if not.
* Query the database to calculate remaining capacity for this Work Order:
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
* Reject with `400` if the request amount is greater than `remainingCapacity`.

#### `actOnFundRequest` updates
* When `action === 'Approve'`:
  - Query approved requests to calculate remaining capacity.
  - Reject with `400` if the approved amount exceeds `remainingCapacity`.
  - Reject with `400` if `approve_ho_amount > fr.zo_fr_amount`.
  - Ensure `transfer_from_account` is provided and is one of `CC`, `OD`, or `CR`.
* When `action === 'Hold'`:
  - Set status to `Hold`, and do not call the database transaction RPC.

### Test Cases

| ID | Test | Input | Expected Result | Layer |
|---|---|---|---|---|
| M2-TC-01 | Closed project creation block | POST request with `status = 'Closed'` project | `400` bad request: Work Order must be Active or Under Maintenance | API |
| M2-TC-02 | Exceed remaining capacity block | POST request with amount > remaining capacity | `400` bad request: Requested amount cannot exceed remaining capacity | API |
| M2-TC-03 | Approval exceeding capacity block | PATCH request with approved amount > remaining capacity | `400` bad request: Approved amount exceeds remaining capacity | API |
| M2-TC-04 | Hold request bypasses financial update | PATCH action = 'Hold' | Status = 'Hold', no ledger or balance entry | API |

### Acceptance Criteria
- [ ] Creation API rejects inactive project assignments.
- [ ] Creation API enforces remaining capacity check.
- [ ] Approval API enforces remaining capacity check.

---

## M3 — Frontend Form Refactoring

### Objective
Modify frontend components to render dropdowns, display cost details, and validate inputs.

### Files Created or Modified
* `frontend/src/components/fundRequests/RequestDetailPanel.jsx` **[MODIFY]**
* `frontend/src/components/fundRequests/FundRequestTable.jsx` **[MODIFY]**

### Frontend Work

#### Creation form (`RequestDetailPanel.jsx`)
* Load projects using `getProjects()` from `projectsApi.js`.
* Filter locally to show only projects owned by the logged-in ZO and having `status === 'Running' || status === 'Complete Under Maintenance'`.
* Fetch and calculate the remaining capacity of the selected project in a `useEffect`.
* Render a select element for Work Orders.
* Display the selected Work Order Value, Cumulative HO-Approved amount, and Remaining Capacity below the dropdown.
* Add form validations to block request inputs greater than the remaining capacity.

#### Detail/Review form (`RequestDetailPanel.jsx`)
* Display all required details:
  - Zonal Office Name/Mobile
  - Fund Request Number
  - Work Order Number
  - Requested Amount
  - ZO Remarks
  - Cost Estimate Amount (Work Order Value)
  - Cumulative HO-Approved Amount
  - Remaining WO Funding Capacity
  - Current Global ZO Available Balance (from `getZonalBalances()`)
* For HO Action selections:
  - Clear and hide fields if "Hold" is selected.
  - Require transfer account and enforce approved amount is `<= remainingCapacity` if "Approve" is selected.

#### Table display (`FundRequestTable.jsx`)
* Add a column for **Work Order No**.
* Render `req.work_order_no || '—'`.

### Test Cases

| ID | Test | Input | Expected Result | Layer |
|---|---|---|---|---|
| M3-TC-01 | Dropdown project filtering | Open request form as ZO | Only mapped Running / Complete Under Maintenance projects appear | UI |
| M3-TC-02 | Remaining capacity display | Select project in creation form | Shows correct value, cumulative approved, and remaining capacity | UI |
| M3-TC-03 | Frontend amount limit check | Enter request amount > remaining capacity | Submit is blocked, validation message shown | UI |
| M3-TC-04 | HO Detail view fields | Open details page as HO | Cost estimate, cumulative approved, remaining capacity, and ZO balance shown | UI |
| M3-TC-05 | Table layout updates | View dashboard lists | "Work Order No" column matches table list rows | UI |

### Acceptance Criteria
- [ ] Work Order selection uses a dropdown containing filtered active/under maintenance projects.
- [ ] User details page displays ZO balance and project value constraints.
- [ ] Table columns reflect Work Order mappings.

---

## M4 — Integration & Acceptance Testing

### Objective
Verify that all updated components and APIs work cohesively and pass automated integration checks.

### Tasks
1. Run automated vitest tests:
   ```bash
   npx vitest run tests/vitest/milestones/milestone_p7_m6.test.js
   ```
2. Verify UAT API flows:
   ```bash
   node tests/milestones/test_milestone_p7_api.js
   ```
3. Manually test the complete workflow end-to-end to ensure that:
   - ZO can create requests within remaining capacity.
   - ZO cannot create requests exceeding remaining capacity.
   - HO can place requests on Hold (no balance change).
   - HO can approve requests (credits Global Balance, writes allocation ledger, respects WO capacity).
   - Capacity persists across WO ownership transfers.

### Acceptance Criteria
- [ ] All automated tests in `milestone_p7_m6.test.js` pass.
- [ ] API tests in `test_milestone_p7_api.js` pass.
- [ ] UI manual flows completed and confirmed correct.
