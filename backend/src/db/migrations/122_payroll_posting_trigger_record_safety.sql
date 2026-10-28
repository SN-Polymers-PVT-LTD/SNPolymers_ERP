-- Each trigger branch resolves only fields present on that table's row type.
CREATE OR REPLACE FUNCTION public.payroll_phase1_no_posting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT public.payroll_financial_enabled() THEN RAISE EXCEPTION 'Payroll financial posting is disabled' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND TG_TABLE_NAME<>'payroll_employee_month_entitlements') THEN RAISE EXCEPTION 'Financial records are immutable' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='payroll_employee_month_entitlements' AND TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['allocated_base','lop_amount','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['allocated_base','lop_amount','version']) OR NEW.version<>OLD.version+1 OR NEW.allocated_base<OLD.allocated_base OR NEW.lop_amount<OLD.lop_amount THEN RAISE EXCEPTION 'Monthly entitlement identity is immutable' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME='payroll_employee_coverage' THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_financial_snapshots f JOIN public.payroll_run_employees e ON e.id=f.row_id WHERE f.row_id=NEW.salary_row_id AND f.employee_id=NEW.employee_id AND e.period_from=NEW.period_from AND e.period_to=NEW.period_to) THEN RAISE EXCEPTION 'Immutable salary snapshot required' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='payroll_month_allocations' THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_financial_snapshots f JOIN public.payroll_employee_month_entitlements m ON m.id=NEW.entitlement_id WHERE f.row_id=NEW.salary_row_id AND f.employee_id=m.employee_id) THEN RAISE EXCEPTION 'Allocation employee ownership required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
