# Phase 7: Zonal Office Restructuring & Mapping Modules — Implementation Plan

> **Status:** Draft — Pending Final Verification & Code Execution Approval
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Builds on:** Phase 1 (auth, sessions) + Phase 2 (projects_master, estimates) + Phase 3 (fund requests) + Phase 4 (requisitions) + Phase 5 (daily progress reports)
> **Reference:** Modifications.pdf + Phase 7 Design Decisions

---

## Background & Scope

Phase 7 introduces a major administrative and architectural restructuring to enforce strict security boundaries, hierarchical accountability, and detailed fund tracking across S.N. Polymers' active operations. This phase transitions the application from a flat permission hierarchy to a role-isolated zonal architecture.

### What Phase 7 introduces:
1. **Zonal Office (ZO) Isolation:** ZO users are restricted to viewing, creating, and modifying data associated only with Junior Engineers (JEs) and Work Orders mapped to their specific Zonal Office.
2. **User Mapping Module:** A master management system defining active JE-to-ZO relationships, including historical tracking of transfers.
3. **Work Order Mapping Module:** A system mapping Work Orders explicitly to an owning ZO and assigning them to one or more JEs, ensuring all JEs assigned to a project belong to that Work Order's Zonal Office.
4. **Global Zonal Fund Ledger & Balance:** A persistent transaction ledger (`zo_fund_ledger`) and balance tracker (`zo_balances`) with transactional locking to track ZO credit and prevent double-spending.
5. **Excess Fund Returns:** A formal return request-and-acceptance workflow allowing HO to reclaim unused funds from ZOs.

### Existing modules affected:
* **Authentication & Whitelist:** Mappings enforce role consistency at whitelist level.
* **Payment Requisitions (Phase 4):** Requisitions freeze Zonal ownership at creation; ZOs only see and approve requisitions for their mapped JEs.
* **Daily Work Progress (Phase 5):** Daily progress reports are isolated; ZOs can only view/evaluate progress reports of JEs mapped to them.
* **Cost Estimates (Phase 2):** Estimates are filtered; ZOs only see estimates for JEs mapped under them.
* **Fund Requests (Phase 3):** ZO-to-HO fund requests are extended to require a Work Order, and their approval directly feeds the ZO available balance.
* **RA & Final Bills (Phase 4):** Bills creation and viewing are restricted to mapped Work Orders only.
* **Fund Reports & Analytics:** Dashboards and exports restrict view based on active mappings.

---

## Business Rules

### BR-01: Active JE-to-ZO Mapping
* A Junior Engineer (JE) can be mapped to exactly one active Zonal Office (ZO) user at a time.
* Mappings are temporal: deactivating a mapping records an end date/time, and a history of all assignments must be kept for auditing.

### BR-02: Work Order Ownership and Assignments
* Every Work Order in the system is explicitly owned by a single Zonal Office, stored as `zo_user_id` directly in the `projects_master` table.
* A Work Order can be assigned to one or more JEs via `work_order_mappings`.
* **Zonal Consistency Constraint:** Every assigned JE must belong to the Work Order's owning ZO. The system must reject the assignment of any JE whose active ZO (from `je_zo_mappings`) differs from the Work Order's `zo_user_id` in `projects_master`.
* Mappings store a `reason` code: `('Assigned', 'Transferred', 'Removed', 'Project Closed')` for audit.

### BR-03: JE Transfer Restraints and Deactivations
* A JE cannot be transferred to a new Zonal Office if they have any Payment Requisition in a `'Pending'` or `'Hold'` status. This validation runs in the service layer's transfer transaction.
* **Work Order De-allocation Rule:** A JE transfer does not automatically transfer Work Order ownership. During a JE transfer, any active `work_order_mappings` for that JE on Work Orders belonging to their *old* ZO are automatically deactivated with `reason = 'Transferred'`. The administrator or HO must explicitly assign a new JE under the old ZO to those Work Orders, or change the Work Order's owning ZO.

### BR-04: Frozen Zonal Association on Requisitions & Progress
* When a JE creates a Payment Requisition (Phase 4) or submits a Daily Progress Report (Phase 5), the system queries the JE's active User Mapping and writes the active `zo_user_id` onto the record.
* This relationship is frozen at the moment of creation and remains unchanged even if the JE is subsequently transferred.

### BR-05: Zonal Office Fund Balance Controls
* Each ZO has a single global persistent balance in `zo_balances`.
* To prevent manual drift, the system automatically initializes a `zo_balances` record with `0.00` balance whenever a new user with `role = 'zo'` is added to `authorised_users` (via database trigger).
* The balance is updated strictly via ledger postings in `zo_fund_ledger`:
  * **Increase (+):** HO approvals of ZO Fund Requests.
  * **Decrease (-):** ZO approvals of JE Payment Requisitions.
  * **Decrease (-):** Completed returns of excess funds to HO.
* **Available Balance Guard:** A ZO cannot approve a Payment Requisition if the approved amount exceeds their available balance. The check and update must execute inside a database transaction using row-level locking.

### BR-06: Excess Fund Returns & Concurrency
* HO can request returns of excess funds.
* ZO has three choices:
  1. **Accept:** Validates available balance. If sufficient, deducts the amount, posts to the ledger, and marks as `Completed`.
  2. **Request Modification:** Remarks are mandatory. The request moves to `Awaiting HO Review`.
  3. **Reject:** Permitted for genuine disputes. Remarks are mandatory. Status moves to `Rejected`.
* **Stale Acceptance Guard:** The ZO's acceptance request must send the return request's latest `updated_at` timestamp. The API performs an optimistic concurrency check: if the timestamp in the database differs from the sent value, the transaction is rejected with a 409 Conflict error.

---

## Role Architecture

| Action | Admin | HO | ZO | JE | Staff |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **User Mappings** | View/Create/Edit/Delete | View/Create/Edit | View (Own ZO only) | View (Own mapping only) | No Access |
| **Work Order Mappings** | View/Create/Edit/Delete | View/Create/Edit | View (Own ZO only) | View (Own WO only) | No Access |
| **Zonal Balances** | View & Reconcile | View All | View Own | No Access | No Access |
| **Requisitions** | View All | View All | View & Approve (Mapped JEs only) | Create (Mapped WOs only) | No Access |
| **Daily Progress** | View All | View All | View & Remark (Mapped JEs only) | Create (Mapped WOs only) | No Access |
| **Estimates** | View All | View All | View (Mapped JEs only) | Create/Edit (Own only) | No Access |
| **RA & Final Bills** | View All | View All | Create (Mapped WOs only) | No Access | No Access |
| **Excess Fund Returns** | View All | Create / Manage | Accept / Modify / Reject | No Access | No Access |

---

## Resolved Design Decisions

1. **Explicit WO Zonal Ownership:** Work Orders (`projects_master`) store the owning `zo_user_id` directly, making validation of JEs simple (`JE.active_zo == WO.zo_user_id`).
2. **Auto-initialized Balances:** Triggers automatically create zero-balance profiles for newly inserted ZO users.
3. **Ledger Type Validation:** `zo_fund_ledger` has a `reference_type` column (`'FUND_REQUEST'`, `'REQUISITION'`, `'RETURN'`) and a unique index on `(reference_type, reference_id)` to physically prevent duplicate postings.
4. **Service-Layer Transfer Logic:** Pending requisition validation and Work Order assignment deactivations are handled transactionally in the backend controller rather than database triggers.
5. **Stale Acceptance Concurrency Guard:** Return acceptances require the latest `updated_at` timestamp to prevent applying transactions to modified requests.

---

## Proposed Changes

### Component 1 — Database Migration

#### [NEW] `supabase/migrations/20260714000000_zonal_office_mapping_and_ledger.sql`

```sql
-- ===========================================================================
-- Migration: Phase 7 — Zonal Office Mapping, Ledgers, and Returns
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Table: je_zo_mappings (User Mapping Module)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.je_zo_mappings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    je_user_id     VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    zo_user_id     VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    is_active      BOOLEAN DEFAULT true NOT NULL,
    assigned_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
    assigned_by    VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    deactivated_at TIMESTAMPTZ,
    deactivated_by VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT
);

ALTER TABLE public.je_zo_mappings OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS idx_je_zo_mappings_active_unique 
    ON public.je_zo_mappings (je_user_id) 
    WHERE (is_active = true);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Table: zo_balances (Available Balances)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zo_balances (
    zo_user_id        VARCHAR PRIMARY KEY REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    available_balance NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
    updated_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_zo_balance_positive CHECK (available_balance >= 0.00)
);

ALTER TABLE public.zo_balances OWNER TO postgres;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Schema Alteration: Add zo_user_id to projects_master
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.projects_master 
ADD COLUMN IF NOT EXISTS zo_user_id VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Table: work_order_mappings (Work Order Mapping Module)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_order_mappings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_no  VARCHAR NOT NULL REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    je_user_id     VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    is_active      BOOLEAN DEFAULT true NOT NULL,
    reason         VARCHAR NOT NULL CHECK (reason IN ('Assigned', 'Transferred', 'Removed', 'Project Closed')),
    assigned_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
    assigned_by    VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    deactivated_at TIMESTAMPTZ,
    deactivated_by VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT
);

ALTER TABLE public.work_order_mappings OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_mappings_active_unique
    ON public.work_order_mappings (work_order_no, je_user_id)
    WHERE (is_active = true);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Table: zo_fund_ledger (Transaction Log)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zo_fund_ledger (
    ledger_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zo_user_id       VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    transaction_type VARCHAR NOT NULL CHECK (transaction_type IN ('ALLOCATION', 'REQUISITION_APPROVAL', 'RETURN', 'TRANSFER')),
    reference_type   VARCHAR NOT NULL CHECK (reference_type IN ('FUND_REQUEST', 'REQUISITION', 'RETURN')),
    reference_id     UUID NOT NULL, 
    amount           NUMERIC(18,2) NOT NULL,
    work_order_no    VARCHAR REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
    created_by       VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT
);

ALTER TABLE public.zo_fund_ledger OWNER TO postgres;

-- Guard against double-credits/double-spending by enforcing unique transaction keys
CREATE UNIQUE INDEX IF NOT EXISTS idx_zo_fund_ledger_ref_unique 
    ON public.zo_fund_ledger (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_zo_fund_ledger_zo ON public.zo_fund_ledger(zo_user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Table: excess_fund_returns (Returns Module)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.excess_fund_returns (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zo_user_id       VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    work_order_no    VARCHAR NOT NULL REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    requested_amount NUMERIC(18,2) NOT NULL CHECK (requested_amount > 0.00),
    status           VARCHAR NOT NULL CHECK (status IN ('Requested', 'Completed', 'Awaiting HO Review', 'Rejected', 'Cancelled')),
    remarks_ho       TEXT,
    remarks_zo       TEXT,
    requested_by     VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    actioned_by      VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at       TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.excess_fund_returns OWNER TO postgres;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Schema Alterations for Existing Tables
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS zo_user_id VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT;
ALTER TABLE public.daily_progress_reports ADD COLUMN IF NOT EXISTS zo_user_id VARCHAR REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT;
ALTER TABLE public.fund_requests ADD COLUMN IF NOT EXISTS work_order_no VARCHAR REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Database Triggers & Functions
-- ────────────────────────────────────────────────────────────────────────────

-- A. Validate Roles before inserting into je_zo_mappings
CREATE OR REPLACE FUNCTION public.fn_validate_je_zo_mapping_roles()
RETURNS TRIGGER AS $$
DECLARE
    v_je_role VARCHAR;
    v_zo_role VARCHAR;
END;
$$;
-- (Database trigger code details omitted for brevity, checks authorised_users roles match targets)

-- B. Auto-Initialize Balance on ZO Creation
CREATE OR REPLACE FUNCTION public.fn_init_zo_balance_on_user_creation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role = 'zo' THEN
        INSERT INTO public.zo_balances (zo_user_id, available_balance)
        VALUES (NEW.mobile_number, 0.00)
        ON CONFLICT (zo_user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_init_zo_balance_on_user_creation
    AFTER INSERT OR UPDATE OF role ON public.authorised_users
    FOR EACH ROW EXECUTE FUNCTION public.fn_init_zo_balance_on_user_creation();

-- C. Validate Work Order Mapping: Zonal Consistency Trigger
CREATE OR REPLACE FUNCTION public.fn_validate_work_order_mapping_zonal_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_je_zo   VARCHAR;
    v_wo_zo   VARCHAR;
BEGIN
    -- 1. Get the ZO of the JE being assigned
    SELECT zo_user_id INTO v_je_zo 
      FROM public.je_zo_mappings 
     WHERE je_user_id = NEW.je_user_id AND is_active = true;

    IF v_je_zo IS NULL THEN
        RAISE EXCEPTION 'Junior Engineer % is not assigned to any active Zonal Office.', NEW.je_user_id;
    END IF;

    -- 2. Get the ZO of the Work Order
    SELECT zo_user_id INTO v_wo_zo
      FROM public.projects_master
     WHERE work_order_no = NEW.work_order_no;

    IF v_wo_zo IS NULL THEN
        RAISE EXCEPTION 'Work Order % has no assigned owning Zonal Office.', NEW.work_order_no;
    END IF;

    -- 3. Block if they differ
    IF v_wo_zo != v_je_zo THEN
        RAISE EXCEPTION 'Mismatched ZO assignment. Junior Engineer belongs to ZO %, but Work Order belongs to ZO %.',
            v_je_zo, v_wo_zo;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_validate_work_order_mapping_zonal_consistency
    BEFORE INSERT OR UPDATE ON public.work_order_mappings
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_work_order_mapping_zonal_consistency();

-- D. Audit Triggers
CREATE OR REPLACE FUNCTION public.fn_audit_zonal_modules()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
        COALESCE(NEW.assigned_by, NEW.requested_by, 'SYSTEM'),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id::VARCHAR, NEW.zo_user_id),
        CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_audit_je_zo_mappings AFTER INSERT OR UPDATE ON public.je_zo_mappings FOR EACH ROW EXECUTE FUNCTION public.fn_audit_zonal_modules();
CREATE OR REPLACE TRIGGER trg_audit_work_order_mappings AFTER INSERT OR UPDATE ON public.work_order_mappings FOR EACH ROW EXECUTE FUNCTION public.fn_audit_zonal_modules();
CREATE OR REPLACE TRIGGER trg_audit_excess_fund_returns AFTER INSERT OR UPDATE ON public.excess_fund_returns FOR EACH ROW EXECUTE FUNCTION public.fn_audit_zonal_modules();
```

---

### Component 2 — Backend

#### 1. Backend Service: User & Work Order Mappings API

##### `POST /api/v1/auth/user-mappings`
* **Access:** `['ho', 'admin']`
* **Validation (Zod):** `{ je_mobile_number, zo_mobile_number }`
* **Business Logic (Transactional Transaction):**
  ```javascript
  1. Verify role definitions in database (je_mobile_number is 'je', zo_mobile_number is 'zo').
  2. Query active mapping:
     SELECT * FROM je_zo_mappings WHERE je_user_id = je_mobile_number AND is_active = true
  3. If active mapping exists:
     a. Service-Layer Guard: Check for pending requisitions.
        SELECT COUNT(*) FROM requisitions WHERE requester_user_id = je_mobile_number AND requisition_status IN ('Pending', 'Hold')
        - If count > 0: Return 400: "Cannot transfer JE. JE has pending requisitions."
     b. Deactivate old mapping:
        UPDATE je_zo_mappings SET is_active = false, deactivated_at = now(), deactivated_by = req.user.mobile_number WHERE je_user_id = je_mobile_number AND is_active = true
     c. Work Order De-allocation: Deactivate all active assignments for this JE on projects belonging to the old ZO.
        UPDATE work_order_mappings 
           SET is_active = false, reason = 'Transferred', deactivated_at = now(), deactivated_by = req.user.mobile_number 
         WHERE je_user_id = je_mobile_number AND is_active = true 
           AND work_order_no IN (SELECT work_order_no FROM projects_master WHERE zo_user_id = old_mapping.zo_user_id)
  4. Insert new active mapping:
     INSERT INTO je_zo_mappings (je_user_id, zo_user_id, is_active, assigned_by) VALUES (je_mobile_number, zo_mobile_number, true, req.user.mobile_number)
  5. Commit transaction.
  ```

---

#### 2. Backend Service: Excess Fund Returns API

##### `PATCH /api/v1/auth/fund-returns/:id/accept`
* **Access:** `['zo']` only
* **Request:** `{ client_updated_at }` (Required for stale check)
* **Business Logic (Atomic Transaction):**
  ```javascript
  1. Retrieve return request using id -> 404 if not found.
  2. Verify return_request.zo_user_id == req.user.mobile_number -> 403 if unauthorized.
  3. Verify return_request.status == 'Requested' -> 400 if state mismatch.
  4. Concurrency Guard: Compare return_request.updated_at.toISOString() with client_updated_at.
     - If different -> return 409 Conflict: "Stale acceptance request. The return request amount or details were updated. Please refresh."
  5. Lock ZO Balance Row:
     SELECT available_balance FROM zo_balances WHERE zo_user_id = return_request.zo_user_id FOR UPDATE
  6. Verify available_balance >= return_request.requested_amount:
     - If false: Return 422: "Insufficient available balance."
  7. Deduct balance:
     UPDATE zo_balances SET available_balance = available_balance - return_request.requested_amount WHERE zo_user_id = return_request.zo_user_id
  8. Write unique ledger entry:
     INSERT INTO zo_fund_ledger (zo_user_id, transaction_type, reference_type, reference_id, amount, work_order_no, created_by)
     VALUES (return_request.zo_user_id, 'RETURN', 'RETURN', return_request.id, -return_request.requested_amount, return_request.work_order_no, req.user.mobile_number)
     - Catch Unique Constraint Violation -> return 409: "Transaction already processed."
  9. Complete return:
     UPDATE excess_fund_returns SET status = 'Completed', actioned_by = req.user.mobile_number, updated_at = now() WHERE id = return_request.id
  10. Commit transaction.
  ```

---

#### 3. Modifications to Existing APIs

##### Requisition Approval Action (`PATCH /api/v1/auth/requisitions/:id/action`)
* **Transaction Updates (on Approve):**
  ```javascript
  1. Verify requisition ownership: req.user.mobile_number == requisition.zo_user_id
  2. Lock ZO Balance:
     SELECT available_balance FROM zo_balances WHERE zo_user_id = requisition.zo_user_id FOR UPDATE
  3. Check available_balance >= approved_amount. If false -> return 422.
  4. Deduct:
     UPDATE zo_balances SET available_balance = available_balance - approved_amount WHERE zo_user_id = requisition.zo_user_id
  5. Write ledger entry (unique constraint blocks duplicates):
     INSERT INTO zo_fund_ledger (zo_user_id, transaction_type, reference_type, reference_id, amount, work_order_no, created_by)
     VALUES (requisition.zo_user_id, 'REQUISITION_APPROVAL', 'REQUISITION', requisition.requisition_id, -approved_amount, requisition.work_order_no, req.user.mobile_number)
  ```

##### Fund Requests Approval (`PATCH /api/v1/auth/fund-requests/:id/action`)
* **Transaction Updates (on Approve):**
  ```javascript
  1. Lock ZO Balance:
     SELECT available_balance FROM zo_balances WHERE zo_user_id = fund_request.zo_user_id FOR UPDATE
  2. Increase:
     UPDATE zo_balances SET available_balance = available_balance + approve_ho_amount WHERE zo_user_id = fund_request.zo_user_id
  3. Write ledger entry:
     INSERT INTO zo_fund_ledger (zo_user_id, transaction_type, reference_type, reference_id, amount, work_order_no, created_by)
     VALUES (fund_request.zo_user_id, 'ALLOCATION', 'FUND_REQUEST', fund_request.fund_request_id, approve_ho_amount, fund_request.work_order_no, req.user.mobile_number)
  ```

---

### Component 3 — Frontend

#### Modified & New Views
1. **User Mappings Panel:** Admin/HO management of JE-to-ZO relations.
2. **Work Order Mappings Panel:** Explicit assignments of Work Orders (with owning ZO shown directly) to JEs. Validation prevents mismatched ZO assignments.
3. **Zonal Balances & Ledger:** Dynamic indicator displaying Zonal credits.
4. **Excess Fund Returns Manager:** Interactive forms for returns. Stale concurrency prevention is handled by reading `updated_at` before sending acceptance.

---

### Component 4 — Security

| # | Concern | Severity | Resolution |
|---|---|---|---|
| SEC-7-1 | **Zonal Balance Double Spending** | **CRITICAL** | Row-level locking (`SELECT ... FOR UPDATE`) in `zo_balances` transaction block. |
| SEC-7-2 | **Duplicate Approval Posting** | **HIGH** | Unique index `idx_zo_fund_ledger_ref_unique` on `zo_fund_ledger(reference_type, reference_id)` physically prevents duplicate balance increments. |
| SEC-7-3 | **Stale Return Acceptance** | **HIGH** | Optimistic concurrency check comparing `updated_at` timestamp on return acceptances. |

---

### Component 5 — Testing & Scheduling

#### Scheduled Tasks
* **Nightly Reconciliation:** A scheduled cron job runs nightly at **2:00 AM** calling the reconciliation function to verify `zo_balances` against `zo_fund_ledger` ledger aggregates.

#### Automated Integration Tests
* **Test Case DB-1:** Map a JE whose ZO differs from the Work Order's ZO. Expected: Trigger exception.
* **Test Case API-1:** Concurrent requisition approvals. Verify: Total deductions never exceed balance, locks enforce serialization.
* **Test Case API-2:** HO updates Return Request amount while ZO is accepting. Verify: ZO gets 409 Conflict.
* **Test Case API-3:** Duplicate approval call on Fund Request. Verify: Second call rejected by Unique Constraint.
* **Test Case API-4:** JE Transfer logic. Verify: Pending requisitions block transfer, and old Work Order assignments are automatically deactivated with status `'Transferred'`.

---

### File Inventory

| File | Action | Component | Description |
|---|---|---|---|
| `backend/src/db/migrations/22_zonal_office_mapping_and_ledger.sql` | **NEW** | Database | Core tables, triggers, indexes, and column alterations. |
| `backend/src/controllers/userMappings.controller.js` | **NEW** | Backend | Transactional user mapping, checking, and transfers. |
| `backend/src/controllers/workOrderMappings.controller.js` | **NEW** | Backend | WO assignments and deactivations. |
| `backend/src/controllers/zoBalances.controller.js` | **NEW** | Backend | Locked balance check, ledgers, and 2:00 AM nightly sync. |
| `backend/src/controllers/fundReturns.controller.js` | **NEW** | Backend | Return workflows, modifications, and concurrency checks. |
| `backend/src/app.js` | **MODIFY** | Backend | Register new mapping, ledger, and return routes. |
| `backend/src/controllers/requisitions.controller.js` | **MODIFY** | Backend | Log `zo_user_id` and check available balances on approval. |
| `backend/src/controllers/fundRequests.controller.js` | **MODIFY** | Backend | Require `work_order_no` and update balances on approval. |
| `frontend/src/pages/UserMappings.jsx` | **NEW** | Frontend | Management view for JE-ZO mappings. |
| `frontend/src/pages/WorkOrderMappings.jsx` | **NEW** | Frontend | Mappings of WOs to JEs with ZO restrictions. |
| `frontend/src/pages/ExcessFundReturns.jsx` | **NEW** | Frontend | Return flow dashboard with concurrency checks. |
| `frontend/src/App.jsx` | **MODIFY** | Frontend | Add routes for mappings, ledger, and returns. |
