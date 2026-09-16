-- Migration 093: consolidate Phase 4 runtime paths.
-- This forward migration installs the final canonical implementations without
-- rewriting migrations 076-092 or changing Phase 5/Finance write semantics.

-- One reconciliation implementation handles Draft, revision-requested, and
-- reopened authoring. The old Draft RPC is retired after caller migration.
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
    IF v_base_authoring AND v_kind <> 'BASE' THEN
      RAISE EXCEPTION 'Only BASE contributions are allowed before the first Final Approval' USING ERRCODE = 'P4B52';
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

-- The workflow state machine, financial lock/guard, provenance stamping, and
-- audit event insertion now live in the one public workflow function.
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
  v_estimate public.project_subcontract_estimates%ROWTYPE;
  v_actor public.authorised_users%ROWTYPE;
  v_from public.estimate_status_enum;
  v_to public.estimate_status_enum;
  v_stage varchar;
  v_cycle integer;
  v_line_count integer;
  v_pending_count integer;
  v_now timestamptz := now();
  v_scope record;
  v_effective numeric(18,2);
  v_consumed numeric(18,2);
BEGIN
  IF p_action NOT IN (
    'SUBMIT', 'RESUBMIT', 'OPEN_ZO_REVIEW', 'ZO_APPROVE',
    'ZO_REQUEST_REVISION', 'ZO_REJECT', 'OPEN_HO_REVIEW',
    'HO_APPROVE', 'HO_REQUEST_REVISION', 'HO_REJECT'
  ) THEN
    RAISE EXCEPTION 'Unsupported workflow action' USING ERRCODE = 'P4B10';
  END IF;
  IF p_deadline_hours < 1 OR p_deadline_hours > 168 THEN
    RAISE EXCEPTION 'Revision deadline must be between 1 and 168 hours' USING ERRCODE = 'P4B10';
  END IF;
  IF p_action IN ('ZO_REQUEST_REVISION', 'ZO_REJECT', 'HO_REQUEST_REVISION', 'HO_REJECT')
     AND NULLIF(btrim(COALESCE(p_remarks, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Remarks are required for this workflow action' USING ERRCODE = 'P4B10';
  END IF;

  SELECT * INTO v_actor FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active workflow actor not found' USING ERRCODE = 'P4B11';
  END IF;

  SELECT * INTO v_estimate FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B12';
  END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B13';
  END IF;

  IF v_actor.role = 'je' AND NOT EXISTS (
    SELECT 1 FROM public.work_order_mappings
    WHERE work_order_no = v_estimate.work_order_no
      AND je_user_id = p_actor AND is_active = true
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this Work Order' USING ERRCODE = 'P4B14';
  END IF;
  IF v_actor.role = 'zo' AND NOT EXISTS (
    SELECT 1
    FROM public.work_order_mappings wom
    JOIN public.je_zo_mappings jzm ON jzm.je_user_id = wom.je_user_id
    WHERE wom.work_order_no = v_estimate.work_order_no
      AND wom.is_active = true AND jzm.zo_user_id = p_actor AND jzm.is_active = true
  ) THEN
    RAISE EXCEPTION 'This Work Order is outside your ZO scope' USING ERRCODE = 'P4B14';
  END IF;

  v_from := v_estimate.estimate_status;
  v_to := NULL;
  IF p_action IN ('SUBMIT', 'RESUBMIT') THEN
    IF v_from NOT IN ('Draft', 'ZO Revision Requested', 'HO Revision Requested') THEN
      RAISE EXCEPTION 'Estimate cannot be submitted in its current status' USING ERRCODE = 'P4B15';
    END IF;
    IF v_actor.role NOT IN ('je', 'admin') THEN
      RAISE EXCEPTION 'Only JE or Admin may submit estimates' USING ERRCODE = 'P4B14';
    END IF;
    SELECT count(*) INTO v_line_count FROM public.project_subcontract_estimate_lines
    WHERE subcontract_estimate_id = p_estimate_id;
    IF v_line_count = 0 THEN
      RAISE EXCEPTION 'Estimate must contain at least one contribution' USING ERRCODE = 'P4B16';
    END IF;
    v_to := 'Submitted';
    UPDATE public.project_subcontract_estimate_lines
    SET zo_office_approve = NULL, zo_remarks = NULL,
        ho_office_approve = NULL, ho_remarks = NULL,
        updated_by = p_actor
    WHERE subcontract_estimate_id = p_estimate_id
      AND final_approved_revision IS NULL;
    UPDATE public.subcontract_estimate_revision_log
    SET resubmitted_at = v_now, resubmitted_by = p_actor
    WHERE subcontract_estimate_id = p_estimate_id AND resubmitted_at IS NULL;
    UPDATE public.project_subcontract_estimates
    SET estimate_status = v_to,
        je_user_id = COALESCE(je_user_id, p_actor),
        je_date = COALESCE(je_date, v_now),
        last_modified_by = p_actor
    WHERE subcontract_estimate_id = p_estimate_id;
  ELSIF p_action = 'OPEN_ZO_REVIEW' THEN
    IF v_from <> 'Submitted' OR v_actor.role NOT IN ('zo', 'admin') THEN
      RAISE EXCEPTION 'ZO review cannot be opened from the current state' USING ERRCODE = 'P4B15';
    END IF;
    v_to := 'Under ZO Review';
  ELSIF p_action = 'ZO_APPROVE' THEN
    IF v_from <> 'Under ZO Review' OR v_actor.role NOT IN ('zo', 'admin') THEN
      RAISE EXCEPTION 'ZO approval cannot be completed from the current state' USING ERRCODE = 'P4B15';
    END IF;
    SELECT count(*) INTO v_pending_count FROM public.project_subcontract_estimate_lines
    WHERE subcontract_estimate_id = p_estimate_id AND final_approved_revision IS NULL
      AND zo_office_approve IS DISTINCT FROM 'Approve'::public.row_approval_enum;
    IF v_pending_count > 0 THEN
      RAISE EXCEPTION 'Every current contribution must be approved by ZO' USING ERRCODE = 'P4B17';
    END IF;
    v_to := 'ZO Approved';
  ELSIF p_action = 'OPEN_HO_REVIEW' THEN
    IF v_from <> 'ZO Approved' OR v_actor.role NOT IN ('ho', 'admin') THEN
      RAISE EXCEPTION 'HO review cannot be opened from the current state' USING ERRCODE = 'P4B15';
    END IF;
    v_to := 'Under HO Review';
  ELSIF p_action = 'HO_APPROVE' THEN
    IF v_from <> 'Under HO Review' OR v_actor.role NOT IN ('ho', 'admin') THEN
      RAISE EXCEPTION 'HO approval cannot be completed from the current state' USING ERRCODE = 'P4B15';
    END IF;
    SELECT count(*) INTO v_pending_count FROM public.project_subcontract_estimate_lines
    WHERE subcontract_estimate_id = p_estimate_id AND final_approved_revision IS NULL
      AND (zo_office_approve IS DISTINCT FROM 'Approve'::public.row_approval_enum
        OR ho_office_approve IS DISTINCT FROM 'Approve'::public.row_approval_enum);
    IF v_pending_count > 0 THEN
      RAISE EXCEPTION 'Every current contribution must be approved by ZO and HO' USING ERRCODE = 'P4B17';
    END IF;

    FOR v_scope IN
      SELECT subcontractor_id, subcontract_work_id
      FROM public.project_subcontract_estimate_lines
      WHERE subcontract_estimate_id = p_estimate_id
      GROUP BY subcontractor_id, subcontract_work_id
      ORDER BY subcontractor_id, subcontract_work_id
    LOOP
      PERFORM public.lock_subcontract_financial_scope(
        v_estimate.work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id
      );
      SELECT COALESCE(sum(amount), 0)::numeric(18,2) INTO v_effective
      FROM public.project_subcontract_estimate_lines
      WHERE subcontract_estimate_id = p_estimate_id
        AND subcontractor_id = v_scope.subcontractor_id
        AND subcontract_work_id = v_scope.subcontract_work_id;
      v_consumed := public.get_subcontract_financial_consumption(
        v_estimate.work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id
      );
      IF v_effective < v_consumed THEN
        RAISE EXCEPTION 'SUBCONTRACT_SCOPE_BELOW_FINANCIAL_CONSUMPTION: proposed %, consumed %', v_effective, v_consumed
          USING ERRCODE = 'P4B18';
      END IF;
    END LOOP;
    v_to := 'Final Approved';
    UPDATE public.project_subcontract_estimate_lines
    SET final_approved_revision = v_estimate.estimate_revision,
        final_approved_at = v_now,
        final_approved_by = p_actor,
        updated_by = p_actor
    WHERE subcontract_estimate_id = p_estimate_id AND final_approved_revision IS NULL;
    UPDATE public.project_subcontract_estimates
    SET estimate_status = v_to,
        last_approved_amount = estimate_amount,
        ho_approved_by = p_actor,
        ho_approval_date = v_now,
        ho_remarks = NULLIF(btrim(COALESCE(p_remarks, '')), ''),
        last_modified_by = p_actor
    WHERE subcontract_estimate_id = p_estimate_id;
  ELSIF p_action = 'ZO_REQUEST_REVISION' THEN
    IF v_from <> 'Under ZO Review' OR v_actor.role NOT IN ('zo', 'admin') THEN
      RAISE EXCEPTION 'ZO revision cannot be requested from the current state' USING ERRCODE = 'P4B15';
    END IF;
    v_stage := 'ZO'; v_to := 'ZO Revision Requested';
  ELSIF p_action = 'ZO_REJECT' THEN
    IF v_from <> 'Under ZO Review' OR v_actor.role NOT IN ('zo', 'admin') THEN
      RAISE EXCEPTION 'ZO rejection cannot be completed from the current state' USING ERRCODE = 'P4B15';
    END IF;
    v_to := 'Rejected by ZO';
  ELSIF p_action = 'HO_REQUEST_REVISION' THEN
    IF v_from <> 'Under HO Review' OR v_actor.role NOT IN ('ho', 'admin') THEN
      RAISE EXCEPTION 'HO revision cannot be requested from the current state' USING ERRCODE = 'P4B15';
    END IF;
    v_stage := 'HO'; v_to := 'HO Revision Requested';
  ELSIF p_action = 'HO_REJECT' THEN
    IF v_from <> 'Under HO Review' OR v_actor.role NOT IN ('ho', 'admin') THEN
      RAISE EXCEPTION 'HO rejection cannot be completed from the current state' USING ERRCODE = 'P4B15';
    END IF;
    v_to := 'Rejected by HO';
  END IF;

  IF p_action IN ('OPEN_ZO_REVIEW', 'ZO_APPROVE', 'OPEN_HO_REVIEW', 'ZO_REQUEST_REVISION', 'ZO_REJECT', 'HO_REQUEST_REVISION', 'HO_REJECT') THEN
    UPDATE public.project_subcontract_estimates
    SET estimate_status = v_to,
        zo_remarks = CASE WHEN p_action LIKE 'ZO_%' THEN NULLIF(btrim(COALESCE(p_remarks, '')), '') ELSE zo_remarks END,
        ho_remarks = CASE WHEN p_action LIKE 'HO_%' THEN NULLIF(btrim(COALESCE(p_remarks, '')), '') ELSE ho_remarks END,
        last_modified_by = p_actor
    WHERE subcontract_estimate_id = p_estimate_id;
  END IF;

  IF p_action IN ('ZO_REQUEST_REVISION', 'HO_REQUEST_REVISION') THEN
    SELECT COALESCE(max(revision_cycle), 0) + 1 INTO v_cycle
    FROM public.subcontract_estimate_revision_log
    WHERE subcontract_estimate_id = p_estimate_id AND stage = v_stage;
    INSERT INTO public.subcontract_estimate_revision_log
      (subcontract_estimate_id, revision_cycle, stage, requested_by, revision_deadline)
    VALUES (p_estimate_id, v_cycle, v_stage, p_actor, v_now + make_interval(hours => p_deadline_hours));
  END IF;

  INSERT INTO public.project_subcontract_estimate_workflow_log
    (subcontract_estimate_id, revision, from_status, to_status, action, actor, actor_role, remarks)
  VALUES (p_estimate_id, v_estimate.estimate_revision, v_from, v_to, p_action, p_actor, v_actor.role,
          NULLIF(btrim(COALESCE(p_remarks, '')), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  TO service_role;

DROP FUNCTION IF EXISTS public.save_subcontract_estimate_draft_lines(uuid, varchar, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.transition_subcontract_estimate_workflow_unlocked(uuid, varchar, varchar, text, timestamptz, integer);

COMMENT ON FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  IS 'Phase 4 canonical estimate-line reconciliation for Draft, revision-requested, and reopened states.';
COMMENT ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  IS 'Phase 4 canonical transactional workflow state machine with financial scope serialization.';
