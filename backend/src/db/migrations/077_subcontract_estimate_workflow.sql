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

-- Consolidated from 077_subcontractor_foundation_corrections.sql
-- Migration 077: corrective hardening for the Subcontractor Estimate foundation.
-- Keeps 076 immutable while correcting provenance, adjustment, and lookup semantics.

ALTER TABLE public.requisitions
  DROP CONSTRAINT IF EXISTS fk_requisitions_subcontract_line,
  DROP COLUMN IF EXISTS subcontract_estimate_line_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pcei_subcontract_source_identity'
  ) THEN
    ALTER TABLE public.project_cost_estimate_items
      ADD CONSTRAINT chk_pcei_subcontract_source_identity
      CHECK (
        (
          source_type = 'SUBCONTRACT_ESTIMATE'
          AND subcontract_work_id IS NOT NULL
        ) OR (
          (source_type IS NULL OR source_type = 'MANUAL')
          AND subcontract_work_id IS NULL
        )
      );
  END IF;
END $$;

ALTER TABLE public.project_subcontract_estimate_lines
  DROP CONSTRAINT IF EXISTS chk_psel_structural_values;

ALTER TABLE public.project_subcontract_estimate_lines
  ADD CONSTRAINT chk_psel_structural_values
  CHECK (
    (
      entry_kind IN ('BASE', 'ADDITION')
      AND adjusts_line_id IS NULL
      AND qty > 0
      AND rate > 0
      AND amount > 0
    ) OR (
      entry_kind = 'ADJUSTMENT'
      AND adjusts_line_id IS NOT NULL
      AND adjusts_line_id <> line_id
      AND qty <> 0
      AND rate > 0
      AND amount <> 0
    )
  );

CREATE INDEX IF NOT EXISTS idx_cesc_source_line
  ON public.cost_estimate_subcontract_contributions(subcontract_estimate_line_id);

CREATE INDEX IF NOT EXISTS idx_psel_adjusts_line
  ON public.project_subcontract_estimate_lines(adjusts_line_id)
  WHERE adjusts_line_id IS NOT NULL;


-- Consolidated from 078_subcontract_source_identity_null_fix.sql
-- Migration 078: make generated Cost Estimate source/work identity NULL-safe.
-- PostgreSQL CHECK constraints accept UNKNOWN/NULL, so use CASE semantics.

ALTER TABLE public.project_cost_estimate_items
  DROP CONSTRAINT IF EXISTS chk_pcei_subcontract_source_identity;

ALTER TABLE public.project_cost_estimate_items
  ADD CONSTRAINT chk_pcei_subcontract_source_identity
  CHECK (
    CASE
      WHEN source_type = 'SUBCONTRACT_ESTIMATE'
        THEN subcontract_work_id IS NOT NULL
      ELSE
        subcontract_work_id IS NULL
    END
  );


-- Consolidated from 079_subcontract_work_identity_guard.sql
-- Migration 079: protect canonical subcontract work identity after estimate use.

CREATE OR REPLACE FUNCTION public.prevent_referenced_subcontract_work_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.sub_head, NEW.material_details, NEW.unit)
     IS DISTINCT FROM (OLD.sub_head, OLD.material_details, OLD.unit)
     AND EXISTS (
       SELECT 1
       FROM public.project_subcontract_estimate_lines AS l
       WHERE l.subcontract_work_id = OLD.id
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


-- Consolidated from 081_fix_subcontract_estimate_draft_reconciliation.sql
-- Migration 081: repair Draft reconciliation for databases that already applied 080.
-- Newly inserted rows must be included in the preservation set before cleanup.

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
  v_existing public.project_subcontract_estimate_lines%ROWTYPE;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array' USING ERRCODE = 'PSE01';
  END IF;
  SELECT * INTO v_actor FROM public.authorised_users WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active actor not found' USING ERRCODE = 'PSE02'; END IF;
  IF v_actor.role NOT IN ('admin', 'je') THEN RAISE EXCEPTION 'Only JE or Admin may save Draft lines' USING ERRCODE = 'PSE03'; END IF;
  SELECT * INTO v_estimate FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found' USING ERRCODE = 'PSE04'; END IF;
  IF v_estimate.estimate_status <> 'Draft'::public.estimate_status_enum THEN RAISE EXCEPTION 'Only Draft estimates can be edited' USING ERRCODE = 'PSE05'; END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'PSE09'; END IF;
  IF v_actor.role = 'je' AND NOT EXISTS (SELECT 1 FROM public.work_order_mappings WHERE work_order_no = v_estimate.work_order_no AND je_user_id = p_actor AND is_active = true) THEN
    RAISE EXCEPTION 'You are not assigned to this Work Order' USING ERRCODE = 'PSE06';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_line_id := NULLIF(v_line->>'line_id', '')::uuid;
    v_subcontractor_id := (v_line->>'subcontractor_id')::uuid;
    v_subcontract_work_id := (v_line->>'subcontract_work_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_rate := (v_line->>'rate')::numeric;
    IF v_qty IS NULL OR v_rate IS NULL OR v_qty <= 0 OR v_rate <= 0 THEN RAISE EXCEPTION 'Draft quantity and rate must be positive' USING ERRCODE = 'PSE07'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.subcontractor_master WHERE id = v_subcontractor_id AND is_active = true) AND NOT EXISTS (SELECT 1 FROM public.project_subcontract_estimate_lines WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id AND subcontractor_id = v_subcontractor_id) THEN RAISE EXCEPTION 'New subcontractor selection must be active' USING ERRCODE = 'PSE07'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.subcontract_work_master WHERE id = v_subcontract_work_id AND is_active = true) AND NOT EXISTS (SELECT 1 FROM public.project_subcontract_estimate_lines WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id AND subcontract_work_id = v_subcontract_work_id) THEN RAISE EXCEPTION 'New subcontract work selection must be active' USING ERRCODE = 'PSE07'; END IF;
    IF v_line_id IS NOT NULL THEN
      SELECT * INTO v_existing FROM public.project_subcontract_estimate_lines WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Line does not belong to this estimate' USING ERRCODE = 'PSE08'; END IF;
      IF v_existing.zo_office_approve IS NOT NULL OR v_existing.ho_office_approve IS NOT NULL THEN
        IF v_existing.subcontractor_id <> v_subcontractor_id OR v_existing.subcontract_work_id <> v_subcontract_work_id OR v_existing.qty <> v_qty OR v_existing.rate <> v_rate THEN RAISE EXCEPTION 'Approved source lines are immutable' USING ERRCODE = 'PSE08'; END IF;
      ELSE
        UPDATE public.project_subcontract_estimate_lines SET subcontractor_id = v_subcontractor_id, subcontract_work_id = v_subcontract_work_id, qty = v_qty, rate = v_rate, amount = round(v_qty * v_rate, 2), rate_reference = NULLIF(v_line->>'rate_reference', ''), remarks = NULLIF(v_line->>'remarks', ''), updated_by = p_actor WHERE line_id = v_line_id;
      END IF;
    ELSE
      INSERT INTO public.project_subcontract_estimate_lines (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, rate_reference, remarks, entry_kind, created_by)
      VALUES (p_estimate_id, v_subcontractor_id, v_subcontract_work_id, v_qty, v_rate, round(v_qty * v_rate, 2), NULLIF(v_line->>'rate_reference', ''), NULLIF(v_line->>'remarks', ''), 'BASE', p_actor)
      RETURNING line_id INTO v_line_id;
    END IF;
    v_seen := array_append(v_seen, v_line_id);
  END LOOP;

  DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = p_estimate_id AND zo_office_approve IS NULL AND ho_office_approve IS NULL AND (line_id <> ALL(v_seen) OR cardinality(v_seen) = 0);
  UPDATE public.project_subcontract_estimates SET estimate_amount = COALESCE((SELECT sum(amount) FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = p_estimate_id), 0), last_modified_by = p_actor WHERE subcontract_estimate_id = p_estimate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_subcontract_estimate_draft_lines(uuid, varchar, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_subcontract_estimate_draft_lines(uuid, varchar, timestamptz, jsonb) TO service_role;


-- Consolidated from 082_subcontract_estimate_workflow_foundation.sql
-- Migration 082: Phase 4B workflow persistence and approved-history guards.
-- Additive only. No workflow transition or Finance mutation is implemented here.

CREATE TABLE IF NOT EXISTS public.project_subcontract_estimate_workflow_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontract_estimate_id uuid NOT NULL,
  revision integer NOT NULL,
  from_status public.estimate_status_enum NOT NULL,
  to_status public.estimate_status_enum NOT NULL,
  action varchar NOT NULL,
  actor varchar NOT NULL,
  actor_role varchar NOT NULL,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_psewl_estimate FOREIGN KEY (subcontract_estimate_id)
    REFERENCES public.project_subcontract_estimates(subcontract_estimate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_psewl_actor FOREIGN KEY (actor)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT chk_psewl_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT chk_psewl_action CHECK (action IN (
    'SUBMIT', 'RESUBMIT', 'OPEN_ZO_REVIEW', 'ZO_APPROVE',
    'ZO_REQUEST_REVISION', 'ZO_REJECT', 'OPEN_HO_REVIEW',
    'HO_APPROVE', 'HO_REQUEST_REVISION', 'HO_REJECT', 'REOPEN'
  )),
  CONSTRAINT chk_psewl_actor_role CHECK (actor_role IN ('je', 'zo', 'ho', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_psewl_estimate_created_at
  ON public.project_subcontract_estimate_workflow_log(subcontract_estimate_id, created_at);

CREATE OR REPLACE FUNCTION public.reject_subcontract_estimate_workflow_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Subcontract estimate workflow log is append-only'
    USING ERRCODE = 'P4B01';
END;
$$;

DROP TRIGGER IF EXISTS trg_psewl_no_update ON public.project_subcontract_estimate_workflow_log;
CREATE TRIGGER trg_psewl_no_update
BEFORE UPDATE ON public.project_subcontract_estimate_workflow_log
FOR EACH ROW EXECUTE FUNCTION public.reject_subcontract_estimate_workflow_log_mutation();

DROP TRIGGER IF EXISTS trg_psewl_no_delete ON public.project_subcontract_estimate_workflow_log;
CREATE TRIGGER trg_psewl_no_delete
BEFORE DELETE ON public.project_subcontract_estimate_workflow_log
FOR EACH ROW EXECUTE FUNCTION public.reject_subcontract_estimate_workflow_log_mutation();

ALTER TABLE public.project_subcontract_estimate_lines
  ADD COLUMN IF NOT EXISTS final_approved_revision integer,
  ADD COLUMN IF NOT EXISTS final_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_approved_by varchar;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_psel_final_approved_by') THEN
    ALTER TABLE public.project_subcontract_estimate_lines
      ADD CONSTRAINT fk_psel_final_approved_by
      FOREIGN KEY (final_approved_by)
      REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_psel_final_approved_metadata') THEN
    ALTER TABLE public.project_subcontract_estimate_lines
      ADD CONSTRAINT chk_psel_final_approved_metadata CHECK (
        (final_approved_revision IS NULL AND final_approved_at IS NULL AND final_approved_by IS NULL)
        OR (final_approved_revision >= 0 AND final_approved_at IS NOT NULL AND final_approved_by IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_psel_final_approved_revision
  ON public.project_subcontract_estimate_lines(subcontract_estimate_id, final_approved_revision)
  WHERE final_approved_revision IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reject_subcontract_estimate_approved_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.final_approved_revision IS NOT NULL AND (
    NEW.subcontract_estimate_id IS DISTINCT FROM OLD.subcontract_estimate_id OR
    NEW.subcontractor_id IS DISTINCT FROM OLD.subcontractor_id OR
    NEW.subcontract_work_id IS DISTINCT FROM OLD.subcontract_work_id OR
    NEW.qty IS DISTINCT FROM OLD.qty OR
    NEW.rate IS DISTINCT FROM OLD.rate OR
    NEW.amount IS DISTINCT FROM OLD.amount OR
    NEW.rate_reference IS DISTINCT FROM OLD.rate_reference OR
    NEW.remarks IS DISTINCT FROM OLD.remarks OR
    NEW.entry_kind IS DISTINCT FROM OLD.entry_kind OR
    NEW.adjusts_line_id IS DISTINCT FROM OLD.adjusts_line_id OR
    NEW.zo_office_approve IS DISTINCT FROM OLD.zo_office_approve OR
    NEW.zo_remarks IS DISTINCT FROM OLD.zo_remarks OR
    NEW.ho_office_approve IS DISTINCT FROM OLD.ho_office_approve OR
    NEW.ho_remarks IS DISTINCT FROM OLD.ho_remarks OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.final_approved_revision IS DISTINCT FROM OLD.final_approved_revision OR
    NEW.final_approved_at IS DISTINCT FROM OLD.final_approved_at OR
    NEW.final_approved_by IS DISTINCT FROM OLD.final_approved_by
  ) THEN
    RAISE EXCEPTION 'Final Approved subcontract estimate contributions are immutable'
      USING ERRCODE = 'P4B02';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_subcontract_estimate_approved_line_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.final_approved_revision IS NOT NULL THEN
    RAISE EXCEPTION 'Final Approved subcontract estimate contributions cannot be deleted'
      USING ERRCODE = 'P4B03';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_psel_approved_immutable ON public.project_subcontract_estimate_lines;
CREATE TRIGGER trg_psel_approved_immutable
BEFORE UPDATE ON public.project_subcontract_estimate_lines
FOR EACH ROW EXECUTE FUNCTION public.reject_subcontract_estimate_approved_line_mutation();

DROP TRIGGER IF EXISTS trg_psel_approved_no_delete ON public.project_subcontract_estimate_lines;
CREATE TRIGGER trg_psel_approved_no_delete
BEFORE DELETE ON public.project_subcontract_estimate_lines
FOR EACH ROW EXECUTE FUNCTION public.reject_subcontract_estimate_approved_line_delete();

GRANT ALL ON TABLE public.project_subcontract_estimate_workflow_log TO service_role;
REVOKE ALL ON TABLE public.project_subcontract_estimate_workflow_log FROM PUBLIC, anon, authenticated;


-- Consolidated from 084_subcontract_estimate_row_review.sql
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


-- Consolidated from 085_subcontract_estimate_reopen_and_delta_lines.sql
-- Migration 085: Phase 4B M4 reopen and signed delta-line authoring.

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
    HAVING sum(qty) < 0 OR sum(amount) < 0
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Final Approval would create negative effective subcontract scope'
        USING ERRCODE = 'P4B29';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pse_no_negative_effective_scope ON public.project_subcontract_estimates;
CREATE TRIGGER trg_pse_no_negative_effective_scope
BEFORE UPDATE OF estimate_status ON public.project_subcontract_estimates
FOR EACH ROW EXECUTE FUNCTION public.reject_subcontract_estimate_negative_effective_scope();

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
  IF v_estimate.estimate_status <> 'Final Approved'::public.estimate_status_enum THEN
    RAISE EXCEPTION 'Only Final Approved estimates may be reopened' USING ERRCODE = 'P4B34';
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

REVOKE ALL ON FUNCTION public.reopen_subcontract_estimate(uuid, varchar, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_subcontract_estimate(uuid, varchar, text, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_subcontract_estimate_lines(
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
  v_kind varchar;
  v_existing public.project_subcontract_estimate_lines%ROWTYPE;
  v_target public.project_subcontract_estimate_lines%ROWTYPE;
  v_seen uuid[] := ARRAY[]::uuid[];
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
  IF v_estimate.estimate_status NOT IN ('Draft', 'Estimate Reopened') THEN
    RAISE EXCEPTION 'Estimate is not editable in its current state' USING ERRCODE = 'P4B44';
  END IF;
  IF v_actor.role = 'je' AND NOT EXISTS (
    SELECT 1 FROM public.work_order_mappings
    WHERE work_order_no = v_estimate.work_order_no AND je_user_id = p_actor AND is_active = true
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this Work Order' USING ERRCODE = 'P4B45';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_line_id := NULLIF(v_line->>'line_id', '')::uuid;
    v_subcontractor_id := (v_line->>'subcontractor_id')::uuid;
    v_subcontract_work_id := (v_line->>'subcontract_work_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_rate := (v_line->>'rate')::numeric;
    v_kind := COALESCE(NULLIF(v_line->>'entry_kind', ''), CASE WHEN v_estimate.estimate_status = 'Draft' THEN 'BASE' ELSE NULL END);

    IF v_kind NOT IN ('BASE', 'ADDITION', 'ADJUSTMENT') THEN
      RAISE EXCEPTION 'Invalid contribution entry kind' USING ERRCODE = 'P4B46';
    END IF;
    IF v_estimate.estimate_status = 'Estimate Reopened' AND v_kind = 'BASE' THEN
      RAISE EXCEPTION 'BASE contributions are prohibited in Estimate Reopened' USING ERRCODE = 'P4B47';
    END IF;
    IF v_qty IS NULL OR v_rate IS NULL OR v_rate <= 0
       OR (v_kind IN ('BASE', 'ADDITION') AND v_qty <= 0)
       OR (v_kind = 'ADJUSTMENT' AND v_qty = 0) THEN
      RAISE EXCEPTION 'Invalid quantity or rate for contribution' USING ERRCODE = 'P4B48';
    END IF;
    v_amount := round(v_qty * v_rate, 2);

    IF NOT EXISTS (SELECT 1 FROM public.subcontractor_master WHERE id = v_subcontractor_id AND is_active = true)
       AND NOT EXISTS (SELECT 1 FROM public.project_subcontract_estimate_lines
                       WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id
                         AND subcontractor_id = v_subcontractor_id) THEN
      RAISE EXCEPTION 'New subcontractor selection must be active' USING ERRCODE = 'P4B48';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.subcontract_work_master WHERE id = v_subcontract_work_id AND is_active = true)
       AND NOT EXISTS (SELECT 1 FROM public.project_subcontract_estimate_lines
                       WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id
                         AND subcontract_work_id = v_subcontract_work_id) THEN
      RAISE EXCEPTION 'New subcontract work selection must be active' USING ERRCODE = 'P4B48';
    END IF;

    IF v_kind = 'ADJUSTMENT' THEN
      IF NULLIF(v_line->>'adjusts_line_id', '') IS NULL THEN
        RAISE EXCEPTION 'ADJUSTMENT must identify a target contribution' USING ERRCODE = 'P4B49';
      END IF;
      SELECT * INTO v_target FROM public.project_subcontract_estimate_lines
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
      SELECT * INTO v_existing FROM public.project_subcontract_estimate_lines
      WHERE line_id = v_line_id AND subcontract_estimate_id = p_estimate_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line does not belong to this estimate' USING ERRCODE = 'P4B50';
      END IF;
      IF v_existing.final_approved_revision IS NOT NULL THEN
        RAISE EXCEPTION 'Historically Final Approved contributions are immutable' USING ERRCODE = 'P4B51';
      END IF;
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
  SET estimate_amount = COALESCE((SELECT sum(amount) FROM public.project_subcontract_estimate_lines
                                  WHERE subcontract_estimate_id = p_estimate_id), 0),
      last_modified_by = p_actor
  WHERE subcontract_estimate_id = p_estimate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_subcontract_estimate_lines(uuid, varchar, timestamptz, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.submit_reopened_subcontract_estimate(
  p_estimate_id uuid,
  p_actor varchar,
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
BEGIN
  SELECT * INTO v_actor FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT FOUND OR v_actor.role NOT IN ('je', 'admin') THEN
    RAISE EXCEPTION 'Only JE or Admin may submit an estimate revision' USING ERRCODE = 'P4B52';
  END IF;
  SELECT * INTO v_estimate FROM public.project_subcontract_estimates
  WHERE subcontract_estimate_id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subcontract estimate not found' USING ERRCODE = 'P4B53'; END IF;
  IF p_expected_updated_at IS NULL OR v_estimate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Estimate changed since it was loaded' USING ERRCODE = 'P4B54';
  END IF;
  IF v_estimate.estimate_status <> 'Estimate Reopened'::public.estimate_status_enum THEN
    RAISE EXCEPTION 'Only reopened estimates may be submitted by this action' USING ERRCODE = 'P4B55';
  END IF;
  IF v_actor.role = 'je' AND NOT EXISTS (
    SELECT 1 FROM public.work_order_mappings
    WHERE work_order_no = v_estimate.work_order_no AND je_user_id = p_actor AND is_active = true
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this Work Order' USING ERRCODE = 'P4B56';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = p_estimate_id) THEN
    RAISE EXCEPTION 'Estimate must contain at least one contribution' USING ERRCODE = 'P4B57';
  END IF;

  UPDATE public.project_subcontract_estimate_lines
  SET zo_office_approve = NULL, zo_remarks = NULL,
      ho_office_approve = NULL, ho_remarks = NULL, updated_by = p_actor
  WHERE subcontract_estimate_id = p_estimate_id AND final_approved_revision IS NULL;
  UPDATE public.project_subcontract_estimates
  SET estimate_status = 'Submitted'::public.estimate_status_enum,
      last_modified_by = p_actor,
      je_user_id = COALESCE(je_user_id, p_actor),
      je_date = COALESCE(je_date, now())
  WHERE subcontract_estimate_id = p_estimate_id;
  INSERT INTO public.project_subcontract_estimate_workflow_log
    (subcontract_estimate_id, revision, from_status, to_status, action, actor, actor_role)
  VALUES (p_estimate_id, v_estimate.estimate_revision, v_estimate.estimate_status,
          'Submitted'::public.estimate_status_enum, 'RESUBMIT', p_actor, v_actor.role);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_reopened_subcontract_estimate(uuid, varchar, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reopened_subcontract_estimate(uuid, varchar, timestamptz)
  TO service_role;


-- Consolidated from 087_phase4b_revision_authoring_and_scope_locks.sql
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


-- Consolidated from 088_phase4b_finance_identity_and_consumption.sql
-- Migration 088: Phase 4B Finance identity bridge and canonical consumption.
--
-- This migration deliberately does not mutate Finance balances or payment
-- state.  It only carries the normalized identity into new requisitions and
-- ledger events, and exposes the read-only amount needed by Final Approval.

CREATE OR REPLACE FUNCTION public.get_subcontract_financial_consumption(
  p_work_order_no varchar,
  p_subcontractor_id uuid,
  p_subcontract_work_id uuid
)
RETURNS numeric(18,2)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      -- A reservation remains active until it is released.  Once settled,
      -- the payment event is the consumption and the reservation is not
      -- counted a second time.
      WHEN l.transaction_type = 'REQUISITION_APPROVAL'
       AND l.settlement_status = 'RESERVED' THEN abs(l.amount)
      WHEN l.transaction_type = 'REQUISITION_PAYMENT' THEN abs(l.amount)
      ELSE 0
    END
  ), 0)::numeric(18,2)
  FROM public.subcontractor_ledger l
  WHERE l.reference_type = 'REQUISITION'
    AND btrim(l.work_order_no) = btrim(p_work_order_no)
    AND l.subcontractor_id = p_subcontractor_id
    AND l.subcontract_work_id = p_subcontract_work_id;
$$;

REVOKE ALL ON FUNCTION public.get_subcontract_financial_consumption(varchar, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_subcontract_financial_consumption(varchar, uuid, uuid)
  TO service_role;

-- Legacy Finance RPCs still insert ledger rows from display snapshots.  Fill
-- the canonical IDs from the requisition inside the same transaction so
-- approval, payment, and release events all share one identity bridge.
CREATE OR REPLACE FUNCTION public.populate_subcontract_ledger_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.requisitions%ROWTYPE;
BEGIN
  IF NEW.reference_type = 'REQUISITION'
     AND NEW.reference_id IS NOT NULL
     AND (NEW.subcontractor_id IS NULL OR NEW.subcontract_work_id IS NULL) THEN
    SELECT * INTO v_req
    FROM public.requisitions
    WHERE requisition_id = NEW.reference_id;

    IF FOUND AND btrim(COALESCE(v_req.material_main_head, '')) = 'Sub Contractor' THEN
      NEW.subcontractor_id := COALESCE(NEW.subcontractor_id, v_req.subcontractor_id);
      NEW.subcontract_work_id := COALESCE(NEW.subcontract_work_id, v_req.subcontract_work_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_subcontract_ledger_identity ON public.subcontractor_ledger;
CREATE TRIGGER trg_populate_subcontract_ledger_identity
BEFORE INSERT ON public.subcontractor_ledger
FOR EACH ROW EXECUTE FUNCTION public.populate_subcontract_ledger_identity();

REVOKE ALL ON FUNCTION public.populate_subcontract_ledger_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.populate_subcontract_ledger_identity() TO service_role;

-- The existing create RPC remains available for legacy requisitions.  New
-- Sub Contractor creation goes through this atomic identity-aware adapter.
CREATE OR REPLACE FUNCTION public.create_subcontract_requisition_secure(
  p_requester_user_id varchar,
  p_work_order_no varchar,
  p_estimate_no varchar,
  p_estimate_amount numeric,
  p_state varchar,
  p_district varchar,
  p_area_code varchar,
  p_department varchar,
  p_site_details text,
  p_requisition_no varchar,
  p_material_main_head varchar,
  p_requisition_pdf_url text,
  p_original_filename varchar,
  p_requisition_amount numeric,
  p_gst_bill public.gst_bill_enum,
  p_gst_bill_pdf_url text,
  p_bank_details text,
  p_expen_head_remarks text,
  p_requisition_status public.requisition_status_enum,
  p_created_by varchar,
  p_material_sub_head varchar DEFAULT NULL,
  p_material_details varchar DEFAULT NULL,
  p_beneficiary_id uuid DEFAULT NULL,
  p_beneficiary_name varchar DEFAULT NULL,
  p_beneficiary_ac_no varchar DEFAULT NULL,
  p_beneficiary_ifsc varchar DEFAULT NULL,
  p_beneficiary_bank_name varchar DEFAULT NULL,
  p_beneficiary_bank_id uuid DEFAULT NULL,
  p_zo_user_id varchar DEFAULT NULL,
  p_requisition_pdf_attachment_id uuid DEFAULT NULL,
  p_gst_bill_pdf_attachment_id uuid DEFAULT NULL,
  p_subcontractor_id uuid DEFAULT NULL,
  p_subcontract_work_id uuid DEFAULT NULL
)
RETURNS public.requisitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.requisitions;
BEGIN
  IF p_subcontractor_id IS NULL OR p_subcontract_work_id IS NULL THEN
    RAISE EXCEPTION 'Canonical subcontractor and subcontract work IDs are required.' USING ERRCODE = 'P4B70';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subcontractor_master WHERE id = p_subcontractor_id AND is_active = true) THEN
    RAISE EXCEPTION 'Selected subcontractor does not exist or is inactive.' USING ERRCODE = 'P4B71';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subcontract_work_master WHERE id = p_subcontract_work_id AND is_active = true) THEN
    RAISE EXCEPTION 'Selected subcontract work does not exist or is inactive.' USING ERRCODE = 'P4B72';
  END IF;

  PERFORM public.lock_subcontract_financial_scope(p_work_order_no, p_subcontractor_id, p_subcontract_work_id);

  v_req := public.create_requisition_secure(
    p_requester_user_id, p_work_order_no, p_estimate_no, p_estimate_amount,
    p_state, p_district, p_area_code, p_department, p_site_details,
    p_requisition_no, p_material_main_head, p_requisition_pdf_url,
    p_original_filename, p_requisition_amount, p_gst_bill, p_gst_bill_pdf_url,
    p_bank_details, p_expen_head_remarks, p_requisition_status, p_created_by,
    p_material_sub_head, p_material_details, p_beneficiary_id,
    p_beneficiary_name, p_beneficiary_ac_no, p_beneficiary_ifsc,
    p_beneficiary_bank_name, p_beneficiary_bank_id, p_zo_user_id,
    p_requisition_pdf_attachment_id, p_gst_bill_pdf_attachment_id
  );

  UPDATE public.requisitions
  SET subcontractor_id = p_subcontractor_id,
      subcontract_work_id = p_subcontract_work_id
  WHERE requisition_id = v_req.requisition_id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public.create_subcontract_requisition_secure(
  varchar, varchar, varchar, numeric, varchar, varchar, varchar, varchar, text,
  varchar, varchar, text, varchar, numeric, public.gst_bill_enum, text, text,
  text, public.requisition_status_enum, varchar, varchar, varchar, uuid, varchar,
  varchar, varchar, varchar, uuid, varchar, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_subcontract_requisition_secure(
  varchar, varchar, varchar, numeric, varchar, varchar, varchar, varchar, text,
  varchar, varchar, text, varchar, numeric, public.gst_bill_enum, text, text,
  text, public.requisition_status_enum, varchar, varchar, varchar, uuid, varchar,
  varchar, varchar, varchar, uuid, varchar, uuid, uuid, uuid, uuid
) TO service_role;

-- Make the already-installed workflow implementation conservative for its
-- legacy internal check. The public wrapper added in 087 performs the
-- canonical read-only check; this prevents the old check from double-counting
-- settled reservations after a payment has been recorded.
DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'transition_subcontract_estimate_workflow_unlocked'
    AND p.pronargs = 6
  ORDER BY p.oid DESC LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 4B unlocked workflow function was not found.';
  END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_new := replace(v_def,
    'AND settlement_status IN (''RESERVED'', ''SETTLED'')',
    'AND settlement_status = ''RESERVED''');
  IF v_new <> v_def THEN EXECUTE v_new; END IF;
END $$;

-- Redefine the public wrapper so the canonical primitive is the authoritative
-- guard while preserving the existing workflow implementation and audit path.
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
      SELECT subcontractor_id, subcontract_work_id, sum(amount) AS effective_amount
      FROM public.project_subcontract_estimate_lines
      WHERE subcontract_estimate_id = p_estimate_id
      GROUP BY subcontractor_id, subcontract_work_id
    LOOP
      PERFORM public.lock_subcontract_financial_scope(v_work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id);
      v_effective := v_scope.effective_amount;
      v_consumed := public.get_subcontract_financial_consumption(v_work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id);
      IF v_effective < v_consumed THEN
        RAISE EXCEPTION 'SUBCONTRACT_SCOPE_BELOW_FINANCIAL_CONSUMPTION: proposed %, consumed %', v_effective, v_consumed
          USING ERRCODE = 'P4B18';
      END IF;
    END LOOP;
  END IF;

  PERFORM public.transition_subcontract_estimate_workflow_unlocked(
    p_estimate_id, p_actor, p_action, p_remarks, p_expected_updated_at, p_deadline_hours
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  TO service_role;


-- Consolidated from 089_phase4b_final_hardening.sql
-- Migration 089: Phase 4B final hardening.
--
-- This is forward-only because 088 is already part of the migration history.
-- The checks below make both the installed function rewrite and the revision-0
-- authoring invariant fail closed if an upstream function body drifts.

DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_old text := $needle$
    IF NOT v_base_authoring AND v_kind = 'BASE' THEN
      RAISE EXCEPTION 'BASE contributions are prohibited after the initial Draft generation' USING ERRCODE = 'P4B47';
    END IF;$needle$;
  v_replacement text := $replacement$
    IF v_base_authoring AND v_kind <> 'BASE' THEN
      RAISE EXCEPTION 'Only BASE contributions are allowed before the first Final Approval' USING ERRCODE = 'P4B52';
    END IF;
    IF NOT v_base_authoring AND v_kind = 'BASE' THEN
      RAISE EXCEPTION 'BASE contributions are prohibited after the initial Draft generation' USING ERRCODE = 'P4B47';
    END IF;$replacement$;
  v_occurrences integer;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'reconcile_subcontract_estimate_lines'
    AND p.pronargs = 4
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 4B reconciliation function was not found.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_occurrences := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Phase 4B reconciliation function drifted: expected exactly one revision-0 guard anchor, found %', v_occurrences;
  END IF;

  v_new := replace(v_def, v_old, v_replacement);
  EXECUTE v_new;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'reconcile_subcontract_estimate_lines'
    AND p.pronargs = 4
  ORDER BY p.oid DESC
  LIMIT 1;
  IF (length(v_def) - length(replace(v_def, 'P4B52', ''))) / length('P4B52') <> 1 THEN
    RAISE EXCEPTION 'Phase 4B revision-0 BASE-only guard was not installed exactly once.';
  END IF;
END $$;

-- 088 already performed the legacy workflow-body rewrite on a fresh install.
-- Validate its result strictly, while also repairing a database where 088 was
-- applied before the replacement anchor was present. Any ambiguous body shape
-- aborts this migration instead of silently accepting changed semantics.
DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_old_pattern text := 'AND settlement_status IN (''RESERVED'', ''SETTLED'')';
  v_new_pattern text := 'AND settlement_status = ''RESERVED''';
  v_old_count integer;
  v_new_count integer;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'transition_subcontract_estimate_workflow_unlocked'
    AND p.pronargs = 6
  ORDER BY p.oid DESC
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 4B unlocked workflow function was not found.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_old_count := (length(v_def) - length(replace(v_def, v_old_pattern, ''))) / length(v_old_pattern);
  v_new_count := (length(v_def) - length(replace(v_def, v_new_pattern, ''))) / length(v_new_pattern);

  IF v_old_count > 1 OR v_new_count < 1 OR (v_old_count = 1 AND v_new_count <> 0) THEN
    RAISE EXCEPTION 'Phase 4B Finance consumption rewrite is ambiguous: old=% new=%', v_old_count, v_new_count;
  END IF;
  IF v_old_count = 1 AND v_new_count = 0 THEN
    v_new := replace(v_def, v_old_pattern, v_new_pattern);
    IF v_new = v_def THEN
      RAISE EXCEPTION 'Phase 4B Finance consumption rewrite did not change the function body.';
    END IF;
    EXECUTE v_new;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'transition_subcontract_estimate_workflow_unlocked'
    AND p.pronargs = 6
  ORDER BY p.oid DESC
  LIMIT 1;
  v_old_count := (length(v_def) - length(replace(v_def, v_old_pattern, ''))) / length(v_old_pattern);
  v_new_count := (length(v_def) - length(replace(v_def, v_new_pattern, ''))) / length(v_new_pattern);
  IF v_old_count <> 0 OR v_new_count < 1 THEN
    RAISE EXCEPTION 'Phase 4B Finance consumption rewrite verification failed: old=% new=%', v_old_count, v_new_count;
  END IF;
END $$;


-- Consolidated from 090_phase4b_finance_authorization_guard.sql
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


-- Consolidated from 091_phase4_pre_freeze_hardening.sql
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


-- Consolidated from 092_phase4_lineage_closure.sql
-- Migration 092: prevent duplicate estimate lineages after approved history.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_subcontract_estimate_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serialize creation against other creates for this WO. The existing
  -- partial unique index still handles two simultaneous live estimates;
  -- this guard additionally covers rejected estimates with approved history.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('subcontract-estimate-lineage:' || NEW.work_order_no, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.project_subcontract_estimate_lines line
    JOIN public.project_subcontract_estimates estimate
      ON estimate.subcontract_estimate_id = line.subcontract_estimate_id
    WHERE estimate.work_order_no = NEW.work_order_no
      AND line.final_approved_revision IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Use the existing subcontract estimate lineage for this Work Order; it contains Final Approved history'
      USING ERRCODE = 'P4B58';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_subcontract_estimate_lineage
  ON public.project_subcontract_estimates;
CREATE TRIGGER trg_prevent_duplicate_subcontract_estimate_lineage
BEFORE INSERT ON public.project_subcontract_estimates
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_subcontract_estimate_lineage();

-- Avoid touching an already-marked Work Master row on every line reference.
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
  SET identity_locked_at = now()
  WHERE id = NEW.subcontract_work_id
    AND identity_locked_at IS NULL;
  RETURN NULL;
END;
$$;


-- Consolidated from 093_phase4_runtime_consolidation.sql
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
