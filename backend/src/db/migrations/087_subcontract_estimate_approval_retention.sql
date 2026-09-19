-- Phase 1: retain row decisions across unrelated JE saves/resubmissions.
--
-- Migration 077's final reconciliation and submission implementations reset
-- all current row decisions. Preserve those hardened implementations behind
-- private names, then install small transactional wrappers. The wrappers make
-- the server, not the client, decide whether an existing line is unchanged.

ALTER FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  RENAME TO reconcile_subcontract_estimate_lines_phase1_legacy;

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
  v_line jsonb;
  v_existing public.project_subcontract_estimate_lines%ROWTYPE;
  v_line_id uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_preserved_decisions jsonb := '[]'::jsonb;
  v_kind varchar;
  v_changed boolean;
  v_revision_authoring boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array' USING ERRCODE = 'P4B40';
  END IF;

  SELECT * INTO v_estimate
  FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B42';
  END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B43';
  END IF;

  v_revision_authoring := v_estimate.estimate_status IN (
    'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_line_id := NULLIF(v_line->>'line_id', '')::uuid;
    IF v_line_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_existing
    FROM public.project_subcontract_estimate_lines
    WHERE line_id = v_line_id
      AND subcontract_estimate_id = p_estimate_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line does not belong to this estimate' USING ERRCODE = 'P4B50';
    END IF;
    IF v_existing.final_approved_revision IS NOT NULL THEN
      RAISE EXCEPTION 'Historically Final Approved contributions are immutable' USING ERRCODE = 'P4B51';
    END IF;

    v_kind := COALESCE(NULLIF(v_line->>'entry_kind', ''), v_existing.entry_kind);
    v_changed :=
      v_existing.subcontractor_id IS DISTINCT FROM NULLIF(v_line->>'subcontractor_id', '')::uuid OR
      v_existing.subcontract_work_id IS DISTINCT FROM NULLIF(v_line->>'subcontract_work_id', '')::uuid OR
      v_existing.qty IS DISTINCT FROM (v_line->>'qty')::numeric OR
      v_existing.rate IS DISTINCT FROM (v_line->>'rate')::numeric OR
      v_existing.amount IS DISTINCT FROM round(((v_line->>'qty')::numeric * (v_line->>'rate')::numeric), 2) OR
      v_existing.rate_reference IS DISTINCT FROM NULLIF(v_line->>'rate_reference', '') OR
      v_existing.remarks IS DISTINCT FROM NULLIF(v_line->>'remarks', '') OR
      v_existing.entry_kind IS DISTINCT FROM v_kind OR
      v_existing.adjusts_line_id IS DISTINCT FROM NULLIF(v_line->>'adjusts_line_id', '')::uuid;

    IF v_revision_authoring
       AND (
         v_existing.ho_office_approve = 'Approve'::public.row_approval_enum
         OR (
           v_estimate.estimate_status = 'ZO Revision Requested'
           AND v_existing.zo_office_approve = 'Approve'::public.row_approval_enum
         )
         OR (
           v_estimate.estimate_status = 'Estimate Reopened'
           AND v_existing.zo_office_approve = 'Approve'::public.row_approval_enum
         )
       )
       AND v_changed THEN
      RAISE EXCEPTION 'Approved current contributions cannot be modified during revision'
        USING ERRCODE = 'P4B59';
    END IF;

    IF NOT v_changed THEN
      v_preserved_decisions := v_preserved_decisions || jsonb_build_array(jsonb_build_object(
        'line_id', v_line_id,
        'zo_office_approve', v_existing.zo_office_approve,
        'zo_remarks', v_existing.zo_remarks,
        'ho_office_approve', v_existing.ho_office_approve,
        'ho_remarks', v_existing.ho_remarks
      ));
    END IF;
    v_seen := array_append(v_seen, v_line_id);
  END LOOP;

  -- Do not let omission delete a current row that JE is not permitted to edit.
  IF v_revision_authoring AND EXISTS (
    SELECT 1
    FROM public.project_subcontract_estimate_lines line
    WHERE line.subcontract_estimate_id = p_estimate_id
      AND line.final_approved_revision IS NULL
      AND (
        line.ho_office_approve = 'Approve'::public.row_approval_enum
        OR (
          v_estimate.estimate_status = 'ZO Revision Requested'
          AND line.zo_office_approve = 'Approve'::public.row_approval_enum
        )
        OR (
          v_estimate.estimate_status = 'Estimate Reopened'
          AND line.zo_office_approve = 'Approve'::public.row_approval_enum
        )
      )
      AND (line.line_id <> ALL(v_seen) OR cardinality(v_seen) = 0)
  ) THEN
    RAISE EXCEPTION 'Approved current contributions cannot be deleted during revision'
      USING ERRCODE = 'P4B59';
  END IF;

  PERFORM public.reconcile_subcontract_estimate_lines_phase1_legacy(
    p_estimate_id, p_actor, p_expected_updated_at, p_lines
  );

  -- The legacy function validates all contribution, authorization, capacity,
  -- and lifecycle invariants. Restore decisions only after it has completed
  -- and only for persisted rows proven unchanged above.
  UPDATE public.project_subcontract_estimate_lines line
  SET zo_office_approve = saved.zo_office_approve::public.row_approval_enum,
      zo_remarks = saved.zo_remarks,
      ho_office_approve = saved.ho_office_approve::public.row_approval_enum,
      ho_remarks = saved.ho_remarks
  FROM jsonb_to_recordset(v_preserved_decisions) AS saved(
    line_id uuid,
    zo_office_approve text,
    zo_remarks text,
    ho_office_approve text,
    ho_remarks text
  )
  WHERE line.line_id = saved.line_id
    AND line.final_approved_revision IS NULL;
END;
$$;

-- Capture decisions before the legacy transition clears them. Corrected rows
-- have already been cleared by reconciliation, while unchanged rows retain
-- their captured state after a normal submission or revision resubmission.
ALTER FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  RENAME TO transition_subcontract_estimate_workflow_phase1_legacy;

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
  v_decisions jsonb := '[]'::jsonb;
BEGIN
  IF p_action IN ('SUBMIT', 'RESUBMIT') THEN
    SELECT * INTO v_estimate
    FROM public.project_subcontract_estimates
    WHERE subcontract_estimate_id = p_estimate_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B12';
    END IF;
    IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B13';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'line_id', line_id,
      'zo_office_approve', zo_office_approve,
      'zo_remarks', zo_remarks,
      'ho_office_approve', ho_office_approve,
      'ho_remarks', ho_remarks
    )), '[]'::jsonb)
    INTO v_decisions
    FROM public.project_subcontract_estimate_lines
    WHERE subcontract_estimate_id = p_estimate_id
      AND final_approved_revision IS NULL;
  END IF;

  PERFORM public.transition_subcontract_estimate_workflow_phase1_legacy(
    p_estimate_id, p_actor, p_action, p_remarks, p_expected_updated_at, p_deadline_hours
  );

  IF p_action IN ('SUBMIT', 'RESUBMIT') THEN
    UPDATE public.project_subcontract_estimate_lines line
    SET zo_office_approve = saved.zo_office_approve::public.row_approval_enum,
        zo_remarks = saved.zo_remarks,
        ho_office_approve = saved.ho_office_approve::public.row_approval_enum,
        ho_remarks = saved.ho_remarks
    FROM jsonb_to_recordset(v_decisions) AS saved(
      line_id uuid,
      zo_office_approve text,
      zo_remarks text,
      ho_office_approve text,
      ho_remarks text
    )
    WHERE line.line_id = saved.line_id
      AND line.final_approved_revision IS NULL;
  END IF;
END;
$$;

-- The reopened route is still supported by the controller. It has the same
-- retention requirement: new additions stay undecided, while an unchanged
-- non-final row is not erased merely by submitting the reopened estimate.
ALTER FUNCTION public.submit_reopened_subcontract_estimate(uuid, varchar, timestamptz)
  RENAME TO submit_reopened_subcontract_estimate_phase1_legacy;

CREATE OR REPLACE FUNCTION public.submit_reopened_subcontract_estimate(
  p_estimate_id uuid,
  p_actor varchar,
  p_expected_updated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estimate public.project_subcontract_estimates%ROWTYPE;
  v_decisions jsonb;
BEGIN
  SELECT * INTO v_estimate
  FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B53';
  END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B54';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'line_id', line_id,
    'zo_office_approve', zo_office_approve,
    'zo_remarks', zo_remarks,
    'ho_office_approve', ho_office_approve,
    'ho_remarks', ho_remarks
  )), '[]'::jsonb)
  INTO v_decisions
  FROM public.project_subcontract_estimate_lines
  WHERE subcontract_estimate_id = p_estimate_id
    AND final_approved_revision IS NULL;

  PERFORM public.submit_reopened_subcontract_estimate_phase1_legacy(
    p_estimate_id, p_actor, p_expected_updated_at
  );

  UPDATE public.project_subcontract_estimate_lines line
  SET zo_office_approve = saved.zo_office_approve::public.row_approval_enum,
      zo_remarks = saved.zo_remarks,
      ho_office_approve = saved.ho_office_approve::public.row_approval_enum,
      ho_remarks = saved.ho_remarks
  FROM jsonb_to_recordset(v_decisions) AS saved(
    line_id uuid,
    zo_office_approve text,
    zo_remarks text,
    ho_office_approve text,
    ho_remarks text
  )
  WHERE line.line_id = saved.line_id
    AND line.final_approved_revision IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.submit_reopened_subcontract_estimate(uuid, varchar, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reopened_subcontract_estimate(uuid, varchar, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  IS 'Phase 1 wrapper: server-compares proposed lines and preserves decisions only for unchanged rows.';
COMMENT ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  IS 'Phase 1 wrapper: submissions preserve existing current-row decisions; corrected rows were reset by reconciliation.';
