-- Support setup_status filter (needs_setup, has_setup, all) and return accurate server totals across matching employees.
CREATE OR REPLACE FUNCTION public.get_payroll_statutory_setup_candidates(p_actor_id uuid,p_search text DEFAULT '',
 p_department text DEFAULT NULL,p_category text DEFAULT NULL,p_unconfigured_only boolean DEFAULT true,
 p_page integer DEFAULT 1,p_limit integer DEFAULT 20,p_status text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; v_status text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 IF p_search IS NULL OR length(p_search)>120 OR p_unconfigured_only IS NULL OR p_page IS NULL OR p_limit IS NULL
  OR p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 100
  OR (p_status IS NOT NULL AND p_status NOT IN ('needs_setup','has_setup','all')) THEN
  RAISE EXCEPTION 'Invalid bulk employee selection' USING ERRCODE='22023';
 END IF;
 v_status:=coalesce(p_status,CASE WHEN p_unconfigured_only THEN 'needs_setup' ELSE 'all' END);
 WITH versions AS (SELECT employee_id,max(version) version FROM public.payroll_source_history_revisions WHERE source_kind='STATUTORY_PROFILE' GROUP BY employee_id),
 pay AS (SELECT DISTINCT ON(employee_id) employee_id,epf_enrolment,esi_enrolment FROM public.hr_permanent_pay_structures WHERE status='Active' ORDER BY employee_id,revision_number DESC),
 matching AS (SELECT e.id,e.employee_code,e.employee_name,e.employee_category,e.department,e.joining_date,
  coalesce(v.version,0) profile_version,p.epf_enrolment,p.esi_enrolment
  FROM public.hr_employees e LEFT JOIN versions v ON v.employee_id=e.id LEFT JOIN pay p ON p.employee_id=e.id
  WHERE e.active_status='Active' AND strpos(lower(e.employee_name||' '||e.employee_code),lower(p_search))>0
   AND (p_department IS NULL OR e.department=p_department) AND (p_category IS NULL OR e.employee_category=p_category)),
 selected AS (SELECT * FROM matching WHERE
  CASE v_status
   WHEN 'needs_setup' THEN (profile_version=0 AND employee_category<>'Local Daily-Wage Workers')
   WHEN 'has_setup' THEN (profile_version>0 OR employee_category='Local Daily-Wage Workers')
   ELSE true
  END),
 page AS (SELECT * FROM selected ORDER BY employee_name,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object(
  'employees',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY employee_name,id) FROM page e),'[]'),
  'total',(SELECT count(*) FROM selected),
  'eligible_total',(SELECT count(*) FROM matching WHERE profile_version=0 AND employee_category<>'Local Daily-Wage Workers'),
  'needs_setup_total',(SELECT count(*) FROM matching WHERE profile_version=0 AND employee_category<>'Local Daily-Wage Workers'),
  'has_setup_total',(SELECT count(*) FROM matching WHERE profile_version>0 OR employee_category='Local Daily-Wage Workers'),
  'all_total',(SELECT count(*) FROM matching),
  'page',p_page,
  'limit',p_limit
 ) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer,text) TO service_role;
