-- Approved Phase 6 setup; production financial activation remains off.
CREATE FUNCTION public.payroll_require_master_actor(k text,a uuid) RETURNS text LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF k NOT IN ('policies','statutory') OR k IS NULL THEN RAISE EXCEPTION 'Invalid master kind' USING ERRCODE='22023'; END IF;
 RETURN public.payroll_require_actor(a,CASE WHEN k='statutory' THEN ARRAY['accounts','admin'] ELSE ARRAY['admin'] END);
END; $$;
REVOKE ALL ON FUNCTION public.payroll_require_master_actor(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.payroll_policy_master_revisions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%full_month_unpaid_treatment%' LOOP EXECUTE format('ALTER TABLE public.payroll_policy_master_revisions DROP CONSTRAINT %I',c.conname); END LOOP; END; $$;
ALTER TABLE public.payroll_policy_master_revisions ADD CONSTRAINT payroll_full_month_unpaid_rule CHECK(full_month_unpaid_treatment IN ('UNRESOLVED','NO_PAYABLE_ENTITLEMENT_ZERO'));
ALTER TABLE public.payroll_policy_master_revisions DROP CONSTRAINT payroll_policy_weekly_off;
ALTER TABLE public.payroll_policy_master_revisions ADD CONSTRAINT payroll_policy_weekly_off CHECK(leave_weekly_off_method IN ('UNRESOLVED','WORK_CALENDAR','EXCLUDE_PAID_CALENDAR_DAYS'));
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.payroll_policy_master_revisions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%monetary_rounding_method%' LOOP EXECUTE format('ALTER TABLE public.payroll_policy_master_revisions DROP CONSTRAINT %I',c.conname); END LOOP; END; $$;
ALTER TABLE public.payroll_policy_master_revisions ADD CONSTRAINT payroll_net_rounding CHECK(monetary_rounding_method IN ('UNRESOLVED','HALF_UP_2'));
ALTER TABLE public.payroll_policy_master_revisions ADD COLUMN special_package_period text NOT NULL DEFAULT 'UNRESOLVED' CHECK(special_package_period IN ('UNRESOLVED','MONTHLY_CONFIRMED'));
-- Preserve legacy advisor-confirmed revisions; new confirmations are Accounts-owned.
DO $$ DECLARE c record; def text; BEGIN
 FOR c IN SELECT conrelid::regclass t,conname,pg_get_constraintdef(oid) d FROM pg_constraint WHERE contype='c' AND conrelid IN ('public.payroll_statutory_rule_revisions'::regclass,'public.payroll_employee_statutory_profiles'::regclass) AND pg_get_constraintdef(oid) LIKE '%ADVISOR_VERIFIED%' LOOP
  def:=replace(replace(c.d,'ARRAY[''UNVERIFIED''::text, ''ADVISOR_VERIFIED''::text]', 'ARRAY[''UNVERIFIED''::text, ''ADVISOR_VERIFIED''::text, ''ACCOUNTS_CONFIRMED''::text]'), '= ''ADVISOR_VERIFIED''::text', '= ANY (ARRAY[''ADVISOR_VERIFIED''::text,''ACCOUNTS_CONFIRMED''::text])');
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.t,c.conname);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',c.t,c.conname,def);
 END LOOP;
END; $$;
ALTER TABLE public.payroll_work_calendar_days DROP CONSTRAINT payroll_work_calendar_days_compensation_treatment_check;
ALTER TABLE public.payroll_work_calendar_days DROP CONSTRAINT payroll_work_calendar_days_status_check;
ALTER TABLE public.payroll_work_calendar_days ADD CONSTRAINT payroll_calendar_treatment CHECK(compensation_treatment IN ('UNRESOLVED','PAID','UNPAID'));
ALTER TABLE public.payroll_work_calendar_days ADD CONSTRAINT payroll_calendar_state CHECK(status IN ('DRAFT','PUBLISHED'));
CREATE UNIQUE INDEX payroll_calendar_published_unique ON public.payroll_work_calendar_days(group_code,department,calendar_date) WHERE status='PUBLISHED';


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
  IF coalesce(array_length(a,1),0)+coalesce(array_length(b,1),0)<>8
   OR (SELECT count(DISTINCT x) FROM unnest(coalesce(a,'{}')||coalesce(b,'{}')) x)<>8
   OR EXISTS(SELECT 1 FROM unnest(coalesce(a,'{}')||coalesce(b,'{}')) x WHERE x NOT IN ('BASIC','STAFF_WELFARE','OTHER_FIXED','PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'))
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

CREATE OR REPLACE FUNCTION public.save_payroll_master_draft(p_kind text,p_id uuid,p_expected_version integer,p_data jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t text; r jsonb; before_r jsonb; cols text; vals text; changes text; slab jsonb; rid uuid;
BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id); t:=public.payroll_master_table(p_kind);
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
  IF before_r->>'verification_status' IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND p_data->>'verification_status' IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
   AND p_data->>'verification_reference' IS NOT DISTINCT FROM before_r->>'verification_reference'
   AND (p_data-ARRAY['reason','verification_status','advisor_name','verification_reference','verified_on']) IS DISTINCT FROM
       (public.payroll_master_payload(p_kind,before_r)-ARRAY['reason','verification_status','advisor_name','verification_reference','verified_on']) THEN
   RAISE EXCEPTION 'Changed statutory rules require fresh advisor evidence or an unverified draft' USING ERRCODE='22023';
  END IF;
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
  IF item->>'effective_from'>=r->>'effective_from' OR item->>'effective_to'>r->>'effective_to' OR jsonb_array_length(v_overlaps)>1 THEN conflicts:=conflicts||jsonb_build_array(item->>'id'); END IF;
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

CREATE OR REPLACE FUNCTION public.publish_payroll_master(p_kind text,p_id uuid,p_expected_version integer,p_preview_token text,p_approval_reference text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t text; preview jsonb; r jsonb; item jsonb; next_revision integer;
BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id); t:=public.payroll_master_table(p_kind);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 preview:=public.preview_payroll_master_publication(p_kind,p_id,p_actor_id); r:=preview->'revision';
 IF p_expected_version IS DISTINCT FROM (r->>'version')::int OR p_preview_token IS DISTINCT FROM preview->>'preview_token' THEN RAISE EXCEPTION 'Preview changed; review again' USING ERRCODE='PY409'; END IF;
 IF preview->>'publishable'<>'true' THEN RAISE EXCEPTION 'Publication blocked by configuration or effective-date conflicts' USING ERRCODE='22023'; END IF;
 IF nullif(btrim(p_approval_reference),'') IS NULL OR length(p_approval_reference)>2000 THEN RAISE EXCEPTION 'Approval reference required' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(preview->'supersedes') LOOP
  EXECUTE format('UPDATE public.%I SET effective_to=$1 WHERE id=$2 RETURNING to_jsonb(%I.*)',t,t) INTO r USING (preview->'revision'->>'effective_from')::date-1,(item->>'id')::uuid;
  INSERT INTO public.payroll_master_events(policy_revision_id,statutory_revision_id,action,actor_id,before_snapshot,after_snapshot)
   VALUES(CASE WHEN p_kind='policies' THEN (item->>'id')::uuid END,CASE WHEN p_kind='statutory' THEN (item->>'id')::uuid END,'SUPERSEDED_FUTURE',p_actor_id,item,r||jsonb_build_object('replaced_by',p_id,'approval_reference',p_approval_reference));
 END LOOP;
 r:=preview->'revision';
 IF p_kind='policies' THEN
  SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM public.payroll_policy_master_revisions WHERE group_code IS NOT DISTINCT FROM r->>'group_code';
 ELSE
  SELECT coalesce(max(revision_number),0)+1 INTO next_revision FROM public.payroll_statutory_rule_revisions WHERE scheme=r->>'scheme' AND jurisdiction=r->>'jurisdiction' AND establishment=r->>'establishment';
 END IF;
 EXECUTE format('UPDATE public.%I SET status=''PUBLISHED'',version=version+1,revision_number=$2,published_by=$3,published_at=now(),approval_reference=$4,published_effective_to=effective_to WHERE id=$1 RETURNING to_jsonb(%I.*)',t,t) INTO r USING p_id,next_revision,p_actor_id,btrim(p_approval_reference);
 INSERT INTO public.payroll_master_events(policy_revision_id,statutory_revision_id,action,actor_id,before_snapshot,after_snapshot)
 VALUES(CASE WHEN p_kind='policies' THEN p_id END,CASE WHEN p_kind='statutory' THEN p_id END,'PUBLISHED',p_actor_id,preview,r);
 RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_master_revisions(p_kind text,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t text; result jsonb; BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id); t:=public.payroll_master_table(p_kind);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 EXECUTE format('SELECT jsonb_build_object(''revisions'',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object(''data'',public.payroll_master_payload($3,to_jsonb(r)))) FROM (SELECT * FROM public.%I ORDER BY created_at DESC,id LIMIT $1 OFFSET $2) r),''[]''::jsonb),''total'',(SELECT count(*) FROM public.%I))',t,t) INTO result USING p_limit,(p_page-1)*p_limit,p_kind;
 RETURN result||jsonb_build_object('events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.payroll_master_events e WHERE CASE WHEN p_kind='policies' THEN e.policy_revision_id ELSE e.statutory_revision_id END IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(result->'revisions') r)),'[]'::jsonb),
 'groups',(SELECT jsonb_agg(to_jsonb(g)) FROM public.payroll_groups g),'page',p_page,'limit',p_limit,'financial_workflows_enabled',false);
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_payroll_master(p_kind text,p_scope jsonb,p_date date,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE candidates jsonb; r jsonb; scope_id uuid; d jsonb; warnings jsonb; BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id); PERFORM public.payroll_master_table(p_kind);
 IF p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION 'Date required' USING ERRCODE='22023'; END IF;
 IF p_kind='policies' THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=p_scope->>'group_code') THEN RAISE EXCEPTION 'Unknown payroll group' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=p_scope->>'group_code' AND NOT is_permanent) THEN RETURN jsonb_build_object('error','DAILY_WAGE_MASTER_REQUIRED','revision_id',NULL,'blockers','[{"code":"DAILY_WAGE_MASTER_REQUIRED"}]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND p_date BETWEEN effective_from AND effective_to AND group_code=p_scope->>'group_code';
  IF candidates='[]'::jsonb THEN SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND p_date BETWEEN effective_from AND effective_to AND group_code IS NULL; END IF;
 ELSE
  IF ((p_scope->>'statutory_scope_id') IS NULL AND (nullif(btrim(p_scope->>'jurisdiction'),'') IS NULL OR nullif(btrim(p_scope->>'establishment'),'') IS NULL)) OR coalesce(p_scope->>'scheme','') NOT IN ('EPF','ESI','PT') THEN RETURN jsonb_build_object('error','STATUTORY_SCOPE_REQUIRED','revision_id',NULL,'blockers','[{"code":"STATUTORY_SCOPE_REQUIRED"}]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_statutory_rule_revisions x WHERE status='PUBLISHED' AND verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND p_date BETWEEN effective_from AND effective_to AND scheme=p_scope->>'scheme' AND ((p_scope->>'statutory_scope_id' IS NOT NULL AND EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b WHERE b.revision_id=x.id AND b.statutory_scope_id=(p_scope->>'statutory_scope_id')::uuid)) OR (p_scope->>'statutory_scope_id' IS NULL AND jurisdiction=p_scope->>'jurisdiction' AND establishment=p_scope->>'establishment'));
 END IF;
 IF jsonb_array_length(candidates)<>1 THEN RETURN jsonb_build_object('error',CASE WHEN candidates='[]'::jsonb THEN 'MISSING_POLICY' ELSE 'AMBIGUOUS_POLICY' END,'revision_id',NULL,'blockers',jsonb_build_array(jsonb_build_object('code',CASE WHEN candidates='[]'::jsonb THEN 'MISSING_POLICY' ELSE 'AMBIGUOUS_POLICY' END))); END IF;
 r:=candidates->0; d:=public.payroll_master_payload(p_kind,r);
 SELECT statutory_scope_id INTO scope_id FROM public.payroll_statutory_scope_bindings WHERE revision_id=(r->>'id')::uuid;
 warnings:=public.payroll_master_configuration_warnings(p_kind,d);
 IF p_kind='statutory' AND scope_id IS NULL THEN warnings:=warnings||'[{"field":"statutory_scope_id","code":"CANONICAL_SCOPE_REQUIRED"}]'::jsonb; END IF;
 RETURN jsonb_build_object('kind',p_kind,'revision_id',r->'id','revision',r,'data',d,'statutory_scope_id',scope_id,
  'configuration_warnings',warnings,'blockers',CASE WHEN p_kind='policies' THEN '[]'::jsonb ELSE public.payroll_validate_master(p_kind,d) END,'financial_workflows_enabled',false);
END; $$;

CREATE OR REPLACE FUNCTION public.payroll_master_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE k text; d jsonb; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; blockers jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Master history cannot be deleted' USING ERRCODE='42501'; END IF;
 k:=CASE WHEN TG_TABLE_NAME='payroll_policy_master_revisions' THEN 'policies' ELSE 'statutory' END;
 IF TG_OP='UPDATE' AND OLD.status='PUBLISHED' THEN
  IF (to_jsonb(NEW)-'effective_to') IS DISTINCT FROM (to_jsonb(OLD)-'effective_to') OR NEW.effective_to>=OLD.effective_to OR NEW.effective_to<today THEN
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

CREATE OR REPLACE FUNCTION public.register_payroll_statutory_scope(p_jurisdiction_code text,p_establishment_code text,p_evidence text,p_actor_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE rid uuid;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 INSERT INTO public.payroll_statutory_scopes(jurisdiction_code,establishment_code,evidence_reference,created_by)
 VALUES(p_jurisdiction_code,p_establishment_code,p_evidence,p_actor_id) RETURNING id INTO rid;
 RETURN rid;
END; $$;

CREATE OR REPLACE FUNCTION public.payroll_statutory_scope_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE r public.payroll_statutory_rule_revisions%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(NEW.created_by,ARRAY['admin','accounts']);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 SELECT * INTO r FROM public.payroll_statutory_rule_revisions WHERE id=NEW.revision_id;
 IF NOT FOUND OR r.status<>'PUBLISHED' OR r.verification_status NOT IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') THEN RAISE EXCEPTION 'Only verified published revisions may be mapped' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b JOIN public.payroll_statutory_rule_revisions x ON x.id=b.revision_id
  WHERE b.statutory_scope_id=NEW.statutory_scope_id AND x.scheme=r.scheme AND daterange(x.effective_from,x.effective_to,'[]') && daterange(r.effective_from,r.effective_to,'[]')) THEN
  RAISE EXCEPTION 'Canonical statutory scope has overlapping published revisions' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.bind_payroll_statutory_scope(p_revision_id uuid,p_scope_id uuid,p_evidence text,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 INSERT INTO public.payroll_statutory_scope_bindings(revision_id,statutory_scope_id,evidence_reference,created_by) VALUES(p_revision_id,p_scope_id,p_evidence,p_actor_id);
END; $$;

CREATE OR REPLACE FUNCTION public.record_payroll_statutory_profiles(p_employee_id uuid,p_expected_version integer,p_intervals jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE current_version integer; rid uuid; item jsonb; s text; detail jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 PERFORM 1 FROM public.hr_employees WHERE id=p_employee_id FOR UPDATE;
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
  'financial_workflows_enabled',false) INTO result FROM public.payroll_source_history_revisions h WHERE h.employee_id=p_employee_id AND h.source_kind='STATUTORY_PROFILE';
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_statutory_profile_context(p_actor_id uuid,p_search text DEFAULT '',p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_search IS NULL OR length(p_search)>120 THEN RAISE EXCEPTION 'Invalid scope selection' USING ERRCODE='22023'; END IF;
 WITH selected AS (SELECT * FROM public.payroll_statutory_scopes WHERE strpos(lower(jurisdiction_code||' '||establishment_code),lower(p_search))>0),
 page AS (SELECT * FROM selected ORDER BY jurisdiction_code,establishment_code,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('scopes',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY jurisdiction_code,establishment_code,id) FROM page s),'[]'),
  'bindings',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY revision_id) FROM public.payroll_statutory_scope_bindings b WHERE statutory_scope_id IN (SELECT id FROM page)),'[]'),
  'total',(SELECT count(*) FROM selected),'page',p_page,'limit',p_limit,'financial_workflows_enabled',false) INTO result;
 RETURN result;
END; $$;

NOTIFY pgrst,'reload schema';
