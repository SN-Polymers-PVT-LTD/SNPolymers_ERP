-- A permanent calculation reads complete salary months, including split runs.
CREATE OR REPLACE FUNCTION public.guard_factory_calendar_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE first_day date;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Calendar history is immutable' USING ERRCODE='PY409'; END IF;
 PERFORM public.payroll_require_actor(NEW.created_by,ARRAY['admin','ho']);
 PERFORM public.payroll_require_scope(NEW.created_by,NEW.department,false);
 PERFORM public.payroll_source_fence('factory-calendar:'||NEW.department,false);
 SELECT applies_on INTO first_day FROM public.factory_calendar_revisions WHERE department=NEW.department AND action='SCHEDULE';
 IF NEW.action<>'SCHEDULE' AND (first_day IS NULL OR NEW.applies_on<first_day) THEN RAISE EXCEPTION 'Set up the calendar first; exceptions must be on or after its start date' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_run_employees e JOIN public.payroll_runs r ON r.id=e.run_id JOIN public.payroll_groups g ON g.code=r.group_code
  WHERE e.status='LOCKED'
  AND (r.department=NEW.department OR EXISTS(SELECT 1 FROM public.payroll_employee_assignments a WHERE a.employee_id=e.employee_id AND a.department=NEW.department AND daterange(a.effective_from,a.effective_to,'[]') && daterange(e.period_from,e.period_to,'[]')))
  AND (CASE WHEN NEW.action='SCHEDULE' THEN NEW.applies_on<=CASE WHEN g.is_permanent THEN (date_trunc('month',e.period_to)+interval '1 month - 1 day')::date ELSE e.period_to END
  ELSE NEW.applies_on BETWEEN CASE WHEN g.is_permanent THEN date_trunc('month',e.period_from)::date ELSE e.period_from END AND CASE WHEN g.is_permanent THEN (date_trunc('month',e.period_to)+interval '1 month - 1 day')::date ELSE e.period_to END END)) THEN
  RAISE EXCEPTION 'This calendar change affects locked payroll; use the payroll correction workflow' USING ERRCODE='PY409'; END IF;
 SELECT coalesce(max(version),0)+1 INTO NEW.version FROM public.factory_calendar_revisions WHERE department=NEW.department;
 NEW.created_at:=now(); RETURN NEW;
END $$;
