-- Migration: 010_create_ra_final_bill_secure_rpc.sql
-- Description: Create a secure atomic billing RPC for RA/Final Bills.

CREATE OR REPLACE FUNCTION "public"."create_ra_final_bill_secure"(
    "p_bill" jsonb
) RETURNS "public"."ra_final_bills"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_inserted public.ra_final_bills;
    v_project_status public.project_status;
    v_estimate_amount NUMERIC(18,2);
    v_total_already_billed NUMERIC(18,2);
    v_gross_bill NUMERIC(18,2);
    v_current_n INTEGER;
    v_prev_bill_type VARCHAR;
    v_exists BOOLEAN;
BEGIN
    -- 1. Lock the corresponding project row for update to serialize concurrent billing insertions
    SELECT status INTO v_project_status
    FROM public.projects_master
    WHERE work_order_no = (p_bill->>'work_order_no')
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
    END IF;

    -- 2. Verify project is not closed
    IF v_project_status = 'Closed'::public.project_status THEN
        RAISE EXCEPTION 'Bills cannot be entered for Closed work orders.' USING ERRCODE = 'PR001';
    END IF;

    -- 3. Duplicate payment type check
    SELECT EXISTS (
        SELECT 1 FROM public.ra_final_bills
        WHERE work_order_no = (p_bill->>'work_order_no')
          AND payment_type = (p_bill->>'payment_type')
    ) INTO v_exists;

    IF v_exists THEN
        RAISE EXCEPTION 'A % entry already exists for this work order.', (p_bill->>'payment_type') USING ERRCODE = '23505';
    END IF;

    -- 4. Sequential RA Bill checks
    IF (p_bill->>'payment_type') LIKE 'RA Bill %' THEN
        v_current_n := (substring((p_bill->>'payment_type') from 'RA Bill ([0-9]+)'))::integer;
        IF v_current_n > 1 THEN
            v_prev_bill_type := 'RA Bill ' || (v_current_n - 1)::text;
            SELECT EXISTS (
                SELECT 1 FROM public.ra_final_bills
                WHERE work_order_no = (p_bill->>'work_order_no')
                  AND payment_type = v_prev_bill_type
            ) INTO v_exists;

            IF NOT v_exists THEN
                RAISE EXCEPTION '% must be entered before % can be accepted.', v_prev_bill_type, (p_bill->>'payment_type') USING ERRCODE = 'SEQ01';
            END IF;
        END IF;
    END IF;

    -- 5. Find estimate amount of the latest Final Approved cost estimate
    SELECT estimate_amount INTO v_estimate_amount
    FROM public.project_cost_estimates
    WHERE work_order_no = (p_bill->>'work_order_no')
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
    END IF;

    -- 6. Recompute cumulative billed amount and validate cap
    v_gross_bill := (p_bill->>'gross_bill')::numeric(18,2);
    SELECT COALESCE(SUM(gross_bill), 0.00) INTO v_total_already_billed
    FROM public.ra_final_bills
    WHERE work_order_no = (p_bill->>'work_order_no');

    IF v_total_already_billed + v_gross_bill > v_estimate_amount + 0.01 THEN
        RAISE EXCEPTION 'Overbilling rejected. Total billed (₹%) would exceed the Final Approved Estimate amount (₹%). Maximum allowed for this bill: ₹%.',
            (v_total_already_billed + v_gross_bill), v_estimate_amount, greatest(0.00, v_estimate_amount - v_total_already_billed) USING ERRCODE = 'BUD02';
    END IF;

    -- 7. Insert the ra_final_bill
    INSERT INTO public.ra_final_bills (
        created_by,
        work_order_no,
        state,
        district,
        area_code,
        department,
        site_details,
        payment_type,
        bill_date,
        bill_no,
        gross_bill,
        earnest_money_deposit,
        security_deposit_amount,
        agency_payment,
        special_security_amount,
        other_retention,
        it_tds,
        sgst,
        cgst,
        sd,
        bill_copy_url,
        original_bill_filename,
        remarks
    ) VALUES (
        (p_bill->>'created_by'),
        (p_bill->>'work_order_no'),
        (p_bill->>'state'),
        (p_bill->>'district'),
        (p_bill->>'area_code'),
        (p_bill->>'department'),
        (p_bill->>'site_details'),
        (p_bill->>'payment_type'),
        (p_bill->>'bill_date')::date,
        (p_bill->>'bill_no'),
        v_gross_bill,
        (p_bill->>'earnest_money_deposit')::numeric(18,2),
        (p_bill->>'security_deposit_amount')::numeric(18,2),
        (p_bill->>'agency_payment')::numeric(18,2),
        (p_bill->>'special_security_amount')::numeric(18,2),
        (p_bill->>'other_retention')::numeric(18,2),
        (p_bill->>'it_tds')::numeric(18,2),
        (p_bill->>'sgst')::numeric(18,2),
        (p_bill->>'cgst')::numeric(18,2),
        (p_bill->>'sd')::numeric(18,2),
        (p_bill->>'bill_copy_url'),
        (p_bill->>'original_bill_filename'),
        (p_bill->>'remarks')
    ) RETURNING * INTO v_inserted;

    RETURN v_inserted;
END;
$$;
