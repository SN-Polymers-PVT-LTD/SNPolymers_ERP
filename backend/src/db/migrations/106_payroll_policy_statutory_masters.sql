-- Phase 2: masters only. No salary/coverage/entitlement/statutory posting gates change.
-- Published values are immutable; only FUTURE applicability can be shortened by
-- a controlled publication, preserving the original range and audited snapshots.
ALTER TABLE public.payroll_policy_master_revisions
 DROP CONSTRAINT payroll_policy_master_revisions_status_check,
 DROP CONSTRAINT payroll_policy_master_revisions_leave_weekly_off_method_check;
ALTER TABLE public.payroll_policy_master_revisions
 ADD CONSTRAINT payroll_policy_status CHECK(status IN ('DRAFT','PUBLISHED')),
 ADD CONSTRAINT payroll_policy_weekly_off CHECK(leave_weekly_off_method IN ('UNRESOLVED','WORK_CALENDAR')),
 ADD COLUMN rounding jsonb NOT NULL DEFAULT '{"lop":{"method":"UNRESOLVED","precision":null,"stage":"UNRESOLVED"},"proration":{"method":"UNRESOLVED","precision":null,"stage":"UNRESOLVED"},"allocation":{"method":"UNRESOLVED","precision":null,"stage":"UNRESOLVED"}}',
 ADD COLUMN work_calendar_reference text,
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN revision_number integer,
 ADD COLUMN published_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 ADD COLUMN published_at timestamptz,
 ADD COLUMN approval_reference text,
 ADD COLUMN published_effective_to date,
 ADD CONSTRAINT payroll_policy_publication CHECK(
  (status='DRAFT' AND published_by IS NULL AND published_at IS NULL AND revision_number IS NULL AND approval_reference IS NULL AND published_effective_to IS NULL)
  OR (status='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL AND revision_number IS NOT NULL AND revision_number>0 AND approval_reference IS NOT NULL AND published_effective_to IS NOT NULL AND length(btrim(approval_reference)) BETWEEN 1 AND 2000 AND published_effective_to>=effective_to));
ALTER TABLE public.payroll_policy_master_revisions ADD CONSTRAINT payroll_policy_published_nonoverlap EXCLUDE USING gist
 ((coalesce(group_code,'GLOBAL')) WITH =, daterange(effective_from,effective_to,'[]') WITH &&) WHERE(status='PUBLISHED');
CREATE TABLE public.payroll_statutory_rule_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scheme text NOT NULL CHECK(scheme IN ('EPF','ESI','PT')),
 jurisdiction text NOT NULL CHECK(length(btrim(jurisdiction)) BETWEEN 1 AND 120),
 establishment text NOT NULL CHECK(length(btrim(establishment)) BETWEEN 1 AND 120),
 effective_from date NOT NULL CHECK(isfinite(effective_from)),
 effective_to date NOT NULL CHECK(isfinite(effective_to) AND effective_to>=effective_from),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED')),
 configuration jsonb NOT NULL,
 verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status IN ('UNVERIFIED','ADVISOR_VERIFIED')),
 advisor_name text, verification_reference text, verified_on date CHECK(isfinite(verified_on)),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), revision_number integer,
 published_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT, published_at timestamptz,
 approval_reference text, published_effective_to date,
 CHECK((verification_status='UNVERIFIED' AND advisor_name IS NULL AND verification_reference IS NULL AND verified_on IS NULL)
  OR (verification_status='ADVISOR_VERIFIED' AND advisor_name IS NOT NULL AND verification_reference IS NOT NULL AND length(btrim(advisor_name)) BETWEEN 1 AND 120 AND length(btrim(verification_reference)) BETWEEN 1 AND 2000 AND verified_on IS NOT NULL)),
 CHECK((status='DRAFT' AND published_by IS NULL AND published_at IS NULL AND revision_number IS NULL AND approval_reference IS NULL AND published_effective_to IS NULL)
  OR (status='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL AND revision_number IS NOT NULL AND revision_number>0 AND approval_reference IS NOT NULL AND published_effective_to IS NOT NULL AND length(btrim(approval_reference)) BETWEEN 1 AND 2000 AND published_effective_to>=effective_to AND verification_status='ADVISOR_VERIFIED')),
 CONSTRAINT payroll_statutory_published_nonoverlap EXCLUDE USING gist
 (scheme WITH =, jurisdiction WITH =, establishment WITH =, daterange(effective_from,effective_to,'[]') WITH &&) WHERE(status='PUBLISHED')
);
-- Slabs are half-open [lower,upper). NULL upper is infinity. Each month has
-- a complete independent schedule, allowing jurisdiction-specific month amounts.
CREATE TABLE public.payroll_professional_tax_slabs (
 revision_id uuid NOT NULL REFERENCES public.payroll_statutory_rule_revisions(id) ON DELETE RESTRICT,
 month integer NOT NULL CHECK(month BETWEEN 1 AND 12),
 lower_bound numeric NOT NULL CHECK(lower_bound>=0 AND lower_bound<100000000000 AND scale(lower_bound)<=2),
 upper_bound numeric CHECK(upper_bound>lower_bound AND upper_bound<100000000000 AND scale(upper_bound)<=2),
 deduction_amount numeric NOT NULL CHECK(deduction_amount>=0 AND deduction_amount<100000000000 AND scale(deduction_amount)<=2),
 PRIMARY KEY(revision_id,month,lower_bound),
 CONSTRAINT payroll_pt_slab_nonoverlap EXCLUDE USING gist
 (revision_id WITH =, month WITH =, numrange(lower_bound,upper_bound,'[)') WITH &&)
);
CREATE TABLE public.payroll_master_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 policy_revision_id uuid REFERENCES public.payroll_policy_master_revisions(id) ON DELETE RESTRICT,
 statutory_revision_id uuid REFERENCES public.payroll_statutory_rule_revisions(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('DRAFT_CREATED','DRAFT_EDITED','PUBLISHED','SUPERSEDED_FUTURE')),
 actor_id uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 occurred_at timestamptz NOT NULL DEFAULT now(), before_snapshot jsonb, after_snapshot jsonb NOT NULL,
 CHECK((policy_revision_id IS NULL)<>(statutory_revision_id IS NULL))
);
CREATE TRIGGER payroll_master_events_immutable BEFORE UPDATE OR DELETE ON public.payroll_master_events
 FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();

CREATE FUNCTION public.payroll_check_decimal(v jsonb, max_value numeric, positive boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_typeof(v)='string' AND coalesce(v#>>'{}','') ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$'
 AND CASE WHEN coalesce(v#>>'{}','') ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$' THEN (v#>>'{}')::numeric<=max_value AND (v#>>'{}')::numeric>=0 AND (NOT positive OR (v#>>'{}')::numeric>0) ELSE false END $$;
CREATE FUNCTION public.payroll_check_rounding(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(v)='object' AND v ?& ARRAY['method','precision','stage'] AND (v-ARRAY['method','precision','stage'])='{}'::jsonb
 AND v->>'method' IN ('UNRESOLVED','HALF_UP','HALF_EVEN','DOWN','UP')
 AND v->>'stage' IN ('UNRESOLVED','DAILY','LINE','AGGREGATE','MONTH')
 AND ((v->>'method'='UNRESOLVED' AND v->'precision'='null'::jsonb AND v->>'stage'='UNRESOLVED')
 OR (v->>'method'<>'UNRESOLVED' AND jsonb_typeof(v->'precision')='number' AND v->>'precision' ~ '^[0-6]$' AND v->>'stage'<>'UNRESOLVED')) $$;

-- Reused by triggers and preview. Malformed/unsupported inputs fail; missing
-- business/legal decisions are explicit publication/readiness blockers.
CREATE FUNCTION public.payroll_validate_master(p_kind text,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE blockers jsonb:='[]'; c jsonb; r jsonb; k text; a text[]; b text[]; slab jsonb; m integer; last_upper numeric; n integer;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid master' USING ERRCODE='22023'; END IF;
 IF p_kind='policies' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(d) x WHERE x NOT IN ('group_code','effective_from','effective_to','monthly_entitlement_method','lop_method','lop_fixed_divisor','partial_month_proration_method','partial_month_fixed_divisor','split_period_allocation_method','full_month_unpaid_treatment','leave_weekly_off_method','monetary_rounding_method','sandwich_enabled','reason','rounding','work_calendar_reference'))
   OR NOT d ?& ARRAY['effective_from','effective_to','monthly_entitlement_method','lop_method','partial_month_proration_method','split_period_allocation_method','full_month_unpaid_treatment','leave_weekly_off_method','monetary_rounding_method','sandwich_enabled','reason','rounding']
   OR d->>'monthly_entitlement_method'<>'CONTRACTUAL_MONTHLY_GROSS' OR d->>'lop_method' NOT IN ('FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS')
   OR d->>'partial_month_proration_method' NOT IN ('UNRESOLVED','FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS','WORK_CALENDAR')
   OR d->>'split_period_allocation_method' NOT IN ('UNRESOLVED','CALENDAR_WEIGHTED_WITH_RESIDUAL')
   OR d->>'full_month_unpaid_treatment'<>'UNRESOLVED' OR d->>'leave_weekly_off_method' NOT IN ('UNRESOLVED','WORK_CALENDAR')
   OR d->>'monetary_rounding_method'<>'UNRESOLVED' OR d->'sandwich_enabled' IS DISTINCT FROM 'false'::jsonb
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
  IF EXISTS(SELECT 1 FROM jsonb_each(d) WHERE key IN ('scheme','jurisdiction','establishment','verification_status','reason') AND jsonb_typeof(value) IS DISTINCT FROM 'string') OR d->>'verification_status' NOT IN ('UNVERIFIED','ADVISOR_VERIFIED') THEN RAISE EXCEPTION 'Invalid statutory identity or verification metadata' USING ERRCODE='22023'; END IF;
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
  IF d->>'verification_status'<>'ADVISOR_VERIFIED' OR nullif(btrim(d->>'advisor_name'),'') IS NULL OR nullif(btrim(d->>'verification_reference'),'') IS NULL OR (d->>'verified_on') IS NULL THEN blockers:=blockers||'[{"field":"verification_status","code":"ADVISOR_VERIFICATION_REQUIRED"}]'; END IF;
 END IF;
 RETURN blockers;
END; $$;

CREATE FUNCTION public.payroll_master_table(k text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN IF k='policies' THEN RETURN 'payroll_policy_master_revisions'; ELSIF k='statutory' THEN RETURN 'payroll_statutory_rule_revisions'; END IF;
 RAISE EXCEPTION 'Unknown master kind' USING ERRCODE='22023'; END; $$;
CREATE FUNCTION public.payroll_master_payload(k text,r jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d jsonb; BEGIN
 d:=r-ARRAY['id','status','version','revision_number','created_by','created_at','published_by','published_at','approval_reference','published_effective_to'];
 IF k='policies' THEN
  d:=d||jsonb_build_object('lop_fixed_divisor',CASE WHEN r->>'lop_fixed_divisor' IS NULL THEN NULL ELSE r->>'lop_fixed_divisor' END,
  'partial_month_fixed_divisor',CASE WHEN r->>'partial_month_fixed_divisor' IS NULL THEN NULL ELSE r->>'partial_month_fixed_divisor' END);
 ELSE
  d:=d||jsonb_build_object('slabs',coalesce((SELECT jsonb_agg(jsonb_build_object('month',month,'lower_bound',lower_bound::text,'upper_bound',upper_bound::text,'deduction_amount',deduction_amount::text) ORDER BY month,lower_bound)
    FROM public.payroll_professional_tax_slabs WHERE revision_id=(r->>'id')::uuid),'[]'::jsonb));
 END IF; RETURN d;
END; $$;
CREATE FUNCTION public.payroll_master_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
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
  PERFORM public.payroll_require_actor(CASE WHEN NEW.status='PUBLISHED' THEN NEW.published_by ELSE NEW.created_by END,ARRAY['admin']);
 END IF; -- Draft edits check the CURRENT writer in the RPC, not the historic creator's current role.
 IF NEW.status='PUBLISHED' THEN
  IF NEW.effective_from<=today OR extract(day FROM NEW.effective_from)<>1 THEN RAISE EXCEPTION 'Publication requires a future month start; mid-month semantics are unsupported' USING ERRCODE='22023'; END IF;
  IF k='statutory' AND (blockers<>'[]'::jsonb OR (to_jsonb(NEW)->>'verified_on')::date>today) THEN RAISE EXCEPTION 'Unverified, incomplete or unsupported statutory configuration' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER payroll_immutable ON public.payroll_policy_master_revisions;
CREATE TRIGGER payroll_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_policy_master_revisions FOR EACH ROW EXECUTE FUNCTION public.payroll_master_guard();
CREATE TRIGGER payroll_statutory_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_statutory_rule_revisions FOR EACH ROW EXECUTE FUNCTION public.payroll_master_guard();
CREATE FUNCTION public.payroll_pt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE rid uuid; s text; scheme text; BEGIN
 rid:=CASE WHEN TG_OP='DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
 SELECT status,r.scheme INTO s,scheme FROM public.payroll_statutory_rule_revisions r WHERE id=rid FOR UPDATE;
 IF s IS DISTINCT FROM 'DRAFT' OR scheme IS DISTINCT FROM 'PT' THEN RAISE EXCEPTION 'Only a PT draft can edit slabs' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.revision_id<>NEW.revision_id THEN RAISE EXCEPTION 'Cannot move slabs' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER payroll_pt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_professional_tax_slabs FOR EACH ROW EXECUTE FUNCTION public.payroll_pt_guard();

CREATE FUNCTION public.save_payroll_master_draft(p_kind text,p_id uuid,p_expected_version integer,p_data jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t text; r jsonb; before_r jsonb; cols text; vals text; changes text; slab jsonb; rid uuid;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']); t:=public.payroll_master_table(p_kind);
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
  IF before_r->>'verification_status'='ADVISOR_VERIFIED' AND p_data->>'verification_status'='ADVISOR_VERIFIED'
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
CREATE FUNCTION public.preview_payroll_master_publication(p_kind text,p_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t text; r jsonb; d jsonb; v_overlaps jsonb; conflicts jsonb:='[]'; blockers jsonb; changed jsonb; before_data jsonb; impact integer; item jsonb; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']); t:=public.payroll_master_table(p_kind);
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
 RETURN jsonb_build_object('revision',r,'blockers',blockers,'conflicts',conflicts,'supersedes',v_overlaps,'diff',changed,
  'affected_draft_rows',impact,'impact_scope',CASE WHEN p_kind='statutory' THEN 'ALL_DRAFT_ROWS_IN_RANGE; EMPLOYEE_JURISDICTION_NOT_YET_MODELED' ELSE 'GROUP_AND_DATE_RANGE' END,
  'publishable',conflicts='[]'::jsonb AND (p_kind='policies' OR blockers='[]'::jsonb),
  'preview_token',md5(d::text||v_overlaps::text||impact::text||today::text),'financial_workflows_enabled',false);
END; $$;
CREATE FUNCTION public.publish_payroll_master(p_kind text,p_id uuid,p_expected_version integer,p_preview_token text,p_approval_reference text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t text; preview jsonb; r jsonb; item jsonb; next_revision integer;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']); t:=public.payroll_master_table(p_kind);
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
CREATE FUNCTION public.get_payroll_master_revisions(p_kind text,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t text; result jsonb; BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']); t:=public.payroll_master_table(p_kind);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 EXECUTE format('SELECT jsonb_build_object(''revisions'',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object(''data'',public.payroll_master_payload($3,to_jsonb(r)))) FROM (SELECT * FROM public.%I ORDER BY created_at DESC,id LIMIT $1 OFFSET $2) r),''[]''::jsonb),''total'',(SELECT count(*) FROM public.%I))',t,t) INTO result USING p_limit,(p_page-1)*p_limit,p_kind;
 RETURN result||jsonb_build_object('events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.payroll_master_events e WHERE CASE WHEN p_kind='policies' THEN e.policy_revision_id ELSE e.statutory_revision_id END IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(result->'revisions') r)),'[]'::jsonb),
 'groups',(SELECT jsonb_agg(to_jsonb(g)) FROM public.payroll_groups g),'page',p_page,'limit',p_limit,'financial_workflows_enabled',false);
END; $$;
CREATE FUNCTION public.resolve_payroll_master(p_kind text,p_scope jsonb,p_date date,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE candidates jsonb; r jsonb; BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']); PERFORM public.payroll_master_table(p_kind);
 IF p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION 'Date required' USING ERRCODE='22023'; END IF;
 IF p_kind='policies' THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=p_scope->>'group_code') THEN RAISE EXCEPTION 'Unknown payroll group' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=p_scope->>'group_code' AND NOT is_permanent) THEN RETURN jsonb_build_object('error','DAILY_WAGE_MASTER_REQUIRED','revision_id',NULL,'blockers','[{"code":"DAILY_WAGE_MASTER_REQUIRED"}]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND p_date BETWEEN effective_from AND effective_to AND group_code=p_scope->>'group_code';
  IF candidates='[]'::jsonb THEN SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND p_date BETWEEN effective_from AND effective_to AND group_code IS NULL; END IF;
 ELSE
  IF nullif(btrim(p_scope->>'jurisdiction'),'') IS NULL OR nullif(btrim(p_scope->>'establishment'),'') IS NULL OR coalesce(p_scope->>'scheme','') NOT IN ('EPF','ESI','PT') THEN RETURN jsonb_build_object('error','STATUTORY_SCOPE_REQUIRED','revision_id',NULL,'blockers','[{"code":"STATUTORY_SCOPE_REQUIRED"}]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_statutory_rule_revisions x WHERE status='PUBLISHED' AND verification_status='ADVISOR_VERIFIED' AND p_date BETWEEN effective_from AND effective_to AND scheme=p_scope->>'scheme' AND jurisdiction=p_scope->>'jurisdiction' AND establishment=p_scope->>'establishment';
 END IF;
 IF jsonb_array_length(candidates)<>1 THEN RETURN jsonb_build_object('error',CASE WHEN candidates='[]'::jsonb THEN 'MISSING_POLICY' ELSE 'AMBIGUOUS_POLICY' END,'revision_id',NULL,'blockers',jsonb_build_array(jsonb_build_object('code',CASE WHEN candidates='[]'::jsonb THEN 'MISSING_POLICY' ELSE 'AMBIGUOUS_POLICY' END))); END IF;
 r:=candidates->0; RETURN jsonb_build_object('revision_id',r->'id','revision',r,'data',public.payroll_master_payload(p_kind,r),'blockers',public.payroll_validate_master(p_kind,public.payroll_master_payload(p_kind,r)),'financial_workflows_enabled',false);
END; $$;
DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['payroll_statutory_rule_revisions','payroll_professional_tax_slabs','payroll_master_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname IN ('save_payroll_master_draft','preview_payroll_master_publication','publish_payroll_master','get_payroll_master_revisions','resolve_payroll_master') OR p.proname LIKE 'payroll_master_%' OR p.proname LIKE 'payroll_check_%' OR p.proname IN ('payroll_validate_master','payroll_pt_guard')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END; $$;
REVOKE ALL ON SEQUENCE public.payroll_master_events_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_payroll_master_draft(text,uuid,integer,jsonb,uuid),public.preview_payroll_master_publication(text,uuid,uuid),
 public.publish_payroll_master(text,uuid,integer,text,text,uuid),public.get_payroll_master_revisions(text,uuid,integer,integer),public.resolve_payroll_master(text,jsonb,date,uuid) TO service_role;
NOTIFY pgrst,'reload schema';

ALTER TABLE public.payroll_policy_master_revisions ADD CONSTRAINT payroll_policy_audit_complete CHECK(status<>'PUBLISHED' OR (revision_number IS NOT NULL AND approval_reference IS NOT NULL AND published_effective_to IS NOT NULL));
ALTER TABLE public.payroll_statutory_rule_revisions ADD CONSTRAINT payroll_statutory_audit_complete CHECK(status<>'PUBLISHED' OR (revision_number IS NOT NULL AND approval_reference IS NOT NULL AND published_effective_to IS NOT NULL));
ALTER TABLE public.payroll_statutory_rule_revisions ADD CONSTRAINT payroll_statutory_verification_complete CHECK(verification_status<>'ADVISOR_VERIFIED' OR (advisor_name IS NOT NULL AND verification_reference IS NOT NULL));

CREATE UNIQUE INDEX payroll_policy_revision_number_unique ON public.payroll_policy_master_revisions(coalesce(group_code,'GLOBAL'),revision_number) WHERE status='PUBLISHED';
CREATE UNIQUE INDEX payroll_statutory_revision_number_unique ON public.payroll_statutory_rule_revisions(scheme,jurisdiction,establishment,revision_number) WHERE status='PUBLISHED';
CREATE INDEX payroll_master_policy_events_idx ON public.payroll_master_events(policy_revision_id,id) WHERE policy_revision_id IS NOT NULL;
CREATE INDEX payroll_master_statutory_events_idx ON public.payroll_master_events(statutory_revision_id,id) WHERE statutory_revision_id IS NOT NULL;
