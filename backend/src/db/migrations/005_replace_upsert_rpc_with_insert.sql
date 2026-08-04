-- ===========================================================================
-- Migration 005: Replace upsert_estimated_bill with insert_estimated_bill
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- Drop the old upsert function that relied on ON CONFLICT
DROP FUNCTION IF EXISTS public.upsert_estimated_bill(VARCHAR, NUMERIC, DATE, SMALLINT, TEXT, VARCHAR);

-- Create append-only insert function
CREATE OR REPLACE FUNCTION public.insert_estimated_bill(
    p_work_order_no  VARCHAR,
    p_amount         NUMERIC,
    p_estimated_date DATE,
    p_surety_pct     SMALLINT,
    p_remarks        TEXT,
    p_actor          VARCHAR
)
RETURNS public.estimated_bills AS $$
DECLARE
    v_wo_value  NUMERIC(18,2);
    v_result    public.estimated_bills;
BEGIN
    SELECT work_order_value INTO v_wo_value
    FROM public.projects_master
    WHERE work_order_no = p_work_order_no FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % not found.', p_work_order_no;
    END IF;
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Estimated bill amount must be greater than zero.';
    END IF;
    IF p_amount > v_wo_value THEN
        RAISE EXCEPTION 'Estimated bill amount cannot exceed work order value (%.2f).', v_wo_value;
    END IF;
    IF p_surety_pct < 0 OR p_surety_pct > 100 THEN
        RAISE EXCEPTION 'Surety percentage must be between 0 and 100.';
    END IF;

    INSERT INTO public.estimated_bills (
        work_order_no, estimated_bill_amount, estimated_payment_date,
        surety_pct, remarks, created_by, updated_by
    ) VALUES (
        p_work_order_no, p_amount, p_estimated_date,
        p_surety_pct, p_remarks, p_actor, p_actor
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.insert_estimated_bill(VARCHAR, NUMERIC, DATE, SMALLINT, TEXT, VARCHAR)
  TO anon, authenticated, service_role;
