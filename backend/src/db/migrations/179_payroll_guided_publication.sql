-- Publication receipts make a completed draft immutable and retries deterministic.
ALTER TABLE public.payroll_guided_deduction_drafts
 ADD COLUMN publication jsonb,
 ADD COLUMN published_by uuid REFERENCES public.authorised_users(id),
 ADD COLUMN publication_key uuid,
 ADD CONSTRAINT payroll_guided_publication_key UNIQUE (published_by, publication_key);

CREATE FUNCTION public.guard_payroll_guided_published_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.publication IS NOT NULL THEN
  RAISE EXCEPTION 'This guided setup is already published' USING ERRCODE='PY409';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payroll_guided_published_draft_guard BEFORE UPDATE ON public.payroll_guided_deduction_drafts
 FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_guided_published_draft();

-- Called only with the draft and publication locks already held. Review runs this
-- inside a subtransaction so the ordinary constraints and binding guards execute.
CREATE FUNCTION public.run_payroll_guided_publication(p_data jsonb,p_initial boolean,p_reference text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions AS $$
<<guided>>
DECLARE
 state_id uuid := (p_data->>'state_id')::uuid;
 starts date := (p_data->>'effective_from')::date;
 establishment text := btrim(p_data->>'establishment');
 state_name text;
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
 FOR scheme, rule IN SELECT key,value FROM jsonb_each(p_data->'rules') ORDER BY key LOOP
  BEGIN
   IF scheme NOT IN ('EPF','ESI','PT') OR rule->>'scheme' IS DISTINCT FROM scheme
      OR ((rule->>'effective_from')::date <= starts AND
          coalesce((rule->>'effective_to')::date,'infinity'::date) >= starts) IS NOT TRUE THEN
    RAISE EXCEPTION 'Rule must match its scheme and cover the company start date' USING ERRCODE='22023';
   END IF;
   -- Build an explicit allowlist for the existing dynamic master save RPC.
   rule := jsonb_build_object('scheme',scheme,'state_id',state_id,'jurisdiction',state_name,
      'establishment',establishment,'effective_from',rule->'effective_from','effective_to',rule->'effective_to',
      'reason',rule->'reason','configuration',rule->'configuration','slabs',rule->'slabs');
   IF EXISTS (SELECT 1 FROM public.payroll_statutory_rule_revisions r
      WHERE r.status='PUBLISHED' AND r.scheme=guided.scheme
      AND (r.state_id=guided.state_id OR lower(btrim(r.jurisdiction))=lower(state_name))
      AND lower(btrim(r.establishment))=lower(guided.establishment)
      AND (r.jurisdiction,r.establishment) IS DISTINCT FROM (state_name,guided.establishment)
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
   setup := public.save_payroll_company_deduction_setup(state_id,establishment,starts,revisions,p_reference,p_actor);
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23P01' OR SQLSTATE '23505' OR SQLSTATE 'PY409' THEN
   GET STACKED DIAGNOSTICS failure_code = RETURNED_SQLSTATE, failure_message = MESSAGE_TEXT;
   blockers := jsonb_build_array(jsonb_build_object('code',failure_code,'message',failure_message));
  END;
 END IF;
 RETURN jsonb_build_object('publishable',blockers='[]'::jsonb,'blockers',blockers,'rules',previews,'setup',setup);
END; $$;

CREATE FUNCTION public.review_payroll_guided_deduction_draft(p_id uuid,p_expected_version integer,p_initial boolean,p_actor_id uuid)
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
 AND lower(btrim(s.establishment_name))=lower(btrim(draft.data->>'establishment'));
 BEGIN
  result := public.run_payroll_guided_publication(draft.data,p_initial,'Guided setup review',p_actor_id);
  RAISE EXCEPTION USING ERRCODE='PG001', MESSAGE='Rollback guided setup review';
 EXCEPTION WHEN SQLSTATE 'PG001' THEN NULL;
 END;
 -- Generated setup and revision IDs from the simulation are never returned.
 result := (result - 'setup') || jsonb_build_object(
  'effective_from',draft.data->'effective_from','effective_to',result#>'{setup,effective_to}',
  'draft_id',p_id,'version',draft.version,'initial_setup',p_initial);
 IF (result->>'publishable')::boolean THEN
  fingerprint := encode(digest(jsonb_build_array(p_id,p_actor_id,draft.version,draft.data,scope_state,result)::text,'sha256'),'hex');
 END IF;
 RETURN result || jsonb_build_object('review_token',fingerprint);
END; $$;

CREATE FUNCTION public.publish_payroll_guided_deduction_draft(
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
 result := jsonb_build_object('draft_id',p_id,'version',draft.version,'setup',result->'setup');
 UPDATE public.payroll_guided_deduction_drafts
 SET published_by=p_actor_id,publication_key=p_key,publication=jsonb_build_object('request',request,'result',result)
 WHERE id=p_id;
 RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.guard_payroll_guided_published_draft(),
 public.run_payroll_guided_publication(jsonb,boolean,text,uuid),
 public.review_payroll_guided_deduction_draft(uuid,integer,boolean,uuid),
 public.publish_payroll_guided_deduction_draft(uuid,integer,boolean,text,text,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.review_payroll_guided_deduction_draft(uuid,integer,boolean,uuid),
 public.publish_payroll_guided_deduction_draft(uuid,integer,boolean,text,text,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
