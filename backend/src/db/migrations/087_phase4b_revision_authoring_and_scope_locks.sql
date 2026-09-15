-- Migration 087: complete Phase 4B revision authoring and financial scope locks.
--
-- 1. Revision-requested estimates are editable by JE/Admin using the same
--    reconciliation RPC, with BASE allowed only during revision cycle zero.
-- 2. Final Approval and subcontractor requisition reservation serialize on
--    the same stable (WO, subcontractor, work) advisory lock.  This closes
--    the phantom-reservation window left by locking only existing ledger rows.

CREATE OR REPLACE FUNCTION public.lock_subcontract_financial_scope(
  p_work_order_no varchar,
  p_subcontractor_id uuid,
  p_subcontract_work_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_work_order_no IS NULL OR p_subcontractor_id IS NULL OR p_subcontract_work_id IS NULL THEN
    RAISE EXCEPTION 'Subcontract financial scope identity is incomplete' USING ERRCODE = 'P4B60';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'subcontract-financial-scope|' || btrim(p_work_order_no) || '|' ||
    p_subcontractor_id::text || '|' || p_subcontract_work_id::text,
    0
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.lock_subcontract_financial_scope(varchar, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_subcontract_financial_scope(varchar, uuid, uuid)
  TO service_role;

-- Preserve the previously deployed implementations behind private names. The
-- public wrappers below acquire the shared lock before entering them.
ALTER FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  RENAME TO transition_subcontract_estimate_workflow_unlocked;

CREATE OR REPLACE FUNCTION public.transition_subcontract_estimate_workflow(
  p_estimate_id uuid,
  p_actor varchar,
  p_action varchar,
  p_remarks text,
  p_expected_updated_at timestamptz,
  p_deadline_hours integer DEFAULT 24
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_work_order_no varchar;
  v_scope record;
BEGIN
  IF p_action = 'HO_APPROVE' THEN
    SELECT work_order_no INTO v_work_order_no
    FROM public.project_subcontract_estimates
    WHERE subcontract_estimate_id = p_estimate_id;

    IF v_work_order_no IS NOT NULL THEN
      FOR v_scope IN
        SELECT DISTINCT subcontractor_id, subcontract_work_id
        FROM public.project_subcontract_estimate_lines
        WHERE subcontract_estimate_id = p_estimate_id
      LOOP
        PERFORM public.lock_subcontract_financial_scope(
          v_work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id
        );
      END LOOP;
    END IF;
  END IF;

  PERFORM public.transition_subcontract_estimate_workflow_unlocked(
    p_estimate_id, p_actor, p_action, p_remarks,
    p_expected_updated_at, p_deadline_hours
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_subcontract_estimate_workflow_unlocked(uuid, varchar, varchar, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  TO service_role;

ALTER FUNCTION public.approve_requisition_transact(uuid, numeric, varchar, text)
  RENAME TO approve_requisition_transact_unlocked;

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
  END IF;

  RETURN public.approve_requisition_transact_unlocked(
    p_requisition_id, p_approved_amount, p_actioned_by,
    p_remarks_approved_authority
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_requisition_transact_unlocked(uuid, numeric, varchar, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_requisition_transact(uuid, numeric, varchar, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_requisition_transact(uuid, numeric, varchar, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_subcontract_estimate_lines(
  p_estimate_id uuid,
  p_actor varchar,
  p_expected_updated_at timestamptz,
  p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estimate public.project_subcontract_estimates%ROWTYPE;
  v_actor public.authorised_users%ROWTYPE;
  v_line jsonb;
  v_line_id uuid;
  v_subcontractor_id uuid;
  v_subcontract_work_id uuid;
  v_qty numeric(18,4);
  v_rate numeric(18,4);
  v_amount numeric(18,2);
  v_kind varchar;
  v_existing public.project_subcontract_estimate_lines%ROWTYPE;
  v_target public.project_subcontract_estimate_lines%ROWTYPE;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_revision_authoring boolean;
  v_base_authoring boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array' USING ERRCODE = 'P4B40';
  END IF;

  SELECT * INTO v_actor FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND OR v_actor.role NOT IN ('je', 'admin') THEN
    RAISE EXCEPTION 'Only JE or Admin may author estimate lines' USING ERRCODE = 'P4B41';
  END IF;

  SELECT * INTO v_estimate FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B42';
  END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B43';
  END IF;
  IF v_estimate.estimate_status NOT IN (
    'Draft', 'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'
  ) THEN
    RAISE EXCEPTION 'Estimate is not editable in its current state' USING ERRCODE = 'P4B44';
  END IF;
  IF v_actor.role = 'je' AND NOT EXISTS (
    SELECT 1 FROM public.work_order_mappings
    WHERE work_order_no = v_estimate.work_order_no
      AND je_user_id = p_actor AND is_active = true
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this Work Order' USING ERRCODE = 'P4B45';
  END IF;

  v_base_authoring := v_estimate.estimate_status = 'Draft'
    OR (v_estimate.estimate_status IN ('ZO Revision Requested', 'HO Revision Requested')
        AND v_estimate.estimate_revision = 0);
  v_revision_authoring := v_estimate.estimate_status IN (
    'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_line_id := NULLIF(v_line->>'line_id', '')::uuid;
    v_subcontractor_id := NULLIF(v_line->>'subcontractor_id', '')::uuid;
    v_subcontract_work_id := NULLIF(v_line->>'subcontract_work_id', '')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_rate := (v_line->>'rate')::numeric;

    IF v_line_id IS NOT NULL THEN
      SELECT * INTO v_existing
      FROM public.project_subcontract_estimate_lines
      WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line does not belong to this estimate' USING ERRCODE = 'P4B50';
      END IF;
      IF v_existing.final_approved_revision IS NOT NULL THEN
        RAISE EXCEPTION 'Historically Final Approved contributions are immutable' USING ERRCODE = 'P4B51';
      END IF;
    END IF;

    v_kind := NULLIF(v_line->>'entry_kind', '');
    IF v_kind IS NULL AND v_line_id IS NOT NULL THEN
      v_kind := v_existing.entry_kind;
    END IF;
    IF v_kind IS NULL AND v_base_authoring THEN
      v_kind := 'BASE';
    END IF;

    IF v_kind NOT IN ('BASE', 'ADDITION', 'ADJUSTMENT') THEN
      RAISE EXCEPTION 'Invalid contribution entry kind' USING ERRCODE = 'P4B46';
    END IF;
    IF NOT v_base_authoring AND v_kind = 'BASE' THEN
      RAISE EXCEPTION 'BASE contributions are prohibited after the initial Draft generation' USING ERRCODE = 'P4B47';
    END IF;
    IF v_qty IS NULL OR v_rate IS NULL OR v_rate <= 0
       OR (v_kind IN ('BASE', 'ADDITION') AND v_qty <= 0)
       OR (v_kind = 'ADJUSTMENT' AND v_qty = 0) THEN
      RAISE EXCEPTION 'Invalid quantity or rate for contribution' USING ERRCODE = 'P4B48';
    END IF;
    v_amount := round(v_qty * v_rate, 2);

    IF NOT EXISTS (
      SELECT 1 FROM public.subcontractor_master
      WHERE id = v_subcontractor_id AND is_active = true
    ) AND NOT EXISTS (
      SELECT 1 FROM public.project_subcontract_estimate_lines
      WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id
        AND subcontractor_id = v_subcontractor_id
    ) THEN
      RAISE EXCEPTION 'New subcontractor selection must be active' USING ERRCODE = 'P4B48';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.subcontract_work_master
      WHERE id = v_subcontract_work_id AND is_active = true
    ) AND NOT EXISTS (
      SELECT 1 FROM public.project_subcontract_estimate_lines
      WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id
        AND subcontract_work_id = v_subcontract_work_id
    ) THEN
      RAISE EXCEPTION 'New subcontract work selection must be active' USING ERRCODE = 'P4B48';
    END IF;

    IF v_kind = 'ADJUSTMENT' THEN
      IF NULLIF(v_line->>'adjusts_line_id', '') IS NULL THEN
        RAISE EXCEPTION 'ADJUSTMENT must identify a target contribution' USING ERRCODE = 'P4B49';
      END IF;
      SELECT * INTO v_target
      FROM public.project_subcontract_estimate_lines
      WHERE line_id = (v_line->>'adjusts_line_id')::uuid
        AND subcontract_estimate_id = p_estimate_id FOR UPDATE;
      IF NOT FOUND OR v_target.final_approved_revision IS NULL
         OR v_target.subcontractor_id <> v_subcontractor_id
         OR v_target.subcontract_work_id <> v_subcontract_work_id THEN
        RAISE EXCEPTION 'Adjustment target must be a historically approved line in the same contractor/work scope'
          USING ERRCODE = 'P4B49';
      END IF;
    ELSIF NULLIF(v_line->>'adjusts_line_id', '') IS NOT NULL THEN
      RAISE EXCEPTION 'Only ADJUSTMENT contributions may have a target' USING ERRCODE = 'P4B49';
    END IF;

    IF v_line_id IS NOT NULL THEN
      UPDATE public.project_subcontract_estimate_lines
      SET subcontractor_id = v_subcontractor_id,
          subcontract_work_id = v_subcontract_work_id,
          qty = v_qty,
          rate = v_rate,
          amount = v_amount,
          rate_reference = NULLIF(v_line->>'rate_reference', ''),
          remarks = NULLIF(v_line->>'remarks', ''),
          entry_kind = v_kind,
          adjusts_line_id = NULLIF(v_line->>'adjusts_line_id', '')::uuid,
          zo_office_approve = NULL,
          zo_remarks = NULL,
          ho_office_approve = NULL,
          ho_remarks = NULL,
          updated_by = p_actor
      WHERE line_id = v_line_id;
    ELSE
      INSERT INTO public.project_subcontract_estimate_lines
        (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount,
         rate_reference, remarks, entry_kind, adjusts_line_id, created_by)
      VALUES
        (p_estimate_id, v_subcontractor_id, v_subcontract_work_id, v_qty, v_rate, v_amount,
         NULLIF(v_line->>'rate_reference', ''), NULLIF(v_line->>'remarks', ''), v_kind,
         NULLIF(v_line->>'adjusts_line_id', '')::uuid, p_actor)
      RETURNING line_id INTO v_line_id;
    END IF;
    v_seen := array_append(v_seen, v_line_id);
  END LOOP;

  DELETE FROM public.project_subcontract_estimate_lines
  WHERE subcontract_estimate_id = p_estimate_id
    AND final_approved_revision IS NULL
    AND (line_id <> ALL(v_seen) OR cardinality(v_seen) = 0);

  UPDATE public.project_subcontract_estimates
  SET estimate_amount = COALESCE((SELECT sum(amount)
                                  FROM public.project_subcontract_estimate_lines
                                  WHERE subcontract_estimate_id = p_estimate_id), 0),
      last_modified_by = p_actor
  WHERE subcontract_estimate_id = p_estimate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  TO service_role;
