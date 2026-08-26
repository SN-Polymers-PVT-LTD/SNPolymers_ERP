-- Migration: 021_create_accounts_ho_approval.sql
-- Description: Accounts Department HO Approval Requisition Sheet - tables, indexes, RLS,
-- RPCs, and triggers. See docs/accounts_ho_approval_technical_design_v5.md Section 3 for full design
-- rationale (NB1/NB2/NB3/S1-S6/B1-B4/H1-H3 fixes referenced in comments below).

-- ============================================================================
-- 1. bank_balance_master
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."bank_balance_master" (
    "id"               uuid          DEFAULT gen_random_uuid() NOT NULL,
    "bank_name"        varchar       NOT NULL,
    "balance_date"     date          NOT NULL,
    "available_balance" numeric(18,2) NOT NULL,
    "created_by"       varchar       NOT NULL,
    "created_at"       timestamptz   DEFAULT now() NOT NULL,
    "updated_by"       varchar       NOT NULL,
    "updated_at"       timestamptz   DEFAULT now() NOT NULL,
    CONSTRAINT "bank_balance_master_pkey"       PRIMARY KEY ("id"),
    CONSTRAINT "uq_bank_balance_master_name"    UNIQUE ("bank_name"),
    CONSTRAINT "chk_bank_balance_non_negative"  CHECK (available_balance >= 0),
    CONSTRAINT "fk_bbm_created_by" FOREIGN KEY (created_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_bbm_updated_by" FOREIGN KEY (updated_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

-- ============================================================================
-- 2. account_sub_title_master
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."account_sub_title_master" (
    "id"         uuid    DEFAULT gen_random_uuid() NOT NULL,
    "title"      varchar NOT NULL,
    "is_active"  boolean NOT NULL DEFAULT true,
    "created_by" varchar NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_by" varchar,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "account_sub_title_master_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_account_sub_title"          UNIQUE (title),
    CONSTRAINT "fk_astm_created_by" FOREIGN KEY (created_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_astm_updated_by" FOREIGN KEY (updated_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

-- ============================================================================
-- 3. beneficiary_master
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."beneficiary_master" (
    "id"                uuid    DEFAULT gen_random_uuid() NOT NULL,
    "account_number"    varchar NOT NULL,
    "ifsc"              varchar NOT NULL,
    "beneficiary_name"  varchar NOT NULL,
    "beneficiary_bank_name" varchar NOT NULL,
    "last_used_at"      timestamptz,
    "created_by"        varchar NOT NULL,
    "created_at"        timestamptz DEFAULT now() NOT NULL,
    "updated_by"        varchar,
    "updated_at"        timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "beneficiary_master_pkey"    PRIMARY KEY ("id"),
    CONSTRAINT "uq_beneficiary_acno_ifsc"   UNIQUE (account_number, ifsc),
    CONSTRAINT "fk_bm_created_by"  FOREIGN KEY (created_by)  REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_bm_updated_by"  FOREIGN KEY (updated_by)  REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

-- ============================================================================
-- 4. acct_requisition_sheets
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."acct_requisition_sheets" (
    "id"            uuid        DEFAULT gen_random_uuid() NOT NULL,
    "sheet_number"  varchar     NOT NULL,
    "sheet_status"  varchar     NOT NULL DEFAULT 'Open',
    "created_by"    varchar     NOT NULL,
    "created_at"    timestamptz DEFAULT now() NOT NULL,
    "submitted_by"  varchar,
    "submitted_at"  timestamptz,
    "row_count_at_submission" integer,
    "updated_at"    timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "acct_requisition_sheets_pkey"                  PRIMARY KEY ("id"),
    CONSTRAINT "acct_requisition_sheets_sheet_number_key"      UNIQUE ("sheet_number"),
    CONSTRAINT "chk_sheet_status" CHECK (sheet_status IN ('Open', 'Submitted')),
    CONSTRAINT "fk_ars_created_by"   FOREIGN KEY (created_by)   REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_ars_submitted_by" FOREIGN KEY (submitted_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

-- ============================================================================
-- 5. acct_requisition_line_items - NB1 + NB2 fix
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."acct_requisition_line_items" (
    "id"              uuid          DEFAULT gen_random_uuid() NOT NULL,
    "sheet_id"        uuid          NOT NULL,

    -- -- Accounts-side fields (product doc Section 6) ----------------------------------
    "account_sub_title_id"   uuid,
    "account_sub_title_text" varchar,
    "particulars"       text,
    "beneficiary_ac_no" varchar,
    "beneficiary_name"  varchar,
    "beneficiary_ifsc"  varchar,
    "beneficiary_bank_name" varchar,
    -- FK to bank_balance_master via the unique bank_name column (valid because UNIQUE(bank_name) exists)
    "debit_bank_ac_type" varchar,
    "req_amount"        numeric(18,2),
    "payment_mode"      varchar,
    "cheque_no"         varchar,
    "cheque_date"       varchar,

    -- -- Workflow status --------------------------------------------------------
    -- NB2 FIX: NULL while sheet is Open (no DEFAULT). First value 'Pending HO Review'
    -- is set by submit_acct_sheet_transact, making the submit a genuine NULL->value transition
    -- that the audit trigger can detect with IS DISTINCT FROM. The CHECK allows NULL.
    "requisition_status" varchar,
    "revision_number"   integer     NOT NULL DEFAULT 0,
    "is_reopened"       boolean     NOT NULL DEFAULT false,
    "reopened_by"       varchar,
    "reopened_at"       timestamptz,
    "reopen_remark"     text,

    -- -- Live HO decision (current cycle only) ---------------------------------
    -- NB1 FIX: these three columns are always cleared together on resubmit/reopen.
    -- The CHECK constraint governs these; because ho_process is also cleared on resubmit,
    -- the constraint can never be violated by the resubmit path.
    "ho_process"        varchar,
    "ho_actioned_by"    varchar,    -- which HO user took this cycle's action (B1 fix)
    "ho_actioned_at"    timestamptz,
    "ho_pass_amount"    numeric(18,2),
    "ho_remarks"        text,

    -- -- Last-cycle HO decision (for UI display across resubmit/reopen cycles) -
    -- NB1 FIX: resubmit/reopen populate these from the live columns before clearing them.
    -- LastHoActionTag and ReopenedBadge read from here, not from the live columns.
    "last_ho_process"       varchar,
    "last_ho_remarks"       text,
    "last_ho_actioned_by"   varchar,
    "last_ho_actioned_at"   timestamptz,

    -- Set on Approved/Partially Approved - which bank balance row was debited
    "bank_balance_master_id" uuid,

    -- -- Bulk NEFT export flag (product doc Section 10) -----------------------------
    "neft_exported"     boolean     NOT NULL DEFAULT false,
    "neft_exported_at"  timestamptz,
    "neft_exported_by"  varchar,

    -- -- Audit fields ----------------------------------------------------------
    "created_by"    varchar     NOT NULL,
    "created_at"    timestamptz DEFAULT now() NOT NULL,
    "updated_at"    timestamptz DEFAULT now() NOT NULL,

    CONSTRAINT "acct_requisition_line_items_pkey" PRIMARY KEY ("id"),
    -- NB2 FIX: CHECK allows NULL (pre-submission rows have no status yet)
    CONSTRAINT "chk_arli_status" CHECK (requisition_status IS NULL OR requisition_status IN (
        'Pending HO Review', 'Approved', 'Partially Approved',
        'On Hold', 'Returned for Correction', 'Rejected'
    )),
    CONSTRAINT "chk_arli_ho_process" CHECK (ho_process IS NULL OR ho_process IN (
        'Approved', 'Partially Approved', 'Returned for Correction', 'Hold', 'Rejected'
    )),
    -- NB1 FIX: all three live-cycle fields share one consistency check.
    -- Valid because all three are always cleared together on resubmit/reopen.
    CONSTRAINT "chk_arli_ho_actor_consistency" CHECK (
        (ho_process IS NULL) = (ho_actioned_by IS NULL)
    ),
    CONSTRAINT "chk_arli_req_amount"       CHECK (req_amount IS NULL OR req_amount > 0),
    CONSTRAINT "chk_arli_ho_pass_amount"   CHECK (
        ho_pass_amount IS NULL OR (ho_pass_amount > 0 AND ho_pass_amount <= req_amount)
    ),
    CONSTRAINT "chk_arli_payment_mode"     CHECK (payment_mode IS NULL OR payment_mode IN (
        'Cheque', 'Bulk NEFT', 'RTGS', 'NEFT'
    )),
    CONSTRAINT "fk_arli_sheet"       FOREIGN KEY (sheet_id)        REFERENCES acct_requisition_sheets(id)    ON DELETE RESTRICT,
    CONSTRAINT "fk_arli_sub_title"   FOREIGN KEY (account_sub_title_id) REFERENCES account_sub_title_master(id) ON DELETE RESTRICT,
    CONSTRAINT "fk_arli_debit_bank"  FOREIGN KEY (debit_bank_ac_type)   REFERENCES bank_balance_master(bank_name) ON DELETE RESTRICT,
    CONSTRAINT "fk_arli_bbm_id"      FOREIGN KEY (bank_balance_master_id) REFERENCES bank_balance_master(id)   ON DELETE RESTRICT,
    CONSTRAINT "fk_arli_created_by"      FOREIGN KEY (created_by)      REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_arli_ho_actioned_by"  FOREIGN KEY (ho_actioned_by)  REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_arli_reopened_by"     FOREIGN KEY (reopened_by)     REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_arli_neft_exported_by" FOREIGN KEY (neft_exported_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

-- ============================================================================
-- 6. Indexes (7 total - idx_bm_acno_ifsc intentionally omitted, see note)
-- ============================================================================

-- Sheet status filter (HO sees only Submitted sheets)
CREATE INDEX "idx_ars_sheet_status"
    ON acct_requisition_sheets (sheet_status)
    WHERE sheet_status = 'Open';

-- Parent-sheet join
CREATE INDEX "idx_arli_sheet_id"
    ON acct_requisition_line_items (sheet_id);

-- HO queue: pending items across all submitted sheets
CREATE INDEX "idx_arli_status_pending"
    ON acct_requisition_line_items (requisition_status)
    WHERE requisition_status = 'Pending HO Review';

-- Days-on-hold indicator
CREATE INDEX "idx_arli_status_on_hold"
    ON acct_requisition_line_items (requisition_status, created_at)
    WHERE requisition_status = 'On Hold';

-- Account sub-title partial-text search
CREATE INDEX "idx_astm_title_lower"
    ON account_sub_title_master (lower(title));

-- Bulk NEFT export: Approved/Partially Approved Bulk NEFT rows per sheet
CREATE INDEX "idx_arli_neft_export"
    ON acct_requisition_line_items (sheet_id, payment_mode, requisition_status)
    WHERE payment_mode = 'Bulk NEFT';

-- Balance guardrail: fast sum of approved deductions per bank (used in approve RPC step 5)
CREATE INDEX "idx_arli_debit_bank_approved"
    ON acct_requisition_line_items (debit_bank_ac_type, requisition_status)
    WHERE requisition_status IN ('Approved', 'Partially Approved');

-- NOTE: idx_bm_acno_ifsc is intentionally NOT created - uq_beneficiary_acno_ifsc
-- UNIQUE(account_number, ifsc) on beneficiary_master already creates a backing index.

-- ============================================================================
-- 7. Row Level Security - S1: house pattern is ENABLE RLS with no CREATE POLICY
-- ============================================================================
ALTER TABLE "public"."bank_balance_master"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."account_sub_title_master"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."beneficiary_master"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."acct_requisition_sheets"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."acct_requisition_line_items"  ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 8. RPC: create_acct_sheet_transact - B4 fix (sheet number generation is atomic with INSERT)
-- ============================================================================
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

    -- Serialize same-date sheet creation: advisory lock scoped to this transaction.
    -- hashtext produces a stable integer key from the date string; lock releases on COMMIT/ROLLBACK.
    -- UNIQUE(sheet_number) is the DB backstop.
    PERFORM pg_advisory_xact_lock(hashtext('acct_sheet_' || v_date_str));

    -- Safe inside the advisory lock - no concurrent session can enter this block for the same date.
    SELECT COUNT(*) + 1 INTO v_seq
    FROM acct_requisition_sheets
    WHERE sheet_number LIKE v_date_str || '-%';

    v_sheet_no := v_date_str || '-' || v_seq;

    INSERT INTO acct_requisition_sheets (sheet_number, sheet_status, created_by)
    VALUES (v_sheet_no, 'Open', p_created_by)
    RETURNING * INTO v_sheet;

    RETURN v_sheet;
END; $$;

-- ============================================================================
-- 9. RPC: submit_acct_sheet_transact
-- ============================================================================
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
           OR (payment_mode = 'Cheque' AND (cheque_no IS NULL OR cheque_date IS NULL)));
    IF v_invalid > 0 THEN
        RAISE EXCEPTION '% row(s) missing required fields.', v_invalid USING ERRCODE = 'VAL02';
    END IF;

    UPDATE acct_requisition_sheets
    SET sheet_status = 'Submitted', submitted_by = p_submitted_by,
        submitted_at = now(), row_count_at_submission = v_row_count, updated_at = now()
    WHERE id = p_sheet_id RETURNING * INTO v_sheet;

    -- NB2 fix: requisition_status is NULL at this point (no DEFAULT on the column).
    -- This UPDATE is a genuine NULL -> 'Pending HO Review' transition the audit trigger detects.
    UPDATE acct_requisition_line_items
    SET requisition_status = 'Pending HO Review', updated_at = now()
    WHERE sheet_id = p_sheet_id;

    RETURN v_sheet;
END; $$;

-- ============================================================================
-- 10. RPC: approve_acct_line_item_transact
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."approve_acct_line_item_transact"(
    p_line_item_id   uuid,
    p_ho_process     varchar,    -- 'Approved' | 'Partially Approved'
    p_ho_pass_amount numeric,
    p_actioned_by    varchar,    -- B1 fix: HO user
    p_ho_remarks     text DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item            acct_requisition_line_items;
    v_bbm             bank_balance_master;
    v_total_approved  numeric(18,2);
    v_projected_bal   numeric(18,2);
    v_pass_amount     numeric(18,2);
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status NOT IN ('Pending HO Review', 'On Hold') THEN
        RAISE EXCEPTION 'HO can only approve Pending HO Review or On Hold items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    IF p_ho_process = 'Approved' THEN
        v_pass_amount := v_item.req_amount;
    ELSIF p_ho_process = 'Partially Approved' THEN
        v_pass_amount := p_ho_pass_amount;
        IF v_pass_amount IS NULL OR v_pass_amount <= 0 OR v_pass_amount > v_item.req_amount THEN
            RAISE EXCEPTION 'ho_pass_amount must be > 0 and <= req_amount.' USING ERRCODE = 'VAL01';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid ho_process for approve RPC: %. Use the non-approve RPC for Hold/Return/Reject.', p_ho_process;
    END IF;

    -- Single-row-per-bank (H3 fix): select by bank_name directly, no ORDER BY LIMIT 1
    SELECT * INTO v_bbm FROM bank_balance_master
        WHERE bank_name = v_item.debit_bank_ac_type FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank Balance Master entry not found: %', v_item.debit_bank_ac_type USING ERRCODE = 'BNK01';
    END IF;

    -- STATUS-FLAG gated, NOT date-window gated. See design doc Section 9 for rationale.
    SELECT COALESCE(SUM(ho_pass_amount), 0) INTO v_total_approved
    FROM acct_requisition_line_items
    WHERE debit_bank_ac_type = v_item.debit_bank_ac_type
      AND requisition_status IN ('Approved', 'Partially Approved');

    v_projected_bal := v_bbm.available_balance - v_total_approved - v_pass_amount;

    IF v_projected_bal < 0 THEN
        RAISE EXCEPTION 'Approval would drive % balance below zero. Remaining: %, Requested: %.',
            v_item.debit_bank_ac_type,
            (v_bbm.available_balance - v_total_approved),
            v_pass_amount USING ERRCODE = 'BAL01';
    END IF;

    UPDATE acct_requisition_line_items
    SET
        requisition_status     = CASE WHEN p_ho_process = 'Approved' THEN 'Approved' ELSE 'Partially Approved' END,
        ho_process             = p_ho_process,
        ho_pass_amount         = v_pass_amount,
        ho_remarks             = p_ho_remarks,
        ho_actioned_by         = p_actioned_by,
        ho_actioned_at         = now(),
        bank_balance_master_id = v_bbm.id,
        updated_at             = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

-- ============================================================================
-- 11. RPC: act_acct_line_item_non_approve_transact (Hold / Return / Reject) - H2 fix
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."act_acct_line_item_non_approve_transact"(
    p_line_item_id uuid,
    p_action       varchar,    -- 'Hold' | 'Return' | 'Reject'
    p_actioned_by  varchar,
    p_ho_remarks   text
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item          acct_requisition_line_items;
    v_new_status    varchar;
    v_new_process   varchar;
BEGIN
    IF p_action NOT IN ('Hold', 'Return', 'Reject') THEN
        RAISE EXCEPTION 'Invalid action %. Must be Hold, Return, or Reject.', p_action;
    END IF;

    IF p_ho_remarks IS NULL OR trim(p_ho_remarks) = '' THEN
        RAISE EXCEPTION 'ho_remarks is required for % action.', p_action USING ERRCODE = 'VAL03';
    END IF;

    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status NOT IN ('Pending HO Review', 'On Hold') THEN
        RAISE EXCEPTION 'HO can only act on Pending HO Review or On Hold items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    IF p_action = 'Hold' AND v_item.requisition_status = 'On Hold' THEN
        RAISE EXCEPTION 'Item is already On Hold.' USING ERRCODE = 'STA02';
    END IF;

    v_new_status  := CASE p_action WHEN 'Hold' THEN 'On Hold' WHEN 'Return' THEN 'Returned for Correction' WHEN 'Reject' THEN 'Rejected' END;
    v_new_process := CASE p_action WHEN 'Hold' THEN 'Hold'    WHEN 'Return' THEN 'Returned for Correction' WHEN 'Reject' THEN 'Rejected' END;

    UPDATE acct_requisition_line_items
    SET
        requisition_status = v_new_status,
        ho_process         = v_new_process,
        ho_remarks         = p_ho_remarks,
        ho_actioned_by     = p_actioned_by,
        ho_actioned_at     = now(),
        updated_at         = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

-- ============================================================================
-- 12. RPC: resubmit_acct_line_item_transact (Accounts resubmit after Return) - NB1 fix
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."resubmit_acct_line_item_transact"(
    p_line_item_id uuid,
    p_resubmitted_by varchar,
    p_account_sub_title_id   uuid DEFAULT NULL,
    p_account_sub_title_text varchar DEFAULT NULL,
    p_particulars            text DEFAULT NULL,
    p_beneficiary_ac_no      varchar DEFAULT NULL,
    p_beneficiary_name       varchar DEFAULT NULL,
    p_beneficiary_ifsc       varchar DEFAULT NULL,
    p_beneficiary_bank_name  varchar DEFAULT NULL,
    p_debit_bank_ac_type     varchar DEFAULT NULL,
    p_req_amount             numeric DEFAULT NULL,
    p_payment_mode           varchar DEFAULT NULL,
    p_cheque_no              varchar DEFAULT NULL,
    p_cheque_date            varchar DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item acct_requisition_line_items;
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Returned for Correction' THEN
        RAISE EXCEPTION 'Only Returned for Correction items can be resubmitted. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA03';
    END IF;

    IF p_req_amount IS NULL OR p_payment_mode IS NULL OR
       (p_payment_mode = 'Cheque' AND (p_cheque_no IS NULL OR p_cheque_date IS NULL)) THEN
        RAISE EXCEPTION 'req_amount and payment_mode (plus cheque fields if Cheque) are required to resubmit.'
            USING ERRCODE = 'VAL02';
    END IF;

    UPDATE acct_requisition_line_items
    SET
        requisition_status   = 'Pending HO Review',
        revision_number      = v_item.revision_number + 1,

        -- NB1 FIX: copy live HO fields -> last_ho_* before clearing the live set.
        -- The audit trigger sees OLD.ho_process (still set) before this UPDATE commits,
        -- so the audit event captures the prior decision. last_ho_* columns let the UI
        -- display "Last HO action: Returned for Correction - [remarks]" after resubmit.
        last_ho_process      = v_item.ho_process,
        last_ho_remarks      = v_item.ho_remarks,
        last_ho_actioned_by  = v_item.ho_actioned_by,
        last_ho_actioned_at  = v_item.ho_actioned_at,

        -- Clear live HO fields: HO hasn't acted on this revision yet.
        -- With ho_process also cleared, the CHECK constraint (ho_process IS NULL) = (ho_actioned_by IS NULL)
        -- evaluates (TRUE) = (TRUE) = TRUE - no violation.
        ho_process           = NULL,
        ho_actioned_by       = NULL,
        ho_actioned_at       = NULL,
        ho_pass_amount       = NULL,
        ho_remarks           = NULL,

        -- Update Accounts-side fields
        account_sub_title_id   = COALESCE(p_account_sub_title_id, account_sub_title_id),
        account_sub_title_text = COALESCE(p_account_sub_title_text, account_sub_title_text),
        particulars            = COALESCE(p_particulars, particulars),
        beneficiary_ac_no      = COALESCE(p_beneficiary_ac_no, beneficiary_ac_no),
        beneficiary_name       = COALESCE(p_beneficiary_name, beneficiary_name),
        beneficiary_ifsc       = COALESCE(p_beneficiary_ifsc, beneficiary_ifsc),
        beneficiary_bank_name  = COALESCE(p_beneficiary_bank_name, beneficiary_bank_name),
        debit_bank_ac_type     = COALESCE(p_debit_bank_ac_type, debit_bank_ac_type),
        req_amount             = COALESCE(p_req_amount, req_amount),
        payment_mode           = COALESCE(p_payment_mode, payment_mode),
        -- S3 FIX (documented): cheque_no/cheque_date are bare assignments, not COALESCE.
        -- This is intentional: if the Accounts user switches payment_mode away from Cheque,
        -- the old cheque number must be cleared rather than preserved. The caller sends NULL
        -- for non-Cheque submissions. Unlike the other fields, a stale cheque_no on a
        -- payment_mode=NEFT row would be actively misleading.
        cheque_no              = p_cheque_no,
        cheque_date            = p_cheque_date,
        updated_at             = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

-- ============================================================================
-- 13. RPC: reopen_acct_line_item_transact (authorized HO reopen from Rejected) - NB1 fix
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."reopen_acct_line_item_transact"(
    p_line_item_id  uuid,
    p_reopened_by   varchar,
    p_reopen_remark text
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item acct_requisition_line_items;
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Rejected' THEN
        RAISE EXCEPTION 'Only Rejected items can be reopened. Current: %', v_item.requisition_status
            USING ERRCODE = 'STA04';
    END IF;

    IF p_reopen_remark IS NULL OR trim(p_reopen_remark) = '' THEN
        RAISE EXCEPTION 'reopen_remark is required.' USING ERRCODE = 'VAL04';
    END IF;

    UPDATE acct_requisition_line_items
    SET
        requisition_status = 'Pending HO Review',
        is_reopened         = true,
        reopened_by          = p_reopened_by,
        reopened_at           = now(),
        reopen_remark         = p_reopen_remark,

        -- NB1 FIX: copy live HO fields -> last_ho_* before clearing.
        last_ho_process      = v_item.ho_process,
        last_ho_remarks      = v_item.ho_remarks,
        last_ho_actioned_by  = v_item.ho_actioned_by,
        last_ho_actioned_at  = v_item.ho_actioned_at,

        -- Clear all live HO decision fields (HO reviews fresh)
        ho_process           = NULL,
        ho_pass_amount       = NULL,
        ho_remarks           = NULL,
        ho_actioned_by       = NULL,
        ho_actioned_at       = NULL,
        updated_at           = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;

-- ============================================================================
-- 14. updated_at trigger functions (S2 fix: one per table)
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."set_acct_sheet_updated_at"()         RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION "public"."set_acct_line_item_updated_at"()     RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION "public"."set_bank_balance_updated_at"()       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION "public"."set_acct_sub_title_updated_at"()     RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION "public"."set_beneficiary_master_updated_at"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

-- ============================================================================
-- 15. Audit trigger functions - NB2 fix: relies on NULL->value transition
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."audit_acct_sheet_events"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'CREATE', 'Acct Requisition Sheet', NEW.id::VARCHAR, NULL,
            jsonb_build_object('sheet_number', NEW.sheet_number, 'sheet_status', NEW.sheet_status));

  ELSIF TG_OP = 'UPDATE' AND NEW.sheet_status IS DISTINCT FROM OLD.sheet_status THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.submitted_by, 'SHEET_SUBMITTED', 'Acct Requisition Sheet', NEW.id::VARCHAR,
            jsonb_build_object('sheet_status', OLD.sheet_status),
            jsonb_build_object('sheet_status', NEW.sheet_status,
                               'sheet_number', NEW.sheet_number,
                               'row_count', NEW.row_count_at_submission,
                               'submitted_at', NEW.submitted_at));
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "public"."audit_acct_line_item_events"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_action VARCHAR;
  v_user   VARCHAR;
BEGIN
  -- INSERT = Accounts adding a new row to an Open sheet (requisition_status = NULL at this point)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'LINE_ITEM_ADDED', 'Acct Requisition Line Item', NEW.id::VARCHAR, NULL,
            jsonb_build_object('sheet_id', NEW.sheet_id, 'req_amount', NEW.req_amount,
                               'payment_mode', NEW.payment_mode));
    RETURN NEW;
  END IF;

  -- All workflow transitions are UPDATEs. Only fire when requisition_status actually changes.
  -- NB2 fix: this guard now also fires when OLD.requisition_status IS NULL (first submit),
  -- because NULL IS DISTINCT FROM 'Pending HO Review' = TRUE.
  IF TG_OP = 'UPDATE' AND NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN

    CASE NEW.requisition_status

      WHEN 'Pending HO Review' THEN
        -- NB2 fix: distinguish first-submit (OLD = NULL), resubmit (revision incremented), reopen.
        -- S5 FIX: reopen detection uses NEW.reopened_at IS DISTINCT FROM OLD.reopened_at, NOT
        -- NEW.is_reopened AND NOT OLD.is_reopened. is_reopened is set once and never reset,
        -- so the flag-based check only fires on the first reopen. reopened_at is stamped on
        -- every reopen call, so the timestamp discriminator correctly fires on every cycle.
        IF OLD.requisition_status IS NULL THEN
          -- First submission: all items transition NULL -> 'Pending HO Review'
          v_action := 'PENDING_HO_REVIEW_FIRST_SUBMIT';
          v_user   := NEW.created_by;
        ELSIF NEW.reopened_at IS DISTINCT FROM OLD.reopened_at THEN
          -- Reopen from Rejected (any cycle - fires correctly on 2nd, 3rd, ... reopen too)
          v_action := 'REOPEN';
          v_user   := NEW.reopened_by;
        ELSIF NEW.revision_number > OLD.revision_number THEN
          -- Resubmit after Returned for Correction
          v_action := 'RESUBMIT_AFTER_CORRECTION';
          -- ho_actioned_by on the row is NULL here (cleared by resubmit RPC).
          -- Prior HO decision is in audit_log + last_ho_actioned_by on the row.
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
      ELSE
        v_action := 'STATUS_CHANGE';
        v_user   := COALESCE(NEW.ho_actioned_by, NEW.created_by);
    END CASE;

    -- Also log "Leaving Hold" when Hold -> anything else
    -- NB: this and the INSERT below can both fire within the same UPDATE's trigger
    -- invocation. now() (= transaction_timestamp()) is frozen for the whole transaction,
    -- so two audit_log rows written here would get an IDENTICAL timestamp with no
    -- tiebreaker (id is a random uuid, not sequential) — readers sorting by
    -- `timestamp ASC` would then see these two rows in an undefined relative order.
    -- clock_timestamp() gives each INSERT its own real wall-clock value instead.
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

-- ============================================================================
-- 16. Hard-delete prevention trigger functions - S2/NB3 fix
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."prevent_acct_sheet_hard_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of acct_requisition_sheets records is permanently prohibited.';
END; $$;

-- NB3 FIX: conditional guard - allows DELETE only while the item is pre-submission (NULL status).
CREATE OR REPLACE FUNCTION "public"."prevent_acct_line_item_hard_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- OLD.requisition_status IS NULL <-> the row has never been submitted (Open-phase item).
  -- This is the only lifecycle window where real deletion is permitted (product doc Section 2, "add/remove rows freely").
  IF OLD.requisition_status IS NOT NULL THEN
    RAISE EXCEPTION
      'Hard deletion of submitted acct_requisition_line_items is permanently prohibited. Current status: %.',
      OLD.requisition_status;
  END IF;
  RETURN OLD;  -- allow the DELETE to proceed
END; $$;

CREATE OR REPLACE FUNCTION "public"."prevent_acct_master_hard_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of Accounts master table records is permanently prohibited.';
END; $$;

-- ============================================================================
-- 17. Trigger bindings - 12 total (2 audit + 5 updated_at + 5 hard-delete)
-- ============================================================================
CREATE OR REPLACE TRIGGER "trg_audit_acct_sheets"
    AFTER INSERT OR UPDATE ON acct_requisition_sheets
    FOR EACH ROW EXECUTE FUNCTION audit_acct_sheet_events();

CREATE OR REPLACE TRIGGER "trg_audit_acct_line_items"
    AFTER INSERT OR UPDATE ON acct_requisition_line_items
    FOR EACH ROW EXECUTE FUNCTION audit_acct_line_item_events();

CREATE OR REPLACE TRIGGER "trg_acct_sheet_updated_at"         BEFORE UPDATE ON acct_requisition_sheets      FOR EACH ROW EXECUTE FUNCTION set_acct_sheet_updated_at();
CREATE OR REPLACE TRIGGER "trg_acct_line_item_updated_at"     BEFORE UPDATE ON acct_requisition_line_items  FOR EACH ROW EXECUTE FUNCTION set_acct_line_item_updated_at();
CREATE OR REPLACE TRIGGER "trg_bank_balance_updated_at"       BEFORE UPDATE ON bank_balance_master          FOR EACH ROW EXECUTE FUNCTION set_bank_balance_updated_at();
CREATE OR REPLACE TRIGGER "trg_acct_sub_title_updated_at"     BEFORE UPDATE ON account_sub_title_master     FOR EACH ROW EXECUTE FUNCTION set_acct_sub_title_updated_at();
CREATE OR REPLACE TRIGGER "trg_beneficiary_master_updated_at" BEFORE UPDATE ON beneficiary_master           FOR EACH ROW EXECUTE FUNCTION set_beneficiary_master_updated_at();

CREATE OR REPLACE TRIGGER "trg_prevent_acct_sheet_hard_delete"     BEFORE DELETE ON acct_requisition_sheets     FOR EACH ROW EXECUTE FUNCTION prevent_acct_sheet_hard_delete();
CREATE OR REPLACE TRIGGER "trg_prevent_acct_line_item_hard_delete"  BEFORE DELETE ON acct_requisition_line_items FOR EACH ROW EXECUTE FUNCTION prevent_acct_line_item_hard_delete();
CREATE OR REPLACE TRIGGER "trg_prevent_bank_balance_hard_delete"    BEFORE DELETE ON bank_balance_master         FOR EACH ROW EXECUTE FUNCTION prevent_acct_master_hard_delete();
CREATE OR REPLACE TRIGGER "trg_prevent_sub_title_hard_delete"       BEFORE DELETE ON account_sub_title_master    FOR EACH ROW EXECUTE FUNCTION prevent_acct_master_hard_delete();
CREATE OR REPLACE TRIGGER "trg_prevent_beneficiary_hard_delete"     BEFORE DELETE ON beneficiary_master          FOR EACH ROW EXECUTE FUNCTION prevent_acct_master_hard_delete();

-- ============================================================================
-- 18-19. Grants - house pattern (see plan note: deviates from design doc's
-- invented GRANT SELECT/INSERT/UPDATE + REVOKE ALL FROM anon syntax, which has
-- no precedent in this schema; access control is via the Express service-role
-- layer bypassing RLS, matching every other table in this repo).
-- ============================================================================
GRANT ALL ON TABLE "public"."bank_balance_master"         TO anon, authenticated, service_role;
GRANT ALL ON TABLE "public"."account_sub_title_master"    TO anon, authenticated, service_role;
GRANT ALL ON TABLE "public"."beneficiary_master"          TO anon, authenticated, service_role;
GRANT ALL ON TABLE "public"."acct_requisition_sheets"     TO anon, authenticated, service_role;
GRANT ALL ON TABLE "public"."acct_requisition_line_items" TO anon, authenticated, service_role;
