-- Migration 050: projects_beneficiary_master table, indexes, and requisitions beneficiary columns
--
-- Distinct from Accounts department's beneficiary_master, this table provides
-- a dedicated, reusable directory of vendor/subcontractor payees specifically
-- for Project Payment Requisitions (JE / Site Requisitions).
--
-- Includes:
-- 1. Table projects_beneficiary_master (account_number, ifsc, name, bank_name, last_used_at)
-- 2. Performance indexes: prefix B-tree index on beneficiary_ac_no and trigram search indexes
-- 3. Extension of requisitions table with nullable beneficiary_id FK + snapshot columns
-- 4. Updated create_requisition_secure RPC accepting optional beneficiary params

-- ----------------------------------------------------------------------------
-- 1. Create projects_beneficiary_master
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."projects_beneficiary_master" (
    "id"                    uuid        DEFAULT gen_random_uuid() NOT NULL,
    "beneficiary_name"      varchar     NOT NULL,
    "beneficiary_ac_no"     varchar     NOT NULL,
    "beneficiary_ifsc"      varchar     NOT NULL,
    "beneficiary_bank_name" varchar,
    "last_used_at"          timestamptz DEFAULT now(),
    "created_by"            varchar     NOT NULL,
    "created_at"            timestamptz DEFAULT now() NOT NULL,
    "updated_by"            varchar,
    "updated_at"            timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "projects_beneficiary_master_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_projects_beneficiary_acno_ifsc" UNIQUE ("beneficiary_ac_no", "beneficiary_ifsc"),
    CONSTRAINT "fk_pbm_created_by" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT,
    CONSTRAINT "fk_pbm_updated_by" FOREIGN KEY ("updated_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT
);

-- Row Level Security
ALTER TABLE "public"."projects_beneficiary_master" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'projects_beneficiary_master' AND policyname = 'Allow authenticated read projects_beneficiary_master'
    ) THEN
        CREATE POLICY "Allow authenticated read projects_beneficiary_master"
            ON "public"."projects_beneficiary_master"
            FOR SELECT
            TO authenticated, anon, service_role
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'projects_beneficiary_master' AND policyname = 'Allow authenticated insert projects_beneficiary_master'
    ) THEN
        CREATE POLICY "Allow authenticated insert projects_beneficiary_master"
            ON "public"."projects_beneficiary_master"
            FOR INSERT
            TO authenticated, service_role
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'projects_beneficiary_master' AND policyname = 'Allow authenticated update projects_beneficiary_master'
    ) THEN
        CREATE POLICY "Allow authenticated update projects_beneficiary_master"
            ON "public"."projects_beneficiary_master"
            FOR UPDATE
            TO authenticated, service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

GRANT ALL ON TABLE "public"."projects_beneficiary_master" TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Indexes for fast live typeahead and searching
-- ----------------------------------------------------------------------------
-- Prefix pattern matching on A/C number for live typeahead keystrokes
CREATE INDEX IF NOT EXISTS "idx_projects_beneficiary_acno_prefix"
    ON "public"."projects_beneficiary_master" ("beneficiary_ac_no" varchar_pattern_ops);

-- Trigram indexing for fuzzy/substring search
CREATE INDEX IF NOT EXISTS "idx_pbm_name_trgm"
    ON "public"."projects_beneficiary_master" USING gin ("beneficiary_name" extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_pbm_acno_trgm"
    ON "public"."projects_beneficiary_master" USING gin ("beneficiary_ac_no" extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 3. Extend requisitions table (all nullable - zero backfill required)
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."requisitions"
    ADD COLUMN IF NOT EXISTS "beneficiary_id" uuid REFERENCES "public"."projects_beneficiary_master"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "beneficiary_name" varchar,
    ADD COLUMN IF NOT EXISTS "beneficiary_ac_no" varchar,
    ADD COLUMN IF NOT EXISTS "beneficiary_ifsc" varchar,
    ADD COLUMN IF NOT EXISTS "beneficiary_bank_name" varchar;

-- ----------------------------------------------------------------------------
-- 4. Update create_requisition_secure RPC
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
    "p_material_details" character varying DEFAULT NULL,
    "p_beneficiary_id" uuid DEFAULT NULL,
    "p_beneficiary_name" character varying DEFAULT NULL,
    "p_beneficiary_ac_no" character varying DEFAULT NULL,
    "p_beneficiary_ifsc" character varying DEFAULT NULL,
    "p_beneficiary_bank_name" character varying DEFAULT NULL
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
        beneficiary_bank_name
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
        NULLIF(TRIM(p_beneficiary_bank_name), '')
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
    character varying, character varying
) TO anon, authenticated, service_role;
