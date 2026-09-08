-- Migration 051: Converge Beneficiary Banking to Canonical Bank ID (Relational Convergence)
--
-- 1. Phase A: Idempotently seed canonical Indian banks into indian_bank_master
--    attributed strictly to an existing admin user (matching 026 convention).
-- 2. Phase B: Add beneficiary_bank_id uuid column to beneficiary_master,
--    projects_beneficiary_master, acct_requisition_line_items, and requisitions.
--    Also add B-tree indexes for all four tables.
-- 3. Phase C: Backfill beneficiary_bank_id matching on bank_name (case/whitespace-insensitive).
--    Run loud assertion failing migration if any unmatched non-null legacy bank names exist.
-- 4. Phase D: Add foreign key constraints referencing indian_bank_master(id) ON DELETE SET NULL.
-- 5. Phase E: Cleanly drop all previous overloads of create_requisition_secure (20, 22, 27 args)
--    and recreate with 28 args (including p_beneficiary_bank_id uuid DEFAULT NULL).
--    Update add_acct_line_item_transact, resubmit_acct_line_item_transact (with clearable semantics),
--    import_line_item_transact, import_credit_installment_transact, and approve_credit_purchase_transact.

-- ============================================================================
-- Phase A: Seed Canonical Indian Banks (Admin Attribution Only)
-- ============================================================================
DO $$
DECLARE
  v_seed_user varchar;
BEGIN
  SELECT mobile_number INTO v_seed_user FROM authorised_users WHERE role ILIKE 'admin' LIMIT 1;

  IF v_seed_user IS NOT NULL THEN
    INSERT INTO "public"."indian_bank_master" (bank_name, is_active, created_by) VALUES
      ('State Bank of India', true, v_seed_user),
      ('Punjab National Bank', true, v_seed_user),
      ('Bank of Baroda', true, v_seed_user),
      ('Canara Bank', true, v_seed_user),
      ('Union Bank of India', true, v_seed_user),
      ('Indian Bank', true, v_seed_user),
      ('Bank of India', true, v_seed_user),
      ('Central Bank of India', true, v_seed_user),
      ('Indian Overseas Bank', true, v_seed_user),
      ('UCO Bank', true, v_seed_user),
      ('Bank of Maharashtra', true, v_seed_user),
      ('Punjab & Sind Bank', true, v_seed_user),
      ('HDFC Bank', true, v_seed_user),
      ('ICICI Bank', true, v_seed_user),
      ('Axis Bank', true, v_seed_user),
      ('Kotak Mahindra Bank', true, v_seed_user),
      ('IndusInd Bank', true, v_seed_user),
      ('Yes Bank', true, v_seed_user),
      ('IDFC FIRST Bank', true, v_seed_user),
      ('Federal Bank', true, v_seed_user),
      ('South Indian Bank', true, v_seed_user),
      ('Karnataka Bank', true, v_seed_user),
      ('Karur Vysya Bank', true, v_seed_user),
      ('City Union Bank', true, v_seed_user),
      ('Tamilnad Mercantile Bank', true, v_seed_user),
      ('DCB Bank', true, v_seed_user),
      ('RBL Bank', true, v_seed_user),
      ('CSB Bank', true, v_seed_user),
      ('Bandhan Bank', true, v_seed_user),
      ('Jammu & Kashmir Bank', true, v_seed_user),
      ('Nainital Bank', true, v_seed_user)
    ON CONFLICT (bank_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'Canonical bank seeding skipped: no admin user found in authorised_users.';
  END IF;
END $$;

-- ============================================================================
-- Phase B: Add Columns & Indexes
-- ============================================================================
ALTER TABLE "public"."beneficiary_master"
    ADD COLUMN IF NOT EXISTS "beneficiary_bank_id" uuid,
    ALTER COLUMN "beneficiary_bank_name" DROP NOT NULL;

ALTER TABLE "public"."projects_beneficiary_master"
    ADD COLUMN IF NOT EXISTS "beneficiary_bank_id" uuid;

ALTER TABLE "public"."acct_requisition_line_items"
    ADD COLUMN IF NOT EXISTS "beneficiary_bank_id" uuid;

ALTER TABLE "public"."requisitions"
    ADD COLUMN IF NOT EXISTS "beneficiary_bank_id" uuid;

CREATE INDEX IF NOT EXISTS "idx_bm_beneficiary_bank_id"
    ON "public"."beneficiary_master"("beneficiary_bank_id");

CREATE INDEX IF NOT EXISTS "idx_pbm_beneficiary_bank_id"
    ON "public"."projects_beneficiary_master"("beneficiary_bank_id");

CREATE INDEX IF NOT EXISTS "idx_arli_beneficiary_bank_id"
    ON "public"."acct_requisition_line_items"("beneficiary_bank_id");

CREATE INDEX IF NOT EXISTS "idx_req_beneficiary_bank_id"
    ON "public"."requisitions"("beneficiary_bank_id");

-- ============================================================================
-- Phase C: Data-Safe Backfill & Loud Assertion
-- ============================================================================
UPDATE "public"."beneficiary_master" bm
SET "beneficiary_bank_id" = ibm.id
FROM "public"."indian_bank_master" ibm
WHERE bm."beneficiary_bank_name" IS NOT NULL
  AND bm."beneficiary_bank_id" IS NULL
  AND UPPER(TRIM(bm."beneficiary_bank_name")) = UPPER(TRIM(ibm."bank_name"));

UPDATE "public"."projects_beneficiary_master" pbm
SET "beneficiary_bank_id" = ibm.id
FROM "public"."indian_bank_master" ibm
WHERE pbm."beneficiary_bank_name" IS NOT NULL
  AND pbm."beneficiary_bank_id" IS NULL
  AND UPPER(TRIM(pbm."beneficiary_bank_name")) = UPPER(TRIM(ibm."bank_name"));

UPDATE "public"."acct_requisition_line_items" arli
SET "beneficiary_bank_id" = ibm.id
FROM "public"."indian_bank_master" ibm
WHERE arli."beneficiary_bank_name" IS NOT NULL
  AND arli."beneficiary_bank_id" IS NULL
  AND UPPER(TRIM(arli."beneficiary_bank_name")) = UPPER(TRIM(ibm."bank_name"));

UPDATE "public"."requisitions" req
SET "beneficiary_bank_id" = ibm.id
FROM "public"."indian_bank_master" ibm
WHERE req."beneficiary_bank_name" IS NOT NULL
  AND req."beneficiary_bank_id" IS NULL
  AND UPPER(TRIM(req."beneficiary_bank_name")) = UPPER(TRIM(ibm."bank_name"));

DO $$
DECLARE
  v_unmatched_bm   int;
  v_unmatched_pbm  int;
  v_unmatched_arli int;
  v_unmatched_req  int;
BEGIN
  SELECT COUNT(*) INTO v_unmatched_bm FROM "public"."beneficiary_master"
  WHERE "beneficiary_bank_name" IS NOT NULL AND TRIM("beneficiary_bank_name") <> '' AND "beneficiary_bank_id" IS NULL;

  SELECT COUNT(*) INTO v_unmatched_pbm FROM "public"."projects_beneficiary_master"
  WHERE "beneficiary_bank_name" IS NOT NULL AND TRIM("beneficiary_bank_name") <> '' AND "beneficiary_bank_id" IS NULL;

  SELECT COUNT(*) INTO v_unmatched_arli FROM "public"."acct_requisition_line_items"
  WHERE "beneficiary_bank_name" IS NOT NULL AND TRIM("beneficiary_bank_name") <> '' AND "beneficiary_bank_id" IS NULL;

  SELECT COUNT(*) INTO v_unmatched_req FROM "public"."requisitions"
  WHERE "beneficiary_bank_name" IS NOT NULL AND TRIM("beneficiary_bank_name") <> '' AND "beneficiary_bank_id" IS NULL;

  IF (v_unmatched_bm > 0 OR v_unmatched_pbm > 0 OR v_unmatched_arli > 0 OR v_unmatched_req > 0) THEN
    RAISE EXCEPTION 'Migration 051 failed: Unmatched legacy beneficiary bank names found with no corresponding record in indian_bank_master (bm: %, pbm: %, arli: %, req: %).',
      v_unmatched_bm, v_unmatched_pbm, v_unmatched_arli, v_unmatched_req;
  END IF;
END $$;

-- ============================================================================
-- Phase D: Foreign Key Constraints (ON DELETE SET NULL, default update)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bm_beneficiary_bank_id') THEN
    ALTER TABLE "public"."beneficiary_master"
      ADD CONSTRAINT "fk_bm_beneficiary_bank_id"
      FOREIGN KEY ("beneficiary_bank_id") REFERENCES "public"."indian_bank_master"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pbm_beneficiary_bank_id') THEN
    ALTER TABLE "public"."projects_beneficiary_master"
      ADD CONSTRAINT "fk_pbm_beneficiary_bank_id"
      FOREIGN KEY ("beneficiary_bank_id") REFERENCES "public"."indian_bank_master"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arli_beneficiary_bank_id') THEN
    ALTER TABLE "public"."acct_requisition_line_items"
      ADD CONSTRAINT "fk_arli_beneficiary_bank_id"
      FOREIGN KEY ("beneficiary_bank_id") REFERENCES "public"."indian_bank_master"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_req_beneficiary_bank_id') THEN
    ALTER TABLE "public"."requisitions"
      ADD CONSTRAINT "fk_req_beneficiary_bank_id"
      FOREIGN KEY ("beneficiary_bank_id") REFERENCES "public"."indian_bank_master"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- Phase E: RPC Cleanups & Updates
-- ============================================================================

-- 1. Cleanly drop all previous overloads of create_requisition_secure
-- 1a. Original 20-arg signature (from 00_full_schema_dump.sql)
DROP FUNCTION IF EXISTS "public"."create_requisition_secure"(
    character varying, character varying, character varying, numeric, character varying,
    character varying, character varying, character varying, text, character varying,
    character varying, text, character varying, numeric, "public"."gst_bill_enum",
    text, text, text, "public"."requisition_status_enum", character varying
);

-- 1b. 22-arg signature (from 047_subcontractor_ledger.sql / 048_subcontractor_ledger_hardening.sql)
DROP FUNCTION IF EXISTS "public"."create_requisition_secure"(
    character varying, character varying, character varying, numeric, character varying,
    character varying, character varying, character varying, text, character varying,
    character varying, text, character varying, numeric, "public"."gst_bill_enum",
    text, text, text, "public"."requisition_status_enum", character varying,
    character varying, character varying
);

-- 1c. 27-arg signature (from 050_create_projects_beneficiary_master.sql)
DROP FUNCTION IF EXISTS "public"."create_requisition_secure"(
    character varying, character varying, character varying, numeric, character varying,
    character varying, character varying, character varying, text, character varying,
    character varying, text, character varying, numeric, "public"."gst_bill_enum",
    text, text, text, "public"."requisition_status_enum", character varying,
    character varying, character varying, uuid, character varying, character varying,
    character varying, character varying
);

-- 2. Create authoritative 28-arg create_requisition_secure
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
    "p_material_details" character varying DEFAULT NULL,
    "p_beneficiary_id" uuid DEFAULT NULL,
    "p_beneficiary_name" character varying DEFAULT NULL,
    "p_beneficiary_ac_no" character varying DEFAULT NULL,
    "p_beneficiary_ifsc" character varying DEFAULT NULL,
    "p_beneficiary_bank_name" character varying DEFAULT NULL,
    "p_beneficiary_bank_id" uuid DEFAULT NULL
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
        created_by,
        beneficiary_id,
        beneficiary_name,
        beneficiary_ac_no,
        beneficiary_ifsc,
        beneficiary_bank_name,
        beneficiary_bank_id
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
        p_created_by,
        p_beneficiary_id,
        NULLIF(TRIM(p_beneficiary_name), ''),
        NULLIF(TRIM(p_beneficiary_ac_no), ''),
        NULLIF(TRIM(p_beneficiary_ifsc), ''),
        NULLIF(TRIM(p_beneficiary_bank_name), ''),
        p_beneficiary_bank_id
    )
    RETURNING * INTO v_inserted;

    RETURN v_inserted;
END;
$$;

GRANT ALL ON FUNCTION "public"."create_requisition_secure"(
    character varying, character varying, character varying, numeric, character varying,
    character varying, character varying, character varying, text, character varying,
    character varying, text, character varying, numeric, "public"."gst_bill_enum",
    text, text, text, "public"."requisition_status_enum", character varying,
    character varying, character varying, uuid, character varying, character varying,
    character varying, character varying, uuid
) TO anon, authenticated, service_role;

-- 3. Update add_acct_line_item_transact
CREATE OR REPLACE FUNCTION "public"."add_acct_line_item_transact"(
    p_sheet_id   uuid,
    p_created_by varchar,
    p_item       jsonb
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_sheet_status varchar;
    v_item         acct_requisition_line_items;
BEGIN
    SELECT sheet_status INTO v_sheet_status
    FROM acct_requisition_sheets WHERE id = p_sheet_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found.'; END IF;
    IF v_sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Line items can only be added while the sheet is Open.' USING ERRCODE = 'STA01';
    END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by,
        account_sub_title_id, account_sub_title_text, particulars, particulars_id,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name,
        beneficiary_bank_id,
        debit_bank_ac_type, req_amount, payment_mode, cheque_no, cheque_date,
        work_order_no, remarks
    )
    SELECT
        p_sheet_id, p_created_by,
        (p_item->>'account_sub_title_id')::uuid, p_item->>'account_sub_title_text',
        p_item->>'particulars', (p_item->>'particulars_id')::uuid,
        p_item->>'beneficiary_ac_no', p_item->>'beneficiary_name',
        p_item->>'beneficiary_ifsc', p_item->>'beneficiary_bank_name',
        NULLIF(p_item->>'beneficiary_bank_id', '')::uuid,
        p_item->>'debit_bank_ac_type', (p_item->>'req_amount')::numeric,
        p_item->>'payment_mode', p_item->>'cheque_no', p_item->>'cheque_date',
        p_item->>'work_order_no', p_item->>'remarks'
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

-- 4. Update resubmit_acct_line_item_transact (15 arguments, clearable bank & beneficiary)
DROP FUNCTION IF EXISTS "public"."resubmit_acct_line_item_transact"(
    uuid, varchar, uuid, varchar, text, varchar, varchar, varchar, varchar,
    varchar, numeric, varchar, varchar, varchar
);

CREATE OR REPLACE FUNCTION "public"."resubmit_acct_line_item_transact"(
    p_line_item_id uuid,
    p_resubmitted_by varchar,
    p_account_sub_title_id   uuid DEFAULT NULL,
    p_account_sub_title_text varchar DEFAULT NULL,
    p_particulars            text DEFAULT NULL,
    p_beneficiary_ac_no      varchar DEFAULT NULL,
    p_beneficiary_name       varchar DEFAULT NULL,
    p_beneficiary_ifsc       varchar DEFAULT NULL,
    p_beneficiary_bank_name  varchar DEFAULT NULL,
    p_debit_bank_ac_type     varchar DEFAULT NULL,
    p_req_amount             numeric DEFAULT NULL,
    p_payment_mode           varchar DEFAULT NULL,
    p_cheque_no              varchar DEFAULT NULL,
    p_cheque_date            varchar DEFAULT NULL,
    p_beneficiary_bank_id    uuid DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item acct_requisition_line_items;
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Returned for Correction' THEN
        RAISE EXCEPTION 'Only Returned for Correction items can be resubmitted. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA03';
    END IF;

    IF p_req_amount IS NULL OR p_payment_mode IS NULL OR
       (p_payment_mode = 'Cheque' AND (p_cheque_no IS NULL OR p_cheque_date IS NULL)) THEN
        RAISE EXCEPTION 'req_amount and payment_mode (plus cheque fields if Cheque) are required to resubmit.'
            USING ERRCODE = 'VAL02';
    END IF;

    UPDATE acct_requisition_line_items
    SET
        requisition_status   = 'Pending HO Review',
        revision_number      = v_item.revision_number + 1,

        last_ho_process      = v_item.ho_process,
        last_ho_remarks      = v_item.ho_remarks,
        last_ho_actioned_by  = v_item.ho_actioned_by,
        last_ho_actioned_at  = v_item.ho_actioned_at,

        ho_process           = NULL,
        ho_actioned_by       = NULL,
        ho_actioned_at       = NULL,
        ho_pass_amount       = NULL,
        ho_remarks           = NULL,

        account_sub_title_id   = COALESCE(p_account_sub_title_id, account_sub_title_id),
        account_sub_title_text = COALESCE(p_account_sub_title_text, account_sub_title_text),
        particulars            = COALESCE(p_particulars, particulars),

        -- Explicit assignment allows full clearability for optional beneficiary banking data
        beneficiary_ac_no      = p_beneficiary_ac_no,
        beneficiary_name       = p_beneficiary_name,
        beneficiary_ifsc       = p_beneficiary_ifsc,
        beneficiary_bank_name  = p_beneficiary_bank_name,
        beneficiary_bank_id    = p_beneficiary_bank_id,

        debit_bank_ac_type     = COALESCE(p_debit_bank_ac_type, debit_bank_ac_type),
        req_amount             = COALESCE(p_req_amount, req_amount),
        payment_mode           = COALESCE(p_payment_mode, payment_mode),
        cheque_no              = p_cheque_no,
        cheque_date            = p_cheque_date,
        updated_at             = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

-- 5. Update import_line_item_transact (copy beneficiary_bank_id)
CREATE OR REPLACE FUNCTION "public"."import_line_item_transact"(
    p_source_item_id  uuid,
    p_target_sheet_id uuid,
    p_imported_by     varchar
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_source   acct_requisition_line_items;
    v_target   acct_requisition_sheets;
    v_new_item acct_requisition_line_items;
BEGIN
    SELECT * INTO v_target FROM acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.'; END IF;
    IF v_target.sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA01';
    END IF;

    SELECT * INTO v_source FROM acct_requisition_line_items WHERE id = p_source_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source line item not found.'; END IF;

    IF v_source.requisition_status NOT IN ('On Hold', 'Rejected', 'Pending Review') THEN
        RAISE EXCEPTION 'Only On Hold, Rejected, or Pending Review items can be imported. Current: %',
            v_source.requisition_status USING ERRCODE = 'STA04';
    END IF;

    IF v_source.imported_to_sheet_id IS NOT NULL THEN
        RAISE EXCEPTION 'This line item has already been imported into another sheet.' USING ERRCODE = 'STA05';
    END IF;

    IF v_source.sheet_id = p_target_sheet_id THEN
        RAISE EXCEPTION 'Cannot import an item into the same sheet it belongs to.' USING ERRCODE = 'STA06';
    END IF;

    IF v_source.import_dismissed THEN
        RAISE EXCEPTION 'This line item has been dismissed and cannot be imported.' USING ERRCODE = 'STA07';
    END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by, imported_from_item_id,
        account_sub_title_id, account_sub_title_text, particulars, particulars_id,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name,
        beneficiary_bank_id,
        debit_bank_ac_type, req_amount, payment_mode, cheque_no, cheque_date
    ) VALUES (
        p_target_sheet_id, p_imported_by, v_source.id,
        v_source.account_sub_title_id, v_source.account_sub_title_text,
        v_source.particulars, v_source.particulars_id,
        v_source.beneficiary_ac_no, v_source.beneficiary_name,
        v_source.beneficiary_ifsc, v_source.beneficiary_bank_name,
        v_source.beneficiary_bank_id,
        v_source.debit_bank_ac_type, v_source.req_amount, v_source.payment_mode,
        v_source.cheque_no, v_source.cheque_date
    ) RETURNING * INTO v_new_item;

    UPDATE acct_requisition_line_items
    SET imported_to_sheet_id = p_target_sheet_id,
        imported_at = now(),
        imported_by = p_imported_by,
        updated_at = now()
    WHERE id = p_source_item_id;

    RETURN v_new_item;
END; $$;

-- 6. Update import_credit_installment_transact (copy beneficiary_bank_id)
CREATE OR REPLACE FUNCTION "public"."import_credit_installment_transact"(
    p_ledger_id       uuid,
    p_target_sheet_id uuid,
    p_imported_by     varchar
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_ledger      credit_ledger;
    v_beneficiary beneficiary_master;
    v_source      acct_requisition_line_items;
    v_target      acct_requisition_sheets;
    v_new_item    acct_requisition_line_items;
BEGIN
    SELECT * INTO v_target FROM acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.'; END IF;
    IF v_target.sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA01';
    END IF;

    SELECT * INTO v_ledger FROM credit_ledger WHERE id = p_ledger_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Credit ledger row not found.'; END IF;

    IF v_ledger.outstanding_balance <= 0 THEN
        RAISE EXCEPTION 'This credit purchase is fully settled.' USING ERRCODE = 'LED01';
    END IF;

    IF EXISTS (
        SELECT 1 FROM acct_requisition_line_items
        WHERE credit_ledger_id = p_ledger_id
          AND requisition_status IN ('Pending HO Review', 'HO Approved', 'Partially Approved', 'Payment Processed')
    ) THEN
        RAISE EXCEPTION 'An active installment for this purchase already exists in another sheet.' USING ERRCODE = 'LED02';
    END IF;

    SELECT * INTO v_beneficiary FROM beneficiary_master WHERE id = v_ledger.beneficiary_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dealer record not found.'; END IF;

    SELECT * INTO v_source FROM acct_requisition_line_items WHERE id = v_ledger.source_line_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source purchase line item not found.'; END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by, credit_ledger_id,
        particulars, particulars_id, account_sub_title_id, account_sub_title_text,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name,
        beneficiary_bank_id
    ) VALUES (
        p_target_sheet_id, p_imported_by, p_ledger_id,
        v_source.particulars, v_source.particulars_id, v_source.account_sub_title_id, v_source.account_sub_title_text,
        v_beneficiary.account_number, v_beneficiary.beneficiary_name,
        v_beneficiary.ifsc, v_beneficiary.beneficiary_bank_name,
        v_beneficiary.beneficiary_bank_id
    ) RETURNING * INTO v_new_item;

    RETURN v_new_item;
END; $$;

-- 7. Update approve_credit_purchase_transact (set beneficiary_bank_id on auto-registration)
CREATE OR REPLACE FUNCTION "public"."approve_credit_purchase_transact"(
    p_line_item_id  uuid,
    p_actioned_by   varchar,
    p_ho_remarks    text DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item           acct_requisition_line_items;
    v_beneficiary_id uuid;
    v_ledger_id      uuid;
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Pending HO Review' THEN
        RAISE EXCEPTION 'Only Pending HO Review items can be approved. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA02';
    END IF;

    IF v_item.debit_bank_ac_type <> 'Credit' THEN
        RAISE EXCEPTION 'Credit Approved is only valid for line items with Debit Bank Type = Credit.' USING ERRCODE = 'VAL06';
    END IF;

    IF v_item.beneficiary_ac_no IS NULL OR v_item.beneficiary_ifsc IS NULL
       OR v_item.beneficiary_name IS NULL THEN
        RAISE EXCEPTION 'Beneficiary (dealer) details are required before Credit Approved.' USING ERRCODE = 'VAL07';
    END IF;

    INSERT INTO beneficiary_master (
        account_number, ifsc, beneficiary_name, beneficiary_bank_name, beneficiary_bank_id,
        is_credit_dealer, last_used_at, created_by, updated_by
    )
    VALUES (
        v_item.beneficiary_ac_no, v_item.beneficiary_ifsc, v_item.beneficiary_name,
        v_item.beneficiary_bank_name, v_item.beneficiary_bank_id,
        true, now(), p_actioned_by, p_actioned_by
    )
    ON CONFLICT (account_number, ifsc) DO UPDATE
        SET is_credit_dealer = true,
            beneficiary_bank_id = COALESCE(EXCLUDED.beneficiary_bank_id, beneficiary_master.beneficiary_bank_id),
            beneficiary_bank_name = COALESCE(EXCLUDED.beneficiary_bank_name, beneficiary_master.beneficiary_bank_name),
            last_used_at = now(), updated_by = p_actioned_by, updated_at = now()
    RETURNING id INTO v_beneficiary_id;

    UPDATE acct_requisition_line_items
    SET requisition_status = 'Credit Approved',
        ho_process          = 'Credit Approved',
        ho_pass_amount      = v_item.req_amount,
        ho_remarks          = p_ho_remarks,
        ho_actioned_by      = p_actioned_by,
        ho_actioned_at      = now(),
        updated_at          = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    INSERT INTO credit_ledger (
        source_line_item_id,
        purchase_date,
        beneficiary_id,
        particulars,
        total_credit_amount,
        outstanding_balance,
        created_by,
        updated_by
    ) VALUES (
        v_item.id,
        CURRENT_DATE,
        v_beneficiary_id,
        v_item.particulars,
        v_item.req_amount,
        v_item.req_amount,
        p_actioned_by,
        p_actioned_by
    ) RETURNING id INTO v_ledger_id;

    UPDATE acct_requisition_line_items
    SET credit_ledger_id = v_ledger_id
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;
