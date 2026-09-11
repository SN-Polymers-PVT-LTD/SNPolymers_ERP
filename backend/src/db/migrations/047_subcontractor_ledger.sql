-- Migration 047: The Subcontractor Ledger
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

-- ----------------------------------------------------------------------------
-- 4. submit_row_approvals — credit the Subcontractor Ledger the moment an
--    item's HO approval lands (with ZO already approved), when the item is
--    against a Sub Contractor. This is the point of no return: HO approval
--    permanently locks the row (see the "Final approved rows are locked"
--    guard in estimates.items.controller.js's submitRowApprovals), and
--    gating here — rather than on the parent estimate reaching Final
--    Approved — is what makes reopen top-ups work for free: reopenEstimate
--    never mutates existing item rows, it only permits new-row inserts,
--    and each new row goes through its own ZO->HO cycle and hits this same
--    hook. No reopen-specific ledger logic is required anywhere.
-- ----------------------------------------------------------------------------
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
  -- Subcontractor Ledger credit bookkeeping.
  v_work_order_no  VARCHAR;
  v_item           project_cost_estimate_items;
  v_prev_ho_approve row_approval_enum;
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

  -- Work order for this estimate — same for every item in the loop below.
  SELECT work_order_no INTO v_work_order_no
  FROM project_cost_estimates WHERE estimate_id = p_estimate_id;

  -- 3. Apply each row approval
  FOR approval IN SELECT * FROM jsonb_array_elements(p_approvals)
  LOOP
    v_item_id        := (approval->>'item_id')::UUID;
    v_approve_status := approval->>'approve_status';
    v_remarks        := approval->>'remarks';

    -- Capture the pre-update HO decision so the Subcontractor Ledger credit
    -- below can tell "this item just became Approved" apart from "this item
    -- was already Approved and got resubmitted unchanged" — e.g. a reopen's
    -- resubmit-all-rows batch resending an already-approved row alongside a
    -- genuinely new one. Without this, every resubmission of an
    -- already-Approved item would credit the ledger again.
    IF p_stage = 'HO' THEN
      SELECT ho_office_approve INTO v_prev_ho_approve
      FROM project_cost_estimate_items
      WHERE item_id = v_item_id AND estimate_id = p_estimate_id;
    END IF;

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

    -- Subcontractor Ledger credit. Only at the HO stage (the point of no
    -- return — this row is now permanently locked), only when it just
    -- became fully approved (zo AND ho both 'Approve'), only for
    -- Sub Contractor rows, and only on the actual transition into HO-Approve
    -- (v_prev_ho_approve wasn't already 'Approve') — idempotent against
    -- resubmitting an already-approved row.
    IF p_stage = 'HO' AND v_approve_status = 'Approve' AND v_prev_ho_approve IS DISTINCT FROM 'Approve'::row_approval_enum THEN
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

-- ----------------------------------------------------------------------------
-- 5. create_requisition_secure — two new trailing params (default NULL, so
--    the one existing positional call site keeps working until updated),
--    plus a Subcontractor Ledger capacity check independent of the existing
--    Main Head check (BUD01), only when material_main_head = 'Sub Contractor'.
--
--    Adding parameters changes the function's signature, so CREATE OR
--    REPLACE alone would leave the old 20-arg overload in place alongside
--    the new 22-arg one — PostgREST can then no longer pick a candidate for
--    any call it can't disambiguate (e.g. the two new params omitted
--    entirely) and every call fails with PGRST203. Drop the old signature
--    first so only the new one exists.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS "public"."create_requisition_secure"(
    character varying, character varying, character varying, numeric, character varying, character varying,
    character varying, character varying, "text", character varying, character varying, "text", character varying,
    numeric, "public"."gst_bill_enum", "text", "text", "text", "public"."requisition_status_enum", character varying
);

CREATE OR REPLACE FUNCTION "public"."create_requisition_secure"(
    "p_requester_user_id" character varying, "p_work_order_no" character varying, "p_estimate_no" character varying,
    "p_estimate_amount" numeric, "p_state" character varying, "p_district" character varying, "p_area_code" character varying,
    "p_department" character varying, "p_site_details" "text", "p_requisition_no" character varying,
    "p_material_main_head" character varying, "p_requisition_pdf_url" "text", "p_original_filename" character varying,
    "p_requisition_amount" numeric, "p_gst_bill" "public"."gst_bill_enum", "p_gst_bill_pdf_url" "text",
    "p_bank_details" "text", "p_expen_head_remarks" "text", "p_requisition_status" "public"."requisition_status_enum",
    "p_created_by" character varying,
    "p_material_sub_head" character varying DEFAULT NULL,
    "p_material_details" character varying DEFAULT NULL
) RETURNS "public"."requisitions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_project_status public.project_status;
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
    v_sc_available numeric(18,2) := 0.00;
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

    -- 7b. Validate Subcontractor Ledger capacity (independent of Main Head).
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
        material_sub_head,
        material_details,
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
        p_material_sub_head,
        p_material_details,
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

-- ----------------------------------------------------------------------------
-- 6. approve_requisition_transact — Subcontractor Ledger capacity check
--    (BUD04) inserted before the ZO balance lock (cheapest/most specific
--    check first), and the debit + audit-row insert after the existing
--    zo_fund_ledger insert.
-- ----------------------------------------------------------------------------
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
    v_sc_available numeric(18,2) := 0.00;
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

    -- 5b. Validate + lock Subcontractor Ledger balance (independent of Main Head).
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

    -- 8b. Debit the Subcontractor Ledger balance + append audit row.
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
