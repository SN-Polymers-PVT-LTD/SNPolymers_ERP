-- Shared statutory setup: one explicit template, initial employee profiles only.
-- Rates remain in published masters; existing timelines/exceptions are untouched.
CREATE FUNCTION public.get_payroll_statutory_setup_candidates(p_actor_id uuid,p_search text DEFAULT '',
 p_department text DEFAULT NULL,p_category text DEFAULT NULL,p_unconfigured_only boolean DEFAULT true,
 p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 IF p_search IS NULL OR length(p_search)>120 OR p_unconfigured_only IS NULL OR p_page IS NULL OR p_limit IS NULL
  OR p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid bulk employee selection' USING ERRCODE='22023';
 END IF;
 WITH versions AS (SELECT employee_id,max(version) version FROM public.payroll_source_history_revisions WHERE source_kind='STATUTORY_PROFILE' GROUP BY employee_id),
 pay AS (SELECT DISTINCT ON(employee_id) employee_id,epf_enrolment,esi_enrolment FROM public.hr_permanent_pay_structures WHERE status='Active' ORDER BY employee_id,revision_number DESC),
 matching AS (SELECT e.id,e.employee_code,e.employee_name,e.employee_category,e.department,e.joining_date,
  coalesce(v.version,0) profile_version,p.epf_enrolment,p.esi_enrolment
  FROM public.hr_employees e LEFT JOIN versions v ON v.employee_id=e.id LEFT JOIN pay p ON p.employee_id=e.id
  WHERE e.active_status='Active' AND strpos(lower(e.employee_name||' '||e.employee_code),lower(p_search))>0
   AND (p_department IS NULL OR e.department=p_department) AND (p_category IS NULL OR e.employee_category=p_category)),
 selected AS (SELECT * FROM matching WHERE NOT p_unconfigured_only OR profile_version=0),
 page AS (SELECT * FROM selected ORDER BY employee_name,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('employees',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY employee_name,id) FROM page e),'[]'),
  'total',(SELECT count(*) FROM selected),'eligible_total',(SELECT count(*) FROM matching WHERE profile_version=0),'page',p_page,'limit',p_limit) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer) TO service_role;

CREATE FUNCTION public.bulk_record_payroll_statutory_profiles(p_employees jsonb,p_interval jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE item jsonb; employee public.hr_employees%ROWTYPE; profile jsonb; saved jsonb; results jsonb:='[]';
 start_date date; end_date date; code text; detail text; status_code integer;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 IF p_employees IS NULL OR jsonb_typeof(p_employees)<>'array' OR jsonb_array_length(p_employees) NOT BETWEEN 1 AND 100
  OR p_interval IS NULL OR jsonb_typeof(p_interval)<>'object' OR p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 2000 THEN
  RAISE EXCEPTION 'Supply 1–100 selected employees, a common interval and evidence' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x WHERE jsonb_typeof(x)<>'object'
  OR NOT x ? 'employee_id' OR NOT x ? 'expected_version' OR x->'expected_version'<>'0'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('employee_id','expected_version')))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x GROUP BY x->>'employee_id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Bulk setup accepts unique employees with no existing profile (expected version 0)' USING ERRCODE='22023';
 END IF;
 start_date:=(p_interval->>'effective_from')::date;end_date:=(p_interval->>'effective_to')::date;
 IF start_date IS NULL OR NOT isfinite(start_date) OR (end_date IS NOT NULL AND (NOT isfinite(end_date) OR end_date<start_date)) THEN
  RAISE EXCEPTION 'Invalid common effective interval' USING ERRCODE='22023';
 END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_employees) ORDER BY value->>'employee_id' LOOP
  BEGIN
   SELECT * INTO employee FROM public.hr_employees WHERE id=(item->>'employee_id')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
   IF employee.active_status<>'Active' THEN RAISE EXCEPTION 'Employee is no longer active; refresh selection' USING ERRCODE='PY409'; END IF;
   IF end_date IS NOT NULL AND employee.joining_date>end_date THEN
    RAISE EXCEPTION 'Employee joined after the selected interval' USING ERRCODE='22023';
   END IF;
   profile:=jsonb_set(p_interval,'{effective_from}',to_jsonb(greatest(start_date,employee.joining_date)::text));
   IF EXISTS(SELECT 1 FROM public.hr_permanent_pay_structures pay WHERE pay.employee_id=employee.id AND pay.status='Active'
    AND (pay.epf_enrolment IS DISTINCT FROM (profile->'schemes'->'EPF'->>'enrolled')::boolean
      OR pay.esi_enrolment IS DISTINCT FROM (profile->'schemes'->'ESI'->>'enrolled')::boolean)) THEN
    RAISE EXCEPTION 'Common enrolment conflicts with employee pay setup; record an individual exception' USING ERRCODE='22023';
   END IF;
   -- Reuse the audited, version-checked, canonical-scope-checked write path.
   saved:=public.record_payroll_statutory_profiles(employee.id,0,jsonb_build_array(profile),p_evidence,p_actor_id);
   results:=results||jsonb_build_array(jsonb_build_object('employee_id',employee.id,'success',true,'status',201,'effective_from',profile->>'effective_from','result',saved));
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,detail=MESSAGE_TEXT;
   status_code:=CASE WHEN code='42501' THEN 403 WHEN code='P0002' THEN 404 WHEN code IN ('PY409','23505','23P01','40P01','40001') THEN 409
    WHEN code IN ('22023','22P02','23503','23514','23502','22007','22008') THEN 400 ELSE 500 END;
   results:=results||jsonb_build_array(jsonb_build_object('employee_id',item->>'employee_id','success',false,'status',status_code,'code',code,
    'message',CASE WHEN status_code=500 THEN 'Employee profile setup failed' ELSE detail END));
  END;
 END LOOP;
 RETURN jsonb_build_object('results',results,'success',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(results) r WHERE r->>'success'='false'));
END; $$;
REVOKE ALL ON FUNCTION public.bulk_record_payroll_statutory_profiles(jsonb,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_record_payroll_statutory_profiles(jsonb,jsonb,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
