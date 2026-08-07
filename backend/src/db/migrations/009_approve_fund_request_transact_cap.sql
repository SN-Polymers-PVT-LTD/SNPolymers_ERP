-- Migration: 009_approve_fund_request_transact_cap.sql
-- Description: Redefine approve_fund_request_transact to serialize approvals and validate against Cost Estimate capacity.

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
    v_cumulative_approved NUMERIC(18,2);
    v_remaining_capacity NUMERIC(18,2);
BEGIN
    -- 1. Lock fund request row
    SELECT * INTO v_fr FROM public.fund_requests WHERE fund_request_id = p_fund_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fund request not found.';
    END IF;

    -- Validate status is Pending or Hold
    IF v_fr.request_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Fund request status must be Pending or Hold.';
    END IF;

    -- 2. Lock the parent Work Order row in projects_master FOR UPDATE to serialize concurrent approvals
    PERFORM 1 FROM public.projects_master WHERE work_order_no = v_fr.work_order_no FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work Order not found.';
    END IF;

    -- 3. Fetch final approved estimate amount
    SELECT estimate_amount INTO v_estimate_amount
    FROM public.project_cost_estimates
    WHERE work_order_no = v_fr.work_order_no
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
    END IF;

    -- 4. Calculate cumulative approved amount (excluding current request being approved)
    SELECT COALESCE(SUM(approve_ho_amount), 0.00) INTO v_cumulative_approved
    FROM public.fund_requests
    WHERE work_order_no = v_fr.work_order_no
      AND request_status = 'Approved';

    -- 5. Validate against remaining capacity
    v_remaining_capacity := v_estimate_amount - v_cumulative_approved;

    IF p_approved_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Approved amount exceeds the remaining Cost Estimate funding capacity (Capacity: %, Attempted: %).',
            v_remaining_capacity, p_approved_amount USING ERRCODE = 'BUD02';
    END IF;

    -- 6. Initialize balance cache row with ON CONFLICT DO NOTHING if missing
    INSERT INTO public.zo_balances (zo_user_id, available_balance)
    VALUES (v_fr.zo_user_id, 0.00)
    ON CONFLICT (zo_user_id) DO NOTHING;

    -- 7. Lock and increment ZO balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance + p_approved_amount, updated_at = now()
    WHERE zo_user_id = v_fr.zo_user_id;

    -- 8. Insert ledger entry (positive credit amount)
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

    -- 9. Update Fund Request status
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
