-- Phase 1 HR directory. Employee identity is independent of ERP login identity.
CREATE SEQUENCE public.hr_employee_code_seq;

CREATE TABLE public.hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text NOT NULL UNIQUE DEFAULT ('EMP-' || nextval('public.hr_employee_code_seq')::text),
  employee_name text NOT NULL CHECK (length(btrim(employee_name)) > 0),
  employee_category text NOT NULL CHECK (employee_category IN (
    'HO Staff', 'Fabric Factory Permanent Employees', 'SNP Casual Factory Labour',
    'SNP Permanent Factory Labour', 'Projects Department Employees', 'Local Daily-Wage Workers'
  )),
  department text NOT NULL CHECK (department IN ('Head Office', 'Accounts', 'Fabric Factory', 'Manufacturing Factory', 'Projects')),
  contact_number text,
  erp_user_id uuid UNIQUE REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  joining_date date NOT NULL,
  active_status text NOT NULL DEFAULT 'Active' CHECK (active_status IN ('Active', 'Inactive', 'Exited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  CONSTRAINT hr_employee_contact_not_blank CHECK (contact_number IS NULL OR length(btrim(contact_number)) > 0)
);

CREATE INDEX hr_employees_name_idx ON public.hr_employees (lower(employee_name));
CREATE INDEX hr_employees_status_category_idx ON public.hr_employees (active_status, employee_category);

CREATE FUNCTION public.hr_employee_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Employee records cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.employee_code IS DISTINCT FROM OLD.employee_code
       OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Employee identity and creation audit fields are immutable' USING ERRCODE = 'P0001';
    END IF;
    NEW.updated_at := now();
  END IF;
  INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END::text,
          TG_OP, 'HR Employee Master', NEW.employee_code,
          CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('active_status', OLD.active_status, 'erp_user_id', OLD.erp_user_id) ELSE NULL END,
          jsonb_build_object('active_status', NEW.active_status, 'erp_user_id', NEW.erp_user_id));
  RETURN NEW;
END;
$$;
CREATE TRIGGER hr_employee_audit_write BEFORE INSERT OR UPDATE ON public.hr_employees
  FOR EACH ROW EXECUTE FUNCTION public.hr_employee_audit();
CREATE TRIGGER hr_employee_no_delete BEFORE DELETE ON public.hr_employees
  FOR EACH ROW EXECUTE FUNCTION public.hr_employee_audit();

ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.hr_employees TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.hr_employee_code_seq TO service_role;
