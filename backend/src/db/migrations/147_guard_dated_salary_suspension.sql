-- Undated suspension cannot end a salary's dated payroll applicability safely.
-- Preserve mapped salary/history and reject until an explicit dated-end workflow exists.
CREATE OR REPLACE FUNCTION public.payroll_guard_salary_suspension() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF NEW.status='Suspended' AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS(
  SELECT 1 FROM public.payroll_permanent_pay_applicability WHERE employee_id=NEW.employee_id AND pay_structure_id=NEW.id
 ) THEN RAISE EXCEPTION 'This salary has payroll effective dates. Undated suspension is unavailable; use a supported dated end-of-coverage workflow.' USING ERRCODE='PY409'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_guard_salary_suspension() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a01_payroll_guard_salary_suspension BEFORE UPDATE OF status ON public.hr_permanent_pay_structures FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_salary_suspension();

-- Close the reverse order too: an already suspended salary cannot acquire a new dated mapping.
CREATE OR REPLACE FUNCTION public.payroll_guard_suspended_salary_mapping() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.hr_permanent_pay_structures WHERE id=NEW.pay_structure_id AND status='Suspended') THEN
  RAISE EXCEPTION 'A suspended salary cannot be assigned as a payroll source. Create a supported salary revision first.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_guard_suspended_salary_mapping() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a01_payroll_guard_suspended_salary_mapping BEFORE INSERT ON public.payroll_permanent_pay_applicability FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_suspended_salary_mapping();

CREATE OR REPLACE FUNCTION public.suspend_hr_pay_structure(p_pay_structure_id uuid,p_actor_id uuid)
RETURNS public.hr_permanent_pay_structures LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE target public.hr_permanent_pay_structures%ROWTYPE; employee uuid;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 SELECT employee_id INTO employee FROM public.hr_permanent_pay_structures WHERE id=p_pay_structure_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pay structure revision not found' USING ERRCODE='P0002'; END IF;
 -- The same employee fence protects dated mapping writes and financial review.
 PERFORM public.payroll_source_fence('employee:'||employee::text,false);
 PERFORM 1 FROM public.hr_employees WHERE id=employee FOR UPDATE;
 SELECT * INTO target FROM public.hr_permanent_pay_structures WHERE id=p_pay_structure_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.payroll_permanent_pay_applicability WHERE employee_id=employee AND pay_structure_id=target.id) THEN
  RAISE EXCEPTION 'This salary has payroll effective dates. Undated suspension is unavailable; use a supported dated end-of-coverage workflow.' USING ERRCODE='PY409';
 END IF;
 IF target.status='Suspended' THEN RETURN target; END IF;
 IF target.status<>'Active' THEN RAISE EXCEPTION 'Only active pay structures can be suspended' USING ERRCODE='22023'; END IF;
 UPDATE public.hr_permanent_pay_structures SET status='Suspended',updated_at=now(),updated_by=p_actor_id WHERE id=p_pay_structure_id RETURNING * INTO target;
 RETURN target;
END; $$;
REVOKE ALL ON FUNCTION public.suspend_hr_pay_structure(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.suspend_hr_pay_structure(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
