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
