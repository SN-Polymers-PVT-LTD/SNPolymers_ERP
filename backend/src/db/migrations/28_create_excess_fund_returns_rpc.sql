-- ===========================================================================
-- Migration 28: Create Excess Fund Return Accept RPC
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

DROP FUNCTION IF EXISTS public.accept_excess_fund_return(UUID, TIMESTAMPTZ, VARCHAR);

CREATE OR REPLACE FUNCTION public.accept_excess_fund_return(
    p_return_id UUID,
    p_client_updated_at TIMESTAMPTZ,
    p_actioned_by VARCHAR
)
RETURNS public.excess_fund_returns AS $$
DECLARE
    v_return public.excess_fund_returns;
    v_balance NUMERIC(18,2);
BEGIN
    -- 1. Lock the return request row
    SELECT * INTO v_return FROM public.excess_fund_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Excess fund return request not found.';
    END IF;

    -- 2. Validate current status is Requested or Awaiting HO Review
    IF v_return.status NOT IN ('Requested', 'Awaiting HO Review') THEN
        RAISE EXCEPTION 'Excess fund return request cannot be accepted in its current status.';
    END IF;

    -- 3. Optimistic concurrency lock: check updated_at mismatch
    IF v_return.updated_at != p_client_updated_at THEN
        RAISE EXCEPTION 'Stale acceptance request.';
    END IF;

    -- 4. Lock the ZO balance row
    SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_return.zo_user_id FOR UPDATE;
    IF NOT FOUND OR v_balance < v_return.requested_amount THEN
        RAISE EXCEPTION 'Insufficient available balance.';
    END IF;

    -- 5. Deduct from balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance - v_return.requested_amount, updated_at = now()
    WHERE zo_user_id = v_return.zo_user_id;

    -- 6. Insert ledger debit record
    INSERT INTO public.zo_fund_ledger (
        zo_user_id,
        transaction_type,
        reference_type,
        reference_id,
        amount,
        work_order_no,
        created_by
    ) VALUES (
        v_return.zo_user_id,
        'RETURN',
        'RETURN',
        p_return_id,
        -v_return.requested_amount,
        v_return.work_order_no,
        p_actioned_by
    );

    -- 7. Update status to Completed
    UPDATE public.excess_fund_returns
    SET 
        status = 'Completed',
        actioned_by = p_actioned_by,
        updated_at = now()
    WHERE id = p_return_id
    RETURNING * INTO v_return;

    RETURN v_return;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.accept_excess_fund_return TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_excess_fund_return TO service_role;
