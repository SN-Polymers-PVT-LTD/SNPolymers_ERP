ALTER TABLE public.payroll_company_deduction_setups ALTER COLUMN state_id DROP NOT NULL;
ALTER TABLE public.payroll_company_deduction_setups ADD CONSTRAINT payroll_company_setup_pt_requires_state
 CHECK (state_id IS NOT NULL OR pt_revision_id IS NULL);

CREATE OR REPLACE FUNCTION public.get_payroll_company_deduction_setups(p_actor_id uuid,p_search text DEFAULT '',p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF p_search IS NULL OR length(p_search)>120 OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid setup selection' USING ERRCODE='22023'; END IF;
 WITH selected AS (SELECT c.*,coalesce(s.name,'Pan India') state_name FROM public.payroll_company_deduction_setups c LEFT JOIN public.payroll_statutory_states s ON s.id=c.state_id
 WHERE strpos(lower(c.establishment_name||' '||coalesce(s.name,'Pan India')),lower(p_search))>0),
 page AS (SELECT * FROM selected ORDER BY establishment_name,state_name,effective_from DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('setups',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY establishment_name,state_name,effective_from DESC,id) FROM page p),'[]'),
 'total',(SELECT count(*) FROM selected),'page',p_page,'limit',p_limit) INTO result;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_company_deduction_options(p_state_id uuid,p_date date,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE state_name text; result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT name INTO state_name FROM public.payroll_statutory_states WHERE id=p_state_id;
 IF (p_state_id IS NOT NULL AND state_name IS NULL) OR p_date IS NULL OR NOT isfinite(p_date) OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select a saved state and valid start date' USING ERRCODE='22023'; END IF;
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
 IF p_state_id IS NULL AND p_rules ? 'PT' OR p_state_id IS NOT NULL AND state_name IS NULL THEN RAISE EXCEPTION 'Select a saved state' USING ERRCODE='22023'; END IF;
 -- Same lock as publication and canonical binding guards: concurrent saves cannot create ambiguous links.
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 SELECT statutory_scope_id INTO target_scope FROM public.payroll_company_deduction_setups
 WHERE state_id IS NOT DISTINCT FROM p_state_id AND lower(btrim(establishment_name))=lower(btrim(p_establishment)) ORDER BY created_at LIMIT 1;
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
   IF EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups WHERE statutory_scope_id=existing_scope AND (state_id IS DISTINCT FROM p_state_id OR lower(btrim(establishment_name))<>lower(btrim(p_establishment)))) THEN
    RAISE EXCEPTION 'This rule already belongs to another establishment. Select its setup or publish a rule for this establishment.' USING ERRCODE='PY409'; END IF;
   target_scope:=existing_scope;
  END IF;
  end_date:=least(end_date,r.effective_to);
 END LOOP;
 IF target_scope IS NULL THEN
  target_scope:=public.register_payroll_statutory_scope(coalesce('STATE_'||upper(replace(p_state_id::text,'-','')),'PAN_INDIA'),'EST_'||upper(replace(gen_random_uuid()::text,'-','')),evidence,p_actor_id);
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
 RETURN to_jsonb(result)||jsonb_build_object('state_name',coalesce(state_name,'Pan India'));
END; $$;

-- Review and publish shared rules and factory batches through the same locked transaction.
CREATE OR REPLACE FUNCTION public.run_payroll_guided_publication(p_data jsonb,p_initial boolean,p_reference text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions AS $$
<<guided>>
DECLARE
 state_id uuid := (p_data->>'state_id')::uuid;
 starts date := (p_data->>'effective_from')::date;
 establishment text := btrim(p_data->>'establishment');
 state_name text;
 rule_state uuid;
 rule_jurisdiction text;
 rule_establishment text;
 target text;
 targets text[];
 setups jsonb := '[]'::jsonb;
 reused public.payroll_statutory_rule_revisions%ROWTYPE;
 scheme text;
 rule jsonb;
 saved jsonb;
 preview jsonb;
 previews jsonb := '{}'::jsonb;
 revisions jsonb := '{}'::jsonb;
 blockers jsonb := '[]'::jsonb;
 setup jsonb;
 failure_code text;
 failure_message text;
BEGIN
 SELECT s.name INTO state_name FROM public.payroll_statutory_states s WHERE s.id=state_id;
 IF (state_name IS NULL AND (state_id IS NOT NULL OR p_data->>'pan_india' IS DISTINCT FROM 'true' OR p_data->'rules' ? 'PT')) OR starts IS NULL OR NOT isfinite(starts)
   OR nullif(establishment,'') IS NULL
   OR jsonb_typeof(p_data->'rules') IS DISTINCT FROM 'object'
   OR p_data->'rules' = '{}'::jsonb THEN
  RAISE EXCEPTION 'Invalid company setup scope or rules' USING ERRCODE='22023';
 END IF;
 targets := CASE WHEN p_data->>'all_factories'='true' THEN ARRAY['Fabric Factory','S.N. Polymers Factory'] ELSE ARRAY[establishment] END;
 FOR scheme, rule IN SELECT key,value FROM jsonb_each(p_data->'rules') ORDER BY key LOOP
  BEGIN
   IF rule ? 'revision_id' THEN
    SELECT * INTO reused FROM public.payroll_statutory_rule_revisions WHERE id=(rule->>'revision_id')::uuid;
    IF NOT FOUND OR reused.scheme IS DISTINCT FROM scheme
       OR (reused.establishment <> 'Shared rule' AND (p_data->>'all_factories'='true'
           OR lower(btrim(reused.establishment))<>lower(establishment))) THEN
     RAISE EXCEPTION 'Select a published rule for this scheme' USING ERRCODE='22023';
    END IF;
    revisions := revisions || jsonb_build_object(scheme,reused.id);
    previews := previews || jsonb_build_object(scheme,jsonb_build_object('reused',true,'rule',public.payroll_master_payload('statutory',to_jsonb(reused))));
    CONTINUE;
   END IF;
   IF scheme NOT IN ('EPF','ESI','PT') OR rule->>'scheme' IS DISTINCT FROM scheme
      OR ((rule->>'effective_from')::date <= starts AND
          coalesce((rule->>'effective_to')::date,'infinity'::date) >= starts) IS NOT TRUE THEN
    RAISE EXCEPTION 'Rule must match its scheme and cover the company start date' USING ERRCODE='22023';
   END IF;
   rule_state := state_id;
   rule_jurisdiction := state_name;
   rule_establishment := establishment;
   IF state_id IS NULL OR rule->>'shared'='true' OR p_data->>'all_factories'='true' THEN
    rule_establishment := 'Shared rule';
    IF scheme IN ('EPF','ESI') THEN
     rule_state := NULL;
     rule_jurisdiction := 'Pan India';
    END IF;
   END IF;
   -- Build an explicit allowlist for the existing dynamic master save RPC.
   rule := jsonb_build_object('scheme',scheme,'state_id',rule_state,'jurisdiction',rule_jurisdiction,
      'establishment',rule_establishment,'effective_from',rule->'effective_from','effective_to',rule->'effective_to',
      'reason',rule->'reason','configuration',rule->'configuration','slabs',rule->'slabs');
   IF EXISTS (SELECT 1 FROM public.payroll_statutory_rule_revisions r
      WHERE r.status='PUBLISHED' AND r.scheme=guided.scheme
      AND (r.state_id=rule_state OR lower(btrim(r.jurisdiction))=lower(rule_jurisdiction))
      AND lower(btrim(r.establishment))=lower(rule_establishment)
      AND (r.jurisdiction,r.establishment) IS DISTINCT FROM (rule_jurisdiction,rule_establishment)
      AND daterange(r.effective_from,r.effective_to,'[]') &&
          daterange((rule->>'effective_from')::date,(rule->>'effective_to')::date,'[]')) THEN
    RAISE EXCEPTION 'An overlapping rule uses a different establishment or jurisdiction spelling' USING ERRCODE='23P01';
   END IF;
   saved := public.save_payroll_master_draft('statutory',NULL,0,rule,p_actor);
   IF p_initial AND (saved->>'effective_from')::date <= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    preview := public.preview_payroll_initial_master('statutory',(saved->>'id')::uuid,p_actor);
   ELSE
    preview := public.preview_payroll_master_publication('statutory',(saved->>'id')::uuid,p_actor);
   END IF;
   previews := previews || jsonb_build_object(scheme, preview - ARRAY['revision','diff','preview_token']
      || jsonb_build_object('rule',rule,'fingerprint',preview->'preview_token'));
   IF (preview->>'publishable')::boolean IS NOT TRUE THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('scheme',scheme,'code','RULE_NOT_PUBLISHABLE'));
   ELSIF (preview->>'initial_setup')::boolean THEN
    saved := public.publish_payroll_initial_master('statutory',(saved->>'id')::uuid,(saved->>'version')::integer,preview->>'preview_token',p_reference,p_actor);
   ELSE
    saved := public.publish_payroll_master('statutory',(saved->>'id')::uuid,(saved->>'version')::integer,preview->>'preview_token',p_reference,p_actor);
   END IF;
   revisions := revisions || jsonb_build_object(scheme,saved->'id');
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23P01' OR SQLSTATE '23514' OR SQLSTATE '23502'
    OR SQLSTATE '23505' OR SQLSTATE '22007' OR SQLSTATE '22008' OR SQLSTATE '22P02' THEN
   GET STACKED DIAGNOSTICS failure_code = RETURNED_SQLSTATE, failure_message = MESSAGE_TEXT;
   blockers := blockers || jsonb_build_array(jsonb_build_object('scheme',scheme,'code',failure_code,'message',failure_message));
  END;
 END LOOP;
 IF blockers = '[]'::jsonb THEN
  BEGIN
   FOREACH target IN ARRAY targets LOOP
    setup := public.save_payroll_company_deduction_setup(state_id,target,starts,revisions,p_reference,p_actor);
    setups := setups || jsonb_build_array(setup);
   END LOOP;
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23P01' OR SQLSTATE '23505' OR SQLSTATE 'PY409' THEN
   GET STACKED DIAGNOSTICS failure_code = RETURNED_SQLSTATE, failure_message = MESSAGE_TEXT;
   blockers := jsonb_build_array(jsonb_build_object('code',failure_code,'message',failure_message,'establishment',target));
  END;
 END IF;
 RETURN jsonb_build_object('publishable',blockers='[]'::jsonb,'blockers',blockers,'rules',previews,'setup',setups->0,'setups',setups);
END; $$;

CREATE OR REPLACE FUNCTION public.review_payroll_guided_deduction_draft(p_id uuid,p_expected_version integer,p_initial boolean,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE
 draft public.payroll_guided_deduction_drafts%ROWTYPE;
 result jsonb;
 scope_state jsonb;
 fingerprint text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT * INTO draft FROM public.payroll_guided_deduction_drafts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002'; END IF;
 IF draft.version IS DISTINCT FROM p_expected_version OR draft.publication IS NOT NULL THEN
  RAISE EXCEPTION 'Draft changed or was published' USING ERRCODE='PY409';
 END IF;
 IF p_initial THEN LOCK TABLE public.payroll_run_employees IN SHARE ROW EXCLUSIVE MODE; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.created_at,s.id),'[]') INTO scope_state
 FROM public.payroll_company_deduction_setups s
 WHERE s.state_id IS NOT DISTINCT FROM (draft.data->>'state_id')::uuid
 AND CASE WHEN draft.data->>'all_factories'='true' THEN lower(btrim(s.establishment_name)) IN ('fabric factory','s.n. polymers factory')
          ELSE lower(btrim(s.establishment_name))=lower(btrim(draft.data->>'establishment')) END;
 BEGIN
  result := public.run_payroll_guided_publication(draft.data,p_initial,'Guided setup review',p_actor_id);
  RAISE EXCEPTION USING ERRCODE='PG001', MESSAGE='Rollback guided setup review';
 EXCEPTION WHEN SQLSTATE 'PG001' THEN NULL;
 END;
 -- Generated setup and revision IDs from the simulation are never returned.
 result := (result - ARRAY['setup','setups']) || jsonb_build_object(
  'effective_from',draft.data->'effective_from','effective_to',result#>'{setup,effective_to}',
  'draft_id',p_id,'version',draft.version,'initial_setup',p_initial);
 IF (result->>'publishable')::boolean THEN
  fingerprint := encode(digest(jsonb_build_array(p_id,p_actor_id,draft.version,draft.data,scope_state,result)::text,'sha256'),'hex');
 END IF;
 RETURN result || jsonb_build_object('review_token',fingerprint);
END; $$;

