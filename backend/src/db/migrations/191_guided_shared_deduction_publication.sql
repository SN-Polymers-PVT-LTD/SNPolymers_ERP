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
 IF state_name IS NULL OR starts IS NULL OR NOT isfinite(starts)
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
   IF rule->>'shared'='true' OR p_data->>'all_factories'='true' THEN
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
 WHERE s.state_id=(draft.data->>'state_id')::uuid
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

CREATE OR REPLACE FUNCTION public.publish_payroll_guided_deduction_draft(
 p_id uuid,p_expected_version integer,p_initial boolean,p_review_token text,p_reference text,p_key uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE
 draft public.payroll_guided_deduction_drafts%ROWTYPE;
 request jsonb;
 review jsonb;
 result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF p_key IS NULL OR p_review_token IS NULL OR p_review_token !~ '^[a-f0-9]{64}$'
    OR nullif(btrim(p_reference),'') IS NULL OR length(p_reference)>2000 THEN
  RAISE EXCEPTION 'Review token, approval reference and retry key required' USING ERRCODE='22023';
 END IF;
 SELECT * INTO draft FROM public.payroll_guided_deduction_drafts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002'; END IF;
 request := jsonb_build_array(p_expected_version,p_initial,p_review_token,btrim(p_reference));
 IF draft.publication IS NOT NULL THEN
  IF draft.published_by=p_actor_id AND draft.publication_key=p_key AND draft.publication->'request'=request THEN
   RETURN draft.publication->'result';
  END IF;
  RAISE EXCEPTION 'This guided setup is already published' USING ERRCODE='PY409';
 END IF;
 review := public.review_payroll_guided_deduction_draft(p_id,p_expected_version,p_initial,p_actor_id);
 IF review->>'review_token' IS DISTINCT FROM p_review_token THEN
  RAISE EXCEPTION 'Setup changed. Review again.' USING ERRCODE='PY409';
 END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_guided_deduction_drafts d WHERE d.published_by=p_actor_id AND d.publication_key=p_key) THEN
  RAISE EXCEPTION 'Retry key already used for another publication' USING ERRCODE='PY409';
 END IF;
 result := public.run_payroll_guided_publication(draft.data,p_initial,btrim(p_reference),p_actor_id);
 IF (result->>'publishable')::boolean IS NOT TRUE THEN
  RAISE EXCEPTION 'Setup changed. Review again.' USING ERRCODE='PY409';
 END IF;
 result := jsonb_build_object('draft_id',p_id,'version',draft.version,'setup',result->'setup','setups',result->'setups');
 UPDATE public.payroll_guided_deduction_drafts
 SET published_by=p_actor_id,publication_key=p_key,publication=jsonb_build_object('request',request,'result',result)
 WHERE id=p_id;
 RETURN result;
END; $$;

