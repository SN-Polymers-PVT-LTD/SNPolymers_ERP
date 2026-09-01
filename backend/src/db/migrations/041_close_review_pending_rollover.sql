-- Migration 041: HO can close a sheet's review early; leftover undecided
-- items join the existing Hold/Reject rollover queue as a new terminal
-- status, 'Pending Review', instead of blocking the sheet forever.
--
-- Mirrors 034/036/037's Hold/Reject rollover exactly: no copy-on-close, no
-- new table. A 'Pending HO Review' item just gets a new terminal status
-- value once HO explicitly ends the review session, and from that point on
-- it's handled by the same importable-queue machinery that already exists.
--
-- 'Returned for Correction' items are untouched by this — they keep their
-- own same-sheet resubmit loop (resubmit_acct_line_item_transact), and the
-- sheet-status trigger (028/037) already reopens a Reviewed sheet back to
-- Submitted the moment one of those gets resubmitted. That behavior is not
-- modified here.

-- ----------------------------------------------------------------------------
-- 1. Widen the status CHECK constraint.
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."acct_requisition_line_items" DROP CONSTRAINT "chk_arli_status";
ALTER TABLE "public"."acct_requisition_line_items" ADD CONSTRAINT "chk_arli_status"
    CHECK (requisition_status IS NULL OR requisition_status IN (
        'Pending HO Review', 'Approved', 'Partially Approved',
        'On Hold', 'Returned for Correction', 'Rejected', 'Pending Review'
    ));

-- ----------------------------------------------------------------------------
-- 2. RPC: close_acct_sheet_review_transact
--    HO-only. Sweeps every remaining 'Pending HO Review' item on the sheet
--    into 'Pending Review', then marks the sheet 'Reviewed' directly (not
--    relying solely on the trigger cascade — if the sheet already has zero
--    Pending HO Review items when this is called, the bulk UPDATE below
--    touches 0 rows and the trigger never fires, so this RPC still has to
--    set sheet_status itself as the real source of truth).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."close_acct_sheet_review_transact"(
    p_sheet_id    uuid,
    p_closed_by   varchar
) RETURNS acct_requisition_sheets LANGUAGE plpgsql AS $$
DECLARE
    v_sheet       acct_requisition_sheets;
    v_swept_count integer;
BEGIN
    SELECT * INTO v_sheet FROM acct_requisition_sheets WHERE id = p_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found.'; END IF;

    IF v_sheet.sheet_status <> 'Submitted' THEN
        RAISE EXCEPTION 'Only a Submitted sheet can have its review closed. Current: %',
            v_sheet.sheet_status USING ERRCODE = 'STA08';
    END IF;

    UPDATE acct_requisition_line_items
    SET requisition_status = 'Pending Review',
        updated_at = now()
    WHERE sheet_id = p_sheet_id
      AND requisition_status = 'Pending HO Review';
    GET DIAGNOSTICS v_swept_count = ROW_COUNT;

    -- Explicit, not just relying on sync_acct_sheet_review_status's own
    -- UPDATE — covers the 0-rows-swept case (sheet already fully decided,
    -- HO clicks Close Review anyway) where the trigger above never fires.
    UPDATE acct_requisition_sheets
    SET sheet_status = 'Reviewed', updated_at = now()
    WHERE id = p_sheet_id AND sheet_status = 'Submitted'
    RETURNING * INTO v_sheet;

    -- v_sheet may be stale (not re-selected) if the trigger already flipped
    -- it to Reviewed and this UPDATE's WHERE no longer matched — re-fetch
    -- to guarantee the return value is accurate either way.
    IF v_sheet IS NULL THEN
        SELECT * INTO v_sheet FROM acct_requisition_sheets WHERE id = p_sheet_id;
    END IF;

    RETURN v_sheet;
END; $$;

-- ----------------------------------------------------------------------------
-- 3. import_acct_line_item_transact: widen the importable-status guard.
--    Full function body reproduced from 034 with just the one IN-list and
--    its error message changed — keep everything else identical.
-- ----------------------------------------------------------------------------
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

    IF v_source.requisition_status NOT IN ('On Hold', 'Rejected', 'Pending Review') THEN
        RAISE EXCEPTION 'Only On Hold, Rejected, or Pending Review line items can be imported.' USING ERRCODE = 'VAL05';
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

-- ----------------------------------------------------------------------------
-- 4. Widen the importable-items partial index to cover the new status.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS "idx_arli_importable";
CREATE INDEX "idx_arli_importable"
    ON acct_requisition_line_items (created_at DESC)
    WHERE requisition_status IN ('On Hold', 'Rejected', 'Pending Review')
      AND imported_to_sheet_id IS NULL
      AND import_dismissed = false;

-- ----------------------------------------------------------------------------
-- 5. Audit trail: give 'Pending Review' its own action label instead of
--    falling through to the generic 'STATUS_CHANGE' ELSE branch.
--    Full function body reproduced from 021 (as last modified by 037) with
--    one new WHEN branch added — everything else identical.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."audit_acct_line_item_events"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_action VARCHAR;
  v_user   VARCHAR;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'LINE_ITEM_ADDED', 'Acct Requisition Line Item', NEW.id::VARCHAR, NULL,
            jsonb_build_object('sheet_id', NEW.sheet_id, 'req_amount', NEW.req_amount,
                               'payment_mode', NEW.payment_mode));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN

    CASE NEW.requisition_status

      WHEN 'Pending HO Review' THEN
        IF OLD.requisition_status IS NULL THEN
          v_action := 'PENDING_HO_REVIEW_FIRST_SUBMIT';
          v_user   := NEW.created_by;
        ELSIF NEW.reopened_at IS DISTINCT FROM OLD.reopened_at THEN
          v_action := 'REOPEN';
          v_user   := NEW.reopened_by;
        ELSIF NEW.revision_number > OLD.revision_number THEN
          v_action := 'RESUBMIT_AFTER_CORRECTION';
          v_user   := NEW.created_by;
        ELSE
          v_action := 'PENDING_HO_REVIEW_ENTER';
          v_user   := NEW.created_by;
        END IF;

      WHEN 'Approved', 'Partially Approved' THEN
        v_action := 'HO_APPROVED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'On Hold' THEN
        v_action := 'HO_HELD';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Returned for Correction' THEN
        v_action := 'HO_RETURNED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Rejected' THEN
        v_action := 'HO_REJECTED';
        v_user   := NEW.ho_actioned_by;
      -- NEW: swept aside by close_acct_sheet_review_transact. There's no
      -- per-item HO actor for this transition (it's a sheet-level action,
      -- not a per-item decision) — fall back to created_by, same convention
      -- RESUBMIT_AFTER_CORRECTION already uses for a non-HO-actioned event.
      WHEN 'Pending Review' THEN
        v_action := 'HO_CLOSED_REVIEW_UNDECIDED';
        v_user   := NEW.created_by;
      ELSE
        v_action := 'STATUS_CHANGE';
        v_user   := COALESCE(NEW.ho_actioned_by, NEW.created_by);
    END CASE;

    IF OLD.requisition_status = 'On Hold' AND NEW.requisition_status <> 'On Hold' THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
      VALUES (NEW.ho_actioned_by, 'HO_HOLD_RELEASED', 'Acct Requisition Line Item', NEW.id::VARCHAR,
              jsonb_build_object('requisition_status', OLD.requisition_status, 'ho_remarks', OLD.ho_remarks),
              jsonb_build_object('requisition_status', NEW.requisition_status),
              clock_timestamp());
    END IF;

    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
    VALUES (v_user, v_action, 'Acct Requisition Line Item', NEW.id::VARCHAR,
            jsonb_build_object('requisition_status', OLD.requisition_status,
                               'ho_process', OLD.ho_process,
                               'ho_actioned_by', OLD.ho_actioned_by,
                               'revision_number', OLD.revision_number),
            jsonb_build_object('requisition_status', NEW.requisition_status,
                               'ho_process', NEW.ho_process,
                               'ho_pass_amount', NEW.ho_pass_amount,
                               'ho_actioned_by', NEW.ho_actioned_by,
                               'bank_balance_master_id', NEW.bank_balance_master_id,
                               'revision_number', NEW.revision_number,
                               'is_reopened', NEW.is_reopened),
            clock_timestamp());
  END IF;
  RETURN NEW;
END; $$;

-- ----------------------------------------------------------------------------
-- 6. New filter: Particulars free-text search on the import-eligible list
--    (client asked for Particulars alongside the existing sub-title/date
--    filters). Same trigram-index pattern as 031's sub-title/beneficiary
--    indexes — pg_trgm is already enabled by that migration.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_arli_particulars_trgm"
    ON acct_requisition_line_items USING gin (particulars extensions.gin_trgm_ops);
