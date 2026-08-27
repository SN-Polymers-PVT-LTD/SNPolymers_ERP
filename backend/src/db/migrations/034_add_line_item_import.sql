-- Migration 034: Import On Hold / Rejected line items into a new sheet
--
-- Once HO marks a line item On Hold or Rejected, it sits on its original
-- (already Submitted/Reviewed) sheet forever -- there was no way to bring
-- that same request back as a fresh line item on a later sheet. Accounts
-- had to manually re-key the whole thing from scratch.
--
-- This adds a manual, Accounts-only "import" action: On Hold/Rejected items
-- across ALL previous sheets accumulate in an eligible list; Accounts picks
-- which ones to copy into a newly created Open sheet as brand-new line
-- items, fully prefilled. The source item is left completely untouched --
-- its requisition_status and every other observable field stay exactly as
-- they were, forever (this table's audit trail is append-only, enforced by
-- prevent_acct_sheet_hard_delete in 030). Only new bookkeeping columns
-- record that it's been imported, so it can't be imported a second time.
--
-- A separate "dismiss" flag lets Accounts hide stale items from the
-- eligible list without a real delete, for the same append-only reason.

ALTER TABLE "public"."acct_requisition_line_items"
    ADD COLUMN "imported_to_sheet_id"  uuid REFERENCES acct_requisition_sheets(id) ON DELETE RESTRICT,
    ADD COLUMN "imported_at"           timestamptz,
    ADD COLUMN "imported_by"           varchar REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    ADD COLUMN "import_dismissed"      boolean NOT NULL DEFAULT false,
    ADD COLUMN "import_dismissed_at"   timestamptz,
    ADD COLUMN "import_dismissed_by"   varchar REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    ADD COLUMN "imported_from_item_id" uuid REFERENCES acct_requisition_line_items(id) ON DELETE RESTRICT;

-- Eligible-list query: On Hold/Rejected items, never imported, never dismissed.
-- Partial index keeps this cheap as historical sheets accumulate -- eligible
-- rows are a small, shrinking-over-time subset of the whole table.
CREATE INDEX "idx_arli_importable"
    ON acct_requisition_line_items (created_at DESC)
    WHERE requisition_status IN ('On Hold', 'Rejected')
      AND imported_to_sheet_id IS NULL
      AND import_dismissed = false;

-- ============================================================================
-- RPC: import_acct_line_item_transact
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."import_acct_line_item_transact"(
    p_source_item_id  uuid,
    p_target_sheet_id uuid,
    p_imported_by     varchar
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_source       acct_requisition_line_items;
    v_sheet_status varchar;
    v_new_item     acct_requisition_line_items;
BEGIN
    -- Lock target sheet first, same "lock sheet before item" ordering as
    -- add_acct_line_item_transact/submit_acct_sheet_transact (033).
    SELECT sheet_status INTO v_sheet_status
    FROM acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.'; END IF;
    IF v_sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05';
    END IF;

    SELECT * INTO v_source
    FROM acct_requisition_line_items WHERE id = p_source_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source line item not found.'; END IF;

    IF v_source.requisition_status NOT IN ('On Hold', 'Rejected') THEN
        RAISE EXCEPTION 'Only On Hold or Rejected line items can be imported.' USING ERRCODE = 'VAL05';
    END IF;
    IF v_source.imported_to_sheet_id IS NOT NULL THEN
        RAISE EXCEPTION 'This line item has already been imported.' USING ERRCODE = 'STA06';
    END IF;
    IF v_source.import_dismissed THEN
        RAISE EXCEPTION 'This line item has been dismissed and cannot be imported.' USING ERRCODE = 'STA07';
    END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by, imported_from_item_id,
        account_sub_title_id, account_sub_title_text, particulars, particulars_id,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name,
        debit_bank_ac_type, req_amount, payment_mode, cheque_no, cheque_date
    ) VALUES (
        p_target_sheet_id, p_imported_by, v_source.id,
        v_source.account_sub_title_id, v_source.account_sub_title_text,
        v_source.particulars, v_source.particulars_id,
        v_source.beneficiary_ac_no, v_source.beneficiary_name,
        v_source.beneficiary_ifsc, v_source.beneficiary_bank_name,
        v_source.debit_bank_ac_type, v_source.req_amount, v_source.payment_mode,
        v_source.cheque_no, v_source.cheque_date
    ) RETURNING * INTO v_new_item;

    UPDATE acct_requisition_line_items
    SET imported_to_sheet_id = p_target_sheet_id,
        imported_at = now(),
        imported_by = p_imported_by,
        updated_at = now()
    WHERE id = p_source_item_id;

    RETURN v_new_item;
END; $$;
