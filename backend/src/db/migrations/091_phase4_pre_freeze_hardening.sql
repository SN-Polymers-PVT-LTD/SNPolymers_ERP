-- Migration 091: pre-Phase 5 identity, workflow, and scope hardening.

-- A Work Master becomes identity-locked when its first estimate line is
-- referenced. The marker gives first-use and identity edits one persistent
-- row to serialize on.
ALTER TABLE public.subcontract_work_master
  ADD COLUMN IF NOT EXISTS identity_locked_at timestamptz;

UPDATE public.subcontract_work_master work
SET identity_locked_at = COALESCE(
  (SELECT min(line.created_at)
   FROM public.project_subcontract_estimate_lines line
   WHERE line.subcontract_work_id = work.id),
  now()
)
WHERE work.identity_locked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.project_subcontract_estimate_lines line
    WHERE line.subcontract_work_id = work.id
  );

CREATE OR REPLACE FUNCTION public.lock_subcontract_work_identity_on_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1
  FROM public.subcontract_work_master
  WHERE id = NEW.subcontract_work_id
  FOR UPDATE;

  UPDATE public.subcontract_work_master
  SET identity_locked_at = COALESCE(identity_locked_at, now())
  WHERE id = NEW.subcontract_work_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_subcontract_work_identity_on_reference
  ON public.project_subcontract_estimate_lines;
CREATE TRIGGER trg_lock_subcontract_work_identity_on_reference
AFTER INSERT OR UPDATE OF subcontract_work_id
ON public.project_subcontract_estimate_lines
FOR EACH ROW
EXECUTE FUNCTION public.lock_subcontract_work_identity_on_reference();

CREATE OR REPLACE FUNCTION public.prevent_referenced_subcontract_work_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.sub_head, NEW.material_details, NEW.unit)
     IS DISTINCT FROM (OLD.sub_head, OLD.material_details, OLD.unit)
     AND (
       OLD.identity_locked_at IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.project_subcontract_estimate_lines line
         WHERE line.subcontract_work_id = OLD.id
       )
     ) THEN
    RAISE EXCEPTION 'Referenced subcontract work identity cannot be changed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_referenced_subcontract_work_identity_change
  ON public.subcontract_work_master;
CREATE TRIGGER trg_prevent_referenced_subcontract_work_identity_change
BEFORE UPDATE OF sub_head, material_details, unit
ON public.subcontract_work_master
FOR EACH ROW
EXECUTE FUNCTION public.prevent_referenced_subcontract_work_identity_change();

-- Multi-scope Final Approval and Finance operations acquire advisory locks in
-- the same canonical order, preventing avoidable lock-order deadlocks.
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
  v_effective numeric(18,2);
  v_consumed numeric(18,2);
  v_scope record;
BEGIN
  IF p_action = 'HO_APPROVE' THEN
    SELECT work_order_no INTO v_work_order_no
    FROM public.project_subcontract_estimates
    WHERE subcontract_estimate_id = p_estimate_id;

    FOR v_scope IN
      SELECT subcontractor_id, subcontract_work_id
      FROM public.project_subcontract_estimate_lines
      WHERE subcontract_estimate_id = p_estimate_id
      GROUP BY subcontractor_id, subcontract_work_id
      ORDER BY subcontractor_id, subcontract_work_id
    LOOP
      PERFORM public.lock_subcontract_financial_scope(
        v_work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id
      );
      v_effective := NULL;
      v_consumed := NULL;
      SELECT COALESCE(sum(amount), 0) INTO v_effective
      FROM public.project_subcontract_estimate_lines
      WHERE subcontract_estimate_id = p_estimate_id
        AND subcontractor_id = v_scope.subcontractor_id
        AND subcontract_work_id = v_scope.subcontract_work_id;
      v_consumed := public.get_subcontract_financial_consumption(
        v_work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id
      );
      IF v_effective < v_consumed THEN
        RAISE EXCEPTION 'SUBCONTRACT_SCOPE_BELOW_FINANCIAL_CONSUMPTION: proposed %, consumed %', v_effective, v_consumed
          USING ERRCODE = 'P4B18';
      END IF;
    END LOOP;
  END IF;

  PERFORM public.transition_subcontract_estimate_workflow_unlocked(
    p_estimate_id, p_actor, p_action, p_remarks,
    p_expected_updated_at, p_deadline_hours
  );
END;
$$;

-- Rejection after a prior approval rejects only the new revision attempt.
-- Preserve the estimate lineage so the approved baseline remains reopenable.
CREATE OR REPLACE FUNCTION public.reopen_subcontract_estimate(
  p_estimate_id uuid,
  p_actor varchar,
  p_remarks text,
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
  v_now timestamptz := now();
BEGIN
  IF NULLIF(btrim(COALESCE(p_remarks, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Reopen remarks are required' USING ERRCODE = 'P4B30';
  END IF;
  SELECT * INTO v_actor FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND OR v_actor.role NOT IN ('ho', 'admin') THEN
    RAISE EXCEPTION 'Only HO or Admin may reopen an estimate' USING ERRCODE = 'P4B31';
  END IF;
  SELECT * INTO v_estimate FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B32';
  END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B33';
  END IF;
  IF v_estimate.estimate_status NOT IN ('Final Approved', 'Rejected by ZO', 'Rejected by HO') THEN
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

-- Final Approval permits only a positive effective scope or an exact zero
-- scope. This keeps weighted-rate calculations defined in Phase 5.
CREATE OR REPLACE FUNCTION public.reject_subcontract_estimate_negative_effective_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_bad record;
BEGIN
  IF NEW.estimate_status = 'Final Approved'::public.estimate_status_enum
     AND OLD.estimate_status IS DISTINCT FROM NEW.estimate_status THEN
    SELECT subcontractor_id, subcontract_work_id, sum(qty) AS effective_qty, sum(amount) AS effective_amount
    INTO v_bad
    FROM public.project_subcontract_estimate_lines
    WHERE subcontract_estimate_id = NEW.subcontract_estimate_id
    GROUP BY subcontractor_id, subcontract_work_id
    HAVING NOT (
      (sum(qty) > 0 AND sum(amount) > 0)
      OR (sum(qty) = 0 AND sum(amount) = 0)
    )
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Final Approval requires positive effective quantity and amount, or both zero'
        USING ERRCODE = 'P4B29';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Admin may perform submission actions, but must not become the JE identity.
CREATE OR REPLACE FUNCTION public.preserve_actual_je_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.je_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.authorised_users actor
       WHERE actor.mobile_number = NEW.je_user_id
         AND actor.role <> 'je'
     ) THEN
    NEW.je_user_id := OLD.je_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_actual_je_attribution
  ON public.project_subcontract_estimates;
CREATE TRIGGER trg_preserve_actual_je_attribution
BEFORE UPDATE OF je_user_id
ON public.project_subcontract_estimates
FOR EACH ROW
EXECUTE FUNCTION public.preserve_actual_je_attribution();
