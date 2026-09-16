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
