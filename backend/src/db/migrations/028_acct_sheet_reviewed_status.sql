-- Migration 028: A real "Reviewed" sheet status, auto-synced from line items
--
-- Prior behavior: acct_requisition_sheets.sheet_status only ever held 'Open'
-- or 'Submitted' (chk_sheet_status). Once submitted, a sheet stayed
-- 'Submitted' forever in the UI regardless of how much of HO's review was
-- actually done — the only place that tracked progress was each line item's
-- own requisition_status. notifyAcctSheetReviewComplete already computed
-- "no more Pending HO Review / On Hold items left" as a one-off signal to
-- fire a Telegram message, but never persisted it — so a fully-reviewed
-- sheet just sat in the HO queue (and on the Accounts sheet list) looking
-- unfinished forever, with no way to tell it apart from one still awaiting
-- review.
--
-- New behavior: a trigger on acct_requisition_line_items keeps
-- acct_requisition_sheets.sheet_status in sync with its own items, in both
-- directions:
--   - Submitted -> Reviewed, the moment the last Pending HO Review / On Hold
--     item on the sheet clears (same boundary as the existing Telegram
--     summary).
--   - Reviewed -> Submitted, if a previously-decided item goes back to
--     Pending HO Review (via reopen_acct_line_item_transact, or a returned
--     item being resubmitted) — a sheet-level "reopen" for free, without a
--     dedicated Reopen Sheet endpoint, since sheet_status is now purely
--     derived from item state rather than independently managed.
--
-- Driven by a trigger (not duplicated in every RPC/controller that can
-- change requisition_status) so it can't drift out of sync with whichever
-- code path touched the item — single-item action, batch action, resubmit,
-- and reopen all flow through the same one place.

ALTER TABLE "public"."acct_requisition_sheets" DROP CONSTRAINT "chk_sheet_status";
ALTER TABLE "public"."acct_requisition_sheets" ADD CONSTRAINT "chk_sheet_status"
    CHECK (sheet_status IN ('Open', 'Submitted', 'Reviewed'));

CREATE OR REPLACE FUNCTION "public"."sync_acct_sheet_review_status"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_pending_count integer;
BEGIN
    IF NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN
        SELECT count(*) INTO v_pending_count
        FROM acct_requisition_line_items
        WHERE sheet_id = NEW.sheet_id
          AND requisition_status IN ('Pending HO Review', 'On Hold');

        IF v_pending_count = 0 THEN
            UPDATE acct_requisition_sheets
            SET sheet_status = 'Reviewed', updated_at = now()
            WHERE id = NEW.sheet_id AND sheet_status = 'Submitted';
        ELSE
            UPDATE acct_requisition_sheets
            SET sheet_status = 'Submitted', updated_at = now()
            WHERE id = NEW.sheet_id AND sheet_status = 'Reviewed';
        END IF;
    END IF;
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS "trg_sync_acct_sheet_review_status" ON "public"."acct_requisition_line_items";
CREATE TRIGGER "trg_sync_acct_sheet_review_status"
    AFTER UPDATE ON "public"."acct_requisition_line_items"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."sync_acct_sheet_review_status"();

-- Backfill: apply the same rule to every sheet that already exists, so
-- already-fully-reviewed sheets pick up 'Reviewed' immediately rather than
-- waiting for their next item update.
UPDATE acct_requisition_sheets s
SET sheet_status = 'Reviewed', updated_at = now()
WHERE s.sheet_status = 'Submitted'
  AND EXISTS (SELECT 1 FROM acct_requisition_line_items li WHERE li.sheet_id = s.id)
  AND NOT EXISTS (
    SELECT 1 FROM acct_requisition_line_items li
    WHERE li.sheet_id = s.id
      AND li.requisition_status IN ('Pending HO Review', 'On Hold')
  );
