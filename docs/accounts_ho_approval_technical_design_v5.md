# Accounts Department — HO Approval Requisition Sheet: Technical Design Document

> **Status:** DRAFT v3 — revised after second engineering review (2026-08-16)
> **Revision notes:** Addresses NB1 (CHECK constraint + resubmit conflict), NB2 (status default defeats audit trigger), S1 (RLS pattern clarification), S2 (master-table triggers missing), S3 (cheque field intent comment). All v2 fixes (B1–B4, H1–H3, smaller items) are preserved.
> **Product doc:** `accounts/ACCOUNTS_HO_Approval_Product_Description.md` + `accounts/HO_Approval_Business_Logic_v3.md`
> **Codebase branch:** `main` (as of 2026-08-16)
> **Primary analogue:** `fund_requests` / `requisitions` workflows — every design decision is anchored to those existing patterns unless noted otherwise.

---

## 1. Overview

This document translates the finalized Accounts Department HO Approval Requisition Sheet product description into a file-by-file implementation plan. The feature adds a **Requisition Sheet** batch workflow — Accounts batches payment requests into sheets, HO reviews each line item individually (5 possible decisions), approved amounts are atomically deducted from a manually-maintained Bank Balance Master, and approved Bulk NEFT items can be exported in the exact bank-required `.xlsx` format.

**Ground rule:** every design decision below points to an existing pattern in this repo. New tables follow the `fund_requests` column/constraint style. Status values use `VARCHAR + CHECK` (not Postgres ENUMs) — see §2c for justification. Audit triggers follow the `audit_fund_request_status_change` pattern ([`00_full_schema_dump.sql:674`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql#L674-L694)). Migration numbering continues from `020_create_estimate_quotations.sql`. Controllers follow [`fundRequests.controller.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/fundRequests.controller.js). Validation follows Zod schemas in [`validation/`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/validation/). Frontend API clients follow [`api/fundRequests.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/api/fundRequests.js).

---

## 2. State Machine — Canonical Status Values

### 2a. Sheet-Level Status (`sheet_status` on `acct_requisition_sheets`)

| Status | Terminal? | Who/What Sets It | Notes |
|---|---|---|---|
| `Open` | No | System on creation | Accounts-editable; not visible to HO |
| `Submitted` | Yes | Accounts (submit action) | Cannot un-submit; all rows transition to `Pending HO Review` via UPDATE |

### 2b. Line-Item Status (`requisition_status` on `acct_requisition_line_items`)

All status transitions are **UPDATEs on the existing row** — line items are INSERT-ed during the Open phase with `requisition_status = NULL` (no default). The first real value `'Pending HO Review'` is assigned by the submit RPC. This is the NB2 fix: making the first submit a genuine `NULL → 'Pending HO Review'` UPDATE that the audit trigger can detect via `NEW.requisition_status IS DISTINCT FROM OLD.requisition_status`.

| Status | Terminal? | Who/What Sets It | Notes |
|---|---|---|---|
| `NULL` | No | System on INSERT (Open phase) | Not yet submitted — item is still being drafted by Accounts |
| `Pending HO Review` | No | System on sheet submission (UPDATE); Accounts on resubmit (UPDATE); authorized HO on reopen (UPDATE) | `ho_process` IS NULL on first cycle; `last_ho_process` shows prior cycle on later cycles |
| `Approved` | Yes | HO via approve RPC | `ho_pass_amount` auto-set = `req_amount`; balance deducted |
| `Partially Approved` | Yes | HO via approve RPC | `ho_pass_amount` < `req_amount`; same deduction |
| `On Hold` | No | HO via non-approve RPC | `ho_remarks` required; days-on-hold shown in UI |
| `Returned for Correction` | No | HO via non-approve RPC | `ho_remarks` required; hands row back to Accounts |
| `Rejected` | Soft-lock | HO via non-approve RPC | Locked except via reopen (requires `ho.requisition.reopen` permission) |

### 2c. Status Column Type — VARCHAR + CHECK vs. Postgres ENUM

**Decision: `VARCHAR + CHECK`**, mirroring `fund_requests.request_status` ([`schema:313`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql#L313)) and `excess_fund_returns.status` ([`schema:144`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql#L144)).

The schema has both styles — `fund_request_status_enum` (ENUM, used on `fund_requests`) and `excess_fund_returns.status` (VARCHAR+CHECK). This feature has two status columns (`sheet_status`, `requisition_status`) and a third distinct decision field `ho_process`. The concrete risk from ENUM: `ALTER TYPE … ADD VALUE` cannot be run inside a transaction block in Supabase's Postgres version, blocking the ability to add any new status value in a safe migration rollout. VARCHAR+CHECK avoids this entirely and is the pattern chosen for comparable tables.

---

## 3. Database Layer

### 3a. New Tables

#### **Design decision — `bank_balance_master` data model**

**Single mutable row per bank account (`UNIQUE(bank_name)`).**

Product doc §3: "Available Balance is a baseline only — approved deductions and the live projection are calculated on top of it, never stored back." This describes a single authoritative snapshot per bank that Accounts manually updates when reconciling a statement — not a ledger. The approve RPC selects by `bank_name` PK directly (single row). The `PUT` endpoint is a true upsert on `bank_name`.

---

#### **NB1 fix — Column design for HO decision tracking**

The v2 design jammed two distinct needs into the same columns (`ho_process`, `ho_actioned_by`, `ho_actioned_at`):
1. **Live-cycle tracking:** who is acting on the item *right now*, for the CHECK constraint backstop.
2. **Last-cycle display:** what the HO decided in the *prior cycle*, for the `LastHoActionTag` UI component.

These cannot coexist in one column set because the resubmit RPC must clear `ho_actioned_by` (the live-cycle field, so the CHECK constraint passes) while the UI wants to keep showing the prior decision. The v2 CHECK `(ho_process IS NULL) = (ho_actioned_by IS NULL)` is correct for the live cycle — but clearing `ho_actioned_by` without clearing `ho_process` on resubmit violated it on every single Return → Resubmit.

**Fix: split into two independent column groups:**

- **Live cycle** (`ho_process`, `ho_actioned_by`, `ho_actioned_at`): current HO decision in progress. All three are cleared together on resubmit/reopen. The CHECK constraint governs these three. `ho_process` is also cleared on resubmit/reopen — it has no meaning between HO cycles.
- **Last cycle** (`last_ho_process`, `last_ho_remarks`, `last_ho_actioned_by`, `last_ho_actioned_at`): snapshot of the *previous* cycle's decision, populated by the resubmit/reopen RPC from the live-cycle values just before clearing them. The `LastHoActionTag` component and `ReopenedBadge` read from these columns, not the live ones.

This satisfies three previously-conflicting requirements simultaneously:
- CHECK constraint: `(ho_process IS NULL) = (ho_actioned_by IS NULL)` — valid because all three live columns clear together.
- Audit trigger: logs `OLD.ho_process`/`OLD.ho_actioned_by` from the row before the resubmit UPDATE, so the audit trail is unaffected by the column split.
- UI: `LastHoActionTag` reads `last_ho_process`/`last_ho_remarks`, which survive across resubmit/reopen cycles.

---

#### Table: `bank_balance_master` (§3, §13 of product doc)

```sql
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
```

#### Table: `account_sub_title_master` (§9 of product doc)

```sql
CREATE TABLE IF NOT EXISTS "public"."account_sub_title_master" (
    "id"         uuid    DEFAULT gen_random_uuid() NOT NULL,
    "title"      varchar NOT NULL,
    "is_active"  boolean NOT NULL DEFAULT true,
    "created_by" varchar NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    -- updated_by/updated_at added to support audit trail for title edits (product doc §9, smaller items fix)
    "updated_by" varchar,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "account_sub_title_master_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_account_sub_title"          UNIQUE (title),
    CONSTRAINT "fk_astm_created_by" FOREIGN KEY (created_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT "fk_astm_updated_by" FOREIGN KEY (updated_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);
```

#### Table: `beneficiary_master` (§8 of product doc)

```sql
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
```

#### Table: `acct_requisition_sheets` (§4 of product doc)

```sql
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
```

#### Table: `acct_requisition_line_items` (§5, §6 of product doc) — **NB1 + NB2 fix**

```sql
CREATE TABLE IF NOT EXISTS "public"."acct_requisition_line_items" (
    "id"              uuid          DEFAULT gen_random_uuid() NOT NULL,
    "sheet_id"        uuid          NOT NULL,

    -- ── Accounts-side fields (product doc §6) ──────────────────────────────────
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

    -- ── Workflow status ────────────────────────────────────────────────────────
    -- NB2 FIX: NULL while sheet is Open (no DEFAULT). First value 'Pending HO Review'
    -- is set by submit_acct_sheet_transact, making the submit a genuine NULL→value transition
    -- that the audit trigger can detect with IS DISTINCT FROM. The CHECK allows NULL.
    "requisition_status" varchar,
    "revision_number"   integer     NOT NULL DEFAULT 0,
    "is_reopened"       boolean     NOT NULL DEFAULT false,
    "reopened_by"       varchar,
    "reopened_at"       timestamptz,
    "reopen_remark"     text,

    -- ── Live HO decision (current cycle only) ─────────────────────────────────
    -- NB1 FIX: these three columns are always cleared together on resubmit/reopen.
    -- The CHECK constraint governs these; because ho_process is also cleared on resubmit,
    -- the constraint can never be violated by the resubmit path.
    "ho_process"        varchar,
    "ho_actioned_by"    varchar,    -- which HO user took this cycle's action (B1 fix)
    "ho_actioned_at"    timestamptz,
    "ho_pass_amount"    numeric(18,2),
    "ho_remarks"        text,

    -- ── Last-cycle HO decision (for UI display across resubmit/reopen cycles) ─
    -- NB1 FIX: resubmit/reopen populate these from the live columns before clearing them.
    -- LastHoActionTag and ReopenedBadge read from here, not from the live columns.
    "last_ho_process"       varchar,
    "last_ho_remarks"       text,
    "last_ho_actioned_by"   varchar,
    "last_ho_actioned_at"   timestamptz,

    -- Set on Approved/Partially Approved — which bank balance row was debited
    "bank_balance_master_id" uuid,

    -- ── Bulk NEFT export flag (product doc §10) ─────────────────────────────
    "neft_exported"     boolean     NOT NULL DEFAULT false,
    "neft_exported_at"  timestamptz,
    "neft_exported_by"  varchar,

    -- ── Audit fields ──────────────────────────────────────────────────────────
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
```

> **Note on `debit_bank_ac_type` FK:** valid because `bank_balance_master.bank_name` has `UNIQUE("bank_name")`. Postgres requires the referenced column to be unique/PK for a FK.

> **Note on `account_sub_title` storage:** stores both the UUID FK (`account_sub_title_id`) and denormalized text (`account_sub_title_text`) — same pattern as `requisitions` storing both `work_order_no` varchar and a FK to `projects_master`. Allows display without a join while maintaining referential integrity.

---

### 3b. Lifecycle Column-Value Trace

Walk of all relevant columns through the full create → submit → hold → return → resubmit → reject → reopen → approve lifecycle, to verify no constraint violations exist.

| Step | `requisition_status` | `ho_process` | `ho_actioned_by` | `last_ho_process` | `last_ho_actioned_by` | `revision_number` | `is_reopened` | CHECK passes? |
|---|---|---|---|---|---|---|---|---|
| INSERT (Accounts adds item to Open sheet) | `NULL` | `NULL` | `NULL` | `NULL` | `NULL` | 0 | false | ✅ NULL allowed |
| submit RPC bulk UPDATE | `Pending HO Review` | `NULL` | `NULL` | `NULL` | `NULL` | 0 | false | ✅ ho_process=NULL=ho_actioned_by |
| Hold | `On Hold` | `'Hold'` | `'ho_user_1'` | `NULL` | `NULL` | 0 | false | ✅ both non-null |
| Return (from On Hold) | `Returned for Correction` | `'Returned for Correction'` | `'ho_user_1'` | `NULL` | `NULL` | 0 | false | ✅ both non-null |
| Resubmit — clears live, copies to last_ | `Pending HO Review` | `NULL` | `NULL` | `'Returned for Correction'` | `'ho_user_1'` | 1 | false | ✅ ho_process=NULL=ho_actioned_by |
| Reject | `Rejected` | `'Rejected'` | `'ho_user_2'` | `'Returned for Correction'` | `'ho_user_1'` | 1 | false | ✅ both non-null |
| Reopen — clears live, copies to last_ | `Pending HO Review` | `NULL` | `NULL` | `'Rejected'` | `'ho_user_2'` | 1 | true | ✅ ho_process=NULL=ho_actioned_by |
| Approve | `Approved` | `'Approved'` | `'ho_user_2'` | `'Rejected'` | `'ho_user_2'` | 1 | true | ✅ both non-null |

Every row passes the CHECK constraint. `LastHoActionTag` reads `last_ho_process`/`last_ho_remarks` at rows where `revision_number > 0 OR is_reopened`, both of which survive the clear on resubmit/reopen.

---

### 3c. Indexes

```sql
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
```

> **Note:** `idx_bm_acno_ifsc` was removed in v2 — the `UNIQUE(account_number, ifsc)` constraint on `beneficiary_master` already creates a backing index.

---

### 3d. Audit Triggers — **NB2 fix: trigger relies on NULL→value transition**

**Root cause of original B2, restated clearly after NB2 fix:**
- v1 trigger: tried to detect resubmit/reopen on `INSERT` — wrong, those are UPDATEs.
- v2 trigger: fixed the branch logic, but `NOT NULL DEFAULT 'Pending HO Review'` meant the submit RPC's bulk UPDATE was a no-op (`'Pending HO Review' → 'Pending HO Review'`). `IS DISTINCT FROM` guard evaluated false; `PENDING_HO_REVIEW_FIRST_SUBMIT` was never logged.
- v3 trigger: `requisition_status` is now nullable. INSERT puts `NULL`; submit RPC puts `'Pending HO Review'`. The first submit is a genuine `NULL → 'Pending HO Review'` UPDATE. Trigger fires. The `WHEN 'Pending HO Review'` arm checks `OLD.requisition_status IS NULL` to identify the first-submit case.

```sql
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
          -- First submission: all items transition NULL → 'Pending HO Review'
          v_action := 'PENDING_HO_REVIEW_FIRST_SUBMIT';
          v_user   := NEW.created_by;
        ELSIF NEW.reopened_at IS DISTINCT FROM OLD.reopened_at THEN
          -- Reopen from Rejected (any cycle — fires correctly on 2nd, 3rd, ... reopen too)
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

    -- Also log "Leaving Hold" when Hold → anything else
    IF OLD.requisition_status = 'On Hold' AND NEW.requisition_status <> 'On Hold' THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (NEW.ho_actioned_by, 'HO_HOLD_RELEASED', 'Acct Requisition Line Item', NEW.id::VARCHAR,
              jsonb_build_object('requisition_status', OLD.requisition_status, 'ho_remarks', OLD.ho_remarks),
              jsonb_build_object('requisition_status', NEW.requisition_status));
    END IF;

    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
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
                               'is_reopened', NEW.is_reopened));
  END IF;
  RETURN NEW;
END; $$;

-- Trigger bindings (trg_* naming convention per schema:3282)
CREATE OR REPLACE TRIGGER "trg_audit_acct_sheets"
    AFTER INSERT OR UPDATE ON acct_requisition_sheets
    FOR EACH ROW EXECUTE FUNCTION audit_acct_sheet_events();

CREATE OR REPLACE TRIGGER "trg_audit_acct_line_items"
    AFTER INSERT OR UPDATE ON acct_requisition_line_items
    FOR EACH ROW EXECUTE FUNCTION audit_acct_line_item_events();

-- updated_at triggers (mirrors set_fund_request_updated_at, schema:1537)
-- S2 FIX: all 5 tables get updated_at triggers, not just the 2 main tables.
CREATE OR REPLACE FUNCTION "public"."set_acct_sheet_updated_at"()         RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION "public"."set_acct_line_item_updated_at"()     RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION "public"."set_bank_balance_updated_at"()       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION "public"."set_acct_sub_title_updated_at"()     RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION "public"."set_beneficiary_master_updated_at"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE OR REPLACE TRIGGER "trg_acct_sheet_updated_at"         BEFORE UPDATE ON acct_requisition_sheets      FOR EACH ROW EXECUTE FUNCTION set_acct_sheet_updated_at();
CREATE OR REPLACE TRIGGER "trg_acct_line_item_updated_at"     BEFORE UPDATE ON acct_requisition_line_items  FOR EACH ROW EXECUTE FUNCTION set_acct_line_item_updated_at();
CREATE OR REPLACE TRIGGER "trg_bank_balance_updated_at"       BEFORE UPDATE ON bank_balance_master          FOR EACH ROW EXECUTE FUNCTION set_bank_balance_updated_at();
CREATE OR REPLACE TRIGGER "trg_acct_sub_title_updated_at"     BEFORE UPDATE ON account_sub_title_master     FOR EACH ROW EXECUTE FUNCTION set_acct_sub_title_updated_at();
CREATE OR REPLACE TRIGGER "trg_beneficiary_master_updated_at" BEFORE UPDATE ON beneficiary_master           FOR EACH ROW EXECUTE FUNCTION set_beneficiary_master_updated_at();

-- Hard-delete prevention (mirrors prevent_fund_request_hard_delete, schema:1316)
-- S2 FIX: all 5 tables get hard-delete prevention, not just the 2 main tables.
-- NB3 FIX: acct_requisition_line_items IS the one exception — deleteLineItem is a documented,
-- spec-required endpoint for the Open phase. The trigger must allow DELETEs while the row
-- is still pre-submission (requisition_status IS NULL), and only block once the row has
-- entered the workflow (requisition_status IS NOT NULL). This diverges intentionally from
-- prevent_fund_request_hard_delete, which unconditionally raises because fund_requests has
-- no lifecycle phase that permits real deletion. acct_requisition_sheets also never needs
-- real deletion (the deleteLineItem gate already requires sheet to be Open, and sheets
-- themselves use cancel/archive patterns), so it stays unconditional.
CREATE OR REPLACE FUNCTION "public"."prevent_acct_sheet_hard_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of acct_requisition_sheets records is permanently prohibited.';
END; $$;

-- NB3 FIX: conditional guard — allows DELETE only while the item is pre-submission (NULL status).
CREATE OR REPLACE FUNCTION "public"."prevent_acct_line_item_hard_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- OLD.requisition_status IS NULL ↔ the row has never been submitted (Open-phase item).
  -- This is the only lifecycle window where real deletion is permitted (product doc §2, "add/remove rows freely").
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

CREATE OR REPLACE TRIGGER "trg_prevent_acct_sheet_hard_delete"     BEFORE DELETE ON acct_requisition_sheets     FOR EACH ROW EXECUTE FUNCTION prevent_acct_sheet_hard_delete();
CREATE OR REPLACE TRIGGER "trg_prevent_acct_line_item_hard_delete"  BEFORE DELETE ON acct_requisition_line_items FOR EACH ROW EXECUTE FUNCTION prevent_acct_line_item_hard_delete();
CREATE OR REPLACE TRIGGER "trg_prevent_bank_balance_hard_delete"    BEFORE DELETE ON bank_balance_master         FOR EACH ROW EXECUTE FUNCTION prevent_acct_master_hard_delete();
CREATE OR REPLACE TRIGGER "trg_prevent_sub_title_hard_delete"       BEFORE DELETE ON account_sub_title_master    FOR EACH ROW EXECUTE FUNCTION prevent_acct_master_hard_delete();
CREATE OR REPLACE TRIGGER "trg_prevent_beneficiary_hard_delete"     BEFORE DELETE ON beneficiary_master          FOR EACH ROW EXECUTE FUNCTION prevent_acct_master_hard_delete();
```

**Trigger count (S2/NB3 fix): 12 triggers total.**
- 2 audit triggers (`trg_audit_acct_sheets`, `trg_audit_acct_line_items`)
- 5 `updated_at` triggers (one per table)
- 5 hard-delete prevention triggers (one per table, with `trg_prevent_acct_line_item_hard_delete` being lifecycle-conditional per NB3 fix)

---

### 3e. Core RPC Functions

#### `create_acct_sheet_transact` — B4 fix (sheet number generation is atomic with INSERT)

```sql
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

    -- Safe inside the advisory lock — no concurrent session can enter this block for the same date.
    SELECT COUNT(*) + 1 INTO v_seq
    FROM acct_requisition_sheets
    WHERE sheet_number LIKE v_date_str || '-%';

    v_sheet_no := v_date_str || '-' || v_seq;

    INSERT INTO acct_requisition_sheets (sheet_number, sheet_status, created_by)
    VALUES (v_sheet_no, 'Open', p_created_by)
    RETURNING * INTO v_sheet;

    RETURN v_sheet;
END; $$;
```

---

#### `submit_acct_sheet_transact`

```sql
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
    -- This UPDATE is a genuine NULL → 'Pending HO Review' transition the audit trigger detects.
    UPDATE acct_requisition_line_items
    SET requisition_status = 'Pending HO Review', updated_at = now()
    WHERE sheet_id = p_sheet_id;

    RETURN v_sheet;
END; $$;
```

---

#### `approve_acct_line_item_transact`

```sql
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

    -- ⚠️ STATUS-FLAG gated, NOT date-window gated. See §9 for rationale.
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
```

---

#### `act_acct_line_item_non_approve_transact` (Hold / Return / Reject) — H2 fix

```sql
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
```

---

#### `resubmit_acct_line_item_transact` (Accounts resubmit after Return) — **NB1 fix**

```sql
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

        -- NB1 FIX: copy live HO fields → last_ho_* before clearing the live set.
        -- The audit trigger sees OLD.ho_process (still set) before this UPDATE commits,
        -- so the audit event captures the prior decision. last_ho_* columns let the UI
        -- display "Last HO action: Returned for Correction — [remarks]" after resubmit.
        last_ho_process      = v_item.ho_process,
        last_ho_remarks      = v_item.ho_remarks,
        last_ho_actioned_by  = v_item.ho_actioned_by,
        last_ho_actioned_at  = v_item.ho_actioned_at,

        -- Clear live HO fields: HO hasn't acted on this revision yet.
        -- With ho_process also cleared, the CHECK constraint (ho_process IS NULL) = (ho_actioned_by IS NULL)
        -- evaluates (TRUE) = (TRUE) = TRUE — no violation.
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
```

---

#### `reopen_acct_line_item_transact` (authorized HO reopen from Rejected) — **NB1 fix**

```sql
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
        is_reopened        = true,
        reopened_by        = p_reopened_by,
        reopened_at        = now(),
        reopen_remark      = p_reopen_remark,

        -- NB1 FIX: copy live HO fields → last_ho_* before clearing.
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
```

---

### 3f. Row Level Security — S1 clarification

**House pattern confirmed from schema:** the full schema dump contains `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for all 19 existing business tables ([`schema:3642–3699`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql#L3642-L3699)) and **zero `CREATE POLICY` statements** — verified by `grep 'CREATE POLICY'` returning no results. Access is controlled entirely by the Express layer using Supabase's service role, which bypasses RLS entirely. No other table in the codebase has role-aware RLS policies.

The 5 new tables follow the same pattern: `rls_auto_enable` ([`schema:1453`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql#L1453)) fires automatically on `CREATE TABLE` and enables RLS. No explicit `CREATE POLICY` statements are needed or consistent with the house pattern. The migration therefore omits them.

> **Note:** `rls_auto_enable` calls `ALTER TABLE … ENABLE ROW LEVEL SECURITY` inside a `BEGIN/EXCEPTION` block — if it fails (e.g. due to privilege), it logs a `RAISE LOG` rather than failing the migration. The migration should include explicit `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statements as a belt-and-suspenders guarantee for all 5 tables.

---

### 3g. Materialized Views / Downstream Data Changes

No existing materialized views need modification. The new `acct_requisition_*` tables are entirely separate from all tables referenced in `project_health_mv`, `budget_leakage_mv`, `approval_sla_mv`, and the other 5 analytics views ([`schema:2127-2983`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql#L2127-L2983)).

---

### 3h. Migration File

**File:** `backend/src/db/migrations/021_create_accounts_ho_approval.sql`

**Contents, in order:**

1. `CREATE TABLE bank_balance_master` (with `UNIQUE(bank_name)`)
2. `CREATE TABLE account_sub_title_master` (with `updated_at`/`updated_by`)
3. `CREATE TABLE beneficiary_master`
4. `CREATE TABLE acct_requisition_sheets`
5. `CREATE TABLE acct_requisition_line_items` (nullable `requisition_status`, no DEFAULT — NB2; `last_ho_*` columns — NB1; `chk_arli_status` allows NULL — NB2)
6. All 7 `CREATE INDEX` statements
7. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for all 5 tables (no CREATE POLICY — house pattern, S1 fix)
8. `CREATE OR REPLACE FUNCTION create_acct_sheet_transact`
9. `CREATE OR REPLACE FUNCTION submit_acct_sheet_transact`
10. `CREATE OR REPLACE FUNCTION approve_acct_line_item_transact`
11. `CREATE OR REPLACE FUNCTION act_acct_line_item_non_approve_transact`
12. `CREATE OR REPLACE FUNCTION resubmit_acct_line_item_transact` (NB1: copies to `last_ho_*`, clears `ho_process` together with `ho_actioned_by`)
13. `CREATE OR REPLACE FUNCTION reopen_acct_line_item_transact` (NB1: same pattern)
14. 5 `set_*_updated_at` functions (S2: one per table)
15. `audit_acct_sheet_events`, `audit_acct_line_item_events` functions (NB2: `WHEN 'Pending HO Review' + OLD IS NULL` arm)
16. `prevent_acct_sheet_hard_delete`, `prevent_acct_line_item_hard_delete`, `prevent_acct_master_hard_delete` functions (NB3 fix)
17. All 12 `CREATE OR REPLACE TRIGGER` statements: 2 audit + 5 updated_at + 5 hard-delete (S2 fix)
18. `GRANT SELECT, INSERT, UPDATE ON TABLE … TO authenticated` — all 5 tables
19. `REVOKE ALL ON TABLE … FROM anon` — all 5 tables

---

## 4. Backend Layer

### 4a. New Controllers

**File:** `backend/src/controllers/acctRequisition.controller.js`

Pattern reference: [`fundRequests.controller.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/fundRequests.controller.js)

| Function | HTTP Method | Path | Allowed Roles |
|---|---|---|---|
| `createSheet` | POST | `/acct-requisitions/sheets` | `accounts`, `admin` |
| `getSheets` | GET | `/acct-requisitions/sheets` | `accounts`, `ho`, `admin` |
| `getSheetById` | GET | `/acct-requisitions/sheets/:sheetId` | `accounts`, `ho`, `admin` |
| `addLineItem` | POST | `/acct-requisitions/sheets/:sheetId/items` | `accounts`, `admin` |
| `updateLineItem` | PATCH | `/acct-requisitions/sheets/:sheetId/items/:itemId` | `accounts`, `admin` |
| `deleteLineItem` | DELETE | `/acct-requisitions/sheets/:sheetId/items/:itemId` | `accounts`, `admin` |
| `submitSheet` | POST | `/acct-requisitions/sheets/:sheetId/submit` | `accounts`, `admin` |
| `actOnLineItem` | PATCH | `/acct-requisitions/items/:itemId/action` | `ho`, `admin` |
| `resubmitLineItem` | POST | `/acct-requisitions/items/:itemId/resubmit` | `accounts`, `admin` |
| `reopenLineItem` | POST | `/acct-requisitions/items/:itemId/reopen` | `ho`, `admin` (+ in-controller permission check) |
| `getBankBalances` | GET | `/acct-requisitions/bank-balances` | `accounts`, `ho`, `admin` |
| `upsertBankBalance` | PUT | `/acct-requisitions/bank-balances` | `accounts`, `admin` |
| `lookupBeneficiary` | GET | `/acct-requisitions/beneficiary` | `accounts`, `admin` |
| `upsertBeneficiary` | PUT | `/acct-requisitions/beneficiary` | `accounts`, `admin` |
| `getAccountSubTitles` | GET | `/acct-requisitions/account-sub-titles` | `accounts`, `ho`, `admin` |
| `upsertAccountSubTitle` | PUT | `/acct-requisitions/account-sub-titles` | `accounts`, `admin` |
| `exportBulkNeft` | POST | `/acct-requisitions/sheets/:sheetId/export-neft` | `accounts`, `admin` |

---

### 4b. Full Transition Table

| Actor | Required Current Status | Endpoint / Action | RPC Called | Resulting Status | Notes |
|---|---|---|---|---|---|
| `ho`/`admin` | `Pending HO Review` | `actOnLineItem` / `Approve` | `approve_acct_line_item_transact` | `Approved` | `ho_pass_amount` auto = `req_amount`; balance deducted; `ho_actioned_by` written; `last_ho_*` unchanged |
| `ho`/`admin` | `Pending HO Review` | `actOnLineItem` / `PartiallyApprove` | `approve_acct_line_item_transact` | `Partially Approved` | `ho_pass_amount` required; `ho_actioned_by` written |
| `ho`/`admin` | `Pending HO Review` | `actOnLineItem` / `Hold` | `act_acct_line_item_non_approve_transact` | `On Hold` | `ho_remarks` required; no balance touch |
| `ho`/`admin` | `On Hold` | `actOnLineItem` / `Approve` | `approve_acct_line_item_transact` | `Approved` | Same as Pending path |
| `ho`/`admin` | `On Hold` | `actOnLineItem` / `PartiallyApprove` | `approve_acct_line_item_transact` | `Partially Approved` | Same |
| `ho`/`admin` | `On Hold` | `actOnLineItem` / `Return` | `act_acct_line_item_non_approve_transact` | `Returned for Correction` | `ho_remarks` required |
| `ho`/`admin` | `Pending HO Review` | `actOnLineItem` / `Return` | `act_acct_line_item_non_approve_transact` | `Returned for Correction` | `ho_remarks` required |
| `ho`/`admin` | `Pending HO Review` | `actOnLineItem` / `Reject` | `act_acct_line_item_non_approve_transact` | `Rejected` | `ho_remarks` required; soft-lock |
| `ho`/`admin` | `On Hold` | `actOnLineItem` / `Reject` | `act_acct_line_item_non_approve_transact` | `Rejected` | `ho_remarks` required |
| `accounts`/`admin` | `Returned for Correction` | `resubmitLineItem` | `resubmit_acct_line_item_transact` | `Pending HO Review` | `revision_number += 1`; live HO fields → `last_ho_*`, then cleared; NB1 fix |
| `ho`/`admin` (+ `ho.requisition.reopen`) | `Rejected` | `reopenLineItem` | `reopen_acct_line_item_transact` | `Pending HO Review` | `is_reopened = true`; live HO fields → `last_ho_*`, then cleared; NB1 fix |

---

### 4c. Authorization Gating Logic

**`actOnLineItem`:** `requireRole(['ho','admin'])` gates the route. Controller fast-path check: `item.requisition_status IN ('Pending HO Review', 'On Hold')` before calling RPC.

**`reopenLineItem`:** `requireRole(['ho','admin'])` gates the route. In-controller check before any DB write: `req.user.permissions?.['ho.requisition.reopen'] === true`. Return 403 if absent. (Same `authorised_users.permissions` JSONB pattern as `admin.controller.js:74`.)

**`addLineItem` / `deleteLineItem`:** In-controller: `sheet_status === 'Open'`; return 403 if Submitted.

**`updateLineItem` (B3 fix):** Gate is `sheet_status === 'Open' OR item.requisition_status === 'Returned for Correction'`. These are mutually exclusive by definition. Allowed-field sets differ:
- **Open path:** all Accounts-side fields.
- **Returned-for-Correction path:** Accounts-side fields only. `ho_process`, `ho_actioned_by`, `last_ho_*`, `is_reopened` are stripped before writing. State transition goes through `resubmitLineItem`, not this endpoint.

**`exportBulkNeft`:** Server-side validation before generating file:
1. All `item_ids` belong to `sheet_id` — return 400 otherwise.
2. All items have `payment_mode = 'Bulk NEFT'` — return 400 otherwise.
3. All items have `requisition_status IN ('Approved', 'Partially Approved')` — return 400 otherwise.

---

### 4d. Validation Schemas

**File:** `backend/src/validation/acctRequisition.schema.js`

Pattern: Zod, same as [`requisition.schema.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/validation/requisition.schema.js).

```js
const { z } = require('zod');
// S6 FIX: App-layer reference list of Indian bank names sourced from List_of_Indian_Banks_Master_Unique.xlsx
const indianBanks = require('../constants/indianBanks.json');
const INDIAN_BANKS_SET = new Set(indianBanks.map(b => b.toUpperCase()));

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid UUID.');

const accountsLineItemBody = z.object({
  account_sub_title_id:   uuidSchema.optional().nullable(),
  account_sub_title_text: z.string().trim().optional().nullable(),
  particulars:            z.string().trim().optional().nullable(),
  beneficiary_ac_no:      z.string().trim().optional().nullable(),
  beneficiary_name:       z.string().trim().optional().nullable(),
  beneficiary_ifsc:       z.string().trim()
                            .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'ifsc must be 11-char in format AAAA0XXXXXX.')
                            .optional().nullable(),
  beneficiary_bank_name:  z.string().trim().optional().nullable()
                            .refine(val => !val || INDIAN_BANKS_SET.has(val.toUpperCase()), {
                              message: 'beneficiary_bank_name must be a recognized bank from the Indian Banks Master List.'
                            }),
  debit_bank_ac_type:     z.string().trim().optional().nullable(),
  req_amount:             z.coerce.number().positive().optional().nullable(),
  payment_mode:           z.enum(['Cheque', 'Bulk NEFT', 'RTGS', 'NEFT']).optional().nullable(),
  cheque_no:              z.string().trim().optional().nullable(),
  cheque_date:            z.string().trim().optional().nullable(),
}).refine(
  data => data.payment_mode !== 'Cheque' || (data.cheque_no && data.cheque_date),
  { message: 'cheque_no and cheque_date are required when payment_mode is Cheque.', path: ['cheque_no'] }
);

const addLineItemSchema    = { params: z.object({ sheetId: uuidSchema }), body: accountsLineItemBody };
const updateLineItemSchema = { params: z.object({ sheetId: uuidSchema, itemId: uuidSchema }), body: accountsLineItemBody };

const actOnLineItemSchema = {
  params: z.object({ itemId: uuidSchema }),
  body: z.object({
    action:         z.enum(['Approve', 'PartiallyApprove', 'Hold', 'Return', 'Reject']),
    ho_pass_amount: z.coerce.number().positive().optional().nullable(),
    ho_remarks:     z.string().trim().optional().nullable(),
  }).superRefine((data, ctx) => {
    if (data.action === 'PartiallyApprove' && !data.ho_pass_amount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ho_pass_amount is required for Partially Approve.', path: ['ho_pass_amount'] });
    }
    if (['Return', 'Hold', 'Reject'].includes(data.action) && !data.ho_remarks?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ho_remarks is required for this action.', path: ['ho_remarks'] });
    }
  })
};

const resubmitLineItemSchema = { params: z.object({ itemId: uuidSchema }), body: accountsLineItemBody };
const reopenLineItemSchema   = { params: z.object({ itemId: uuidSchema }), body: z.object({ reopen_remark: z.string().trim().min(1) }) };

const upsertBankBalanceSchema = {
  body: z.object({
    bank_name:         z.string().trim().min(1),
    balance_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
    available_balance: z.coerce.number().nonnegative()
  })
};

// S4 & S6 FIX: Zod schemas for upsertAccountSubTitle and upsertBeneficiary.
// S6 FIX: beneficiary_bank_name is validated against the static Indian Banks Master dataset
// (seeded from List_of_Indian_Banks_Master_Unique.xlsx). This prevents syntactically valid
// but unrecognized/fictitious bank names from being stored and later exported into Bulk NEFT.
const upsertAccountSubTitleSchema = {
  body: z.object({
    title:     z.string().trim().min(1, 'title is required.'),
    is_active: z.boolean().optional()
  })
};

const upsertBeneficiarySchema = {
  body: z.object({
    account_number:        z.string().trim().min(1, 'account_number is required.'),
    ifsc:                  z.string().trim()
                             // Indian IFSC: exactly 11 chars, first 4 alpha (bank code), 5th always '0',
                             // remaining 6 alphanumeric (branch code). Product doc §8: "validated against
                             // the Indian Banks master list at the app layer."
                             .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'ifsc must be 11-char in format AAAA0XXXXXX.'),
    beneficiary_name:      z.string().trim().min(1, 'beneficiary_name is required.'),
    beneficiary_bank_name: z.string().trim().min(1, 'beneficiary_bank_name is required.')
                             .refine(val => INDIAN_BANKS_SET.has(val.toUpperCase()), {
                               message: 'beneficiary_bank_name must be a recognized bank from the Indian Banks Master List.'
                             })
  })
};

const exportNeftSchema = {
  params: z.object({ sheetId: uuidSchema }),
  body: z.object({ item_ids: z.array(uuidSchema).min(1) })
};

module.exports = {
  addLineItemSchema, updateLineItemSchema, actOnLineItemSchema,
  resubmitLineItemSchema, reopenLineItemSchema,
  upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
  exportNeftSchema
};
```

---

### 4e. New Route File

**File:** `backend/src/routes/acctRequisition.routes.js`

```js
const express = require('express');
const { createSheet, getSheets, getSheetById, addLineItem, updateLineItem,
        deleteLineItem, submitSheet, actOnLineItem, resubmitLineItem, reopenLineItem,
        getBankBalances, upsertBankBalance, lookupBeneficiary, upsertBeneficiary,
        getAccountSubTitles, upsertAccountSubTitle, exportBulkNeft
} = require('../controllers/acctRequisition.controller');
const verifyJwt         = require('../middleware/verifyJwt');
const requireRole       = require('../middleware/requireRole');
const validateRequest   = require('../middleware/validateRequest');
const { addLineItemSchema, updateLineItemSchema, actOnLineItemSchema,
        resubmitLineItemSchema, reopenLineItemSchema,
        upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
        exportNeftSchema
} = require('../validation/acctRequisition.schema');

const router = express.Router();
router.use(verifyJwt);

const accountsRoles = ['accounts', 'admin'];
const hoRoles       = ['ho', 'admin'];
const readerRoles   = ['accounts', 'ho', 'admin'];

router.get('/bank-balances',                requireRole(readerRoles),   getBankBalances);
router.put('/bank-balances',                requireRole(accountsRoles), validateRequest(upsertBankBalanceSchema),     upsertBankBalance);
router.get('/account-sub-titles',           requireRole(readerRoles),   getAccountSubTitles);
router.put('/account-sub-titles',           requireRole(accountsRoles), validateRequest(upsertAccountSubTitleSchema), upsertAccountSubTitle);
router.get('/beneficiary',                  requireRole(accountsRoles), lookupBeneficiary);
router.put('/beneficiary',                  requireRole(accountsRoles), validateRequest(upsertBeneficiarySchema),     upsertBeneficiary);
router.get('/sheets',                       requireRole(readerRoles),   getSheets);
router.get('/sheets/:sheetId',              requireRole(readerRoles),   getSheetById);
router.post('/sheets',                      requireRole(accountsRoles), createSheet);
router.post('/sheets/:sheetId/submit',      requireRole(accountsRoles), submitSheet);
router.post('/sheets/:sheetId/export-neft', requireRole(accountsRoles), validateRequest(exportNeftSchema), exportBulkNeft);
router.post('/sheets/:sheetId/items',             requireRole(accountsRoles), validateRequest(addLineItemSchema),    addLineItem);
router.patch('/sheets/:sheetId/items/:itemId',    requireRole(accountsRoles), validateRequest(updateLineItemSchema), updateLineItem);
router.delete('/sheets/:sheetId/items/:itemId',   requireRole(accountsRoles), deleteLineItem);
router.patch('/items/:itemId/action',             requireRole(hoRoles),       validateRequest(actOnLineItemSchema),    actOnLineItem);
router.post('/items/:itemId/resubmit',            requireRole(accountsRoles), validateRequest(resubmitLineItemSchema), resubmitLineItem);
router.post('/items/:itemId/reopen',              requireRole(hoRoles),       validateRequest(reopenLineItemSchema),   reopenLineItem);

module.exports = router;
```

**Registration in `backend/src/app.js`** (after existing routes block):
```js
const acctRequisitionRoutes = require('./routes/acctRequisition.routes');
app.use('/api/v1/auth/acct-requisitions', acctRequisitionRoutes);
```

---

## 5. Frontend Layer

### 5a. New API Client File

**File:** `frontend/src/api/acctRequisitionsApi.js`

Pattern: [`api/fundRequests.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/api/fundRequests.js)

```js
import authApi from './authApi';

const BASE = '/acct-requisitions';

export const getBankBalances       = ()       => authApi.get(`${BASE}/bank-balances`);
export const upsertBankBalance     = (data)   => authApi.put(`${BASE}/bank-balances`, data);
export const getAccountSubTitles   = (params) => authApi.get(`${BASE}/account-sub-titles`, { params });
export const upsertAccountSubTitle = (data)   => authApi.put(`${BASE}/account-sub-titles`, data);
export const lookupBeneficiary     = (params) => authApi.get(`${BASE}/beneficiary`, { params });
export const upsertBeneficiary     = (data)   => authApi.put(`${BASE}/beneficiary`, data);
export const getSheets             = (params) => authApi.get(`${BASE}/sheets`, { params });
export const getSheetById          = (id)     => authApi.get(`${BASE}/sheets/${id}`);
export const createSheet           = ()       => authApi.post(`${BASE}/sheets`);
export const submitSheet           = (id)     => authApi.post(`${BASE}/sheets/${id}/submit`);
export const exportBulkNeft        = (id, data) => authApi.post(`${BASE}/sheets/${id}/export-neft`, data, { responseType: 'blob' });
export const addLineItem    = (sheetId, data)         => authApi.post(`${BASE}/sheets/${sheetId}/items`, data);
export const updateLineItem = (sheetId, itemId, data) => authApi.patch(`${BASE}/sheets/${sheetId}/items/${itemId}`, data);
export const deleteLineItem = (sheetId, itemId)       => authApi.delete(`${BASE}/sheets/${sheetId}/items/${itemId}`);
export const actOnLineItem    = (itemId, data) => authApi.patch(`${BASE}/items/${itemId}/action`, data);
export const resubmitLineItem = (itemId, data) => authApi.post(`${BASE}/items/${itemId}/resubmit`, data);
export const reopenLineItem   = (itemId, data) => authApi.post(`${BASE}/items/${itemId}/reopen`, data);
```

---

### 5b. New Component List

| Component File | Purpose | Column(s) Read |
|---|---|---|
| `pages/AcctRequisitions.jsx` | Accounts: open/submitted sheets, create-sheet, balance banner, line-item table | — |
| `pages/AcctHoQueue.jsx` | HO: sheets grouped by sheet number, each with pending items + decision form | — |
| `components/acctRequisition/SheetCard.jsx` | Sheet summary card (number, status badge, item count, submitted date) | — |
| `components/acctRequisition/LineItemRow.jsx` | Editable row (B3 path-aware field enabling; bank name searchable select against `indianBanks.js` master list) | `requisition_status`, `sheet_status` |
| `components/acctRequisition/HoDecisionPanel.jsx` | HO decision form: action selector, ho_pass_amount, ho_remarks, submit | — |
| `components/acctRequisition/BankBalanceBanner.jsx` | Live balance: `master − approved − open-sheet-running-total`; client-side | `bank_balance_master.available_balance`, `ho_pass_amount` |
| `components/acctRequisition/BeneficiaryAutofill.jsx` | Debounced lookup on `(account_number, ifsc)`; bank name autocomplete grounded against `indianBanks.js` master list; autofill + override prompt | — |
| `components/acctRequisition/BulkNeftExportButton.jsx` | Row selection + export trigger | `payment_mode`, `requisition_status` |
| `components/acctRequisition/LastHoActionTag.jsx` | **Reads `last_ho_process` / `last_ho_remarks`** — shows when `revision_number > 0 OR is_reopened` | `last_ho_process`, `last_ho_remarks` |
| `components/acctRequisition/ReopenedBadge.jsx` | Permanent "Reopened on [date] by [user]" badge when `is_reopened = true` | `is_reopened`, `reopened_at`, `last_ho_actioned_by` |

---

### 5c. Existing Files That Need Small Modifications

| File | Change |
|---|---|
| [`frontend/src/components/Sidebar.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/components/Sidebar.jsx) | Add "Acct Requisitions" (accounts, admin) and "HO Acct Queue" (ho, admin) nav items |
| [`frontend/src/App.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/App.jsx) | Add two `React.lazy` imports + two `<Route>` registrations |

---

## 6. Files Changed — Complete List

### New Files

| File | Purpose |
|---|---|
| `backend/src/db/migrations/021_create_accounts_ho_approval.sql` | All DDL, RLS, functions, and triggers |
| `backend/src/constants/indianBanks.json` | S6 fix: Normalized array of valid Indian bank names extracted from `List_of_Indian_Banks_Master_Unique.xlsx` |
| `backend/src/controllers/acctRequisition.controller.js` | 17 controller functions |
| `backend/src/routes/acctRequisition.routes.js` | Route definitions |
| `backend/src/validation/acctRequisition.schema.js` | Zod schemas (with IFSC format + Indian Banks master list validation) |
| `frontend/src/constants/indianBanks.js` | S6 fix: Indian bank names array for frontend search/autocomplete in BeneficiaryAutofill and LineItemRow |
| `frontend/src/api/acctRequisitionsApi.js` | API client wrappers |
| `frontend/src/pages/AcctRequisitions.jsx` | Accounts page |
| `frontend/src/pages/AcctHoQueue.jsx` | HO review queue page |
| `frontend/src/components/acctRequisition/SheetCard.jsx` | |
| `frontend/src/components/acctRequisition/LineItemRow.jsx` | |
| `frontend/src/components/acctRequisition/HoDecisionPanel.jsx` | |
| `frontend/src/components/acctRequisition/BankBalanceBanner.jsx` | |
| `frontend/src/components/acctRequisition/BeneficiaryAutofill.jsx` | |
| `frontend/src/components/acctRequisition/BulkNeftExportButton.jsx` | |
| `frontend/src/components/acctRequisition/LastHoActionTag.jsx` | Reads `last_ho_process`/`last_ho_remarks` |
| `frontend/src/components/acctRequisition/ReopenedBadge.jsx` | |

### Modified Files

| File | Change |
|---|---|
| `backend/src/app.js` | Route registration |
| `frontend/src/App.jsx` | Lazy routes |
| `frontend/src/components/Sidebar.jsx` | Nav entries |

---

## 7. Deployment

### Migration Apply Sequence

1. Apply `021_create_accounts_ho_approval.sql`. Verify: 5 tables, 6 transactional RPCs, 12 triggers, `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on all 5 tables. Check all 5 tables have `requisition_status` with no DEFAULT (for `acct_requisition_line_items`) and `UNIQUE(bank_name)` on `bank_balance_master`.
2. Deploy backend.
3. Deploy frontend.
4. Smoke test: Accounts → create sheet → add items → submit → confirm `requisition_status` is NULL before submit, `Pending HO Review` after. HO → Hold (check `ho_actioned_by` written) → Return → Accounts resubmit (check `last_ho_process` = `'Returned for Correction'`, live `ho_process` = NULL, `revision_number = 1`) → HO Approve (check balance deducted). Admin → Reopen a Rejected item (check `last_ho_process = 'Rejected'`, live `ho_process = NULL`, `is_reopened = true`). Verify `audit_log` has all 9 named event types.

### Rollback

Drop child table first: `DROP TABLE acct_requisition_line_items;` then `DROP TABLE acct_requisition_sheets;` then the 3 master tables. No existing tables affected.

---

## 8. Resolved Design Decisions

| Question | Decision | Rationale |
|---|---|---|
| VARCHAR+CHECK vs. ENUM for status | VARCHAR+CHECK | Matches `excess_fund_returns`; ALTER TYPE ADD VALUE cannot run in transaction block in Supabase Postgres |
| `is_reopened` as flag vs. 7th status | Flag on `Pending HO Review` | Product doc §5 explicit |
| Bank Balance: single row vs. history | Single row per bank (`UNIQUE(bank_name)`) | Product doc §3: "baseline figure"; enables FK from `debit_bank_ac_type` |
| Balance calculation: status-flag vs. date-window | Status-flag (`IN ('Approved','Partially Approved')`) | Date-window fails for cross-sheet concurrent approvals |
| `updateLineItem` gate | `sheet_status='Open' OR item.status='Returned for Correction'` | B3 fix: two paths are mutually exclusive |
| Sheet number generation | All-in-one `create_acct_sheet_transact` RPC with `pg_advisory_xact_lock` | B4 fix: eliminates TOCTOU; aggregate+FOR UPDATE is a Postgres syntax error |
| `ho.requisition.reopen` permission | `authorised_users.permissions` JSONB | Already used for per-user flags |
| HO actor tracking | `ho_actioned_by` + `ho_actioned_at` on line item | B1 fix; FK to `authorised_users` |
| Actor tracking vs. last-cycle display | Separate `last_ho_*` columns populated on resubmit/reopen | NB1 fix: prevents CHECK constraint violation on every Return→Resubmit |
| `requisition_status` default | Nullable, no DEFAULT | NB2 fix: makes submit a genuine NULL→value transition the audit trigger detects; matches product doc ("only exists once sheet is Submitted") |
| RLS policies | Enable RLS on all 5 tables (via `rls_auto_enable` + explicit ALTER); no CREATE POLICY | S1 clarification: house pattern — no policy exists on any other business table; service-role bypass is the access model |
| Trigger count | 12 triggers across 5 tables | S2 fix: 2 audit + 5 updated_at + 5 hard-delete |
| `cheque_no`/`cheque_date` in resubmit RPC | Bare assignment (not COALESCE) | S3 fix (documented): intentional — switching payment_mode away from Cheque must clear stale cheque fields; a cheque_no on a NEFT-mode row would be actively misleading |
| Hard-delete prevention on `acct_requisition_line_items` | Lifecycle-conditional: block only if `OLD.requisition_status IS NOT NULL`; allow DELETE if NULL (pre-submission) | NB3 fix: `deleteLineItem` is a documented, spec-required endpoint for the Open phase. The unconditional pattern copied from `prevent_fund_request_hard_delete` was wrong here because `fund_requests` has no lifecycle phase permitting real deletion — `acct_requisition_line_items` does. |
| Reopen detection in audit trigger | `NEW.reopened_at IS DISTINCT FROM OLD.reopened_at` | S5 fix: `is_reopened` flag is set once and never reset, so `NEW.is_reopened AND NOT OLD.is_reopened` only fires on the *first* reopen. `reopened_at` is stamped with `now()` on every reopen call, making it the correct per-cycle discriminator. |
| Validation schemas for upsert endpoints | `upsertBeneficiarySchema` (IFSC regex `^[A-Z]{4}0[A-Z0-9]{6}$`, non-empty `account_number`) + `upsertAccountSubTitleSchema` (non-empty `title`) | S4 fix: beneficiary fields are read verbatim into Bulk NEFT export; a malformed IFSC passes all downstream checks and reaches the bank file undetected. |
| Indian Banks Master validation | App-layer static constant dataset (`backend/src/constants/indianBanks.json` & `frontend/src/constants/indianBanks.js`) derived from `List_of_Indian_Banks_Master_Unique.xlsx`, validated at Zod schema + frontend autocomplete | S6 fix: Product doc §8 specifies "validated against the Indian Banks master list at the app layer". Packaging the standardized Indian Banks list as an app-layer reference asset eliminates unnecessary DB roundtrips and migrations for static reference data while strictly guarding against malformed or unrecognized bank names entering `beneficiary_master` or Bulk NEFT export files. |
| `account_sub_title` storage | UUID FK + denormalized text | Real FK + display-without-join; same pattern as `requisitions` |
| Redundant `idx_bm_acno_ifsc` | Removed | UNIQUE constraint already creates backing index |
| Bulk NEFT re-export lock | `neft_exported` boolean flag, default false | Product doc §10 |
| Standalone pages vs. integrated | Two standalone pages | HO grouped review and Accounts data-entry have fundamentally different UX models |

---

## 9. Test Plan

### Test 1 — Balance guardrail (status-flag gated, not date-window gated)

```pseudocode
bank = upsertBankBalance({ bank_name: 'CANARA SNP CA', available_balance: 100000 })
sheetA = createSheet(); itemA = addLineItem(sheetA, { req_amount: 70000, debit_bank_ac_type: 'CANARA SNP CA' }); submitSheet(sheetA)
actOnLineItem(itemA, { action: 'Approve' })
sheetB = createSheet(); itemB = addLineItem(sheetB, { req_amount: 40000, debit_bank_ac_type: 'CANARA SNP CA' }); submitSheet(sheetB)

ASSERT actOnLineItem(itemB, { action: 'Approve' }).status == 422   // 40000 > 30000 remaining
ASSERT getLineItemById(itemA.id).ho_actioned_by == ho_user.mobile_number
```

### Test 2 — Full audit log (9 named events, NB2 regression)

```pseudocode
// Walk: create → submit → hold → return → resubmit → reject → reopen → approve
// Verify PENDING_HO_REVIEW_FIRST_SUBMIT fires (would silently not fire with DEFAULT 'Pending HO Review' in place)
// Verify NB2 regression: getLineItemById(item.id).requisition_status == NULL before submitSheet()
ASSERT getLineItemById(item.id).requisition_status == NULL
submitSheet(sheet)
ASSERT getLineItemById(item.id).requisition_status == 'Pending HO Review'

// ... walk remainder of lifecycle ...
SELECT action FROM audit_log WHERE record_identifier = item.id ORDER BY timestamp;
ASSERT actions == [
  'LINE_ITEM_ADDED', 'PENDING_HO_REVIEW_FIRST_SUBMIT',
  'HO_HELD', 'HO_HOLD_RELEASED', 'HO_RETURNED',
  'RESUBMIT_AFTER_CORRECTION', 'HO_REJECTED', 'REOPEN', 'HO_APPROVED'
]
```

### Test 3 — NB1 regression: resubmit does not throw

```pseudocode
// After Return:
ASSERT item.ho_process == 'Returned for Correction'
ASSERT item.ho_actioned_by == ho_user

// After resubmit (would have thrown CHECK violation in v2):
result = resubmitLineItem(item.id, correctedFields)
ASSERT result.status == 200   // no 500/CHECK violation
ASSERT result.item.ho_process == NULL
ASSERT result.item.ho_actioned_by == NULL
ASSERT result.item.last_ho_process == 'Returned for Correction'
ASSERT result.item.last_ho_actioned_by == ho_user
ASSERT result.item.revision_number == 1
```

### Test 4 — updateLineItem gate (B3 regression)

```pseudocode
// Sheet Submitted, item Returned for Correction
response = updateLineItem(sheet.id, item.id, { req_amount: 4000 })
ASSERT response.status == 200   // allowed — Returned path

response = updateLineItem(sheet.id, item.id, { ho_process: 'Approved' })
reloaded = getLineItemById(item.id)
ASSERT reloaded.ho_process == 'Returned for Correction'   // stripped, not written

// Sheet Submitted, item On Hold (not Returned)
actOnLineItem(item, { action: 'Hold' })
response = updateLineItem(sheet.id, item.id, { req_amount: 3000 })
ASSERT response.status == 403   // blocked — neither Open nor Returned
```

### Test 5 — Concurrent sheet creation (B4 regression)

```pseudocode
results = await Promise.all(Array(10).fill().map(() => createSheet()))
sheet_numbers = results.map(r => r.sheet.sheet_number)
ASSERT sheet_numbers.length == new Set(sheet_numbers).size  // all unique
```

### Test 6 — exportBulkNeft validation

```pseudocode
ASSERT exportBulkNeft(sheet.id, { item_ids: [item_other_sheet.id] }).status == 400   // wrong sheet
ASSERT exportBulkNeft(sheet.id, { item_ids: [pending_neft_item.id] }).status == 400  // not approved
ASSERT exportBulkNeft(sheet.id, { item_ids: [approved_cheque_item.id] }).status == 400  // not Bulk NEFT
ASSERT exportBulkNeft(sheet.id, { item_ids: [approved_neft_item.id] }).status == 200   // valid
```

### Test 7 — deleteLineItem trigger gate (NB3 regression)

```pseudocode
DESCRIBE "prevent_acct_line_item_hard_delete — lifecycle-conditional"
  SETUP:
    sheet = createSheet()
    item  = addLineItem(sheet, { req_amount: 5000 })
    ASSERT getLineItemById(item.id).requisition_status == NULL   // pre-submission

  TEST "DELETE is allowed while item is pre-submission (Open phase)":
    response = deleteLineItem(sheet.id, item.id)
    ASSERT response.status == 200   // trigger RETURN OLD, DELETE proceeds
    // Would have been 500 (trigger RAISE EXCEPTION) in v3 unconditional trigger

  TEST "DELETE is blocked once item has entered the workflow":
    item2 = addLineItem(sheet, { req_amount: 3000, ... })
    submitSheet(sheet)
    ASSERT getLineItemById(item2.id).requisition_status == 'Pending HO Review'
    // Attempt a direct DB DELETE (simulating a controller bug bypassing the app-layer gate):
    -- Postgres: DELETE FROM acct_requisition_line_items WHERE id = item2.id;
    -- Expected: ERROR 'Hard deletion of submitted acct_requisition_line_items is permanently prohibited.'
    -- The app-layer gate (sheet must be Open for deleteLineItem) prevents this endpoint from
    -- ever reaching this trigger state; the trigger is the DB-level backstop.
```

### Test 8 — Repeat reopen audit label (S5 regression)

```pseudocode
DESCRIBE "audit_acct_line_item_events — REOPEN fires on every cycle, not just first"
  SETUP:
    sheet = createSheet(); item = addLineItem(sheet); submitSheet(sheet)
    actOnLineItem(item, { action: 'Reject' })
    reopenLineItem(item, { reopen_remark: 'First reopen' })   // cycle 1
    actOnLineItem(item, { action: 'Reject' })
    reopenLineItem(item, { reopen_remark: 'Second reopen' })  // cycle 2
    actOnLineItem(item, { action: 'Approve' })

  VERIFY:
    SELECT action FROM audit_log WHERE record_identifier = item.id ORDER BY timestamp;
    // Must contain two 'REOPEN' entries, not one 'REOPEN' + one 'PENDING_HO_REVIEW_ENTER'
    // (the latter would be the S5 bug: second reopen mislabeled as generic entry)
    ASSERT actions includes exactly 2 × 'REOPEN'
    ASSERT actions does NOT include 'PENDING_HO_REVIEW_ENTER'
    // With is_reopened discriminator (v3): second reopen OLD.is_reopened = TRUE, so branch skipped → 'PENDING_HO_REVIEW_ENTER'
    // With reopened_at discriminator (v4): both reopens have NEW.reopened_at IS DISTINCT FROM OLD.reopened_at = TRUE → 'REOPEN'
```

### Test 9 — Indian Banks master list validation (S6 regression)

```pseudocode
DESCRIBE "upsertBeneficiary & addLineItem — Indian Banks master validation"
  TEST "Rejects unrecognized or misspelled bank names":
    badBank = upsertBeneficiary({
      account_number: "1234567890",
      ifsc: "SBIN0001234",
      beneficiary_name: "Acme Corp",
      beneficiary_bank_name: "Fictitious Bank of Nowhere"
    })
    ASSERT badBank.status == 400
    ASSERT badBank.errors[0].message includes "recognized bank from the Indian Banks Master List"

  TEST "Accepts valid Indian bank name and valid IFSC":
    goodBank = upsertBeneficiary({
      account_number: "1234567890",
      ifsc: "SBIN0001234",
      beneficiary_name: "Acme Corp",
      beneficiary_bank_name: "STATE BANK OF INDIA"
    })
    ASSERT goodBank.status == 200
```
