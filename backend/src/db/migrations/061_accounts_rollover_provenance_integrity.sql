-- Migration 061: preserve Accounts rollover provenance and restore lineage safely.
--
-- Historical Accounts rows are workflow records. Rollover must preserve the
-- business root (Fund Request or Credit Ledger), while the Fund Request's
-- pointer identifies only the current row.

-- A Fund Request can have one historical Accounts row per rollover generation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.acct_requisition_line_items
    WHERE source_fund_request_id IS NOT NULL
    GROUP BY source_fund_request_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot remove unique Fund Request lineage index: duplicate source_fund_request_id values already exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.fund_requests fr
    JOIN public.acct_requisition_line_items li ON li.id = fr.accounts_line_item_id
    WHERE li.source_fund_request_id IS DISTINCT FROM fr.fund_request_id
  ) THEN
    RAISE EXCEPTION 'Fund Request Accounts lineage integrity violation exists.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.acct_requisition_line_items
    WHERE source_fund_request_id IS NOT NULL
      AND (
        payment_mode = 'Credit'
        OR debit_bank_ac_type = 'Credit'
        OR credit_ledger_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Cannot add Fund Request/Credit invariant: conflicting existing rows require manual repair.';
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_arli_source_fund_request;
CREATE INDEX IF NOT EXISTS idx_arli_source_fund_request
  ON public.acct_requisition_line_items(source_fund_request_id);

ALTER TABLE public.acct_requisition_sheets
  ADD COLUMN IF NOT EXISTS deleted_item_restore_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.acct_requisition_line_items
  DROP CONSTRAINT IF EXISTS chk_arli_fund_request_not_credit;

ALTER TABLE public.acct_requisition_line_items
  ADD CONSTRAINT chk_arli_fund_request_not_credit CHECK (
    source_fund_request_id IS NULL
    OR (
      payment_mode IS DISTINCT FROM 'Credit'
      AND debit_bank_ac_type IS DISTINCT FROM 'Credit'
      AND credit_ledger_id IS NULL
    )
  );

-- Generic Hold/Reject/Pending Review rollover. Workflow fields are deliberately
-- reset by the INSERT; business provenance and user-entered payment fields are
-- copied from the historical source.
CREATE OR REPLACE FUNCTION public.import_acct_line_item_transact(
  p_source_item_id uuid,
  p_target_sheet_id uuid,
  p_imported_by varchar
) RETURNS public.acct_requisition_line_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source public.acct_requisition_line_items;
  v_target_status varchar;
  v_new_item public.acct_requisition_line_items;
  v_pointer_updated integer;
BEGIN
  SELECT sheet_status INTO v_target_status
  FROM public.acct_requisition_sheets
  WHERE id = p_target_sheet_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target sheet not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_status <> 'Open' THEN
    RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05';
  END IF;

  SELECT * INTO v_source
  FROM public.acct_requisition_line_items
  WHERE id = p_source_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source line item not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_source.requisition_status NOT IN ('On Hold', 'Rejected', 'Pending Review') THEN
    RAISE EXCEPTION 'Only On Hold, Rejected, or Pending Review line items can be imported.' USING ERRCODE = 'VAL05';
  END IF;
  IF v_source.imported_to_sheet_id IS NOT NULL THEN
    RAISE EXCEPTION 'This line item has already been imported.' USING ERRCODE = 'STA06';
  END IF;
  IF v_source.import_dismissed THEN
    RAISE EXCEPTION 'This line item has been dismissed and cannot be imported.' USING ERRCODE = 'STA07';
  END IF;
  IF v_source.sheet_id = p_target_sheet_id THEN
    RAISE EXCEPTION 'Cannot import an item into the same sheet it belongs to.' USING ERRCODE = 'STA06';
  END IF;

  -- The Fund Request row is locked before the child is created. This makes
  -- pointer movement serializable with approval and other imports.
  IF v_source.source_fund_request_id IS NOT NULL THEN
    PERFORM 1
    FROM public.fund_requests
    WHERE fund_request_id = v_source.source_fund_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fund Request source link is invalid.' USING ERRCODE = 'STA06';
    END IF;
  END IF;

  INSERT INTO public.acct_requisition_line_items (
    sheet_id, created_by, imported_from_item_id, source_requisition_id,
    source_fund_request_id, credit_ledger_id,
    account_sub_title_id, account_sub_title_text, particulars, particulars_id,
    beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name,
    beneficiary_bank_id, debit_bank_ac_type, req_amount, payment_mode,
    cheque_no, cheque_date, work_order_no
  ) VALUES (
    p_target_sheet_id, p_imported_by, v_source.id, v_source.source_requisition_id,
    v_source.source_fund_request_id, v_source.credit_ledger_id,
    v_source.account_sub_title_id, v_source.account_sub_title_text, v_source.particulars,
    v_source.particulars_id, v_source.beneficiary_ac_no, v_source.beneficiary_name,
    v_source.beneficiary_ifsc, v_source.beneficiary_bank_name, v_source.beneficiary_bank_id,
    v_source.debit_bank_ac_type, v_source.req_amount, v_source.payment_mode,
    v_source.cheque_no, v_source.cheque_date, v_source.work_order_no
  ) RETURNING * INTO v_new_item;

  UPDATE public.acct_requisition_line_items
  SET imported_to_sheet_id = p_target_sheet_id,
      imported_at = now(),
      imported_by = p_imported_by,
      updated_at = now()
  WHERE id = p_source_item_id
    AND imported_to_sheet_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This line item was imported concurrently.' USING ERRCODE = 'STA06';
  END IF;

  IF v_source.source_fund_request_id IS NOT NULL THEN
    UPDATE public.fund_requests
    SET accounts_line_item_id = v_new_item.id,
        accounts_imported_at = now(),
        updated_at = now()
    WHERE fund_request_id = v_source.source_fund_request_id
      AND accounts_line_item_id = v_source.id;
    GET DIAGNOSTICS v_pointer_updated = ROW_COUNT;
    IF v_pointer_updated <> 1 THEN
      RAISE EXCEPTION 'Fund Request Accounts lineage changed while this item was being imported.' USING ERRCODE = 'STA06';
    END IF;
  END IF;

  RETURN v_new_item;
END;
$$;

REVOKE ALL ON FUNCTION public.import_acct_line_item_transact(uuid, uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_acct_line_item_transact(uuid, uuid, varchar) TO service_role;

-- Delete an Open-sheet line item and restore its parent/source pointer in one
-- transaction. This replaces controller-side DELETE + separate pointer updates.
CREATE OR REPLACE FUNCTION public.delete_acct_line_item_transact(
  p_sheet_id uuid,
  p_line_item_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sheet_status varchar;
  v_item public.acct_requisition_line_items;
  v_parent public.acct_requisition_line_items;
  v_fr public.fund_requests;
  v_req public.requisitions;
BEGIN
  SELECT sheet_status INTO v_sheet_status
  FROM public.acct_requisition_sheets
  WHERE id = p_sheet_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition sheet not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_sheet_status <> 'Open' THEN
    RAISE EXCEPTION 'Line items can only be deleted while the sheet is Open.' USING ERRCODE = 'STA01';
  END IF;

  SELECT * INTO v_item
  FROM public.acct_requisition_line_items
  WHERE id = p_line_item_id AND sheet_id = p_sheet_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_item.requisition_status IS NOT NULL THEN
    RAISE EXCEPTION 'Only unsent Open-sheet line items can be deleted.' USING ERRCODE = 'STA01';
  END IF;

  IF v_item.imported_from_item_id IS NOT NULL THEN
    SELECT * INTO v_parent
    FROM public.acct_requisition_line_items
    WHERE id = v_item.imported_from_item_id
    FOR UPDATE;
  END IF;

  IF v_item.source_fund_request_id IS NOT NULL THEN
    SELECT * INTO v_fr
    FROM public.fund_requests
    WHERE fund_request_id = v_item.source_fund_request_id
    FOR UPDATE;
  END IF;

  IF v_item.source_requisition_id IS NOT NULL THEN
    SELECT * INTO v_req
    FROM public.requisitions
    WHERE requisition_id = v_item.source_requisition_id
    FOR UPDATE;
  END IF;

  DELETE FROM public.acct_requisition_line_items WHERE id = p_line_item_id;

  IF v_parent.id IS NOT NULL THEN
    UPDATE public.acct_requisition_sheets
    SET deleted_item_restore_count = deleted_item_restore_count + 1,
        updated_at = now()
    WHERE id = p_sheet_id
      AND v_parent.imported_to_sheet_id = p_sheet_id;

    UPDATE public.acct_requisition_line_items
    SET imported_to_sheet_id = NULL, imported_at = NULL, imported_by = NULL, updated_at = now()
    WHERE id = v_parent.id AND imported_to_sheet_id = p_sheet_id;
  END IF;

  IF v_fr.fund_request_id IS NOT NULL AND v_fr.accounts_line_item_id = p_line_item_id THEN
    IF v_parent.id IS NOT NULL AND v_parent.source_fund_request_id = v_fr.fund_request_id THEN
      UPDATE public.fund_requests
      SET accounts_line_item_id = v_parent.id, accounts_imported_at = now(), updated_at = now()
      WHERE fund_request_id = v_fr.fund_request_id;
    ELSE
      UPDATE public.fund_requests
      SET accounts_line_item_id = NULL, accounts_imported_at = NULL, updated_at = now()
      WHERE fund_request_id = v_fr.fund_request_id;
    END IF;
  END IF;

  IF v_req.requisition_id IS NOT NULL AND v_req.accounts_line_item_id = p_line_item_id THEN
    IF v_parent.id IS NOT NULL AND v_parent.source_requisition_id = v_req.requisition_id THEN
      UPDATE public.requisitions
      SET accounts_line_item_id = v_parent.id, accounts_imported_at = now(), updated_at = now()
      WHERE requisition_id = v_req.requisition_id;
    ELSE
      UPDATE public.requisitions
      SET accounts_line_item_id = NULL, accounts_imported_at = NULL, updated_at = now()
      WHERE requisition_id = v_req.requisition_id;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_acct_line_item_transact(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_acct_line_item_transact(uuid, uuid) TO service_role;

-- Empty-sheet cleanup also reports restorations already performed while
-- deleting child rows from that sheet, preserving the existing API contract.
CREATE OR REPLACE FUNCTION public.delete_empty_acct_sheet_transact(
  p_sheet_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_restored_count integer := 0;
  v_sheet_restore_count integer := 0;
  v_source record;
BEGIN
  SELECT deleted_item_restore_count INTO v_sheet_restore_count
  FROM public.acct_requisition_sheets
  WHERE id = p_sheet_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_source IN
    SELECT li.id, li.source_requisition_id, li.source_fund_request_id
    FROM public.acct_requisition_line_items li
    WHERE li.imported_to_sheet_id = p_sheet_id
    FOR UPDATE
  LOOP
    UPDATE public.acct_requisition_line_items
    SET imported_to_sheet_id = NULL, imported_at = NULL, imported_by = NULL, updated_at = now()
    WHERE id = v_source.id;
    v_restored_count := v_restored_count + 1;

    IF v_source.source_requisition_id IS NOT NULL THEN
      UPDATE public.requisitions
      SET accounts_line_item_id = NULL, accounts_imported_at = NULL, updated_at = now()
      WHERE requisition_id = v_source.source_requisition_id
        AND accounts_line_item_id = v_source.id;
    END IF;

    IF v_source.source_fund_request_id IS NOT NULL THEN
      UPDATE public.fund_requests
      SET accounts_line_item_id = NULL, accounts_imported_at = NULL, updated_at = now()
      WHERE fund_request_id = v_source.source_fund_request_id
        AND accounts_line_item_id = v_source.id;
    END IF;
  END LOOP;

  DELETE FROM public.acct_requisition_sheets WHERE id = p_sheet_id;
  RETURN v_restored_count + COALESCE(v_sheet_restore_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_empty_acct_sheet_transact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_empty_acct_sheet_transact(uuid) TO service_role;

-- Keep the existing final submit function, but add the Fund Request/Credit
-- business-rule validation at the database boundary.
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
      req_amount IS NULL OR payment_mode IS NULL OR debit_bank_ac_type IS NULL
      OR (payment_mode = 'Cheque' AND (cheque_no IS NULL OR cheque_date IS NULL))
      OR (payment_mode = 'Bulk NEFT' AND (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL))
      OR (payment_mode = 'Credit' AND (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL OR beneficiary_bank_name IS NULL))
      OR (payment_mode = 'Credit' AND COALESCE(debit_bank_ac_type, '') <> 'Credit')
      OR (debit_bank_ac_type = 'Credit' AND COALESCE(payment_mode, '') <> 'Credit')
      OR (source_fund_request_id IS NOT NULL AND (payment_mode = 'Credit' OR debit_bank_ac_type = 'Credit' OR credit_ledger_id IS NOT NULL))
    );
  IF v_invalid > 0 THEN
    RAISE EXCEPTION '% row(s) missing required fields or have inconsistent Credit/Fund Request fields.', v_invalid USING ERRCODE = 'VAL02';
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

-- Direct Credit Approved calls must not accept Fund Request-derived rows.
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
  SELECT * INTO v_item FROM public.acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;
  IF v_item.requisition_status <> 'Pending HO Review' THEN
    RAISE EXCEPTION 'HO can only act on Pending HO Review items. Current: %', v_item.requisition_status USING ERRCODE = 'STA01';
  END IF;
  IF v_item.source_fund_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'Fund Request line items cannot use Credit Approved.' USING ERRCODE = 'VAL13';
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
    v_item.beneficiary_bank_name, v_item.beneficiary_bank_id, true, now(), p_actioned_by, p_actioned_by
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

-- Keep the legacy compatibility name behind the same guarded implementation.
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

REVOKE ALL ON FUNCTION public.approve_credit_purchase_transact(uuid, varchar, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_credit_purchase_transact(uuid, varchar, text) TO service_role;
