-- Phase 5 reads immutable review evidence. No financial snapshot, posting or payment writes.
CREATE FUNCTION public.get_payroll_salary_register(p_actor_id uuid,p_filters jsonb DEFAULT '{}'::jsonb,p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE context jsonb; role_name text; result jsonb; from_date date; to_date date;
BEGIN
 role_name:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_scope:'||p_actor_id::text,0));
 context:=public.get_payroll_foundation_context(p_actor_id);
 IF p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000
  OR EXISTS(SELECT 1 FROM jsonb_each(p_filters) x WHERE x.key NOT IN ('run_id','department','group_code','status','from','to','search') OR jsonb_typeof(x.value)<>'string')
  OR length(coalesce(p_filters->>'search',''))>120 THEN
  RAISE EXCEPTION 'Invalid salary register selection' USING ERRCODE='22023'; END IF;
 IF p_filters ? 'status' AND p_filters->>'status' NOT IN ('DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED') THEN
  RAISE EXCEPTION 'Invalid review status' USING ERRCODE='22023'; END IF;
 from_date:=(p_filters->>'from')::date; to_date:=(p_filters->>'to')::date;
 IF (from_date IS NOT NULL AND NOT isfinite(from_date)) OR (to_date IS NOT NULL AND NOT isfinite(to_date)) OR from_date>to_date THEN
  RAISE EXCEPTION 'Invalid reporting interval' USING ERRCODE='22023'; END IF;
 IF p_filters ? 'department' THEN PERFORM public.payroll_require_scope(p_actor_id,p_filters->>'department',false); END IF;
 IF p_filters ? 'run_id' THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_runs WHERE id=(p_filters->>'run_id')::uuid) THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=(p_filters->>'run_id')::uuid),false);
 END IF;
 -- Scope and data selection share one snapshot. Saved cross-factory evidence is
 -- omitted if any of its departments is outside the FM's current grants.
 WITH scoped AS MATERIALIZED (
  SELECT e.*,r.department,r.group_code,r.cycle,a.employee_category,
   coalesce(v.calculation_snapshot->'employee'->>'employee_name',h.employee_name) employee_name,
   coalesce(v.calculation_snapshot->'employee'->>'employee_code',h.employee_code) employee_code,
   v.revision,v.content_version,v.source_fingerprint,v.created_at calculated_at,
   CASE WHEN e.status NOT IN ('LOCKED','CANCELLED_DRAFT') AND v.content_version=e.current_version THEN v.calculation_snapshot END calc,
   CASE WHEN e.status='LOCKED' THEN 'LOCKED_SNAPSHOT_UNAVAILABLE' WHEN e.status='CANCELLED_DRAFT' THEN 'WITHDRAWN'
    WHEN v.revision IS NULL THEN 'NO_CALCULATION' WHEN v.content_version<>e.current_version THEN 'SUPERSEDED_CONTENT' ELSE 'SAVED_DIAGNOSTIC' END evidence_status
  FROM public.payroll_run_employees e JOIN public.payroll_runs r ON r.id=e.run_id JOIN public.hr_employees h ON h.id=e.employee_id
   JOIN public.payroll_employee_assignments a ON a.id=e.assignment_id
   LEFT JOIN public.payroll_review_revisions v ON v.row_id=e.id AND v.revision=e.review_revision
  WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(context->'groups') g WHERE g->>'code'=r.group_code AND g->>'department'=r.department)
   AND (role_name<>'factory_manager' OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(coalesce(v.source_snapshot->'assignments','[]')||coalesce(v.source_snapshot->'attendance','[]')) x
    WHERE x->>'department' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'groups') g WHERE g->>'department'=x->>'department')))
   AND (NOT p_filters ? 'run_id' OR e.run_id=(p_filters->>'run_id')::uuid)
   AND (NOT p_filters ? 'department' OR r.department=p_filters->>'department')
   AND (NOT p_filters ? 'group_code' OR r.group_code=p_filters->>'group_code')
   AND (NOT p_filters ? 'status' OR e.status=p_filters->>'status')
   AND (from_date IS NULL OR e.period_to>=from_date) AND (to_date IS NULL OR e.period_from<=to_date)
 ), selected AS MATERIALIZED (
  SELECT * FROM scoped WHERE strpos(lower(employee_name||' '||employee_code),lower(coalesce(p_filters->>'search','')))>0
 ), amounts AS MATERIALIZED (
  SELECT s.*,
   CASE WHEN calc->>'known_earnings_total' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (calc->>'known_earnings_total')::numeric END earnings,
   CASE WHEN calc->>'gross_after_lop' ~ '^[0-9]+(\.[0-9]+)?$' THEN (calc->>'gross_after_lop')::numeric END gross,
   CASE WHEN calc->>'gross_after_lop' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(calc->'deductions') d WHERE d->>'code'='LOP' AND (d->>'amount' IS NULL OR d->>'amount' !~ '^[0-9]+(\.[0-9]+)?$'))
    THEN coalesce((SELECT sum((d->>'amount')::numeric) FROM jsonb_array_elements(calc->'deductions') d WHERE d->>'code'='LOP'),0.00) END lop
  FROM selected s
 ), page AS (SELECT * FROM amounts ORDER BY period_from DESC,employee_name,id LIMIT p_limit OFFSET (p_page-1)*p_limit),
 summaries AS (
  SELECT department,status,count(*) row_count,count(gross) gross_known_rows,
   sum(gross)::text known_gross_total,CASE WHEN count(gross)=count(*) THEN sum(gross)::text END gross_total,
   sum(lop)::text known_lop_total FROM amounts GROUP BY department,status
 )
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',id,'run_id',run_id,'employee_id',employee_id,'employee_name',employee_name,'employee_code',employee_code,'employee_category',employee_category,
  'department',department,'group_code',group_code,'cycle',cycle,'period_from',period_from,'period_to',period_to,'status',status,
  'current_version',current_version,'review_version',review_version,'revision',revision,'calculated_at',calculated_at,'source_fingerprint',source_fingerprint,
  'evidence_status',evidence_status,'source_freshness','NOT_REVALIDATED','earnings_total',earnings::text,'gross_after_lop',gross::text,'lop',lop::text,
  'epf',NULL,'esi',NULL,'pt',NULL,'net_salary',NULL,'statutory_status','UNRESOLVED','payment_status','NOT_ELIGIBLE',
  'last_return_reason',last_return_reason,'calculation_status',calc->>'status','blockers',coalesce(calc->'blockers','[]'),
  'earnings',coalesce(calc->'earnings','[]'),'deductions',coalesce(calc->'deductions','[]'),'source_references',calc->'source_references',
  'monthly_reconciliation',coalesce(calc->'monthly_reconciliation','[]')) ORDER BY period_from DESC,employee_name,id) FROM page),'[]'),
  'total',(SELECT count(*) FROM amounts),'page',p_page,'limit',p_limit,
  'summaries',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY department,status) FROM summaries s),'[]'),
  'filters',p_filters,'generated_at',statement_timestamp(),'amount_basis','SAVED_DIAGNOSTIC_NOT_LIABILITY',
  'financial_finalization_enabled',false,'official_payslips_enabled',false,'payment_status','NOT_ELIGIBLE') INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_payroll_salary_register(uuid,jsonb,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_salary_register(uuid,jsonb,integer,integer) TO service_role;
