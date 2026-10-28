-- Migration 091: Reset Requisition payment_status on draft deletion
--
-- When a Payment Requisition line item is deleted from an Open Accounts Sheet,
-- or an empty Open Sheet containing imported line items is deleted:
-- 1. If the item was directly imported from the queue, reset payment_status
--    back to 'PENDING_ACCOUNTS_IMPORT' so the requisition reflects its queue state.
-- 2. If the item was imported from a parent 'On Hold' item, reset payment_status
--    back to 'ON_HOLD'.
-- 3. Backfill any existing orphan 'ACCOUNTS_DRAFT' rows with no accounts_line_item_id.

-- 1. Redefine delete_acct_line_item_transact
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
      SET accounts_line_item_id = v_parent.id,
          accounts_imported_at = now(),
          payment_status = 'ON_HOLD',
          updated_at = now()
      WHERE requisition_id = v_req.requisition_id;
    ELSE
      UPDATE public.requisitions
      SET accounts_line_item_id = NULL,
          accounts_imported_at = NULL,
          payment_status = 'PENDING_ACCOUNTS_IMPORT',
          updated_at = now()
      WHERE requisition_id = v_req.requisition_id;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_acct_line_item_transact(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_acct_line_item_transact(uuid, uuid) TO service_role;

-- 2. Redefine delete_empty_acct_sheet_transact
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
      SET accounts_line_item_id = NULL,
          accounts_imported_at = NULL,
          payment_status = 'PENDING_ACCOUNTS_IMPORT',
          updated_at = now()
      WHERE requisition_id = v_source.source_requisition_id
        AND accounts_line_item_id = v_source.id;
    END IF;

    IF v_source.source_fund_request_id IS NOT NULL THEN
      UPDATE public.fund_requests
      SET accounts_line_item_id = NULL,
          accounts_imported_at = NULL,
          updated_at = now()
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

-- 3. Backfill cleanup for existing unassigned rows
UPDATE public.requisitions
SET payment_status = 'PENDING_ACCOUNTS_IMPORT', updated_at = now()
WHERE payment_destination = 'ACCOUNTS'
  AND accounts_line_item_id IS NULL
  AND payment_status = 'ACCOUNTS_DRAFT'
  AND COALESCE(accounts_import_dismissed, false) = false;
