-- ===========================================================================
-- Migration 27: Create Zonal Balance Reconciliation RPC
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

DROP FUNCTION IF EXISTS public.reconcile_zonal_balances(character varying, character varying);

CREATE OR REPLACE FUNCTION public.reconcile_zonal_balances(
    p_zo_user_id VARCHAR DEFAULT NULL,
    p_actioned_by VARCHAR DEFAULT 'SYSTEM'
)
RETURNS TABLE (
    out_zo_user_id VARCHAR,
    old_balance NUMERIC(18,2),
    new_balance NUMERIC(18,2),
    difference NUMERIC(18,2),
    adjusted BOOLEAN
) LANGUAGE plpgsql AS $$
DECLARE
    r RECORD;
    v_zo_exists BOOLEAN;
    v_old NUMERIC(18,2);
BEGIN
    -- 1. Validate p_zo_user_id belongs to a valid Zonal Office user if supplied
    IF p_zo_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.authorised_users 
            WHERE mobile_number = p_zo_user_id AND role = 'zo'
        ) INTO v_zo_exists;

        IF NOT v_zo_exists THEN
            RAISE EXCEPTION 'Target user (%) is not a Zonal Office user.', p_zo_user_id;
        END IF;
    END IF;

    -- 2. Use a single grouped aggregation query to calculate balances for target ZO(s)
    FOR r IN 
        SELECT 
            u.mobile_number AS zo_id,
            COALESCE(SUM(l.amount), 0.00) AS calculated_balance
        FROM public.authorised_users u
        LEFT JOIN public.zo_fund_ledger l ON u.mobile_number = l.zo_user_id
        WHERE u.role = 'zo' AND (p_zo_user_id IS NULL OR u.mobile_number = p_zo_user_id)
        GROUP BY u.mobile_number
    LOOP
        -- 3. Eliminate race conditions: initialize balance row with ON CONFLICT DO NOTHING
        INSERT INTO public.zo_balances (zo_user_id, available_balance)
        VALUES (r.zo_id, 0.00)
        ON CONFLICT (zo_user_id) DO NOTHING;

        -- 4. Lock the balance row using row-level locking
        SELECT available_balance INTO v_old 
        FROM public.zo_balances 
        WHERE public.zo_balances.zo_user_id = r.zo_id 
        FOR UPDATE;

        -- 5. Only update and record audit if a discrepancy exists (idempotency check)
        IF v_old != r.calculated_balance THEN
            UPDATE public.zo_balances 
            SET available_balance = r.calculated_balance, updated_at = now() 
            WHERE public.zo_balances.zo_user_id = r.zo_id;

            INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
            VALUES (
                p_actioned_by,
                'UPDATE',
                'zo_balances',
                r.zo_id,
                jsonb_build_object('available_balance', v_old),
                jsonb_build_object('available_balance', r.calculated_balance)
            );

            out_zo_user_id := r.zo_id;
            old_balance := v_old;
            new_balance := r.calculated_balance;
            difference := r.calculated_balance - v_old;
            adjusted := true;
            RETURN NEXT;
        ELSE
            out_zo_user_id := r.zo_id;
            old_balance := v_old;
            new_balance := v_old;
            difference := 0.00;
            adjusted := false;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_zonal_balances TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_zonal_balances TO service_role;
