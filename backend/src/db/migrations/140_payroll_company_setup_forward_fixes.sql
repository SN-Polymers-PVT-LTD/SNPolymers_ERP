-- Forward repair for already-applied migration 139. Do not modify 139.
-- Fix company setup writes; keep prior employee coverage without authorizing
-- new backdated scopes, scheme facts or extensions of historical coverage.
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
   AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND NEW.effective_from>=r.effective_from
   AND (r.effective_to IS NULL OR (NEW.effective_to IS NOT NULL AND NEW.effective_to<=r.effective_to))) THEN
   RAISE EXCEPTION 'Company setup needs a published % rule covering this employee interval',NEW.scheme USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END; $$;

NOTIFY pgrst,'reload schema';
