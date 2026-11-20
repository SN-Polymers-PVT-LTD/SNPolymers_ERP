-- Forward fix after component retirement: selection, save and application must
-- agree with the active component contract. Preserve published rules and history.

-- Reject retired or malformed component partitions without rewriting audit rows.
CREATE OR REPLACE FUNCTION public.payroll_statutory_components_supported(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE included text[]; excluded text[];
BEGIN
 IF jsonb_typeof(c->'included_components') IS DISTINCT FROM 'array'
  OR jsonb_typeof(c->'excluded_components') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 SELECT coalesce(array_agg(x),'{}') INTO included FROM jsonb_array_elements_text(c->'included_components') x;
 SELECT coalesce(array_agg(x),'{}') INTO excluded FROM jsonb_array_elements_text(c->'excluded_components') x;
 RETURN cardinality(included)>0 AND cardinality(included)+cardinality(excluded)=5
  AND (SELECT count(DISTINCT x)=5 FROM unnest(included||excluded) x)
  AND NOT EXISTS(SELECT 1 FROM unnest(included||excluded) x
   WHERE x IS NULL OR x NOT IN ('PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'));
END; $$;
REVOKE ALL ON FUNCTION public.payroll_statutory_components_supported(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_payroll_company_deduction_options(p_state_id uuid,p_date date,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE state_name text; result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT name INTO state_name FROM public.payroll_statutory_states WHERE id=p_state_id;
 IF state_name IS NULL OR p_date IS NULL OR NOT isfinite(p_date) OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select a saved state and valid start date' USING ERRCODE='22023'; END IF;
 WITH selected AS (SELECT r.id,r.scheme,r.jurisdiction,r.establishment,r.effective_from,r.effective_to,r.revision_number,
 public.payroll_master_payload('statutory',to_jsonb(r)) data,b.statutory_scope_id
 FROM public.payroll_statutory_rule_revisions r LEFT JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=r.id
 WHERE public.payroll_statutory_components_supported(r.configuration) AND r.status='PUBLISHED' AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
 AND (r.state_id=p_state_id OR (r.state_id IS NULL AND lower(btrim(r.jurisdiction))=lower(state_name)))
 AND p_date BETWEEN r.effective_from AND coalesce(r.effective_to,'infinity'::date)),
 page AS (SELECT * FROM selected ORDER BY scheme,establishment,effective_from DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('rules',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY scheme,establishment,effective_from DESC,id) FROM page p),'[]'),
 'total',(SELECT count(*) FROM selected),'page',p_page,'limit',p_limit) INTO result;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.save_payroll_company_deduction_setup(p_state_id uuid,p_establishment text,p_from date,p_rules jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
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
  IF NOT public.payroll_statutory_components_supported(r.configuration) THEN
   RAISE EXCEPTION 'Selected % rule uses retired or unsupported wage components. Publish a supported replacement.',scheme_name USING ERRCODE='22023';
  END IF;
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

CREATE OR REPLACE FUNCTION public.apply_payroll_company_deduction_setup(p_setup_id uuid,p_from date,p_employees jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE c public.payroll_company_deduction_setups%ROWTYPE; interval_data jsonb; s text; rules jsonb; owner_name text;
 evidence text:=coalesce(nullif(btrim(p_evidence),''),'Accounts employee deduction setup');
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT * INTO c FROM public.payroll_company_deduction_setups WHERE id=p_setup_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company deduction setup not found' USING ERRCODE='P0002'; END IF;
 IF p_from IS NULL OR NOT isfinite(p_from) OR p_from<c.effective_from OR (c.effective_to IS NOT NULL AND p_from>c.effective_to) THEN
  RAISE EXCEPTION 'Employee start date must fall within the company setup dates' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[c.epf_revision_id,c.esi_revision_id,c.pt_revision_id]) selected(id)
  LEFT JOIN public.payroll_statutory_rule_revisions r ON r.id=selected.id
  WHERE selected.id IS NOT NULL AND NOT public.payroll_statutory_components_supported(r.configuration)) THEN
  RAISE EXCEPTION 'Company setup uses retired or unsupported wage components. Create a setup with supported replacement rules.' USING ERRCODE='22023';
 END IF;
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

CREATE OR REPLACE FUNCTION public.payroll_guard_company_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF NEW.applicability='APPLICABLE' AND NEW.statutory_scope_id IS NULL THEN
  RAISE EXCEPTION 'Select a company deduction setup with the required % rule',NEW.scheme USING ERRCODE='22023';
 END IF;
 -- Complete-timeline saves reinsert historical rows into a new immutable revision.
 -- Preserve only facts covered by the immediately preceding revision, never a
 -- superseded older revision or an extension of its effective coverage.
 IF EXISTS(
  SELECT 1 FROM public.payroll_source_history_revisions current_h
  JOIN public.payroll_source_history_revisions previous_h
   ON previous_h.employee_id=current_h.employee_id AND previous_h.source_kind='STATUTORY_PROFILE'
   AND previous_h.version=current_h.version-1
  JOIN public.payroll_employee_statutory_profiles previous_p ON previous_p.revision_id=previous_h.id
  WHERE current_h.id=NEW.revision_id AND current_h.employee_id=NEW.employee_id AND current_h.source_kind='STATUTORY_PROFILE'
   AND previous_p.scheme=NEW.scheme
   AND (previous_p.statutory_scope_id,previous_p.applicability,previous_p.enrolled)
       IS NOT DISTINCT FROM (NEW.statutory_scope_id,NEW.applicability,NEW.enrolled)
   AND daterange(previous_p.effective_from,previous_p.effective_to,'[]') @> daterange(NEW.effective_from,NEW.effective_to,'[]')
   AND (NEW.verification_status='UNVERIFIED' OR previous_p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'))
 ) THEN RETURN NEW; END IF;
 IF NEW.applicability='APPLICABLE' AND EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups WHERE statutory_scope_id=NEW.statutory_scope_id) THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups c WHERE c.statutory_scope_id=NEW.statutory_scope_id AND NEW.effective_from>=c.effective_from) THEN
   RAISE EXCEPTION 'Employee interval starts before the company setup' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b JOIN public.payroll_statutory_rule_revisions r ON r.id=b.revision_id
   WHERE b.statutory_scope_id=NEW.statutory_scope_id AND r.scheme=NEW.scheme AND r.status='PUBLISHED'
   AND public.payroll_statutory_components_supported(r.configuration)
   AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND NEW.effective_from>=r.effective_from
   AND (r.effective_to IS NULL OR (NEW.effective_to IS NOT NULL AND NEW.effective_to<=r.effective_to))) THEN
   RAISE EXCEPTION 'Company setup needs a published % rule covering this employee interval',NEW.scheme USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END; $$;

NOTIFY pgrst,'reload schema';
