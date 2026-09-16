-- Migration 094: project Final Approved subcontract contributions into Cost Estimates.
-- Phase 5 only. Finance balance/settlement architecture remains unchanged.

-- Generated rows intentionally store an authoritative aggregate amount. Manual
-- rows retain the legacy amount = qty * rate invariant.
ALTER TABLE public.project_cost_estimate_items
  DROP CONSTRAINT IF EXISTS chk_item_amount;
ALTER TABLE public.project_cost_estimate_items
  ADD CONSTRAINT chk_item_amount CHECK (
    source_type IS NOT DISTINCT FROM 'SUBCONTRACT_ESTIMATE'
    OR amount = round(qty * rate, 2)
  );

CREATE OR REPLACE FUNCTION public.guard_generated_cost_estimate_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.phase5_sync', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'DELETE' AND OLD.source_type = 'SUBCONTRACT_ESTIMATE' THEN
      RAISE EXCEPTION 'Generated subcontract Cost Estimate rows are system-owned' USING ERRCODE = 'P5E07';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.source_type = 'SUBCONTRACT_ESTIMATE' THEN
      RAISE EXCEPTION 'Generated subcontract Cost Estimate rows may only be created by synchronization' USING ERRCODE = 'P5E07';
    END IF;
    IF TG_OP = 'UPDATE' AND (
      OLD.source_type = 'SUBCONTRACT_ESTIMATE'
      OR NEW.source_type = 'SUBCONTRACT_ESTIMATE'
    ) THEN
      RAISE EXCEPTION 'Generated subcontract Cost Estimate rows are system-owned' USING ERRCODE = 'P5E07';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_generated_cost_estimate_item_mutation
  ON public.project_cost_estimate_items;
CREATE TRIGGER trg_guard_generated_cost_estimate_item_mutation
BEFORE INSERT OR UPDATE OR DELETE ON public.project_cost_estimate_items
FOR EACH ROW EXECUTE FUNCTION public.guard_generated_cost_estimate_item_mutation();

CREATE OR REPLACE FUNCTION public.sync_subcontract_contributions_to_cost_estimate(
  p_cost_estimate_id uuid,
  p_actor varchar
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estimate public.project_cost_estimates%ROWTYPE;
  v_scope record;
  v_source record;
  v_item_id uuid;
  v_seen_work_ids uuid[] := ARRAY[]::uuid[];
  v_rate numeric(18,4);
BEGIN
  SELECT * INTO v_estimate
  FROM public.project_cost_estimates
  WHERE estimate_id = p_cost_estimate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cost Estimate not found' USING ERRCODE = 'P5E01';
  END IF;
  IF v_estimate.estimate_status NOT IN ('Draft', 'Estimate Reopened') THEN
    RAISE EXCEPTION 'Cost Estimate is not editable for subcontract synchronization' USING ERRCODE = 'P5E02';
  END IF;

  -- Serialize all syncs for the WO, including callers targeting different
  -- editable CE records, before reading and writing the aggregate projection.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'cost-estimate-subcontract-sync|' || btrim(v_estimate.work_order_no), 0
  ));
  PERFORM set_config('app.phase5_sync', 'on', true);

  FOR v_scope IN
    SELECT
      line.subcontract_work_id,
      work.sub_head,
      work.material_details,
      work.unit,
      round(sum(line.qty), 4)::numeric(18,4) AS effective_qty,
      round(sum(line.amount), 2)::numeric(18,2) AS effective_amount
    FROM public.project_subcontract_estimate_lines line
    JOIN public.project_subcontract_estimates source_estimate
      ON source_estimate.subcontract_estimate_id = line.subcontract_estimate_id
    JOIN public.subcontract_work_master work
      ON work.id = line.subcontract_work_id
    WHERE source_estimate.work_order_no = v_estimate.work_order_no
      AND line.final_approved_revision IS NOT NULL
    GROUP BY line.subcontract_work_id, work.sub_head, work.material_details, work.unit
    ORDER BY line.subcontract_work_id
  LOOP
    v_seen_work_ids := array_append(v_seen_work_ids, v_scope.subcontract_work_id);
    v_item_id := NULL;
    v_rate := CASE
      WHEN v_scope.effective_qty > 0
        THEN round(v_scope.effective_amount / v_scope.effective_qty, 4)
      ELSE 0
    END;

    SELECT item_id INTO v_item_id
    FROM public.project_cost_estimate_items
    WHERE estimate_id = p_cost_estimate_id
      AND source_type = 'SUBCONTRACT_ESTIMATE'
      AND subcontract_work_id = v_scope.subcontract_work_id
    FOR UPDATE;

    IF v_item_id IS NULL THEN
      INSERT INTO public.project_cost_estimate_items (
        estimate_id, material_main_head, material_sub_head, material_details,
        unit, qty, rate, amount, source_type, subcontract_work_id,
        created_at, updated_at
      ) VALUES (
        p_cost_estimate_id, 'Sub Contractor', v_scope.sub_head,
        v_scope.material_details, v_scope.unit, v_scope.effective_qty,
        v_rate, v_scope.effective_amount, 'SUBCONTRACT_ESTIMATE',
        v_scope.subcontract_work_id, now(), now()
      ) RETURNING item_id INTO v_item_id;
    ELSE
      UPDATE public.project_cost_estimate_items
      SET material_main_head = 'Sub Contractor',
          material_sub_head = v_scope.sub_head,
          material_details = v_scope.material_details,
          unit = v_scope.unit,
          qty = v_scope.effective_qty,
          rate = v_rate,
          amount = v_scope.effective_amount,
          source_of_purchase = NULL,
          zo_office_approve = CASE
            WHEN qty = v_scope.effective_qty AND amount = v_scope.effective_amount
              THEN zo_office_approve ELSE NULL END,
          zo_remarks = CASE
            WHEN qty = v_scope.effective_qty AND amount = v_scope.effective_amount
              THEN zo_remarks ELSE NULL END,
          ho_office_approve = CASE
            WHEN qty = v_scope.effective_qty AND amount = v_scope.effective_amount
              THEN ho_office_approve ELSE NULL END,
          ho_remarks = CASE
            WHEN qty = v_scope.effective_qty AND amount = v_scope.effective_amount
              THEN ho_remarks ELSE NULL END,
          updated_at = CASE
            WHEN qty = v_scope.effective_qty AND amount = v_scope.effective_amount
              THEN updated_at ELSE now() END
      WHERE item_id = v_item_id;
    END IF;

    FOR v_source IN
      SELECT line_id, qty, amount
      FROM public.project_subcontract_estimate_lines
      WHERE subcontract_estimate_id IN (
        SELECT subcontract_estimate_id
        FROM public.project_subcontract_estimates
        WHERE work_order_no = v_estimate.work_order_no
      )
        AND subcontract_work_id = v_scope.subcontract_work_id
        AND final_approved_revision IS NOT NULL
      ORDER BY line_id
    LOOP
      INSERT INTO public.cost_estimate_subcontract_contributions (
        cost_estimate_item_id, subcontract_estimate_line_id,
        qty_contribution, amount_contribution, created_by
      ) VALUES (
        v_item_id, v_source.line_id, v_source.qty, v_source.amount,
        COALESCE(p_actor, 'SYSTEM')
      ) ON CONFLICT (cost_estimate_item_id, subcontract_estimate_line_id)
        DO NOTHING;
    END LOOP;
  END LOOP;

  -- Keep a zero/zero/zero tombstone for a previously generated work whose
  -- approved aggregate is now exactly zero. Never delete the projection.
  UPDATE public.project_cost_estimate_items item
  SET qty = 0, rate = 0, amount = 0,
      source_of_purchase = NULL,
      zo_office_approve = NULL, zo_remarks = NULL,
      ho_office_approve = NULL, ho_remarks = NULL,
      updated_at = now()
  WHERE item.estimate_id = p_cost_estimate_id
    AND item.source_type = 'SUBCONTRACT_ESTIMATE'
    AND (cardinality(v_seen_work_ids) = 0
         OR item.subcontract_work_id <> ALL(v_seen_work_ids))
    AND (item.qty <> 0 OR item.rate <> 0 OR item.amount <> 0);

  UPDATE public.project_cost_estimates
  SET estimate_amount = COALESCE((
        SELECT sum(amount) FROM public.project_cost_estimate_items
        WHERE estimate_id = p_cost_estimate_id
      ), 0),
      last_modified_by = COALESCE(p_actor, last_modified_by),
      updated_at = now()
  WHERE estimate_id = p_cost_estimate_id
    AND (estimate_amount IS DISTINCT FROM COALESCE((
      SELECT sum(amount) FROM public.project_cost_estimate_items
      WHERE estimate_id = p_cost_estimate_id
    ), 0)
    OR last_modified_by IS DISTINCT FROM COALESCE(p_actor, last_modified_by));
END;
$$;

REVOKE ALL ON FUNCTION public.guard_generated_cost_estimate_item_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_generated_cost_estimate_item_mutation() TO service_role;
REVOKE ALL ON FUNCTION public.sync_subcontract_contributions_to_cost_estimate(uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_subcontract_contributions_to_cost_estimate(uuid, varchar) TO service_role;

-- Preserve the Cost Estimate row-review behavior, but exclude generated
-- work-level projections from the legacy contractor-balance credit path.
CREATE OR REPLACE FUNCTION public.submit_row_approvals(
  p_estimate_id uuid,
  p_approvals jsonb,
  p_stage text,
  p_modified_by varchar
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role varchar;
  approval jsonb;
  v_item_id uuid;
  v_approve_status text;
  v_remarks text;
  v_status public.estimate_status_enum;
  v_new_amount numeric(18,2);
  v_work_order_no varchar;
  v_item public.project_cost_estimate_items%ROWTYPE;
  v_prev_ho_approve public.row_approval_enum;
  v_clean_sub_head varchar;
  v_clean_details varchar;
BEGIN
  SELECT role INTO v_user_role FROM public.authorised_users
  WHERE mobile_number = p_modified_by AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.'; END IF;
  IF p_stage = 'ZO' AND v_user_role NOT IN ('zo', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have ZO or Admin role.';
  END IF;
  IF p_stage = 'HO' AND v_user_role NOT IN ('ho', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have HO or Admin role.';
  END IF;

  SELECT estimate_status, btrim(work_order_no) INTO v_status, v_work_order_no
  FROM public.project_cost_estimates WHERE estimate_id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found: %', p_estimate_id; END IF;
  IF p_stage = 'ZO' AND v_status NOT IN ('Under ZO Review', 'ZO Revision Requested') THEN
    RAISE EXCEPTION 'ZO row approvals can only be submitted when estimate is Under ZO Review. Current status: %', v_status;
  END IF;
  IF p_stage = 'HO' AND v_status NOT IN ('Under HO Review', 'HO Revision Requested') THEN
    RAISE EXCEPTION 'HO row approvals can only be submitted when estimate is Under HO Review. Current status: %', v_status;
  END IF;

  FOR approval IN SELECT value FROM jsonb_array_elements(p_approvals) LOOP
    v_item_id := (approval->>'item_id')::uuid;
    v_approve_status := approval->>'approve_status';
    v_remarks := approval->>'remarks';
    SELECT * INTO v_item FROM public.project_cost_estimate_items
    WHERE item_id = v_item_id AND estimate_id = p_estimate_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item ID % not found or does not belong to estimate %.', v_item_id, p_estimate_id; END IF;
    v_prev_ho_approve := v_item.ho_office_approve;

    IF p_stage = 'ZO' THEN
      UPDATE public.project_cost_estimate_items
      SET zo_office_approve = v_approve_status::public.row_approval_enum,
          zo_remarks = v_remarks, updated_at = now()
      WHERE item_id = v_item_id AND estimate_id = p_estimate_id;
    ELSIF p_stage = 'HO' THEN
      IF v_approve_status = 'Approve'
         AND v_item.zo_office_approve IS DISTINCT FROM 'Approve'::public.row_approval_enum THEN
        RAISE EXCEPTION 'Item % cannot be approved by HO because ZO approval is missing or rejected (zo_status: %).', v_item_id, v_item.zo_office_approve;
      END IF;
      UPDATE public.project_cost_estimate_items
      SET ho_office_approve = v_approve_status::public.row_approval_enum,
          ho_remarks = v_remarks, updated_at = now()
      WHERE item_id = v_item_id AND estimate_id = p_estimate_id;
    ELSE
      RAISE EXCEPTION 'Invalid stage: %. Must be ZO or HO.', p_stage;
    END IF;

    IF p_stage = 'HO' AND v_approve_status = 'Approve'
       AND v_prev_ho_approve IS DISTINCT FROM 'Approve'::public.row_approval_enum
       AND v_item.source_type IS DISTINCT FROM 'SUBCONTRACT_ESTIMATE'
       AND btrim(v_item.material_main_head) = 'Sub Contractor'
       AND v_item.zo_office_approve = 'Approve' THEN
      v_clean_sub_head := btrim(v_item.material_sub_head);
      v_clean_details := btrim(v_item.material_details);
      INSERT INTO public.subcontractor_balances
        (work_order_no, material_main_head, material_sub_head, material_details, estimated_total, available_balance)
      VALUES (v_work_order_no, 'Sub Contractor', v_clean_sub_head, v_clean_details, v_item.amount, v_item.amount)
      ON CONFLICT (work_order_no, material_main_head, material_sub_head, material_details) DO UPDATE
      SET estimated_total = subcontractor_balances.estimated_total + v_item.amount,
          available_balance = subcontractor_balances.available_balance + v_item.amount,
          updated_at = now();
      INSERT INTO public.subcontractor_ledger
        (work_order_no, material_main_head, material_sub_head, material_details, transaction_type, reference_type, reference_id, amount, created_by)
      VALUES (v_work_order_no, 'Sub Contractor', v_clean_sub_head, v_clean_details,
              'ESTIMATE_ITEM_APPROVAL', 'ESTIMATE_ITEM', v_item_id, v_item.amount, p_modified_by)
      ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;
    END IF;
  END LOOP;

  IF v_status IN ('Draft', 'Submitted', 'Under ZO Review', 'ZO Revision Requested', 'Rejected by ZO', 'Rejected by HO') THEN
    SELECT COALESCE(sum(amount), 0) INTO v_new_amount
    FROM public.project_cost_estimate_items WHERE estimate_id = p_estimate_id;
  ELSIF v_status IN ('ZO Approved', 'Under HO Review', 'HO Revision Requested', 'Estimate Reopened') THEN
    SELECT COALESCE(sum(amount), 0) INTO v_new_amount
    FROM public.project_cost_estimate_items
    WHERE estimate_id = p_estimate_id AND zo_office_approve = 'Approve';
  ELSIF v_status = 'Final Approved' THEN
    SELECT COALESCE(sum(amount), 0) INTO v_new_amount
    FROM public.project_cost_estimate_items
    WHERE estimate_id = p_estimate_id AND zo_office_approve = 'Approve' AND ho_office_approve = 'Approve';
  ELSE
    SELECT COALESCE(sum(amount), 0) INTO v_new_amount
    FROM public.project_cost_estimate_items WHERE estimate_id = p_estimate_id;
  END IF;
  UPDATE public.project_cost_estimates
  SET estimate_amount = v_new_amount, last_modified_by = p_modified_by, updated_at = now()
  WHERE estimate_id = p_estimate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_row_approvals(uuid, jsonb, text, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_row_approvals(uuid, jsonb, text, varchar) TO service_role;
