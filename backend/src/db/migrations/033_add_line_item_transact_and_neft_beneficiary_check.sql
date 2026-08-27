-- Migration 033: two independent correctness fixes for accounts requisition
-- entry/submit, found in a code review of acctRequisition.controller.js.
--
-- 1. add_acct_line_item_transact: addLineItem previously checked
--    sheet_status = 'Open' via a plain SELECT, then INSERTed as a separate
--    round trip, with no row lock in between -- unlike submit_acct_sheet_transact,
--    which takes FOR UPDATE on the sheet. A submit landing in that window could
--    flip the sheet to 'Submitted' after the check but before the INSERT,
--    leaving a new item with requisition_status = NULL stranded on an
--    already-Submitted sheet: invisible to HO review (which filters on
--    requisition_status not null) yet still counted in the sheet's totals,
--    and blocking deleteSheetIfEmpty forever. Locking the sheet row FOR
--    UPDATE before the status check and doing the INSERT in the same
--    transaction closes that window, exactly as submit already does.
--
-- 2. submit_acct_sheet_transact: the VAL02 completeness check required
--    cheque_no/cheque_date only for payment_mode = 'Cheque', but never
--    required beneficiary_ac_no/beneficiary_ifsc/beneficiary_name for
--    'Bulk NEFT' -- the only mode that later feeds exportBulkNeft. (Plain
--    'NEFT'/'RTGS' line items are never bulk-exported, so they're
--    deliberately left alone here -- existing regression tests rely on
--    submitting them without beneficiary details.) That gap let a Bulk NEFT
--    line item reach HO approval and then exportBulkNeft with no
--    beneficiary details at all, producing a bank-authorization workbook
--    with blank beneficiary cells for what the export service's own docs
--    describe as a legally binding document.

CREATE OR REPLACE FUNCTION "public"."add_acct_line_item_transact"(
    p_sheet_id   uuid,
    p_created_by varchar,
    p_item       jsonb
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_sheet_status varchar;
    v_item         acct_requisition_line_items;
BEGIN
    SELECT sheet_status INTO v_sheet_status
    FROM acct_requisition_sheets WHERE id = p_sheet_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found.'; END IF;
    IF v_sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Line items can only be added while the sheet is Open.' USING ERRCODE = 'STA01';
    END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by,
        account_sub_title_id, account_sub_title_text, particulars, particulars_id,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name,
        debit_bank_ac_type, req_amount, payment_mode, cheque_no, cheque_date
    )
    SELECT
        p_sheet_id, p_created_by,
        (p_item->>'account_sub_title_id')::uuid, p_item->>'account_sub_title_text',
        p_item->>'particulars', (p_item->>'particulars_id')::uuid,
        p_item->>'beneficiary_ac_no', p_item->>'beneficiary_name',
        p_item->>'beneficiary_ifsc', p_item->>'beneficiary_bank_name',
        p_item->>'debit_bank_ac_type', (p_item->>'req_amount')::numeric,
        p_item->>'payment_mode', p_item->>'cheque_no', p_item->>'cheque_date'
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

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
               AND (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL)));
    IF v_invalid > 0 THEN
        RAISE EXCEPTION '% row(s) missing required fields.', v_invalid USING ERRCODE = 'VAL02';
    END IF;

    UPDATE acct_requisition_sheets
    SET sheet_status = 'Submitted', submitted_by = p_submitted_by,
        submitted_at = now(), row_count_at_submission = v_row_count, updated_at = now()
    WHERE id = p_sheet_id RETURNING * INTO v_sheet;

    UPDATE acct_requisition_line_items
    SET requisition_status = 'Pending HO Review', updated_at = now()
    WHERE sheet_id = p_sheet_id;

    RETURN v_sheet;
END; $$;
