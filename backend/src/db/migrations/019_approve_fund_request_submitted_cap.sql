-- Migration: 019_approve_fund_request_submitted_cap.sql
-- Description: HO approval headroom uses submitted pipeline (spec 4c), excluding the FR being approved.

CREATE OR REPLACE FUNCTION "public"."approve_fund_request_transact"(
    "p_fund_request_id" "uuid",
    "p_approved_amount" numeric,
    "p_transfer_from_account" character varying,
    "p_actioned_by" character varying,
    "p_remarks" "text"
) RETURNS "public"."fund_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_fr public.fund_requests;
    v_estimate_amount NUMERIC(18,2);
    v_submitted_total NUMERIC(18,2);
    v_self_committed NUMERIC(18,2);
    v_remaining_capacity NUMERIC(18,2);
BEGIN
    SELECT * INTO v_fr FROM public.fund_requests WHERE fund_request_id = p_fund_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fund request not found.';
    END IF;

    IF v_fr.request_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Fund request status must be Pending or Hold.';
    END IF;

    PERFORM 1 FROM public.projects_master WHERE work_order_no = v_fr.work_order_no FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work Order not found.';
    END IF;

    SELECT estimate_amount INTO v_estimate_amount
    FROM public.project_cost_estimates
    WHERE work_order_no = v_fr.work_order_no
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
    END IF;

    SELECT COALESCE(SUM(
        CASE
            WHEN request_status = 'Approved' THEN approve_ho_amount
            WHEN request_status IN ('Pending', 'Hold') THEN zo_fr_amount
            ELSE 0::numeric
        END
    ), 0.00) INTO v_submitted_total
    FROM public.fund_requests
    WHERE work_order_no = v_fr.work_order_no
      AND request_status IN ('Pending', 'Hold', 'Approved');

    v_self_committed := COALESCE(v_fr.zo_fr_amount, 0.00);
    v_remaining_capacity := v_estimate_amount - (v_submitted_total - v_self_committed);

    IF p_approved_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Approved amount exceeds the remaining Cost Estimate funding capacity (Capacity: %, Attempted: %).',
            v_remaining_capacity, p_approved_amount USING ERRCODE = 'BUD02';
    END IF;

    INSERT INTO public.zo_balances (zo_user_id, available_balance)
    VALUES (v_fr.zo_user_id, 0.00)
    ON CONFLICT (zo_user_id) DO NOTHING;

    UPDATE public.zo_balances
    SET available_balance = available_balance + p_approved_amount, updated_at = now()
    WHERE zo_user_id = v_fr.zo_user_id;

    INSERT INTO public.zo_fund_ledger (
        zo_user_id,
        transaction_type,
        reference_type,
        reference_id,
        amount,
        work_order_no,
        created_by
    ) VALUES (
        v_fr.zo_user_id,
        'ALLOCATION',
        'FUND_REQUEST',
        p_fund_request_id,
        p_approved_amount,
        v_fr.work_order_no,
        p_actioned_by
    );

    UPDATE public.fund_requests
    SET
        request_status = 'Approved',
        approve_ho_amount = p_approved_amount,
        transfer_from_account = p_transfer_from_account::transfer_account_enum,
        approve_ho_user_id = p_actioned_by,
        approve_ho_date = now(),
        ho_remarks = p_remarks,
        updated_at = now()
    WHERE fund_request_id = p_fund_request_id
    RETURNING * INTO v_fr;

    RETURN v_fr;
END;
$$;
