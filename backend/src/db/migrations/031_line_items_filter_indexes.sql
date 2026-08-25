-- Migration 031: indexes backing the "Requisition Details" filter/search view
--
-- getLineItems (acctRequisition.controller.js) is a new cross-sheet search
-- over acct_requisition_line_items filtering on created_at (date range),
-- account_sub_title_text / beneficiary_ac_no (ilike '%term%'), and
-- debit_bank_ac_type — none of which had covering indexes:
--
--   - created_at had no general index at all (only a partial one scoped to
--     requisition_status = 'On Hold', 021_create_accounts_ho_approval.sql).
--   - account_sub_title_text / beneficiary_ac_no are searched with a leading
--     '%' wildcard, which a plain B-tree index can't use regardless — these
--     need trigram (pg_trgm) GIN indexes.
--   - debit_bank_ac_type only had a partial index scoped to
--     requisition_status IN ('Approved', 'Partially Approved')
--     (idx_arli_debit_bank_approved, for the balance-guardrail RPC) — no
--     coverage for a filter across any status.
--
-- At current data volume none of this matters; it's here so the filter
-- screen doesn't degrade into sequential scans as acct_requisition_line_items
-- grows over years of use. idx_arli_debit_bank_approved is left in place —
-- it serves a different, narrower query (the balance guardrail's per-bank
-- approved-sum) and remains the better index for that specific case.

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";

-- Date range filter (getLineItems, and the general created_at DESC ordering
-- every list endpoint on this table already does).
CREATE INDEX IF NOT EXISTS "idx_arli_created_at"
    ON acct_requisition_line_items (created_at);

-- Account Sub-title free-text filter.
CREATE INDEX IF NOT EXISTS "idx_arli_sub_title_trgm"
    ON acct_requisition_line_items USING gin (account_sub_title_text extensions.gin_trgm_ops);

-- Beneficiary A/c No. free-text filter.
CREATE INDEX IF NOT EXISTS "idx_arli_beneficiary_ac_no_trgm"
    ON acct_requisition_line_items USING gin (beneficiary_ac_no extensions.gin_trgm_ops);

-- Debit Bank Account filter, any requisition_status (not just Approved/
-- Partially Approved — see idx_arli_debit_bank_approved above for that case).
CREATE INDEX IF NOT EXISTS "idx_arli_debit_bank_ac_type"
    ON acct_requisition_line_items (debit_bank_ac_type);
