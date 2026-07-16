# Phase 4: Updated Payment Requisition Management Flow — Implementation Plan

> **Status:** Draft — Pending approval.
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Builds on:** Phase 1 (auth, sessions) + Phase 2 (estimates) + Phase 3 (fund requests)
> **Reference:** Phase 4 — Updated Payment Requisition Management Flow Spec

---

## Background & Scope

The updated Phase 4 flow implements a rigorous payment requisition control system. Instead of checking requisition budgets against a project's global estimate amount, the system enforces limits **per Material Main Head** within a project's `Final Approved` cost estimate. 

Only payment requisitions that are actually **Approved** by the Zonal Office (ZO) consume this capacity. Requisitions in **Pending** or **Hold** states do not lock or consume main head capacity.

Furthermore, ZO approvals are subject to two strict checks inside an atomic database transaction:
1. **Zonal Balance Check:** Approved amount must not exceed the Zonal Office's current global available balance.
2. **Main Head Capacity Check:** Approved amount must not exceed the remaining capacity of that specific Material Main Head in the project's cost estimate.

### What the Updated Phase 4 delivers

| Actor | Action |
|---|---|
| **JE (Requester)** | Selects from active mapped work orders. Selects a Material Main Head and sees its Estimated Amount, Cumulative Approved, and Remaining Capacity. Submits a unique Requisition No., uploads a matching PDF, and requests an amount $\le$ Remaining Main Head Capacity. |
| **ZO (Approver)** | Reviews requisitions for their zone. Approves (specifying an approved amount $\le$ both Zonal Balance and Remaining Main Head Capacity) or Holds. Stamps approver ID and payment date. |
| **System** | Atomically deduces Zonal Balance, creates a `REQUISITION_APPROVAL` ledger entry, updates the requisition status, and maintains transactional constraints to prevent double-spending or exceeding main head limits. |

### What this does NOT change
- The daily work progress module (Phase 5) is independent.
- The estimates review flow (Phase 2) is unchanged.
- The fund requests module (Phase 3) is independent.

---

## Role Architecture

| Role | Phase 4 Responsibility |
|---|---|
| `je` | **Creates** payment requisitions. Views own records. |
| `zo` | **Approves or Holds** pending requisitions matching their zone. |
| `ho` | Read-only visibility. No actions. |
| `admin` | Read-only operational oversight. |

---

## Resolved Design Questions

> [!NOTE]
> **Q1 — How is Remaining Main Head Capacity calculated?**
> **Resolution:** 
> $$\text{Remaining Main Head Capacity} = \text{Main Head Cost Estimate Amount} - \text{Cumulative ZO-Approved Amount}$$
> Cumulative ZO-Approved amount is the sum of `approved_amount` from all rows in `requisitions` where `work_order_no = X`, `material_main_head = Y`, and `requisition_status = 'Approved'`.
>
> **Q2 — What happens when a ZO puts a requisition on "Hold"?**
> **Resolution:** The requisition status updates to `Hold`. No fund deduction occurs, no ledger entry is created, and no capacity is consumed.
>
> **Q3 — How is Zonal Office ownership frozen?**
> **Resolution:** When the JE creates a requisition, their active Zonal Office user is resolved from `je_zo_mappings` and stored in `requisitions.zo_user_id`. This freezes the requisition's zonal assignment historically.
>
> **Q4 — How is concurrency handled?**
> **Resolution:** Row-level locks (`SELECT ... FOR UPDATE`) are acquired on `projects_master`, `zo_balances`, and the `requisitions` row in Postgres RPCs to serialize concurrent insertions and approvals.

---

## Proposed Changes

### Component 1 — Database Migration

#### [MODIFY] [create_requisition_secure SQL function](file:///Users/aswint/Documents/GitHub/SNPolymers/supabase/migrations/20260709000000_fix_requisition_budget_calc.sql)

Modify the secure requisition insertion RPC to calculate and validate remaining budget per Material Main Head instead of globally:
1. Locate the active `Final Approved` cost estimate for the work order.
2. Sum the item amounts for the selected `material_main_head` to find the total main head estimate budget.
3. Sum the `approved_amount` of already approved requisitions for this work order and main head.
4. Calculate the remaining capacity:
   $$\text{Remaining} = \text{Main Head Estimate Amount} - \text{Cumulative Approved Amount}$$
5. Enforce that `p_requisition_amount <= Remaining`.

```sql
CREATE OR REPLACE FUNCTION public.create_requisition_secure(
    p_requester_user_id character varying,
    p_work_order_no character varying,
    p_estimate_no character varying,
    p_estimate_amount numeric,
    p_state character varying,
    p_district character varying,
    p_area_code character varying,
    p_department character varying,
    p_site_details text,
    p_requisition_no character varying,
    p_material_main_head character varying,
    p_requisition_pdf_url text,
    p_original_filename character varying,
    p_requisition_amount numeric,
    p_gst_bill public.gst_bill_enum,
    p_gst_bill_pdf_url text,
    p_bank_details text,
    p_expen_head_remarks text,
    p_requisition_status public.requisition_status_enum,
    p_created_by character varying
) RETURNS public.requisitions
    LANGUAGE plpgsql
    SECURITY DEFINER
AS $$
DECLARE
    v_project_status public.project_status;
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
    v_inserted public.requisitions;
BEGIN
    -- 1. Lock the corresponding project row for update to serialize concurrent requisition insertions
    SELECT status INTO v_project_status
    FROM public.projects_master
    WHERE work_order_no = p_work_order_no
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % not found.', p_work_order_no USING ERRCODE = 'P0002';
    END IF;

    -- 2. Verify project is not closed
    IF v_project_status = 'Closed'::public.project_status THEN
        RAISE EXCEPTION 'Cannot create requisitions for projects with "Closed" status.' USING ERRCODE = 'PR001';
    END IF;

    -- 3. Re-verify uniqueness of requisition_no
    IF EXISTS (
        SELECT 1 FROM public.requisitions WHERE requisition_no = p_requisition_no
    ) THEN
        RAISE EXCEPTION 'A requisition with number % already exists.', p_requisition_no USING ERRCODE = '23505';
    END IF;

    -- 4. Find the estimate ID of the latest Final Approved cost estimate
    SELECT estimate_id INTO v_estimate_id
    FROM public.project_cost_estimates
    WHERE work_order_no = p_work_order_no
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for Work Order %.', p_work_order_no USING ERRCODE = 'EST01';
    END IF;

    -- 5. Calculate Main Head Cost Estimate Amount
    SELECT COALESCE(SUM(amount), 0.00) INTO v_main_head_estimate
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_estimate_id
      AND material_main_head = p_material_main_head;

    -- 6. Sum Cumulative ZO-Approved Requisitions for this main head
    SELECT COALESCE(SUM(approved_amount), 0.00) INTO v_cumulative_approved
    FROM public.requisitions
    WHERE work_order_no = p_work_order_no
      AND material_main_head = p_material_main_head
      AND requisition_status = 'Approved'::public.requisition_status_enum;

    -- 7. Validate budget capacity
    v_remaining_capacity := v_main_head_estimate - v_cumulative_approved;
    IF p_requisition_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Requisition amount exceeds the remaining Main Head capacity (Capacity: %, Requested: %).', 
            v_remaining_capacity, p_requisition_amount
            USING ERRCODE = 'BUD01';
    END IF;

    -- 8. Insert the requisition
    INSERT INTO public.requisitions (
        requester_user_id,
        work_order_no,
        estimate_no,
        estimate_amount,
        state,
        district,
        area_code,
        department,
        site_details,
        requisition_no,
        material_main_head,
        requisition_pdf_url,
        original_filename,
        requisition_amount,
        gst_bill,
        gst_bill_pdf_url,
        bank_details,
        expen_head_remarks,
        requisition_status,
        created_by
    ) VALUES (
        p_requester_user_id,
        p_work_order_no,
        p_estimate_no,
        p_estimate_amount,
        p_state,
        p_district,
        p_area_code,
        p_department,
        p_site_details,
        p_requisition_no,
        p_material_main_head,
        p_requisition_pdf_url,
        p_original_filename,
        p_requisition_amount,
        p_gst_bill,
        p_gst_bill_pdf_url,
        p_bank_details,
        p_expen_head_remarks,
        p_requisition_status,
        p_created_by
    ) RETURNING * INTO v_inserted;

    RETURN v_inserted;
END;
$$;
```

#### [MODIFY] [approve_requisition_transact SQL function](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/db/migrations/29_operational_integration_rpcs.sql)

Modify the atomic requisition approval function to enforce:
1. Re-verification of remaining capacity:
   - Identify the estimate and sum the item amounts for the main head.
   - Sum cumulative previous approved amounts (excluding the current requisition being approved).
   - Ensure `p_approved_amount <= Remaining Main Head Capacity`.
2. Zonal Available Balance validation:
   - Lock `zo_balances` using `SELECT ... FOR UPDATE`.
   - Ensure Zonal balance $\ge$ `p_approved_amount`.

```sql
CREATE OR REPLACE FUNCTION public.approve_requisition_transact(
    p_requisition_id UUID,
    p_approved_amount NUMERIC,
    p_actioned_by VARCHAR,
    p_remarks_approved_authority TEXT
)
RETURNS public.requisitions
    LANGUAGE plpgsql
    SECURITY DEFINER
AS $$
DECLARE
    v_req public.requisitions;
    v_balance NUMERIC(18,2);
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
BEGIN
    -- 1. Lock and fetch Requisition Row
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.requisition_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Requisition status must be Pending or Hold.' USING ERRCODE = 'STA01';
    END IF;

    -- 2. Find estimate ID of the latest Final Approved cost estimate
    SELECT estimate_id INTO v_estimate_id
    FROM public.project_cost_estimates
    WHERE work_order_no = v_req.work_order_no
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
    END IF;

    -- 3. Calculate Main Head Cost Estimate Amount
    SELECT COALESCE(SUM(amount), 0.00) INTO v_main_head_estimate
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_estimate_id
      AND material_main_head = v_req.material_main_head;

    -- 4. Calculate cumulative approved amount (excluding current requisition)
    SELECT COALESCE(SUM(approved_amount), 0.00) INTO v_cumulative_approved
    FROM public.requisitions
    WHERE work_order_no = v_req.work_order_no
      AND material_main_head = v_req.material_main_head
      AND requisition_status = 'Approved'::public.requisition_status_enum
      AND requisition_id <> p_requisition_id;

    -- 5. Validate against Main Head Capacity
    v_remaining_capacity := v_main_head_estimate - v_cumulative_approved;
    IF p_approved_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Approved amount exceeds the remaining Main Head capacity (Capacity: %, Attempted: %).',
            v_remaining_capacity, p_approved_amount
            USING ERRCODE = 'BUD02';
    END IF;

    -- 6. Lock and check ZO Balance row
    SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_req.zo_user_id FOR UPDATE;
    IF NOT FOUND OR v_balance < p_approved_amount THEN
        RAISE EXCEPTION 'Insufficient available Zonal Office balance.' USING ERRCODE = 'BAL01';
    END IF;

    -- 7. Deduct ZO balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance - p_approved_amount, updated_at = now()
    WHERE zo_user_id = v_req.zo_user_id;

    -- 8. Insert ledger entry (negative debit)
    INSERT INTO public.zo_fund_ledger (
        zo_user_id,
        transaction_type,
        reference_type,
        reference_id,
        amount,
        work_order_no,
        created_by
    ) VALUES (
        v_req.zo_user_id,
        'REQUISITION_APPROVAL',
        'REQUISITION',
        p_requisition_id,
        -p_approved_amount,
        v_req.work_order_no,
        p_actioned_by
    );

    -- 9. Update Requisition
    UPDATE public.requisitions
    SET
        requisition_status = 'Approved',
        approve_type = 'Approve',
        approved_amount = p_approved_amount,
        approved_balance_amount = requisition_amount - p_approved_amount,
        approved_user_id = p_actioned_by,
        payment_date = now(),
        remarks_approved_authority = p_remarks_approved_authority,
        updated_at = now()
    WHERE requisition_id = p_requisition_id
    RETURNING * INTO v_req;

    RETURN v_req;
END;
$$;
```

---

### Component 2 — Backend Controllers & Validation

#### [MODIFY] [requisitions.controller.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/controllers/requisitions.controller.js)

- Update `createRequisition(req, res)`:
  - Query and build descriptive responses specifying Main Head details, Previous Approved, and Remaining Capacity instead of global project remaining balance.
- Add route/helper to fetch live Main Head capacity:
  - Expose a helper method `getMainHeadCapacity(req, res)` that takes `work_order_no` and `material_main_head` to query the remaining capacity for the frontend.

#### [NEW] API Route Endpoint
- Add `GET /api/v1/auth/requisitions/capacity?work_order_no=X&material_main_head=Y` to retrieve:
  - `main_head_estimate_amount`
  - `cumulative_approved_amount`
  - `remaining_capacity`

---

### Component 3 — Frontend Pages

#### [MODIFY] Requisition Form Component
- **Step 5 - Main Head Selection:** When the user selects a Material Main Head, trigger an API call to the new capacity endpoint.
- **Step 6 - Capacity Display:** Dynamically display:
  - *Main Head Estimated Amount*
  - *Total ZO-Approved Amount*
  - *Remaining Main Head Capacity*
- **Step 8 - Amount Validation:** Validate that the requested Requisition Amount is $\le$ the returned Remaining Main Head Capacity. If not, block form submission and display a styled error alert.

#### [MODIFY] ZO Review / Approve Modal
- **Decision Validation:** When approving, validate that `Approved Amount <= Remaining Main Head Capacity` and `Approved Amount <= Global ZO Balance`.

---

## Verification Plan

### Automated Tests
- Create `/Users/aswint/Documents/GitHub/SNPolymers/backend/tests/vitest/milestones/payment_requisition_capacity.test.js` to assert:
  1. Creating a requisition exceeding Main Head Capacity fails with `422`.
  2. Creating a requisition within Main Head Capacity succeeds.
  3. Approving a requisition exceeding Remaining Main Head Capacity fails.
  4. Approving a requisition exceeding Zonal Balance fails.
  5. Multi-user concurrent creations are serialized and correctly bounded.

### Manual Verification
1. Log in as a JE and select a project and a main head. Check if the remaining capacity displays correctly.
2. Attempt to submit a request exceeding the remaining capacity; verify it is blocked.
3. Log in as a ZO and attempt to approve a requisition with an amount greater than the main head capacity; check for rollback and failure message.
