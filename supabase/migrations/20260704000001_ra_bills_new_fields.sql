-- Migration: RA Final Bills — New Financial Fields
-- Renames bill_amount_with_gst → gross_bill
-- Adds: agency_payment, special_security_amount, other_retention, it_tds, sgst, cgst, sd
-- All new columns are nullable with a default of 0

-- Step 1: Rename bill_amount_with_gst → gross_bill
ALTER TABLE "public"."ra_final_bills"
  RENAME COLUMN "bill_amount_with_gst" TO "gross_bill";

-- Step 2: Rename the existing positive-value constraint to match new column name
ALTER TABLE "public"."ra_final_bills"
  DROP CONSTRAINT IF EXISTS "chk_bill_amount_positive";

ALTER TABLE "public"."ra_final_bills"
  ADD CONSTRAINT "chk_gross_bill_non_negative" CHECK ("gross_bill" >= (0)::numeric);

-- Step 3: Add new financial deduction/payment columns
ALTER TABLE "public"."ra_final_bills"
  ADD COLUMN IF NOT EXISTS "agency_payment"         numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "special_security_amount" numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "other_retention"         numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "it_tds"                 numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sgst"                   numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cgst"                   numeric(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sd"                     numeric(18,2) DEFAULT 0;

-- Step 4: Rename index that referenced old column name (if it exists by content)
-- Note: The index idx_ra_final_bills_bill_date is on bill_date, not the renamed column, so no change needed.

-- Step 4: Fix the audit trigger function that references old column name bill_amount_with_gst
CREATE OR REPLACE FUNCTION "public"."audit_ra_final_bill_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (
    NEW.created_by,
    'CREATE',
    'RAFinalBill',
    NEW.bill_id::VARCHAR,
    NULL,
    jsonb_build_object(
      'work_order_no', NEW.work_order_no,
      'payment_type',  NEW.payment_type,
      'bill_date',     NEW.bill_date,
      'gross_bill',    NEW.gross_bill
    )
  );
  RETURN NEW;
END;
$$;

-- Done
