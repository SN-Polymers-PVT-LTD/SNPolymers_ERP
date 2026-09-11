-- Migration 060: make Credit classification consistent across Accounts and HO.
-- Credit ledger creation remains an HO Credit Approved action; Accounts
-- submission only validates the row and moves it to Pending HO Review.

-- Refuse to hide existing data problems behind a new constraint. Repair any
-- reported rows according to their workflow status before retrying migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.acct_requisition_line_items
    WHERE (payment_mode = 'Credit' AND COALESCE(debit_bank_ac_type, '') <> 'Credit')
       OR (debit_bank_ac_type = 'Credit' AND COALESCE(payment_mode, '') <> 'Credit')
  ) THEN
    RAISE EXCEPTION 'Cannot add Credit payment invariant: inconsistent acct_requisition_line_items exist.' USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE public.acct_requisition_line_items
  DROP CONSTRAINT IF EXISTS chk_arli_credit_payment_parity;

ALTER TABLE public.acct_requisition_line_items
  ADD CONSTRAINT chk_arli_credit_payment_parity CHECK (
    (payment_mode = 'Credit') IS NOT DISTINCT FROM (debit_bank_ac_type = 'Credit')
  );

-- The canonical RPC name is retained for the controller and batch dispatcher.
-- The additional payment_mode guard prevents direct/internal calls from
-- treating a historically malformed row as a Credit purchase.
CREATE OR REPLACE FUNCTION public.credit_approve_acct_line_item_transact(
  p_line_item_id uuid,
  p_actioned_by varchar,
  p_ho_remarks text DEFAULT NULL
) RETURNS public.acct_requisition_line_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.acct_requisition_line_items;
  v_beneficiary_id uuid;
  v_ledger_id uuid;
BEGIN
  SELECT * INTO v_item FROM public.acct_requisition_line_items
  WHERE id = p_line_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;
  IF v_item.requisition_status <> 'Pending HO Review' THEN
    RAISE EXCEPTION 'HO can only act on Pending HO Review items. Current: %', v_item.requisition_status USING ERRCODE = 'STA01';
  END IF;
  IF v_item.debit_bank_ac_type <> 'Credit' OR v_item.payment_mode <> 'Credit' THEN
    RAISE EXCEPTION 'Credit Approved requires Debit Bank Type and Payment Mode to both be Credit.' USING ERRCODE = 'VAL06';
  END IF;
  IF v_item.beneficiary_ac_no IS NULL OR v_item.beneficiary_ifsc IS NULL
     OR v_item.beneficiary_name IS NULL OR v_item.beneficiary_bank_name IS NULL THEN
    RAISE EXCEPTION 'Beneficiary (dealer) details are required before Credit Approved.' USING ERRCODE = 'VAL07';
  END IF;

  INSERT INTO public.beneficiary_master (
    account_number, ifsc, beneficiary_name, beneficiary_bank_name,
    beneficiary_bank_id, is_credit_dealer, last_used_at, created_by, updated_by
  ) VALUES (
    v_item.beneficiary_ac_no, v_item.beneficiary_ifsc, v_item.beneficiary_name,
    v_item.beneficiary_bank_name, v_item.beneficiary_bank_id, true, now(),
    p_actioned_by, p_actioned_by
  )
  ON CONFLICT (account_number, ifsc) DO UPDATE SET
    is_credit_dealer = true,
    beneficiary_bank_id = COALESCE(EXCLUDED.beneficiary_bank_id, beneficiary_master.beneficiary_bank_id),
    beneficiary_bank_name = COALESCE(EXCLUDED.beneficiary_bank_name, beneficiary_master.beneficiary_bank_name),
    last_used_at = now(), updated_by = p_actioned_by, updated_at = now()
  RETURNING id INTO v_beneficiary_id;

  UPDATE public.acct_requisition_line_items
  SET requisition_status = 'Credit Approved', ho_process = 'Credit Approved',
      ho_pass_amount = v_item.req_amount, ho_remarks = p_ho_remarks,
      ho_actioned_by = p_actioned_by, ho_actioned_at = now(), updated_at = now()
  WHERE id = p_line_item_id
  RETURNING * INTO v_item;

  INSERT INTO public.credit_ledger (
    source_line_item_id, beneficiary_id, opening_balance, paid_total,
    remaining_balance, ledger_status, created_by
  ) VALUES (
    v_item.id, v_beneficiary_id, v_item.req_amount, 0, v_item.req_amount,
    'Open', p_actioned_by
  ) RETURNING id INTO v_ledger_id;

  UPDATE public.acct_requisition_line_items
  SET credit_ledger_id = v_ledger_id
  WHERE id = p_line_item_id
  RETURNING * INTO v_item;
  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_approve_acct_line_item_transact(uuid, varchar, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_approve_acct_line_item_transact(uuid, varchar, text) TO service_role;

-- Keep the later compatibility name working with the same invariant. This
-- name exists in migration 051, while application code uses the canonical name
-- above; both must reject a mismatched Credit row.
CREATE OR REPLACE FUNCTION public.approve_credit_purchase_transact(
  p_line_item_id uuid,
  p_actioned_by varchar,
  p_ho_remarks text DEFAULT NULL
) RETURNS public.acct_requisition_line_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.credit_approve_acct_line_item_transact(p_line_item_id, p_actioned_by, p_ho_remarks);
END;
$$;

-- Recreate the current submit boundary (last defined in migration 042).
-- Draft saves remain permissive; completeness and Credit parity are checked
-- only when the whole sheet is submitted.
CREATE OR REPLACE FUNCTION public.submit_acct_sheet_transact(
  p_sheet_id uuid,
  p_submitted_by varchar
) RETURNS public.acct_requisition_sheets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sheet public.acct_requisition_sheets;
  v_row_count integer;
  v_invalid integer;
BEGIN
  SELECT * INTO v_sheet FROM public.acct_requisition_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found.'; END IF;
  IF v_sheet.sheet_status <> 'Open' THEN
    RAISE EXCEPTION 'Sheet is already Submitted.' USING ERRCODE = 'STA01';
  END IF;
  SELECT COUNT(*) INTO v_row_count FROM public.acct_requisition_line_items WHERE sheet_id = p_sheet_id;
  IF v_row_count = 0 THEN RAISE EXCEPTION 'Sheet has no line items.'; END IF;

  SELECT COUNT(*) INTO v_invalid
  FROM public.acct_requisition_line_items
  WHERE sheet_id = p_sheet_id
    AND (
      req_amount IS NULL
      OR payment_mode IS NULL
      OR debit_bank_ac_type IS NULL
      OR (payment_mode = 'Cheque' AND (cheque_no IS NULL OR cheque_date IS NULL))
      OR (payment_mode = 'Bulk NEFT' AND
          (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL))
      OR (payment_mode = 'Credit' AND
          (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL OR beneficiary_bank_name IS NULL))
      OR (payment_mode = 'Credit' AND COALESCE(debit_bank_ac_type, '') <> 'Credit')
      OR (debit_bank_ac_type = 'Credit' AND COALESCE(payment_mode, '') <> 'Credit')
    );
  IF v_invalid > 0 THEN
    RAISE EXCEPTION '% row(s) missing required fields or have inconsistent Credit fields.', v_invalid USING ERRCODE = 'VAL02';
  END IF;

  UPDATE public.acct_requisition_sheets
  SET sheet_status = 'Submitted', submitted_by = p_submitted_by,
      submitted_at = now(), row_count_at_submission = v_row_count, updated_at = now()
  WHERE id = p_sheet_id
  RETURNING * INTO v_sheet;

  UPDATE public.acct_requisition_line_items
  SET requisition_status = 'Pending HO Review', updated_at = now()
  WHERE sheet_id = p_sheet_id;
  RETURN v_sheet;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_acct_sheet_transact(uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_acct_sheet_transact(uuid, varchar) TO service_role;
