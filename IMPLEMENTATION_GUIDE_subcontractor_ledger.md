# Implementation Guide — The Subcontractor Ledger

**Feature:** Turn a `Material Master` row with `Material_Main_Head = 'Sub Contractor'` into a real, work-order-scoped running balance. A Cost Estimate line item against a subcontractor credits that balance the moment HO approves the item (including every top-up created when the estimate is reopened); a Requisition against that same subcontractor debits it the moment ZO/HO approves the requisition. The Requisition form grows two new cascading dropdowns (Sub Head → Material Details) whenever `Material_Main_Head = 'Sub Contractor'` is selected, and shows the subcontractor's remaining balance before submit.

**Audience:** an SDE (or LLM coding agent) picking this up cold. Every fact below — file paths, current function bodies, column names, exact case-sensitivity — was verified directly against `origin/accounts-dept` at the commit carrying migrations through `043_credit_installment_copies_particulars.sql` (the prior Credit Ledger feature; unrelated, different module, do not confuse the two). This lands as `044_subcontractor_ledger.sql`.

This is a **different module** from the Accounts Requisition / Credit Ledger work already on this branch (`acctRequisition.*`, `credit_ledger`, HO Sheet review). That module belongs to Accounts. This feature belongs to the **JE → ZO → HO Cost Estimate / Requisition** workflow (`estimates.*`, `requisitions.*`, `material_master`) — a completely separate set of tables, RPCs, controllers, and frontend pages. Do not touch the accounts-dept files while building this.

---

## 1. Design decisions (locked in — do not re-litigate these)

1. **Ledger scope is per work order**, not global. Key = `(work_order_no, material_main_head, material_sub_head, material_details)`, with `material_main_head` always `'Sub Contractor'`. This was an explicit choice, confirmed with the product owner, to deviate from the accompanying spec doc's literal wording ("regardless of which estimate") — every other budget check in this codebase (`computeMainHeadCapacity`, `zo_balances`) is scoped per `work_order_no`, and two same-named subcontractors on two different projects must not share a balance.
2. **"Sub Contractor" is pure data, not an enum.** `material_master.Material_Main_Head` is a plain `character varying` with no CHECK constraint, no FK to a lookup table, and no app-level constant list (confirmed: zero references to "Sub Contractor" or "subcontractor" anywhere in the current codebase). It becomes real the moment an admin adds `Material Master` rows with `Material_Main_Head = 'Sub Contractor'` via the existing admin CRUD page — **no schema or code change is needed to "introduce" it.**
3. **Credit hook: item-level HO approval**, inside the existing `submit_row_approvals` RPC. The moment a `project_cost_estimate_items` row's `ho_office_approve` flips to `'Approve'` (and its `zo_office_approve` is also `'Approve'`) *and* its `material_main_head = 'Sub Contractor'*, it credits the ledger for `amount`. This is deliberately **not** gated on the parent estimate reaching `'Final Approved'` — HO's per-item lock (`ho_office_approve = 'Approve'` rows become immutable, per the existing `submitRowApprovals` controller's "Final approved rows are locked" guard) is the real point of no return, and gating there is what makes reopen top-ups work for free: a reopen never mutates an existing item row (`estimates.workflow.controller.js`'s `reopenEstimate` explicitly does not touch `project_cost_estimate_items` — "*We do not reset existing item-level approvals or remarks to preserve immutable decisions*"), it only lets JE/ZO add brand-new item rows while `estimate_status = 'Estimate Reopened'`. Each new row goes through its own ZO→HO approval cycle and hits this same hook. No reopen-specific ledger logic is needed anywhere.
4. **Debit hook: `approve_requisition_transact`**, extended. The existing Main Head capacity check (BUD02) and `zo_balances` debit are **untouched** and still apply — a Sub Contractor requisition still needs to fit inside its Main Head's overall estimate AND the approving ZO's own fund balance, exactly as today. The new subcontractor-balance check/debit is an **additional, independent gate** layered on top, only when `material_main_head = 'Sub Contractor'`.
5. **Requisition Sub Head / Material Details dropdowns are scoped to the current work order's approved estimate items** — not a blind `Material Master` catalog query. `Requisitions.jsx` already derives its Main Head dropdown this way (`allowedMainHeads` = distinct `material_main_head` values pulled from the Final-Approved estimate's own items, `Requisitions.jsx:608-634`), so the new Sub Head/Material Details dropdowns reuse that exact same already-fetched `items` array, filtered to `material_main_head === 'Sub Contractor'`. This keeps a JE from picking a subcontractor who has no actual estimated budget on this work order, and keeps the cascade consistent with decision #1 (per-work-order scope).
6. **Balance capacity is enforced the same way Main Head capacity already is: shown before submit AND hard-blocked both client-side and server-side.** `Requisitions.jsx`'s submit handler already does `if (capacityMetrics && reqAmount > capacityMetrics.remainingCapacity) { setError(...); return; }` (`:889-892`) before ever calling the API, and `create_requisition_secure`/`approve_requisition_transact` both hard-`RAISE EXCEPTION` server-side too. The new subcontractor check mirrors this exactly — client-side pre-check + two new server-side error codes, `BUD03` (create) and `BUD04` (approve), parallel to the existing `BUD01`/`BUD02`.
7. **Debits/credits are one-way and monotonic — no reversal logic anywhere.** Once `ho_office_approve = 'Approve'` on an estimate item, that row is permanently locked (existing guard). Once a requisition is `'Approved'`, `cancelRequisition` explicitly refuses to touch it (`requisition_status !== 'Pending' && !== 'Hold'` → 403) — there is no unapprove/reject-after-approve path in this module today. So the ledger never needs a credit-back or debit-reversal branch.
8. **Table shape mirrors the one native running-balance pattern that already exists in this domain**: `zo_balances` (a live cache) + `zo_fund_ledger` (an append-only, signed-amount audit trail), used identically by `approve_fund_request_transact` and `approve_requisition_transact` today. `subcontractor_balances` + `subcontractor_ledger` follow that same shape — lock-cache-update-insert-audit-row, in one transaction, inside the RPC.

---

## 2. Scope checklist

- [ ] DB: new migration `044_subcontractor_ledger.sql`
- [ ] DB: `requisitions.material_sub_head`, `requisitions.material_details` — new nullable columns
- [ ] DB: new `subcontractor_balances` table (cache)
- [ ] DB: new `subcontractor_ledger` table (append-only, signed amounts)
- [ ] DB: extend `submit_row_approvals` RPC — credit on Sub Contractor item HO-approval
- [ ] DB: extend `create_requisition_secure` RPC — two new params, `BUD03` guard
- [ ] DB: extend `approve_requisition_transact` RPC — `BUD04` guard, debit, ledger insert
- [ ] Backend: `requisition.schema.js` — conditional `material_sub_head`/`material_details` validation
- [ ] Backend: `requisitions.controller.js` — `createRequisition` (new fields, extended Material Master check, `BUD03` mapping), `actOnRequisition` (`BUD04` mapping), new `getSubcontractorCapacity`
- [ ] Backend: `mainHeadCapacity.service.js` — new `computeSubcontractorCapacity`
- [ ] Backend: `requisitions.routes.js` — `GET /requisitions/subcontractor-capacity`
- [ ] Frontend: `requisitionsApi.js` — `getSubcontractorCapacity`
- [ ] Frontend: `Requisitions.jsx` — cascading Sub Head/Material Details selects, capacity fetch + display, submit payload + client-side guard
- [ ] Tests + manual QA

---

## 3. Database changes

### 3.1 What does NOT need to change (read this first)

- **`material_master`** — no schema change. Columns are `Material_Main_Head`, `Material_Sub_Head`, `Material_Details`, `M_Unit` (PascalCase — this table alone in the schema uses PascalCase, everything else in this feature is snake_case; do not typo the case). Admin adds rows the normal way through the existing `MaterialMaster.jsx` CRUD page (`Material_Main_Head = 'Sub Contractor'`, `Material_Sub_Head = '<work package>'`, `Material_Details = '<subcontractor name>'`).
- **`GET /api/v1/auth/master-data/catalog`** (`masterData.controller.js:33` `getMasterDataCatalog`) — already builds a fully generic `Main Head → Sub Head → Materials` tree from every active `material_master` row, with zero Main-Head-specific logic. A `'Sub Contractor'` Main Head appears in it automatically. `EstimateForm.jsx`'s line-item Main Head/Sub Head/Material Details cascade (`:105-158` catalog fetch/cache, `:251` `fetchMaterials`, `:256-271` `handleItemChange`, selects at `:684-709`) is equally generic — **a JE creating a Cost Estimate line item against a subcontractor needs zero code changes**, it already works the instant the Material Master row exists.
- **`estimates.items.controller.js`** (`saveDraftItems`, `submitRowApprovals`) — no changes beyond the one RPC edit in §3.3. The reopen-add-new-row behavior already works correctly for this feature (see design decision #3).
- **`estimates.workflow.controller.js`**'s `reopenEstimate` — no changes. It already preserves item-level approvals untouched and only unlocks new-row inserts.

### 3.2 New migration file

`backend/src/db/migrations/044_subcontractor_ledger.sql`

```sql
-- Migration 044: The Subcontractor Ledger
--
-- Material Master rows with Material_Main_Head = 'Sub Contractor' identify
-- a (work package, subcontractor person) pair. This migration turns that
-- identity into a real, work-order-scoped running balance: a Cost Estimate
-- line item against a subcontractor credits the balance the moment HO
-- approves that item (submit_row_approvals); a Requisition against that
-- subcontractor debits it the moment ZO/HO approves the requisition
-- (approve_requisition_transact). Reopening an estimate never mutates
-- existing item rows (see estimates.workflow.controller.js's reopenEstimate)
-- — a "top up" is simply a new project_cost_estimate_items row that goes
-- through its own approval cycle and hits the same credit hook, so no
-- reopen-specific ledger logic is required here.
--
-- Ledger scope is per work_order_no + material_sub_head + material_details
-- (material_main_head is always 'Sub Contractor') — NOT global across work
-- orders, matching every other budget check in this codebase
-- (computeMainHeadCapacity, zo_balances/zo_fund_ledger).
--
-- Table shape mirrors zo_balances (cache) + zo_fund_ledger (append-only,
-- signed amounts) — the one native running-balance pattern already used by
-- approve_fund_request_transact and approve_requisition_transact.

-- ----------------------------------------------------------------------------
-- 1. requisitions: add Sub Head / Material Details, only meaningful when
--    material_main_head = 'Sub Contractor'. Nullable — same "no DB-level tie
--    to Material Master" convention material_main_head itself already uses;
--    required-ness is enforced app-side (Zod + RPC guard), not by a CHECK.
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."requisitions"
    ADD COLUMN "material_sub_head" character varying,
    ADD COLUMN "material_details" character varying;

-- ----------------------------------------------------------------------------
-- 2. subcontractor_balances — one row per (work_order_no, sub_head, details).
--    Lazily created on first credit (ON CONFLICT DO NOTHING / DO UPDATE),
--    same convention as zo_balances' fn_init_zo_balance_on_user_creation
--    equivalent used inline in approve_fund_request_transact.
-- ----------------------------------------------------------------------------
CREATE TABLE "public"."subcontractor_balances" (
    "work_order_no"      character varying NOT NULL,
    "material_main_head" character varying NOT NULL DEFAULT 'Sub Contractor',
    "material_sub_head"  character varying NOT NULL,
    "material_details"   character varying NOT NULL,
    "estimated_total"    numeric(18,2) NOT NULL DEFAULT 0,
    "paid_total"         numeric(18,2) NOT NULL DEFAULT 0,
    "available_balance"  numeric(18,2) NOT NULL DEFAULT 0,
    "updated_at"         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "subcontractor_balances_pkey" PRIMARY KEY (work_order_no, material_main_head, material_sub_head, material_details),
    CONSTRAINT "chk_scb_main_head" CHECK (material_main_head = 'Sub Contractor'),
    CONSTRAINT "chk_scb_available_nonneg" CHECK (available_balance >= 0),
    CONSTRAINT "chk_scb_paid_nonneg" CHECK (paid_total >= 0)
);

CREATE INDEX "idx_scb_work_order" ON subcontractor_balances (work_order_no);

-- ----------------------------------------------------------------------------
-- 3. subcontractor_ledger — append-only audit trail, signed amount
--    (positive = credit from an approved estimate item, negative = debit
--    from an approved requisition). Mirrors zo_fund_ledger exactly.
-- ----------------------------------------------------------------------------
CREATE TABLE "public"."subcontractor_ledger" (
    "ledger_id"          uuid DEFAULT gen_random_uuid() NOT NULL,
    "work_order_no"      character varying NOT NULL,
    "material_main_head" character varying NOT NULL DEFAULT 'Sub Contractor',
    "material_sub_head"  character varying NOT NULL,
    "material_details"   character varying NOT NULL,
    "transaction_type"   character varying NOT NULL,
    "reference_type"     character varying NOT NULL,
    "reference_id"       uuid NOT NULL,
    "amount"             numeric(18,2) NOT NULL,
    "created_at"         timestamptz NOT NULL DEFAULT now(),
    "created_by"         character varying NOT NULL,
    CONSTRAINT "subcontractor_ledger_pkey" PRIMARY KEY (ledger_id),
    CONSTRAINT "chk_scl_transaction_type" CHECK (transaction_type IN ('ESTIMATE_ITEM_APPROVAL', 'REQUISITION_APPROVAL')),
    CONSTRAINT "chk_scl_reference_type" CHECK (reference_type IN ('ESTIMATE_ITEM', 'REQUISITION')),
    CONSTRAINT "fk_scl_balance" FOREIGN KEY (work_order_no, material_main_head, material_sub_head, material_details)
        REFERENCES subcontractor_balances (work_order_no, material_main_head, material_sub_head, material_details)
);

CREATE INDEX "idx_scl_balance" ON subcontractor_ledger (work_order_no, material_sub_head, material_details);
CREATE INDEX "idx_scl_reference" ON subcontractor_ledger (reference_type, reference_id);
```

> **`fk_scl_balance` ordering note**: because of this FK, every RPC below must upsert the `subcontractor_balances` row *before* inserting into `subcontractor_ledger`, in the same transaction. Both RPC edits in §3.3/3.4 are already written in that order — don't reorder them.

### 3.3 `submit_row_approvals` — credit on Sub Contractor item HO-approval

Full body reproduced from `00_full_schema_dump.sql` with the new block inserted right after the per-approval `UPDATE` loop's HO branch. **Verify this function hasn't been touched by any migration between `00` and `043` before running** (grep `submit_row_approvals` across `backend/src/db/migrations/*.sql` — as of this guide, only `00_full_schema_dump.sql` defines it).

```sql
CREATE OR REPLACE FUNCTION "public"."submit_row_approvals"("p_estimate_id" "uuid", "p_approvals" "jsonb", "p_stage" "text", "p_modified_by" character varying) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_role      VARCHAR;
  approval         JSONB;
  v_item_id        UUID;
  v_approve_status TEXT;
  v_remarks        TEXT;
  v_status         estimate_status_enum;
  v_new_amount     NUMERIC(18,2);
  v_rows           INT;
  -- NEW: Subcontractor Ledger credit bookkeeping.
  v_work_order_no  VARCHAR;
  v_item           project_cost_estimate_items;
BEGIN
  -- 1. Security Check: Confirm modifier role has authorization for the stage
  SELECT role INTO v_user_role
  FROM authorised_users
  WHERE mobile_number = p_modified_by AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.';
  END IF;

  IF p_stage = 'ZO' AND v_user_role NOT IN ('zo', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have ZO or Admin role.';
  END IF;

  IF p_stage = 'HO' AND v_user_role NOT IN ('ho', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have HO or Admin role.';
  END IF;

  -- 2. Read current estimate status
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found: %', p_estimate_id;
  END IF;

  -- NEW: work order for this estimate — same for every item in the loop below.
  SELECT work_order_no INTO v_work_order_no
  FROM project_cost_estimates WHERE estimate_id = p_estimate_id;

  -- 3. Apply each row approval
  FOR approval IN SELECT * FROM jsonb_array_elements(p_approvals)
  LOOP
    v_item_id        := (approval->>'item_id')::UUID;
    v_approve_status := approval->>'approve_status';
    v_remarks        := approval->>'remarks';

    IF p_stage = 'ZO' THEN
      UPDATE project_cost_estimate_items
      SET
        zo_office_approve = v_approve_status::row_approval_enum,
        zo_remarks        = v_remarks,
        updated_at        = now()
      WHERE item_id = v_item_id
        AND estimate_id = p_estimate_id;
    ELSIF p_stage = 'HO' THEN
      UPDATE project_cost_estimate_items
      SET
        ho_office_approve = v_approve_status::row_approval_enum,
        ho_remarks        = v_remarks,
        updated_at        = now()
      WHERE item_id = v_item_id
        AND estimate_id = p_estimate_id;
    ELSE
      RAISE EXCEPTION 'Invalid stage: %. Must be ZO or HO.', p_stage;
    END IF;

    -- Rollback Safety Check: Validate the target item row was modified
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'Item ID % not found or does not belong to estimate %.', v_item_id, p_estimate_id;
    END IF;

    -- NEW: Subcontractor Ledger credit. Only at the HO stage (the point of
    -- no return — this row is now permanently locked, per the existing
    -- "Final approved rows are locked" guard in submitRowApprovals), only
    -- when it just became fully approved (zo AND ho both 'Approve'), and
    -- only for Sub Contractor rows.
    IF p_stage = 'HO' AND v_approve_status = 'Approve' THEN
      SELECT * INTO v_item FROM project_cost_estimate_items WHERE item_id = v_item_id;

      IF v_item.material_main_head = 'Sub Contractor' AND v_item.zo_office_approve = 'Approve' THEN
        INSERT INTO subcontractor_balances (work_order_no, material_sub_head, material_details, estimated_total, available_balance)
        VALUES (v_work_order_no, v_item.material_sub_head, v_item.material_details, v_item.amount, v_item.amount)
        ON CONFLICT (work_order_no, material_main_head, material_sub_head, material_details) DO UPDATE
        SET estimated_total   = subcontractor_balances.estimated_total + v_item.amount,
            available_balance = subcontractor_balances.available_balance + v_item.amount,
            updated_at        = now();

        INSERT INTO subcontractor_ledger (work_order_no, material_sub_head, material_details, transaction_type, reference_type, reference_id, amount, created_by)
        VALUES (v_work_order_no, v_item.material_sub_head, v_item.material_details, 'ESTIMATE_ITEM_APPROVAL', 'ESTIMATE_ITEM', v_item_id, v_item.amount, p_modified_by);
      END IF;
    END IF;
  END LOOP;

  -- 4. Recalculate amount based on current status (Workflow calculation matrix)
  IF v_status IN ('Draft', 'Submitted', 'Under ZO Review', 'ZO Revision Requested',
                  'Rejected by ZO', 'Rejected by HO') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;

  ELSIF v_status IN ('ZO Approved', 'Under HO Review', 'HO Revision Requested', 'Estimate Reopened') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve';

  ELSIF v_status = 'Final Approved' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve'
      AND ho_office_approve = 'Approve';
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;
  END IF;

  -- 5. Write back to header
  UPDATE project_cost_estimates
  SET
    estimate_amount  = v_new_amount,
    last_modified_by = p_modified_by,
    updated_at       = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;
```

**Why the `zo_office_approve = 'Approve'` re-check inside the HO branch**: `submitRowApprovals` (the JS controller) already blocks HO from approving a row that ZO rejected in most flows, but the RPC itself doesn't assume that — this guard is belt-and-suspenders so a Sub Contractor row can never credit the ledger on an HO-only approval that ZO never signed off on.

### 3.4 `create_requisition_secure` — two new params, `BUD03` guard

Full body reproduced with the new params appended (breaks the existing positional-call convention if you don't also update every call site — there is exactly one, in `requisitions.controller.js`, updated in §4.2) and one new capacity block inserted after the existing Main Head check.

```sql
CREATE OR REPLACE FUNCTION "public"."create_requisition_secure"(
    "p_requester_user_id" character varying, "p_work_order_no" character varying, "p_estimate_no" character varying,
    "p_estimate_amount" numeric, "p_state" character varying, "p_district" character varying, "p_area_code" character varying,
    "p_department" character varying, "p_site_details" "text", "p_requisition_no" character varying,
    "p_material_main_head" character varying, "p_requisition_pdf_url" "text", "p_original_filename" character varying,
    "p_requisition_amount" numeric, "p_gst_bill" "public"."gst_bill_enum", "p_gst_bill_pdf_url" "text",
    "p_bank_details" "text", "p_expen_head_remarks" "text", "p_requisition_status" "public"."requisition_status_enum",
    "p_created_by" character varying,
    "p_material_sub_head" character varying DEFAULT NULL,  -- NEW
    "p_material_details" character varying DEFAULT NULL     -- NEW
) RETURNS "public"."requisitions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_project_status public.project_status;
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
    v_sc_available numeric(18,2) := 0.00;  -- NEW
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
        RAISE EXCEPTION 'Cannot create requisitions for projects with "Closed" status. All linked reports are immutable.' USING ERRCODE = 'PR001';
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

    -- NEW: 7b. Validate Subcontractor Ledger capacity (independent of Main Head).
    IF p_material_main_head = 'Sub Contractor' THEN
        IF p_material_sub_head IS NULL OR p_material_details IS NULL THEN
            RAISE EXCEPTION 'material_sub_head and material_details are required for a Sub Contractor requisition.' USING ERRCODE = 'VAL01';
        END IF;

        SELECT available_balance INTO v_sc_available
        FROM subcontractor_balances
        WHERE work_order_no = p_work_order_no
          AND material_sub_head = p_material_sub_head
          AND material_details = p_material_details
        FOR UPDATE;

        IF NOT FOUND THEN
            v_sc_available := 0.00;
        END IF;

        IF p_requisition_amount > v_sc_available THEN
            RAISE EXCEPTION 'Requisition amount exceeds the remaining Subcontractor Ledger balance (Balance: %, Requested: %).',
                v_sc_available, p_requisition_amount
                USING ERRCODE = 'BUD03';
        END IF;
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
        material_sub_head,       -- NEW
        material_details,        -- NEW
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
        p_material_sub_head,     -- NEW
        p_material_details,      -- NEW
        p_requisition_pdf_url,
        p_original_filename,
        p_requisition_amount,
        p_gst_bill,
        p_gst_bill_pdf_url,
        p_bank_details,
        p_expen_head_remarks,
        p_requisition_status,
        p_created_by
    )
    RETURNING * INTO v_inserted;

    RETURN v_inserted;
END;
$$;
```

> **Verify the tail of `create_requisition_secure`** (the exact `INSERT` column/value list) against the live `00_full_schema_dump.sql` before running this — I've reconstructed it from the confirmed column set and the confirmed first ~8 steps; double-check nothing else (e.g. a trigger-populated column) sits between `p_created_by` and the closing `RETURNING`.

### 3.5 `approve_requisition_transact` — `BUD04` guard, debit, ledger insert

Full body reproduced from `00_full_schema_dump.sql` with one new block inserted after the existing Main Head capacity check (step 5) and before the `zo_balances` lock (step 6) — deliberately checking Subcontractor Ledger capacity *before* touching real ZO funds, same "cheapest/most specific check first" ordering the Credit Ledger's `approve_acct_line_item_transact` used.

```sql
CREATE OR REPLACE FUNCTION "public"."approve_requisition_transact"("p_requisition_id" "uuid", "p_approved_amount" numeric, "p_actioned_by" character varying, "p_remarks_approved_authority" "text") RETURNS "public"."requisitions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_req public.requisitions;
    v_balance NUMERIC(18,2);
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
    v_sc_available numeric(18,2) := 0.00;  -- NEW
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

    -- NEW: 5b. Validate + lock Subcontractor Ledger balance (independent of Main Head).
    IF v_req.material_main_head = 'Sub Contractor' THEN
        SELECT available_balance INTO v_sc_available
        FROM subcontractor_balances
        WHERE work_order_no = v_req.work_order_no
          AND material_sub_head = v_req.material_sub_head
          AND material_details = v_req.material_details
        FOR UPDATE;

        IF NOT FOUND THEN
            v_sc_available := 0.00;
        END IF;

        IF p_approved_amount > v_sc_available THEN
            RAISE EXCEPTION 'Approved amount exceeds the remaining Subcontractor Ledger balance (Balance: %, Attempted: %).',
                v_sc_available, p_approved_amount
                USING ERRCODE = 'BUD04';
        END IF;
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

    -- NEW: 8b. Debit the Subcontractor Ledger balance + append audit row.
    IF v_req.material_main_head = 'Sub Contractor' THEN
        UPDATE subcontractor_balances
        SET paid_total        = paid_total + p_approved_amount,
            available_balance = available_balance - p_approved_amount,
            updated_at        = now()
        WHERE work_order_no = v_req.work_order_no
          AND material_sub_head = v_req.material_sub_head
          AND material_details = v_req.material_details;

        INSERT INTO subcontractor_ledger (work_order_no, material_sub_head, material_details, transaction_type, reference_type, reference_id, amount, created_by)
        VALUES (v_req.work_order_no, v_req.material_sub_head, v_req.material_details, 'REQUISITION_APPROVAL', 'REQUISITION', p_requisition_id, -p_approved_amount, p_actioned_by);
    END IF;

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

**Error code summary added by this migration:** `VAL01` (missing sub head/details on a Sub Contractor requisition — reuses the generic `VAL01` code already used elsewhere in this schema for "required field missing," confirm no collision with a code this specific RPC already raises — it doesn't), `BUD03` (create-time subcontractor capacity exceeded), `BUD04` (approve-time subcontractor capacity exceeded). Both `BUD0x` map to the same HTTP status the existing `BUD01`/`BUD02` use (422) — see §4.2.

---

## 4. Backend changes

### 4.1 `backend/src/validation/requisition.schema.js`

Add conditional fields to `createRequisitionSchema`:

```js
const createRequisitionSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' }).trim().min(1, 'work_order_no is required.'),
    requisition_no: z.string({ required_error: 'requisition_no (Requisition Number) is required.' })
      .trim().min(1, 'requisition_no (Requisition Number) is required.')
      .regex(/^[A-Za-z0-9_\-.]+$/, 'requisition_no contains invalid characters. Only letters, digits, hyphens, underscores, and dots are allowed.'),
    material_main_head: z.string({ required_error: 'material_main_head is required.' }).trim().min(1, 'material_main_head is required.'),
    material_sub_head: z.string().trim().optional().nullable(),   // NEW
    material_details:  z.string().trim().optional().nullable(),   // NEW
    requisition_pdf_url: z.string({ required_error: 'requisition_pdf_url is required. Upload the PDF first.' }).trim().min(1, 'requisition_pdf_url is required. Upload the PDF first.'),
    original_filename: z.string().optional().nullable(),
    requisition_amount: z.coerce.number({
      required_error: 'requisition_amount must be a positive number greater than zero.',
      invalid_type_error: 'requisition_amount must be a positive number greater than zero.'
    }).positive('requisition_amount must be a positive number greater than zero.'),
    gst_bill: z.enum(['Yes', 'No'], { errorMap: () => ({ message: "gst_bill must be 'Yes' or 'No'." }) }),
    gst_bill_pdf_url: z.string().optional().nullable(),
    bank_details: z.string({ required_error: 'bank_details is required.' }).trim().min(1, 'bank_details is required.'),
    expen_head_remarks: z.string().optional().nullable()
  })
  .refine(data => data.gst_bill !== 'Yes' || (data.gst_bill_pdf_url && data.gst_bill_pdf_url.trim() !== ''), {
    message: "gst_bill_pdf_url is required when GST Bill is 'Yes'.",
    path: ['gst_bill_pdf_url']
  })
  // NEW
  .refine(data => data.material_main_head?.trim() !== 'Sub Contractor' || (data.material_sub_head?.trim() && data.material_details?.trim()), {
    message: 'material_sub_head and material_details are required when material_main_head is Sub Contractor.',
    path: ['material_sub_head']
  })
};
```

`actOnRequisitionSchema` needs **no change** — Sub Head/Details are read server-side from the already-inserted requisition row, never resent at approval time.

### 4.2 `backend/src/controllers/requisitions.controller.js`

**a) `createRequisition`** (`:32-265`) — destructure the two new fields (`:35-46`), extend the Material Master existence check (`:139-154`) to also confirm the Sub Head/Details combination exists when applicable, pass the two new RPC params, and map `BUD03`:

```js
const {
  work_order_no, requisition_no, material_main_head,
  material_sub_head, material_details,               // NEW
  requisition_pdf_url, original_filename, requisition_amount,
  gst_bill, gst_bill_pdf_url, bank_details, expen_head_remarks
} = req.body;

// ... existing steps 1-3 unchanged ...

// 4. Validate material_main_head (and, for Sub Contractor, sub_head/details) exists in Material Master
const { data: materialExists, error: materialErr } = await supabase
  .from('material_master')
  .select('Material_Main_Head')
  .eq('Material_Main_Head', material_main_head.trim())
  .limit(1)
  .maybeSingle();

if (materialErr) throw materialErr;
if (!materialExists) {
  await cleanupUploadedFiles();
  return res.status(400).json({ success: false, message: `material_main_head '${material_main_head}' does not exist in Material Master.` });
}

// NEW
if (material_main_head.trim() === 'Sub Contractor') {
  const { data: scExists, error: scErr } = await supabase
    .from('material_master')
    .select('id')
    .eq('Material_Main_Head', 'Sub Contractor')
    .eq('Material_Sub_Head', material_sub_head?.trim())
    .eq('Material_Details', material_details?.trim())
    .limit(1)
    .maybeSingle();
  if (scErr) throw scErr;
  if (!scExists) {
    await cleanupUploadedFiles();
    return res.status(400).json({ success: false, message: `Subcontractor '${material_details}' under '${material_sub_head}' does not exist in Material Master.` });
  }
}

// 5. Call the transactional RPC — add the two new params
const { data: newReq, error: rpcError } = await supabase.rpc('create_requisition_secure', {
  p_requester_user_id: req.user.mobile_number,
  p_work_order_no: work_order_no.trim(),
  p_estimate_no: project.estimate_no,
  p_estimate_amount: estimateAmount,
  p_state: project.state,
  p_district: project.district,
  p_area_code: project.zone,
  p_department: project.department,
  p_site_details: project.site_details,
  p_requisition_no: requisition_no.trim(),
  p_material_main_head: material_main_head.trim(),
  p_material_sub_head: material_sub_head?.trim() || null,   // NEW
  p_material_details: material_details?.trim() || null,     // NEW
  p_requisition_pdf_url: requisition_pdf_url.trim(),
  p_original_filename: original_filename?.trim() || null,
  p_requisition_amount: Number(requisition_amount),
  p_gst_bill: gst_bill,
  p_gst_bill_pdf_url: gst_bill === 'Yes' ? gst_bill_pdf_url.trim() : null,
  p_bank_details: bank_details.trim(),
  p_expen_head_remarks: expen_head_remarks?.trim() || null,
  p_requisition_status: 'Pending',
  p_created_by: req.user.mobile_number
});

if (rpcError) {
  await cleanupUploadedFiles();
  if (rpcError.code === '23505') { /* unchanged */ }
  if (rpcError.code === 'BUD01' || ...) { /* unchanged, Main Head branch */ }
  // NEW
  if (rpcError.code === 'BUD03' || rpcError.message?.includes('Subcontractor Ledger balance')) {
    const capacity = await computeSubcontractorCapacity(work_order_no.trim(), material_sub_head.trim(), material_details.trim());
    return res.status(422).json({
      success: false,
      message: `Requisition amount exceeds the remaining Subcontractor Ledger balance for '${material_details.trim()}' (${material_sub_head.trim()}). Estimated Total: ₹${capacity.estimatedTotal.toLocaleString('en-IN')}. Paid So Far: ₹${capacity.paidTotal.toLocaleString('en-IN')}. Remaining Balance: ₹${capacity.availableBalance.toLocaleString('en-IN')}. Your Request: ₹${Number(requisition_amount).toLocaleString('en-IN')}.`
    });
  }
  if (rpcError.code === 'PR001' || ...) { /* unchanged */ }
  throw rpcError;
}
```

**b) `actOnRequisition`** (`:482-586`) — add a `BUD04` branch parallel to the existing `BUD02` one, right after it (`:556-558`):

```js
if (rpcErr.code === 'BUD02' || rpcErr.message?.includes('exceeds the remaining Main Head capacity')) {
  return res.status(422).json({ success: false, message: rpcErr.message });
}
// NEW
if (rpcErr.code === 'BUD04' || rpcErr.message?.includes('exceeds the remaining Subcontractor Ledger balance')) {
  return res.status(422).json({ success: false, message: rpcErr.message });
}
```

**c) New `getSubcontractorCapacity` controller** — mirrors `getMainHeadCapacity` (`:667-693`) exactly:

```js
/**
 * GET /api/v1/auth/requisitions/subcontractor-capacity
 * Fetches current Estimated Total, Paid So Far, and Remaining Balance for a
 * (work_order_no, material_sub_head, material_details) Subcontractor Ledger
 * entry, read straight from subcontractor_balances (a persisted cache, not
 * a live SUM — unlike computeMainHeadCapacity, this balance must survive an
 * estimate reopen, during which there is briefly no 'Final Approved'
 * estimate row for the work order to sum from).
 */
async function getSubcontractorCapacity(req, res) {
  const { work_order_no, material_sub_head, material_details } = req.query;

  if (!work_order_no || !material_sub_head || !material_details) {
    return res.status(400).json({
      success: false,
      message: 'work_order_no, material_sub_head, and material_details query parameters are required.'
    });
  }

  try {
    const capacity = await computeSubcontractorCapacity(work_order_no, material_sub_head, material_details);
    return res.status(200).json({ success: true, ...capacity });
  } catch (error) {
    console.error(`getSubcontractorCapacity failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Subcontractor Ledger capacity.' });
  }
}

module.exports = {
  createRequisition, getRequisitions, getRequisitionById, actOnRequisition,
  cancelRequisition, getMainHeadCapacity,
  getSubcontractorCapacity   // NEW
};
```

Add `const { computeMainHeadCapacity, computeSubcontractorCapacity } = require('../services/mainHeadCapacity.service');` to the top-of-file import (`:4`).

### 4.3 `backend/src/services/mainHeadCapacity.service.js`

New function, same file (rename the file in a follow-up if you want — not required for this feature):

```js
/**
 * Subcontractor Ledger capacity for a (work_order_no, material_sub_head,
 * material_details) triple. Unlike computeMainHeadCapacity, this reads a
 * persisted running balance (subcontractor_balances) rather than summing
 * live — the balance must survive an estimate reopen cycle, during which
 * there's briefly no 'Final Approved' estimate for the work order at all.
 */
async function computeSubcontractorCapacity(workOrderNo, materialSubHead, materialDetails) {
  const { data, error } = await supabase
    .from('subcontractor_balances')
    .select('estimated_total, paid_total, available_balance')
    .eq('work_order_no', workOrderNo.trim())
    .eq('material_sub_head', materialSubHead.trim())
    .eq('material_details', materialDetails.trim())
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return { estimatedTotal: 0, paidTotal: 0, availableBalance: 0 };
  }

  return {
    estimatedTotal: Number(data.estimated_total),
    paidTotal: Number(data.paid_total),
    availableBalance: Number(data.available_balance)
  };
}

module.exports = {
  computeMainHeadCapacity,
  computeSubcontractorCapacity   // NEW
};
```

### 4.4 `backend/src/routes/requisitions.routes.js`

```js
const {
  createRequisition, getRequisitions, getRequisitionById, actOnRequisition,
  cancelRequisition, getMainHeadCapacity,
  getSubcontractorCapacity   // NEW
} = require('../controllers/requisitions.controller');

// ... existing routes ...
router.get('/capacity', requireRole(readerRoles), getMainHeadCapacity);
router.get('/subcontractor-capacity', requireRole(readerRoles), getSubcontractorCapacity);   // NEW
```

Place it right after the existing `/capacity` route.

---

## 5. Frontend changes

### 5.1 `frontend/src/api/requisitionsApi.js`

```js
/** Fetch Subcontractor Ledger capacity metrics */
export const getSubcontractorCapacity = (work_order_no, material_sub_head, material_details) =>
  authApi.get('/requisitions/subcontractor-capacity', { params: { work_order_no, material_sub_head, material_details } });
```

Add right after `getMainHeadCapacity` (`:16-18`).

### 5.2 `frontend/src/pages/Requisitions.jsx`

This is a large (~2000 line) file handling both the JE create-form and the ZO/HO approval views; all edits below are inside the create-form component.

**a) New state** (alongside `materialHead` at `:573` and `allowedMainHeads` at `:595`):

```js
const [materialSubHead, setMaterialSubHead] = useState('');
const [materialDetails, setMaterialDetails] = useState('');
const [subcontractorCapacityMetrics, setSubcontractorCapacityMetrics] = useState(null);
const [loadingSubcontractorCapacity, setLoadingSubcontractorCapacity] = useState(false);
```

**b) Derive Sub Head / Material Details options from the same estimate-items fetch that already builds `allowedMainHeads`** (`:600-634`) — this keeps the cascade scoped to the current work order's approved estimate, per design decision #5. Store the raw Sub-Contractor items alongside `allowedMainHeads`:

```js
const [subContractorItems, setSubContractorItems] = useState([]);  // NEW — raw items where material_main_head === 'Sub Contractor'

// inside the existing useEffect at :600-634, after setAllowedMainHeads(distinctHeads):
const scItems = (res.data.items || []).filter(item => item.material_main_head === 'Sub Contractor');
setSubContractorItems(scItems);
// and reset it in both early-return branches (no selectedWO, no approved estimate) alongside setAllowedMainHeads([])
```

Derive the two dropdown option lists from `subContractorItems` (compute inline in the render, no extra state needed):

```js
const subHeadOptions = Array.from(new Set(subContractorItems.map(i => i.material_sub_head).filter(Boolean)));
const materialDetailsOptions = Array.from(new Set(
  subContractorItems.filter(i => i.material_sub_head === materialSubHead).map(i => i.material_details).filter(Boolean)
));
```

Reset `materialSubHead`/`materialDetails` whenever `materialHead` changes (mirror the existing pattern where the Main Head `<Select>`'s `onChange` at `:1098` doesn't currently reset anything downstream — add that reset here since it's now needed):

```js
onChange={(e) => {
  setMaterialHead(e.target.value);
  setMaterialSubHead('');
  setMaterialDetails('');
}}
```

And reset `materialDetails` whenever `materialSubHead` changes.

**c) New capacity-fetch effect**, parallel to the existing Main Head one at `:636-663`:

```js
useEffect(() => {
  if (materialHead !== 'Sub Contractor' || !selectedWO || !materialSubHead || !materialDetails) {
    setSubcontractorCapacityMetrics(null);
    return;
  }
  setLoadingSubcontractorCapacity(true);
  getSubcontractorCapacity(selectedWO, materialSubHead, materialDetails)
    .then(res => {
      if (res.data) {
        setSubcontractorCapacityMetrics({
          estimatedTotal: Number(res.data.estimatedTotal),
          paidTotal: Number(res.data.paidTotal),
          availableBalance: Number(res.data.availableBalance)
        });
      }
    })
    .catch(err => console.error('Failed to load Subcontractor Ledger capacity:', err))
    .finally(() => setLoadingSubcontractorCapacity(false));
}, [materialHead, selectedWO, materialSubHead, materialDetails]);
```

**d) Submit-time guard**, parallel to the existing Main Head one at `:889-892`:

```js
if (materialHead === 'Sub Contractor') {
  if (!materialSubHead || !materialDetails) {
    setError('Please select a Sub Head and Subcontractor.');
    return;
  }
  if (subcontractorCapacityMetrics && Number(reqAmount) > subcontractorCapacityMetrics.availableBalance) {
    setError(`Requisition Amount exceeds the Remaining Subcontractor Ledger Balance (₹${subcontractorCapacityMetrics.availableBalance.toLocaleString('en-IN')}) for '${materialDetails}'.`);
    return;
  }
}
```

**e) Submit payload** (`:904-915`) — add the two fields when applicable:

```js
const payload = {
  work_order_no: selectedWO.trim(),
  requisition_no: requisitionNo.trim(),
  material_main_head: materialHead.trim(),
  material_sub_head: materialHead === 'Sub Contractor' ? materialSubHead.trim() : undefined,   // NEW
  material_details: materialHead === 'Sub Contractor' ? materialDetails.trim() : undefined,    // NEW
  requisition_pdf_url: requisitionPdfUrl.trim(),
  original_filename: requisitionPdf?.name || null,
  requisition_amount: Number(reqAmount),
  gst_bill: gstBill,
  gst_bill_pdf_url: gstBill === 'Yes' ? gstPdfUrl.trim() : null,
  bank_details: bankDetails.trim(),
  expen_head_remarks: remarks.trim() || null
};
```

**f) Render** — two new `<Select>`s right after the existing Material Main Head select (`:1095-1110`), shown only when `materialHead === 'Sub Contractor'`, and a second capacity card mirroring the existing "Material Main Head Capacity" one (`:1173-1195`):

```jsx
{materialHead === 'Sub Contractor' && (
  <>
    <Select
      label="Sub Head (Work Package)"
      value={materialSubHead}
      onChange={(e) => { setMaterialSubHead(e.target.value); setMaterialDetails(''); }}
      required
      disabled={submitting}
    >
      <option value="">-- Select Sub Head --</option>
      {subHeadOptions.map((sh) => <option key={sh} value={sh}>{sh}</option>)}
    </Select>

    <Select
      label="Subcontractor"
      value={materialDetails}
      onChange={(e) => setMaterialDetails(e.target.value)}
      required
      disabled={submitting || !materialSubHead}
    >
      <option value="">-- Select Subcontractor --</option>
      {materialDetailsOptions.map((md) => <option key={md} value={md}>{md}</option>)}
    </Select>
  </>
)}

{/* ... existing PDF upload, Requisition Amount fields ... */}

{materialHead === 'Sub Contractor' && materialSubHead && materialDetails && (
  <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 space-y-2">
    <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400">
      Subcontractor Ledger Balance ({materialDetails})
    </p>
    {loadingSubcontractorCapacity ? (
      <div className="flex items-center gap-2 py-2">
        <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-indigo-500" />
        <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Loading Balance…</span>
      </div>
    ) : subcontractorCapacityMetrics ? (
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="text-slate-400">Estimated Total:</div>
        <div className="text-slate-200 font-mono text-right">{formatCurrency(subcontractorCapacityMetrics.estimatedTotal)}</div>
        <div className="text-slate-400">Paid So Far:</div>
        <div className="text-slate-200 font-mono text-right">{formatCurrency(subcontractorCapacityMetrics.paidTotal)}</div>
        <div className="text-slate-400">Remaining Balance:</div>
        <div className="text-emerald-400 font-mono font-bold text-right">{formatCurrency(subcontractorCapacityMetrics.availableBalance)}</div>
      </div>
    ) : (
      <p className="text-[9px] text-red-400">Failed to load balance details.</p>
    )}
  </div>
)}
```

Also add `material_sub_head`/`material_details` to the read-only requisition detail views if present (`:132`, `:428`, `:1666`, `:2000` already show `requisition.material_main_head` — add the two new fields alongside them the same way, purely additive, no logic).

---

## 6. What NOT to touch

- **`material_master`, `materials.controller.js`, `MaterialMaster.jsx`** — zero changes. "Sub Contractor" is pure data added through the existing admin CRUD flow.
- **`masterData.controller.js` / `getMasterDataCatalog`, `EstimateForm.jsx`'s cascade** — already fully generic over any `Material_Main_Head` value; a JE creating a Sub-Contractor estimate line item needs no code change.
- **`estimates.workflow.controller.js`'s `reopenEstimate`** — already correctly leaves existing item approvals untouched and only permits new-row inserts during `'Estimate Reopened'`. This is exactly the behavior the ledger's per-item credit hook depends on.
- **`estimates.items.controller.js`'s `saveDraftItems`** — the JS-side row insert/update logic for estimate line items is unaffected; only the DB-side `submit_row_approvals` RPC (called from `submitRowApprovals`, a *different* function in the same file) gets the new credit block.
- **`zo_balances` / `zo_fund_ledger` / `approve_fund_request_transact`** — completely separate concern (a ZO's own cash allocation), untouched. A Sub Contractor requisition still debits `zo_balances` exactly as before, in addition to the new subcontractor debit — the two are independent checks that both must pass.
- **`cancelRequisition`** — no change. It already refuses to touch anything past `Pending`/`Hold`, which is exactly the invariant that keeps the ledger one-way (design decision #7).
- **`computeMainHeadCapacity` / `getMainHeadCapacity`** — untouched, still governs Main Head-level capacity for every Main Head including Sub Contractor rows. The new subcontractor check is additive, not a replacement.

---

## 7. Tests (backend)

New file `backend/tests/vitest/regression/subcontractorLedger.test.js` (or the nearest existing convention for this module — check whether `estimates.*`/`requisitions.*` regression tests already have a shared fixture helper analogous to `acctRequisitionFixture.js`; if not, seed directly the way `acctSheetReviewedStatusSync.test.js` does — insert rows straight into `project_cost_estimates`/`project_cost_estimate_items`/`requisitions` at the right status, bypassing the full JE→ZO→HO HTTP flow, then call the RPCs directly).

1. **Credit on HO approval:** an estimate item with `material_main_head = 'Sub Contractor'`, `zo_office_approve = 'Approve'` already set — calling `submit_row_approvals` with `p_stage = 'HO'`, `approve_status = 'Approve'` creates/increments the matching `subcontractor_balances` row by `amount`, and inserts a `subcontractor_ledger` row (`ESTIMATE_ITEM_APPROVAL`, positive amount).
2. **No credit on ZO-only approval:** the same call with `p_stage = 'ZO'` does not touch `subcontractor_balances`.
3. **No credit on non-Sub-Contractor items:** an item with `material_main_head = 'Material'` HO-approved does not touch `subcontractor_balances`.
4. **Reopen top-up compounds:** credit an item (test 1), then simulate a reopen top-up as a brand-new `project_cost_estimate_items` row for the *same* `(work_order_no, sub_head, details)`, HO-approve it too — assert `subcontractor_balances.estimated_total`/`available_balance` accumulated across both (matches the PDF's worked example: ₹1,00,000 → ₹95,000 after a ₹20,000 debit and a ₹15,000 top-up).
5. **`create_requisition_secure` — `BUD03` guard:** a Sub Contractor requisition whose amount exceeds `subcontractor_balances.available_balance` is rejected with `BUD03`.
6. **`create_requisition_secure` — `VAL01` guard:** a Sub Contractor requisition missing `p_material_sub_head`/`p_material_details` is rejected with `VAL01`.
7. **`approve_requisition_transact` debits the ledger:** approving a Pending Sub Contractor requisition within balance decrements `subcontractor_balances.available_balance`/increments `paid_total` by the approved amount, and inserts a `subcontractor_ledger` row (`REQUISITION_APPROVAL`, negative amount) — alongside confirming `zo_balances`/`zo_fund_ledger` still behave exactly as before (regression, not new behavior).
8. **`approve_requisition_transact` — `BUD04` guard:** approving for more than the remaining subcontractor balance is rejected with `BUD04`, and neither `zo_balances` nor `subcontractor_balances` are touched (transaction rolled back).
9. **Non-Sub-Contractor requisitions unaffected:** a normal `'Material'` requisition's approve flow never touches `subcontractor_balances`/`subcontractor_ledger` (regression).
10. **Ledger scope is per work order:** two requisitions/estimates for the *same* `material_sub_head`+`material_details` but *different* `work_order_no` values produce two independent `subcontractor_balances` rows, never merged.

**Frontend:** no automated coverage required for the new dropdowns/capacity card given this codebase's existing convention (the Credit Ledger feature also shipped without frontend tests for its analogous UI) — verify by hand per §8.

---

## 8. Manual QA checklist

1. As admin, add a `Material Master` row: `Material_Main_Head = 'Sub Contractor'`, `Material_Sub_Head = 'Pipe Line HDPE Work'`, `Material_Details = 'Jahangir Mandal'`.
2. As JE, create a Cost Estimate for a work order with a line item against that Main Head/Sub Head/Material Details, amount ₹1,00,000 — confirm the cascade (Main Head → Sub Head → Material Details) already works with zero code changes, since it reuses the existing catalog.
3. ZO approves, then HO approves the estimate (both stages, both the header and — critically — this specific row). Query `subcontractor_balances` directly: `estimated_total = available_balance = 1,00,000`, `paid_total = 0`.
4. As JE, open Create Requisition for the same work order, select Main Head = `Sub Contractor` — confirm Sub Head and Subcontractor dropdowns appear and are populated only from this work order's approved estimate. Select them; confirm the balance card shows Estimated ₹1,00,000 / Paid ₹0 / Remaining ₹1,00,000.
5. Enter ₹20,000, submit. As ZO/HO, approve it. Query `subcontractor_balances` again: `available_balance = 80,000`, `paid_total = 20,000`. Confirm `zo_balances` also debited normally (regression check).
6. As HO, reopen the estimate. Add a brand-new line item, same Sub Head/Material Details, amount ₹15,000. ZO then HO approve just that new row. Confirm `subcontractor_balances.available_balance = 95,000` (₹80,000 + ₹15,000) — matches the PDF's worked example exactly.
7. Attempt a requisition for ₹1,00,000 against this subcontractor (exceeds the ₹95,000 remaining) — confirm it's rejected client-side (red error, no request sent) and, via a direct API call bypassing the UI, confirm the server also rejects with `BUD03`/`BUD04` as appropriate.
8. Confirm a normal (non-Sub-Contractor) requisition/estimate flow is completely unaffected — no new dropdowns appear, no `subcontractor_balances` rows are touched.
9. Confirm two different work orders with the same Sub Head + Material Details values produce two independent balances (create/approve on one, verify the other's balance is untouched).

---

## Open questions for the product owner (not blocking, but confirm before/soon after shipping)

- The PDF's spec sheet uses "Rejected" in its requisition flow diagram, but `requisition_action_enum` only has `('Approve', 'Hold')` today — there is no reject action in this module (confirmed via schema). This guide assumes "Rejected" in the diagram maps to the existing `Hold` action (no ledger effect either way) — flag if an actual reject/cancel-with-reason flow is expected as a separate piece of work.
- Confirm whether an existing subcontractor's `available_balance` should ever be visible/exportable outside the Requisition form (e.g. a dedicated "Subcontractor Ledger" browse page, mirroring the Credit Ledger's `AcctCreditLedger.jsx`) — this guide only covers the advisory balance card on the Requisition form itself, since that's all the spec doc describes; a standalone ledger browsing page was out of scope here but may be a natural follow-up.
