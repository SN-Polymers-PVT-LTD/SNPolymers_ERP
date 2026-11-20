-- Null-safe optimistic concurrency and salary-specific hold/return semantics.
DO $patch$ DECLARE def text; signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['deliver_payroll_to_accounts(uuid,integer,integer,text,uuid,boolean)','save_payroll_payment_details(uuid,integer,text,text,uuid,text,text,uuid)','act_payroll_accounts_item(uuid,integer,text,text,jsonb,jsonb,uuid)','resubmit_payroll_payment(uuid,integer,uuid)'] LOOP
  SELECT pg_get_functiondef(('public.'||signature)::regprocedure) INTO def;
  def:=replace(def,'d.version<>p_expected_version','d.version IS DISTINCT FROM p_expected_version');
  def:=replace(def,'e.current_version<>p_expected_version OR e.review_version<>p_expected_review_version','e.current_version IS DISTINCT FROM p_expected_version OR e.review_version IS DISTINCT FROM p_expected_review_version');
  def:=replace(def,$old$IF p_action NOT IN ('Approve','ReturnSalary','ReturnPayment','Hold')$old$,$new$IF p_action IS NULL OR p_action NOT IN ('Approve','ReturnSalary','ReturnPayment','Hold')$new$);EXECUTE def;
 END LOOP;
 SELECT pg_get_functiondef('public.sync_acct_sheet_review_status()'::regprocedure) INTO def;
 def:=replace(def,'BEGIN',$new$BEGIN
 IF EXISTS(SELECT 1 FROM public.acct_requisition_sheets WHERE id=NEW.sheet_id AND payroll_run_id IS NOT NULL) THEN RETURN NEW; END IF;$new$);EXECUTE def;
END $patch$;
CREATE FUNCTION public.payroll_pending_source_current(p_row uuid,p_source jsonb,p_actor uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions AS $$
BEGIN
 RETURN public.payroll_accounts_salary_source(p_source) IS NOT DISTINCT FROM public.payroll_accounts_salary_source(public.payroll_review_source_snapshot(p_row,p_actor));
EXCEPTION WHEN invalid_parameter_value THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.payroll_pending_source_current(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_payroll_accounts_cutover(p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']);
 IF p_page IS NULL OR p_limit IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid conversion selection' USING ERRCODE='22023'; END IF;
 WITH candidates AS MATERIALIZED (
 SELECT e.id,e.current_version,e.review_version,e.status,e.run_id,e.period_from,e.period_to,e.employee_id,r.department,r.group_code,h.employee_name,h.employee_code,v.source_fingerprint,v.source_snapshot,v.calculation_snapshot->>'financial_readiness'='true' ready
 FROM public.payroll_run_employees e JOIN public.payroll_runs r ON r.id=e.run_id JOIN public.hr_employees h ON h.id=e.employee_id LEFT JOIN public.payroll_review_revisions v ON v.row_id=e.id AND v.revision=e.review_revision
 WHERE r.status='DRAFT' AND e.status IN ('PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL') AND NOT EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries d WHERE d.row_id=e.id AND d.active)
 ), page AS MATERIALIZED(SELECT * FROM candidates ORDER BY period_from,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg((to_jsonb(p)-ARRAY['source_snapshot','ready'])||jsonb_build_object('eligible',coalesce(p.ready AND public.payroll_pending_source_current(p.id,p.source_snapshot,p_actor_id)
 AND NOT EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries dl WHERE dl.active AND dl.employee_id=p.employee_id AND daterange(dl.period_from,dl.period_to,'[]')&&daterange(p.period_from,p.period_to,'[]'))
 AND NOT EXISTS(SELECT 1 FROM public.payroll_employee_coverage c WHERE c.employee_id=p.employee_id AND daterange(c.period_from,c.period_to,'[]')&&daterange(p.period_from,p.period_to,'[]')),false)) ORDER BY p.period_from,p.id) FROM page p),'[]'),'total',(SELECT count(*) FROM candidates)) INTO result;
 RETURN result;
END $$;
