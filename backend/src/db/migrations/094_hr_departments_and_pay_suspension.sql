-- Phase 1 HR Department updates and Pay Structure suspension lifecycle.
-- 1. Updates allowed departments to: 'Head Office', 'Fabric Factory', 'SNP Factory', 'Projects'.
--    (Accounts department merged into Head Office; Manufacturing Factory renamed to SNP Factory).
-- 2. Pay structure defaults to 'Active' on creation and supports 'Suspended' status.

-- Data migration for departments
UPDATE public.hr_employees
SET department = 'Head Office'
WHERE department = 'Accounts';

UPDATE public.hr_employees
SET department = 'SNP Factory'
WHERE department = 'Manufacturing Factory';

-- Department CHECK constraint update
ALTER TABLE public.hr_employees DROP CONSTRAINT IF EXISTS hr_employees_department_check;
ALTER TABLE public.hr_employees ADD CONSTRAINT hr_employees_department_check
  CHECK (department IN ('Head Office', 'Fabric Factory', 'SNP Factory', 'Projects'));

-- Pay structure status constraint and default update
ALTER TABLE public.hr_permanent_pay_structures DROP CONSTRAINT IF EXISTS hr_permanent_pay_structures_status_check;
ALTER TABLE public.hr_permanent_pay_structures ADD CONSTRAINT hr_permanent_pay_structures_status_check
  CHECK (status IN ('Draft', 'Active', 'Superseded', 'Suspended'));

ALTER TABLE public.hr_permanent_pay_structures ALTER COLUMN status SET DEFAULT 'Active';

-- Update audit trigger to support Suspended state and immutability
CREATE OR REPLACE FUNCTION public.hr_permanent_pay_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_category text;
  v_emp_code text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pay structure records cannot be deleted' USING ERRCODE = 'P0001';
  END IF;

  SELECT employee_category, employee_code INTO v_category, v_emp_code
  FROM public.hr_employees
  WHERE id = NEW.employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target employee does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_category NOT IN (
    'HO Staff', 'Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour', 'Projects Department Employees'
  ) THEN
    RAISE EXCEPTION 'Permanent pay structures can only be created for permanent employee categories' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
       OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Pay structure identity, revision sequence, and creation audit fields are immutable' USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status IN ('Active', 'Superseded', 'Suspended') THEN
      IF NEW.pay_basis IS DISTINCT FROM OLD.pay_basis
         OR NEW.guaranteed_monthly_gross IS DISTINCT FROM OLD.guaranteed_monthly_gross
         OR NEW.basic_salary IS DISTINCT FROM OLD.basic_salary
         OR NEW.staff_welfare IS DISTINCT FROM OLD.staff_welfare
         OR NEW.other_fixed_components IS DISTINCT FROM OLD.other_fixed_components
         OR NEW.epf_enrolment IS DISTINCT FROM OLD.epf_enrolment
         OR NEW.esi_enrolment IS DISTINCT FROM OLD.esi_enrolment THEN
        RAISE EXCEPTION 'Active, Suspended, or Superseded pay structures cannot have their compensation terms modified. Create a new revision instead.' USING ERRCODE = 'P0001';
      END IF;
      IF OLD.status = 'Active' AND NEW.status NOT IN ('Active', 'Superseded', 'Suspended') THEN
        RAISE EXCEPTION 'Active pay structures can only transition to Superseded or Suspended' USING ERRCODE = 'P0001';
      END IF;
      IF OLD.status = 'Suspended' AND NEW.status NOT IN ('Suspended', 'Active', 'Superseded') THEN
        RAISE EXCEPTION 'Suspended pay structures can only transition to Active or Superseded' USING ERRCODE = 'P0001';
      END IF;
      IF OLD.status = 'Superseded' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Superseded pay structure status cannot be changed' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    NEW.updated_at := now();
  END IF;

  -- Audit without exposing monetary gross amounts (Spec §5)
  INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (
    CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END::text,
    CASE WHEN TG_OP = 'INSERT' THEN 'CREATE_PAY_STRUCTURE' ELSE 'UPDATE_PAY_STRUCTURE' END,
    'HR Permanent Pay Structure',
    v_emp_code,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
      'status', OLD.status,
      'revision_number', OLD.revision_number,
      'pay_basis_changed', NEW.pay_basis IS DISTINCT FROM OLD.pay_basis,
      'epf_enrolment_changed', NEW.epf_enrolment IS DISTINCT FROM OLD.epf_enrolment,
      'esi_enrolment_changed', NEW.esi_enrolment IS DISTINCT FROM OLD.esi_enrolment
    ) ELSE NULL END,
    jsonb_build_object(
      'status', NEW.status,
      'revision_number', NEW.revision_number,
      'pay_basis_changed', CASE WHEN TG_OP = 'INSERT' THEN true ELSE NEW.pay_basis IS DISTINCT FROM OLD.pay_basis END,
      'epf_enrolment_changed', CASE WHEN TG_OP = 'INSERT' THEN true ELSE NEW.epf_enrolment IS DISTINCT FROM OLD.epf_enrolment END,
      'esi_enrolment_changed', CASE WHEN TG_OP = 'INSERT' THEN true ELSE NEW.esi_enrolment IS DISTINCT FROM OLD.esi_enrolment END
    )
  );

  RETURN NEW;
END;
$$;

-- Atomic suspension RPC
CREATE OR REPLACE FUNCTION public.suspend_hr_pay_structure(
  p_pay_structure_id uuid,
  p_actor_id uuid
) RETURNS public.hr_permanent_pay_structures LANGUAGE plpgsql AS $$
DECLARE
  v_target public.hr_permanent_pay_structures%ROWTYPE;
  v_employee_id uuid;
BEGIN
  SELECT employee_id INTO v_employee_id
  FROM public.hr_permanent_pay_structures
  WHERE id = p_pay_structure_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay structure revision not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.hr_employees WHERE id = v_employee_id FOR UPDATE;

  SELECT * INTO v_target
  FROM public.hr_permanent_pay_structures
  WHERE id = p_pay_structure_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay structure revision not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.status = 'Suspended' THEN
    RETURN v_target;
  END IF;

  IF v_target.status <> 'Active' THEN
    RAISE EXCEPTION 'Only active pay structures can be suspended' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.hr_permanent_pay_structures
  SET status = 'Suspended',
      updated_at = now(),
      updated_by = p_actor_id
  WHERE id = p_pay_structure_id
  RETURNING * INTO v_target;

  RETURN v_target;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suspend_hr_pay_structure(uuid, uuid) TO service_role;

-- Update create_hr_pay_structure to default to 'Active' and supersede existing Active/Suspended structures
CREATE OR REPLACE FUNCTION public.create_hr_pay_structure(
  p_employee_id uuid,
  p_pay_basis text,
  p_guaranteed_monthly_gross numeric,
  p_basic_salary numeric,
  p_staff_welfare numeric,
  p_other_fixed_components numeric,
  p_epf_enrolment boolean,
  p_esi_enrolment boolean,
  p_status text,
  p_actor_id uuid
) RETURNS public.hr_permanent_pay_structures LANGUAGE plpgsql AS $$
DECLARE
  v_next_rev integer;
  v_res public.hr_permanent_pay_structures%ROWTYPE;
  v_status text;
BEGIN
  PERFORM 1 FROM public.hr_employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target employee does not exist' USING ERRCODE = 'P0002';
  END IF;

  v_status := COALESCE(p_status, 'Active');

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_rev
  FROM public.hr_permanent_pay_structures
  WHERE employee_id = p_employee_id;

  IF v_status = 'Active' THEN
    UPDATE public.hr_permanent_pay_structures
    SET status = 'Superseded',
        updated_at = now(),
        updated_by = p_actor_id
    WHERE employee_id = p_employee_id
      AND status IN ('Active', 'Suspended');
  END IF;

  INSERT INTO public.hr_permanent_pay_structures (
    employee_id, revision_number, pay_basis, guaranteed_monthly_gross,
    basic_salary, staff_welfare, other_fixed_components,
    epf_enrolment, esi_enrolment, status,
    created_by, updated_by
  ) VALUES (
    p_employee_id, v_next_rev, p_pay_basis, p_guaranteed_monthly_gross,
    p_basic_salary, p_staff_welfare, p_other_fixed_components,
    COALESCE(p_epf_enrolment, false), COALESCE(p_esi_enrolment, false), v_status,
    p_actor_id, p_actor_id
  ) RETURNING * INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_hr_pay_structure(uuid, text, numeric, numeric, numeric, numeric, boolean, boolean, text, uuid) TO service_role;

-- Update activate_hr_pay_structure to supersede any existing Active or Suspended structures
CREATE OR REPLACE FUNCTION public.activate_hr_pay_structure(
  p_pay_structure_id uuid,
  p_actor_id uuid
) RETURNS public.hr_permanent_pay_structures LANGUAGE plpgsql AS $$
DECLARE
  v_target public.hr_permanent_pay_structures%ROWTYPE;
  v_employee_id uuid;
BEGIN
  SELECT employee_id INTO v_employee_id
  FROM public.hr_permanent_pay_structures
  WHERE id = p_pay_structure_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay structure revision not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.hr_employees WHERE id = v_employee_id FOR UPDATE;

  SELECT * INTO v_target
  FROM public.hr_permanent_pay_structures
  WHERE id = p_pay_structure_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay structure revision not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_target.status = 'Active' THEN
    RETURN v_target;
  END IF;

  IF v_target.status = 'Superseded' THEN
    RAISE EXCEPTION 'Cannot activate a superseded pay structure revision' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.hr_permanent_pay_structures
  SET status = 'Superseded',
      updated_at = now(),
      updated_by = p_actor_id
  WHERE employee_id = v_employee_id
    AND status IN ('Active', 'Suspended')
    AND id <> p_pay_structure_id;

  UPDATE public.hr_permanent_pay_structures
  SET status = 'Active',
      updated_at = now(),
      updated_by = p_actor_id
  WHERE id = p_pay_structure_id
  RETURNING * INTO v_target;

  RETURN v_target;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_hr_pay_structure(uuid, uuid) TO service_role;
