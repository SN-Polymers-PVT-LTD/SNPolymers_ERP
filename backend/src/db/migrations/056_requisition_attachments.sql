-- Migration 056: requisition_attachments table + UUID-keyed storage paths
--
-- Requisition PDF uploads previously computed their Supabase Storage path directly
-- from the human-typed, mutable requisition_no field (${requisition_no}.pdf), with no
-- database row tracking the upload until a requisition was actually created. This meant
-- delete-on-cancel could only work by recomputing that same path from requisition_no,
-- and an abandoned upload (tab closed, page navigated away from) had no record anywhere
-- that could ever be swept.
--
-- This migration adds requisition_attachments: a small table that exists from the moment
-- a file is uploaded (status = 'pending', requisition_id NULL) until a requisition claims
-- it (status = 'committed', requisition_id set), done atomically inside
-- create_requisition_secure itself. Existing, already-committed requisitions are entirely
-- unaffected — no backfill, no rewrite of requisition_pdf_url/gst_bill_pdf_url on any
-- existing row; their PDFs keep their old requisition_no-derived paths forever. Only new
-- uploads from this point on get a UUID-based path and a tracked row.

CREATE TYPE "public"."requisition_attachment_status_enum" AS ENUM ('pending', 'committed');

CREATE TABLE IF NOT EXISTS "public"."requisition_attachments" (
    "attachment_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "requisition_id" "uuid" NULL REFERENCES "public"."requisitions"("requisition_id") ON DELETE SET NULL,
    "bucket" character varying NOT NULL,
    "storage_path" "text" NOT NULL,
    "kind" character varying NOT NULL,
    "uploaded_by" character varying NOT NULL,
    "status" "public"."requisition_attachment_status_enum" DEFAULT 'pending'::"public"."requisition_attachment_status_enum" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "committed_at" timestamp with time zone NULL,
    CONSTRAINT "chk_ra_bucket" CHECK (("bucket" IN ('requisition-pdfs', 'gst-bills'))),
    CONSTRAINT "chk_ra_kind" CHECK (("kind" IN ('requisition_pdf', 'gst_bill')))
);

ALTER TABLE "public"."requisition_attachments" OWNER TO "postgres";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_requisition_attachments_bucket_path"
    ON "public"."requisition_attachments" ("bucket", "storage_path");

CREATE INDEX IF NOT EXISTS "idx_requisition_attachments_pending_sweep"
    ON "public"."requisition_attachments" ("status", "created_at")
    WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "idx_requisition_attachments_uploaded_by_status"
    ON "public"."requisition_attachments" ("uploaded_by", "status");

CREATE INDEX IF NOT EXISTS "idx_requisition_attachments_requisition_id"
    ON "public"."requisition_attachments" ("requisition_id");

-- No RLS policies: matches this schema's existing convention (no RLS anywhere in the
-- dump). Access is gated entirely through the backend's service-role Supabase client,
-- same trust model as the requisitions table itself.
GRANT ALL ON TABLE "public"."requisition_attachments" TO "anon", "authenticated", "service_role";

-- Replace create_requisition_secure again (chained off migration 055's 29-arg version):
-- add two trailing attachment-id params. Body is identical except the INSERT is followed
-- by an atomic claim of the pending attachment rows inside the same transaction as the
-- insert itself — no separate, non-transactional step, which is exactly the class of bug
-- migration 055 already fixed for zo_user_id.

DROP FUNCTION IF EXISTS "public"."create_requisition_secure"(
    character varying, character varying, character varying, numeric, character varying,
    character varying, character varying, character varying, text, character varying,
    character varying, text, character varying, numeric, "public"."gst_bill_enum",
    text, text, text, "public"."requisition_status_enum", character varying,
    character varying, character varying, uuid, character varying, character varying,
    character varying, character varying, uuid, character varying
);

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
    "p_zo_user_id" character varying DEFAULT NULL,
    "p_requisition_pdf_attachment_id" uuid DEFAULT NULL,
    "p_gst_bill_pdf_attachment_id" uuid DEFAULT NULL
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
    v_req_attachment       public.requisition_attachments;
    v_gst_attachment       public.requisition_attachments;
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
        SELECT 1 FROM public.requisitions
        WHERE requisition_no = TRIM(p_requisition_no)
          AND requisition_status IS DISTINCT FROM 'Cancelled'::public.requisition_status_enum
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

    -- 8. Lock and validate the pending attachment rows inside this transaction. The
    -- controller performs the same check for a helpful HTTP response, but only this
    -- lock prevents a concurrent request from claiming an attachment after validation
    -- and before the requisition insert.
    IF p_requisition_pdf_attachment_id IS NOT NULL THEN
        SELECT * INTO v_req_attachment
        FROM public.requisition_attachments
        WHERE attachment_id = p_requisition_pdf_attachment_id
          AND kind = 'requisition_pdf'
          AND bucket = 'requisition-pdfs'
          AND status = 'pending'::public.requisition_attachment_status_enum
          AND uploaded_by = p_created_by
        FOR UPDATE;

        IF NOT FOUND OR v_req_attachment.storage_path IS DISTINCT FROM p_requisition_pdf_url THEN
            RAISE EXCEPTION 'Requisition PDF attachment is invalid or no longer pending.' USING ERRCODE = 'ATT01';
        END IF;
    END IF;

    IF p_gst_bill_pdf_attachment_id IS NOT NULL THEN
        SELECT * INTO v_gst_attachment
        FROM public.requisition_attachments
        WHERE attachment_id = p_gst_bill_pdf_attachment_id
          AND kind = 'gst_bill'
          AND bucket = 'gst-bills'
          AND status = 'pending'::public.requisition_attachment_status_enum
          AND uploaded_by = p_created_by
        FOR UPDATE;

        IF NOT FOUND OR v_gst_attachment.storage_path IS DISTINCT FROM p_gst_bill_pdf_url THEN
            RAISE EXCEPTION 'GST bill attachment is invalid or no longer pending.' USING ERRCODE = 'ATT01';
        END IF;
    END IF;

    -- 9. Insert the requisition
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

    -- 10. Atomically claim the pending attachment(s) inside the same transaction as the
    --    insert above. Guarded by status = 'pending' AND uploaded_by = p_created_by so a
    --    stale, already-claimed, or another-user's attachment id can never be claimed here
    --    (the controller independently validates this before calling the RPC too — this is
    --    defense in depth at the transaction boundary, not the only check).
    IF p_requisition_pdf_attachment_id IS NOT NULL THEN
        UPDATE public.requisition_attachments
        SET requisition_id = v_inserted.requisition_id,
            status = 'committed'::public.requisition_attachment_status_enum,
            committed_at = now()
        WHERE attachment_id = p_requisition_pdf_attachment_id
          AND status = 'pending'::public.requisition_attachment_status_enum;
    END IF;

    IF p_gst_bill_pdf_attachment_id IS NOT NULL THEN
        UPDATE public.requisition_attachments
        SET requisition_id = v_inserted.requisition_id,
            status = 'committed'::public.requisition_attachment_status_enum,
            committed_at = now()
        WHERE attachment_id = p_gst_bill_pdf_attachment_id
          AND status = 'pending'::public.requisition_attachment_status_enum;
    END IF;

    RETURN v_inserted;
END;
$$;

GRANT ALL ON FUNCTION "public"."create_requisition_secure"(
    character varying, character varying, character varying, numeric, character varying,
    character varying, character varying, character varying, text, character varying,
    character varying, text, character varying, numeric, "public"."gst_bill_enum",
    text, text, text, "public"."requisition_status_enum", character varying,
    character varying, character varying, uuid, character varying, character varying,
    character varying, character varying, uuid, character varying, uuid, uuid
) TO anon, authenticated, service_role;
