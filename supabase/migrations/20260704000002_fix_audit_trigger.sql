-- Migration: Fix audit trigger function to use renamed column gross_bill
-- The column bill_amount_with_gst was renamed to gross_bill in 20260704000001.
-- PostgreSQL triggers reference column names directly, so the function must be updated.

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
