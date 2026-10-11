-- Additive master preparation. Legacy published payloads and labels are unchanged.
-- No production rates, canonical scopes, mappings or employee profiles are seeded.
ALTER FUNCTION public.payroll_validate_master(text,jsonb) RENAME TO payroll_validate_master_106;
CREATE FUNCTION public.payroll_validate_master(p_kind text,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE basis jsonb; k text; legacy jsonb:=d;
BEGIN
 IF p_kind='statutory' AND d->'configuration' ? 'adjustment_basis' THEN
  basis:=d->'configuration'->'adjustment_basis';
  IF jsonb_typeof(basis) IS DISTINCT FROM 'object' OR NOT basis ?& ARRAY['SALARY_ARREARS','BONUS','REIMBURSEMENT','RECOVERY']
   OR (basis-ARRAY['SALARY_ARREARS','BONUS','REIMBURSEMENT','RECOVERY'])<>'{}'::jsonb
   OR NOT coalesce(d->'configuration'->'excluded_components' ? 'ADJUSTMENTS',false) THEN
   RAISE EXCEPTION 'Typed adjustments require a complete classification and retirement of the aggregate wage basis' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['SALARY_ARREARS','BONUS','REIMBURSEMENT','RECOVERY'] LOOP
   IF jsonb_typeof(basis->k) IS DISTINCT FROM 'string' OR
    (k='RECOVERY' AND basis->>k NOT IN ('UNRESOLVED','DEDUCTION_ONLY')) OR
    (k<>'RECOVERY' AND basis->>k NOT IN ('UNRESOLVED','INCLUDE','EXCLUDE')) THEN
    RAISE EXCEPTION 'Unsupported adjustment classification: %',k USING ERRCODE='22023'; END IF;
  END LOOP;
  legacy:=jsonb_set(d,'{configuration}',(d->'configuration')-'adjustment_basis');
 END IF;
 RETURN public.payroll_validate_master_106(p_kind,legacy);
END; $$;
CREATE FUNCTION public.payroll_master_configuration_warnings(p_kind text,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE warnings jsonb; k text;
BEGIN
 warnings:=public.payroll_validate_master(p_kind,d);
 IF p_kind='statutory' THEN
  FOREACH k IN ARRAY ARRAY['SALARY_ARREARS','BONUS','REIMBURSEMENT','RECOVERY'] LOOP
   IF coalesce(d->'configuration'->'adjustment_basis'->>k,'UNRESOLVED')='UNRESOLVED' THEN
    warnings:=warnings||jsonb_build_array(jsonb_build_object('field','adjustment_basis.'||k,'code','ADJUSTMENT_CLASSIFICATION_REQUIRED'));
   END IF;
  END LOOP;
 END IF;
 RETURN warnings;
END; $$;

-- Canonical ID denotes an explicitly registered jurisdiction/establishment pair.
-- Codes identify the pair; legacy display text is never used to infer this ID.
CREATE TABLE public.payroll_statutory_scopes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 jurisdiction_code text NOT NULL CHECK(jurisdiction_code ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'),
 establishment_code text NOT NULL CHECK(establishment_code ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(jurisdiction_code,establishment_code)
);
CREATE TABLE public.payroll_statutory_scope_bindings (
 revision_id uuid PRIMARY KEY REFERENCES public.payroll_statutory_rule_revisions(id) ON DELETE RESTRICT,
 statutory_scope_id uuid NOT NULL REFERENCES public.payroll_statutory_scopes(id) ON DELETE RESTRICT,
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_statutory_scope_bindings_scope_idx ON public.payroll_statutory_scope_bindings(statutory_scope_id,revision_id);
CREATE TRIGGER payroll_statutory_scopes_immutable BEFORE UPDATE OR DELETE ON public.payroll_statutory_scopes FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();
CREATE TRIGGER payroll_statutory_scope_bindings_immutable BEFORE UPDATE OR DELETE ON public.payroll_statutory_scope_bindings FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();
CREATE FUNCTION public.register_payroll_statutory_scope(p_jurisdiction_code text,p_establishment_code text,p_evidence text,p_actor_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE rid uuid;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 INSERT INTO public.payroll_statutory_scopes(jurisdiction_code,establishment_code,evidence_reference,created_by)
 VALUES(p_jurisdiction_code,p_establishment_code,p_evidence,p_actor_id) RETURNING id INTO rid;
 RETURN rid;
END; $$;
CREATE FUNCTION public.payroll_statutory_scope_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE r public.payroll_statutory_rule_revisions%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(NEW.created_by,ARRAY['admin']);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_masters',0));
 SELECT * INTO r FROM public.payroll_statutory_rule_revisions WHERE id=NEW.revision_id;
 IF NOT FOUND OR r.status<>'PUBLISHED' OR r.verification_status<>'ADVISOR_VERIFIED' THEN RAISE EXCEPTION 'Only verified published revisions may be mapped' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b JOIN public.payroll_statutory_rule_revisions x ON x.id=b.revision_id
  WHERE b.statutory_scope_id=NEW.statutory_scope_id AND x.scheme=r.scheme AND daterange(x.effective_from,x.effective_to,'[]') && daterange(r.effective_from,r.effective_to,'[]')) THEN
  RAISE EXCEPTION 'Canonical statutory scope has overlapping published revisions' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payroll_statutory_scope_binding_guard BEFORE INSERT ON public.payroll_statutory_scope_bindings FOR EACH ROW EXECUTE FUNCTION public.payroll_statutory_scope_binding_guard();
CREATE FUNCTION public.bind_payroll_statutory_scope(p_revision_id uuid,p_scope_id uuid,p_evidence text,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 INSERT INTO public.payroll_statutory_scope_bindings(revision_id,statutory_scope_id,evidence_reference,created_by) VALUES(p_revision_id,p_scope_id,p_evidence,p_actor_id);
END; $$;

CREATE OR REPLACE FUNCTION public.preview_payroll_master_publication(p_kind text,p_id uuid,p_actor_id uuid) RETURNS jsonb
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
 RETURN jsonb_build_object('revision',r,'blockers',CASE WHEN p_kind='policies' THEN '[]'::jsonb ELSE blockers END,'configuration_warnings',public.payroll_master_configuration_warnings(p_kind,d),'conflicts',conflicts,'supersedes',v_overlaps,'diff',changed,
  'affected_draft_rows',impact,'impact_scope',CASE WHEN p_kind='statutory' THEN 'ALL_DRAFT_ROWS_IN_RANGE; EMPLOYEE_JURISDICTION_NOT_YET_MODELED' ELSE 'GROUP_AND_DATE_RANGE' END,
  'publishable',conflicts='[]'::jsonb AND (p_kind='policies' OR blockers='[]'::jsonb),
  'preview_token',md5(d::text||v_overlaps::text||impact::text||today::text),'financial_workflows_enabled',false);
END; $$;
CREATE OR REPLACE FUNCTION public.resolve_payroll_master(p_kind text,p_scope jsonb,p_date date,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE candidates jsonb; r jsonb; scope_id uuid; d jsonb; warnings jsonb; BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']); PERFORM public.payroll_master_table(p_kind);
 IF p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION 'Date required' USING ERRCODE='22023'; END IF;
 IF p_kind='policies' THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=p_scope->>'group_code') THEN RAISE EXCEPTION 'Unknown payroll group' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_groups WHERE code=p_scope->>'group_code' AND NOT is_permanent) THEN RETURN jsonb_build_object('error','DAILY_WAGE_MASTER_REQUIRED','revision_id',NULL,'blockers','[{"code":"DAILY_WAGE_MASTER_REQUIRED"}]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND p_date BETWEEN effective_from AND effective_to AND group_code=p_scope->>'group_code';
  IF candidates='[]'::jsonb THEN SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_policy_master_revisions x WHERE status='PUBLISHED' AND p_date BETWEEN effective_from AND effective_to AND group_code IS NULL; END IF;
 ELSE
  IF ((p_scope->>'statutory_scope_id') IS NULL AND (nullif(btrim(p_scope->>'jurisdiction'),'') IS NULL OR nullif(btrim(p_scope->>'establishment'),'') IS NULL)) OR coalesce(p_scope->>'scheme','') NOT IN ('EPF','ESI','PT') THEN RETURN jsonb_build_object('error','STATUTORY_SCOPE_REQUIRED','revision_id',NULL,'blockers','[{"code":"STATUTORY_SCOPE_REQUIRED"}]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO candidates FROM public.payroll_statutory_rule_revisions x WHERE status='PUBLISHED' AND verification_status='ADVISOR_VERIFIED' AND p_date BETWEEN effective_from AND effective_to AND scheme=p_scope->>'scheme' AND ((p_scope->>'statutory_scope_id' IS NOT NULL AND EXISTS(SELECT 1 FROM public.payroll_statutory_scope_bindings b WHERE b.revision_id=x.id AND b.statutory_scope_id=(p_scope->>'statutory_scope_id')::uuid)) OR (p_scope->>'statutory_scope_id' IS NULL AND jurisdiction=p_scope->>'jurisdiction' AND establishment=p_scope->>'establishment'));
 END IF;
 IF jsonb_array_length(candidates)<>1 THEN RETURN jsonb_build_object('error',CASE WHEN candidates='[]'::jsonb THEN 'MISSING_POLICY' ELSE 'AMBIGUOUS_POLICY' END,'revision_id',NULL,'blockers',jsonb_build_array(jsonb_build_object('code',CASE WHEN candidates='[]'::jsonb THEN 'MISSING_POLICY' ELSE 'AMBIGUOUS_POLICY' END))); END IF;
 r:=candidates->0; d:=public.payroll_master_payload(p_kind,r);
 SELECT statutory_scope_id INTO scope_id FROM public.payroll_statutory_scope_bindings WHERE revision_id=(r->>'id')::uuid;
 warnings:=public.payroll_master_configuration_warnings(p_kind,d);
 IF p_kind='statutory' AND scope_id IS NULL THEN warnings:=warnings||'[{"field":"statutory_scope_id","code":"CANONICAL_SCOPE_REQUIRED"}]'::jsonb; END IF;
 RETURN jsonb_build_object('kind',p_kind,'revision_id',r->'id','revision',r,'data',d,'statutory_scope_id',scope_id,
  'configuration_warnings',warnings,'blockers',CASE WHEN p_kind='policies' THEN '[]'::jsonb ELSE public.payroll_validate_master(p_kind,d) END,'financial_workflows_enabled',false);
END; $$;
ALTER TABLE public.payroll_statutory_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_statutory_scope_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_statutory_scopes,public.payroll_statutory_scope_bindings FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.payroll_validate_master(text,jsonb),public.payroll_master_configuration_warnings(text,jsonb),public.payroll_statutory_scope_binding_guard(),
 public.register_payroll_statutory_scope(text,text,text,uuid),public.bind_payroll_statutory_scope(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_payroll_statutory_scope(text,text,text,uuid),public.bind_payroll_statutory_scope(uuid,uuid,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
