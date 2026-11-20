-- Keep source fences private and reject changes to finalized periods.
CREATE OR REPLACE FUNCTION public.guard_factory_master_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_role text; v_active boolean; v_end date;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Factory master revisions are immutable; create a new revision' USING ERRCODE = 'P0001';
  END IF;
  SELECT role, is_active INTO v_role, v_active FROM public.authorised_users WHERE id = NEW.created_by FOR SHARE;
  IF NOT COALESCE(v_active, false) OR v_role NOT IN ('admin', 'factory_manager') THEN
    RAISE EXCEPTION 'Factory Manager or Admin required' USING ERRCODE = '42501';
  END IF;
  NEW.department:=coalesce(NEW.department,public.factory_category_department(NEW.employee_category));
  IF NEW.department IS NULL THEN RAISE EXCEPTION 'Select a factory for Local workers' USING ERRCODE='23514'; END IF;
  IF NEW.employee_category='Local Daily-Wage Workers' AND (NEW.setup_reason IS NULL OR length(btrim(NEW.setup_reason))=0) THEN
   RAISE EXCEPTION 'Record the reason for factory-specific Local setup' USING ERRCODE='23514'; END IF;
  PERFORM public.payroll_source_fence('factory:'||NEW.employee_category,false);
  IF TG_TABLE_NAME='hr_factory_wage_revisions' THEN
   SELECT min(effective_from)-1 INTO v_end FROM public.hr_factory_wage_revisions WHERE employee_category=NEW.employee_category AND department=NEW.department AND effective_from>NEW.effective_from;
  ELSE
   SELECT min(effective_from)-1 INTO v_end FROM public.hr_factory_pay_rule_revisions WHERE employee_category=NEW.employee_category AND department=NEW.department AND effective_from>NEW.effective_from;
  END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_run_employees e JOIN public.payroll_employee_assignments a ON a.employee_id=e.employee_id
   WHERE e.status='LOCKED' AND a.employee_category=NEW.employee_category AND a.department=NEW.department
   AND daterange(e.period_from,e.period_to,'[]') && daterange(NEW.effective_from,v_end,'[]')
   AND daterange(a.effective_from,a.effective_to,'[]') && (daterange(e.period_from,e.period_to,'[]') * daterange(NEW.effective_from,v_end,'[]'))) THEN
   RAISE EXCEPTION 'Factory revision overlaps locked payroll; choose a future date or use corrections' USING ERRCODE='PY409'; END IF;
  -- Serialize sequence allocation per master/category; unrelated categories remain independent.
  PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME || ':' || NEW.employee_category, 0));
  IF TG_TABLE_NAME = 'hr_factory_wage_revisions' THEN
    SELECT COALESCE(max(revision_number), 0) + 1 INTO NEW.revision_number
      FROM public.hr_factory_wage_revisions WHERE employee_category = NEW.employee_category AND department=NEW.department;
  ELSE
    SELECT COALESCE(max(revision_number), 0) + 1 INTO NEW.revision_number
      FROM public.hr_factory_pay_rule_revisions WHERE employee_category = NEW.employee_category AND department=NEW.department;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
