-- Shared rule identities are reserved and keep existing establishment rules local.
ALTER TABLE public.payroll_statutory_rule_revisions
 ADD CONSTRAINT payroll_shared_rule_scope CHECK (
  (lower(btrim(establishment)) <> 'shared rule' AND lower(btrim(jurisdiction)) <> 'pan india')
  OR (establishment='Shared rule' AND (
   (scheme IN ('EPF','ESI') AND jurisdiction='Pan India' AND state_id IS NULL)
   OR (scheme='PT' AND lower(btrim(jurisdiction))<>'pan india' AND state_id IS NOT NULL)
  ))
 );

ALTER TABLE public.payroll_statutory_scope_bindings
 DROP CONSTRAINT payroll_statutory_scope_bindings_pkey,
 ADD PRIMARY KEY (revision_id,statutory_scope_id);

CREATE OR REPLACE FUNCTION public.payroll_statutory_scope_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE r public.payroll_statutory_rule_revisions%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(NEW.created_by,ARRAY['accounts']);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 SELECT * INTO r FROM public.payroll_statutory_rule_revisions WHERE id=NEW.revision_id;
 IF NOT FOUND OR r.status<>'PUBLISHED' OR r.verification_status NOT IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') THEN RAISE EXCEPTION 'Only verified published revisions may be mapped' USING ERRCODE='22023'; END IF;
 IF r.scheme='PT' AND r.establishment='Shared rule' AND NOT EXISTS (
  SELECT 1 FROM public.payroll_statutory_scopes scope
  WHERE scope.id=NEW.statutory_scope_id AND (
   EXISTS (SELECT 1 FROM public.payroll_company_deduction_setups c
           WHERE c.statutory_scope_id=scope.id AND c.state_id=r.state_id)
   OR (scope.jurisdiction_code='STATE_'||upper(replace(r.state_id::text,'-',''))
       AND NOT EXISTS (SELECT 1 FROM public.payroll_company_deduction_setups c
                       WHERE c.statutory_scope_id=scope.id AND c.state_id<>r.state_id))
  )
 ) THEN RAISE EXCEPTION 'Shared Professional Tax requires a scope in the same state' USING ERRCODE='22023'; END IF;
 IF NOT ((r.scheme IN ('EPF','ESI') AND r.establishment='Shared rule' AND r.jurisdiction='Pan India' AND r.state_id IS NULL) OR (r.scheme='PT' AND r.establishment='Shared rule' AND r.state_id IS NOT NULL)) AND EXISTS (
  SELECT 1 FROM public.payroll_statutory_scope_bindings b WHERE b.revision_id=NEW.revision_id
 ) THEN RAISE EXCEPTION 'Only shared rules can bind to more than one establishment' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b JOIN public.payroll_statutory_rule_revisions x ON x.id=b.revision_id
  WHERE b.statutory_scope_id=NEW.statutory_scope_id AND x.scheme=r.scheme AND daterange(x.effective_from,x.effective_to,'[]') && daterange(r.effective_from,r.effective_to,'[]')) THEN
  RAISE EXCEPTION 'Canonical statutory scope has overlapping published revisions' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_company_deduction_options(p_state_id uuid,p_date date,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE state_name text; result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT name INTO state_name FROM public.payroll_statutory_states WHERE id=p_state_id;
 IF state_name IS NULL OR p_date IS NULL OR NOT isfinite(p_date) OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select a saved state and valid start date' USING ERRCODE='22023'; END IF;
 WITH selected AS (SELECT r.id,r.scheme,r.jurisdiction,r.establishment,r.effective_from,r.effective_to,r.revision_number,
 public.payroll_master_payload('statutory',to_jsonb(r)) data,b.statutory_scope_id
 FROM public.payroll_statutory_rule_revisions r LEFT JOIN LATERAL (SELECT statutory_scope_id FROM public.payroll_statutory_scope_bindings WHERE revision_id=r.id ORDER BY statutory_scope_id LIMIT 1) b ON NOT ((r.scheme IN ('EPF','ESI') AND r.establishment='Shared rule' AND r.jurisdiction='Pan India' AND r.state_id IS NULL) OR (r.scheme='PT' AND r.establishment='Shared rule' AND r.state_id IS NOT NULL))
 WHERE public.payroll_statutory_components_supported(r.configuration) AND r.status='PUBLISHED' AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
 AND ((r.scheme IN ('EPF','ESI') AND r.establishment='Shared rule' AND r.jurisdiction='Pan India' AND r.state_id IS NULL) OR r.state_id=p_state_id OR (r.state_id IS NULL AND lower(btrim(r.jurisdiction))=lower(state_name)))
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
  OR ((r.scheme IN ('EPF','ESI') AND r.establishment='Shared rule' AND r.jurisdiction='Pan India' AND r.state_id IS NULL) OR r.state_id=p_state_id OR (r.state_id IS NULL AND lower(btrim(r.jurisdiction))=lower(state_name))) IS NOT TRUE THEN
   RAISE EXCEPTION 'Choose a confirmed published % rule covering this state and start date',scheme_name USING ERRCODE='22023'; END IF;
  IF NOT public.payroll_statutory_components_supported(r.configuration) THEN
   RAISE EXCEPTION 'Selected % rule uses retired or unsupported wage components. Publish a supported replacement.',scheme_name USING ERRCODE='22023';
  END IF;
  existing_scope:=NULL;
  IF NOT ((r.scheme IN ('EPF','ESI') AND r.establishment='Shared rule' AND r.jurisdiction='Pan India' AND r.state_id IS NULL) OR (r.scheme='PT' AND r.establishment='Shared rule' AND r.state_id IS NOT NULL)) THEN
   SELECT statutory_scope_id INTO existing_scope FROM public.payroll_statutory_scope_bindings WHERE revision_id=rid;
  END IF;
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
 SELECT statutory_scope_id INTO scope_id FROM public.payroll_statutory_scope_bindings WHERE revision_id=(r->>'id')::uuid
 AND ((p_scope->>'statutory_scope_id') IS NOT NULL AND statutory_scope_id=(p_scope->>'statutory_scope_id')::uuid
      OR (p_scope->>'statutory_scope_id') IS NULL AND
         (SELECT count(*) FROM public.payroll_statutory_scope_bindings WHERE revision_id=(r->>'id')::uuid)=1);
 warnings:=public.payroll_master_configuration_warnings(p_kind,d);
 IF p_kind='statutory' AND scope_id IS NULL THEN warnings:=warnings||'[{"field":"statutory_scope_id","code":"CANONICAL_SCOPE_REQUIRED"}]'::jsonb; END IF;
 RETURN jsonb_build_object('kind',p_kind,'revision_id',r->'id','revision',r,'data',d,'statutory_scope_id',scope_id,
  'configuration_warnings',warnings,'blockers',CASE WHEN p_kind='policies' THEN '[]'::jsonb ELSE public.payroll_validate_master(p_kind,d) END,'financial_workflows_enabled',false);
END; $$;


NOTIFY pgrst,'reload schema';
