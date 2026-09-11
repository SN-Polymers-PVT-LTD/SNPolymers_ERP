-- Migration 043: installments imported from the Credit Ledger now carry
-- over the original purchase's Particulars and Account Sub-title.
--
-- import_credit_installment_transact (042) previously only prefilled
-- beneficiary/dealer identity fields, leaving Particulars blank (well,
-- synthesized as 'Credit installment — <dealer name>') and Account
-- Sub-title empty — Accounts had to retype both by hand on every single
-- installment of the same purchase. Now both are copied straight from the
-- purchase's own source line item (credit_ledger.source_line_item_id),
-- same as every other field Accounts would otherwise have to re-enter.
-- req_amount/debit_bank_ac_type/payment_mode remain deliberately blank —
-- those vary per installment.

CREATE OR REPLACE FUNCTION "public"."import_credit_installment_transact"(
    p_ledger_id       uuid,
    p_target_sheet_id uuid,
    p_imported_by     varchar
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_sheet_status varchar;
    v_ledger       credit_ledger;
    v_beneficiary  beneficiary_master;
    v_source       acct_requisition_line_items;
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

    -- NEW: pull Particulars/Account Sub-title from the original purchase.
    SELECT * INTO v_source FROM acct_requisition_line_items WHERE id = v_ledger.source_line_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source purchase line item not found.'; END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by, credit_ledger_id,
        particulars, particulars_id, account_sub_title_id, account_sub_title_text,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name
    ) VALUES (
        p_target_sheet_id, p_imported_by, p_ledger_id,
        v_source.particulars, v_source.particulars_id, v_source.account_sub_title_id, v_source.account_sub_title_text,
        v_beneficiary.account_number, v_beneficiary.beneficiary_name,
        v_beneficiary.ifsc, v_beneficiary.beneficiary_bank_name
    ) RETURNING * INTO v_new_item;

    RETURN v_new_item;
END; $$;
