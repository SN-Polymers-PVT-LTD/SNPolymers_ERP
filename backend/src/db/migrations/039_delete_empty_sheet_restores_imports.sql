-- Migration 039: Discarding an empty sheet restores any item imported into it
--
-- imported_to_sheet_id (034_add_line_item_import.sql) is ON DELETE RESTRICT,
-- so a sheet that once received an imported item can never be hard-deleted
-- afterward even if that imported copy is later removed from the sheet
-- (deleteLineItem) before the sheet is ever submitted -- the sheet has 0
-- current items (deleteSheetIfEmpty's own guard is satisfied) but Postgres
-- still blocks the DELETE with a foreign key violation, since some OTHER
-- item elsewhere still points imported_to_sheet_id at this sheet.
--
-- Rather than just reporting that failure, the right fix is to restore the
-- source item's eligibility: the copy that was imported into this sheet is
-- gone (deleted before submit), and the sheet itself is about to be
-- discarded, so there is nothing left recording that import ever completed
-- -- clearing imported_to_sheet_id/imported_at/imported_by puts the source
-- item back in the "eligible to import" list, exactly as if it had never
-- been imported, and then the sheet can be deleted normally.
CREATE OR REPLACE FUNCTION "public"."delete_empty_acct_sheet_transact"(
    p_sheet_id uuid
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    v_restored_count integer;
BEGIN
    UPDATE acct_requisition_line_items
    SET imported_to_sheet_id = NULL,
        imported_at = NULL,
        imported_by = NULL,
        updated_at = now()
    WHERE imported_to_sheet_id = p_sheet_id;
    GET DIAGNOSTICS v_restored_count = ROW_COUNT;

    DELETE FROM acct_requisition_sheets WHERE id = p_sheet_id;

    RETURN v_restored_count;
END; $$;
