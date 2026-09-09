-- Migration 053: Payment Requisition -> Deferred Accounts Import
--
-- When a ZO approves a Payment Requisition and routes it to Accounts, it no longer
-- automatically creates or attaches to an Open acct_requisition_sheets row.
-- Instead, it is saved directly into the Accounts import queue (Held / Rejected / Pending Review
-- list) with payment_destination = 'ACCOUNTS' and accounts_line_item_id = NULL.
-- Accounts can then manually import it into an Open sheet via "Import Held / Rejected"
-- (import_payment_requisition_to_acct_sheet_transact) whenever they prepare a payment sheet.

-- ============================================================================
-- 1. Additional tracking columns on requisitions
-- ============================================================================
ALTER TABLE "public"."requisitions"
    ADD COLUMN IF NOT EXISTS "accounts_import_dismissed" boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS "accounts_imported_at" timestamptz;

-- ============================================================================
-- 2. Redefine route_requisition_to_accounts_transact:
--    Do NOT create or find a sheet, and do NOT insert into acct_requisition_line_items.
--    Simply record payment_destination = 'ACCOUNTS' with accounts_line_item_id = NULL.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."route_requisition_to_accounts_transact"(
    "p_requisition_id" uuid,
    "p_actor" character varying
) RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_req public.requisitions;
BEGIN
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.requisition_status <> 'Approved' THEN
        RAISE EXCEPTION 'Only Approved requisitions can be sent to Accounts. Current status: %', v_req.requisition_status
            USING ERRCODE = 'STA01';
    END IF;

    IF v_req.payment_destination IS NOT NULL THEN
        RAISE EXCEPTION 'This requisition has already selected a payment route (%).', v_req.payment_destination
            USING ERRCODE = 'RTE01';
    END IF;

    UPDATE public.requisitions
    SET
        payment_destination = 'ACCOUNTS',
        accounts_line_item_id = NULL,
        accounts_sent_at = now(),
        accounts_sent_by = p_actor,
        accounts_import_dismissed = false,
        updated_at = now()
    WHERE requisition_id = p_requisition_id
    RETURNING * INTO v_req;

    RETURN jsonb_build_object(
        'requisition', row_to_json(v_req)
    );
END;
$$;

GRANT ALL ON FUNCTION "public"."route_requisition_to_accounts_transact"(uuid, character varying) TO anon, authenticated, service_role;

-- ============================================================================
-- 3. import_payment_requisition_to_acct_sheet_transact:
--    Called when Accounts imports a queued Payment Requisition into an Open sheet.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."import_payment_requisition_to_acct_sheet_transact"(
    "p_requisition_id" uuid,
    "p_target_sheet_id" uuid,
    "p_imported_by" character varying
) RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_req          public.requisitions;
    v_sheet_status varchar;
    v_sub_title_id uuid;
    v_item         acct_requisition_line_items;
BEGIN
    -- 1. Lock target sheet first (consistent ordering: sheet before requisition)
    SELECT sheet_status INTO v_sheet_status
    FROM acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target sheet not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05';
    END IF;

    -- 2. Lock requisition
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.payment_destination <> 'ACCOUNTS' THEN
        RAISE EXCEPTION 'Only requisitions routed to Accounts can be imported.' USING ERRCODE = 'VAL05';
    END IF;

    IF v_req.accounts_line_item_id IS NOT NULL THEN
        RAISE EXCEPTION 'This requisition has already been imported into an Accounts sheet.' USING ERRCODE = 'STA06';
    END IF;

    IF COALESCE(v_req.accounts_import_dismissed, false) THEN
        RAISE EXCEPTION 'This requisition has been dismissed and cannot be imported.' USING ERRCODE = 'STA07';
    END IF;

    -- 3. Match Account Sub-title
    SELECT id INTO v_sub_title_id
    FROM account_sub_title_master
    WHERE is_active AND UPPER(TRIM(title)) = UPPER(TRIM(v_req.material_main_head))
    LIMIT 1;

    -- 4. Insert into acct_requisition_line_items
    INSERT INTO acct_requisition_line_items (
        sheet_id, source_requisition_id, created_by,
        account_sub_title_id, account_sub_title_text,
        particulars,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_id, beneficiary_bank_name,
        req_amount, work_order_no
    ) VALUES (
        p_target_sheet_id, v_req.requisition_id, p_imported_by,
        v_sub_title_id, v_req.material_main_head,
        NULLIF(TRIM(v_req.expen_head_remarks), ''),
        v_req.beneficiary_ac_no, v_req.beneficiary_name, v_req.beneficiary_ifsc, v_req.beneficiary_bank_id, v_req.beneficiary_bank_name,
        v_req.approved_amount, v_req.work_order_no
    )
    RETURNING * INTO v_item;

    -- 5. Link the newly created line item to the requisition
    UPDATE public.requisitions
    SET
        accounts_line_item_id = v_item.id,
        accounts_imported_at = now(),
        updated_at = now()
    WHERE requisition_id = p_requisition_id
    RETURNING * INTO v_req;

    RETURN jsonb_build_object(
        'requisition', row_to_json(v_req),
        'line_item', row_to_json(v_item)
    );
END;
$$;

GRANT ALL ON FUNCTION "public"."import_payment_requisition_to_acct_sheet_transact"(uuid, uuid, character varying) TO anon, authenticated, service_role;

-- ============================================================================
-- 4. Discarding an empty sheet restores any payment requisitions imported into it
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."delete_empty_acct_sheet_transact"(
    p_sheet_id uuid
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    v_restored_count integer;
    v_restored_req_count integer;
BEGIN
    UPDATE acct_requisition_line_items
    SET imported_to_sheet_id = NULL,
        imported_at = NULL,
        imported_by = NULL,
        updated_at = now()
    WHERE imported_to_sheet_id = p_sheet_id;
    GET DIAGNOSTICS v_restored_count = ROW_COUNT;

    -- Restore any payment requisitions whose imported line items were on this sheet
    UPDATE public.requisitions r
    SET accounts_line_item_id = NULL,
        accounts_imported_at = NULL,
        updated_at = now()
    FROM acct_requisition_line_items li
    WHERE r.accounts_line_item_id = li.id
      AND li.sheet_id = p_sheet_id;
    GET DIAGNOSTICS v_restored_req_count = ROW_COUNT;

    DELETE FROM acct_requisition_sheets WHERE id = p_sheet_id;

    RETURN v_restored_count + v_restored_req_count;
END; $$;
