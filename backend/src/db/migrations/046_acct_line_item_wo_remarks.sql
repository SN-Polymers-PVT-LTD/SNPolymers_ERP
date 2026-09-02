-- Migration 046: Work Order No. and Remarks on Accounts Requisition line items.
--
-- Two new optional fields on the Accounts entry screen. Work Order No. is a
-- real FK into projects_master(work_order_no) (the table's own primary key)
-- — Accounts picks an existing work order from a dropdown, never free text.
-- Remarks is a plain free-text note, unrelated to ho_remarks (HO's own
-- decision remarks) or particulars (what the payment is for).
--
-- Both nullable — same "autosave blank until filled" convention every other
-- optional field on this form already uses (e.g. debit_bank_ac_type).

ALTER TABLE "public"."acct_requisition_line_items"
    ADD COLUMN "work_order_no" varchar,
    ADD COLUMN "remarks"       varchar;

ALTER TABLE "public"."acct_requisition_line_items"
    ADD CONSTRAINT "fk_arli_work_order" FOREIGN KEY (work_order_no) REFERENCES projects_master(work_order_no) ON DELETE RESTRICT;

-- Backs the new Work Order No. filter on the Requisition Details page.
CREATE INDEX "idx_arli_work_order" ON acct_requisition_line_items (work_order_no) WHERE work_order_no IS NOT NULL;

-- ----------------------------------------------------------------------------
-- add_acct_line_item_transact: widen the INSERT column list to include the
-- two new fields. Full body reproduced from 033_add_line_item_transact_and_neft_beneficiary_check.sql
-- with just those two additions — nothing else in this function has been
-- redefined since 033 (confirmed by grep across the migration chain; the
-- only other hits are comment references in 034/041).
-- ----------------------------------------------------------------------------
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
        debit_bank_ac_type, req_amount, payment_mode, cheque_no, cheque_date,
        work_order_no, remarks
    )
    SELECT
        p_sheet_id, p_created_by,
        (p_item->>'account_sub_title_id')::uuid, p_item->>'account_sub_title_text',
        p_item->>'particulars', (p_item->>'particulars_id')::uuid,
        p_item->>'beneficiary_ac_no', p_item->>'beneficiary_name',
        p_item->>'beneficiary_ifsc', p_item->>'beneficiary_bank_name',
        p_item->>'debit_bank_ac_type', (p_item->>'req_amount')::numeric,
        p_item->>'payment_mode', p_item->>'cheque_no', p_item->>'cheque_date',
        p_item->>'work_order_no', p_item->>'remarks'
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;
