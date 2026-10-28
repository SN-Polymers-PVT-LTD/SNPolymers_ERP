-- Accounts owns company deduction configuration and employee payroll setup.
-- Existing canonical IDs, profile history and financial snapshots are preserved.
CREATE OR REPLACE FUNCTION public.payroll_require_master_actor(k text,a uuid) RETURNS text LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF k NOT IN ('policies','statutory') OR k IS NULL THEN RAISE EXCEPTION 'Invalid master kind' USING ERRCODE='22023'; END IF;
 RETURN public.payroll_require_actor(a,CASE WHEN k='statutory' THEN ARRAY['accounts'] ELSE ARRAY['admin'] END);
END; $$;
CREATE OR REPLACE FUNCTION public.record_payroll_statutory_profiles(p_employee_id uuid,p_expected_version integer,p_intervals jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE current_version integer; rid uuid; item jsonb; s text; detail jsonb;
 category text; pay public.hr_permanent_pay_structures%ROWTYPE; pay_revision uuid; from_date date; to_date date;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
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

CREATE OR REPLACE FUNCTION public.bulk_record_payroll_statutory_profiles(p_employees jsonb,p_interval jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE item jsonb; employee public.hr_employees%ROWTYPE; profile jsonb; saved jsonb; results jsonb:='[]';
 start_date date; end_date date; code text; detail text; status_code integer;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF p_employees IS NULL OR jsonb_typeof(p_employees)<>'array' OR jsonb_array_length(p_employees) NOT BETWEEN 1 AND 100
  OR p_interval IS NULL OR jsonb_typeof(p_interval)<>'object' OR p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 2000 THEN
  RAISE EXCEPTION 'Supply 1–100 selected employees, a common interval and evidence' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x WHERE jsonb_typeof(x)<>'object'
  OR NOT x ? 'employee_id' OR NOT x ? 'expected_version' OR x->'expected_version'<>'0'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('employee_id','expected_version')))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x GROUP BY x->>'employee_id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Bulk setup accepts unique employees with no existing profile (expected version 0)' USING ERRCODE='22023';
 END IF;
 start_date:=(p_interval->>'effective_from')::date;end_date:=(p_interval->>'effective_to')::date;
 IF start_date IS NULL OR NOT isfinite(start_date) OR (end_date IS NOT NULL AND (NOT isfinite(end_date) OR end_date<start_date)) THEN
  RAISE EXCEPTION 'Invalid common effective interval' USING ERRCODE='22023';
 END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_employees) ORDER BY value->>'employee_id' LOOP
  BEGIN
   SELECT * INTO employee FROM public.hr_employees WHERE id=(item->>'employee_id')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
   IF employee.active_status<>'Active' THEN RAISE EXCEPTION 'Employee is no longer active; refresh selection' USING ERRCODE='PY409'; END IF;
   IF end_date IS NOT NULL AND employee.joining_date>end_date THEN
    RAISE EXCEPTION 'Employee joined after the selected interval' USING ERRCODE='22023';
   END IF;
   profile:=jsonb_set(p_interval,'{effective_from}',to_jsonb(greatest(start_date,employee.joining_date)::text));
   -- Reuse the audited, version-checked, canonical-scope-checked write path.
   saved:=public.record_payroll_statutory_profiles(employee.id,0,jsonb_build_array(profile),p_evidence,p_actor_id);
   results:=results||jsonb_build_array(jsonb_build_object('employee_id',employee.id,'success',true,'status',201,'effective_from',profile->>'effective_from','result',saved));
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,detail=MESSAGE_TEXT;
   status_code:=CASE WHEN code='42501' THEN 403 WHEN code='P0002' THEN 404 WHEN code IN ('PY409','23505','23P01','40P01','40001') THEN 409
    WHEN code IN ('22023','22P02','23503','23514','23502','22007','22008') THEN 400 ELSE 500 END;
   results:=results||jsonb_build_array(jsonb_build_object('employee_id',item->>'employee_id','success',false,'status',status_code,'code',code,
    'message',CASE WHEN status_code=500 THEN 'Employee profile setup failed' ELSE detail END));
  END;
 END LOOP;
 RETURN jsonb_build_object('results',results,'success',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(results) r WHERE r->>'success'='false'));
END; $$;

CREATE OR REPLACE FUNCTION public.register_payroll_statutory_scope(p_jurisdiction_code text,p_establishment_code text,p_evidence text,p_actor_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE rid uuid;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 INSERT INTO public.payroll_statutory_scopes(jurisdiction_code,establishment_code,evidence_reference,created_by)
 VALUES(p_jurisdiction_code,p_establishment_code,p_evidence,p_actor_id) RETURNING id INTO rid;
 RETURN rid;
END; $$;

CREATE OR REPLACE FUNCTION public.bind_payroll_statutory_scope(p_revision_id uuid,p_scope_id uuid,p_evidence text,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 INSERT INTO public.payroll_statutory_scope_bindings(revision_id,statutory_scope_id,evidence_reference,created_by) VALUES(p_revision_id,p_scope_id,p_evidence,p_actor_id);
END; $$;

CREATE OR REPLACE FUNCTION public.payroll_statutory_scope_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE r public.payroll_statutory_rule_revisions%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(NEW.created_by,ARRAY['accounts']);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 SELECT * INTO r FROM public.payroll_statutory_rule_revisions WHERE id=NEW.revision_id;
 IF NOT FOUND OR r.status<>'PUBLISHED' OR r.verification_status NOT IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') THEN RAISE EXCEPTION 'Only verified published revisions may be mapped' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b JOIN public.payroll_statutory_rule_revisions x ON x.id=b.revision_id
  WHERE b.statutory_scope_id=NEW.statutory_scope_id AND x.scheme=r.scheme AND daterange(x.effective_from,x.effective_to,'[]') && daterange(r.effective_from,r.effective_to,'[]')) THEN
  RAISE EXCEPTION 'Canonical statutory scope has overlapping published revisions' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.register_payroll_statutory_state(p_name text,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; clean text:=regexp_replace(btrim(p_name),'\s+',' ','g');
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF clean IS NULL OR length(clean) NOT BETWEEN 1 AND 120 OR clean !~ '^[[:alpha:]][[:alpha:] .-]*$' THEN RAISE EXCEPTION 'Enter a valid state name' USING ERRCODE='22023'; END IF;
 INSERT INTO public.payroll_statutory_states(name,created_by) VALUES(clean,p_actor_id) ON CONFLICT(name_key) DO NOTHING;
 SELECT jsonb_build_object('id',id,'name',name) INTO result FROM public.payroll_statutory_states WHERE name_key=lower(clean);
 RETURN result;
END; $$;

CREATE TABLE public.payroll_company_deduction_setups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 statutory_scope_id uuid NOT NULL REFERENCES public.payroll_statutory_scopes(id),
 state_id uuid NOT NULL REFERENCES public.payroll_statutory_states(id),
 establishment_name text NOT NULL CHECK(length(btrim(establishment_name)) BETWEEN 1 AND 120),
 effective_from date NOT NULL CHECK(isfinite(effective_from)),
 effective_to date CHECK(isfinite(effective_to) AND effective_to>=effective_from),
 epf_revision_id uuid REFERENCES public.payroll_statutory_rule_revisions(id),
 esi_revision_id uuid REFERENCES public.payroll_statutory_rule_revisions(id),
 pt_revision_id uuid REFERENCES public.payroll_statutory_rule_revisions(id),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(epf_revision_id,esi_revision_id,pt_revision_id)>0),
 CONSTRAINT payroll_company_setups_scope_start_unique UNIQUE(statutory_scope_id,effective_from)
);
CREATE INDEX payroll_company_setups_selection_idx ON public.payroll_company_deduction_setups(state_id,lower(btrim(establishment_name)),effective_from);
ALTER TABLE public.payroll_company_deduction_setups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_company_deduction_setups FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payroll_company_setups_immutable BEFORE UPDATE OR DELETE ON public.payroll_company_deduction_setups FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();

CREATE FUNCTION public.get_payroll_company_deduction_setups(p_actor_id uuid,p_search text DEFAULT '',p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF p_search IS NULL OR length(p_search)>120 OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid setup selection' USING ERRCODE='22023'; END IF;
 WITH selected AS (SELECT c.*,s.name state_name FROM public.payroll_company_deduction_setups c JOIN public.payroll_statutory_states s ON s.id=c.state_id
 WHERE strpos(lower(c.establishment_name||' '||s.name),lower(p_search))>0),
 page AS (SELECT * FROM selected ORDER BY establishment_name,state_name,effective_from DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('setups',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY establishment_name,state_name,effective_from DESC,id) FROM page p),'[]'),
 'total',(SELECT count(*) FROM selected),'page',p_page,'limit',p_limit) INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION public.get_payroll_company_deduction_options(p_state_id uuid,p_date date,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE state_name text; result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT name INTO state_name FROM public.payroll_statutory_states WHERE id=p_state_id;
 IF state_name IS NULL OR p_date IS NULL OR NOT isfinite(p_date) OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select a saved state and valid start date' USING ERRCODE='22023'; END IF;
 WITH selected AS (SELECT r.id,r.scheme,r.jurisdiction,r.establishment,r.effective_from,r.effective_to,r.revision_number,
 public.payroll_master_payload('statutory',to_jsonb(r)) data,b.statutory_scope_id
 FROM public.payroll_statutory_rule_revisions r LEFT JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=r.id
 WHERE r.status='PUBLISHED' AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
 AND (r.state_id=p_state_id OR (r.state_id IS NULL AND lower(btrim(r.jurisdiction))=lower(state_name)))
 AND p_date BETWEEN r.effective_from AND coalesce(r.effective_to,'infinity'::date)),
 page AS (SELECT * FROM selected ORDER BY scheme,establishment,effective_from DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('rules',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY scheme,establishment,effective_from DESC,id) FROM page p),'[]'),
 'total',(SELECT count(*) FROM selected),'page',p_page,'limit',p_limit) INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION public.save_payroll_company_deduction_setup(p_state_id uuid,p_establishment text,p_from date,p_rules jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE sid uuid; state_name text; target_scope uuid; existing_scope uuid; rid uuid; scheme_name text;
 r public.payroll_statutory_rule_revisions%ROWTYPE; end_date date; result public.payroll_company_deduction_setups%ROWTYPE;
 evidence text:=coalesce(nullif(btrim(p_evidence),''),'Accounts company deduction setup');
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF p_establishment IS NULL OR length(btrim(p_establishment)) NOT BETWEEN 1 AND 120 OR p_from IS NULL OR NOT isfinite(p_from)
 OR jsonb_typeof(p_rules) IS DISTINCT FROM 'object' OR p_rules='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_rules) k WHERE k NOT IN ('EPF','ESI','PT')) THEN RAISE EXCEPTION 'Enter an establishment, start date and at least one deduction rule' USING ERRCODE='22023'; END IF;
 SELECT name INTO state_name FROM public.payroll_statutory_states WHERE id=p_state_id;
 IF state_name IS NULL THEN RAISE EXCEPTION 'Select a saved state' USING ERRCODE='22023'; END IF;
 -- Same lock as publication and canonical binding guards: concurrent saves cannot create ambiguous links.
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 SELECT statutory_scope_id INTO target_scope FROM public.payroll_company_deduction_setups
 WHERE state_id=p_state_id AND lower(btrim(establishment_name))=lower(btrim(p_establishment)) ORDER BY created_at LIMIT 1;
 FOREACH scheme_name IN ARRAY ARRAY['EPF','ESI','PT'] LOOP
  IF NOT p_rules ? scheme_name THEN CONTINUE; END IF;
  rid:=(p_rules->>scheme_name)::uuid;
  SELECT * INTO r FROM public.payroll_statutory_rule_revisions WHERE id=rid;
  IF NOT FOUND OR r.scheme<>scheme_name OR r.status<>'PUBLISHED' OR r.verification_status NOT IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
  OR NOT (p_from BETWEEN r.effective_from AND coalesce(r.effective_to,'infinity'::date))
  OR (r.state_id=p_state_id OR (r.state_id IS NULL AND lower(btrim(r.jurisdiction))=lower(state_name))) IS NOT TRUE THEN
   RAISE EXCEPTION 'Choose a confirmed published % rule covering this state and start date',scheme_name USING ERRCODE='22023'; END IF;
  SELECT statutory_scope_id INTO existing_scope FROM public.payroll_statutory_scope_bindings WHERE revision_id=rid;
  IF existing_scope IS NOT NULL THEN
   IF target_scope IS NOT NULL AND target_scope<>existing_scope THEN RAISE EXCEPTION 'Selected rules belong to different company setups. Choose rules for the same establishment.' USING ERRCODE='PY409'; END IF;
   IF EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups WHERE statutory_scope_id=existing_scope AND (state_id<>p_state_id OR lower(btrim(establishment_name))<>lower(btrim(p_establishment)))) THEN
    RAISE EXCEPTION 'This rule already belongs to another establishment. Select its setup or publish a rule for this establishment.' USING ERRCODE='PY409'; END IF;
   target_scope:=existing_scope;
  END IF;
  end_date:=least(end_date,r.effective_to);
 END LOOP;
 IF target_scope IS NULL THEN
  target_scope:=public.register_payroll_statutory_scope('STATE_'||upper(replace(p_state_id::text,'-','')),'EST_'||upper(replace(gen_random_uuid()::text,'-','')),evidence,p_actor_id);
 END IF;
 FOREACH scheme_name IN ARRAY ARRAY['EPF','ESI','PT'] LOOP
  IF NOT p_rules ? scheme_name THEN CONTINUE; END IF;
  rid:=(p_rules->>scheme_name)::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups c WHERE c.statutory_scope_id=NEW.statutory_scope_id AND NEW.effective_from>=c.effective_from) THEN
   RAISE EXCEPTION 'Employee interval starts before the company setup' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings WHERE revision_id=rid AND statutory_scope_id=target_scope) THEN
   PERFORM public.bind_payroll_statutory_scope(rid,target_scope,evidence,p_actor_id);
  END IF;
 END LOOP;
 INSERT INTO public.payroll_company_deduction_setups(statutory_scope_id,state_id,establishment_name,effective_from,effective_to,epf_revision_id,esi_revision_id,pt_revision_id,evidence_reference,created_by)
 VALUES(target_scope,p_state_id,btrim(p_establishment),p_from,end_date,(p_rules->>'EPF')::uuid,(p_rules->>'ESI')::uuid,(p_rules->>'PT')::uuid,evidence,p_actor_id) RETURNING * INTO result;
 INSERT INTO public.audit_log(user_id,action,module_name,record_identifier,new_value)
 VALUES(p_actor_id::text,'COMPANY_DEDUCTION_SETUP','Payroll',result.id::text,to_jsonb(result));
 RETURN to_jsonb(result)||jsonb_build_object('state_name',state_name);
END; $$;

CREATE FUNCTION public.apply_payroll_company_deduction_setup(p_setup_id uuid,p_from date,p_employees jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE c public.payroll_company_deduction_setups%ROWTYPE; interval_data jsonb; s text; rules jsonb; owner_name text;
 evidence text:=coalesce(nullif(btrim(p_evidence),''),'Accounts employee deduction setup');
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT * INTO c FROM public.payroll_company_deduction_setups WHERE id=p_setup_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company deduction setup not found' USING ERRCODE='P0002'; END IF;
 IF p_from IS NULL OR NOT isfinite(p_from) OR p_from<c.effective_from OR (c.effective_to IS NOT NULL AND p_from>c.effective_to) THEN
  RAISE EXCEPTION 'Employee start date must fall within the company setup dates' USING ERRCODE='22023'; END IF;
 -- Do not silently omit a scheme required by any selected employee.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x JOIN public.hr_employees e ON e.id=(x->>'employee_id')::uuid
 WHERE e.employee_category<>'Local Daily-Wage Workers' AND c.pt_revision_id IS NULL) THEN RAISE EXCEPTION 'This setup needs a PT rule for the selected employees' USING ERRCODE='22023'; END IF;
 SELECT coalesce(nullif(display_name,''),'Accounts') INTO owner_name FROM public.authorised_users WHERE id=p_actor_id;
 rules:='{}';
 FOREACH s IN ARRAY ARRAY['EPF','ESI','PT'] LOOP
  rules:=rules||jsonb_build_object(s,jsonb_build_object('statutory_scope_id',CASE WHEN to_jsonb(c)->>(lower(s)||'_revision_id') IS NOT NULL THEN c.statutory_scope_id ELSE NULL END,'applicability','APPLICABLE','enrolled',null,'basis_reference',evidence));
 END LOOP;
 interval_data:=jsonb_build_object('effective_from',p_from,'effective_to',c.effective_to,'verification_status','ACCOUNTS_CONFIRMED',
 'advisor_name',owner_name,'verification_reference',evidence,'verified_on',(now() AT TIME ZONE 'Asia/Kolkata')::date,'schemes',rules);
 -- Existing RPC clips joining dates, derives enrolment, rejects stale versions and reports each employee independently.
 RETURN public.bulk_record_payroll_statutory_profiles(p_employees,interval_data,evidence,p_actor_id);
END; $$;

REVOKE ALL ON FUNCTION public.get_payroll_company_deduction_setups(uuid,text,integer,integer),public.get_payroll_company_deduction_options(uuid,date,uuid,integer,integer),public.save_payroll_company_deduction_setup(uuid,text,date,jsonb,text,uuid),public.apply_payroll_company_deduction_setup(uuid,date,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_company_deduction_setups(uuid,text,integer,integer),public.get_payroll_company_deduction_options(uuid,date,uuid,integer,integer),public.save_payroll_company_deduction_setup(uuid,text,date,jsonb,text,uuid),public.apply_payroll_company_deduction_setup(uuid,date,jsonb,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
-- A named setup cannot create a confirmed employee profile with a missing/expired scheme.
CREATE FUNCTION public.payroll_guard_company_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF NEW.applicability='APPLICABLE' AND NEW.statutory_scope_id IS NULL THEN
  RAISE EXCEPTION 'Select a company deduction setup with the required % rule',NEW.scheme USING ERRCODE='22023';
 END IF;
 IF NEW.applicability='APPLICABLE' AND EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups WHERE statutory_scope_id=NEW.statutory_scope_id) THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups c WHERE c.statutory_scope_id=NEW.statutory_scope_id AND NEW.effective_from>=c.effective_from) THEN
   RAISE EXCEPTION 'Employee interval starts before the company setup' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b JOIN public.payroll_statutory_rule_revisions r ON r.id=b.revision_id
   WHERE b.statutory_scope_id=NEW.statutory_scope_id AND r.scheme=NEW.scheme AND r.status='PUBLISHED'
   AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND NEW.effective_from>=r.effective_from
   AND (r.effective_to IS NULL OR (NEW.effective_to IS NOT NULL AND NEW.effective_to<=r.effective_to))) THEN
   RAISE EXCEPTION 'Company setup needs a published % rule covering this employee interval',NEW.scheme USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_guard_company_profile() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER z_payroll_company_profile BEFORE INSERT ON public.payroll_employee_statutory_profiles FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_company_profile();
