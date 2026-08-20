-- Migration: 024_add_bank_account_number.sql
-- Description: Add account_number to bank_balance_master.
-- Required for Bulk NEFT letter generation (bulkNeftExport.service.js): the export
-- letter must print the debited account's real bank account number ("vide number"),
-- and there is no source of truth for it anywhere else in the schema. Nullable —
-- existing rows predate this column and Accounts backfills it via the same
-- upsert-on-bank_name flow used for available_balance.

ALTER TABLE "public"."bank_balance_master" ADD COLUMN IF NOT EXISTS "account_number" varchar;
