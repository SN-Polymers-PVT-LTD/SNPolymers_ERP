-- Migration 054: Add beneficiary capture to Fund Requests
--
-- Fund Requisition (fund_requests) previously had no beneficiary information
-- at all — it only tracked a requested amount and a transfer-from account
-- (CC/OD/CR) credited to the ZO's internal balance. This adds the same four
-- beneficiary fields already present on requisitions (Payment Requisition,
-- added in 051_converge_beneficiary_bank_id.sql), so Fund Requisition draws
-- from and contributes to the SAME shared projects_beneficiary_master
-- directory that Payment Requisition already uses.

ALTER TABLE "public"."fund_requests"
    ADD COLUMN IF NOT EXISTS "beneficiary_id" uuid REFERENCES "public"."projects_beneficiary_master"("id") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "beneficiary_name" character varying,
    ADD COLUMN IF NOT EXISTS "beneficiary_ac_no" character varying,
    ADD COLUMN IF NOT EXISTS "beneficiary_ifsc" character varying,
    ADD COLUMN IF NOT EXISTS "beneficiary_bank_name" character varying,
    ADD COLUMN IF NOT EXISTS "beneficiary_bank_id" uuid;

CREATE INDEX IF NOT EXISTS "idx_fr_beneficiary_id"
    ON "public"."fund_requests"("beneficiary_id");

CREATE INDEX IF NOT EXISTS "idx_fr_beneficiary_bank_id"
    ON "public"."fund_requests"("beneficiary_bank_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fr_beneficiary_bank_id') THEN
    ALTER TABLE "public"."fund_requests"
      ADD CONSTRAINT "fk_fr_beneficiary_bank_id"
      FOREIGN KEY ("beneficiary_bank_id") REFERENCES "public"."indian_bank_master"("id") ON DELETE SET NULL;
  END IF;
END $$;
