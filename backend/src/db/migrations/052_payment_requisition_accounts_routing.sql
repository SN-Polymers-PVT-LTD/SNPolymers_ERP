-- Migration 052: Payment Requisition -> ZO Payment / Accounts Routing
--
-- Today ZO approval and payment are the same event: approve_requisition_transact
-- debits zo_balances (the ZO's real cash float) and writes zo_fund_ledger in the
-- same transaction as setting requisition_status = 'Approved'. This migration
-- splits "approved" from "paid": approval now only validates budget capacity.
-- Once Approved, the ZO explicitly picks a payment route:
--   - ZO_BALANCE: select_zo_balance_payment_transact (the old debit logic, on demand)
--   - ACCOUNTS:   route_requisition_to_accounts_transact (creates an Accounts line
--                 item in an Open acct_requisition_sheets row; Accounts fills in
--                 debit account / payment mode / cheque, then the existing HO
--                 Accounts approval pipeline takes over)
--
-- Order matters: columns + backfill happen BEFORE the audit trigger is extended,
-- so the backfill (labeling only, for requisitions already Approved under the old
-- behavior) does not generate synthetic audit_log rows.

-- ============================================================================
-- 1. Routing columns on requisitions
-- ============================================================================
ALTER TABLE "public"."requisitions"
    ADD COLUMN IF NOT EXISTS "payment_destination" varchar,
    ADD COLUMN IF NOT EXISTS "accounts_line_item_id" uuid,
    ADD COLUMN IF NOT EXISTS "accounts_sent_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "accounts_sent_by" varchar;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_requisitions_payment_destination') THEN
        ALTER TABLE "public"."requisitions"
            ADD CONSTRAINT "chk_requisitions_payment_destination"
            CHECK ("payment_destination" IS NULL OR "payment_destination" IN ('ZO_BALANCE', 'ACCOUNTS'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_requisitions_accounts_sent_by') THEN
        ALTER TABLE "public"."requisitions"
            ADD CONSTRAINT "fk_requisitions_accounts_sent_by"
            FOREIGN KEY ("accounts_sent_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;
    END IF;
END $$;

-- ============================================================================
-- 2. Backward-compatible backfill (labeling only - no ledger writes, no debit)
-- ============================================================================
-- Every requisition already Approved was already paid via the old
-- approve_requisition_transact code path (zo_balances already debited
-- historically). Label them ZO_BALANCE so they are never re-offered a route
-- choice and never re-debited or re-routed to Accounts.
UPDATE "public"."requisitions"
SET "payment_destination" = 'ZO_BALANCE'
WHERE "requisition_status" = 'Approved'
  AND "payment_destination" IS NULL;

-- ============================================================================
-- 3. Source linkage on acct_requisition_line_items
-- ============================================================================
ALTER TABLE "public"."acct_requisition_line_items"
    ADD COLUMN IF NOT EXISTS "source_requisition_id" uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arli_source_requisition') THEN
        ALTER TABLE "public"."acct_requisition_line_items"
            ADD CONSTRAINT "fk_arli_source_requisition"
            FOREIGN KEY ("source_requisition_id") REFERENCES "public"."requisitions"("requisition_id") ON DELETE RESTRICT;
    END IF;
END $$;

-- ============================================================================
-- 4. Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS "idx_requisitions_payment_destination"
    ON "public"."requisitions" ("payment_destination");

CREATE INDEX IF NOT EXISTS "idx_arli_source_requisition"
    ON "public"."acct_requisition_line_items" ("source_requisition_id");

-- One Payment Requisition -> at most one Accounts line item. This is the
-- database-level backstop; the primary defense is the FOR UPDATE row lock on
-- requisitions plus the payment_destination IS NULL guard inside
-- route_requisition_to_accounts_transact.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_arli_source_requisition"
    ON "public"."acct_requisition_line_items" ("source_requisition_id")
    WHERE "source_requisition_id" IS NOT NULL;

-- ============================================================================
-- 5. Extend the requisitions audit trigger to cover payment-route transitions
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."audit_requisition_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      COALESCE(NEW.approved_user_id, NEW.cancelled_by, NEW.created_by),
      'STATUS_CHANGE',
      'Requisition',
      NEW.requisition_id::VARCHAR,
      jsonb_build_object('requisition_status', OLD.requisition_status),
      jsonb_build_object('requisition_status', NEW.requisition_status)
    );
  END IF;

  IF NEW.payment_destination IS DISTINCT FROM OLD.payment_destination THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      COALESCE(NEW.accounts_sent_by, NEW.approved_user_id, NEW.created_by),
      CASE NEW.payment_destination
        WHEN 'ACCOUNTS'   THEN 'REQUISITION_SENT_TO_ACCOUNTS'
        WHEN 'ZO_BALANCE' THEN 'REQUISITION_PAID_FROM_ZO_BALANCE'
        ELSE 'PAYMENT_ROUTE_CHANGE'
      END,
      'Requisition',
      NEW.requisition_id::VARCHAR,
      jsonb_build_object('payment_destination', OLD.payment_destination),
      jsonb_build_object(
        'payment_destination', NEW.payment_destination,
        'accounts_line_item_id', NEW.accounts_line_item_id,
        'approved_amount', NEW.approved_amount
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 6. approve_requisition_transact: stop debiting zo_balances at approval time.
--    This CREATE OR REPLACE is based on the 048_subcontractor_ledger_hardening.sql
--    version (the latest prior redefinition) - it preserves the Main Head and
--    Subcontractor Ledger capacity checks/debits (steps 5b/8b there) unchanged,
--    and removes only the ZO Balance lock/check/debit/ledger-insert (old steps
--    6-8). payment_destination stays NULL until the ZO explicitly picks a route.
-- ============================================================================
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

    -- 6-8 (zo_balances lock/check/debit + zo_fund_ledger insert) REMOVED - that
    -- now happens on demand in select_zo_balance_payment_transact, once the ZO
    -- explicitly picks the ZO Balance payment route.

    -- 8b. Debit the Subcontractor Ledger balance + append audit row (unchanged from 048)
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

-- ============================================================================
-- 7. select_zo_balance_payment_transact - the ZO Balance payment route.
--    This carries the exact debit/ledger logic removed from approve above.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."select_zo_balance_payment_transact"(
    "p_requisition_id" uuid,
    "p_actioned_by" character varying
) RETURNS "public"."requisitions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_req     public.requisitions;
    v_balance NUMERIC(18,2);
BEGIN
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.requisition_status <> 'Approved' THEN
        RAISE EXCEPTION 'Only Approved requisitions can select a payment route. Current status: %', v_req.requisition_status
            USING ERRCODE = 'STA01';
    END IF;

    IF v_req.payment_destination IS NOT NULL THEN
        RAISE EXCEPTION 'This requisition has already selected a payment route (%).', v_req.payment_destination
            USING ERRCODE = 'RTE01';
    END IF;

    -- Lock and check ZO Balance row
    SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_req.zo_user_id FOR UPDATE;
    IF NOT FOUND OR v_balance < v_req.approved_amount THEN
        RAISE EXCEPTION 'Insufficient available Zonal Office balance.' USING ERRCODE = 'BAL01';
    END IF;

    -- Deduct ZO balance
    UPDATE public.zo_balances
    SET available_balance = available_balance - v_req.approved_amount, updated_at = now()
    WHERE zo_user_id = v_req.zo_user_id;

    -- Insert ledger entry (negative debit)
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
        -v_req.approved_amount,
        v_req.work_order_no,
        p_actioned_by
    );

    UPDATE public.requisitions
    SET
        payment_destination = 'ZO_BALANCE',
        updated_at = now()
    WHERE requisition_id = p_requisition_id
    RETURNING * INTO v_req;

    RETURN v_req;
END;
$$;

GRANT ALL ON FUNCTION "public"."select_zo_balance_payment_transact"(uuid, character varying) TO anon, authenticated, service_role;

-- ============================================================================
-- 8. route_requisition_to_accounts_transact - the Accounts payment route.
--    Creates an Accounts line item in an Open sheet, prefilled from Finance
--    data. Accounts-owned fields (debit account, payment mode, cheque) are
--    left NULL for Accounts to fill in via the existing line-item edit flow.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."route_requisition_to_accounts_transact"(
    "p_requisition_id" uuid,
    "p_actor" character varying
) RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_req              public.requisitions;
    v_sheet            acct_requisition_sheets;
    v_item             acct_requisition_line_items;
    v_sub_title_id     uuid;
    v_date_str         varchar;
    v_seq              integer;
    v_sheet_no         varchar;
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

    -- Resolve target Open sheet: reuse the most recently created Open sheet,
    -- or create one following create_acct_sheet_transact's date-stamped
    -- numbering convention if none is currently Open.
    SELECT * INTO v_sheet FROM acct_requisition_sheets WHERE sheet_status = 'Open' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
        v_date_str := to_char(CURRENT_DATE, 'DDMMYYYY');
        PERFORM pg_advisory_xact_lock(hashtext('acct_sheet_' || v_date_str));

        SELECT COUNT(*) + 1 INTO v_seq
        FROM acct_requisition_sheets
        WHERE sheet_number LIKE v_date_str || '-%';

        v_sheet_no := v_date_str || '-' || v_seq;

        INSERT INTO acct_requisition_sheets (sheet_number, sheet_status, created_by)
        VALUES (v_sheet_no, 'Open', p_actor)
        RETURNING * INTO v_sheet;
    END IF;

    -- Account Sub-title: free-text always allowed (Accounts already accepts
    -- free-text sub-titles). Only set the master FK on an exact active match.
    SELECT id INTO v_sub_title_id
    FROM account_sub_title_master
    WHERE is_active AND UPPER(TRIM(title)) = UPPER(TRIM(v_req.material_main_head))
    LIMIT 1;

    INSERT INTO acct_requisition_line_items (
        sheet_id, source_requisition_id, created_by,
        account_sub_title_id, account_sub_title_text,
        particulars,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_id, beneficiary_bank_name,
        req_amount, work_order_no
    ) VALUES (
        v_sheet.id, v_req.requisition_id, p_actor,
        v_sub_title_id, v_req.material_main_head,
        NULLIF(TRIM(v_req.expen_head_remarks), ''),
        v_req.beneficiary_ac_no, v_req.beneficiary_name, v_req.beneficiary_ifsc, v_req.beneficiary_bank_id, v_req.beneficiary_bank_name,
        v_req.approved_amount, v_req.work_order_no
    )
    RETURNING * INTO v_item;

    UPDATE public.requisitions
    SET
        payment_destination = 'ACCOUNTS',
        accounts_line_item_id = v_item.id,
        accounts_sent_at = now(),
        accounts_sent_by = p_actor,
        updated_at = now()
    WHERE requisition_id = p_requisition_id
    RETURNING * INTO v_req;

    RETURN jsonb_build_object(
        'requisition', row_to_json(v_req),
        'line_item', row_to_json(v_item),
        'sheet', row_to_json(v_sheet)
    );
END;
$$;

GRANT ALL ON FUNCTION "public"."route_requisition_to_accounts_transact"(uuid, character varying) TO anon, authenticated, service_role;
