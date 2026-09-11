-- Migration 035: Fix sheet_number collision after a deleted sheet
--
-- create_acct_sheet_transact (021) generated the next sheet_number as
-- COUNT(*) + 1 over existing sheet_number LIKE '<date>-%' rows. That's safe
-- as long as no sheet for that date is ever removed -- but
-- 030_allow_empty_open_sheet_delete.sql deliberately allows hard-deleting a
-- still-Open, zero-item sheet. Once that happens, COUNT(*) for the date
-- drops by one, so the next createSheet call recomputes a sequence number
-- that can collide with a still-existing, higher-numbered sheet created
-- later that same day -- a real unique-constraint violation on
-- acct_requisition_sheets_sheet_number_key, surfaced by a heavier test run
-- (delete an Open sheet, then create several more sheets the same day).
--
-- Fix: derive the next sequence number from the MAX numeric suffix actually
-- in use for that date, not from a row count. Gaps from deleted sheets are
-- preserved (matching 030's own rationale -- a deleted number is meant to
-- stay burned, not get silently reused) and no longer collide with anything
-- still on record. Advisory lock and UNIQUE(sheet_number) backstop unchanged.
CREATE OR REPLACE FUNCTION "public"."create_acct_sheet_transact"(
    p_created_by varchar,
    p_date       date DEFAULT CURRENT_DATE
) RETURNS acct_requisition_sheets LANGUAGE plpgsql AS $$
DECLARE
    v_date_str   varchar;
    v_seq        integer;
    v_sheet_no   varchar;
    v_sheet      acct_requisition_sheets;
BEGIN
    v_date_str := to_char(p_date, 'DDMMYYYY');

    PERFORM pg_advisory_xact_lock(hashtext('acct_sheet_' || v_date_str));

    SELECT COALESCE(MAX(substring(sheet_number FROM '-([0-9]+)$')::integer), 0) + 1 INTO v_seq
    FROM acct_requisition_sheets
    WHERE sheet_number LIKE v_date_str || '-%';

    v_sheet_no := v_date_str || '-' || v_seq;

    INSERT INTO acct_requisition_sheets (sheet_number, sheet_status, created_by)
    VALUES (v_sheet_no, 'Open', p_created_by)
    RETURNING * INTO v_sheet;

    RETURN v_sheet;
END; $$;
