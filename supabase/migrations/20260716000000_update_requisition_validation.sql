-- Migration: Update requisition validation to check material main head capacity instead of global balance
-- DB: PostgreSQL (Supabase)

CREATE OR REPLACE FUNCTION public.create_requisition_secure(
    p_requester_user_id character varying,
    p_work_order_no character varying,
    p_estimate_no character varying,
    p_estimate_amount numeric,
    p_state character varying,
    p_district character varying,
    p_area_code character varying,
    p_department character varying,
    p_site_details text,
    p_requisition_no character varying,
    p_material_main_head character varying,
    p_requisition_pdf_url text,
    p_original_filename character varying,
    p_requisition_amount numeric,
    p_gst_bill public.gst_bill_enum,
    p_gst_bill_pdf_url text,
    p_bank_details text,
    p_expen_head_remarks text,
    p_requisition_status public.requisition_status_enum,
    p_created_by character varying
) RETURNS public.requisitions
    LANGUAGE plpgsql
    SECURITY DEFINER
AS $$
DECLARE
    v_project_status public.project_status;
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
    v_inserted public.requisitions;
BEGIN
    -- 1. Lock the corresponding project row for update to serialize concurrent requisition insertions
    SELECT status INTO v_project_status
    FROM public.projects_master
    WHERE work_order_no = p_work_order_no
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % not found.', p_work_order_no USING ERRCODE = 'P0002';
    END IF;

    -- 2. Verify project is not closed
    IF v_project_status = 'Closed'::public.project_status THEN
        RAISE EXCEPTION 'Cannot create requisitions for projects with "Closed" status. All linked reports are immutable.' USING ERRCODE = 'PR001';
    END IF;

    -- 3. Re-verify uniqueness of requisition_no
    IF EXISTS (
        SELECT 1 FROM public.requisitions WHERE requisition_no = p_requisition_no
    ) THEN
        RAISE EXCEPTION 'A requisition with number % already exists.', p_requisition_no USING ERRCODE = '23505';
    END IF;

    -- 4. Find the estimate ID of the latest Final Approved cost estimate
    SELECT estimate_id INTO v_estimate_id
    FROM public.project_cost_estimates
    WHERE work_order_no = p_work_order_no
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for Work Order %.', p_work_order_no USING ERRCODE = 'EST01';
    END IF;

    -- 5. Calculate Main Head Cost Estimate Amount
    SELECT COALESCE(SUM(amount), 0.00) INTO v_main_head_estimate
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_estimate_id
      AND material_main_head = p_material_main_head;

    -- 6. Sum Cumulative ZO-Approved Requisitions for this main head
    SELECT COALESCE(SUM(approved_amount), 0.00) INTO v_cumulative_approved
    FROM public.requisitions
    WHERE work_order_no = p_work_order_no
      AND material_main_head = p_material_main_head
      AND requisition_status = 'Approved'::public.requisition_status_enum;

    -- 7. Validate budget capacity
    v_remaining_capacity := v_main_head_estimate - v_cumulative_approved;
    IF p_requisition_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Requisition amount exceeds the remaining Main Head capacity (Capacity: %, Requested: %).', 
            v_remaining_capacity, p_requisition_amount
            USING ERRCODE = 'BUD01';
    END IF;

    -- 8. Insert the requisition
    INSERT INTO public.requisitions (
        requester_user_id,
        work_order_no,
        estimate_no,
        estimate_amount,
        state,
        district,
        area_code,
        department,
        site_details,
        requisition_no,
        material_main_head,
        requisition_pdf_url,
        original_filename,
        requisition_amount,
        gst_bill,
        gst_bill_pdf_url,
        bank_details,
        expen_head_remarks,
        requisition_status,
        created_by
    ) VALUES (
        p_requester_user_id,
        p_work_order_no,
        p_estimate_no,
        p_estimate_amount,
        p_state,
        p_district,
        p_area_code,
        p_department,
        p_site_details,
        p_requisition_no,
        p_material_main_head,
        p_requisition_pdf_url,
        p_original_filename,
        p_requisition_amount,
        p_gst_bill,
        p_gst_bill_pdf_url,
        p_bank_details,
        p_expen_head_remarks,
        p_requisition_status,
        p_created_by
    ) RETURNING * INTO v_inserted;

    RETURN v_inserted;
END;
$$;


CREATE OR REPLACE FUNCTION public.approve_requisition_transact(
    p_requisition_id UUID,
    p_approved_amount NUMERIC,
    p_actioned_by VARCHAR,
    p_remarks_approved_authority TEXT
)
RETURNS public.requisitions
    LANGUAGE plpgsql
    SECURITY DEFINER
AS $$
DECLARE
    v_req public.requisitions;
    v_balance NUMERIC(18,2);
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
BEGIN
    -- 1. Lock and fetch Requisition Row
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.requisition_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Requisition status must be Pending or Hold.' USING ERRCODE = 'STA01';
    END IF;

    -- 2. Find estimate ID of the latest Final Approved cost estimate
    SELECT estimate_id INTO v_estimate_id
    FROM public.project_cost_estimates
    WHERE work_order_no = v_req.work_order_no
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
    END IF;

    -- 3. Calculate Main Head Cost Estimate Amount
    SELECT COALESCE(SUM(amount), 0.00) INTO v_main_head_estimate
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_estimate_id
      AND material_main_head = v_req.material_main_head;

    -- 4. Calculate cumulative approved amount (excluding current requisition)
    SELECT COALESCE(SUM(approved_amount), 0.00) INTO v_cumulative_approved
    FROM public.requisitions
    WHERE work_order_no = v_req.work_order_no
      AND material_main_head = v_req.material_main_head
      AND requisition_status = 'Approved'::public.requisition_status_enum
      AND requisition_id <> p_requisition_id;

    -- 5. Validate against Main Head Capacity
    v_remaining_capacity := v_main_head_estimate - v_cumulative_approved;
    IF p_approved_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Approved amount exceeds the remaining Main Head capacity (Capacity: %, Attempted: %).',
            v_remaining_capacity, p_approved_amount
            USING ERRCODE = 'BUD02';
    END IF;

    -- 6. Lock and check ZO Balance row
    SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_req.zo_user_id FOR UPDATE;
    IF NOT FOUND OR v_balance < p_approved_amount THEN
        RAISE EXCEPTION 'Insufficient available Zonal Office balance.' USING ERRCODE = 'BAL01';
    END IF;

    -- 7. Deduct ZO balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance - p_approved_amount, updated_at = now()
    WHERE zo_user_id = v_req.zo_user_id;

    -- 8. Insert ledger entry (negative debit)
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

    -- 9. Update Requisition
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
$$;

GRANT EXECUTE ON FUNCTION public.create_requisition_secure TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_requisition_secure TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_requisition_transact TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_requisition_transact TO service_role;
