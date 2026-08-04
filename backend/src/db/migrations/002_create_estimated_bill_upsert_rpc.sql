-- ===========================================================================
-- Migration 002: Create Estimated Bill Upsert RPC Function
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.upsert_estimated_bill(
    p_work_order_no  VARCHAR,
    p_amount         NUMERIC,
    p_payment_date   DATE,
    p_surety_pct     SMALLINT,
    p_remarks        TEXT,
    p_actor          VARCHAR   -- acting user's mobile number
)
RETURNS public.estimated_bills AS $$
DECLARE
    v_wo_value  NUMERIC(18,2);
    v_result    public.estimated_bills;
BEGIN
    -- 1. Lock and validate the work order
    SELECT work_order_value INTO v_wo_value
    FROM public.projects_master
    WHERE work_order_no = p_work_order_no
    FOR UPDATE;

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

    -- 2. Upsert — one row per work order
    INSERT INTO public.estimated_bills (
        work_order_no, estimated_bill_amount, estimated_payment_date,
        surety_pct, remarks, created_by, updated_by
    ) VALUES (
        p_work_order_no, p_amount, p_payment_date,
        p_surety_pct, p_remarks, p_actor, p_actor
    )
    ON CONFLICT (work_order_no) DO UPDATE SET
        estimated_bill_amount  = EXCLUDED.estimated_bill_amount,
        estimated_payment_date = EXCLUDED.estimated_payment_date,
        surety_pct             = EXCLUDED.surety_pct,
        remarks                = EXCLUDED.remarks,
        updated_by             = EXCLUDED.updated_by,
        updated_at             = now()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION public.upsert_estimated_bill(VARCHAR, NUMERIC, DATE, SMALLINT, TEXT, VARCHAR) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.upsert_estimated_bill(VARCHAR, NUMERIC, DATE, SMALLINT, TEXT, VARCHAR) TO anon;
GRANT EXECUTE ON FUNCTION public.upsert_estimated_bill(VARCHAR, NUMERIC, DATE, SMALLINT, TEXT, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_estimated_bill(VARCHAR, NUMERIC, DATE, SMALLINT, TEXT, VARCHAR) TO service_role;
