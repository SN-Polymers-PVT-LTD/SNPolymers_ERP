-- Replace broad source-table SHARE locks with transaction-scoped source fences.
-- Writers participate through triggers, including INSERTs and OLD/NEW identity
-- changes. All acquisitions are nonblocking: reject and retry the transaction
-- rather than waiting after an operational row lock (avoids lock inversion).
SET LOCAL search_path=public,extensions;

CREATE FUNCTION public.payroll_source_fence(p_key text,p_shared boolean) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF NOT (CASE WHEN p_shared THEN pg_try_advisory_xact_lock_shared(hashtextextended('payroll_source:'||p_key,0))
            ELSE pg_try_advisory_xact_lock(hashtextextended('payroll_source:'||p_key,0)) END) THEN
  RAISE EXCEPTION 'Payroll source is being finalized or changed; retry the transaction' USING ERRCODE='PY409';
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_source_fence(text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.payroll_source_write_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE images jsonb[]; image jsonb; keys text[]:='{}'; sheet_keys text[]:='{}'; key text; employee uuid;
BEGIN
 IF TG_OP='INSERT' THEN images:=ARRAY[to_jsonb(NEW)];
 ELSIF TG_OP='DELETE' THEN images:=ARRAY[to_jsonb(OLD)];
 ELSE images:=ARRAY[to_jsonb(OLD),to_jsonb(NEW)]; END IF;
 FOREACH image IN ARRAY images LOOP
  CASE TG_TABLE_NAME
  WHEN 'hr_attendance_sheets' THEN keys:=array_append(keys,'sheet:'||(image->>'id'));
  WHEN 'hr_attendance_rows' THEN
   keys:=array_append(keys,'employee:'||(image->>'employee_id'));
   -- Rows of OTHER employees on the same sheet can still be recorded together.
   -- A header change must coordinate with every referencing row writer.
   sheet_keys:=array_append(sheet_keys,'sheet:'||(image->>'sheet_id'));
  WHEN 'payroll_employee_statutory_profiles' THEN
   SELECT employee_id INTO employee FROM public.payroll_source_history_revisions WHERE id=(image->>'revision_id')::uuid;
   keys:=array_append(keys,'employee:'||employee::text);
  WHEN 'payroll_policy_master_revisions' THEN keys:=array_append(keys,'policy:'||coalesce(image->>'group_code','ALL'));
  WHEN 'hr_factory_wage_revisions','hr_factory_pay_rule_revisions' THEN keys:=array_append(keys,'factory:'||(image->>'employee_category'));
  WHEN 'payroll_work_calendar_days' THEN
   keys:=array_append(keys,'calendar:'||(image->>'group_code')||':'||(image->>'department')||':'||left(image->>'calendar_date',7));
  WHEN 'payroll_statutory_rule_revisions','payroll_statutory_scope_bindings','payroll_professional_tax_slabs' THEN
   -- Infrequent statutory configuration only; never an attendance/leave fence.
   -- Binding insertion must be fenced even before an applicable rule exists.
   keys:=array_append(keys,'statutory');
  WHEN 'payroll_runs' THEN keys:=array_append(keys,'run:'||(image->>'id'));
  WHEN 'beneficiary_master' THEN keys:=array_append(keys,'beneficiary:'||(image->>'id'));
  WHEN 'indian_bank_master' THEN keys:=array_append(keys,'bank:'||(image->>'id'));
  ELSE keys:=array_append(keys,'employee:'||(image->>'employee_id'));
  END CASE;
 END LOOP;
 FOR key IN SELECT DISTINCT unnest(keys) k ORDER BY k LOOP
  IF key IS NOT NULL THEN PERFORM public.payroll_source_fence(key,false); END IF;
 END LOOP;
 FOR key IN SELECT DISTINCT unnest(sheet_keys) k ORDER BY k LOOP
  IF key IS NOT NULL THEN PERFORM public.payroll_source_fence(key,true); END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_source_write_fence() FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['payroll_source_history_revisions','payroll_employee_assignments','payroll_permanent_pay_applicability',
  'hr_permanent_pay_structures','hr_attendance_rows','hr_attendance_sheets','hr_leave_requests',
  'payroll_policy_master_revisions','payroll_work_calendar_days','payroll_statutory_rule_revisions',
  'payroll_statutory_scope_bindings','payroll_employee_statutory_profiles','payroll_professional_tax_slabs',
  'hr_factory_wage_revisions','hr_factory_pay_rule_revisions','payroll_run_employees','payroll_runs',
  'payroll_adjustments','beneficiary_master','indian_bank_master'] LOOP
  EXECUTE format('CREATE TRIGGER a00_payroll_source_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.payroll_source_write_fence()',t);
 END LOOP;
END; $$;

CREATE FUNCTION public.payroll_lock_review_sources(p_employee_id uuid,p_run_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE key text; r public.payroll_runs%ROWTYPE; b uuid; bank uuid; lo date; hi date;
BEGIN
 -- Employee fence stabilizes history, profiles, leave, attendance rows, pay and
 -- monthly run membership before discovering their shared header/master scopes.
 PERFORM public.payroll_source_fence('employee:'||p_employee_id::text,true);
 PERFORM public.payroll_source_fence('run:'||p_run_id::text,true);
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id;
 lo:=date_trunc('month',r.period_from)::date;
 hi:=(date_trunc('month',r.period_to)+interval '1 month - 1 day')::date;
 FOR key IN
  SELECT 'sheet:'||sheet_id::text FROM public.hr_attendance_rows WHERE employee_id=p_employee_id
  UNION SELECT 'run:'||run_id::text FROM public.payroll_run_employees WHERE employee_id=p_employee_id
  UNION SELECT 'run:'||p_run_id::text
  UNION SELECT 'policy:ALL'
  UNION SELECT 'statutory'
  UNION SELECT 'policy:'||group_code FROM public.payroll_employee_assignments WHERE employee_id=p_employee_id
  UNION SELECT 'factory:'||employee_category FROM public.payroll_employee_assignments WHERE employee_id=p_employee_id
  UNION SELECT 'policy:'||r.group_code
  UNION SELECT 'calendar:'||r.group_code||':'||r.department||':'||to_char(m,'YYYY-MM')
    FROM generate_series(lo,hi,interval '1 month') m
  ORDER BY 1
 LOOP PERFORM public.payroll_source_fence(key,true); END LOOP;
 SELECT e.beneficiary_id,bm.beneficiary_bank_id INTO b,bank FROM public.hr_employees e LEFT JOIN public.beneficiary_master bm ON bm.id=e.beneficiary_id WHERE e.id=p_employee_id;
 IF b IS NOT NULL THEN
  PERFORM public.payroll_source_fence('beneficiary:'||b::text,true);
  -- Re-read bank identity after fencing the beneficiary: a committed bank-link
  -- change between initial read and acquisition must not evade the bank fence.
  SELECT beneficiary_bank_id INTO bank FROM public.beneficiary_master WHERE id=b;
  IF bank IS NOT NULL THEN PERFORM public.payroll_source_fence('bank:'||bank::text,true); END IF;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_lock_review_sources(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.transition_payroll_employee_review(p_row_id uuid,p_expected_version integer,
 p_expected_review_version integer,p_action text,p_data jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; r public.payroll_runs%ROWTYPE; v public.payroll_review_revisions%ROWTYPE;
 role text; factory boolean; before_state text; next_state text; action_name text; reason text;
 src jsonb; token text; calc jsonb; blockers jsonb; m date; assignment uuid; beneficiary uuid;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 PERFORM 1 FROM public.hr_employees WHERE id=(SELECT employee_id FROM public.payroll_run_employees WHERE id=p_row_id) FOR UPDATE;
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,false);
 SELECT is_factory INTO factory FROM public.payroll_groups WHERE code=r.group_code;
 IF p_expected_version IS DISTINCT FROM e.current_version OR p_expected_review_version IS DISTINCT FROM e.review_version THEN
  RAISE EXCEPTION 'Salary content/review version conflict; reload this employee' USING ERRCODE='PY409'; END IF;
 IF e.status IN ('LOCKED','CANCELLED_DRAFT') THEN RAISE EXCEPTION 'Terminal salary rows are immutable' USING ERRCODE='PY409'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('calculate','correct','submit','forward','return','approve_lock','cancel')
  OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Invalid payroll review action' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT k=ANY(CASE p_action
  WHEN 'calculate' THEN ARRAY['reason','source','calculation'] WHEN 'correct' THEN ARRAY['reason','note','assignment_id']
  WHEN 'approve_lock' THEN ARRAY['source_fingerprint','source','calculation'] WHEN 'return' THEN ARRAY['reason']
  WHEN 'cancel' THEN ARRAY['reason'] ELSE ARRAY['source_fingerprint'] END)) THEN
  RAISE EXCEPTION 'Unexpected payroll action fields' USING ERRCODE='22023'; END IF;
 before_state:=e.status; reason:=nullif(btrim(p_data->>'reason'),'');
 IF length(reason)>2000 THEN RAISE EXCEPTION 'Reason is too long' USING ERRCODE='22023'; END IF;
 SELECT erp_user_id INTO beneficiary FROM public.hr_employees WHERE id=e.employee_id FOR SHARE;
 IF p_action IN ('forward','return','approve_lock') AND beneficiary=p_actor_id THEN
  RAISE EXCEPTION 'An independent reviewer must review this employee salary' USING ERRCODE='42501'; END IF;
 -- Role and ownership checks precede source/material reads and state changes.
 IF p_action IN ('calculate','correct','submit','cancel') THEN
  IF e.created_by<>p_actor_id OR role<>(CASE WHEN factory THEN 'factory_manager' ELSE 'accounts' END) THEN
   RAISE EXCEPTION 'Only the originating payroll preparer may act' USING ERRCODE='42501'; END IF;
 ELSIF p_action='forward' THEN
  IF role<>'accounts' OR e.created_by=p_actor_id OR e.submitted_by=p_actor_id THEN RAISE EXCEPTION 'Independent Accounts review required' USING ERRCODE='42501'; END IF;
 ELSIF p_action='approve_lock' THEN
  IF role NOT IN ('ho','admin') OR p_actor_id IN (e.created_by,e.submitted_by) OR e.accounts_verified_by=p_actor_id THEN
   RAISE EXCEPTION 'Independent HO/Admin final review required' USING ERRCODE='42501'; END IF;
 ELSIF p_action='return' THEN
  IF NOT ((e.status='PENDING_ACCOUNTS_REVIEW' AND role='accounts') OR (e.status='PENDING_HO_APPROVAL' AND role IN ('ho','admin')))
   OR p_actor_id IN (e.created_by,e.submitted_by) OR e.accounts_verified_by=p_actor_id THEN
   RAISE EXCEPTION 'Only the current independent reviewer may return this employee' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action IN ('calculate','correct','return','cancel') AND reason IS NULL THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE='22023'; END IF;
 IF p_action IN ('calculate','correct','cancel') AND e.status NOT IN ('DRAFT','CALCULATED','RETURNED_TO_CREATOR') THEN
  RAISE EXCEPTION 'Only unsubmitted employees may be prepared or withdrawn' USING ERRCODE='PY409'; END IF;
 IF p_action='submit' AND e.status<>'CALCULATED' OR p_action='forward' AND e.status<>'PENDING_ACCOUNTS_REVIEW'
  OR p_action='approve_lock' AND e.status<>'PENDING_HO_APPROVAL' THEN
  RAISE EXCEPTION 'Employee is not awaiting this action' USING ERRCODE='PY409'; END IF;
 -- Serialize with source-history authors and future per-employee/month posting.
 IF p_action='approve_lock' AND public.payroll_financial_enabled() THEN
  PERFORM public.payroll_lock_review_sources(e.employee_id,e.run_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_cutoff:'||e.run_id::text,0));
  FOR m IN SELECT generate_series(date_trunc('month',e.period_from),date_trunc('month',e.period_to),interval '1 month')::date LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('payroll_employee_month:'||e.employee_id::text||':'||m::text,0));
  END LOOP;
 END IF;
 -- Returning/correcting/withdrawing must remain possible when source resolution
 -- itself is blocked (for example an oversized legacy period). They write no
 -- salary amounts; normal preparer/reviewer scope and row-version guards apply.
 IF p_action IN ('calculate','submit','forward','approve_lock') THEN
  src:=public.payroll_review_source_snapshot(e.id,p_actor_id);
  token:=encode(digest(src::text,'sha256'),'hex');
 END IF;
 SELECT * INTO v FROM public.payroll_review_revisions WHERE row_id=e.id AND revision=e.review_revision;
 IF p_action IN ('submit','forward','approve_lock') THEN
  IF v.row_id IS NULL OR v.content_version<>e.current_version OR p_data->>'source_fingerprint' IS DISTINCT FROM v.source_fingerprint OR token<>v.source_token THEN
   RAISE EXCEPTION 'Payroll sources or saved calculation changed; return, correct and recalculate this employee' USING ERRCODE='PY409'; END IF;
 END IF;
 IF p_action IN ('calculate','approve_lock') THEN
  calc:=p_data->'calculation';
  IF p_data->'source' IS DISTINCT FROM src OR jsonb_typeof(calc) IS DISTINCT FROM 'object'
   OR jsonb_typeof(calc->'blockers') IS DISTINCT FROM 'array'
   OR calc->>'row_id' IS DISTINCT FROM e.id::text OR calc->>'row_version' IS DISTINCT FROM e.current_version::text
   OR calc->>'engine_version' IS DISTINCT FROM 'PAYROLL_PREVIEW_V1'
   OR coalesce(calc->>'source_fingerprint','') !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Authoritative calculation source conflict' USING ERRCODE='PY409'; END IF;
 ELSE
  IF p_data ? 'source' OR p_data ? 'calculation' THEN RAISE EXCEPTION 'Calculation inputs are server-only' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_action='approve_lock' THEN
  IF factory AND (e.accounts_verified_by IS NULL OR e.accounts_verified_by=e.submitted_by) THEN RAISE EXCEPTION 'Independent Accounts provenance required' USING ERRCODE='42501'; END IF;
  IF NOT public.payroll_financial_enabled() THEN
   blockers:=coalesce(calc->'blockers','[]'::jsonb)||'[{"code":"FINANCIAL_FINALIZATION_DISABLED","kind":"gate"}]';
   INSERT INTO public.payroll_action_history(run_id,row_id,row_version,action,actor_id,actor_role,from_status,to_status,reason,review_version,review_revision)
   VALUES(e.run_id,e.id,e.current_version,'LOCK_BLOCKED',p_actor_id,role,e.status,e.status,'Deployment financial activation is disabled',e.review_version,e.review_revision);
   RETURN jsonb_build_object('applied',false,'code','PAYROLL_LOCK_BLOCKED','row',to_jsonb(e),'blockers',blockers,'financial_finalization_enabled',false);
  END IF;
  IF calc IS DISTINCT FROM v.calculation_snapshot THEN RAISE EXCEPTION 'Saved approved financial calculation changed' USING ERRCODE='PY409'; END IF;
  PERFORM public.payroll_finalize_employee(e.id,calc,src,p_actor_id);
  UPDATE public.payroll_run_employees SET status='LOCKED',review_version=review_version+1 WHERE id=e.id RETURNING * INTO e;
  action_name:='LOCKED';
 ELSIF p_action='calculate' THEN
  INSERT INTO public.payroll_review_revisions(row_id,revision,content_version,source_snapshot,source_token,source_fingerprint,calculation_snapshot,reason,created_by)
   VALUES(e.id,coalesce(e.review_revision,0)+1,e.current_version,src,token,calc->>'source_fingerprint',calc,reason,p_actor_id) RETURNING * INTO v;
  UPDATE public.payroll_run_employees SET status='CALCULATED',review_version=review_version+1,review_revision=v.revision,submitted_by=NULL,accounts_verified_by=NULL WHERE id=e.id RETURNING * INTO e;
  action_name:='CALCULATED';
 ELSIF p_action='correct' THEN
  IF p_data->>'note' IS NULL OR length(p_data->>'note')>2000 THEN RAISE EXCEPTION 'Correction note required' USING ERRCODE='22023'; END IF;
  assignment:=coalesce((p_data->>'assignment_id')::uuid,e.assignment_id);
  IF NOT EXISTS(SELECT 1 FROM public.payroll_employee_assignments a WHERE a.id=assignment AND a.employee_id=e.employee_id AND a.revision_id=(SELECT id FROM public.payroll_source_history_revisions WHERE employee_id=e.employee_id AND source_kind='ASSIGNMENT' ORDER BY version DESC LIMIT 1)) THEN
   RAISE EXCEPTION 'Correction requires a current evidenced assignment' USING ERRCODE='PY409'; END IF;
  UPDATE public.payroll_run_employees SET status='DRAFT',current_version=current_version+1,review_version=review_version+1,assignment_id=assignment,submitted_by=NULL,accounts_verified_by=NULL WHERE id=e.id RETURNING * INTO e;
  PERFORM public.payroll_append_draft_version(e.id,p_data->>'note',p_actor_id); action_name:='CORRECTED';
 ELSIF p_action='submit' THEN
  UPDATE public.payroll_run_employees SET status=CASE WHEN factory THEN 'PENDING_ACCOUNTS_REVIEW' ELSE 'PENDING_HO_APPROVAL' END,review_version=review_version+1,submitted_by=p_actor_id,accounts_verified_by=NULL WHERE id=e.id RETURNING * INTO e; action_name:='SUBMITTED';
 ELSIF p_action='forward' THEN
  UPDATE public.payroll_run_employees SET status='PENDING_HO_APPROVAL',review_version=review_version+1,accounts_verified_by=p_actor_id WHERE id=e.id RETURNING * INTO e; action_name:='ACCOUNTS_FORWARDED';
 ELSIF p_action='return' THEN
  UPDATE public.payroll_run_employees SET status='RETURNED_TO_CREATOR',review_version=review_version+1,accounts_verified_by=NULL,last_return_reason=reason,last_return_stage=CASE WHEN before_state='PENDING_ACCOUNTS_REVIEW' THEN 'ACCOUNTS' ELSE 'HO' END WHERE id=e.id RETURNING * INTO e; action_name:='RETURNED';
 ELSE
  UPDATE public.payroll_run_employees SET status='CANCELLED_DRAFT',review_version=review_version+1,submitted_by=NULL,accounts_verified_by=NULL WHERE id=e.id RETURNING * INTO e; action_name:='CANCELLED_DRAFT';
 END IF;
 INSERT INTO public.payroll_action_history(run_id,row_id,row_version,action,actor_id,actor_role,from_status,to_status,reason,review_version,review_revision)
  VALUES(e.run_id,e.id,e.current_version,action_name,p_actor_id,role,before_state,e.status,reason,e.review_version,e.review_revision);
 RETURN jsonb_build_object('applied',true,'row',to_jsonb(e),'financial_finalization_enabled',false);
END; $$;

NOTIFY pgrst,'reload schema';
