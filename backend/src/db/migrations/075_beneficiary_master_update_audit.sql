-- Migration 075: audit shared beneficiary-directory corrections made during
-- Accounts reconciliation. This is a forward-only change; migration 074 is
-- intentionally left immutable.

CREATE OR REPLACE FUNCTION public.audit_beneficiary_master_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.beneficiary_name IS DISTINCT FROM NEW.beneficiary_name
     OR OLD.beneficiary_bank_name IS DISTINCT FROM NEW.beneficiary_bank_name
     OR OLD.beneficiary_bank_id IS DISTINCT FROM NEW.beneficiary_bank_id THEN
    INSERT INTO public.audit_log (
      user_id, action, module_name, record_identifier, old_value, new_value
    ) VALUES (
      NEW.updated_by,
      'BENEFICIARY_MASTER_RECONCILED',
      'Beneficiary Master',
      NEW.id::varchar,
      jsonb_build_object(
        'beneficiary_name', OLD.beneficiary_name,
        'beneficiary_ac_no', OLD.beneficiary_ac_no,
        'beneficiary_ifsc', OLD.beneficiary_ifsc,
        'beneficiary_bank_name', OLD.beneficiary_bank_name,
        'beneficiary_bank_id', OLD.beneficiary_bank_id
      ),
      jsonb_build_object(
        'beneficiary_name', NEW.beneficiary_name,
        'beneficiary_ac_no', NEW.beneficiary_ac_no,
        'beneficiary_ifsc', NEW.beneficiary_ifsc,
        'beneficiary_bank_name', NEW.beneficiary_bank_name,
        'beneficiary_bank_id', NEW.beneficiary_bank_id
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_beneficiary_master_update
ON public.projects_beneficiary_master;

CREATE TRIGGER trg_audit_beneficiary_master_update
AFTER UPDATE ON public.projects_beneficiary_master
FOR EACH ROW
EXECUTE FUNCTION public.audit_beneficiary_master_update();

REVOKE ALL ON FUNCTION public.audit_beneficiary_master_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_beneficiary_master_update() TO service_role;
