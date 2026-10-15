-- Snapshot reporting and ledger integrity; payment workflows remain out of scope.
ALTER TABLE public.payroll_employee_month_entitlements ALTER COLUMN contractual_gross TYPE numeric(18,6),ALTER COLUMN allocated_base TYPE numeric(18,6),ALTER COLUMN lop_amount TYPE numeric(18,6);
ALTER TABLE public.payroll_month_allocations ALTER COLUMN base_amount TYPE numeric(18,6),ALTER COLUMN lop_amount TYPE numeric(18,6);
ALTER TABLE public.payroll_adjustments ADD CONSTRAINT payroll_adjustment_history_complete FOREIGN KEY(id,version) REFERENCES public.payroll_adjustment_events(adjustment_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION public.payroll_adjustment_head_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Employee adjustment records cannot be deleted' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'DRAFT' OR NEW.version<>1) THEN RAISE EXCEPTION 'New adjustments must start as drafts' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','version','approved_by','approved_at','installment','recovery_start_month']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','approved_by','approved_at','installment','recovery_start_month']) OR NEW.version<>OLD.version+1 OR (OLD.kind<>'ADVANCE' AND (NEW.installment IS DISTINCT FROM OLD.installment OR NEW.recovery_start_month IS DISTINCT FROM OLD.recovery_start_month))) THEN RAISE EXCEPTION 'Adjustment identity and amounts are immutable; append an approved plan action' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_adjustment_head_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payroll_adjustment_head_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_adjustments FOR EACH ROW EXECUTE FUNCTION public.payroll_adjustment_head_guard();
CREATE OR REPLACE FUNCTION public.get_payroll_adjustments(p_employee_id uuid,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; d text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['factory_manager','accounts','ho','admin']);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 -- Reclassification cannot hide the historical factory grant needed for a ledger row.
 SELECT department INTO d FROM public.hr_employees WHERE id=p_employee_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,d,false);
 FOR d IN SELECT DISTINCT a.department FROM public.payroll_adjustments x JOIN public.payroll_employee_assignments a ON a.id=x.assignment_id WHERE x.employee_id=p_employee_id LOOP PERFORM public.payroll_require_scope(p_actor_id,d,false); END LOOP;
 WITH page AS (SELECT * FROM public.payroll_adjustments WHERE employee_id=p_employee_id ORDER BY created_at DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(x),ARRAY['amount','installment'])||jsonb_build_object('recovered_amount',CASE WHEN x.kind='ADVANCE' THEN (SELECT coalesce(sum(amount),0)::text FROM public.payroll_adjustment_applications WHERE adjustment_id=x.id) END,'outstanding_balance',CASE WHEN x.kind='ADVANCE' THEN (x.amount-(SELECT coalesce(sum(amount),0) FROM public.payroll_adjustment_applications WHERE adjustment_id=x.id))::text END,'history',(SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('before_snapshot',CASE WHEN e.before_snapshot IS NOT NULL THEN public.payroll_preview_decimals(e.before_snapshot,ARRAY['amount','installment']) END,'after_snapshot',public.payroll_preview_decimals(e.after_snapshot,ARRAY['amount','installment'])) ORDER BY version) FROM public.payroll_adjustment_events e WHERE e.adjustment_id=x.id)) ORDER BY created_at DESC,id) FROM page x),'[]'),
  'total',(SELECT count(*) FROM public.payroll_adjustments WHERE employee_id=p_employee_id),'page',p_page,'limit',p_limit,'payments_enabled',false) INTO result;
 RETURN result;
END; $$;
-- Phase 5 reads immutable review evidence. No financial snapshot, posting or payment writes.
CREATE OR REPLACE FUNCTION public.get_payroll_salary_register(p_actor_id uuid,p_filters jsonb DEFAULT '{}'::jsonb,p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
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
   CASE WHEN e.status='LOCKED' THEN f.calculation_snapshot WHEN e.status<>'CANCELLED_DRAFT' AND v.content_version=e.current_version THEN v.calculation_snapshot END calc,
   CASE WHEN e.status='LOCKED' AND f.row_id IS NOT NULL THEN 'IMMUTABLE_LOCKED' WHEN e.status='LOCKED' THEN 'LOCKED_SNAPSHOT_UNAVAILABLE' WHEN e.status='CANCELLED_DRAFT' THEN 'WITHDRAWN'
    WHEN v.revision IS NULL THEN 'NO_CALCULATION' WHEN v.content_version<>e.current_version THEN 'SUPERSEDED_CONTENT' ELSE 'SAVED_DIAGNOSTIC' END evidence_status
  FROM public.payroll_run_employees e JOIN public.payroll_runs r ON r.id=e.run_id JOIN public.hr_employees h ON h.id=e.employee_id
   JOIN public.payroll_employee_assignments a ON a.id=e.assignment_id
   LEFT JOIN public.payroll_review_revisions v ON v.row_id=e.id AND v.revision=e.review_revision
   LEFT JOIN public.payroll_financial_snapshots f ON f.row_id=e.id
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
    THEN coalesce((SELECT sum((d->>'amount')::numeric) FROM jsonb_array_elements(calc->'deductions') d WHERE d->>'code'='LOP'),0.00) END lop,
   CASE WHEN calc->>'financial_readiness'='true' THEN (calc->>'final_net_salary')::numeric END net,
   CASE WHEN calc->>'financial_readiness'='true' THEN (calc->>'employee_statutory_total')::numeric END statutory_total,
   CASE WHEN calc->>'financial_readiness'='true' THEN (calc->>'employer_contributions_total')::numeric END employer_total
  FROM selected s
 ), page AS (SELECT * FROM amounts ORDER BY period_from DESC,employee_name,id LIMIT p_limit OFFSET (p_page-1)*p_limit),
 summaries AS (
  SELECT department,status,count(*) row_count,count(gross) gross_known_rows,
   sum(gross)::text known_gross_total,CASE WHEN count(gross)=count(*) THEN sum(gross)::text END gross_total,
   sum(lop)::text known_lop_total,sum(net)::text known_net_total,CASE WHEN count(net)=count(*) THEN sum(net)::text END net_total,sum(statutory_total)::text known_statutory_total,sum(employer_total)::text known_employer_total FROM amounts GROUP BY department,status
 )
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',id,'run_id',run_id,'employee_id',employee_id,'employee_name',employee_name,'employee_code',employee_code,'employee_category',employee_category,
  'department',department,'group_code',group_code,'cycle',cycle,'period_from',period_from,'period_to',period_to,'status',status,
  'current_version',current_version,'review_version',review_version,'revision',revision,'calculated_at',calculated_at,'source_fingerprint',source_fingerprint,
  'evidence_status',evidence_status,'source_freshness','NOT_REVALIDATED','earnings_total',earnings::text,'gross_after_lop',gross::text,'lop',lop::text,
  'epf',CASE WHEN net IS NOT NULL THEN coalesce((SELECT sum((x->>'employee_amount')::numeric)::text FROM jsonb_array_elements(calc->'statutory_entries') x WHERE x->>'scheme'='EPF'),'0.00') END,'esi',CASE WHEN net IS NOT NULL THEN coalesce((SELECT sum((x->>'employee_amount')::numeric)::text FROM jsonb_array_elements(calc->'statutory_entries') x WHERE x->>'scheme'='ESI'),'0.00') END,'pt',CASE WHEN net IS NOT NULL THEN coalesce((SELECT sum((x->>'employee_amount')::numeric)::text FROM jsonb_array_elements(calc->'statutory_entries') x WHERE x->>'scheme'='PT'),'0.00') END,'net_salary',net::text,'employer_contributions',employer_total::text,'statutory_status',CASE WHEN net IS NOT NULL THEN 'CALCULATED_NOT_SETTLED' ELSE 'UNRESOLVED' END,'payment_status',CASE WHEN status='LOCKED' AND net=0 THEN 'NOT_REQUIRED' WHEN status='LOCKED' THEN 'NOT_RECORDED' ELSE 'NOT_ELIGIBLE' END,'statutory_settlement_status','NOT_POSTED',
  'last_return_reason',last_return_reason,'calculation_status',calc->>'status','blockers',coalesce(calc->'blockers','[]'),
  'earnings',coalesce(calc->'earnings','[]'),'deductions',coalesce(calc->'deductions','[]'),'source_references',calc->'source_references',
  'monthly_reconciliation',coalesce(calc->'monthly_reconciliation','[]')) ORDER BY period_from DESC,employee_name,id) FROM page),'[]'),
  'total',(SELECT count(*) FROM amounts),'page',p_page,'limit',p_limit,
  'summaries',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY department,status) FROM summaries s),'[]'),
  'filters',p_filters,'generated_at',statement_timestamp(),'amount_basis','PER_ROW_EVIDENCE_STATUS',
  'financial_finalization_enabled',false,'official_payslips_enabled',false,'payment_status','NOT_ELIGIBLE') INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_payroll_salary_register(uuid,jsonb,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_salary_register(uuid,jsonb,integer,integer) TO service_role;
CREATE FUNCTION public.get_payroll_official_payslip(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE role text; e public.payroll_run_employees%ROWTYPE; f public.payroll_financial_snapshots%ROWTYPE; own boolean; d text;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager','je','zo']);
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Salary row not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(erp_user_id=p_actor_id,false) INTO own FROM public.hr_employees WHERE id=e.employee_id;
 IF NOT own THEN
  IF role NOT IN ('admin','accounts','ho') THEN RAISE EXCEPTION 'Official payslip access is not approved for this role' USING ERRCODE='42501'; END IF;
  PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=e.run_id),false);
 END IF;
 SELECT * INTO f FROM public.payroll_financial_snapshots WHERE row_id=e.id;
 IF e.status<>'LOCKED' OR NOT FOUND THEN RAISE EXCEPTION 'Official payslips require an immutable Locked salary snapshot' USING ERRCODE='PY409'; END IF;
 IF NOT own THEN FOR d IN SELECT DISTINCT x->>'department' FROM jsonb_array_elements(coalesce(f.source_snapshot->'assignments','[]')||coalesce(f.source_snapshot->'attendance','[]')) x WHERE x->>'department' IS NOT NULL LOOP PERFORM public.payroll_require_scope(p_actor_id,d,false); END LOOP; END IF;
 RETURN jsonb_build_object('kind','OFFICIAL','official',true,'watermark','LOCKED SALARY — PAYMENT STATUS SEPARATE','row_id',e.id,'review_status','LOCKED','payment_status',CASE WHEN f.net_salary=0 THEN 'NOT_REQUIRED' ELSE 'NOT_RECORDED' END,'statutory_settlement_status','NOT_POSTED','revision',f.review_revision,'content_version',e.current_version,'locked_at',f.locked_at,'source_freshness','IMMUTABLE_LOCKED','department',(SELECT department FROM public.payroll_runs WHERE id=e.run_id),'group_code',(SELECT group_code FROM public.payroll_runs WHERE id=e.run_id),'calculation',f.calculation_snapshot);
END; $$;
REVOKE ALL ON FUNCTION public.get_payroll_official_payslip(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_official_payslip(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
