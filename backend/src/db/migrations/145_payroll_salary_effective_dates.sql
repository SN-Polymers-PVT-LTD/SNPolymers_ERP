-- Connect ordinary HR salary authoring to explicit dated payroll history.
-- Existing rows are not backfilled: Admin must confirm historical applicability.
CREATE OR REPLACE FUNCTION public.get_hr_payroll_salary_context(p_employee_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE h public.payroll_source_history_revisions%ROWTYPE; a public.payroll_source_history_revisions%ROWTYPE; result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 IF NOT EXISTS(SELECT 1 FROM public.hr_employees WHERE id=p_employee_id) THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO h FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1;
 SELECT * INTO a FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='ASSIGNMENT' ORDER BY version DESC LIMIT 1;
 SELECT jsonb_build_object('version',coalesce(h.version,0),'assignment_version',coalesce(a.version,0),
  'intervals',coalesce((SELECT jsonb_agg(jsonb_build_object('pay_structure_id',pay_structure_id,'effective_from',effective_from,'effective_to',effective_to) ORDER BY effective_from) FROM public.payroll_permanent_pay_applicability WHERE revision_id=h.id),'[]'),
  'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('group_code',group_code,'employee_category',employee_category,'department',department,'effective_from',effective_from,'effective_to',effective_to) ORDER BY effective_from) FROM public.payroll_employee_assignments WHERE revision_id=a.id),'[]')) INTO result;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.initialize_hr_payroll_assignment(p_employee_id uuid,p_from date,p_reason text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.hr_employees%ROWTYPE; g text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 PERFORM public.payroll_source_fence('employee:'||p_employee_id::text,false);
 SELECT * INTO e FROM public.hr_employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 IF p_from IS NULL OR NOT isfinite(p_from) OR p_from<e.joining_date OR p_from>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Confirm an assignment date on or after joining and no later than today' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='ASSIGNMENT') THEN RAISE EXCEPTION 'Assignment history already exists; reload before making a dated correction' USING ERRCODE='PY409'; END IF;
 SELECT x.code INTO g FROM public.payroll_groups x JOIN public.payroll_group_departments d ON d.group_code=x.code WHERE x.employee_category=e.employee_category AND d.department=e.department;
 IF g IS NULL THEN RAISE EXCEPTION 'Employee category and department do not define a payroll group' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_employee_coverage WHERE employee_id=p_employee_id AND period_to>=p_from) THEN RAISE EXCEPTION 'Locked payroll already covers this assignment period' USING ERRCODE='PY409'; END IF;
 PERFORM public.record_payroll_source_history(p_employee_id,'ASSIGNMENT',jsonb_build_array(jsonb_build_object('group_code',g,'employee_category',e.employee_category,'department',e.department,'effective_from',p_from,'effective_to',NULL,'employment_joined_on',e.joining_date)),p_reason,p_actor_id);
 RETURN public.get_hr_payroll_salary_context(p_employee_id,p_actor_id);
END; $$;

CREATE OR REPLACE FUNCTION public.save_hr_payroll_salary(p_employee_id uuid,p_existing_id uuid,p_from date,p_expected_version integer,p_pay jsonb,p_reason text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.hr_employees%ROWTYPE; h public.payroll_source_history_revisions%ROWTYPE; salary public.hr_permanent_pay_structures%ROWTYPE; intervals jsonb; last_from date; last_to date;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 PERFORM public.payroll_source_fence('employee:'||p_employee_id::text,false);
 SELECT * INTO e FROM public.hr_employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payroll_groups WHERE employee_category=e.employee_category AND is_permanent) THEN RAISE EXCEPTION 'Monthly salary setup requires a permanent employee category' USING ERRCODE='22023'; END IF;
 IF p_from IS NULL OR NOT isfinite(p_from) OR p_from<e.joining_date THEN RAISE EXCEPTION 'Salary date must be on or after the joining date' USING ERRCODE='22023'; END IF;
 IF p_from>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Future salary scheduling is not available yet; this save must not replace current salary early' USING ERRCODE='22023'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Salary setup reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO h FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1;
 IF p_expected_version IS NULL OR p_expected_version<>coalesce(h.version,0) THEN RAISE EXCEPTION 'Salary dates changed; reload before saving' USING ERRCODE='PY409'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_employee_coverage WHERE employee_id=p_employee_id AND period_to>=p_from) THEN RAISE EXCEPTION 'Salary change affects locked payroll; use an approved correction workflow' USING ERRCODE='PY409'; END IF;
 IF h.id IS NOT NULL THEN
  SELECT effective_from,effective_to INTO last_from,last_to FROM public.payroll_permanent_pay_applicability WHERE revision_id=h.id ORDER BY effective_from DESC LIMIT 1;
  IF p_existing_id IS NOT NULL THEN RAISE EXCEPTION 'Salary dates already exist; initialize only employees without dated salary history' USING ERRCODE='PY409'; END IF;
  IF last_from IS NULL OR p_from<=last_from OR (last_to IS NOT NULL AND p_from>last_to+1) THEN RAISE EXCEPTION 'New salary must follow existing coverage without gaps or replacing earlier segments' USING ERRCODE='22023'; END IF;
  IF extract(day FROM p_from)<>1 THEN RAISE EXCEPTION 'Salary revisions must start on the first of a month; mid-month salary changes are not supported' USING ERRCODE='22023'; END IF;
 END IF;
 IF h.id IS NULL AND extract(day FROM p_from)<>1 AND p_from<>e.joining_date THEN RAISE EXCEPTION 'Initial salary must start at joining or a month boundary' USING ERRCODE='22023'; END IF;
 IF p_existing_id IS NOT NULL THEN
  IF p_pay IS NOT NULL THEN RAISE EXCEPTION 'Choose an existing salary or new compensation terms, not both' USING ERRCODE='22023'; END IF;
  SELECT * INTO salary FROM public.hr_permanent_pay_structures WHERE id=p_existing_id AND employee_id=p_employee_id AND status IN ('Active','Superseded');
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an existing non-draft, non-suspended salary belonging to this employee' USING ERRCODE='22023'; END IF;
 ELSE
  IF h.id IS NULL AND EXISTS(SELECT 1 FROM public.hr_permanent_pay_structures WHERE employee_id=p_employee_id AND status IN ('Active','Suspended')) THEN RAISE EXCEPTION 'Confirm effective dates for the existing salary before creating another revision' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_pay) IS DISTINCT FROM 'object' OR NOT p_pay ?& ARRAY['pay_basis','guaranteed_monthly_gross','epf_enrolment','esi_enrolment'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_pay) k WHERE k NOT IN ('pay_basis','guaranteed_monthly_gross','epf_enrolment','esi_enrolment')) THEN RAISE EXCEPTION 'Invalid salary terms' USING ERRCODE='22023'; END IF;
  IF coalesce(p_pay->>'pay_basis','') NOT IN ('Monthly salary','Special package') OR coalesce(p_pay->>'guaranteed_monthly_gross','') !~ '^([0-9]+)([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Valid pay basis and nonnegative gross with at most two decimal places required' USING ERRCODE='22023'; END IF;
  IF (p_pay->>'guaranteed_monthly_gross')::numeric>99999999.99 THEN RAISE EXCEPTION 'Gross exceeds supported range' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_pay->'epf_enrolment')<>'boolean' OR jsonb_typeof(p_pay->'esi_enrolment')<>'boolean' THEN RAISE EXCEPTION 'Confirm enrolment facts' USING ERRCODE='22023'; END IF;
  SELECT * INTO salary FROM public.create_hr_pay_structure(p_employee_id,p_pay->>'pay_basis',(p_pay->>'guaranteed_monthly_gross')::numeric,(p_pay->>'epf_enrolment')::boolean,(p_pay->>'esi_enrolment')::boolean,'Active',p_actor_id);
 END IF;
 -- A new latest source revision includes every prior segment, closing only its final tail.
 SELECT coalesce(jsonb_agg(jsonb_build_object('pay_structure_id',pay_structure_id,'effective_from',effective_from,'effective_to',CASE WHEN effective_to IS NULL OR effective_to>=p_from THEN p_from-1 ELSE effective_to END) ORDER BY effective_from),'[]') INTO intervals FROM public.payroll_permanent_pay_applicability WHERE revision_id=h.id;
 intervals:=intervals||jsonb_build_array(jsonb_build_object('pay_structure_id',salary.id,'effective_from',p_from,'effective_to',NULL));
 PERFORM public.record_payroll_source_history(p_employee_id,'PERMANENT_PAY',intervals,p_reason,p_actor_id);
 RETURN jsonb_build_object('pay_structure_id',salary.id,'context',public.get_hr_payroll_salary_context(p_employee_id,p_actor_id),'enrolment_review_required',h.id IS NOT NULL);
END; $$;
REVOKE ALL ON FUNCTION public.get_hr_payroll_salary_context(uuid,uuid),public.initialize_hr_payroll_assignment(uuid,date,text,uuid),public.save_hr_payroll_salary(uuid,uuid,date,integer,jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_hr_payroll_salary_context(uuid,uuid),public.initialize_hr_payroll_assignment(uuid,date,text,uuid),public.save_hr_payroll_salary(uuid,uuid,date,integer,jsonb,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
