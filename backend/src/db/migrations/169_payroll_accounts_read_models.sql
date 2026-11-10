-- Bounded salary workspace reads and exact totals on the existing Accounts lists.
CREATE INDEX acct_payroll_source_row ON public.acct_requisition_line_items(payroll_row_id) WHERE payroll_row_id IS NOT NULL;
DROP FUNCTION public.get_payroll_accounts_sheet(uuid,uuid);
CREATE FUNCTION public.get_payroll_accounts_sheet(p_sheet_id uuid,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE s public.acct_requisition_sheets; result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','ho','admin']);
 IF p_page IS NULL OR p_limit IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid salary page' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.acct_requisition_sheets WHERE id=p_sheet_id;
 IF s.payroll_run_id IS NULL THEN RAISE EXCEPTION 'Payroll Accounts sheet not found' USING ERRCODE='P0002'; END IF;
 WITH items AS MATERIALIZED(SELECT i.*,d.id delivery_id,d.version delivery_version,d.disposition,d.active,e.employee_name,e.employee_code,e.id employee_id,d.beneficiary_id,d.period_from,d.period_to,d.calculation_snapshot salary
  FROM public.acct_requisition_line_items i JOIN public.payroll_accounts_deliveries d ON d.item_id=i.id JOIN public.hr_employees e ON e.id=d.employee_id WHERE i.sheet_id=s.id),
 page AS(SELECT * FROM items ORDER BY employee_name,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('sheet',to_jsonb(s),'run',(SELECT to_jsonb(r) FROM public.payroll_runs r WHERE id=s.payroll_run_id),'total',(SELECT count(*) FROM items),
 'summary',(SELECT jsonb_build_object('total_net',coalesce(sum((salary->>'final_net_salary')::numeric) FILTER(WHERE active),0)::numeric(18,2)::text,'active',count(*) FILTER(WHERE active),'approved',count(*) FILTER(WHERE disposition='APPROVED'),'payment_missing',count(*) FILTER(WHERE active AND (salary->>'final_net_salary')::numeric>0 AND (beneficiary_ac_no IS NULL OR debit_bank_ac_type IS NULL OR payment_mode IS NULL))) FROM items),
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('req_amount',p.req_amount::text,'ho_pass_amount',p.ho_pass_amount::text,'source_stale',NOT public.payroll_accounts_source_current(p.delivery_id,p_actor_id),'payment',(SELECT to_jsonb(pc)||jsonb_build_object('amount',pc.amount::text) FROM public.payroll_payment_confirmations pc WHERE pc.delivery_id=p.delivery_id)) ORDER BY p.employee_name,p.id) FROM page p),'[]')) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_payroll_accounts_sheet(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_accounts_sheet(uuid,uuid,integer,integer) TO service_role;
CREATE FUNCTION public.get_payroll_accounts_summaries(p_sheet_ids uuid[],p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','ho','admin']);
 IF p_sheet_ids IS NULL OR cardinality(p_sheet_ids)>100 THEN RAISE EXCEPTION 'Invalid sheet selection' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_object_agg(x.id::text,to_jsonb(x)-'id'),'{}') INTO result FROM (
  SELECT s.id,r.department,r.group_code,r.period_from,r.period_to,count(d.id) item_count,coalesce(sum((d.calculation_snapshot->>'final_net_salary')::numeric) FILTER(WHERE d.active),0)::numeric(18,2)::text total_req_amount
  FROM public.acct_requisition_sheets s JOIN public.payroll_runs r ON r.id=s.payroll_run_id LEFT JOIN public.acct_requisition_line_items i ON i.sheet_id=s.id LEFT JOIN public.payroll_accounts_deliveries d ON d.item_id=i.id
  WHERE s.id=ANY(p_sheet_ids) GROUP BY s.id,r.id
 ) x;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_payroll_accounts_summaries(uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_accounts_summaries(uuid[],uuid) TO service_role;
DO $patch$ DECLARE def text; signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['get_accounts_import_queue(integer,integer,character varying,character varying,character varying,character varying,character varying,timestamp with time zone,timestamp with time zone)','get_accounts_import_queue_export(character varying,character varying,character varying,character varying,character varying,timestamp with time zone,timestamp with time zone)'] LOOP
  SELECT pg_get_functiondef(('public.'||signature)::regprocedure) INTO def;
  def:=replace(def,'WHERE li.imported_to_sheet_id IS NULL','WHERE li.payroll_row_id IS NULL AND li.imported_to_sheet_id IS NULL');EXECUTE def;
 END LOOP;
END $patch$;
