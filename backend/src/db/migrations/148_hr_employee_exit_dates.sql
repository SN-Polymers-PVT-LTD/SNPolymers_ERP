-- Record an explicit inclusive last working date; never infer exit from absence.
ALTER TABLE public.hr_employees ADD COLUMN last_working_date date, ADD COLUMN exit_reason text;
ALTER TABLE public.hr_employees ADD CONSTRAINT hr_employee_exit_dates_check CHECK (
 (last_working_date IS NULL AND exit_reason IS NULL) OR
 (active_status='Exited' AND last_working_date IS NOT NULL AND exit_reason IS NOT NULL AND isfinite(last_working_date) AND last_working_date>=joining_date AND length(btrim(exit_reason)) BETWEEN 1 AND 2000)
);
CREATE FUNCTION public.hr_employee_exit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE h uuid; intervals jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.last_working_date IS NOT NULL THEN
  IF NEW.last_working_date IS DISTINCT FROM OLD.last_working_date OR NEW.exit_reason IS DISTINCT FROM OLD.exit_reason OR NEW.active_status IS DISTINCT FROM OLD.active_status OR NEW.joining_date IS DISTINCT FROM OLD.joining_date THEN
   RAISE EXCEPTION 'Recorded exit is immutable; use an approved correction or rehire workflow' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.active_status<>'Exited' THEN
  IF NEW.last_working_date IS NOT NULL OR NEW.exit_reason IS NOT NULL THEN RAISE EXCEPTION 'Exit details require Exited status' USING ERRCODE='22023'; END IF;
  RETURN NEW;
 END IF;
 -- Preserve legacy Exited records until explicitly supplied with exit evidence.
 IF TG_OP='UPDATE' AND OLD.active_status='Exited' AND NEW.last_working_date IS NULL AND NEW.exit_reason IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Create the employee first, then record their exit' USING ERRCODE='22023'; END IF;
 PERFORM public.payroll_require_actor(NEW.updated_by,ARRAY['admin']);
 PERFORM public.payroll_source_fence('employee:'||NEW.id::text,false);
 IF NEW.last_working_date IS NULL OR NEW.last_working_date<NEW.joining_date OR NEW.last_working_date>(now() AT TIME ZONE 'Asia/Kolkata')::date OR nullif(btrim(NEW.exit_reason),'') IS NULL OR length(NEW.exit_reason)>2000 THEN
  RAISE EXCEPTION 'Provide a last working date between joining and today, and an exit reason' USING ERRCODE='22023';
 END IF;
 IF NEW.employee_category IS DISTINCT FROM OLD.employee_category OR NEW.department IS DISTINCT FROM OLD.department OR NEW.joining_date IS DISTINCT FROM OLD.joining_date THEN RAISE EXCEPTION 'Record exit separately from classification or joining-date changes' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_employee_coverage WHERE employee_id=NEW.id AND period_to>NEW.last_working_date) THEN RAISE EXCEPTION 'Exit would change locked payroll coverage; use an approved correction workflow' USING ERRCODE='PY409'; END IF;
 SELECT id INTO h FROM public.payroll_source_history_revisions WHERE employee_id=NEW.id AND source_kind='ASSIGNMENT' ORDER BY version DESC LIMIT 1;
 IF h IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.payroll_employee_assignments WHERE revision_id=h AND effective_from>NEW.last_working_date) THEN RAISE EXCEPTION 'Exit conflicts with a later assignment; review dated history first' USING ERRCODE='22023'; END IF;
  SELECT jsonb_agg(jsonb_build_object('group_code',group_code,'employee_category',employee_category,'department',department,'effective_from',effective_from,'effective_to',least(coalesce(effective_to,NEW.last_working_date),NEW.last_working_date),'employment_joined_on',employment_joined_on,'employment_exited_on',NEW.last_working_date) ORDER BY effective_from) INTO intervals FROM public.payroll_employee_assignments WHERE revision_id=h;
  PERFORM public.record_payroll_source_history(NEW.id,'ASSIGNMENT',intervals,NEW.exit_reason,NEW.updated_by);
 END IF;
 INSERT INTO public.audit_log(user_id,action,module_name,record_identifier,old_value,new_value)
 VALUES(NEW.updated_by::text,'EMPLOYEE_EXIT_RECORDED','HR Employee Master',NEW.employee_code,
 jsonb_build_object('active_status',OLD.active_status),
 jsonb_build_object('active_status',NEW.active_status,'last_working_date',NEW.last_working_date,'exit_reason',NEW.exit_reason));
 RETURN NEW;
END; $$;
CREATE TRIGGER hr_employee_exit_guard BEFORE INSERT OR UPDATE ON public.hr_employees FOR EACH ROW EXECUTE FUNCTION public.hr_employee_exit_guard();
-- Prevent later assignment initialization from reopening exited employment.
CREATE FUNCTION public.payroll_assignment_exit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE cutoff date;
BEGIN
 SELECT last_working_date INTO cutoff FROM public.hr_employees WHERE id=NEW.employee_id;
 IF cutoff IS NOT NULL AND (NEW.effective_to IS NULL OR NEW.effective_to>cutoff OR NEW.employment_exited_on IS DISTINCT FROM cutoff) THEN RAISE EXCEPTION 'Assignment must end on or before the recorded employee exit date' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payroll_assignment_exit_guard BEFORE INSERT OR UPDATE ON public.payroll_employee_assignments FOR EACH ROW EXECUTE FUNCTION public.payroll_assignment_exit_guard();
REVOKE ALL ON FUNCTION public.hr_employee_exit_guard(),public.payroll_assignment_exit_guard() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
