-- Migration 083: Terminal Accounts Dismissal and Authoritative Main Head Capacity
--
-- 1. dismiss_accounts_import_item_transact:
--    Dismissing a Payment Requisition sets payment_status = 'REJECTED' (releasing
--    any Sub Contractor commitment) while requisition_status remains 'Approved' (ZO audit).
--    Dismissing a Fund Request sets request_status = 'Rejected'.
--    Dismissing a line item propagates to its source requisition/fund request.
--    All dismissals record an audit_log event identifying the actor.
--
-- 2. get_main_head_capacity:
--    Single DB-authoritative function computing Main Head capacity reflecting actual
--    requisition execution states (REJECTED = 0, PARTIALLY_PAID = paid_amount,
--    PAID = paid_amount, RETURNED_FOR_CORRECTION = approved_amount,
--    PENDING_HO_REVIEW = LEAST(approved_amount, line_item.req_amount)).
--
-- 3. approve_requisition_transact_unlocked:
--    Updated to use get_main_head_capacity for BUD02 capacity validation.

-- ============================================================================
-- 1. dismiss_accounts_import_item_transact
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dismiss_accounts_import_item_transact(
  p_item_id uuid,
  p_item_type varchar DEFAULT NULL,
  p_actor varchar DEFAULT 'SYSTEM'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_type varchar := p_item_type;
  v_req public.requisitions;
  v_fr public.fund_requests;
  v_li public.acct_requisition_line_items;
  v_src_req public.requisitions;
  v_src_fr public.fund_requests;
  v_actor varchar := COALESCE(NULLIF(btrim(p_actor), ''), 'SYSTEM');
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Item ID is required.' USING ERRCODE = 'P0002';
  END IF;

  -- Auto-detect item type if not explicitly supplied
  IF v_item_type IS NULL OR btrim(v_item_type) = '' THEN
    IF EXISTS (
      SELECT 1 FROM public.requisitions
      WHERE requisition_id = p_item_id
        AND payment_destination = 'ACCOUNTS'
        AND accounts_line_item_id IS NULL
    ) THEN
      v_item_type := 'PAYMENT_REQUISITION';
    ELSIF EXISTS (
      SELECT 1 FROM public.fund_requests
      WHERE fund_request_id = p_item_id
        AND accounts_line_item_id IS NULL
    ) THEN
      v_item_type := 'FUND_REQUEST';
    ELSIF EXISTS (
      SELECT 1 FROM public.acct_requisition_line_items
      WHERE id = p_item_id
    ) THEN
      v_item_type := 'LINE_ITEM';
    END IF;
  END IF;

  IF v_item_type = 'PAYMENT_REQUISITION' THEN
    SELECT * INTO v_req
    FROM public.requisitions
    WHERE requisition_id = p_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item does not exist, or is already imported or dismissed.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.payment_destination IS DISTINCT FROM 'ACCOUNTS'
       OR v_req.accounts_line_item_id IS NOT NULL
       OR v_req.accounts_import_dismissed = true THEN
      RAISE EXCEPTION 'Item does not exist, or is already imported or dismissed.' USING ERRCODE = 'STA01';
    END IF;

    UPDATE public.requisitions
    SET accounts_import_dismissed = true,
        payment_status = 'REJECTED',
        paid_amount = 0.00,
        payment_date = NULL,
        updated_at = now()
    WHERE requisition_id = v_req.requisition_id
    RETURNING * INTO v_req;

    IF btrim(COALESCE(v_req.material_main_head, '')) = 'Sub Contractor'
       AND COALESCE(v_req.approved_amount, 0) > 0 THEN
      PERFORM public.release_requisition_commitment_transact(
        v_req.requisition_id,
        v_req.approved_amount,
        v_actor
      );
    END IF;

    INSERT INTO public.audit_log (
      user_id, action, module_name, record_identifier, old_value, new_value
    ) VALUES (
      v_actor,
      'PAYMENT_REQUISITION_DISMISSED',
      'Accounts Import',
      v_req.requisition_id::varchar,
      jsonb_build_object(
        'payment_status', 'PENDING_ACCOUNTS_IMPORT',
        'accounts_import_dismissed', false,
        'requisition_status', v_req.requisition_status
      ),
      jsonb_build_object(
        'payment_status', 'REJECTED',
        'accounts_import_dismissed', true,
        'requisition_status', v_req.requisition_status
      )
    );

    RETURN to_jsonb(v_req);

  ELSIF v_item_type = 'FUND_REQUEST' THEN
    SELECT * INTO v_fr
    FROM public.fund_requests
    WHERE fund_request_id = p_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item does not exist, or is already imported or dismissed.' USING ERRCODE = 'P0002';
    END IF;

    IF v_fr.accounts_line_item_id IS NOT NULL
       OR v_fr.accounts_import_dismissed = true
       OR v_fr.request_status <> 'Pending'::public.fund_request_status_enum THEN
      RAISE EXCEPTION 'Item does not exist, or is already imported or dismissed.' USING ERRCODE = 'STA01';
    END IF;

    UPDATE public.fund_requests
    SET accounts_import_dismissed = true,
        request_status = 'Rejected'::public.fund_request_status_enum,
        updated_at = now()
    WHERE fund_request_id = v_fr.fund_request_id
    RETURNING * INTO v_fr;

    INSERT INTO public.audit_log (
      user_id, action, module_name, record_identifier, old_value, new_value
    ) VALUES (
      v_actor,
      'FUND_REQUEST_DISMISSED',
      'Accounts Import',
      v_fr.fund_request_id::varchar,
      jsonb_build_object(
        'request_status', 'Pending',
        'accounts_import_dismissed', false
      ),
      jsonb_build_object(
        'request_status', 'Rejected',
        'accounts_import_dismissed', true
      )
    );

    RETURN to_jsonb(v_fr);

  ELSIF v_item_type = 'LINE_ITEM' THEN
    SELECT * INTO v_li
    FROM public.acct_requisition_line_items
    WHERE id = p_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item does not exist, or is already imported or dismissed.' USING ERRCODE = 'P0002';
    END IF;

    IF v_li.imported_to_sheet_id IS NOT NULL OR v_li.import_dismissed = true THEN
      RAISE EXCEPTION 'Item does not exist, or is already imported or dismissed.' USING ERRCODE = 'STA01';
    END IF;

    UPDATE public.acct_requisition_line_items
    SET import_dismissed = true,
        import_dismissed_at = now(),
        import_dismissed_by = v_actor,
        updated_at = now()
    WHERE id = v_li.id
    RETURNING * INTO v_li;

    IF v_li.source_requisition_id IS NOT NULL THEN
      SELECT * INTO v_src_req
      FROM public.requisitions
      WHERE requisition_id = v_li.source_requisition_id
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.requisitions
        SET payment_status = 'REJECTED',
            paid_amount = 0.00,
            payment_date = NULL,
            accounts_import_dismissed = true,
            updated_at = now()
        WHERE requisition_id = v_src_req.requisition_id;

        IF btrim(COALESCE(v_src_req.material_main_head, '')) = 'Sub Contractor'
           AND COALESCE(v_src_req.approved_amount, 0) > 0 THEN
          PERFORM public.release_requisition_commitment_transact(
            v_src_req.requisition_id,
            v_src_req.approved_amount,
            v_actor
          );
        END IF;

        INSERT INTO public.audit_log (
          user_id, action, module_name, record_identifier, old_value, new_value
        ) VALUES (
          v_actor,
          'PAYMENT_REQUISITION_DISMISSED',
          'Accounts Import',
          v_src_req.requisition_id::varchar,
          jsonb_build_object(
            'source_line_item_id', v_li.id,
            'payment_status', v_src_req.payment_status,
            'accounts_import_dismissed', v_src_req.accounts_import_dismissed
          ),
          jsonb_build_object(
            'source_line_item_id', v_li.id,
            'payment_status', 'REJECTED',
            'accounts_import_dismissed', true
          )
        );
      END IF;
    END IF;

    IF v_li.source_fund_request_id IS NOT NULL THEN
      SELECT * INTO v_src_fr
      FROM public.fund_requests
      WHERE fund_request_id = v_li.source_fund_request_id
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.fund_requests
        SET request_status = 'Rejected'::public.fund_request_status_enum,
            accounts_import_dismissed = true,
            updated_at = now()
        WHERE fund_request_id = v_src_fr.fund_request_id;

        INSERT INTO public.audit_log (
          user_id, action, module_name, record_identifier, old_value, new_value
        ) VALUES (
          v_actor,
          'FUND_REQUEST_DISMISSED',
          'Accounts Import',
          v_src_fr.fund_request_id::varchar,
          jsonb_build_object(
            'source_line_item_id', v_li.id,
            'request_status', v_src_fr.request_status,
            'accounts_import_dismissed', v_src_fr.accounts_import_dismissed
          ),
          jsonb_build_object(
            'source_line_item_id', v_li.id,
            'request_status', 'Rejected',
            'accounts_import_dismissed', true
          )
        );
      END IF;
    END IF;

    INSERT INTO public.audit_log (
      user_id, action, module_name, record_identifier, old_value, new_value
    ) VALUES (
      v_actor,
      'LINE_ITEM_DISMISSED',
      'Accounts Import',
      v_li.id::varchar,
      jsonb_build_object('import_dismissed', false),
      jsonb_build_object('import_dismissed', true)
    );

    RETURN to_jsonb(v_li);

  ELSE
    RAISE EXCEPTION 'Item does not exist, or is already imported or dismissed.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_accounts_import_item_transact(uuid, varchar, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_accounts_import_item_transact(uuid, varchar, varchar) TO service_role;

-- ============================================================================
-- 2. get_main_head_capacity
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_main_head_capacity(
  p_work_order_no varchar,
  p_material_main_head varchar,
  p_exclude_requisition_id uuid DEFAULT NULL
) RETURNS TABLE (
  main_head_estimate numeric(18,2),
  cumulative_approved numeric(18,2),
  remaining_capacity numeric(18,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_wo varchar;
  v_clean_main_head varchar;
  v_estimate_id uuid;
  v_est numeric(18,2) := 0.00;
  v_cum numeric(18,2) := 0.00;
  v_rem numeric(18,2) := 0.00;
BEGIN
  v_clean_wo := btrim(COALESCE(p_work_order_no, ''));
  v_clean_main_head := btrim(COALESCE(p_material_main_head, ''));

  IF v_clean_wo = '' OR v_clean_main_head = '' THEN
    RETURN QUERY SELECT 0.00::numeric(18,2), 0.00::numeric(18,2), 0.00::numeric(18,2);
    RETURN;
  END IF;

  -- 1. Latest Final Approved cost estimate
  SELECT estimate_id INTO v_estimate_id
  FROM public.project_cost_estimates
  WHERE btrim(work_order_no) = v_clean_wo
    AND estimate_status = 'Final Approved'
  ORDER BY estimate_revision DESC
  LIMIT 1;

  IF v_estimate_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0.00)::numeric(18,2) INTO v_est
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_estimate_id
      AND btrim(material_main_head) = v_clean_main_head;
  END IF;

  -- 2. Cumulative commitment across Approved requisitions using execution state rules
  SELECT COALESCE(SUM(
    CASE
      WHEN r.payment_status = 'REJECTED' THEN 0.00
      WHEN r.payment_status = 'PARTIALLY_PAID' THEN COALESCE(r.paid_amount, 0.00)
      WHEN r.payment_status = 'PAID' THEN
        CASE WHEN COALESCE(r.paid_amount, 0.00) > 0 THEN r.paid_amount ELSE COALESCE(r.approved_amount, 0.00) END
      WHEN r.payment_status IN ('AWAITING_PAYMENT_ROUTE', 'PENDING_ACCOUNTS_IMPORT', 'ACCOUNTS_DRAFT') THEN
        COALESCE(r.approved_amount, 0.00)
      WHEN r.payment_status = 'RETURNED_FOR_CORRECTION' THEN
        COALESCE(r.approved_amount, 0.00)
      WHEN r.payment_status IN ('PENDING_HO_REVIEW', 'ON_HOLD', 'PENDING_REVIEW') THEN
        CASE
          WHEN li.id IS NOT NULL AND li.req_amount IS NOT NULL THEN
            LEAST(COALESCE(r.approved_amount, 0.00), li.req_amount)
          ELSE
            COALESCE(r.approved_amount, 0.00)
        END
      WHEN r.payment_status IS NULL THEN
        COALESCE(r.approved_amount, 0.00)
      ELSE
        COALESCE(r.approved_amount, 0.00)
    END
  ), 0.00)::numeric(18,2) INTO v_cum
  FROM public.requisitions r
  LEFT JOIN public.acct_requisition_line_items li ON li.id = r.accounts_line_item_id
  WHERE btrim(r.work_order_no) = v_clean_wo
    AND btrim(r.material_main_head) = v_clean_main_head
    AND r.requisition_status = 'Approved'::public.requisition_status_enum
    AND (p_exclude_requisition_id IS NULL OR r.requisition_id <> p_exclude_requisition_id);

  v_rem := v_est - v_cum;

  RETURN QUERY SELECT v_est, v_cum, v_rem;
END;
$$;

REVOKE ALL ON FUNCTION public.get_main_head_capacity(varchar, varchar, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_main_head_capacity(varchar, varchar, uuid) TO service_role;

-- ============================================================================
-- 3. approve_requisition_transact_unlocked
--    Ensure BUD02 validation uses get_main_head_capacity.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_requisition_transact_unlocked(
    p_requisition_id uuid,
    p_approved_amount numeric,
    p_actioned_by character varying,
    p_remarks_approved_authority text
) RETURNS public.requisitions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
    v_req             public.requisitions;
    v_estimate_id     UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
    v_sc_available    numeric(18,2) := 0.00;
    v_clean_wo        VARCHAR;
    v_clean_main_head VARCHAR;
    v_clean_sub_head  VARCHAR;
    v_clean_details   VARCHAR;
BEGIN
    -- 1. Lock and fetch Requisition Row
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.requisition_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Requisition status must be Pending or Hold.' USING ERRCODE = 'STA01';
    END IF;

    v_clean_wo        := TRIM(v_req.work_order_no);
    v_clean_main_head := TRIM(v_req.material_main_head);
    v_clean_sub_head  := TRIM(v_req.material_sub_head);
    v_clean_details   := TRIM(v_req.material_details);

    -- 2. Find estimate ID of the latest Final Approved cost estimate
    SELECT estimate_id INTO v_estimate_id
    FROM public.project_cost_estimates
    WHERE work_order_no = v_clean_wo
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
    END IF;

    -- 3-5. Validate against Main Head Capacity using get_main_head_capacity
    SELECT main_head_estimate, cumulative_approved, remaining_capacity
    INTO v_main_head_estimate, v_cumulative_approved, v_remaining_capacity
    FROM public.get_main_head_capacity(v_clean_wo, v_clean_main_head, p_requisition_id);

    IF p_approved_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Approved amount exceeds the remaining Main Head capacity (Capacity: %, Attempted: %).',
            v_remaining_capacity, p_approved_amount
            USING ERRCODE = 'BUD02';
    END IF;

    -- 5b. Validate + lock Subcontractor Ledger balance (independent of Main Head)
    IF v_clean_main_head = 'Sub Contractor' THEN
        SELECT available_balance INTO v_sc_available
        FROM subcontractor_balances
        WHERE work_order_no = v_clean_wo
          AND material_main_head = 'Sub Contractor'
          AND material_sub_head = v_clean_sub_head
          AND material_details = v_clean_details
        FOR UPDATE;

        IF NOT FOUND THEN
            v_sc_available := 0.00;
        END IF;

        IF p_approved_amount > v_sc_available THEN
            RAISE EXCEPTION 'Approved amount exceeds the remaining Subcontractor Ledger balance (Balance: %, Attempted: %).',
                v_sc_available, p_approved_amount
                USING ERRCODE = 'BUD04';
        END IF;
    END IF;

    -- 8b. Debit the Subcontractor Ledger balance + append audit row
    IF v_clean_main_head = 'Sub Contractor' THEN
        UPDATE subcontractor_balances
        SET paid_total        = paid_total + p_approved_amount,
            available_balance = available_balance - p_approved_amount,
            updated_at        = now()
        WHERE work_order_no = v_clean_wo
          AND material_main_head = 'Sub Contractor'
          AND material_sub_head = v_clean_sub_head
          AND material_details = v_clean_details;

        INSERT INTO subcontractor_ledger (
            work_order_no, material_main_head, material_sub_head, material_details,
            transaction_type, reference_type, reference_id, amount, created_by
        ) VALUES (
            v_clean_wo, 'Sub Contractor', v_clean_sub_head, v_clean_details,
            'REQUISITION_APPROVAL', 'REQUISITION', p_requisition_id,
            -p_approved_amount, p_actioned_by
        )
        ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;
    END IF;

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

REVOKE ALL ON FUNCTION public.approve_requisition_transact_unlocked(uuid, numeric, varchar, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_requisition_transact_unlocked(uuid, numeric, varchar, text) TO service_role;
