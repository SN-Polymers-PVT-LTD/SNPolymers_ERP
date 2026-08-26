-- Migration 025: Debit bank_balance_master.available_balance on HO approval
--
-- Prior behavior: approve_acct_line_item_transact locked the bank row purely to
-- run a guardrail check (sum ho_pass_amount across ALL historically-approved
-- items for that bank, compare against available_balance), but never wrote
-- anything back — available_balance stayed a manually-typed reference figure
-- forever, only ever changed via the PUT /acct-requisitions/bank-balances upsert.
--
-- New behavior: an approval/partial-approval now actually decrements
-- available_balance by the approved amount, in the same transaction as the line
-- item's status update. The guardrail simplifies to a direct check against the
-- locked row instead of re-summing history every time.
--
-- Trade-off accepted: available_balance moves from a value recomputed fresh on
-- every check (self-healing — any bug anywhere corrects itself on the next read)
-- to a running total (any bug silently and permanently corrupts the balance,
-- with only the audit trail as evidence). No new reconciliation mechanism is
-- being built to offset this — the existing manual upsertBankBalance flow
-- (BankBalanceEditor.jsx "Add Bank" modal, and BankCard.jsx's inline
-- debit/credit adjuster) already serves as the periodic true-up-against-a-
-- real-statement mechanism, the same way a chequebook register gets trued up
-- periodically.
--
-- PRE-MIGRATION MANUAL STEP (required): before applying this migration, run
-- the read-only query documented in the accompanying plan against the target
-- DB and confirm it returns zero rows:
--
--   SELECT bbm.bank_name, bbm.available_balance AS current_baseline,
--          COALESCE(SUM(li.ho_pass_amount), 0) AS total_approved,
--          bbm.available_balance - COALESCE(SUM(li.ho_pass_amount), 0) AS would_be_balance
--   FROM bank_balance_master bbm
--   LEFT JOIN acct_requisition_line_items li
--     ON li.debit_bank_ac_type = bbm.bank_name
--     AND li.requisition_status IN ('Approved', 'Partially Approved')
--   GROUP BY bbm.bank_name, bbm.available_balance
--   HAVING bbm.available_balance - COALESCE(SUM(li.ho_pass_amount), 0) < 0;
--
-- If it returns any rows, resolve the discrepancy manually (correct the
-- baseline via the existing reconcile UI, or investigate) before proceeding —
-- the backfill below aborts loudly rather than silently clamping.

-- ============================================================================
-- 1. Backfill: net out already-approved amounts from each bank's baseline
-- ============================================================================
DO $$
DECLARE
  v_bank RECORD;
  v_total numeric(18,2);
  v_new numeric(18,2);
  v_offending text := '';
BEGIN
  -- Two full passes over bank_balance_master, not one: the first pass only reads
  -- and accumulates v_offending, with zero UPDATEs. Only if it finds nothing
  -- wrong does the second pass run and actually mutate rows. This means the
  -- abort path below is guaranteed to fire before any bank's balance is
  -- touched — there is no interleaving where some banks get backfilled and
  -- then a later one aborts, leaving the table half-migrated. (Also true
  -- trivially because the whole DO block runs inside the migration's own
  -- transaction, but the two-pass structure means it can't even attempt
  -- partial writes in the first place.)
  FOR v_bank IN SELECT id, bank_name, available_balance FROM bank_balance_master LOOP
    SELECT COALESCE(SUM(ho_pass_amount), 0) INTO v_total
    FROM acct_requisition_line_items
    WHERE debit_bank_ac_type = v_bank.bank_name
      AND requisition_status IN ('Approved', 'Partially Approved');

    v_new := v_bank.available_balance - v_total;
    IF v_new < 0 THEN
      v_offending := v_offending || format('%s (baseline %s, approved %s); ', v_bank.bank_name, v_bank.available_balance, v_total);
    END IF;
  END LOOP;

  IF v_offending <> '' THEN
    RAISE EXCEPTION 'Backfill aborted — these banks would go negative, resolve manually first: %', v_offending;
  END IF;

  FOR v_bank IN SELECT id, bank_name, available_balance FROM bank_balance_master LOOP
    SELECT COALESCE(SUM(ho_pass_amount), 0) INTO v_total
    FROM acct_requisition_line_items
    WHERE debit_bank_ac_type = v_bank.bank_name
      AND requisition_status IN ('Approved', 'Partially Approved');

    IF v_total > 0 THEN
      v_new := v_bank.available_balance - v_total;
      UPDATE bank_balance_master SET available_balance = v_new WHERE id = v_bank.id;

      -- user_id left NULL (audit_log.user_id has no FK and is nullable) so the
      -- existing enrichAuditsWithUserNames fallback (`log.user_id || 'System'`)
      -- renders this as "System" consistently with other system-originated
      -- rows, rather than inventing a sentinel string that isn't a real
      -- mobile_number.
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (NULL, 'BANK_BACKFILL_APPROVED_PAYOUTS', 'Bank Balance Master', v_bank.bank_name,
              jsonb_build_object('available_balance', v_bank.available_balance),
              jsonb_build_object('available_balance', v_new, 'delta', v_new - v_bank.available_balance,
                                  'backfilled_total', v_total));
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 2. Replace approve_acct_line_item_transact: direct balance check + real debit
-- ============================================================================
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

    IF v_item.requisition_status NOT IN ('Pending HO Review', 'On Hold') THEN
        RAISE EXCEPTION 'HO can only approve Pending HO Review or On Hold items. Current: %',
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

    -- Single-row-per-bank (H3 fix): select by bank_name directly, no ORDER BY LIMIT 1
    SELECT * INTO v_bbm FROM bank_balance_master
        WHERE bank_name = v_item.debit_bank_ac_type FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank Balance Master entry not found: %', v_item.debit_bank_ac_type USING ERRCODE = 'BNK01';
    END IF;

    -- Balance is now a real running total (decremented below on every
    -- approval), not recomputed from history each time — see this migration's
    -- header comment for the reconciliation trade-off this accepts. Manual
    -- reconciliation via upsertBankBalance / BankCard's debit-credit adjuster
    -- remains the periodic true-up mechanism against a real bank statement.
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
