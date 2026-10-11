-- Expected stale versions are business conflicts, not serialization failures.
-- SQLSTATE 40001 triggers infrastructure retries in PostgREST/Hasql.
-- Preserve signatures/privileges; the backend maps PY409 to HTTP 409.

CREATE OR REPLACE FUNCTION public.add_payroll_draft_employee(p_run_id uuid,p_assignment_id uuid,p_from date,p_to date,p_actor_id uuid)
RETURNS public.payroll_run_employees LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; a public.payroll_employee_assignments%ROWTYPE; e public.payroll_run_employees%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 IF r.created_by<>p_actor_id AND public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','factory_manager'])<>'admin' THEN
  RAISE EXCEPTION 'Only draft creator may edit' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.payroll_employee_assignments WHERE id=p_assignment_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.hr_employees WHERE id=a.employee_id FOR SHARE;
 IF a.revision_id IS DISTINCT FROM (SELECT id FROM public.payroll_source_history_revisions
  WHERE employee_id=a.employee_id AND source_kind='ASSIGNMENT' ORDER BY version DESC LIMIT 1) THEN
  RAISE EXCEPTION 'Assignment timeline has changed; reload' USING ERRCODE='PY409'; END IF;
 INSERT INTO public.payroll_run_employees(run_id,employee_id,assignment_id,period_from,period_to,created_by)
  VALUES(r.id,a.employee_id,a.id,p_from,p_to,p_actor_id) RETURNING * INTO e;
 PERFORM public.payroll_append_draft_version(e.id,'',p_actor_id);
 RETURN e;
END; $$;

CREATE OR REPLACE FUNCTION public.revise_payroll_draft_note(p_row_id uuid,p_expected_version integer,p_note text,p_actor_id uuid)
RETURNS public.payroll_run_employees LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; e public.payroll_run_employees%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 IF r.created_by<>p_actor_id AND public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','factory_manager'])<>'admin' THEN
  RAISE EXCEPTION 'Only draft creator may edit' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id FOR UPDATE;
 IF p_expected_version IS DISTINCT FROM e.current_version THEN
  RAISE EXCEPTION 'Payroll row version conflict' USING ERRCODE='PY409'; END IF;
 UPDATE public.payroll_run_employees SET current_version=current_version+1 WHERE id=e.id RETURNING * INTO e;
 PERFORM public.payroll_append_draft_version(e.id,p_note,p_actor_id);
 RETURN e;
END; $$;

NOTIFY pgrst,'reload schema';
