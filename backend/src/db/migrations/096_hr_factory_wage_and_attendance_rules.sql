-- Base daily wages and attendance/pay rules have distinct authoritative owners.
-- No example effective dates or employee/rate rows are seeded.
CREATE TABLE public.hr_factory_wage_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_category text NOT NULL CHECK (employee_category IN ('SNP Casual Factory Labour', 'Local Daily-Wage Workers')),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  effective_from date NOT NULL,
  daily_wage numeric(12,2) NOT NULL CHECK (daily_wage >= 0),
  created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_category, effective_from),
  UNIQUE (employee_category, revision_number)
);

CREATE TABLE public.hr_factory_pay_rule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_category text NOT NULL CHECK (employee_category IN (
    'Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour',
    'SNP Casual Factory Labour', 'Local Daily-Wage Workers')),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  effective_from date NOT NULL,
  standard_duty_hours numeric(8,4) NOT NULL CHECK (standard_duty_hours > 0),
  ot_enabled boolean NOT NULL,
  ot_method text NOT NULL CHECK (ot_method IN ('Fixed Hourly', 'Salary-derived hourly', 'Derived from daily wage')),
  ot_rate numeric(12,2),
  ot_multiplier numeric(8,4),
  holiday_pay_enabled boolean NOT NULL,
  holiday_multiplier numeric(8,4),
  management_stoppage_treatment text NOT NULL CHECK (length(btrim(management_stoppage_treatment)) BETWEEN 1 AND 500),
  -- Policy descriptions are recorded, not interpreted as a payroll formula.
  short_hours_treatment text CHECK (short_hours_treatment IS NULL OR length(btrim(short_hours_treatment)) BETWEEN 1 AND 500),
  comp_off_rule text CHECK (comp_off_rule IS NULL OR length(btrim(comp_off_rule)) BETWEEN 1 AND 500),
  double_duty_multiplier numeric(8,4),
  created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_category, effective_from),
  UNIQUE (employee_category, revision_number),
  CHECK ((ot_method = 'Fixed Hourly' AND ot_rate IS NOT NULL AND ot_rate >= 0 AND ot_multiplier IS NULL)
      OR (ot_method <> 'Fixed Hourly' AND ot_rate IS NULL AND ot_multiplier IS NOT NULL AND ot_multiplier > 0)),
  CHECK ((holiday_pay_enabled AND holiday_multiplier IS NOT NULL AND holiday_multiplier > 0)
      OR (NOT holiday_pay_enabled AND holiday_multiplier IS NULL)),
  CHECK (employee_category <> 'Local Daily-Wage Workers' OR NOT holiday_pay_enabled),
  CHECK ((employee_category = 'Local Daily-Wage Workers' AND double_duty_multiplier IS NOT NULL AND double_duty_multiplier > 0)
      OR (employee_category <> 'Local Daily-Wage Workers' AND double_duty_multiplier IS NULL)),
  CHECK (ot_method <> 'Salary-derived hourly' OR employee_category IN ('Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour')),
  CHECK (ot_method <> 'Derived from daily wage' OR employee_category IN ('SNP Casual Factory Labour', 'Local Daily-Wage Workers'))
);

-- PostgreSQL numeric accepts NaN even in precision-constrained columns.
-- Upper bounds also reject it and keep direct SQL consistent with API limits.
ALTER TABLE public.hr_factory_wage_revisions ADD CONSTRAINT factory_wage_finite
  CHECK (daily_wage <= 9999999999.99);
ALTER TABLE public.hr_factory_pay_rule_revisions ADD CONSTRAINT factory_rule_numbers_finite
  CHECK (standard_duty_hours <= 9999
    AND (ot_rate IS NULL OR ot_rate <= 9999999999.99)
    AND (ot_multiplier IS NULL OR ot_multiplier <= 9999)
    AND (holiday_multiplier IS NULL OR holiday_multiplier <= 9999)
    AND (double_duty_multiplier IS NULL OR double_duty_multiplier <= 9999));

CREATE FUNCTION public.guard_factory_master_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_role text; v_active boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Factory master revisions are immutable; create a new revision' USING ERRCODE = 'P0001';
  END IF;
  SELECT role, is_active INTO v_role, v_active FROM public.authorised_users WHERE id = NEW.created_by FOR SHARE;
  IF NOT COALESCE(v_active, false) OR v_role NOT IN ('admin', 'factory_manager') THEN
    RAISE EXCEPTION 'Factory Manager or Admin required' USING ERRCODE = '42501';
  END IF;
  -- Serialize sequence allocation per master/category; unrelated categories remain independent.
  PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME || ':' || NEW.employee_category, 0));
  IF TG_TABLE_NAME = 'hr_factory_wage_revisions' THEN
    SELECT COALESCE(max(revision_number), 0) + 1 INTO NEW.revision_number
      FROM public.hr_factory_wage_revisions WHERE employee_category = NEW.employee_category;
  ELSE
    SELECT COALESCE(max(revision_number), 0) + 1 INTO NEW.revision_number
      FROM public.hr_factory_pay_rule_revisions WHERE employee_category = NEW.employee_category;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.audit_factory_master_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.audit_log(user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (NEW.created_by::text, 'CREATE_REVISION',
    CASE WHEN TG_TABLE_NAME = 'hr_factory_wage_revisions' THEN 'HR Factory Wage Master' ELSE 'HR Factory Pay Rule Master' END,
    NEW.id::text, NULL, to_jsonb(NEW));
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_factory_wage_revision BEFORE INSERT OR UPDATE OR DELETE ON public.hr_factory_wage_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_factory_master_revision();
CREATE TRIGGER guard_factory_pay_rule_revision BEFORE INSERT OR UPDATE OR DELETE ON public.hr_factory_pay_rule_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_factory_master_revision();
CREATE TRIGGER audit_factory_wage_revision AFTER INSERT ON public.hr_factory_wage_revisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_factory_master_revision();
CREATE TRIGGER audit_factory_pay_rule_revision AFTER INSERT ON public.hr_factory_pay_rule_revisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_factory_master_revision();
ALTER TABLE public.hr_factory_wage_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_factory_pay_rule_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_factory_wage_revisions, public.hr_factory_pay_rule_revisions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.hr_factory_wage_revisions, public.hr_factory_pay_rule_revisions TO service_role;
REVOKE ALL ON FUNCTION public.guard_factory_master_revision(), public.audit_factory_master_revision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_factory_master_revision(), public.audit_factory_master_revision() TO service_role;
