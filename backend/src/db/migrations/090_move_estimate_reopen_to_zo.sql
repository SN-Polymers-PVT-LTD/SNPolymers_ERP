-- Migration 090: Move Subcontract Estimate Reopen from HO to ZO
-- Updates public.reopen_subcontract_estimate to authorize ZO and Admin instead of HO.
-- Replaces public.reopen_subcontract_estimate with ZO-authorized logic
-- and keeps header-stage metadata truthful while preserving Final Approved history.

CREATE OR REPLACE FUNCTION public.reopen_subcontract_estimate(
  p_estimate_id uuid,
  p_actor varchar,
  p_remarks text,
  p_expected_updated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estimate public.project_subcontract_estimates%ROWTYPE;
  v_actor public.authorised_users%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF NULLIF(btrim(COALESCE(p_remarks, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Reopen remarks are required' USING ERRCODE = 'P4B30';
  END IF;

  SELECT * INTO v_actor FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND OR v_actor.role NOT IN ('zo', 'admin') THEN
    RAISE EXCEPTION 'Only ZO or Admin may reopen an estimate' USING ERRCODE = 'P4B31';
  END IF;

  SELECT * INTO v_estimate FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B32';
  END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B33';
  END IF;
  IF v_estimate.estimate_status NOT IN ('Final Approved'::public.estimate_status_enum, 'Rejected by ZO'::public.estimate_status_enum, 'Rejected by HO'::public.estimate_status_enum) THEN
    RAISE EXCEPTION 'Only Final Approved or previously rejected estimates may be reopened' USING ERRCODE = 'P4B34';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_subcontract_estimate_lines
    WHERE subcontract_estimate_id = p_estimate_id
      AND final_approved_revision IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Only estimates with a Final Approved baseline may be reopened' USING ERRCODE = 'P4B34';
  END IF;

  UPDATE public.project_subcontract_estimates
  SET estimate_status = 'Estimate Reopened'::public.estimate_status_enum,
      estimate_revision = estimate_revision + 1,
      zo_approved_by = NULL,
      zo_approval_date = NULL,
      ho_approved_by = NULL,
      ho_approval_date = NULL,
      last_modified_by = p_actor
  WHERE subcontract_estimate_id = p_estimate_id;

  INSERT INTO public.project_subcontract_estimate_workflow_log
    (subcontract_estimate_id, revision, from_status, to_status, action, actor, actor_role, remarks)
  VALUES
    (p_estimate_id, v_estimate.estimate_revision + 1, v_estimate.estimate_status,
     'Estimate Reopened'::public.estimate_status_enum, 'REOPEN', p_actor, v_actor.role,
     NULLIF(btrim(p_remarks), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_subcontract_estimate(uuid, varchar, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_subcontract_estimate(uuid, varchar, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.reopen_subcontract_estimate(uuid, varchar, text, timestamptz)
  IS 'Reopens a Final Approved subcontract estimate. Restricted to ZO and Admin. Clears header approval metadata and increments revision while preserving item-level Final Approved provenance.';
