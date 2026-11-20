-- Open-ended statutory applicability is explicit NULL, never a fabricated end date.
ALTER TABLE public.payroll_statutory_rule_revisions ALTER COLUMN effective_to DROP NOT NULL;
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.payroll_statutory_rule_revisions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%published_effective_to%' LOOP EXECUTE format('ALTER TABLE public.payroll_statutory_rule_revisions DROP CONSTRAINT %I',c.conname); END LOOP; END; $$;
ALTER TABLE public.payroll_statutory_rule_revisions ADD CONSTRAINT payroll_statutory_publication_state CHECK(
 (status='DRAFT' AND published_by IS NULL AND published_at IS NULL AND revision_number IS NULL AND approval_reference IS NULL AND published_effective_to IS NULL)
 OR (status='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL AND revision_number>0 AND revision_number IS NOT NULL AND approval_reference IS NOT NULL AND length(btrim(approval_reference)) BETWEEN 1 AND 2000 AND verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
 AND (published_effective_to IS NULL OR (isfinite(published_effective_to) AND effective_to IS NOT NULL AND published_effective_to>=effective_to))));
ALTER TABLE public.payroll_work_calendar_days ADD CONSTRAINT payroll_calendar_named_entitlement CHECK((day_type<>'Paid Holiday' OR compensation_treatment<>'UNPAID') AND (day_type<>'Unpaid Closure' OR compensation_treatment<>'PAID')) NOT VALID;
CREATE OR REPLACE FUNCTION public.payroll_master_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE k text; d jsonb; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; blockers jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Master history cannot be deleted' USING ERRCODE='42501'; END IF;
 k:=CASE WHEN TG_TABLE_NAME='payroll_policy_master_revisions' THEN 'policies' ELSE 'statutory' END;
 IF TG_OP='UPDATE' AND OLD.status='PUBLISHED' THEN
  IF (to_jsonb(NEW)-'effective_to') IS DISTINCT FROM (to_jsonb(OLD)-'effective_to') OR NEW.effective_to IS NULL OR (OLD.effective_to IS NOT NULL AND NEW.effective_to>=OLD.effective_to) OR NEW.effective_to<today THEN
   RAISE EXCEPTION 'Published rules and historical applicability are immutable' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'Create a draft first' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1) THEN
  RAISE EXCEPTION 'Invalid draft revision version' USING ERRCODE='PY409'; END IF;
 d:=public.payroll_master_payload(k,to_jsonb(NEW)); blockers:=public.payroll_validate_master(k,d);
 IF TG_OP='INSERT' OR NEW.status='PUBLISHED' THEN
  PERFORM public.payroll_require_master_actor(k,CASE WHEN NEW.status='PUBLISHED' THEN NEW.published_by ELSE NEW.created_by END);
 END IF; -- Draft edits check the CURRENT writer in the RPC, not the historic creator's current role.
 IF NEW.status='PUBLISHED' THEN
  IF NEW.effective_from<=today OR extract(day FROM NEW.effective_from)<>1 THEN RAISE EXCEPTION 'Publication requires a future month start; mid-month semantics are unsupported' USING ERRCODE='22023'; END IF;
  IF k='statutory' AND (blockers<>'[]'::jsonb OR (to_jsonb(NEW)->>'verified_on')::date>today) THEN RAISE EXCEPTION 'Unverified, incomplete or unsupported statutory configuration' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.preview_payroll_master_publication(p_kind text,p_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t text; r jsonb; d jsonb; v_overlaps jsonb; conflicts jsonb:='[]'; blockers jsonb; changed jsonb; before_data jsonb; impact integer; item jsonb; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id); t:=public.payroll_master_table(p_kind);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1',t) INTO r USING p_id;
 IF r IS NULL THEN RAISE EXCEPTION 'Master revision not found' USING ERRCODE='P0002'; END IF;
 IF r->>'status'<>'DRAFT' THEN RAISE EXCEPTION 'Only drafts can be published' USING ERRCODE='PY409'; END IF;
 d:=public.payroll_master_payload(p_kind,r); blockers:=public.payroll_validate_master(p_kind,d);
 IF p_kind='policies' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.effective_from),'[]') INTO v_overlaps FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND group_code IS NOT DISTINCT FROM r->>'group_code' AND daterange(effective_from,effective_to,'[]') && daterange((r->>'effective_from')::date,(r->>'effective_to')::date,'[]');
 ELSE
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.effective_from),'[]') INTO v_overlaps FROM public.payroll_statutory_rule_revisions x WHERE status='PUBLISHED' AND scheme=r->>'scheme' AND jurisdiction=r->>'jurisdiction' AND establishment=r->>'establishment' AND daterange(effective_from,effective_to,'[]') && daterange((r->>'effective_from')::date,(r->>'effective_to')::date,'[]');
 END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(v_overlaps) LOOP
  -- Only replace the future tail of ONE predecessor. Never swallow a future
  -- revision, truncate history, or leave an unexplained gap at the tail.
  IF item->>'effective_from'>=r->>'effective_from' OR coalesce((item->>'effective_to')::date,'infinity'::date)>coalesce((r->>'effective_to')::date,'infinity'::date) OR jsonb_array_length(v_overlaps)>1 THEN conflicts:=conflicts||jsonb_build_array(item->>'id'); END IF;
 END LOOP;
 IF (r->>'effective_from')::date<=today OR extract(day FROM (r->>'effective_from')::date)<>1 THEN conflicts:=conflicts||'[{"code":"FUTURE_MONTH_START_REQUIRED"}]'; END IF;
 IF p_kind='statutory' AND (r->>'verified_on')::date>today THEN conflicts:=conflicts||'[{"code":"VERIFICATION_DATE_IN_FUTURE"}]'; END IF;
 before_data:=CASE WHEN jsonb_array_length(v_overlaps)>0 THEN public.payroll_master_payload(p_kind,v_overlaps->0) ELSE '{}'::jsonb END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('field',key,'before',before_data->key,'after',value)),'[]') INTO changed FROM jsonb_each(d) WHERE value IS DISTINCT FROM before_data->key;
 SELECT count(*) INTO impact FROM public.payroll_run_employees e JOIN public.payroll_runs run ON run.id=e.run_id JOIN public.payroll_groups g ON g.code=run.group_code
  WHERE daterange(e.period_from,e.period_to,'[]') && daterange((r->>'effective_from')::date,(r->>'effective_to')::date,'[]') AND (p_kind='statutory' OR (g.is_permanent AND (r->>'group_code' IS NULL OR run.group_code=r->>'group_code')));
 RETURN jsonb_build_object('revision',r,'blockers',CASE WHEN p_kind='policies' THEN '[]'::jsonb ELSE blockers END,'configuration_warnings',public.payroll_master_configuration_warnings(p_kind,d),'conflicts',conflicts,'supersedes',v_overlaps,'diff',changed,
  'affected_draft_rows',impact,'impact_scope',CASE WHEN p_kind='statutory' THEN 'ALL_DRAFT_ROWS_IN_RANGE; EMPLOYEE_JURISDICTION_NOT_YET_MODELED' ELSE 'GROUP_AND_DATE_RANGE' END,
  'publishable',conflicts='[]'::jsonb AND (p_kind='policies' OR blockers='[]'::jsonb),
  'preview_token',md5(d::text||v_overlaps::text||impact::text||today::text),'financial_workflows_enabled',false);
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_payroll_master(p_kind text,p_scope jsonb,p_date date,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE candidates jsonb; r jsonb; scope_id uuid; d jsonb; warnings jsonb; BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id); PERFORM public.payroll_master_table(p_kind);
 IF p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION 'Date required' USING ERRCODE='22023'; END IF;
 IF p_kind='policies' THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=p_scope->>'group_code') THEN RAISE EXCEPTION 'Unknown payroll group' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=p_scope->>'group_code' AND NOT is_permanent) THEN RETURN jsonb_build_object('error','DAILY_WAGE_MASTER_REQUIRED','revision_id',NULL,'blockers','[{"code":"DAILY_WAGE_MASTER_REQUIRED"}]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND p_date>=effective_from AND (effective_to IS NULL OR p_date<=effective_to) AND group_code=p_scope->>'group_code';
  IF candidates='[]'::jsonb THEN SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND p_date>=effective_from AND (effective_to IS NULL OR p_date<=effective_to) AND group_code IS NULL; END IF;
 ELSE
  IF ((p_scope->>'statutory_scope_id') IS NULL AND (nullif(btrim(p_scope->>'jurisdiction'),'') IS NULL OR nullif(btrim(p_scope->>'establishment'),'') IS NULL)) OR coalesce(p_scope->>'scheme','') NOT IN ('EPF','ESI','PT') THEN RETURN jsonb_build_object('error','STATUTORY_SCOPE_REQUIRED','revision_id',NULL,'blockers','[{"code":"STATUTORY_SCOPE_REQUIRED"}]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_statutory_rule_revisions x WHERE status='PUBLISHED' AND verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND p_date>=effective_from AND (effective_to IS NULL OR p_date<=effective_to) AND scheme=p_scope->>'scheme' AND ((p_scope->>'statutory_scope_id' IS NOT NULL AND EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b WHERE b.revision_id=x.id AND b.statutory_scope_id=(p_scope->>'statutory_scope_id')::uuid)) OR (p_scope->>'statutory_scope_id' IS NULL AND jurisdiction=p_scope->>'jurisdiction' AND establishment=p_scope->>'establishment'));
 END IF;
 IF jsonb_array_length(candidates)<>1 THEN RETURN jsonb_build_object('error',CASE WHEN candidates='[]'::jsonb THEN 'MISSING_POLICY' ELSE 'AMBIGUOUS_POLICY' END,'revision_id',NULL,'blockers',jsonb_build_array(jsonb_build_object('code',CASE WHEN candidates='[]'::jsonb THEN 'MISSING_POLICY' ELSE 'AMBIGUOUS_POLICY' END))); END IF;
 r:=candidates->0; d:=public.payroll_master_payload(p_kind,r);
 SELECT statutory_scope_id INTO scope_id FROM public.payroll_statutory_scope_bindings WHERE revision_id=(r->>'id')::uuid;
 warnings:=public.payroll_master_configuration_warnings(p_kind,d);
 IF p_kind='statutory' AND scope_id IS NULL THEN warnings:=warnings||'[{"field":"statutory_scope_id","code":"CANONICAL_SCOPE_REQUIRED"}]'::jsonb; END IF;
 RETURN jsonb_build_object('kind',p_kind,'revision_id',r->'id','revision',r,'data',d,'statutory_scope_id',scope_id,
  'configuration_warnings',warnings,'blockers',CASE WHEN p_kind='policies' THEN '[]'::jsonb ELSE public.payroll_validate_master(p_kind,d) END,'financial_workflows_enabled',false);
END; $$;

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
  IF x->>'rule_revision_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payroll_statutory_rule_revisions r JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=r.id WHERE r.id=(x->>'rule_revision_id')::uuid AND r.status='PUBLISHED' AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND r.scheme=x->>'scheme' AND b.statutory_scope_id=(x->>'statutory_scope_id')::uuid AND (x->>'salary_month')::date>=r.effective_from AND (r.effective_to IS NULL OR (x->>'salary_month')::date<=r.effective_to)) THEN RAISE EXCEPTION 'Published applicable statutory revision required' USING ERRCODE='23514'; END IF;
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

NOTIFY pgrst,'reload schema';
