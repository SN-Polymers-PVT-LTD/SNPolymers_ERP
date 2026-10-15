-- Populate recorded employee assignments without replacing existing salary rows.
-- Initial calculations remain server-derived, audited per employee, and unsubmitted.
CREATE FUNCTION public.populate_payroll_draft_run(p_run_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; role_name text; factory boolean; candidate record;
 e public.payroll_run_employees%ROWTYPE; initial_rows jsonb:='[]'; saved_rows jsonb:='[]'; issues jsonb:='[]';
 added integer:=0; retained integer:=0; eligible_count integer; missing jsonb;
BEGIN
 role_name:=public.payroll_require_actor(p_actor_id,ARRAY['accounts','factory_manager']);
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 SELECT is_factory INTO factory FROM public.payroll_groups WHERE code=r.group_code;
 IF r.created_by<>p_actor_id OR role_name<>(CASE WHEN factory THEN 'factory_manager' ELSE 'accounts' END) THEN
  RAISE EXCEPTION 'Only the originating payroll preparer may populate this sheet' USING ERRCODE='42501';
 END IF;
 WITH latest AS (SELECT DISTINCT ON(employee_id) id,employee_id FROM public.payroll_source_history_revisions
  WHERE source_kind='ASSIGNMENT' ORDER BY employee_id,version DESC)
 SELECT count(DISTINCT a.employee_id) INTO eligible_count FROM public.payroll_employee_assignments a JOIN latest l ON l.id=a.revision_id
 WHERE a.group_code=r.group_code AND a.department=r.department AND daterange(a.effective_from,a.effective_to,'[]') && daterange(r.period_from,r.period_to,'[]');
 IF eligible_count>1000 THEN RAISE EXCEPTION 'More than 1000 employees match; narrow the payroll period' USING ERRCODE='22023'; END IF;
 FOR candidate IN
  WITH latest AS (SELECT DISTINCT ON(employee_id) id,employee_id FROM public.payroll_source_history_revisions
   WHERE source_kind='ASSIGNMENT' ORDER BY employee_id,version DESC), eligible AS (
   SELECT a.*,h.employee_name,h.employee_code,greatest(a.effective_from,r.period_from) payable_from,
    least(a.effective_to,r.period_to) payable_to,count(*) OVER(PARTITION BY a.employee_id) intervals
   FROM public.payroll_employee_assignments a JOIN latest l ON l.id=a.revision_id JOIN public.hr_employees h ON h.id=a.employee_id
   WHERE a.group_code=r.group_code AND a.department=r.department AND daterange(a.effective_from,a.effective_to,'[]') && daterange(r.period_from,r.period_to,'[]'))
  SELECT DISTINCT ON(employee_id) * FROM eligible ORDER BY employee_id,effective_from,id
 LOOP
  SELECT * INTO e FROM public.payroll_run_employees WHERE run_id=r.id AND employee_id=candidate.employee_id;
  IF FOUND THEN
   retained:=retained+1;
   IF e.status='DRAFT' AND e.current_version=1 AND e.review_revision IS NULL AND e.created_by=p_actor_id THEN
    initial_rows:=initial_rows||jsonb_build_array(to_jsonb(e));
   END IF;
  ELSIF candidate.intervals>1 THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('employee_id',candidate.employee_id,'employee_name',candidate.employee_name,
    'employee_code',candidate.employee_code,'code','MULTIPLE_ASSIGNMENT_INTERVALS','message','Choose an evidenced interval individually; one employee row per sheet is required.'));
  ELSE
   BEGIN
    e:=public.add_payroll_draft_employee(r.id,candidate.id,candidate.payable_from,candidate.payable_to,p_actor_id);
    initial_rows:=initial_rows||jsonb_build_array(to_jsonb(e));added:=added+1;
   EXCEPTION WHEN OTHERS THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('employee_id',candidate.employee_id,'employee_name',candidate.employee_name,
     'employee_code',candidate.employee_code,'code',SQLSTATE,'message',SQLERRM));
   END;
  END IF;
 END LOOP;
 -- Source checks include retained rows no longer present in the latest candidate
 -- roster too. Refresh never deletes, reassigns or recalculates their saved work.
 SELECT coalesce(jsonb_agg(jsonb_build_object('row_id',salary.id,'source_fingerprint',v.source_fingerprint)),'[]') INTO saved_rows
 FROM public.payroll_run_employees salary JOIN public.payroll_review_revisions v ON v.row_id=salary.id AND v.revision=salary.review_revision
 WHERE salary.run_id=r.id AND salary.status NOT IN ('LOCKED','CANCELLED_DRAFT');
 SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id',h.id,'employee_name',h.employee_name,'employee_code',h.employee_code,
  'code','ASSIGNMENT_HISTORY_REQUIRED','message','Record dated payroll assignment history before generating this employee.')),'[]') INTO missing
 FROM public.hr_employees h JOIN public.payroll_groups g ON g.employee_category=h.employee_category
 WHERE g.code=r.group_code AND h.department=r.department AND h.active_status='Active' AND h.joining_date<=r.period_to
  AND NOT EXISTS(SELECT 1 FROM public.payroll_source_history_revisions s WHERE s.employee_id=h.id AND s.source_kind='ASSIGNMENT');
 RETURN jsonb_build_object('run',to_jsonb(r),'added',added,'retained',retained,'rows',initial_rows,'saved_rows',saved_rows,'issues',issues||missing);
END; $$;
REVOKE ALL ON FUNCTION public.populate_payroll_draft_run(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.populate_payroll_draft_run(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
