-- Migration 084: transactional row-level ZO/HO review decisions.

CREATE OR REPLACE FUNCTION public.review_subcontract_estimate_rows(
  p_estimate_id uuid,
  p_actor varchar,
  p_stage varchar,
  p_approvals jsonb,
  p_expected_updated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_estimate public.project_subcontract_estimates%ROWTYPE;
  v_actor public.authorised_users%ROWTYPE;
  v_approval jsonb;
  v_line public.project_subcontract_estimate_lines%ROWTYPE;
  v_line_id uuid;
  v_status public.row_approval_enum;
  v_remarks text;
BEGIN
  IF p_stage NOT IN ('ZO', 'HO') OR jsonb_typeof(COALESCE(p_approvals, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Invalid row review payload' USING ERRCODE = 'P4B20';
  END IF;
  IF jsonb_array_length(COALESCE(p_approvals, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'At least one row decision is required' USING ERRCODE = 'P4B20';
  END IF;

  SELECT * INTO v_actor FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND OR (p_stage = 'ZO' AND v_actor.role NOT IN ('zo', 'admin'))
     OR (p_stage = 'HO' AND v_actor.role NOT IN ('ho', 'admin')) THEN
    RAISE EXCEPTION 'Actor is not authorized for this review stage' USING ERRCODE = 'P4B21';
  END IF;

  SELECT * INTO v_estimate FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B22';
  END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B23';
  END IF;
  IF (p_stage = 'ZO' AND v_estimate.estimate_status <> 'Under ZO Review')
     OR (p_stage = 'HO' AND v_estimate.estimate_status <> 'Under HO Review') THEN
    RAISE EXCEPTION 'Estimate is not open for this review stage' USING ERRCODE = 'P4B24';
  END IF;
  IF v_actor.role = 'zo' AND NOT EXISTS (
    SELECT 1 FROM public.work_order_mappings wom
    JOIN public.je_zo_mappings jzm ON jzm.je_user_id = wom.je_user_id
    WHERE wom.work_order_no = v_estimate.work_order_no
      AND wom.is_active = true AND jzm.zo_user_id = p_actor AND jzm.is_active = true
  ) THEN
    RAISE EXCEPTION 'This Work Order is outside your ZO scope' USING ERRCODE = 'P4B25';
  END IF;

  FOR v_approval IN SELECT value FROM jsonb_array_elements(p_approvals) LOOP
    v_line_id := (v_approval->>'line_id')::uuid;
    v_status := (v_approval->>'approve_status')::public.row_approval_enum;
    v_remarks := NULLIF(btrim(COALESCE(v_approval->>'remarks', '')), '');
    IF v_status IS NULL OR v_status NOT IN ('Approve', 'Not Approve') THEN
      RAISE EXCEPTION 'Invalid row approval decision' USING ERRCODE = 'P4B20';
    END IF;
    IF v_status = 'Not Approve' AND v_remarks IS NULL THEN
      RAISE EXCEPTION 'Remarks are required for a row marked Not Approve' USING ERRCODE = 'P4B20';
    END IF;

    SELECT * INTO v_line FROM public.project_subcontract_estimate_lines
    WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Row does not belong to this estimate' USING ERRCODE = 'P4B26';
    END IF;
    IF v_line.final_approved_revision IS NOT NULL THEN
      RAISE EXCEPTION 'Historically Final Approved rows cannot be reviewed again' USING ERRCODE = 'P4B27';
    END IF;

    IF p_stage = 'HO' AND v_status = 'Approve'
       AND v_line.zo_office_approve IS DISTINCT FROM 'Approve'::public.row_approval_enum THEN
      RAISE EXCEPTION 'HO cannot approve a row without ZO approval' USING ERRCODE = 'P4B28';
    END IF;

    IF p_stage = 'ZO' THEN
      UPDATE public.project_subcontract_estimate_lines
      SET zo_office_approve = v_status, zo_remarks = v_remarks, updated_by = p_actor
      WHERE line_id = v_line_id;
    ELSE
      UPDATE public.project_subcontract_estimate_lines
      SET ho_office_approve = v_status, ho_remarks = v_remarks, updated_by = p_actor
      WHERE line_id = v_line_id;
    END IF;
  END LOOP;

  UPDATE public.project_subcontract_estimates
  SET last_modified_by = p_actor
  WHERE subcontract_estimate_id = p_estimate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_subcontract_estimate_rows(uuid, varchar, varchar, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_subcontract_estimate_rows(uuid, varchar, varchar, jsonb, timestamptz)
  TO service_role;
