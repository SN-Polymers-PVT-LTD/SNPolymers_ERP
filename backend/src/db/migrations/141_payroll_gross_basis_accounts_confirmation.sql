-- Current client decision: gross-only contribution wages and automatic Accounts
-- confirmation on save. Historical storage and locked audit snapshots are retained.
-- No past published rule is converted to a different wage basis.

CREATE OR REPLACE FUNCTION public.payroll_validate_master_106(p_kind text,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE blockers jsonb:='[]'; c jsonb; r jsonb; k text; a text[]; b text[]; slab jsonb; m integer; last_upper numeric; n integer;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid master' USING ERRCODE='22023'; END IF;
 IF p_kind='policies' THEN
  IF d ? 'special_package_period' AND d->>'special_package_period' NOT IN ('UNRESOLVED','MONTHLY_CONFIRMED') THEN RAISE EXCEPTION 'Invalid package period' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(d) x WHERE x NOT IN ('group_code','effective_from','effective_to','monthly_entitlement_method','lop_method','lop_fixed_divisor','partial_month_proration_method','partial_month_fixed_divisor','split_period_allocation_method','full_month_unpaid_treatment','leave_weekly_off_method','monetary_rounding_method','sandwich_enabled','reason','rounding','work_calendar_reference','special_package_period'))
   OR NOT d ?& ARRAY['effective_from','effective_to','monthly_entitlement_method','lop_method','partial_month_proration_method','split_period_allocation_method','full_month_unpaid_treatment','leave_weekly_off_method','monetary_rounding_method','sandwich_enabled','reason','rounding']
   OR d->>'monthly_entitlement_method'<>'CONTRACTUAL_MONTHLY_GROSS' OR d->>'lop_method' NOT IN ('FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS')
   OR d->>'partial_month_proration_method' NOT IN ('UNRESOLVED','FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS','WORK_CALENDAR')
   OR d->>'split_period_allocation_method' NOT IN ('UNRESOLVED','CALENDAR_WEIGHTED_WITH_RESIDUAL')
   OR d->>'full_month_unpaid_treatment' NOT IN ('UNRESOLVED','NO_PAYABLE_ENTITLEMENT_ZERO') OR d->>'leave_weekly_off_method' NOT IN ('UNRESOLVED','WORK_CALENDAR','EXCLUDE_PAID_CALENDAR_DAYS')
   OR d->>'monetary_rounding_method' NOT IN ('UNRESOLVED','HALF_UP_2') OR d->'sandwich_enabled' IS DISTINCT FROM 'false'::jsonb
   OR jsonb_typeof(d->'rounding') IS DISTINCT FROM 'object' OR ((d->'rounding')-ARRAY['lop','proration','allocation'])<>'{}'::jsonb
   OR NOT (d->'rounding') ?& ARRAY['lop','proration','allocation'] THEN RAISE EXCEPTION 'Invalid policy configuration' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=d->>'group_code' AND NOT is_permanent) THEN RAISE EXCEPTION 'Monthly policy requires a permanent payroll group; daily wage masters remain authoritative' USING ERRCODE='22023'; END IF;
  IF (d->>'lop_method'='FIXED_DIVISOR' AND public.payroll_check_decimal(d->'lop_fixed_divisor',9999,true) IS DISTINCT FROM true)
   OR (d->>'lop_method'='ACTUAL_CALENDAR_DAYS' AND d->'lop_fixed_divisor' IS DISTINCT FROM 'null'::jsonb)
   OR (d->>'partial_month_proration_method'='FIXED_DIVISOR' AND public.payroll_check_decimal(d->'partial_month_fixed_divisor',9999,true) IS DISTINCT FROM true)
   OR (d->>'partial_month_proration_method'<>'FIXED_DIVISOR' AND d->'partial_month_fixed_divisor' IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'Invalid independent divisors' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['lop','proration','allocation'] LOOP
   r:=d->'rounding'->k;
   IF public.payroll_check_rounding(r) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid rounding' USING ERRCODE='22023'; END IF;
   IF r->>'method'='UNRESOLVED' THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('field','rounding.'||k,'code','UNRESOLVED')); END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['partial_month_proration_method','split_period_allocation_method','full_month_unpaid_treatment','leave_weekly_off_method'] LOOP
   IF d->>k='UNRESOLVED' THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('field',k,'code','UNRESOLVED')); END IF;
  END LOOP;
  IF d->>'partial_month_proration_method'='WORK_CALENDAR' OR d->>'leave_weekly_off_method'='WORK_CALENDAR' THEN
   blockers:=blockers||jsonb_build_array(jsonb_build_object('field','work_calendar_reference','code','APPROVED_CALENDAR_REQUIRED'));
  END IF;
 ELSE
  IF p_kind<>'statutory' OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) x WHERE x NOT IN ('scheme','jurisdiction','establishment','effective_from','effective_to','configuration','verification_status','advisor_name','verification_reference','verified_on','reason','slabs'))
   OR NOT d ?& ARRAY['scheme','jurisdiction','establishment','effective_from','effective_to','configuration','verification_status','reason','slabs']
   OR d->>'scheme' NOT IN ('EPF','ESI','PT') OR jsonb_typeof(d->'slabs') IS DISTINCT FROM 'array'
   OR jsonb_array_length(d->'slabs')>1200 THEN RAISE EXCEPTION 'Invalid statutory master' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(d) WHERE key IN ('scheme','jurisdiction','establishment','verification_status','reason') AND jsonb_typeof(value) IS DISTINCT FROM 'string') OR d->>'verification_status' NOT IN ('UNVERIFIED','ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') THEN RAISE EXCEPTION 'Invalid statutory identity or verification metadata' USING ERRCODE='22023'; END IF;
  c:=d->'configuration';
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT c ?& ARRAY['employee_rate','employer_rate','included_components','excluded_components','eligibility','eligibility_ceiling','wage_ceiling','contribution_minimum','contribution_cap','calculation_method','rounding','aggregation','effective_rule','conditions']
   OR (c-ARRAY['employee_rate','employer_rate','included_components','excluded_components','eligibility','eligibility_ceiling','wage_ceiling','contribution_minimum','contribution_cap','calculation_method','rounding','aggregation','effective_rule','conditions'])<>'{}'::jsonb
   OR c->>'eligibility' NOT IN ('UNRESOLVED','ENROLLED','WAGE_CEILING','ENROLLED_AND_WAGE_CEILING','JURISDICTION_PROFILE')
   OR c->>'calculation_method' NOT IN ('UNRESOLVED','QUALIFYING_WAGE_PERCENTAGE','CAPPED_WAGE_PERCENTAGE','SLABS')
   OR c->>'aggregation'<>'CALENDAR_MONTH' OR c->>'effective_rule'<>'MONTH_START'
   OR c->>'conditions' NOT IN ('UNRESOLVED','NONE','PROFILE_EXEMPTIONS')
   OR public.payroll_check_rounding(c->'rounding') IS DISTINCT FROM true
   OR jsonb_typeof(c->'included_components') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'excluded_components') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Unsupported statutory configuration' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(c) WHERE key IN ('eligibility','calculation_method','aggregation','effective_rule','conditions') AND jsonb_typeof(value) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Named statutory rules required' USING ERRCODE='22023'; END IF;
  SELECT array_agg(x) INTO a FROM jsonb_array_elements_text(c->'included_components') x;
  SELECT array_agg(x) INTO b FROM jsonb_array_elements_text(c->'excluded_components') x;
  IF coalesce(array_length(a,1),0)+coalesce(array_length(b,1),0)<>5
   OR (SELECT count(DISTINCT x) FROM unnest(coalesce(a,'{}')||coalesce(b,'{}')) x)<>5
   OR EXISTS(SELECT 1 FROM unnest(coalesce(a,'{}')||coalesce(b,'{}')) x WHERE x NOT IN ('PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'))
   OR coalesce(array_length(a,1),0)=0 THEN RAISE EXCEPTION 'Explicit wage component partition required' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['employee_rate','employer_rate','eligibility_ceiling','wage_ceiling','contribution_minimum','contribution_cap'] LOOP
   IF c->k IS DISTINCT FROM 'null'::jsonb AND public.payroll_check_decimal(c->k,CASE WHEN k IN ('employee_rate','employer_rate') THEN 100 ELSE 99999999999 END) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid statutory decimal: %',k USING ERRCODE='22023'; END IF;
  END LOOP;
  IF d->>'scheme'='PT' THEN
   IF c->'employee_rate' IS DISTINCT FROM 'null'::jsonb OR c->'employer_rate' IS DISTINCT FROM 'null'::jsonb OR c->>'calculation_method' NOT IN ('UNRESOLVED','SLABS') OR c->>'eligibility' NOT IN ('UNRESOLVED','JURISDICTION_PROFILE')
    OR c->'wage_ceiling' IS DISTINCT FROM 'null'::jsonb OR c->'eligibility_ceiling' IS DISTINCT FROM 'null'::jsonb OR c->'contribution_cap' IS DISTINCT FROM 'null'::jsonb OR c->'contribution_minimum' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'PT uses jurisdiction slabs, not percentages or caps' USING ERRCODE='22023'; END IF;
   IF jsonb_array_length(d->'slabs')=0 THEN blockers:=blockers||'[{"field":"slabs","code":"INCOMPLETE_SLABS"}]';
   ELSE
    FOR slab IN SELECT * FROM jsonb_array_elements(d->'slabs') LOOP
     IF jsonb_typeof(slab) IS DISTINCT FROM 'object' OR NOT slab ?& ARRAY['month','lower_bound','upper_bound','deduction_amount'] OR (slab-ARRAY['month','lower_bound','upper_bound','deduction_amount'])<>'{}'::jsonb
      OR jsonb_typeof(slab->'month') IS DISTINCT FROM 'number' OR slab->>'month' !~ '^(1[0-2]|[1-9])$'
      OR public.payroll_check_decimal(slab->'lower_bound',99999999999) IS DISTINCT FROM true OR scale((slab->>'lower_bound')::numeric)>2
      OR public.payroll_check_decimal(slab->'deduction_amount',99999999999) IS DISTINCT FROM true OR scale((slab->>'deduction_amount')::numeric)>2
      OR (slab->'upper_bound' IS DISTINCT FROM 'null'::jsonb AND (public.payroll_check_decimal(slab->'upper_bound',99999999999,true) IS DISTINCT FROM true OR scale((slab->>'upper_bound')::numeric)>2 OR (slab->>'upper_bound')::numeric<=(slab->>'lower_bound')::numeric)) THEN RAISE EXCEPTION 'Invalid PT slab' USING ERRCODE='22023'; END IF;
    END LOOP;
    FOR m IN 1..12 LOOP
     last_upper:=0; n:=0;
     FOR slab IN SELECT value FROM jsonb_array_elements(d->'slabs') WHERE (value->>'month')::int=m ORDER BY (value->>'lower_bound')::numeric LOOP
      IF last_upper IS NULL OR (slab->>'lower_bound')::numeric<>last_upper THEN RAISE EXCEPTION 'PT slabs must cover each month from zero without gaps or v_overlaps' USING ERRCODE='22023'; END IF;
      last_upper:=(slab->>'upper_bound')::numeric; n:=n+1;
     END LOOP;
     IF n=0 OR last_upper IS NOT NULL THEN RAISE EXCEPTION 'PT requires all 12 months, each ending at infinity' USING ERRCODE='22023'; END IF;
    END LOOP;
   END IF;
  ELSE
   IF jsonb_array_length(d->'slabs')<>0 OR c->>'calculation_method'='SLABS' OR c->>'eligibility'='JURISDICTION_PROFILE' THEN RAISE EXCEPTION 'Invalid contribution scheme' USING ERRCODE='22023'; END IF;
   FOREACH k IN ARRAY ARRAY['employee_rate','employer_rate'] LOOP
    IF c->k='null'::jsonb THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('field',k,'code','RATE_REQUIRED')); END IF;
   END LOOP;
   IF c->>'eligibility' IN ('WAGE_CEILING','ENROLLED_AND_WAGE_CEILING') AND c->'eligibility_ceiling'='null'::jsonb THEN blockers:=blockers||'[{"field":"eligibility_ceiling","code":"CEILING_REQUIRED"}]'; END IF;
   IF c->>'calculation_method'='CAPPED_WAGE_PERCENTAGE' AND c->'wage_ceiling'='null'::jsonb THEN blockers:=blockers||'[{"field":"wage_ceiling","code":"CEILING_REQUIRED"}]'; END IF;
   IF c->>'calculation_method'='QUALIFYING_WAGE_PERCENTAGE' AND c->'wage_ceiling' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Wage ceiling requires capped method' USING ERRCODE='22023'; END IF;
   IF c->'contribution_cap' IS DISTINCT FROM 'null'::jsonb AND c->'contribution_minimum' IS DISTINCT FROM 'null'::jsonb AND (c->>'contribution_minimum')::numeric>(c->>'contribution_cap')::numeric THEN RAISE EXCEPTION 'Minimum exceeds cap' USING ERRCODE='22023'; END IF;
  END IF;
  FOREACH k IN ARRAY ARRAY['eligibility','calculation_method','conditions'] LOOP
   IF c->>k IN ('UNRESOLVED','PROFILE_EXEMPTIONS') THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('field',k,'code','UNSUPPORTED_OR_UNRESOLVED')); END IF;
  END LOOP;
  IF c->'rounding'->>'method'='UNRESOLVED' THEN blockers:=blockers||'[{"field":"rounding","code":"UNRESOLVED"}]'; END IF;
  IF d->>'verification_status' NOT IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') OR nullif(btrim(d->>'advisor_name'),'') IS NULL OR nullif(btrim(d->>'verification_reference'),'') IS NULL OR (d->>'verified_on') IS NULL THEN blockers:=blockers||'[{"field":"verification_status","code":"ADVISOR_VERIFICATION_REQUIRED"}]'; END IF;
 END IF;
 RETURN blockers;
END; $$;

CREATE OR REPLACE FUNCTION public.save_payroll_master_draft(p_kind text, p_id uuid, p_expected_version integer, p_data jsonb, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE t text; r jsonb; before_r jsonb; cols text; vals text; changes text; slab jsonb; rid uuid;
BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id); t:=public.payroll_master_table(p_kind);
 IF p_kind='statutory' THEN
  p_data:=p_data||jsonb_build_object('verification_status','ACCOUNTS_CONFIRMED',
   'advisor_name',(SELECT left(coalesce(nullif(btrim(display_name),''),id::text),120) FROM public.authorised_users WHERE id=p_actor_id),
   'verification_reference',p_data->>'reason','verified_on',(now() AT TIME ZONE 'Asia/Kolkata')::date);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 PERFORM public.payroll_validate_master(p_kind,p_data);
 IF p_id IS NULL THEN
  IF p_expected_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'New draft version must be zero' USING ERRCODE='PY409'; END IF;
 ELSE
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 FOR UPDATE',t) INTO before_r USING p_id;
  IF before_r IS NULL THEN RAISE EXCEPTION 'Master revision not found' USING ERRCODE='P0002'; END IF;
  IF before_r->>'status'<>'DRAFT' OR (before_r->>'version')::int IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Draft changed or already published' USING ERRCODE='PY409'; END IF;
 END IF;
 IF p_kind='statutory' AND p_id IS NOT NULL THEN
  before_r:=before_r||jsonb_build_object('slabs',public.payroll_master_payload(p_kind,before_r)->'slabs');
  -- Remove old slabs while the OLD parent is still a PT draft. The transaction
  -- restores them if updating/reclassifying the parent or new slabs fails.
  DELETE FROM public.payroll_professional_tax_slabs WHERE revision_id=p_id;
 END IF;
 -- JSON is populated into the known composite type, never interpolated as SQL.
 SELECT string_agg(format('%I',key),','),string_agg(format('v.%I',key),','),string_agg(format('%I=v.%I',key,key),',') INTO cols,vals,changes
 FROM jsonb_object_keys(p_data-'slabs') key;
 IF p_id IS NULL THEN
  EXECUTE format('INSERT INTO public.%I(%s,created_by) SELECT %s,$2 FROM jsonb_populate_record(NULL::public.%I,$1) v RETURNING to_jsonb(%I.*)',t,cols,vals,t,t) INTO r USING p_data-'slabs',p_actor_id;
 ELSE
  EXECUTE format('UPDATE public.%I r SET %s,version=r.version+1 FROM jsonb_populate_record(NULL::public.%I,$1) v WHERE r.id=$2 RETURNING to_jsonb(r)',t,changes,t) INTO r USING p_data-'slabs',p_id;
 END IF;
 rid:=(r->>'id')::uuid;
 IF p_kind='statutory' THEN
  FOR slab IN SELECT * FROM jsonb_array_elements(p_data->'slabs') LOOP
   INSERT INTO public.payroll_professional_tax_slabs VALUES(rid,(slab->>'month')::int,(slab->>'lower_bound')::numeric,(slab->>'upper_bound')::numeric,(slab->>'deduction_amount')::numeric);
  END LOOP;
  r:=r||jsonb_build_object('slabs',p_data->'slabs');
 END IF;
 INSERT INTO public.payroll_master_events(policy_revision_id,statutory_revision_id,action,actor_id,before_snapshot,after_snapshot)
 VALUES(CASE WHEN p_kind='policies' THEN rid END,CASE WHEN p_kind='statutory' THEN rid END,CASE WHEN p_id IS NULL THEN 'DRAFT_CREATED' ELSE 'DRAFT_EDITED' END,p_actor_id,before_r,r);
 RETURN r;
END; $$
;

CREATE OR REPLACE FUNCTION public.create_hr_pay_structure(p_employee_id uuid, p_pay_basis text, p_guaranteed_monthly_gross numeric, p_epf_enrolment boolean, p_esi_enrolment boolean, p_status text, p_actor_id uuid)
 RETURNS hr_permanent_pay_structures
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions
AS $$
DECLARE
  v_next_rev integer;
  v_res public.hr_permanent_pay_structures%ROWTYPE;
  v_status text;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id,ARRAY['admin']);
  PERFORM 1 FROM public.hr_employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target employee does not exist' USING ERRCODE = 'P0002';
  END IF;

  v_status := COALESCE(p_status, 'Active');

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_rev
  FROM public.hr_permanent_pay_structures
  WHERE employee_id = p_employee_id;

  IF v_status = 'Active' THEN
    UPDATE public.hr_permanent_pay_structures
    SET status = 'Superseded',
        updated_at = now(),
        updated_by = p_actor_id
    WHERE employee_id = p_employee_id
      AND status IN ('Active', 'Suspended');
  END IF;

  INSERT INTO public.hr_permanent_pay_structures (
    employee_id, revision_number, pay_basis, guaranteed_monthly_gross,
    epf_enrolment, esi_enrolment, status,
    created_by, updated_by
  ) VALUES (
    p_employee_id, v_next_rev, p_pay_basis, p_guaranteed_monthly_gross,
    COALESCE(p_epf_enrolment, false), COALESCE(p_esi_enrolment, false), v_status,
    p_actor_id, p_actor_id
  ) RETURNING * INTO v_res;

  RETURN v_res;
END;
$$
;

DROP FUNCTION public.hr_create_legacy_pay_structure(uuid,text,numeric,numeric,numeric,numeric,boolean,boolean,text,uuid);

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
  'pay_structures',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(p)-ARRAY['basic_salary','staff_welfare','other_fixed_components'],ARRAY['guaranteed_monthly_gross']) ORDER BY p.id) FROM public.hr_permanent_pay_structures p WHERE p.id IN (SELECT pay_structure_id FROM pay)),'[]'),
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
