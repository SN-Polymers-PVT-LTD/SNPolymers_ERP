-- ===========================================================================
-- Migration 012: Fix invalid RAISE format in insert_estimated_bill
-- DB: PostgreSQL (Supabase)
--
-- PostgreSQL RAISE uses % placeholders, not printf-style %.2f. The bad format
-- caused a secondary error when blocking amounts over work order value, which
-- PostgREST surfaced as "An invalid response was received from the upstream server".
-- ===========================================================================

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
    v_wo_value       NUMERIC(18,2);
    v_status         VARCHAR;
    v_final_exists   BOOLEAN;
    v_result         public.estimated_bills;
BEGIN
    SELECT 
        pm.work_order_value, 
        pm.status,
        EXISTS (
            SELECT 1 
            FROM public.ra_final_bills rb 
            WHERE rb.work_order_no = pm.work_order_no 
              AND rb.payment_type = 'Final Bill'
        ) AS has_final_bill
    INTO v_wo_value, v_status, v_final_exists
    FROM public.projects_master pm
    WHERE pm.work_order_no = p_work_order_no FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % not found.', p_work_order_no;
    END IF;
    
    IF v_status IS DISTINCT FROM 'Running' THEN
        RAISE EXCEPTION 'Estimated bills can only be created for Running work orders.';
    END IF;

    IF v_final_exists THEN
        RAISE EXCEPTION 'Cannot add estimated bills after a Final Bill has been submitted.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Estimated bill amount must be greater than zero.';
    END IF;
    IF p_amount > v_wo_value THEN
        RAISE EXCEPTION 'Estimated bill amount cannot exceed work order value (%).', v_wo_value;
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
