-- Share the cutoff read fence across employee finalizers while retaining
-- exclusive cutoff changes and existing employee/month posting serialization.
SET LOCAL search_path=public,extensions;

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
  -- Finalizers share the cutoff fence; the existing cutoff writer remains
  -- exclusive. Different employees on one sheet must not serialize here.
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('payroll_cutoff:'||e.run_id::text,0)) THEN
   RAISE EXCEPTION 'Payroll cutoff is being changed; retry the transaction' USING ERRCODE='PY409';
  END IF;
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
