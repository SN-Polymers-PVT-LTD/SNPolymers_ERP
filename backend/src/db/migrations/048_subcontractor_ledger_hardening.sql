-- Migration 048: Subcontractor Ledger Hardening & Historical Backfill
--
-- Addresses GAP-01 through GAP-05:
-- 1. Adds UNIQUE constraint (transaction_type, reference_type, reference_id) on subcontractor_ledger.
-- 2. Enforces coupled taxonomy constraint chk_scl_transaction_taxonomy.
-- 3. Adds accounting identity CHECK (available_balance = estimated_total - paid_total) on subcontractor_balances.
-- 4. Normalizes whitespace across legacy data (TRIM).
-- 5. Performs idempotent historical backfill from Final Approved estimates and Approved requisitions.
-- 6. Updates submit_row_approvals with strict estimate stage assertion, ZO approval prerequisite, and atomic rollback.
-- 7. Updates submit_ho_review with deterministic item-level compensating reversals upon terminal rejection (Rejected by HO).
-- 8. Updates create_requisition_secure with Model A lifecycle pause (EST02) and 4-field TRIM normalization.
-- 9. Updates approve_requisition_transact with 4-field TRIM normalization.

-- ----------------------------------------------------------------------------
-- 1. subcontractor_ledger: Clean existing duplicates if any, then add UNIQUE constraint
-- ----------------------------------------------------------------------------
DELETE FROM "public"."subcontractor_ledger" a USING "public"."subcontractor_ledger" b
WHERE a.ledger_id < b.ledger_id
  AND a.transaction_type = b.transaction_type
  AND a.reference_type = b.reference_type
  AND a.reference_id = b.reference_id;

ALTER TABLE "public"."subcontractor_ledger"
    DROP CONSTRAINT IF EXISTS "uq_scl_tx_ref";

ALTER TABLE "public"."subcontractor_ledger"
    ADD CONSTRAINT "uq_scl_tx_ref" UNIQUE (transaction_type, reference_type, reference_id);

-- ----------------------------------------------------------------------------
-- 2. subcontractor_ledger: Coupled taxonomy constraint
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."subcontractor_ledger"
    DROP CONSTRAINT IF EXISTS "chk_scl_transaction_type",
    DROP CONSTRAINT IF EXISTS "chk_scl_reference_type",
    DROP CONSTRAINT IF EXISTS "chk_scl_transaction_taxonomy";

ALTER TABLE "public"."subcontractor_ledger"
    ADD CONSTRAINT "chk_scl_transaction_taxonomy" CHECK (
        (transaction_type = 'ESTIMATE_ITEM_APPROVAL' AND reference_type = 'ESTIMATE_ITEM' AND amount > 0) OR
        (transaction_type = 'ESTIMATE_ITEM_REVERSAL' AND reference_type = 'ESTIMATE_ITEM' AND amount < 0) OR
        (transaction_type = 'REQUISITION_APPROVAL'    AND reference_type = 'REQUISITION'   AND amount < 0)
    );

-- ----------------------------------------------------------------------------
-- 3. Legacy Whitespace Normalization
-- ----------------------------------------------------------------------------
UPDATE public.project_cost_estimate_items
SET material_main_head = TRIM(material_main_head),
    material_sub_head  = TRIM(material_sub_head),
    material_details   = TRIM(material_details)
WHERE material_main_head IS NOT NULL;

UPDATE public.requisitions
SET work_order_no      = TRIM(work_order_no),
    material_main_head = TRIM(material_main_head),
    material_sub_head  = TRIM(material_sub_head),
    material_details   = TRIM(material_details)
WHERE work_order_no IS NOT NULL;

UPDATE public.subcontractor_balances
SET work_order_no      = TRIM(work_order_no),
    material_main_head = TRIM(material_main_head),
    material_sub_head  = TRIM(material_sub_head),
    material_details   = TRIM(material_details);

UPDATE public.subcontractor_ledger
SET work_order_no      = TRIM(work_order_no),
    material_main_head = TRIM(material_main_head),
    material_sub_head  = TRIM(material_sub_head),
    material_details   = TRIM(material_details);

-- ----------------------------------------------------------------------------
-- 4. GAP-01: Authoritative Historical Backfill (Ledger Events -> Balances Reconciled)
-- ----------------------------------------------------------------------------
-- 4a. Initialize subcontractor_balances rows for all Final Approved estimate items
INSERT INTO public.subcontractor_balances (
    work_order_no, material_main_head, material_sub_head, material_details,
    estimated_total, paid_total, available_balance, updated_at
)
SELECT DISTINCT
    TRIM(e.work_order_no), 'Sub Contractor', TRIM(i.material_sub_head), TRIM(i.material_details),
    0, 0, 0, now()
FROM public.project_cost_estimate_items i
JOIN public.project_cost_estimates e ON e.estimate_id = i.estimate_id
WHERE e.estimate_status = 'Final Approved'
  AND TRIM(i.material_main_head) = 'Sub Contractor'
  AND i.zo_office_approve = 'Approve'
  AND i.ho_office_approve = 'Approve'
  AND i.material_sub_head IS NOT NULL
  AND i.material_details IS NOT NULL
ON CONFLICT (work_order_no, material_main_head, material_sub_head, material_details) DO NOTHING;

-- 4b. Backfill historical ESTIMATE_ITEM_APPROVAL into subcontractor_ledger
INSERT INTO public.subcontractor_ledger (
    work_order_no, material_main_head, material_sub_head, material_details,
    transaction_type, reference_type, reference_id, amount, created_at, created_by
)
SELECT
    TRIM(e.work_order_no), 'Sub Contractor', TRIM(i.material_sub_head), TRIM(i.material_details),
    'ESTIMATE_ITEM_APPROVAL', 'ESTIMATE_ITEM', i.item_id, i.amount,
    COALESCE(e.ho_approval_date, e.created_at, now()), COALESCE(e.ho_approved_by, 'MIGRATION_048')
FROM public.project_cost_estimate_items i
JOIN public.project_cost_estimates e ON e.estimate_id = i.estimate_id
WHERE e.estimate_status = 'Final Approved'
  AND TRIM(i.material_main_head) = 'Sub Contractor'
  AND i.zo_office_approve = 'Approve'
  AND i.ho_office_approve = 'Approve'
  AND i.material_sub_head IS NOT NULL
  AND i.material_details IS NOT NULL
ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;

-- 4c. Backfill historical REQUISITION_APPROVAL into subcontractor_ledger (only where balance row exists)
INSERT INTO public.subcontractor_ledger (
    work_order_no, material_main_head, material_sub_head, material_details,
    transaction_type, reference_type, reference_id, amount, created_at, created_by
)
SELECT
    TRIM(r.work_order_no), 'Sub Contractor', TRIM(r.material_sub_head), TRIM(r.material_details),
    'REQUISITION_APPROVAL', 'REQUISITION', r.requisition_id, -ABS(r.approved_amount),
    COALESCE(r.payment_date, r.created_at, now()), COALESCE(r.approved_user_id, 'MIGRATION_048')
FROM public.requisitions r
WHERE r.requisition_status = 'Approved'
  AND TRIM(r.material_main_head) = 'Sub Contractor'
  AND r.material_sub_head IS NOT NULL
  AND r.material_details IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM public.subcontractor_balances b
      WHERE b.work_order_no = TRIM(r.work_order_no)
        AND b.material_main_head = 'Sub Contractor'
        AND b.material_sub_head = TRIM(r.material_sub_head)
        AND b.material_details = TRIM(r.material_details)
  )
ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;

-- 4d. Authoritative Recomputation of subcontractor_balances from subcontractor_ledger
INSERT INTO public.subcontractor_balances (
    work_order_no, material_main_head, material_sub_head, material_details,
    estimated_total, paid_total, available_balance, updated_at
)
SELECT
    l.work_order_no, 'Sub Contractor', l.material_sub_head, l.material_details,
    COALESCE(SUM(CASE WHEN l.transaction_type = 'ESTIMATE_ITEM_APPROVAL' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN l.transaction_type = 'REQUISITION_APPROVAL' THEN -l.amount ELSE 0 END), 0),
    COALESCE(SUM(l.amount), 0),
    now()
FROM public.subcontractor_ledger l
GROUP BY l.work_order_no, l.material_sub_head, l.material_details
ON CONFLICT (work_order_no, material_main_head, material_sub_head, material_details) DO UPDATE
SET estimated_total   = EXCLUDED.estimated_total,
    paid_total        = EXCLUDED.paid_total,
    available_balance = EXCLUDED.available_balance,
    updated_at        = now();

-- ----------------------------------------------------------------------------
-- 5. subcontractor_balances: Add accounting identity CHECK constraint
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."subcontractor_balances"
    DROP CONSTRAINT IF EXISTS "chk_scb_accounting_identity";

ALTER TABLE "public"."subcontractor_balances"
    ADD CONSTRAINT "chk_scb_accounting_identity" CHECK (available_balance = estimated_total - paid_total);

-- ----------------------------------------------------------------------------
-- 6. submit_row_approvals: DB Invariant Guards + 4-Field TRIM Normalization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."submit_row_approvals"(
    "p_estimate_id" "uuid",
    "p_approvals" "jsonb",
    "p_stage" "text",
    "p_modified_by" character varying
) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_role       VARCHAR;
  approval          JSONB;
  v_item_id         UUID;
  v_approve_status  TEXT;
  v_remarks         TEXT;
  v_status          estimate_status_enum;
  v_new_amount      NUMERIC(18,2);
  v_rows            INT;
  v_work_order_no   VARCHAR;
  v_item            project_cost_estimate_items;
  v_prev_ho_approve row_approval_enum;
  v_clean_sub_head  VARCHAR;
  v_clean_details   VARCHAR;
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

  -- 2. Read current estimate status and lock header
  SELECT estimate_status, TRIM(work_order_no) INTO v_status, v_work_order_no
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found: %', p_estimate_id;
  END IF;

  -- Stage assertion against estimate_status (GAP-03)
  IF p_stage = 'ZO' AND v_status NOT IN ('Under ZO Review'::estimate_status_enum, 'ZO Revision Requested'::estimate_status_enum) THEN
    RAISE EXCEPTION 'ZO row approvals can only be submitted when estimate is Under ZO Review. Current status: %', v_status;
  END IF;

  IF p_stage = 'HO' AND v_status NOT IN ('Under HO Review'::estimate_status_enum, 'HO Revision Requested'::estimate_status_enum) THEN
    RAISE EXCEPTION 'HO row approvals can only be submitted when estimate is Under HO Review. Current status: %', v_status;
  END IF;

  -- 3. Apply each row approval
  FOR approval IN SELECT * FROM jsonb_array_elements(p_approvals)
  LOOP
    v_item_id        := (approval->>'item_id')::UUID;
    v_approve_status := approval->>'approve_status';
    v_remarks        := approval->>'remarks';

    -- Pre-fetch item
    SELECT * INTO v_item
    FROM project_cost_estimate_items
    WHERE item_id = v_item_id AND estimate_id = p_estimate_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item ID % not found or does not belong to estimate %.', v_item_id, p_estimate_id;
    END IF;

    v_prev_ho_approve := v_item.ho_office_approve;

    IF p_stage = 'ZO' THEN
      UPDATE project_cost_estimate_items
      SET
        zo_office_approve = v_approve_status::row_approval_enum,
        zo_remarks        = v_remarks,
        updated_at        = now()
      WHERE item_id = v_item_id
        AND estimate_id = p_estimate_id;

    ELSIF p_stage = 'HO' THEN
      -- Strict invariant check: HO cannot approve an item unless ZO approved it (GAP-03)
      IF v_approve_status = 'Approve' AND v_item.zo_office_approve IS DISTINCT FROM 'Approve'::row_approval_enum THEN
        RAISE EXCEPTION 'Item % cannot be approved by HO because ZO approval is missing or rejected (zo_status: %).',
          v_item_id, v_item.zo_office_approve;
      END IF;

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

    -- Subcontractor Ledger credit (gated on HO approval of Sub Contractor item)
    IF p_stage = 'HO' AND v_approve_status = 'Approve' AND v_prev_ho_approve IS DISTINCT FROM 'Approve'::row_approval_enum THEN
      IF TRIM(v_item.material_main_head) = 'Sub Contractor' AND v_item.zo_office_approve = 'Approve' THEN
        v_clean_sub_head := TRIM(v_item.material_sub_head);
        v_clean_details  := TRIM(v_item.material_details);

        INSERT INTO subcontractor_balances (work_order_no, material_main_head, material_sub_head, material_details, estimated_total, available_balance)
        VALUES (v_work_order_no, 'Sub Contractor', v_clean_sub_head, v_clean_details, v_item.amount, v_item.amount)
        ON CONFLICT (work_order_no, material_main_head, material_sub_head, material_details) DO UPDATE
        SET estimated_total   = subcontractor_balances.estimated_total + v_item.amount,
            available_balance = subcontractor_balances.available_balance + v_item.amount,
            updated_at        = now();

        INSERT INTO subcontractor_ledger (work_order_no, material_main_head, material_sub_head, material_details, transaction_type, reference_type, reference_id, amount, created_by)
        VALUES (v_work_order_no, 'Sub Contractor', v_clean_sub_head, v_clean_details, 'ESTIMATE_ITEM_APPROVAL', 'ESTIMATE_ITEM', v_item_id, v_item.amount, p_modified_by)
        ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  -- 4. Recalculate amount based on current status
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
-- 7. submit_ho_review: Terminal Rejection Compensating Reversals (GAP-02)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."submit_ho_review"(
    "p_estimate_id" "uuid",
    "p_reviewer" character varying,
    "p_remarks" "text"
) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_status              estimate_status_enum;
  v_user_role           VARCHAR;
  v_item_count          INT;
  v_undecided_count     INT;
  v_rejected_count      INT;
  v_target_status       estimate_status_enum;
  v_new_amount          NUMERIC(18,2);
  v_inconsistent_count  INT;
  v_rev_item            RECORD;
BEGIN
  -- 1. Security Check: Confirm reviewer exists, is active, and is HO or Admin
  SELECT role INTO v_user_role
  FROM authorised_users
  WHERE mobile_number = p_reviewer AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.';
  END IF;

  IF v_user_role NOT IN ('ho', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have HO or Admin role.';
  END IF;

  -- 2. Lock header and validate existence
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;

  -- 3. Acquire exclusive row-level locks on estimate items
  PERFORM 1
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  -- 4. Defensive Check: Prevent submission if estimate contains zero line items
  SELECT COUNT(*) INTO v_item_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Estimate contains no line items.';
  END IF;

  -- 5. Enforce status is Under HO Review
  IF v_status <> 'Under HO Review'::estimate_status_enum THEN
    RAISE EXCEPTION 'Expected Under HO Review, found %', v_status;
  END IF;

  -- 6. Validate all items decided by HO
  SELECT COUNT(*) INTO v_undecided_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND ho_office_approve IS NULL;

  IF v_undecided_count > 0 THEN
    RAISE EXCEPTION 'All rows must be decided. Found % undecided rows.', v_undecided_count;
  END IF;

  -- 7. Determine if any item was rejected by HO
  SELECT COUNT(*) INTO v_rejected_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND ho_office_approve = 'Not Approve';

  IF v_rejected_count > 0 THEN
    v_target_status := 'Rejected by HO'::estimate_status_enum;

    -- GAP-02: Deterministic item-level compensating reversal for any Sub Contractor items
    -- that were credited during row-approval on this estimate.
    FOR v_rev_item IN
        SELECT i.item_id, TRIM(e.work_order_no) AS work_order_no, 
               TRIM(i.material_sub_head) AS material_sub_head, 
               TRIM(i.material_details) AS material_details, i.amount
        FROM project_cost_estimate_items i
        JOIN project_cost_estimates e ON e.estimate_id = i.estimate_id
        WHERE i.estimate_id = p_estimate_id
          AND TRIM(i.material_main_head) = 'Sub Contractor'
          AND EXISTS (
              SELECT 1 FROM subcontractor_ledger l
              WHERE l.transaction_type = 'ESTIMATE_ITEM_APPROVAL'
                AND l.reference_type = 'ESTIMATE_ITEM'
                AND l.reference_id = i.item_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM subcontractor_ledger l
              WHERE l.transaction_type = 'ESTIMATE_ITEM_REVERSAL'
                AND l.reference_type = 'ESTIMATE_ITEM'
                AND l.reference_id = i.item_id
          )
    LOOP
        INSERT INTO subcontractor_ledger (
            work_order_no, material_main_head, material_sub_head, material_details,
            transaction_type, reference_type, reference_id, amount, created_by
        ) VALUES (
            v_rev_item.work_order_no, 'Sub Contractor', v_rev_item.material_sub_head, v_rev_item.material_details,
            'ESTIMATE_ITEM_REVERSAL', 'ESTIMATE_ITEM', v_rev_item.item_id, -v_rev_item.amount, p_reviewer
        );

        UPDATE subcontractor_balances
        SET estimated_total   = estimated_total - v_rev_item.amount,
            available_balance = available_balance - v_rev_item.amount,
            updated_at        = now()
        WHERE work_order_no = v_rev_item.work_order_no
          AND material_main_head = 'Sub Contractor'
          AND material_sub_head = v_rev_item.material_sub_head
          AND material_details = v_rev_item.material_details;
    END LOOP;

    -- Rejected is terminal; sum all items for record-keeping
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;

  ELSE
    v_target_status := 'Final Approved'::estimate_status_enum;

    -- Defensive Check: Verify all HO approved items were also ZO approved
    SELECT COUNT(*) INTO v_inconsistent_count
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND ho_office_approve = 'Approve'
      AND (zo_office_approve IS NULL OR zo_office_approve <> 'Approve');

    IF v_inconsistent_count > 0 THEN
      RAISE EXCEPTION 'Inconsistent review state: found % items approved by HO that were not approved by ZO.', v_inconsistent_count;
    END IF;

    -- Final Approved: sum items where both ZO and HO approved
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve'
      AND ho_office_approve = 'Approve';
  END IF;

  -- 8. Update header
  UPDATE project_cost_estimates
  SET estimate_status = v_target_status,
      estimate_amount = v_new_amount,
      ho_approved_by = p_reviewer,
      ho_approval_date = now(),
      ho_remarks = p_remarks,
      last_modified_by = p_reviewer,
      updated_at = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;

-- ----------------------------------------------------------------------------
-- 8. create_requisition_secure: Model A Reopen Pause (EST02) + 4-Field Normalization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."create_requisition_secure"(
    "p_requester_user_id" character varying,
    "p_work_order_no" character varying,
    "p_estimate_no" character varying,
    "p_estimate_amount" numeric,
    "p_state" character varying,
    "p_district" character varying,
    "p_area_code" character varying,
    "p_department" character varying,
    "p_site_details" "text",
    "p_requisition_no" character varying,
    "p_material_main_head" character varying,
    "p_requisition_pdf_url" "text",
    "p_original_filename" character varying,
    "p_requisition_amount" numeric,
    "p_gst_bill" "public"."gst_bill_enum",
    "p_gst_bill_pdf_url" "text",
    "p_bank_details" "text",
    "p_expen_head_remarks" "text",
    "p_requisition_status" "public"."requisition_status_enum",
    "p_created_by" character varying,
    "p_material_sub_head" character varying DEFAULT NULL,
    "p_material_details" character varying DEFAULT NULL
) RETURNS "public"."requisitions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_project_status       public.project_status;
    v_estimate_id          UUID;
    v_estimate_status      public.estimate_status_enum;
    v_main_head_estimate   numeric(18,2) := 0.00;
    v_cumulative_approved  numeric(18,2) := 0.00;
    v_remaining_capacity   numeric(18,2) := 0.00;
    v_sc_available         numeric(18,2) := 0.00;
    v_inserted             public.requisitions;
    v_clean_wo             VARCHAR;
    v_clean_main_head      VARCHAR;
    v_clean_sub_head       VARCHAR;
    v_clean_details        VARCHAR;
BEGIN
    -- 4-Field TRIM Normalization (GAP-05)
    v_clean_wo        := TRIM(p_work_order_no);
    v_clean_main_head := TRIM(p_material_main_head);
    v_clean_sub_head  := TRIM(p_material_sub_head);
    v_clean_details   := TRIM(p_material_details);

    -- 1. Lock the corresponding project row for update to serialize concurrent requisition insertions
    SELECT status INTO v_project_status
    FROM public.projects_master
    WHERE work_order_no = v_clean_wo
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % not found.', v_clean_wo USING ERRCODE = 'P0002';
    END IF;

    -- 2. Verify project is not closed
    IF v_project_status = 'Closed'::public.project_status THEN
        RAISE EXCEPTION 'Cannot create requisitions for projects with "Closed" status. All linked reports are immutable.' USING ERRCODE = 'PR001';
    END IF;

    -- 3. Re-verify uniqueness of requisition_no
    IF EXISTS (
        SELECT 1 FROM public.requisitions WHERE requisition_no = TRIM(p_requisition_no)
    ) THEN
        RAISE EXCEPTION 'A requisition with number % already exists.', TRIM(p_requisition_no) USING ERRCODE = '23505';
    END IF;

    -- 4. Find the latest cost estimate and check Model A Lifecycle status (GAP-04)
    SELECT estimate_id, estimate_status INTO v_estimate_id, v_estimate_status
    FROM public.project_cost_estimates
    WHERE work_order_no = v_clean_wo
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No cost estimate found for Work Order %.', v_clean_wo USING ERRCODE = 'EST01';
    END IF;

    IF v_estimate_status IN ('Estimate Reopened'::public.estimate_status_enum,
                             'Under ZO Review'::public.estimate_status_enum,
                             'Under HO Review'::public.estimate_status_enum,
                             'ZO Revision Requested'::public.estimate_status_enum,
                             'HO Revision Requested'::public.estimate_status_enum) THEN
        RAISE EXCEPTION 'Work Order % is currently undergoing estimate revision (%). Requisition creation is paused until revision is Final Approved.',
            v_clean_wo, v_estimate_status USING ERRCODE = 'EST02';
    ELSIF v_estimate_status <> 'Final Approved'::public.estimate_status_enum THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for Work Order %. Current status: %',
            v_clean_wo, v_estimate_status USING ERRCODE = 'EST01';
    END IF;

    -- 5. Calculate Main Head Cost Estimate Amount
    SELECT COALESCE(SUM(amount), 0.00) INTO v_main_head_estimate
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_estimate_id
      AND TRIM(material_main_head) = v_clean_main_head;

    -- 6. Sum Cumulative ZO-Approved Requisitions for this main head
    SELECT COALESCE(SUM(approved_amount), 0.00) INTO v_cumulative_approved
    FROM public.requisitions
    WHERE work_order_no = v_clean_wo
      AND TRIM(material_main_head) = v_clean_main_head
      AND requisition_status = 'Approved'::public.requisition_status_enum;

    -- 7. Validate budget capacity
    v_remaining_capacity := v_main_head_estimate - v_cumulative_approved;
    IF p_requisition_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Requisition amount exceeds the remaining Main Head capacity (Capacity: %, Requested: %).',
            v_remaining_capacity, p_requisition_amount
            USING ERRCODE = 'BUD01';
    END IF;

    -- 7b. Validate Subcontractor Ledger capacity (independent of Main Head)
    IF v_clean_main_head = 'Sub Contractor' THEN
        IF v_clean_sub_head IS NULL OR v_clean_details IS NULL OR v_clean_sub_head = '' OR v_clean_details = '' THEN
            RAISE EXCEPTION 'material_sub_head and material_details are required for a Sub Contractor requisition.' USING ERRCODE = 'VAL01';
        END IF;

        SELECT available_balance INTO v_sc_available
        FROM subcontractor_balances
        WHERE work_order_no = v_clean_wo
          AND material_main_head = 'Sub Contractor'
          AND material_sub_head = v_clean_sub_head
          AND material_details = v_clean_details
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
        v_clean_wo,
        p_estimate_no,
        p_estimate_amount,
        p_state,
        p_district,
        p_area_code,
        p_department,
        p_site_details,
        TRIM(p_requisition_no),
        v_clean_main_head,
        v_clean_sub_head,
        v_clean_details,
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
-- 9. approve_requisition_transact: 4-Field Normalization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."approve_requisition_transact"(
    "p_requisition_id" "uuid",
    "p_approved_amount" numeric,
    "p_actioned_by" character varying,
    "p_remarks_approved_authority" "text"
) RETURNS "public"."requisitions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_req             public.requisitions;
    v_balance         NUMERIC(18,2);
    v_estimate_id     UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
    v_sc_available    numeric(18,2) := 0.00;
    v_clean_wo        VARCHAR;
    v_clean_main_head VARCHAR;
    v_clean_sub_head  VARCHAR;
    v_clean_details   VARCHAR;
BEGIN
    -- 1. Lock and fetch Requisition Row
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.requisition_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Requisition status must be Pending or Hold.' USING ERRCODE = 'STA01';
    END IF;

    v_clean_wo        := TRIM(v_req.work_order_no);
    v_clean_main_head := TRIM(v_req.material_main_head);
    v_clean_sub_head  := TRIM(v_req.material_sub_head);
    v_clean_details   := TRIM(v_req.material_details);

    -- 2. Find estimate ID of the latest Final Approved cost estimate
    SELECT estimate_id INTO v_estimate_id
    FROM public.project_cost_estimates
    WHERE work_order_no = v_clean_wo
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
      AND TRIM(material_main_head) = v_clean_main_head;

    -- 4. Calculate cumulative approved amount (excluding current requisition)
    SELECT COALESCE(SUM(approved_amount), 0.00) INTO v_cumulative_approved
    FROM public.requisitions
    WHERE work_order_no = v_clean_wo
      AND TRIM(material_main_head) = v_clean_main_head
      AND requisition_status = 'Approved'::public.requisition_status_enum
      AND requisition_id <> p_requisition_id;

    -- 5. Validate against Main Head Capacity
    v_remaining_capacity := v_main_head_estimate - v_cumulative_approved;
    IF p_approved_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Approved amount exceeds the remaining Main Head capacity (Capacity: %, Attempted: %).',
            v_remaining_capacity, p_approved_amount
            USING ERRCODE = 'BUD02';
    END IF;

    -- 5b. Validate + lock Subcontractor Ledger balance (independent of Main Head)
    IF v_clean_main_head = 'Sub Contractor' THEN
        SELECT available_balance INTO v_sc_available
        FROM subcontractor_balances
        WHERE work_order_no = v_clean_wo
          AND material_main_head = 'Sub Contractor'
          AND material_sub_head = v_clean_sub_head
          AND material_details = v_clean_details
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
        v_clean_wo,
        p_actioned_by
    );

    -- 8b. Debit the Subcontractor Ledger balance + append audit row
    IF v_clean_main_head = 'Sub Contractor' THEN
        UPDATE subcontractor_balances
        SET paid_total        = paid_total + p_approved_amount,
            available_balance = available_balance - p_approved_amount,
            updated_at        = now()
        WHERE work_order_no = v_clean_wo
          AND material_main_head = 'Sub Contractor'
          AND material_sub_head = v_clean_sub_head
          AND material_details = v_clean_details;

        INSERT INTO subcontractor_ledger (
            work_order_no, material_main_head, material_sub_head, material_details,
            transaction_type, reference_type, reference_id, amount, created_by
        ) VALUES (
            v_clean_wo, 'Sub Contractor', v_clean_sub_head, v_clean_details,
            'REQUISITION_APPROVAL', 'REQUISITION', p_requisition_id,
            -p_approved_amount, p_actioned_by
        )
        ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;
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
