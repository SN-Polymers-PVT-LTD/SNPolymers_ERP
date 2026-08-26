-- Migration 030: Allow hard-deleting a sheet only when it's still Open and
-- has never had a single line item added to it.
--
-- acct_requisition_sheets' sheet_number is generated from
-- COUNT(*) WHERE sheet_number LIKE '<date>-%' (create_acct_sheet_transact,
-- 021_create_accounts_ho_approval.sql) — not a permanent sequence. A sheet
-- that's created (e.g. "New Sheet" clicked) and then abandoned or emptied
-- back out (every item added then deleted) with zero items permanently
-- burns its number for nothing: e.g. -2 exists forever with no -1 visible.
--
-- prevent_acct_sheet_hard_delete() previously blocked ALL deletes
-- unconditionally, which is the right call for any sheet that has ever had
-- real data on it (submitted, reviewed, approved, paid out — that history
-- must never be erasable). This narrows the guard to skip only the one case
-- where nothing has ever happened on the sheet: still Open, zero line items,
-- ever. Every other sheet — Submitted, Reviewed, or with even one item that
-- was later deleted (revision history still matters) — is still permanently
-- protected exactly as before.
CREATE OR REPLACE FUNCTION "public"."prevent_acct_sheet_hard_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sheet_status = 'Open' AND NOT EXISTS (
    SELECT 1 FROM acct_requisition_line_items WHERE sheet_id = OLD.id
  ) THEN
    RETURN OLD; -- allow: still Open, never had a single line item
  END IF;

  RAISE EXCEPTION 'Hard deletion of acct_requisition_sheets records is permanently prohibited.';
END; $$;
