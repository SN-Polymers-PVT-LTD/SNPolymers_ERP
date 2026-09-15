-- Migration 080: transactional Subcontractor Estimate Draft line reconciliation.
-- Phase 4A only: no submit/review/reopen/Finance behavior.

CREATE OR REPLACE FUNCTION public.save_subcontract_estimate_draft_lines(
  p_estimate_id uuid,
  p_actor varchar,
  p_expected_updated_at timestamptz,
  p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
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
  v_existing public.project_subcontract_estimate_lines%ROWTYPE;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array' USING ERRCODE = 'PSE01';
  END IF;

  SELECT * INTO v_actor
  FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active actor not found' USING ERRCODE = 'PSE02';
  END IF;
  IF v_actor.role NOT IN ('admin', 'je') THEN
    RAISE EXCEPTION 'Only JE or Admin may save Draft lines' USING ERRCODE = 'PSE03';
  END IF;

  SELECT * INTO v_estimate
  FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found' USING ERRCODE = 'PSE04';
  END IF;
  IF v_estimate.estimate_status <> 'Draft'::public.estimate_status_enum THEN
    RAISE EXCEPTION 'Only Draft estimates can be edited' USING ERRCODE = 'PSE05';
  END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'PSE09';
  END IF;
  IF v_actor.role = 'je' AND NOT EXISTS (
    SELECT 1 FROM public.work_order_mappings
    WHERE work_order_no = v_estimate.work_order_no
      AND je_user_id = p_actor
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this Work Order' USING ERRCODE = 'PSE06';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_line_id := NULLIF(v_line->>'line_id', '')::uuid;
    v_subcontractor_id := (v_line->>'subcontractor_id')::uuid;
    v_subcontract_work_id := (v_line->>'subcontract_work_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_rate := (v_line->>'rate')::numeric;
    v_amount := round(v_qty * v_rate, 2);

    IF v_qty IS NULL OR v_rate IS NULL OR v_qty <= 0 OR v_rate <= 0 THEN
      RAISE EXCEPTION 'Draft quantity and rate must be positive' USING ERRCODE = 'PSE07';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.subcontractor_master WHERE id = v_subcontractor_id AND is_active = true)
       AND NOT EXISTS (
         SELECT 1 FROM public.project_subcontract_estimate_lines
         WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id
           AND subcontractor_id = v_subcontractor_id
       ) THEN
      RAISE EXCEPTION 'New subcontractor selection must be active' USING ERRCODE = 'PSE07';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.subcontract_work_master WHERE id = v_subcontract_work_id AND is_active = true)
       AND NOT EXISTS (
         SELECT 1 FROM public.project_subcontract_estimate_lines
         WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id
           AND subcontract_work_id = v_subcontract_work_id
       ) THEN
      RAISE EXCEPTION 'New subcontract work selection must be active' USING ERRCODE = 'PSE07';
    END IF;

    IF v_line_id IS NOT NULL THEN
      SELECT * INTO v_existing FROM public.project_subcontract_estimate_lines
      WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line does not belong to this estimate' USING ERRCODE = 'PSE08';
      END IF;
      IF v_existing.zo_office_approve IS NOT NULL OR v_existing.ho_office_approve IS NOT NULL THEN
        IF v_existing.subcontractor_id <> v_subcontractor_id
           OR v_existing.subcontract_work_id <> v_subcontract_work_id
           OR v_existing.qty <> v_qty OR v_existing.rate <> v_rate THEN
          RAISE EXCEPTION 'Approved source lines are immutable' USING ERRCODE = 'PSE08';
        END IF;
      ELSE
        UPDATE public.project_subcontract_estimate_lines
        SET subcontractor_id = v_subcontractor_id,
            subcontract_work_id = v_subcontract_work_id,
            qty = v_qty,
            rate = v_rate,
            amount = v_amount,
            rate_reference = NULLIF(v_line->>'rate_reference', ''),
            remarks = NULLIF(v_line->>'remarks', ''),
            updated_by = p_actor
        WHERE line_id = v_line_id;
      END IF;
      v_seen := array_append(v_seen, v_line_id);
    ELSE
      INSERT INTO public.project_subcontract_estimate_lines (
        subcontract_estimate_id, subcontractor_id, subcontract_work_id,
        qty, rate, amount, rate_reference, remarks, entry_kind, created_by
      ) VALUES (
        p_estimate_id, v_subcontractor_id, v_subcontract_work_id,
        v_qty, v_rate, v_amount, NULLIF(v_line->>'rate_reference', ''),
        NULLIF(v_line->>'remarks', ''), 'BASE', p_actor
      ) RETURNING line_id INTO v_line_id;
      v_seen := array_append(v_seen, v_line_id);
    END IF;
  END LOOP;

  DELETE FROM public.project_subcontract_estimate_lines
  WHERE subcontract_estimate_id = p_estimate_id
    AND zo_office_approve IS NULL
    AND ho_office_approve IS NULL
    AND (line_id <> ALL(v_seen) OR cardinality(v_seen) = 0);

  UPDATE public.project_subcontract_estimates
  SET estimate_amount = COALESCE((SELECT sum(amount) FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = p_estimate_id), 0),
      last_modified_by = p_actor
  WHERE subcontract_estimate_id = p_estimate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_subcontract_estimate_draft_lines(uuid, varchar, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_subcontract_estimate_draft_lines(uuid, varchar, timestamptz, jsonb)
  TO service_role;
