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
