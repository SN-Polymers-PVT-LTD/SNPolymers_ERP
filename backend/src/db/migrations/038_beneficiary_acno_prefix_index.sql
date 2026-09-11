-- Migration 038: Index for beneficiary account-number prefix search
--
-- Backs the new live typeahead on the line-item entry row's "A/C No." field
-- (searchBeneficiariesByAcNo) -- a left-anchored LIKE 'prefix%' match over
-- beneficiary_master.account_number. varchar_pattern_ops (not the default
-- opclass) so the index actually accelerates prefix LIKE regardless of the
-- database's locale/collation -- a plain btree index on a locale-aware
-- column does not reliably speed up LIKE 'prefix%' in Postgres.
CREATE INDEX "idx_beneficiary_master_acno_prefix"
    ON beneficiary_master (account_number varchar_pattern_ops);
