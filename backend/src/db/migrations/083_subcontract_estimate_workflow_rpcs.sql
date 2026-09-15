-- Migration 083: transactional Subcontractor Estimate header workflow.
-- Phase 4B M2. Row decision editing and reopen authoring are layered on later.

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
SECURITY INVOKER
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
    LOOP
      SELECT COALESCE(sum(amount), 0) INTO v_effective
      FROM public.project_subcontract_estimate_lines
      WHERE subcontract_estimate_id = p_estimate_id
        AND subcontractor_id = v_scope.subcontractor_id
        AND subcontract_work_id = v_scope.subcontract_work_id;

      PERFORM 1 FROM public.subcontractor_ledger
      WHERE work_order_no = v_estimate.work_order_no
        AND subcontractor_id = v_scope.subcontractor_id
        AND subcontract_work_id = v_scope.subcontract_work_id
        AND transaction_type = 'REQUISITION_APPROVAL'
        AND settlement_status IN ('RESERVED', 'SETTLED')
      FOR UPDATE;
      SELECT COALESCE(sum(abs(amount)), 0) INTO v_consumed
      FROM public.subcontractor_ledger
      WHERE work_order_no = v_estimate.work_order_no
        AND subcontractor_id = v_scope.subcontractor_id
        AND subcontract_work_id = v_scope.subcontract_work_id
        AND transaction_type = 'REQUISITION_APPROVAL'
        AND settlement_status IN ('RESERVED', 'SETTLED');
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
