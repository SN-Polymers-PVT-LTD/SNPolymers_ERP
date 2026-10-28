-- Explicit historical initialization; existing publications and audit history remain immutable.
-- No test clock, deployment flag, or unrestricted backdating path is introduced.
CREATE OR REPLACE FUNCTION public.payroll_initial_master_conflicts(p_kind text,p_revision jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE conflicts jsonb:='[]'; existing boolean;
BEGIN
 IF extract(day FROM (p_revision->>'effective_from')::date)<>1 OR (p_revision->>'effective_from')::date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
  conflicts:=conflicts||'[{"code":"INITIAL_MONTH_START_REQUIRED"}]';
 END IF;
 IF p_kind='statutory' THEN
  SELECT EXISTS(SELECT 1 FROM public.payroll_statutory_rule_revisions WHERE status='PUBLISHED'
   AND scheme=p_revision->>'scheme' AND lower(btrim(jurisdiction))=lower(btrim(p_revision->>'jurisdiction'))
   AND lower(btrim(establishment))=lower(btrim(p_revision->>'establishment'))) INTO existing;
 ELSE
  -- A global policy affects every permanent group; specific policies inherit global coverage.
  SELECT EXISTS(SELECT 1 FROM public.payroll_policy_master_revisions WHERE status='PUBLISHED'
   AND (group_code IS NULL OR p_revision->>'group_code' IS NULL OR group_code=p_revision->>'group_code')) INTO existing;
 END IF;
 IF existing THEN conflicts:=conflicts||'[{"code":"INITIAL_SETUP_ALREADY_PUBLISHED"}]'; END IF;
 -- Statutory row scope is not reliably modeled before initialization, so protect all locked rows in range.
 IF EXISTS(SELECT 1 FROM public.payroll_run_employees e JOIN public.payroll_runs r ON r.id=e.run_id
   JOIN public.payroll_groups g ON g.code=r.group_code WHERE e.status='LOCKED'
   AND daterange(e.period_from,e.period_to,'[]') && daterange((p_revision->>'effective_from')::date,(p_revision->>'effective_to')::date,'[]')
   AND (p_kind='statutory' OR (g.is_permanent AND (p_revision->>'group_code' IS NULL OR r.group_code=p_revision->>'group_code')))) THEN
  conflicts:=conflicts||'[{"code":"INITIAL_SETUP_LOCKED_PAYROLL"}]';
 END IF;
 RETURN conflicts;
END; $$;

CREATE OR REPLACE FUNCTION public.payroll_master_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE k text; d jsonb; today date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; blockers jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Master history cannot be deleted' USING ERRCODE='42501'; END IF;
 k:=CASE WHEN TG_TABLE_NAME='payroll_policy_master_revisions' THEN 'policies' ELSE 'statutory' END;
 IF TG_OP='UPDATE' AND OLD.status='PUBLISHED' THEN
  IF (to_jsonb(NEW)-'effective_to') IS DISTINCT FROM (to_jsonb(OLD)-'effective_to') OR NEW.effective_to IS NULL OR (OLD.effective_to IS NOT NULL AND NEW.effective_to>=OLD.effective_to) OR NEW.effective_to<today THEN
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
  IF current_setting('payroll.initial_master',true)='on' THEN
   IF public.payroll_initial_master_conflicts(k,to_jsonb(NEW))<>'[]'::jsonb THEN RAISE EXCEPTION 'Initial publication conflicts with existing rules, locked payroll or month boundaries' USING ERRCODE='22023'; END IF;
  ELSIF NEW.effective_from<=today OR extract(day FROM NEW.effective_from)<>1 THEN RAISE EXCEPTION 'Publication requires a future month start; mid-month semantics are unsupported' USING ERRCODE='22023'; END IF;
  IF k='statutory' AND (blockers<>'[]'::jsonb OR (to_jsonb(NEW)->>'verified_on')::date>today) THEN RAISE EXCEPTION 'Unverified, incomplete or unsupported statutory configuration' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
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
  IF item->>'effective_from'>=r->>'effective_from' OR coalesce((item->>'effective_to')::date,'infinity'::date)>coalesce((r->>'effective_to')::date,'infinity'::date) OR jsonb_array_length(v_overlaps)>1 THEN conflicts:=conflicts||jsonb_build_array(item->>'id'); END IF;
 END LOOP;
 IF current_setting('payroll.initial_master',true)='on' THEN
  conflicts:=conflicts||public.payroll_initial_master_conflicts(p_kind,r);
 ELSIF (r->>'effective_from')::date<=today OR extract(day FROM (r->>'effective_from')::date)<>1 THEN conflicts:=conflicts||'[{"code":"FUTURE_MONTH_START_REQUIRED"}]'; END IF;
 IF p_kind='statutory' AND (r->>'verified_on')::date>today THEN conflicts:=conflicts||'[{"code":"VERIFICATION_DATE_IN_FUTURE"}]'; END IF;
 before_data:=CASE WHEN jsonb_array_length(v_overlaps)>0 THEN public.payroll_master_payload(p_kind,v_overlaps->0) ELSE '{}'::jsonb END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('field',key,'before',before_data->key,'after',value)),'[]') INTO changed FROM jsonb_each(d) WHERE value IS DISTINCT FROM before_data->key;
 SELECT count(*) INTO impact FROM public.payroll_run_employees e JOIN public.payroll_runs run ON run.id=e.run_id JOIN public.payroll_groups g ON g.code=run.group_code
  WHERE daterange(e.period_from,e.period_to,'[]') && daterange((r->>'effective_from')::date,(r->>'effective_to')::date,'[]') AND (p_kind='statutory' OR (g.is_permanent AND (r->>'group_code' IS NULL OR run.group_code=r->>'group_code')));
 RETURN jsonb_build_object('revision',r,'blockers',CASE WHEN p_kind='policies' THEN '[]'::jsonb ELSE blockers END,'configuration_warnings',public.payroll_master_configuration_warnings(p_kind,d),'conflicts',conflicts,'supersedes',v_overlaps,'diff',changed,
  'affected_draft_rows',impact,'impact_scope',CASE WHEN p_kind='statutory' THEN 'ALL_DRAFT_ROWS_IN_RANGE; EMPLOYEE_JURISDICTION_NOT_YET_MODELED' ELSE 'GROUP_AND_DATE_RANGE' END,
  'publishable',conflicts='[]'::jsonb AND (p_kind='policies' OR blockers='[]'::jsonb),
  'initial_setup',coalesce(current_setting('payroll.initial_master',true)='on',false),
  'preview_token',md5(d::text||v_overlaps::text||impact::text||today::text||coalesce(current_setting('payroll.initial_master',true),'off')||conflicts::text),'financial_workflows_enabled',false);
END; $$;

CREATE OR REPLACE FUNCTION public.preview_payroll_initial_master(p_kind text,p_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; previous text:=coalesce(current_setting('payroll.initial_master',true),'off');
BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id);
 -- Serialize with all employee-row mutations, including financial finalization.
 LOCK TABLE public.payroll_run_employees IN SHARE ROW EXCLUSIVE MODE;
 PERFORM set_config('payroll.initial_master','on',true);
 result:=public.preview_payroll_master_publication(p_kind,p_id,p_actor_id);
 PERFORM set_config('payroll.initial_master',previous,true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('payroll.initial_master',previous,true); RAISE;
END; $$;

CREATE OR REPLACE FUNCTION public.publish_payroll_initial_master(p_kind text,p_id uuid,p_expected_version integer,p_preview_token text,p_approval_reference text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; previous text:=coalesce(current_setting('payroll.initial_master',true),'off');
BEGIN
 PERFORM public.payroll_require_master_actor(p_kind,p_actor_id);
 LOCK TABLE public.payroll_run_employees IN SHARE ROW EXCLUSIVE MODE;
 PERFORM set_config('payroll.initial_master','on',true);
 -- Existing RPC rechecks scope, locked rows, token, CAS, evidence, authorization and the trigger.
 -- Its immutable PUBLISHED event includes initial_setup=true in the preview snapshot.
 result:=public.publish_payroll_master(p_kind,p_id,p_expected_version,p_preview_token,p_approval_reference,p_actor_id);
 PERFORM set_config('payroll.initial_master',previous,true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('payroll.initial_master',previous,true); RAISE;
END; $$;

REVOKE ALL ON FUNCTION public.payroll_initial_master_conflicts(text,jsonb),public.preview_payroll_initial_master(text,uuid,uuid),public.publish_payroll_initial_master(text,uuid,integer,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_payroll_initial_master(text,uuid,uuid),public.publish_payroll_initial_master(text,uuid,integer,text,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
