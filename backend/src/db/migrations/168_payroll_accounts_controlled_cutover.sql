-- Read-only inventory plus an explicit, idempotent conversion entry point.
-- Deployment never changes existing pending business records automatically.
CREATE FUNCTION public.get_payroll_accounts_cutover(p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']);
 IF p_page IS NULL OR p_limit IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid conversion selection' USING ERRCODE='22023'; END IF;
 WITH candidates AS MATERIALIZED (
 SELECT e.id,e.current_version,e.review_version,e.status,e.run_id,e.period_from,e.period_to,e.employee_id,r.department,r.group_code,h.employee_name,h.employee_code,v.source_fingerprint,
  (v.calculation_snapshot->>'financial_readiness'='true' AND public.payroll_accounts_salary_source(v.source_snapshot) IS NOT DISTINCT FROM public.payroll_accounts_salary_source(public.payroll_review_source_snapshot(e.id,p_actor_id))
  AND NOT EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries dl WHERE dl.active AND dl.employee_id=e.employee_id AND daterange(dl.period_from,dl.period_to,'[]')&&daterange(e.period_from,e.period_to,'[]'))
  AND NOT EXISTS(SELECT 1 FROM public.payroll_employee_coverage c WHERE c.employee_id=e.employee_id AND daterange(c.period_from,c.period_to,'[]')&&daterange(e.period_from,e.period_to,'[]'))) AS eligible
 FROM public.payroll_run_employees e JOIN public.payroll_runs r ON r.id=e.run_id JOIN public.hr_employees h ON h.id=e.employee_id LEFT JOIN public.payroll_review_revisions v ON v.row_id=e.id AND v.revision=e.review_revision
 WHERE r.status='DRAFT' AND e.status IN ('PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL') AND NOT EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries d WHERE d.row_id=e.id AND d.active)
 ), page AS(SELECT * FROM candidates ORDER BY period_from,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY period_from,id) FROM page p),'[]'),'total',(SELECT count(*) FROM candidates)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_payroll_accounts_cutover(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_accounts_cutover(uuid,integer,integer) TO service_role;
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.deliver_payroll_to_accounts(uuid,integer,integer,text,uuid,boolean)'::regprocedure) INTO def;
 def:=replace(def,'v.source_snapshot,v.calculation_snapshot,p_actor_id,(SELECT beneficiary_id',$new$v.source_snapshot,v.calculation_snapshot,CASE WHEN p_migrate THEN e.submitted_by ELSE p_actor_id END,(SELECT beneficiary_id$new$);EXECUTE def;
END $patch$;
