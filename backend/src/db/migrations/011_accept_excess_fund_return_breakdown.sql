-- Migration: 011_accept_excess_fund_return_breakdown.sql
-- Description: Drop existing accept_excess_fund_return function and create a new signature supporting breakdown verification.

DROP FUNCTION IF EXISTS public.accept_excess_fund_return(uuid, timestamp with time zone, character varying);

CREATE OR REPLACE FUNCTION "public"."accept_excess_fund_return"(
    "p_return_id" "uuid",
    "p_client_updated_at" timestamp with time zone,
    "p_actioned_by" character varying,
    "p_breakdown" jsonb DEFAULT NULL::jsonb
) RETURNS "public"."excess_fund_returns"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_return public.excess_fund_returns;
    v_balance NUMERIC(18,2);
    v_total_breakdown NUMERIC(18,2);
    v_wo_balance NUMERIC(18,2);
    v_item RECORD;
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

    -- 4. Lock the ZO balance row to serialize balance updates
    SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_return.zo_user_id FOR UPDATE;
    IF NOT FOUND OR v_balance < v_return.requested_amount THEN
        RAISE EXCEPTION 'Insufficient available balance.';
    END IF;

    -- 5. Deduct from total balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance - v_return.requested_amount, updated_at = now()
    WHERE zo_user_id = v_return.zo_user_id;

    -- 6. Verify breakdown sum and lock/validate individual Work Orders
    IF p_breakdown IS NOT NULL AND jsonb_array_length(p_breakdown) > 0 THEN
        SELECT COALESCE(SUM((val->>'amount')::numeric), 0.00) INTO v_total_breakdown
        FROM jsonb_array_elements(p_breakdown) AS val;
        
        IF abs(v_total_breakdown - v_return.requested_amount) >= 0.01 THEN
            RAISE EXCEPTION 'Total breakdown allocation (₹%) does not match the requested amount (₹%).',
                v_total_breakdown, v_return.requested_amount;
        END IF;

        -- Process each breakdown item under the total balance lock
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_breakdown) AS (work_order_no varchar, amount numeric) LOOP
            SELECT COALESCE(SUM(amount), 0.00) INTO v_wo_balance
            FROM public.zo_fund_ledger
            WHERE zo_user_id = v_return.zo_user_id
              AND work_order_no = v_item.work_order_no;

            IF v_item.amount > v_wo_balance THEN
                RAISE EXCEPTION 'Insufficient available balance on Work Order %. Available: ₹%, Requested: ₹%.',
                    v_item.work_order_no, v_wo_balance, v_item.amount;
            END IF;

            -- Insert individual ledger debit record
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
                gen_random_uuid(), -- unique reference_id per breakdown item
                -v_item.amount,
                v_item.work_order_no,
                p_actioned_by
            );
        END LOOP;
    ELSE
        -- Fallback: single entry using the request's work_order_no
        IF v_return.work_order_no IS NULL THEN
            RAISE EXCEPTION 'Breakdown is required when the return request does not specify a Work Order.';
        END IF;

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
    END IF;

    -- 7. Update status to Completed and persist breakdown
    UPDATE public.excess_fund_returns
    SET 
        status = 'Completed',
        actioned_by = p_actioned_by,
        breakdown = COALESCE(p_breakdown, v_return.breakdown),
        updated_at = now()
    WHERE id = p_return_id
    RETURNING * INTO v_return;

    RETURN v_return;
END;
$$;
