-- Confirmed category rules: Casual/Local have no EPF/ESI; only Local daily wagers have no PT.
-- Historical profiles and financial snapshots remain immutable.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.payroll_employee_statutory_profiles'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%statutory_scope_id%' LOOP
  EXECUTE format('ALTER TABLE public.payroll_employee_statutory_profiles DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE public.payroll_employee_statutory_profiles ADD CONSTRAINT %I %s',c.conname,replace(c.d,'statutory_scope_id IS NOT NULL','(applicability = ''NOT_APPLICABLE'' OR statutory_scope_id IS NOT NULL)'));
 END LOOP;
END; $$;
CREATE OR REPLACE FUNCTION public.record_payroll_statutory_profiles(p_employee_id uuid,p_expected_version integer,p_intervals jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE current_version integer; rid uuid; item jsonb; s text; detail jsonb;
 category text; pay public.hr_permanent_pay_structures%ROWTYPE; pay_revision uuid; from_date date; to_date date;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 SELECT employee_category INTO category FROM public.hr_employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(max(version),0) INTO current_version FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='STATUTORY_PROFILE';
 IF p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'Expected profile version required' USING ERRCODE='22023'; END IF;
 IF p_expected_version<>current_version THEN RAISE EXCEPTION 'Statutory profile history changed; reload before correcting' USING ERRCODE='PY409'; END IF;
 IF jsonb_typeof(p_intervals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_intervals) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Supply a complete profile timeline of 1 to 100 intervals' USING ERRCODE='22023'; END IF;
 INSERT INTO public.payroll_source_history_revisions(employee_id,source_kind,version,evidence_reference,created_by)
 VALUES(p_employee_id,'STATUTORY_PROFILE',current_version+1,p_evidence,p_actor_id) RETURNING id INTO rid;
 FOR item IN SELECT * FROM jsonb_array_elements(p_intervals) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('effective_from','effective_to','verification_status','advisor_name','verification_reference','verified_on','schemes'))
   OR jsonb_typeof(item->'schemes') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item->'schemes'))<>3
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(item->'schemes') k WHERE k NOT IN ('EPF','ESI','PT')) THEN RAISE EXCEPTION 'Invalid statutory profile interval' USING ERRCODE='22023'; END IF;
  -- Permanent/office enrolment is owned by Employee Management, never a second editable source.
  IF category IN ('HO Staff','Fabric Factory Permanent Employees','SNP Permanent Factory Labour','Zonal Office','Junior Engineer','Local project supervisor','Head office','Projects Department Employees') THEN
   from_date:=(item->>'effective_from')::date;to_date:=(item->>'effective_to')::date;
   SELECT id INTO pay_revision FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1;
   IF pay_revision IS NOT NULL THEN
    SELECT p.* INTO pay FROM public.payroll_permanent_pay_applicability a JOIN public.hr_permanent_pay_structures p ON p.id=a.pay_structure_id
     WHERE a.revision_id=pay_revision AND from_date BETWEEN a.effective_from AND a.effective_to AND p.status<>'Draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee Management pay source does not cover profile start date' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.payroll_permanent_pay_applicability a JOIN public.hr_permanent_pay_structures p ON p.id=a.pay_structure_id
     WHERE a.revision_id=pay_revision AND daterange(a.effective_from,a.effective_to,'[]') && daterange(from_date,to_date,'[]')
      AND (p.epf_enrolment,p.esi_enrolment) IS DISTINCT FROM (pay.epf_enrolment,pay.esi_enrolment)) THEN
     RAISE EXCEPTION 'Pay-structure enrolment changes within interval; split the statutory interval at the change' USING ERRCODE='22023';
    END IF;
   ELSE
    SELECT * INTO pay FROM public.hr_permanent_pay_structures WHERE employee_id=p_employee_id AND status='Active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Configure Employee Management pay structure before statutory setup' USING ERRCODE='22023'; END IF;
   END IF;
   item:=jsonb_set(jsonb_set(item,'{schemes,EPF,enrolled}',to_jsonb(pay.epf_enrolment)),'{schemes,ESI,enrolled}',to_jsonb(pay.esi_enrolment));
  END IF;
  FOREACH s IN ARRAY ARRAY['EPF','ESI','PT'] LOOP
   item:=jsonb_set(item,ARRAY['schemes',s,'applicability'],to_jsonb(CASE
    WHEN s='PT' AND category<>'Local Daily-Wage Workers' THEN 'APPLICABLE'
    WHEN s='EPF' AND pay.epf_enrolment IS TRUE THEN 'APPLICABLE'
    WHEN s='ESI' AND pay.esi_enrolment IS TRUE THEN 'APPLICABLE' ELSE 'NOT_APPLICABLE' END));
   IF s<>'PT' AND category NOT IN ('HO Staff','Fabric Factory Permanent Employees','SNP Permanent Factory Labour','Zonal Office','Junior Engineer','Local project supervisor','Head office','Projects Department Employees') THEN
    item:=jsonb_set(item,ARRAY['schemes',s,'enrolled'],'false'::jsonb);
   END IF;
   IF item->'schemes'->s->>'applicability'='NOT_APPLICABLE' THEN item:=jsonb_set(item,ARRAY['schemes',s,'statutory_scope_id'],'null'::jsonb); END IF;
  END LOOP;
  IF (item->>'verified_on')::date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Verification cannot be future dated' USING ERRCODE='22023'; END IF;
  FOREACH s IN ARRAY ARRAY['EPF','ESI','PT'] LOOP
   detail:=item->'schemes'->s;
   IF jsonb_typeof(detail) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(detail) k WHERE k NOT IN ('statutory_scope_id','applicability','enrolled','basis_reference'))
    OR jsonb_typeof(detail->'enrolled') IS NULL OR jsonb_typeof(detail->'enrolled') NOT IN ('boolean','null') THEN RAISE EXCEPTION 'Invalid scheme profile' USING ERRCODE='22023'; END IF;
   INSERT INTO public.payroll_employee_statutory_profiles(revision_id,employee_id,scheme,statutory_scope_id,effective_from,effective_to,applicability,enrolled,basis_reference,verification_status,advisor_name,verification_reference,verified_on)
   VALUES(rid,p_employee_id,s,(detail->>'statutory_scope_id')::uuid,(item->>'effective_from')::date,(item->>'effective_to')::date,detail->>'applicability',(detail->>'enrolled')::boolean,detail->>'basis_reference',item->>'verification_status',item->>'advisor_name',item->>'verification_reference',(item->>'verified_on')::date);
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('revision_id',rid,'version',current_version+1,'financial_workflows_enabled',false);
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_statutory_profiles(p_employee_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 IF NOT EXISTS(SELECT 1 FROM public.hr_employees WHERE id=p_employee_id) THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 WITH intervals AS (
  SELECT revision_id,effective_from,effective_to,verification_status,advisor_name,verification_reference,verified_on,
   jsonb_object_agg(scheme,jsonb_build_object('statutory_scope_id',statutory_scope_id,'applicability',applicability,'enrolled',enrolled,'basis_reference',basis_reference)) schemes
  FROM public.payroll_employee_statutory_profiles WHERE employee_id=p_employee_id
  GROUP BY revision_id,effective_from,effective_to,verification_status,advisor_name,verification_reference,verified_on
 ) SELECT jsonb_build_object('employee_id',p_employee_id,'version',coalesce(max(h.version),0),
  'revisions',coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('intervals',(SELECT jsonb_agg(to_jsonb(i)-'revision_id' ORDER BY effective_from) FROM intervals i WHERE i.revision_id=h.id)) ORDER BY h.version),'[]'),
  'employee_category',(SELECT employee_category FROM public.hr_employees WHERE id=p_employee_id),'enrolment_managed_by_pay_structure',(SELECT employee_category IN ('HO Staff','Fabric Factory Permanent Employees','SNP Permanent Factory Labour','Zonal Office','Junior Engineer','Local project supervisor','Head office','Projects Department Employees') FROM public.hr_employees WHERE id=p_employee_id),'financial_workflows_enabled',false) INTO result FROM public.payroll_source_history_revisions h WHERE h.employee_id=p_employee_id AND h.source_kind='STATUTORY_PROFILE';
 RETURN result;
END; $$;

CREATE FUNCTION public.payroll_category_scheme_applies(p_row_id uuid,p_scheme text,p_month date) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 SELECT CASE WHEN p_scheme='PT' THEN a.employee_category<>'Local Daily-Wage Workers'
 WHEN a.employee_category IN ('SNP Casual Factory Labour','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers') THEN false
 ELSE coalesce((SELECT bool_or(CASE WHEN p_scheme='EPF' THEN p.epf_enrolment ELSE p.esi_enrolment END)
  FROM public.payroll_permanent_pay_applicability ap JOIN public.hr_permanent_pay_structures p ON p.id=ap.pay_structure_id
  WHERE ap.revision_id=(SELECT id FROM public.payroll_source_history_revisions WHERE employee_id=e.employee_id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1)
  AND ap.effective_from<=least(e.period_to,(p_month+interval '1 month -1 day')::date) AND ap.effective_to>=greatest(e.period_from,p_month)),true) END
 FROM public.payroll_run_employees e JOIN public.payroll_employee_assignments a ON a.id=e.assignment_id WHERE e.id=p_row_id;
$$;
REVOKE ALL ON FUNCTION public.payroll_category_scheme_applies(uuid,text,date) FROM PUBLIC,anon,authenticated,service_role;
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
 IF (SELECT coalesce(sum((v->>'amount')::numeric),0) FROM jsonb_array_elements(p_calc->'deductions') v WHERE v->>'code' IN ('EPF','ESI','PT')) IS DISTINCT FROM (SELECT coalesce(sum((v->>'employee_amount')::numeric),0) FROM jsonb_array_elements(p_calc->'statutory_entries') v) THEN RAISE EXCEPTION 'Statutory deductions do not match monthly entries' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM generate_series(date_trunc('month',e.period_from),date_trunc('month',e.period_to),interval '1 month') months(month_date) CROSS JOIN (VALUES('EPF'),('ESI'),('PT')) s(scheme)
  WHERE (SELECT count(*) FROM jsonb_array_elements(p_calc->'statutory_entries') entry WHERE entry->>'scheme'=s.scheme AND (entry->>'salary_month')::date=month_date::date)
   <> CASE WHEN public.payroll_category_scheme_applies(e.id,s.scheme,month_date::date) THEN 1 ELSE 0 END) THEN
  RAISE EXCEPTION 'Statutory entries must follow employee category and pay enrolment' USING ERRCODE='23514';
 END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'statutory_entries') LOOP
  IF NOT public.payroll_category_scheme_applies(e.id,x->>'scheme',(x->>'salary_month')::date) OR x->>'scheme' NOT IN ('EPF','ESI','PT') OR x->>'rule_revision_id' IS NULL THEN RAISE EXCEPTION 'Excluded schemes cannot post and applicable schemes require a published rule' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payroll_employee_statutory_profiles p JOIN public.payroll_source_history_revisions h ON h.id=p.revision_id WHERE p.id=(x->>'source_profile_id')::uuid AND h.employee_id=e.employee_id AND p.scheme=x->>'scheme' AND p.statutory_scope_id=(x->>'statutory_scope_id')::uuid AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND x->>'rule_revision_id' IS NOT NULL) THEN RAISE EXCEPTION 'Verified statutory profile required' USING ERRCODE='23514'; END IF;
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
CREATE OR REPLACE FUNCTION public.get_payroll_preview_sources(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; r public.payroll_runs%ROWTYPE; permanent boolean; lo date; hi date; result jsonb;
BEGIN
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id;
 IF r.status<>'DRAFT' THEN RAISE EXCEPTION 'Payroll sheet has been deleted' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,false);
 SELECT is_permanent INTO permanent FROM public.payroll_groups WHERE code=r.group_code;
 lo:=CASE WHEN permanent THEN date_trunc('month',e.period_from)::date ELSE e.period_from END;
 hi:=CASE WHEN permanent THEN (date_trunc('month',e.period_to)+interval '1 month - 1 day')::date ELSE e.period_to END;
 IF hi-lo>731 THEN RAISE EXCEPTION 'Preview at most 24 months at a time' USING ERRCODE='22023'; END IF;
 -- One SQL statement provides one MVCC snapshot of all calculation inputs.
 WITH target AS (SELECT * FROM public.payroll_run_employees WHERE id=p_row_id),
 history AS (SELECT DISTINCT ON(source_kind) * FROM public.payroll_source_history_revisions WHERE employee_id=e.employee_id AND source_kind IN ('ASSIGNMENT','PERMANENT_PAY') ORDER BY source_kind,version DESC),
 assignments AS (SELECT a.* FROM public.payroll_employee_assignments a JOIN history h ON h.id=a.revision_id WHERE daterange(a.effective_from,a.effective_to,'[]') && daterange(lo,hi,'[]')),
 pay AS (SELECT a.* FROM public.payroll_permanent_pay_applicability a JOIN history h ON h.id=a.revision_id WHERE daterange(a.effective_from,a.effective_to,'[]') && daterange(lo,hi,'[]')),
 attendance AS (SELECT a.*,s.attendance_date,s.employee_category,s.department,s.status AS sheet_status,s.locked_at
  FROM public.hr_attendance_rows a JOIN public.hr_attendance_sheets s ON s.id=a.sheet_id
  WHERE a.employee_id=e.employee_id AND s.attendance_date BETWEEN lo-1 AND hi),
 profile_history AS (SELECT id,version FROM public.payroll_source_history_revisions WHERE employee_id=e.employee_id AND source_kind='STATUTORY_PROFILE' ORDER BY version DESC LIMIT 1),
 profiles AS (SELECT p.id,p.revision_id,p.scheme,p.statutory_scope_id,p.effective_from,p.effective_to,p.applicability,p.enrolled,p.verification_status
  FROM public.payroll_employee_statutory_profiles p JOIN profile_history h ON h.id=p.revision_id WHERE daterange(p.effective_from,p.effective_to,'[]') && daterange(date_trunc('month',lo)::date,hi,'[]')),
 rule_links AS (SELECT DISTINCT s.id,s.scheme,b.statutory_scope_id,s.effective_from,s.effective_to,s.revision_number
  FROM public.payroll_statutory_rule_revisions s JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=s.id JOIN profiles p ON p.scheme=s.scheme AND p.statutory_scope_id=b.statutory_scope_id
  WHERE s.status='PUBLISHED' AND s.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
   AND daterange(s.effective_from,s.effective_to,'[]') && daterange(date_trunc('month',greatest(lo,p.effective_from))::date,(date_trunc('month',least(hi,p.effective_to))+interval '1 month - 1 day')::date,'[]')),
 scope_checks AS MATERIALIZED (
  -- Authorize departments from THIS snapshot, not an earlier history read.
  SELECT public.payroll_require_scope(p_actor_id,d.department,false) AS checked
  FROM (SELECT department FROM assignments UNION SELECT department FROM attendance WHERE department IS NOT NULL) d
 )
 SELECT jsonb_build_object(
  'row',(SELECT to_jsonb(t) FROM target t),'run',to_jsonb(r),'is_permanent',permanent,'source_from',lo,'source_to',hi,
  'employee',(SELECT jsonb_build_object('id',id,'employee_code',employee_code,'employee_name',employee_name) FROM public.hr_employees WHERE id=e.employee_id),
  'beneficiary',(SELECT CASE WHEN b.id IS NULL THEN jsonb_build_object('status','MISSING') ELSE jsonb_build_object(
   'status',CASE WHEN bank.is_active AND b.account_number ~ '^[0-9]{9,18}$' AND b.ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$' AND length(btrim(b.beneficiary_name))>0 THEN 'RECORDED' ELSE 'INCOMPLETE' END,
   'id',b.id,'beneficiary_name',b.beneficiary_name,'masked_account_number','****'||right(b.account_number,4),'ifsc',b.ifsc,'bank_id',bank.id,'bank_name',bank.bank_name,
   'details_fingerprint',encode(digest(jsonb_build_array(b.id,b.account_number,b.ifsc,b.beneficiary_name,bank.id,bank.bank_name,bank.is_active)::text,'sha256'),'hex')) END
   FROM public.hr_employees employee LEFT JOIN public.beneficiary_master b ON b.id=employee.beneficiary_id LEFT JOIN public.indian_bank_master bank ON bank.id=b.beneficiary_bank_id WHERE employee.id=e.employee_id),
  'draft_snapshot',(SELECT source_snapshot FROM public.payroll_row_versions v JOIN target t ON t.id=v.row_id AND t.current_version=v.version),
  'history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY source_kind) FROM history h),'[]'),
  'assignments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY effective_from,id) FROM assignments a),'[]'),
  'pay_applicability',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY effective_from,id) FROM pay a),'[]'),
  'pay_structures',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(p),ARRAY['guaranteed_monthly_gross','basic_salary','staff_welfare','other_fixed_components']) ORDER BY p.id) FROM public.hr_permanent_pay_structures p WHERE p.id IN (SELECT pay_structure_id FROM pay)),'[]'),
  'attendance',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a),ARRAY['actual_hours','ot_hours']) ORDER BY attendance_date,id) FROM attendance a),'[]'),
  'wages',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(w),ARRAY['daily_wage']) ORDER BY employee_category,effective_from,id) FROM public.hr_factory_wage_revisions w WHERE w.effective_from<=hi AND w.employee_category IN (SELECT employee_category FROM assignments)),'[]'),
  'factory_rules',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(w),ARRAY['standard_duty_hours','ot_rate','ot_multiplier','holiday_multiplier','double_duty_multiplier']) ORDER BY employee_category,effective_from,id) FROM public.hr_factory_pay_rule_revisions w WHERE w.effective_from<=hi AND w.employee_category IN (SELECT employee_category FROM assignments)),'[]'),
  'leave',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'employee_id',l.employee_id,'employee_category',l.employee_category,'from_date',l.from_date,'to_date',l.to_date,'leave_type',l.leave_type,'approval_status',l.approval_status,'pay_treatment',l.pay_treatment,'decided_by',l.decided_by,'decided_at',l.decided_at,'updated_at',l.updated_at) ORDER BY from_date,id) FROM public.hr_leave_requests l WHERE l.employee_id=e.employee_id AND daterange(l.from_date,l.to_date,'[]') && daterange(lo,hi,'[]')),'[]'),
  'policies',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(p),ARRAY['lop_fixed_divisor','partial_month_fixed_divisor'])||jsonb_build_object('data',public.payroll_master_payload('policies',to_jsonb(p))) ORDER BY effective_from,id) FROM public.payroll_policy_master_revisions p WHERE p.status='PUBLISHED' AND daterange(p.effective_from,p.effective_to,'[]') && daterange(date_trunc('month',lo)::date,hi,'[]') AND (p.group_code IS NULL OR p.group_code IN (SELECT group_code FROM assignments))),'[]'),
  'calendar',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY calendar_date,id) FROM public.payroll_work_calendar_days c WHERE c.calendar_date BETWEEN lo AND hi AND c.group_code=r.group_code AND c.department=r.department),'[]'),
  'month_rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'group_code',g.code,'is_permanent',g.is_permanent,'period_from',x.period_from,'period_to',x.period_to,'version',x.current_version,'status',x.status) ORDER BY x.period_from,x.id) FROM public.payroll_run_employees x JOIN public.payroll_runs y ON y.id=x.run_id JOIN public.payroll_groups g ON g.code=y.group_code WHERE x.employee_id=e.employee_id AND daterange(x.period_from,x.period_to,'[]') && daterange(lo,hi,'[]')),'[]'),
  'entitlements',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(m),ARRAY['contractual_gross','allocated_base','lop_amount']) ORDER BY salary_month,id) FROM public.payroll_employee_month_entitlements m WHERE m.employee_id=e.employee_id AND m.salary_month BETWEEN date_trunc('month',lo)::date AND hi),'[]'),
  'coverage',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY period_from,id) FROM public.payroll_employee_coverage c WHERE c.employee_id=e.employee_id AND daterange(c.period_from,c.period_to,'[]') && daterange(lo,hi,'[]')),'[]'),
  -- Full rule payloads and private advisor/profile evidence remain absent.
  -- Only applicable, canonical published rule IDs are added below for diagnostics.
  'statutory_rules','[]'::jsonb,
  'financial_context',jsonb_build_object('activation_enabled',public.payroll_financial_enabled(),'cutoff',(SELECT jsonb_build_object('version',version,'status',status,'cutoff_at',cutoff_at,'proposed_by',proposed_by,'approved_by',approved_by) FROM public.payroll_period_cutoffs WHERE run_id=r.id ORDER BY version DESC LIMIT 1)),
  'statutory_calculation_rules',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'scheme',s.scheme,'statutory_scope_id',b.statutory_scope_id,'effective_from',s.effective_from,'effective_to',s.effective_to,'configuration',s.configuration,
   'slabs',CASE WHEN s.scheme='PT' THEN public.payroll_master_payload('statutory',to_jsonb(s))->'slabs' ELSE '[]'::jsonb END))
   FROM public.payroll_statutory_rule_revisions s JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=s.id
   WHERE s.status='PUBLISHED' AND s.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND s.effective_from<=hi AND s.effective_to>=date_trunc('month',lo)::date
    AND EXISTS(SELECT 1 FROM profiles p WHERE p.scheme=s.scheme AND p.statutory_scope_id=b.statutory_scope_id AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'))),'[]'),
  'statutory_entries',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(t),ARRAY['employee_amount','employer_amount']) ORDER BY contribution_month,scheme,salary_row_id) FROM public.payroll_statutory_entries t WHERE t.employee_id=e.employee_id AND contribution_month BETWEEN date_trunc('month',lo)::date AND hi),'[]'),
  'adjustments',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a)-ARRAY['evidence_reference'],ARRAY['amount','installment']) ORDER BY effective_date,id) FROM public.payroll_adjustments a WHERE a.employee_id=e.employee_id AND (a.target_row_id=e.id OR a.kind='ADVANCE') AND a.effective_date<=hi),'[]'),
  'adjustment_applications',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a),ARRAY['amount']) ORDER BY contribution_month,salary_row_id,adjustment_id) FROM public.payroll_adjustment_applications a WHERE a.employee_id=e.employee_id),'[]'),
  'month_allocations',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a),ARRAY['base_amount','lop_amount']) ORDER BY entitlement_id,salary_row_id) FROM public.payroll_month_allocations a JOIN public.payroll_employee_month_entitlements m ON m.id=a.entitlement_id WHERE m.employee_id=e.employee_id AND m.salary_month BETWEEN date_trunc('month',lo)::date AND hi),'[]'),
  'statutory_profile',NULL,'financial_workflows_enabled',false
 )||CASE WHEN EXISTS(SELECT 1 FROM profile_history) THEN jsonb_build_object(
  'statutory_profile_history',(SELECT to_jsonb(h) FROM profile_history h),
  'statutory_profiles',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY scheme,effective_from,id) FROM profiles p),'[]'),
  'statutory_rule_links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY scheme,effective_from,id) FROM rule_links l),'[]'),
  'statutory_profile',(SELECT jsonb_build_object('verified',bool_and(verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')),'effective_from',max(effective_from),'effective_to',min(effective_to)) FROM profiles WHERE effective_from<=lo AND (effective_to IS NULL OR effective_to>=hi) HAVING count(*)=3)
 ) ELSE '{}'::jsonb END INTO result FROM (SELECT count(*) FROM scope_checks) authorized_scopes;
 RETURN result;
END; $$;
NOTIFY pgrst,'reload schema';
CREATE FUNCTION public.payroll_guard_category_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE category text;
BEGIN
 SELECT employee_category INTO category FROM public.hr_employees WHERE id=NEW.employee_id;
 IF NEW.scheme='PT' AND NEW.applicability IS DISTINCT FROM (CASE WHEN category='Local Daily-Wage Workers' THEN 'NOT_APPLICABLE' ELSE 'APPLICABLE' END) THEN
  RAISE EXCEPTION 'PT applicability is automatic from employee category' USING ERRCODE='23514';
 END IF;
 IF NEW.scheme IN ('EPF','ESI') AND category IN ('SNP Casual Factory Labour','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers') AND (NEW.applicability<>'NOT_APPLICABLE' OR NEW.enrolled IS DISTINCT FROM false) THEN
  RAISE EXCEPTION 'Casual and Local employees cannot be enrolled for EPF/ESI' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_guard_category_profile() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payroll_category_profile_guard BEFORE INSERT ON public.payroll_employee_statutory_profiles FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_category_profile();
CREATE FUNCTION public.payroll_guard_category_statutory_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF NOT public.payroll_category_scheme_applies(NEW.salary_row_id,NEW.scheme,NEW.contribution_month) OR NEW.rule_revision_id IS NULL THEN
  RAISE EXCEPTION 'Excluded schemes cannot post and applicable schemes require a published rule' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_guard_category_statutory_entry() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payroll_category_statutory_entry_guard BEFORE INSERT ON public.payroll_statutory_entries FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_category_statutory_entry();
ALTER TABLE public.payroll_financial_snapshots DROP CONSTRAINT payroll_complete_snapshot;
ALTER TABLE public.payroll_financial_snapshots ADD CONSTRAINT payroll_complete_snapshot CHECK(
 calculation_snapshot ?& ARRAY['status','blockers','source_fingerprint','final_net_salary','financial_readiness','calculation_revision'] AND
 calculation_snapshot->>'financial_readiness'='true' AND calculation_snapshot->>'calculation_revision' IN ('PHASE6_V1','PHASE6_CATEGORY_RULES_V1') AND calculation_snapshot->>'final_net_salary' IS NOT NULL);

CREATE OR REPLACE FUNCTION public.get_payroll_statutory_setup_candidates(p_actor_id uuid,p_search text DEFAULT '',
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
 selected AS (SELECT * FROM matching WHERE NOT p_unconfigured_only OR (profile_version=0 AND employee_category<>'Local Daily-Wage Workers')),
 page AS (SELECT * FROM selected ORDER BY employee_name,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('employees',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY employee_name,id) FROM page e),'[]'),
  'total',(SELECT count(*) FROM selected),'eligible_total',(SELECT count(*) FROM matching WHERE profile_version=0 AND employee_category<>'Local Daily-Wage Workers'),'page',p_page,'limit',p_limit) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_statutory_setup_candidates(uuid,text,text,text,boolean,integer,integer) TO service_role;

