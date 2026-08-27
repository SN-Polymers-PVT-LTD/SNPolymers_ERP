-- Migration 037: On Hold and Rejected become fully terminal on their
-- original sheet, superseding 036_allow_re_hold.sql
--
-- Now that import_acct_line_item_transact (034) exists -- copy an On
-- Hold/Rejected item into a brand-new sheet as a fresh line item -- that's
-- the intended single path forward for a held/rejected request. Leaving the
-- old in-place re-decision paths open let HO "fix" an On Hold item two
-- different ways (act on it directly, or via a re-imported copy) with no
-- clear source of truth. This closes both remaining in-place paths:
--
--   1. approve_acct_line_item_transact and act_acct_line_item_non_approve_transact
--      (Hold/Return/Reject) no longer accept 'On Hold' as a source status --
--      only 'Pending HO Review'. This also supersedes 036, which only
--      blocked re-Hold specifically; dropping 'On Hold' from the allowed
--      source set blocks every action uniformly (Approve/PartiallyApprove/
--      Hold/Return/Reject), not just a duplicate Hold.
--
--   2. reopen_acct_line_item_transact (021) is dropped outright -- its only
--      job was bringing a Rejected item back to 'Pending HO Review' on the
--      same sheet, which is exactly the in-place path being retired.
--
-- resubmit_acct_line_item_transact ('Returned for Correction' -> 'Pending HO
-- Review') is untouched -- that's Accounts fixing data on HO's request, not
-- HO re-deciding an already-decided item, so it stays a same-sheet loop.
--
-- act_acct_line_items_batch_transact (027) needs no change: it purely
-- delegates each action to the two RPCs tightened here, inside its own
-- savepoint, so it inherits the new guard automatically.
--
-- sync_acct_sheet_review_status (028) computed "sheet fully reviewed" as
-- zero items left with requisition_status IN ('Pending HO Review', 'On
-- Hold') -- correct when On Hold could still be re-decided later, but now
-- that On Hold is terminal, a sheet with an On-Hold item would otherwise
-- never reach 'Reviewed' even though nothing on it is actually still
-- awaiting a decision. Narrowed to 'Pending HO Review' alone, with a
-- backfill for any sheet already stuck at 'Submitted' purely because of an
-- On Hold item (mirrors 028's own backfill).

CREATE OR REPLACE FUNCTION "public"."sync_acct_sheet_review_status"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_pending_count integer;
BEGIN
    IF NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN
        SELECT count(*) INTO v_pending_count
        FROM acct_requisition_line_items
        WHERE sheet_id = NEW.sheet_id
          AND requisition_status = 'Pending HO Review';

        IF v_pending_count = 0 THEN
            UPDATE acct_requisition_sheets
            SET sheet_status = 'Reviewed', updated_at = now()
            WHERE id = NEW.sheet_id AND sheet_status = 'Submitted';
        ELSE
            UPDATE acct_requisition_sheets
            SET sheet_status = 'Submitted', updated_at = now()
            WHERE id = NEW.sheet_id AND sheet_status = 'Reviewed';
        END IF;
    END IF;
    RETURN NEW;
END; $$;

UPDATE acct_requisition_sheets s
SET sheet_status = 'Reviewed', updated_at = now()
WHERE s.sheet_status = 'Submitted'
  AND EXISTS (SELECT 1 FROM acct_requisition_line_items li WHERE li.sheet_id = s.id)
  AND NOT EXISTS (
    SELECT 1 FROM acct_requisition_line_items li
    WHERE li.sheet_id = s.id
      AND li.requisition_status = 'Pending HO Review'
  );

-- Rebuilt from 025_debit_bank_balance_on_approval.sql's version (the real
-- debit-writing body — 021's original never actually wrote to
-- bank_balance_master, only checked a recomputed sum), with the status
-- guard tightened as described above. Everything else, including the real
-- balance debit and its BANK_DEBITED_PAYOUT audit row, is unchanged from 025.
CREATE OR REPLACE FUNCTION "public"."approve_acct_line_item_transact"(
    p_line_item_id   uuid,
    p_ho_process     varchar,    -- 'Approved' | 'Partially Approved'
    p_ho_pass_amount numeric,
    p_actioned_by    varchar,    -- B1 fix: HO user
    p_ho_remarks     text DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item            acct_requisition_line_items;
    v_bbm             bank_balance_master;
    v_pass_amount     numeric(18,2);
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Pending HO Review' THEN
        RAISE EXCEPTION 'HO can only approve Pending HO Review items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
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

DROP FUNCTION IF EXISTS "public"."reopen_acct_line_item_transact"(uuid, varchar, text);
