-- ===========================================================================
-- Migration 29: Create Operational Integration Approval RPCs
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

DROP FUNCTION IF EXISTS public.approve_requisition_transact(UUID, NUMERIC, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS public.approve_fund_request_transact(UUID, NUMERIC, VARCHAR, VARCHAR, TEXT);

-- 1. Atomic Requisition Approval
CREATE OR REPLACE FUNCTION public.approve_requisition_transact(
    p_requisition_id UUID,
    p_approved_amount NUMERIC,
    p_actioned_by VARCHAR,
    p_remarks_approved_authority TEXT
)
RETURNS public.requisitions AS $$
DECLARE
    v_req public.requisitions;
    v_balance NUMERIC(18,2);
BEGIN
    -- Lock requisition row
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.';
    END IF;

    -- Validate status is Pending or Hold
    IF v_req.requisition_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Requisition status must be Pending or Hold.';
    END IF;

    -- Lock ZO balance row
    SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_req.zo_user_id FOR UPDATE;
    IF NOT FOUND OR v_balance < p_approved_amount THEN
        RAISE EXCEPTION 'Insufficient available balance.';
    END IF;

    -- Deduct ZO balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance - p_approved_amount, updated_at = now()
    WHERE zo_user_id = v_req.zo_user_id;

    -- Insert ledger entry (negative requisition debit amount)
    INSERT INTO public.zo_fund_ledger (
        zo_user_id,
        transaction_type,
        reference_type,
        reference_id,
        amount,
        work_order_no,
        created_by
    ) VALUES (
        v_req.zo_user_id,
        'REQUISITION_APPROVAL',
        'REQUISITION',
        p_requisition_id,
        -p_approved_amount,
        v_req.work_order_no,
        p_actioned_by
    );

    -- Update Requisition
    UPDATE public.requisitions
    SET
        requisition_status = 'Approved',
        approve_type = 'Approve',
        approved_amount = p_approved_amount,
        approved_balance_amount = requisition_amount - p_approved_amount,
        approved_user_id = p_actioned_by,
        payment_date = now(),
        remarks_approved_authority = p_remarks_approved_authority,
        updated_at = now()
    WHERE requisition_id = p_requisition_id
    RETURNING * INTO v_req;

    RETURN v_req;
END;
$$ LANGUAGE plpgsql;

-- 2. Atomic Fund Request Approval
CREATE OR REPLACE FUNCTION public.approve_fund_request_transact(
    p_fund_request_id UUID,
    p_approved_amount NUMERIC,
    p_transfer_from_account VARCHAR,
    p_actioned_by VARCHAR,
    p_remarks TEXT
)
RETURNS public.fund_requests AS $$
DECLARE
    v_fr public.fund_requests;
BEGIN
    -- Lock fund request row
    SELECT * INTO v_fr FROM public.fund_requests WHERE fund_request_id = p_fund_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fund request not found.';
    END IF;

    -- Validate status is Pending or Hold
    IF v_fr.request_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Fund request status must be Pending or Hold.';
    END IF;

    -- Initialize balance cache row with ON CONFLICT DO NOTHING if missing
    INSERT INTO public.zo_balances (zo_user_id, available_balance)
    VALUES (v_fr.zo_user_id, 0.00)
    ON CONFLICT (zo_user_id) DO NOTHING;

    -- Lock and increment ZO balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance + p_approved_amount, updated_at = now()
    WHERE zo_user_id = v_fr.zo_user_id;

    -- Insert ledger entry (positive credit amount)
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

    -- Update Fund Request status
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
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.approve_requisition_transact TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_requisition_transact TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_fund_request_transact TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_fund_request_transact TO service_role;
