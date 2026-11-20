-- Keep paused adjustments in storage and historical payroll snapshots.
CREATE OR REPLACE FUNCTION public.payroll_master_configuration_warnings(p_kind text,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE warnings jsonb; k text;
BEGIN
 warnings:=public.payroll_validate_master(p_kind,d);
 IF p_kind='statutory' THEN
  FOREACH k IN ARRAY ARRAY['REIMBURSEMENT','RECOVERY'] LOOP
   IF coalesce(d->'configuration'->'adjustment_basis'->>k,'UNRESOLVED')='UNRESOLVED' THEN
    warnings:=warnings||jsonb_build_array(jsonb_build_object('field','adjustment_basis.'||k,'code','ADJUSTMENT_CLASSIFICATION_REQUIRED'));
   END IF;
  END LOOP;
 END IF;
 RETURN warnings;
END; $$;

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
 WITH page AS (SELECT * FROM public.payroll_adjustments WHERE employee_id=p_employee_id AND kind='ADVANCE' ORDER BY created_at DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(x),ARRAY['amount','installment'])||jsonb_build_object('recovered_amount',CASE WHEN x.kind='ADVANCE' THEN (SELECT coalesce(sum(amount),0)::text FROM public.payroll_adjustment_applications WHERE adjustment_id=x.id) END,'outstanding_balance',CASE WHEN x.kind='ADVANCE' THEN (x.amount-(SELECT coalesce(sum(amount),0) FROM public.payroll_adjustment_applications WHERE adjustment_id=x.id))::text END,'history',(SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('before_snapshot',CASE WHEN e.before_snapshot IS NOT NULL THEN public.payroll_preview_decimals(e.before_snapshot,ARRAY['amount','installment']) END,'after_snapshot',public.payroll_preview_decimals(e.after_snapshot,ARRAY['amount','installment'])) ORDER BY version) FROM public.payroll_adjustment_events e WHERE e.adjustment_id=x.id)) ORDER BY created_at DESC,id) FROM page x),'[]'),
  'total',(SELECT count(*) FROM public.payroll_adjustments WHERE employee_id=p_employee_id AND kind='ADVANCE'),'page',p_page,'limit',p_limit,'payments_enabled',false) INTO result;
 RETURN result;
END; $$;
