-- Migration 090: enforce canonical Final Approved subcontract capacity on
-- Finance reservation approval. This is read-only with respect to the
-- subcontract estimate and preserves the existing Finance write path.

CREATE OR REPLACE FUNCTION public.approve_requisition_transact(
  p_requisition_id uuid,
  p_approved_amount numeric,
  p_actioned_by varchar,
  p_remarks_approved_authority text
)
RETURNS public.requisitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.requisitions;
  v_authorized numeric(18,2);
  v_consumed numeric(18,2);
BEGIN
  SELECT * INTO v_req
  FROM public.requisitions
  WHERE requisition_id = p_requisition_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
  END IF;

  IF btrim(COALESCE(v_req.material_main_head, '')) = 'Sub Contractor'
     AND v_req.subcontractor_id IS NOT NULL
     AND v_req.subcontract_work_id IS NOT NULL THEN
    PERFORM public.lock_subcontract_financial_scope(
      v_req.work_order_no, v_req.subcontractor_id, v_req.subcontract_work_id
    );

    SELECT COALESCE(SUM(line.amount), 0)::numeric(18,2)
    INTO v_authorized
    FROM public.project_subcontract_estimates estimate
    JOIN public.project_subcontract_estimate_lines line
      ON line.subcontract_estimate_id = estimate.subcontract_estimate_id
    WHERE estimate.work_order_no = v_req.work_order_no
      AND line.final_approved_revision IS NOT NULL
      AND line.subcontractor_id = v_req.subcontractor_id
      AND line.subcontract_work_id = v_req.subcontract_work_id;

    v_consumed := public.get_subcontract_financial_consumption(
      v_req.work_order_no, v_req.subcontractor_id, v_req.subcontract_work_id
    );

    IF v_consumed + p_approved_amount > v_authorized THEN
      RAISE EXCEPTION
        'Finance approval exceeds the Final Approved subcontract authorization: consumed %, requested %, authorized %',
        v_consumed, p_approved_amount, v_authorized
        USING ERRCODE = 'P4B19';
    END IF;
  END IF;

  RETURN public.approve_requisition_transact_unlocked(
    p_requisition_id, p_approved_amount, p_actioned_by,
    p_remarks_approved_authority
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_requisition_transact(uuid, numeric, varchar, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_requisition_transact(uuid, numeric, varchar, text)
  TO service_role;
