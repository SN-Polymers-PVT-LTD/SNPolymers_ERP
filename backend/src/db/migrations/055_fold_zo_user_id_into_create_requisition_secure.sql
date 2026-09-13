-- Migration 055: Fold zo_user_id into create_requisition_secure
--
-- createRequisition (backend/src/controllers/requisitions.controller.js) has always
-- resolved zo_user_id from je_zo_mappings BEFORE calling create_requisition_secure,
-- then set it via a SEPARATE, non-transactional UPDATE after the RPC returns. That
-- second statement sits outside the RPC's atomic insert/lock/budget-check transaction,
-- so if it (or any other post-RPC step) fails, the requisition row is already
-- committed but the failure path used to treat the whole request as failed — including
-- deleting the just-committed row's uploaded PDFs (fixed as a stopgap with a
-- rowCommitted guard in the controller; this migration removes the underlying
-- two-statement design that made that stopgap necessary in the first place).
--
-- zo_user_id is already known before the RPC call, so it can just be inserted in the
-- same statement as everything else. This is a pure fold: no other column, check, or
-- business rule in create_requisition_secure changes.

-- 1. Drop the current authoritative 28-arg overload (from 051_converge_beneficiary_bank_id.sql)
DROP FUNCTION IF EXISTS "public"."create_requisition_secure"(
    character varying, character varying, character varying, numeric, character varying,
    character varying, character varying, character varying, text, character varying,
    character varying, text, character varying, numeric, "public"."gst_bill_enum",
    text, text, text, "public"."requisition_status_enum", character varying,
    character varying, character varying, uuid, character varying, character varying,
    character varying, character varying, uuid
);

-- 2. Create the 29-arg version: identical body, with p_zo_user_id added as a trailing
--    optional param and inserted alongside the other columns.
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
    "p_beneficiary_bank_id" uuid DEFAULT NULL,
    "p_zo_user_id" character varying DEFAULT NULL
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

    -- 8. Insert the requisition (zo_user_id now set here, atomically, instead of via a
    --    separate post-RPC UPDATE in the controller)
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
        beneficiary_bank_id,
        zo_user_id
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
        p_beneficiary_bank_id,
        p_zo_user_id
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
    character varying, character varying, uuid, character varying
) TO anon, authenticated, service_role;
