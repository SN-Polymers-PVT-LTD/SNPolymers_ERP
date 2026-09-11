-- Migration 057: Fund Requests -> Accounts Sheet Integration & ZO Balance Credit
--
-- Harmonizes Fund Requests (fund_requests) with the Accounts Requisition Sheets
-- pipeline (acct_requisition_sheets / acct_requisition_line_items).
--
-- 1. When a ZO submits a Fund Request, it is available in the Accounts Import List
--    (accounts_line_item_id IS NULL, accounts_import_dismissed = false).
-- 2. Accounts can import it into an Open sheet via import_fund_request_to_acct_sheet_transact.
-- 3. When Head Office approves the sheet line item (approve_acct_line_item_transact):
--    - The bank balance is debited from bank_balance_master (as normal).
--    - The ZO's balance (zo_balances) is credited with the approved amount.
--    - An ALLOCATION transaction is written to zo_fund_ledger.
--    - The fund_requests record is marked Approved.
-- 4. If HO holds or rejects the line item, fund_requests is updated accordingly.
-- 5. If an empty draft sheet is discarded, any imported fund request has its
--    accounts_line_item_id restored to NULL so it can be re-imported.

-- ============================================================================
-- 1. Tracking columns on fund_requests
-- ============================================================================
ALTER TABLE "public"."fund_requests"
    ADD COLUMN IF NOT EXISTS "accounts_line_item_id" uuid,
    ADD COLUMN IF NOT EXISTS "accounts_imported_at" timestamptz,
    ADD COLUMN IF NOT EXISTS "accounts_import_dismissed" boolean DEFAULT false;

-- Allow varchar for transfer_from_account so real bank names from bank_balance_master can be stored
DO $$
BEGIN
    ALTER TABLE "public"."fund_requests" ALTER COLUMN "transfer_from_account" TYPE varchar;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fr_accounts_line_item_id') THEN
        ALTER TABLE "public"."fund_requests"
            ADD CONSTRAINT "fk_fr_accounts_line_item_id"
            FOREIGN KEY ("accounts_line_item_id") REFERENCES "public"."acct_requisition_line_items"("id") ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_fr_accounts_line_item_id"
    ON "public"."fund_requests" ("accounts_line_item_id");

-- ============================================================================
-- 2. Source linkage on acct_requisition_line_items
-- ============================================================================
ALTER TABLE "public"."acct_requisition_line_items"
    ADD COLUMN IF NOT EXISTS "source_fund_request_id" uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arli_source_fund_request') THEN
        ALTER TABLE "public"."acct_requisition_line_items"
            ADD CONSTRAINT "fk_arli_source_fund_request"
            FOREIGN KEY ("source_fund_request_id") REFERENCES "public"."fund_requests"("fund_request_id") ON DELETE RESTRICT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_arli_source_fund_request"
    ON "public"."acct_requisition_line_items" ("source_fund_request_id")
    WHERE "source_fund_request_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_arli_source_fund_request"
    ON "public"."acct_requisition_line_items" ("source_fund_request_id");

-- ============================================================================
-- 3. import_fund_request_to_acct_sheet_transact
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."import_fund_request_to_acct_sheet_transact"(
    "p_fund_request_id" uuid,
    "p_target_sheet_id" uuid,
    "p_imported_by" character varying
) RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_fr           public.fund_requests;
    v_sheet_status varchar;
    v_sub_title_id uuid;
    v_item         acct_requisition_line_items;
    v_particulars  varchar;
BEGIN
    -- 1. Lock target sheet first (sheet before fund_request for deadlock avoidance)
    SELECT sheet_status INTO v_sheet_status
    FROM acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target sheet not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05';
    END IF;

    -- 2. Lock fund_request
    SELECT * INTO v_fr FROM public.fund_requests WHERE fund_request_id = p_fund_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fund request not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_fr.request_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Only Pending or Hold fund requests can be imported. Current status: %', v_fr.request_status
            USING ERRCODE = 'STA01';
    END IF;

    IF v_fr.accounts_line_item_id IS NOT NULL THEN
        RAISE EXCEPTION 'This fund request has already been imported into an Accounts sheet.' USING ERRCODE = 'STA06';
    END IF;

    IF COALESCE(v_fr.accounts_import_dismissed, false) THEN
        RAISE EXCEPTION 'This fund request has been dismissed and cannot be imported.' USING ERRCODE = 'STA07';
    END IF;

    -- 3. Match Account Sub-title (check if "Fund Request" exists in account_sub_title_master)
    SELECT id INTO v_sub_title_id
    FROM account_sub_title_master
    WHERE is_active AND UPPER(TRIM(title)) = 'FUND REQUEST'
    LIMIT 1;

    v_particulars := COALESCE(NULLIF(TRIM(v_fr.zo_remarks), ''), 'Fund Request ' || v_fr.zo_fr_no);

    -- 4. Insert into acct_requisition_line_items
    INSERT INTO acct_requisition_line_items (
        sheet_id, source_fund_request_id, created_by,
        account_sub_title_id, account_sub_title_text,
        particulars,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_id, beneficiary_bank_name,
        req_amount, work_order_no
    ) VALUES (
        p_target_sheet_id, v_fr.fund_request_id, p_imported_by,
        v_sub_title_id, 'Fund Request',
        v_particulars,
        v_fr.beneficiary_ac_no, v_fr.beneficiary_name, v_fr.beneficiary_ifsc, v_fr.beneficiary_bank_id, v_fr.beneficiary_bank_name,
        v_fr.zo_fr_amount, v_fr.work_order_no
    )
    RETURNING * INTO v_item;

    -- 5. Link newly created line item to fund_requests
    UPDATE public.fund_requests
    SET
        accounts_line_item_id = v_item.id,
        accounts_imported_at = now(),
        updated_at = now()
    WHERE fund_request_id = p_fund_request_id
    RETURNING * INTO v_fr;

    RETURN jsonb_build_object(
        'fund_request', row_to_json(v_fr),
        'line_item', row_to_json(v_item)
    );
END;
$$;

GRANT ALL ON FUNCTION "public"."import_fund_request_to_acct_sheet_transact"(uuid, uuid, character varying) TO anon, authenticated, service_role;

-- ============================================================================
-- 4. approve_acct_line_item_transact with ZO Balance credit & Fund Request update
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."approve_acct_line_item_transact"(
    p_line_item_id   uuid,
    p_ho_process     varchar,
    p_ho_pass_amount numeric,
    p_actioned_by    varchar,
    p_ho_remarks     text DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item               acct_requisition_line_items;
    v_bbm                bank_balance_master;
    v_pass_amount        numeric(18,2);
    v_ledger_remaining   numeric(18,2);
    v_fr                 public.fund_requests;
    v_estimate_amount    numeric(18,2);
    v_submitted_total    numeric(18,2);
    v_self_committed     numeric(18,2);
    v_remaining_capacity numeric(18,2);
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Pending HO Review' THEN
        RAISE EXCEPTION 'HO can only approve Pending HO Review items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    IF v_item.debit_bank_ac_type = 'Credit' THEN
        RAISE EXCEPTION 'This item was entered as Credit — use Credit Approved instead of Approve/Partially Approve.' USING ERRCODE = 'VAL09';
    END IF;

    IF p_ho_process = 'Approved' THEN
        v_pass_amount := v_item.req_amount;
    ELSIF p_ho_process = 'Partially Approved' THEN
        v_pass_amount := p_ho_pass_amount;
        IF v_pass_amount IS NULL OR v_pass_amount <= 0 OR v_pass_amount > v_item.req_amount THEN
            RAISE EXCEPTION 'ho_pass_amount must be > 0 and <= req_amount.' USING ERRCODE = 'VAL01';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid ho_process for approve RPC: %. Use the non-approve RPC for Hold/Return/Reject.', p_ho_process;
    END IF;

    -- Credit ledger validation if installment
    IF v_item.credit_ledger_id IS NOT NULL THEN
        SELECT remaining_balance INTO v_ledger_remaining
        FROM credit_ledger WHERE id = v_item.credit_ledger_id FOR UPDATE;
        IF v_pass_amount > v_ledger_remaining THEN
            RAISE EXCEPTION 'Approved amount (%) exceeds this purchase''s remaining credit balance (%).',
                v_pass_amount, v_ledger_remaining USING ERRCODE = 'VAL10';
        END IF;
    END IF;

    -- Fund request cost estimate capacity check if this is an imported fund request
    IF v_item.source_fund_request_id IS NOT NULL THEN
        SELECT * INTO v_fr FROM public.fund_requests WHERE fund_request_id = v_item.source_fund_request_id FOR UPDATE;
        IF FOUND THEN
            SELECT estimate_amount INTO v_estimate_amount
            FROM public.project_cost_estimates
            WHERE work_order_no = v_fr.work_order_no
              AND estimate_status = 'Final Approved'::public.estimate_status_enum
            ORDER BY estimate_revision DESC
            LIMIT 1;

            IF v_estimate_amount IS NOT NULL THEN
                SELECT COALESCE(SUM(
                    CASE
                        WHEN request_status = 'Approved' THEN approve_ho_amount
                        WHEN request_status IN ('Pending', 'Hold') THEN zo_fr_amount
                        ELSE 0::numeric
                    END
                ), 0.00) INTO v_submitted_total
                FROM public.fund_requests
                WHERE work_order_no = v_fr.work_order_no
                  AND request_status IN ('Pending', 'Hold', 'Approved');

                v_self_committed := COALESCE(v_fr.zo_fr_amount, 0.00);
                v_remaining_capacity := v_estimate_amount - (v_submitted_total - v_self_committed);

                IF v_pass_amount > v_remaining_capacity THEN
                    RAISE EXCEPTION 'Approved amount exceeds the remaining Cost Estimate funding capacity (Capacity: %, Attempted: %).',
                        v_remaining_capacity, v_pass_amount USING ERRCODE = 'BUD02';
                END IF;
            END IF;
        END IF;
    END IF;

    -- Bank balance master debit
    SELECT * INTO v_bbm FROM bank_balance_master
        WHERE bank_name = v_item.debit_bank_ac_type FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank Balance Master entry not found: %', v_item.debit_bank_ac_type USING ERRCODE = 'BNK01';
    END IF;

    IF v_bbm.available_balance - v_pass_amount < 0 THEN
        RAISE EXCEPTION 'Approval would drive % balance below zero. Remaining: %, Requested: %.',
            v_item.debit_bank_ac_type, v_bbm.available_balance, v_pass_amount USING ERRCODE = 'BAL01';
    END IF;

    UPDATE bank_balance_master
    SET available_balance = available_balance - v_pass_amount,
        updated_by = p_actioned_by
    WHERE id = v_bbm.id;

    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (p_actioned_by, 'BANK_DEBITED_PAYOUT', 'Bank Balance Master', v_item.debit_bank_ac_type,
            jsonb_build_object('available_balance', v_bbm.available_balance),
            jsonb_build_object('available_balance', v_bbm.available_balance - v_pass_amount,
                                'delta', -v_pass_amount, 'line_item_id', p_line_item_id,
                                'sheet_id', v_item.sheet_id, 'ho_process', p_ho_process));

    -- Credit ledger debit if installment
    IF v_item.credit_ledger_id IS NOT NULL THEN
        UPDATE credit_ledger
        SET paid_total        = paid_total + v_pass_amount,
            remaining_balance = remaining_balance - v_pass_amount,
            ledger_status     = CASE WHEN remaining_balance - v_pass_amount <= 0 THEN 'Settled' ELSE 'Open' END,
            settled_at        = CASE WHEN remaining_balance - v_pass_amount <= 0 THEN now() ELSE settled_at END,
            updated_at        = now()
        WHERE id = v_item.credit_ledger_id;
    END IF;

    -- Credit ZO balance and record ALLOCATION in ledger if this is an imported fund request
    IF v_item.source_fund_request_id IS NOT NULL AND v_fr.fund_request_id IS NOT NULL THEN
        INSERT INTO public.zo_balances (zo_user_id, available_balance)
        VALUES (v_fr.zo_user_id, 0.00)
        ON CONFLICT (zo_user_id) DO NOTHING;

        UPDATE public.zo_balances
        SET available_balance = available_balance + v_pass_amount, updated_at = now()
        WHERE zo_user_id = v_fr.zo_user_id;

        INSERT INTO public.zo_fund_ledger (
            zo_user_id,
            transaction_type,
            reference_type,
            reference_id,
            amount,
            work_order_no,
            created_by
        ) VALUES (
            v_fr.zo_user_id,
            'ALLOCATION',
            'FUND_REQUEST',
            v_fr.fund_request_id,
            v_pass_amount,
            v_fr.work_order_no,
            p_actioned_by
        );

        UPDATE public.fund_requests
        SET
            request_status = 'Approved',
            approve_ho_amount = v_pass_amount,
            transfer_from_account = v_item.debit_bank_ac_type,
            approve_ho_user_id = p_actioned_by,
            approve_ho_date = now(),
            ho_remarks = p_ho_remarks,
            updated_at = now()
        WHERE fund_request_id = v_fr.fund_request_id;
    END IF;

    UPDATE acct_requisition_line_items
    SET
        requisition_status     = CASE WHEN p_ho_process = 'Approved' THEN 'Approved' ELSE 'Partially Approved' END,
        ho_process             = p_ho_process,
        ho_pass_amount         = v_pass_amount,
        ho_remarks             = p_ho_remarks,
        ho_actioned_by         = p_actioned_by,
        ho_actioned_at         = now(),
        bank_balance_master_id = v_bbm.id,
        updated_at             = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

-- ============================================================================
-- 5. act_acct_line_item_non_approve_transact updating Fund Request status
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."act_acct_line_item_non_approve_transact"(
    p_line_item_id uuid,
    p_action       varchar,    -- 'Hold' | 'Return' | 'Reject'
    p_actioned_by  varchar,
    p_ho_remarks   text
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item          acct_requisition_line_items;
    v_new_status    varchar;
    v_new_process   varchar;
BEGIN
    IF p_action NOT IN ('Hold', 'Return', 'Reject') THEN
        RAISE EXCEPTION 'Invalid action %. Must be Hold, Return, or Reject.', p_action;
    END IF;

    IF p_ho_remarks IS NULL OR trim(p_ho_remarks) = '' THEN
        RAISE EXCEPTION 'ho_remarks is required for % action.', p_action USING ERRCODE = 'VAL03';
    END IF;

    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Pending HO Review' THEN
        RAISE EXCEPTION 'HO can only act on Pending HO Review items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    v_new_status  := CASE p_action WHEN 'Hold' THEN 'On Hold' WHEN 'Return' THEN 'Returned for Correction' WHEN 'Reject' THEN 'Rejected' END;
    v_new_process := CASE p_action WHEN 'Hold' THEN 'Hold'    WHEN 'Return' THEN 'Returned for Correction' WHEN 'Reject' THEN 'Rejected' END;

    IF v_item.source_fund_request_id IS NOT NULL THEN
        UPDATE public.fund_requests
        SET
            request_status = 'Hold'::public.fund_request_status_enum,
            ho_remarks = p_ho_remarks,
            updated_at = now()
        WHERE fund_request_id = v_item.source_fund_request_id;
    END IF;

    UPDATE acct_requisition_line_items
    SET
        requisition_status = v_new_status,
        ho_process         = v_new_process,
        ho_remarks         = p_ho_remarks,
        ho_actioned_by     = p_actioned_by,
        ho_actioned_at     = now(),
        updated_at         = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

-- ============================================================================
-- 6. delete_empty_acct_sheet_transact restoring Fund Request eligibility
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."delete_empty_acct_sheet_transact"(
    p_sheet_id uuid
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    v_restored_count integer;
    v_restored_req_count integer;
    v_restored_fr_count integer;
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

    -- Restore any fund requests whose imported line items were on this sheet
    UPDATE public.fund_requests fr
    SET accounts_line_item_id = NULL,
        accounts_imported_at = NULL,
        updated_at = now()
    FROM acct_requisition_line_items li
    WHERE fr.accounts_line_item_id = li.id
      AND li.sheet_id = p_sheet_id;
    GET DIAGNOSTICS v_restored_fr_count = ROW_COUNT;

    DELETE FROM acct_requisition_sheets WHERE id = p_sheet_id;

    RETURN v_restored_count + v_restored_req_count + v_restored_fr_count;
END; $$;
