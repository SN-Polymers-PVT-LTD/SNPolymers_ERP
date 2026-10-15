-- A verified zero-earnings salary is valid; recording does not issue money.
-- Honor the existing composite allocation ownership constraint.
CREATE OR REPLACE FUNCTION public.payroll_finalize_employee(p_row_id uuid,p_calc jsonb,p_source jsonb,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; x jsonb; m public.payroll_employee_month_entitlements%ROWTYPE; a public.payroll_adjustments%ROWTYPE;
 prior_employee numeric; prior_employer numeric; outstanding numeric; month_collected numeric; earnings numeric; deductions numeric; base numeric; lop numeric; cutoff jsonb;
BEGIN
 IF NOT public.payroll_financial_enabled() THEN RAISE EXCEPTION 'Financial finalization is disabled' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 cutoff:=p_source->'financial_context'->'cutoff';
 IF cutoff->>'status' IS DISTINCT FROM 'APPROVED' OR (cutoff->>'cutoff_at')::timestamptz>public.payroll_financial_clock() OR (cutoff->>'cutoff_at')::timestamptz<(e.period_to+1)::timestamp AT TIME ZONE 'Asia/Kolkata' THEN RAISE EXCEPTION 'Approved cutoff must be reached before locking' USING ERRCODE='PY409'; END IF;
 IF p_calc->>'financial_readiness' IS DISTINCT FROM 'true' OR p_calc->>'status' IS DISTINCT FROM 'READY_FOR_REVIEW' OR p_calc->'blockers' IS DISTINCT FROM '[]'::jsonb OR p_calc->>'final_net_salary' IS NULL THEN RAISE EXCEPTION 'Complete financial readiness required' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum((v->>'amount')::numeric),0) INTO earnings FROM jsonb_array_elements(p_calc->'earnings') v;
 SELECT coalesce(sum((v->>'amount')::numeric),0) INTO deductions FROM jsonb_array_elements(p_calc->'deductions') v;
 IF earnings IS DISTINCT FROM (p_calc->>'earnings_total')::numeric OR deductions IS DISTINCT FROM (p_calc->>'deductions_total')::numeric OR earnings<0 OR deductions<0 OR earnings-deductions<0 OR round(earnings-deductions,2) IS DISTINCT FROM (p_calc->>'final_net_salary')::numeric THEN RAISE EXCEPTION 'Salary line reconciliation failed' USING ERRCODE='23514'; END IF;
 IF (SELECT coalesce(sum((v->>'amount')::numeric),0) FROM jsonb_array_elements(p_calc->'deductions') v WHERE v->>'code' IN ('EPF','ESI','PT')) IS DISTINCT FROM (SELECT sum((v->>'employee_amount')::numeric) FROM jsonb_array_elements(p_calc->'statutory_entries') v) THEN RAISE EXCEPTION 'Statutory deductions do not match monthly entries' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(p_calc->'statutory_entries')<>3*(12*(extract(year FROM e.period_to)-extract(year FROM e.period_from))+extract(month FROM e.period_to)-extract(month FROM e.period_from)+1) THEN RAISE EXCEPTION 'Every statutory scheme/month needs a verified entry' USING ERRCODE='23514'; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'statutory_entries') LOOP
  IF NOT EXISTS(SELECT 1 FROM public.payroll_employee_statutory_profiles p JOIN public.payroll_source_history_revisions h ON h.id=p.revision_id WHERE p.id=(x->>'source_profile_id')::uuid AND h.employee_id=e.employee_id AND p.scheme=x->>'scheme' AND p.statutory_scope_id=(x->>'statutory_scope_id')::uuid AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND ((p.applicability='APPLICABLE' AND x->>'rule_revision_id' IS NOT NULL) OR (p.applicability='NOT_APPLICABLE' AND x->>'rule_revision_id' IS NULL AND (x->>'employee_amount')::numeric=0 AND (x->>'employer_amount')::numeric=0))) THEN RAISE EXCEPTION 'Verified statutory profile required' USING ERRCODE='23514'; END IF;
  IF (x->>'salary_month')::date NOT BETWEEN date_trunc('month',e.period_from)::date AND date_trunc('month',e.period_to)::date THEN RAISE EXCEPTION 'Statutory contribution month mismatch' USING ERRCODE='23514'; END IF;
  IF x->>'rule_revision_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payroll_statutory_rule_revisions r JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=r.id WHERE r.id=(x->>'rule_revision_id')::uuid AND r.status='PUBLISHED' AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND r.scheme=x->>'scheme' AND b.statutory_scope_id=(x->>'statutory_scope_id')::uuid AND (x->>'salary_month')::date BETWEEN r.effective_from AND r.effective_to) THEN RAISE EXCEPTION 'Published applicable statutory revision required' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(employee_amount),0),coalesce(sum(employer_amount),0) INTO prior_employee,prior_employer FROM public.payroll_statutory_entries WHERE employee_id=e.employee_id AND scheme=x->>'scheme' AND contribution_month=(x->>'salary_month')::date;
  IF prior_employee IS DISTINCT FROM (x->>'previous_employee_collected')::numeric OR prior_employer IS DISTINCT FROM (x->>'previous_employer_accrued')::numeric OR (x->>'employee_amount')::numeric+prior_employee IS DISTINCT FROM (x->>'monthly_employee_liability')::numeric OR (x->>'employer_amount')::numeric+prior_employer IS DISTINCT FROM (x->>'monthly_employer_liability')::numeric THEN RAISE EXCEPTION 'Statutory month changed or failed reconciliation' USING ERRCODE='PY409'; END IF;
  IF (x->'eligible_wage'->>'numerator')::numeric<0 OR (x->'eligible_wage'->>'denominator')::numeric<=0 THEN RAISE EXCEPTION 'Invalid exact statutory wage' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'adjustment_applications') LOOP
  SELECT * INTO a FROM public.payroll_adjustments WHERE id=(x->>'adjustment_id')::uuid FOR UPDATE;
  IF NOT FOUND OR a.employee_id<>e.employee_id OR a.status<>'APPROVED' OR a.version<>(x->>'version')::integer OR a.approved_by IS NULL OR a.approved_by=a.created_by THEN RAISE EXCEPTION 'Approved adjustment changed' USING ERRCODE='PY409'; END IF;
  IF a.kind='ADVANCE' THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_calc->'deductions') v WHERE v->>'code'='ADVANCE_RECOVERY' AND v->'source_ids' @> jsonb_build_array(a.id) AND v->>'salary_month'=x->>'contribution_month' AND (v->>'amount')::numeric=(x->>'amount')::numeric) THEN RAISE EXCEPTION 'Recovery deduction/application mismatch' USING ERRCODE='23514'; END IF;
   SELECT a.amount-coalesce(sum(amount),0),coalesce(sum(amount) FILTER(WHERE contribution_month=(x->>'contribution_month')::date),0) INTO outstanding,month_collected FROM public.payroll_adjustment_applications WHERE adjustment_id=a.id;
   IF (x->>'amount')::numeric<=0 OR (x->>'amount')::numeric>outstanding OR (x->>'amount')::numeric+month_collected>a.installment OR (x->>'contribution_month')::date<a.recovery_start_month THEN RAISE EXCEPTION 'Advance balance or monthly recovery limit exceeded' USING ERRCODE='PY409'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_calc->'earnings') v WHERE v->>'code'=a.kind AND v->'source_ids' @> jsonb_build_array(a.id) AND (v->>'amount')::numeric=a.amount) OR a.target_row_id<>e.id OR (x->>'amount')::numeric<>a.amount OR EXISTS(SELECT 1 FROM public.payroll_adjustment_applications WHERE adjustment_id=a.id) THEN RAISE EXCEPTION 'Adjustment target mismatch or already applied' USING ERRCODE='PY409'; END IF;
 END LOOP;
 INSERT INTO public.payroll_financial_snapshots(row_id,employee_id,review_revision,source_fingerprint,source_token,source_snapshot,calculation_snapshot,earnings_total,deductions_total,net_salary,locked_by)
 VALUES(e.id,e.employee_id,e.review_revision,p_calc->>'source_fingerprint',encode(digest(p_source::text,'sha256'),'hex'),p_source,p_calc,earnings,deductions,(p_calc->>'final_net_salary')::numeric,p_actor_id);
 INSERT INTO public.payroll_employee_coverage(employee_id,salary_row_id,period_from,period_to,finalized_at) VALUES(e.employee_id,e.id,e.period_from,e.period_to,now());
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'monthly_reconciliation') LOOP
  SELECT (v->>'amount')::numeric INTO base FROM jsonb_array_elements(x->'allocations') v WHERE v->>'row_id'=e.id::text;
  SELECT coalesce(sum((v->>'amount')::numeric),0) INTO lop FROM jsonb_array_elements(p_calc->'deductions') v WHERE v->>'code'='LOP' AND v->>'salary_month'=x->>'salary_month';
  IF base IS NULL OR x->>'contractual_entitlement' IS NULL OR jsonb_array_length(x->'policy_revision_ids')<>1 OR x->>'unallocated_entitlement' IS DISTINCT FROM '0.00' THEN RAISE EXCEPTION 'Complete monthly salary plan required' USING ERRCODE='23514'; END IF;
  SELECT * INTO m FROM public.payroll_employee_month_entitlements WHERE employee_id=e.employee_id AND salary_month=(x->>'salary_month')::date FOR UPDATE;
  IF NOT FOUND THEN
   INSERT INTO public.payroll_employee_month_entitlements(employee_id,salary_month,policy_revision_id,source_segments,status,contractual_gross)
   VALUES(e.employee_id,(x->>'salary_month')::date,(x->'policy_revision_ids'->>0)::uuid,x->'allocations','FINALIZED',(x->>'contractual_entitlement')::numeric) RETURNING * INTO m;
  ELSIF m.status<>'FINALIZED' OR m.contractual_gross<>(x->>'contractual_entitlement')::numeric OR m.policy_revision_id<>(x->'policy_revision_ids'->>0)::uuid OR m.source_segments IS DISTINCT FROM x->'allocations' THEN RAISE EXCEPTION 'Frozen monthly entitlement or allocation plan changed' USING ERRCODE='PY409'; END IF;
  IF m.allocated_base+base>m.contractual_gross OR m.lop_amount+lop>m.contractual_gross THEN RAISE EXCEPTION 'Monthly entitlement exceeded' USING ERRCODE='23514'; END IF;
  INSERT INTO public.payroll_month_allocations(entitlement_id,salary_row_id,employee_id,base_amount,lop_amount) VALUES(m.id,e.id,e.employee_id,base,lop);
  UPDATE public.payroll_employee_month_entitlements SET allocated_base=allocated_base+base,lop_amount=lop_amount+lop,version=version+1 WHERE id=m.id;
 END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'statutory_entries') LOOP
  INSERT INTO public.payroll_statutory_entries(salary_row_id,employee_id,scheme,contribution_month,statutory_scope_id,rule_revision_id,eligible_wage,employee_amount,employer_amount,source_profile_id)
  VALUES(e.id,e.employee_id,x->>'scheme',(x->>'salary_month')::date,(x->>'statutory_scope_id')::uuid,(x->>'rule_revision_id')::uuid,x->'eligible_wage',(x->>'employee_amount')::numeric,(x->>'employer_amount')::numeric,(x->>'source_profile_id')::uuid);
 END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'adjustment_applications') LOOP
  INSERT INTO public.payroll_adjustment_applications(adjustment_id,salary_row_id,employee_id,contribution_month,amount) VALUES((x->>'adjustment_id')::uuid,e.id,e.employee_id,(x->>'contribution_month')::date,(x->>'amount')::numeric);
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_finalize_employee(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.payroll_action_history'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%action%' LOOP EXECUTE format('ALTER TABLE public.payroll_action_history DROP CONSTRAINT %I',c.conname); END LOOP; END; $$;
ALTER TABLE public.payroll_action_history ADD CHECK(action IN ('DRAFT_CREATED','DRAFT_VERSION_CREATED','CALCULATED','SUBMITTED','ACCOUNTS_FORWARDED','RETURNED','CORRECTED','CANCELLED_DRAFT','LOCK_BLOCKED','LOCKED'));

CREATE OR REPLACE FUNCTION public.create_payroll_adjustment(p_employee_id uuid,p_data jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE a public.payroll_employee_assignments%ROWTYPE; r public.payroll_adjustments%ROWTYPE; role text; target public.payroll_run_employees%ROWTYPE;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['factory_manager','accounts','ho','admin']);
 PERFORM 1 FROM public.hr_employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('kind','amount','effective_date','target_row_id','original_period_from','original_period_to','installment','recovery_start_month','evidence_reference'))
  OR coalesce(p_data->>'amount','') !~ '^-?[0-9]+(\.[0-9]{1,2})?$' OR public.payroll_check_decimal(to_jsonb(ltrim(p_data->>'amount','-')),999999999999) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid adjustment fields' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.payroll_employee_assignments WHERE employee_id=p_employee_id AND revision_id=(SELECT id FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='ASSIGNMENT' ORDER BY version DESC LIMIT 1)
  AND (p_data->>'effective_date')::date>=effective_from AND (effective_to IS NULL OR (p_data->>'effective_date')::date<=effective_to);
 IF NOT FOUND THEN RAISE EXCEPTION 'Current evidenced assignment required' USING ERRCODE='22023'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,a.department,false);
 IF p_data->>'kind'='ADVANCE' THEN PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']); END IF;
 IF p_data->>'kind'='ADVANCE' AND ((p_data->>'effective_date')::date>(now() AT TIME ZONE 'Asia/Kolkata')::date OR coalesce(p_data->>'installment','') !~ '^[0-9]+(\.[0-9]{1,2})?$') THEN RAISE EXCEPTION 'Record an already issued advance with a paise-precision recovery plan' USING ERRCODE='22023'; END IF;
 IF p_data->>'kind'<>'ADVANCE' THEN
  SELECT * INTO target FROM public.payroll_run_employees WHERE id=(p_data->>'target_row_id')::uuid AND employee_id=p_employee_id FOR UPDATE;
  IF NOT FOUND OR target.status IN ('LOCKED','CANCELLED_DRAFT') OR (p_data->>'effective_date')::date NOT BETWEEN target.period_from AND target.period_to THEN RAISE EXCEPTION 'Select an unlocked employee row covering the adjustment date' USING ERRCODE='22023'; END IF;
  PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=target.run_id),false);
 END IF;
 INSERT INTO public.payroll_adjustments(employee_id,assignment_id,target_row_id,kind,amount,effective_date,original_period_from,original_period_to,installment,recovery_start_month,evidence_reference,created_by)
 VALUES(p_employee_id,a.id,(p_data->>'target_row_id')::uuid,p_data->>'kind',(p_data->>'amount')::numeric,(p_data->>'effective_date')::date,(p_data->>'original_period_from')::date,(p_data->>'original_period_to')::date,(p_data->>'installment')::numeric,(p_data->>'recovery_start_month')::date,p_data->>'evidence_reference',p_actor_id) RETURNING * INTO r;
 INSERT INTO public.payroll_adjustment_events(adjustment_id,version,action,after_snapshot,reason,actor_id) VALUES(r.id,r.version,'CREATE',to_jsonb(r),r.evidence_reference,p_actor_id);
 RETURN public.payroll_preview_decimals(to_jsonb(r),ARRAY['amount','installment']);
END; $$;
NOTIFY pgrst,'reload schema';
