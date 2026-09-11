-- Migration 042: Credit purchases and the Credit Ledger
--
-- Lets Accounts record a dealer purchase made on credit (no cash paid today)
-- as a normal line item on the existing Accounts Requisition Sheet, using
-- new Debit Bank Type / Payment Mode = 'Credit' values. HO approves it via a
-- new all-or-nothing decision, 'Credit Approved' (parallel to Approve, never
-- Partially-Approved) which creates a credit_ledger row instead of debiting
-- any real bank. Each later installment against that ledger row is a
-- perfectly normal cash line item (real bank, real payment mode, normal
-- Approve/Partially Approve) that debits the ledger's remaining balance on
-- approval. The ledger is repeatably importable — unlike the existing
-- On Hold/Rejected/Pending Review queue's one-shot import
-- (import_acct_line_item_transact), the same purchase can be imported into
-- many future sheets, one per installment, until its balance hits zero.
--
-- Ledger grain is one row PER PURCHASE, not per dealer — a dealer can have
-- several simultaneously-open credit purchases, each paid down
-- independently. beneficiary_master is reused as the dealer identity (a new
-- is_credit_dealer flag is added for filtering/reporting only, auto-set on
-- every Credit Approved) rather than introducing a new master table.

-- ----------------------------------------------------------------------------
-- 1. bank_balance_master: is_virtual flag + the 'Credit' sentinel row.
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."bank_balance_master"
    ADD COLUMN "is_virtual" boolean NOT NULL DEFAULT false;

-- Seeded by a system/admin account, not a real Accounts user — created_by/
-- updated_by are NOT NULL + FK'd to authorised_users. Same "pick any existing
-- admin at migration time" convention as 026_create_indian_bank_master.sql,
-- rather than hardcoding a mobile number that may not exist on a given
-- environment. If no admin exists yet, the seed is skipped and the sentinel
-- row can be added later by hand once an admin account exists.
DO $$
DECLARE
  v_seed_user varchar;
BEGIN
  SELECT mobile_number INTO v_seed_user FROM authorised_users WHERE role = 'admin' LIMIT 1;

  IF v_seed_user IS NOT NULL THEN
    INSERT INTO bank_balance_master (bank_name, balance_date, available_balance, is_virtual, created_by, updated_by)
    VALUES ('Credit', CURRENT_DATE, 0, true, v_seed_user, v_seed_user)
    ON CONFLICT (bank_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'Credit sentinel bank_balance_master row skipped: no admin user found in authorised_users.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. beneficiary_master: is_credit_dealer flag (reporting/filter only).
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."beneficiary_master"
    ADD COLUMN "is_credit_dealer" boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 3. acct_requisition_line_items: widen CHECK constraints, add credit_ledger_id.
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."acct_requisition_line_items" DROP CONSTRAINT "chk_arli_payment_mode";
ALTER TABLE "public"."acct_requisition_line_items" ADD CONSTRAINT "chk_arli_payment_mode"
    CHECK (payment_mode IS NULL OR payment_mode IN (
        'Cheque', 'Bulk NEFT', 'RTGS', 'NEFT', 'Credit'
    ));

ALTER TABLE "public"."acct_requisition_line_items" DROP CONSTRAINT "chk_arli_status";
ALTER TABLE "public"."acct_requisition_line_items" ADD CONSTRAINT "chk_arli_status"
    CHECK (requisition_status IS NULL OR requisition_status IN (
        'Pending HO Review', 'Approved', 'Partially Approved',
        'On Hold', 'Returned for Correction', 'Rejected', 'Pending Review',
        'Credit Approved'
    ));

ALTER TABLE "public"."acct_requisition_line_items" DROP CONSTRAINT "chk_arli_ho_process";
ALTER TABLE "public"."acct_requisition_line_items" ADD CONSTRAINT "chk_arli_ho_process"
    CHECK (ho_process IS NULL OR ho_process IN (
        'Approved', 'Partially Approved', 'Returned for Correction', 'Hold', 'Rejected',
        'Credit Approved'
    ));

ALTER TABLE "public"."acct_requisition_line_items"
    ADD COLUMN "credit_ledger_id" uuid;
-- FK added after credit_ledger exists below (table must exist first).

-- ----------------------------------------------------------------------------
-- 4. credit_ledger — one row per credit purchase.
-- ----------------------------------------------------------------------------
CREATE TABLE "public"."credit_ledger" (
    "id"                  uuid          DEFAULT gen_random_uuid() NOT NULL,
    "source_line_item_id" uuid          NOT NULL,
    "beneficiary_id"      uuid          NOT NULL,
    "opening_balance"     numeric(18,2) NOT NULL,
    "paid_total"          numeric(18,2) NOT NULL DEFAULT 0,
    "remaining_balance"   numeric(18,2) NOT NULL,
    "ledger_status"       varchar       NOT NULL DEFAULT 'Open',
    "created_by"          varchar       NOT NULL,
    "created_at"          timestamptz   DEFAULT now() NOT NULL,
    "updated_at"          timestamptz   DEFAULT now() NOT NULL,
    "settled_at"          timestamptz,
    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_cl_status" CHECK (ledger_status IN ('Open', 'Settled')),
    CONSTRAINT "chk_cl_opening_balance" CHECK (opening_balance > 0),
    CONSTRAINT "chk_cl_paid_total" CHECK (paid_total >= 0),
    CONSTRAINT "chk_cl_remaining_balance" CHECK (remaining_balance >= 0),
    CONSTRAINT "fk_cl_source_item" FOREIGN KEY (source_line_item_id) REFERENCES acct_requisition_line_items(id) ON DELETE RESTRICT,
    CONSTRAINT "fk_cl_beneficiary" FOREIGN KEY (beneficiary_id) REFERENCES beneficiary_master(id) ON DELETE RESTRICT,
    CONSTRAINT "fk_cl_created_by" FOREIGN KEY (created_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

CREATE INDEX "idx_cl_beneficiary" ON credit_ledger (beneficiary_id);
-- Backs the import-list / history-list query (filter by status, sort by age).
CREATE INDEX "idx_cl_status_created" ON credit_ledger (ledger_status, created_at DESC);

ALTER TABLE "public"."acct_requisition_line_items"
    ADD CONSTRAINT "fk_arli_credit_ledger" FOREIGN KEY (credit_ledger_id) REFERENCES credit_ledger(id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 5. RPC: credit_approve_acct_line_item_transact
--    HO-only, all-or-nothing. Creates the credit_ledger row and
--    auto-upserts the dealer into beneficiary_master (flips
--    is_credit_dealer true) — Accounts never has to separately "register" a
--    credit dealer first.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."credit_approve_acct_line_item_transact"(
    p_line_item_id uuid,
    p_actioned_by  varchar,
    p_ho_remarks   text DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item           acct_requisition_line_items;
    v_beneficiary_id uuid;
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Pending HO Review' THEN
        RAISE EXCEPTION 'HO can only act on Pending HO Review items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    IF v_item.debit_bank_ac_type <> 'Credit' THEN
        RAISE EXCEPTION 'Credit Approved is only valid for line items with Debit Bank Type = Credit.' USING ERRCODE = 'VAL06';
    END IF;

    IF v_item.beneficiary_ac_no IS NULL OR v_item.beneficiary_ifsc IS NULL
       OR v_item.beneficiary_name IS NULL OR v_item.beneficiary_bank_name IS NULL THEN
        RAISE EXCEPTION 'Beneficiary (dealer) details are required before Credit Approved.' USING ERRCODE = 'VAL07';
    END IF;

    INSERT INTO beneficiary_master (account_number, ifsc, beneficiary_name, beneficiary_bank_name, is_credit_dealer, last_used_at, created_by, updated_by)
    VALUES (v_item.beneficiary_ac_no, v_item.beneficiary_ifsc, v_item.beneficiary_name, v_item.beneficiary_bank_name, true, now(), p_actioned_by, p_actioned_by)
    ON CONFLICT (account_number, ifsc) DO UPDATE
        SET is_credit_dealer = true, last_used_at = now(), updated_by = p_actioned_by, updated_at = now()
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

    INSERT INTO credit_ledger (source_line_item_id, beneficiary_id, opening_balance, paid_total, remaining_balance, ledger_status, created_by)
    VALUES (p_line_item_id, v_beneficiary_id, v_item.req_amount, 0, v_item.req_amount, 'Open', p_actioned_by);

    RETURN v_item;
END; $$;

-- ----------------------------------------------------------------------------
-- 6. approve_acct_line_item_transact: two changes —
--    a) guard against Approve/PartiallyApprove being used on a Credit-type
--       item (must use Credit Approved instead);
--    b) after a successful bank debit, if this item carries a
--       credit_ledger_id (i.e. it's an installment imported from the Credit
--       Ledger), also debit that ledger's remaining balance and flip it to
--       Settled once it reaches zero.
--    Full body reproduced from 037_terminal_hold_and_rejected.sql with only
--    those two additions — everything else (the bank-balance guardrail, the
--    BANK_DEBITED_PAYOUT audit row) is unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."approve_acct_line_item_transact"(
    p_line_item_id   uuid,
    p_ho_process     varchar,
    p_ho_pass_amount numeric,
    p_actioned_by    varchar,
    p_ho_remarks     text DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item              acct_requisition_line_items;
    v_bbm               bank_balance_master;
    v_pass_amount       numeric(18,2);
    v_ledger_remaining  numeric(18,2);
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Pending HO Review' THEN
        RAISE EXCEPTION 'HO can only approve Pending HO Review items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    -- NEW: a Credit-type item must go through credit_approve_acct_line_item_transact.
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

    -- NEW: if this is a credit-ledger installment, verify it before touching
    -- any real money — lock the ledger row now so a concurrent installment
    -- against the same purchase can't race past this check.
    IF v_item.credit_ledger_id IS NOT NULL THEN
        SELECT remaining_balance INTO v_ledger_remaining
        FROM credit_ledger WHERE id = v_item.credit_ledger_id FOR UPDATE;
        IF v_pass_amount > v_ledger_remaining THEN
            RAISE EXCEPTION 'Approved amount (%) exceeds this purchase''s remaining credit balance (%).',
                v_pass_amount, v_ledger_remaining USING ERRCODE = 'VAL10';
        END IF;
    END IF;

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

    -- NEW: debit the credit ledger this installment belongs to, if any.
    IF v_item.credit_ledger_id IS NOT NULL THEN
        UPDATE credit_ledger
        SET paid_total        = paid_total + v_pass_amount,
            remaining_balance = remaining_balance - v_pass_amount,
            ledger_status     = CASE WHEN remaining_balance - v_pass_amount <= 0 THEN 'Settled' ELSE 'Open' END,
            settled_at        = CASE WHEN remaining_balance - v_pass_amount <= 0 THEN now() ELSE settled_at END,
            updated_at        = now()
        WHERE id = v_item.credit_ledger_id;
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

-- ----------------------------------------------------------------------------
-- 7. RPC: import_credit_installment_transact
--    Repeatable — unlike import_acct_line_item_transact, does NOT mark the
--    source (credit_ledger row) as "used". The only gate is
--    ledger_status = 'Open' (i.e. remaining_balance > 0), which naturally
--    becomes false once approve_acct_line_item_transact's new block above
--    settles it. Only identity/beneficiary fields are prefilled — amount,
--    debit bank, and payment mode are deliberately left blank for Accounts
--    to fill in per-installment (an installment's amount varies each time,
--    unlike a Hold/Reject re-import which copies the original amount
--    unchanged).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."import_credit_installment_transact"(
    p_ledger_id       uuid,
    p_target_sheet_id uuid,
    p_imported_by     varchar
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_sheet_status varchar;
    v_ledger       credit_ledger;
    v_beneficiary  beneficiary_master;
    v_new_item     acct_requisition_line_items;
BEGIN
    SELECT sheet_status INTO v_sheet_status
    FROM acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.'; END IF;
    IF v_sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Installments can only be imported into an Open sheet.' USING ERRCODE = 'STA05';
    END IF;

    SELECT * INTO v_ledger FROM credit_ledger WHERE id = p_ledger_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Credit ledger entry not found.'; END IF;
    IF v_ledger.ledger_status <> 'Open' THEN
        RAISE EXCEPTION 'This credit purchase is already fully settled.' USING ERRCODE = 'STA09';
    END IF;

    SELECT * INTO v_beneficiary FROM beneficiary_master WHERE id = v_ledger.beneficiary_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dealer record not found.'; END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by, credit_ledger_id,
        particulars, beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name
    ) VALUES (
        p_target_sheet_id, p_imported_by, p_ledger_id,
        'Credit installment — ' || v_beneficiary.beneficiary_name,
        v_beneficiary.account_number, v_beneficiary.beneficiary_name,
        v_beneficiary.ifsc, v_beneficiary.beneficiary_bank_name
    ) RETURNING * INTO v_new_item;

    RETURN v_new_item;
END; $$;

-- ----------------------------------------------------------------------------
-- 8. act_acct_line_items_batch_transact: add the CreditApprove dispatch
--    branch. Full body reproduced from 027 with one new ELSIF — everything
--    else (per-item savepoint isolation) unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."act_acct_line_items_batch_transact"(
    p_actions      jsonb,
    p_actioned_by  varchar
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_action        jsonb;
    v_item_id       uuid;
    v_action_name   varchar;
    v_pass_amount   numeric(18,2);
    v_remarks       text;
    v_result        acct_requisition_line_items;
    v_results       jsonb := '[]'::jsonb;
BEGIN
    FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
    LOOP
        v_item_id     := (v_action->>'line_item_id')::uuid;
        v_action_name := v_action->>'action';
        v_pass_amount := NULLIF(v_action->>'ho_pass_amount', '')::numeric;
        v_remarks     := v_action->>'ho_remarks';

        BEGIN
            IF v_action_name IN ('Approve', 'PartiallyApprove') THEN
                v_result := approve_acct_line_item_transact(
                    v_item_id,
                    CASE WHEN v_action_name = 'Approve' THEN 'Approved' ELSE 'Partially Approved' END,
                    v_pass_amount,
                    p_actioned_by,
                    v_remarks
                );
            -- NEW
            ELSIF v_action_name = 'CreditApprove' THEN
                v_result := credit_approve_acct_line_item_transact(v_item_id, p_actioned_by, v_remarks);
            ELSIF v_action_name IN ('Hold', 'Return', 'Reject') THEN
                v_result := act_acct_line_item_non_approve_transact(
                    v_item_id, v_action_name, p_actioned_by, v_remarks
                );
            ELSE
                RAISE EXCEPTION 'Invalid action %.', v_action_name;
            END IF;

            v_results := v_results || jsonb_build_object(
                'line_item_id', v_item_id,
                'success', true,
                'item', to_jsonb(v_result)
            );
        EXCEPTION WHEN OTHERS THEN
            v_results := v_results || jsonb_build_object(
                'line_item_id', v_item_id,
                'success', false,
                'error_code', COALESCE(SQLSTATE, ''),
                'error_message', SQLERRM
            );
        END;
    END LOOP;

    RETURN v_results;
END; $$;

-- ----------------------------------------------------------------------------
-- 9. submit_acct_sheet_transact: require beneficiary fields for
--    payment_mode = 'Credit' at submit time too (same convention as the
--    existing Bulk NEFT clause) — catches a missing dealer identity before
--    it ever reaches HO, rather than only at Credit Approved time.
--    Full body reproduced from 033_add_line_item_transact_and_neft_beneficiary_check.sql
--    with one added OR clause — nothing between 033 and 041 redefined this
--    function (confirmed by grep across the migration chain).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."submit_acct_sheet_transact"(
    p_sheet_id     uuid,
    p_submitted_by varchar
) RETURNS acct_requisition_sheets LANGUAGE plpgsql AS $$
DECLARE
    v_sheet     acct_requisition_sheets;
    v_row_count integer;
    v_invalid   integer;
BEGIN
    SELECT * INTO v_sheet FROM acct_requisition_sheets WHERE id = p_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found.'; END IF;
    IF v_sheet.sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Sheet is already Submitted.' USING ERRCODE = 'STA01';
    END IF;

    SELECT COUNT(*) INTO v_row_count FROM acct_requisition_line_items WHERE sheet_id = p_sheet_id;
    IF v_row_count = 0 THEN RAISE EXCEPTION 'Sheet has no line items.'; END IF;

    SELECT COUNT(*) INTO v_invalid
    FROM acct_requisition_line_items
    WHERE sheet_id = p_sheet_id
      AND (req_amount IS NULL OR payment_mode IS NULL
           OR (payment_mode = 'Cheque' AND (cheque_no IS NULL OR cheque_date IS NULL))
           OR (payment_mode = 'Bulk NEFT'
               AND (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL))
           OR (payment_mode = 'Credit'
               AND (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL OR beneficiary_bank_name IS NULL)));
    IF v_invalid > 0 THEN
        RAISE EXCEPTION '% row(s) missing required fields.', v_invalid USING ERRCODE = 'VAL02';
    END IF;

    UPDATE acct_requisition_sheets
    SET sheet_status = 'Submitted', submitted_by = p_submitted_by,
        submitted_at = now(), row_count_at_submission = v_row_count, updated_at = now()
    WHERE id = p_sheet_id
    RETURNING * INTO v_sheet;

    UPDATE acct_requisition_line_items
    SET requisition_status = 'Pending HO Review', updated_at = now()
    WHERE sheet_id = p_sheet_id;

    RETURN v_sheet;
END; $$;

-- ----------------------------------------------------------------------------
-- 10. audit_acct_line_item_events: add a Credit Approved branch.
--     Full body reproduced from 041 with one new WHEN branch — everything
--     else identical.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."audit_acct_line_item_events"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_action VARCHAR;
  v_user   VARCHAR;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'LINE_ITEM_ADDED', 'Acct Requisition Line Item', NEW.id::VARCHAR, NULL,
            jsonb_build_object('sheet_id', NEW.sheet_id, 'req_amount', NEW.req_amount,
                               'payment_mode', NEW.payment_mode));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN

    CASE NEW.requisition_status

      WHEN 'Pending HO Review' THEN
        IF OLD.requisition_status IS NULL THEN
          v_action := 'PENDING_HO_REVIEW_FIRST_SUBMIT';
          v_user   := NEW.created_by;
        ELSIF NEW.reopened_at IS DISTINCT FROM OLD.reopened_at THEN
          v_action := 'REOPEN';
          v_user   := NEW.reopened_by;
        ELSIF NEW.revision_number > OLD.revision_number THEN
          v_action := 'RESUBMIT_AFTER_CORRECTION';
          v_user   := NEW.created_by;
        ELSE
          v_action := 'PENDING_HO_REVIEW_ENTER';
          v_user   := NEW.created_by;
        END IF;

      WHEN 'Approved', 'Partially Approved' THEN
        v_action := 'HO_APPROVED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'On Hold' THEN
        v_action := 'HO_HELD';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Returned for Correction' THEN
        v_action := 'HO_RETURNED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Rejected' THEN
        v_action := 'HO_REJECTED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Pending Review' THEN
        v_action := 'HO_CLOSED_REVIEW_UNDECIDED';
        v_user   := NEW.created_by;
      -- NEW
      WHEN 'Credit Approved' THEN
        v_action := 'HO_CREDIT_APPROVED';
        v_user   := NEW.ho_actioned_by;
      ELSE
        v_action := 'STATUS_CHANGE';
        v_user   := COALESCE(NEW.ho_actioned_by, NEW.created_by);
    END CASE;

    IF OLD.requisition_status = 'On Hold' AND NEW.requisition_status <> 'On Hold' THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
      VALUES (NEW.ho_actioned_by, 'HO_HOLD_RELEASED', 'Acct Requisition Line Item', NEW.id::VARCHAR,
              jsonb_build_object('requisition_status', OLD.requisition_status, 'ho_remarks', OLD.ho_remarks),
              jsonb_build_object('requisition_status', NEW.requisition_status),
              clock_timestamp());
    END IF;

    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
    VALUES (v_user, v_action, 'Acct Requisition Line Item', NEW.id::VARCHAR,
            jsonb_build_object('requisition_status', OLD.requisition_status,
                               'ho_process', OLD.ho_process,
                               'ho_actioned_by', OLD.ho_actioned_by,
                               'revision_number', OLD.revision_number),
            jsonb_build_object('requisition_status', NEW.requisition_status,
                               'ho_process', NEW.ho_process,
                               'ho_pass_amount', NEW.ho_pass_amount,
                               'ho_actioned_by', NEW.ho_actioned_by,
                               'bank_balance_master_id', NEW.bank_balance_master_id,
                               'revision_number', NEW.revision_number,
                               'is_reopened', NEW.is_reopened),
            clock_timestamp());
  END IF;
  RETURN NEW;
END; $$;
