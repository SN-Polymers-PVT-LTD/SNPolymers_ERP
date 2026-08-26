-- Migration 032: follow-up index fixes found while auditing the accounts
-- module's indexing (see 031's commit for the first round). Three issues:
--
-- (1) beneficiary_master search has no supporting index. getBeneficiaries
--     (controller.js) does
--       .or('account_number.ilike.%term%,beneficiary_name.ilike.%term%')
--     which has been live since migration 021 with zero index behind it —
--     the only existing index is the exact-match UNIQUE(account_number, ifsc).
--     Same fix as 031 applied to acct_requisition_line_items: trigram GIN
--     indexes for the leading-wildcard ilike search.
--
-- (2) idx_astm_title_lower (account_sub_title_master) and idx_pm_title_lower
--     (particulars_master) are dead weight — neither getAccountSubTitles nor
--     getParticulars does a server-side lower()/ilike query; both return the
--     full list and let the frontend's SearchableSelect filter client-side.
--     indian_bank_master (added later, migration 026) never got an
--     equivalent index, which is the *correct* state for all three — so this
--     drops the two unused indexes instead of adding a third that would just
--     replicate the same dead weight. (If server-side search is ever added
--     for these lists, re-add the appropriate index at that time.)
--
-- (3) idx_ars_sheet_status was a partial index scoped to sheet_status =
--     'Open', added in 021 back when 'Open'/'Submitted' were the only two
--     values. Migration 028 added a third status, 'Reviewed', and both
--     AcctHoQueue.jsx and AcctRequisitions.jsx now filter on 'Submitted'/
--     'Reviewed' just as often as 'Open' — but the index never got revisited
--     to cover them. Replaced with one general (sheet_status, created_at DESC)
--     index that covers all three status filters *and* getSheets' existing
--     ORDER BY created_at DESC in the same index, instead of adding more
--     single-status partial indexes.

-- ── (1) beneficiary_master search ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_bm_account_number_trgm"
    ON beneficiary_master USING gin (account_number extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_bm_beneficiary_name_trgm"
    ON beneficiary_master USING gin (beneficiary_name extensions.gin_trgm_ops);

-- ── (2) drop unused lower(title) indexes ───────────────────────────────────
DROP INDEX IF EXISTS "idx_astm_title_lower";
DROP INDEX IF EXISTS "idx_pm_title_lower";

-- ── (3) sheet_status: one general index covering all three values + the
--        existing created_at DESC ordering, replacing the Open-only partial ──
DROP INDEX IF EXISTS "idx_ars_sheet_status";

CREATE INDEX IF NOT EXISTS "idx_ars_sheet_status_created_at"
    ON acct_requisition_sheets (sheet_status, created_at DESC);
