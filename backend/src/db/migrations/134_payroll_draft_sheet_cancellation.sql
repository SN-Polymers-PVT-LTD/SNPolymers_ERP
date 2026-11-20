-- Delete draft sheets by cancellation, preserving all salary/audit evidence.
ALTER TABLE public.payroll_runs DROP CONSTRAINT payroll_runs_status_check;
ALTER TABLE public.payroll_runs ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN cancelled_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 ADD COLUMN cancellation_reason text;
ALTER TABLE public.payroll_runs ADD CONSTRAINT payroll_runs_status_check CHECK(status IN ('DRAFT','CANCELLED_DRAFT')),
 ADD CONSTRAINT payroll_run_cancellation_complete CHECK(
  (status='DRAFT' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL) OR
  (status='CANCELLED_DRAFT' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND length(btrim(cancellation_reason)) BETWEEN 1 AND 2000));

CREATE FUNCTION public.payroll_run_cancellation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE role_name text; factory boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payroll sheets cannot be physically deleted' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'New payroll sheets must start as drafts' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status<>'DRAFT' OR NEW.status<>'CANCELLED_DRAFT' OR
  (to_jsonb(NEW)-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','cancelled_at','cancelled_by','cancellation_reason']) THEN
  RAISE EXCEPTION 'Payroll sheet identity and cancelled sheets are immutable' USING ERRCODE='42501';
 END IF;
 role_name:=public.payroll_require_actor(NEW.cancelled_by,ARRAY['accounts','factory_manager']);
 PERFORM public.payroll_require_scope(NEW.cancelled_by,NEW.department,true);
 SELECT is_factory INTO factory FROM public.payroll_groups WHERE code=NEW.group_code;
 IF NEW.created_by<>NEW.cancelled_by OR role_name<>(CASE WHEN factory THEN 'factory_manager' ELSE 'accounts' END) THEN
  RAISE EXCEPTION 'Only the originating payroll preparer may delete this sheet' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_run_employees WHERE run_id=NEW.id AND status<>'CANCELLED_DRAFT') OR
  EXISTS(SELECT 1 FROM public.payroll_financial_snapshots f JOIN public.payroll_run_employees e ON e.id=f.row_id WHERE e.run_id=NEW.id) THEN
  RAISE EXCEPTION 'Cancel all unsubmitted employees before deleting this sheet' USING ERRCODE='PY409';
 END IF;
 INSERT INTO public.audit_log(user_id,action,module_name,record_identifier,old_value,new_value)
 VALUES(NEW.cancelled_by::text,'PAYROLL_SHEET_CANCELLED','Payroll',NEW.id::text,
  jsonb_build_object('status',OLD.status),jsonb_build_object('status',NEW.status,'reason',NEW.cancellation_reason));
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_run_cancellation_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER payroll_immutable ON public.payroll_runs;
CREATE TRIGGER payroll_run_cancellation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_runs
 FOR EACH ROW EXECUTE FUNCTION public.payroll_run_cancellation_guard();

-- Also protects direct service-role writes, not just the deletion endpoint.
CREATE FUNCTION public.payroll_active_sheet_row_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE run_status text;
BEGIN
 SELECT status INTO run_status FROM public.payroll_runs WHERE id=NEW.run_id FOR SHARE;
 IF run_status IS DISTINCT FROM 'DRAFT' THEN
  RAISE EXCEPTION 'Deleted payroll sheets cannot be changed or repopulated' USING ERRCODE='PY409';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_active_sheet_row_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payroll_active_sheet_row_guard BEFORE INSERT OR UPDATE ON public.payroll_run_employees
 FOR EACH ROW EXECUTE FUNCTION public.payroll_active_sheet_row_guard();

CREATE FUNCTION public.cancel_payroll_draft_run(p_run_id uuid,p_reason text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; employee_row public.payroll_run_employees%ROWTYPE;
 role_name text; factory boolean; affected integer:=0;
BEGIN
 role_name:=public.payroll_require_actor(p_actor_id,ARRAY['accounts','factory_manager']);
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 SELECT is_factory INTO factory FROM public.payroll_groups WHERE code=r.group_code;
 IF r.created_by<>p_actor_id OR role_name<>(CASE WHEN factory THEN 'factory_manager' ELSE 'accounts' END) THEN
  RAISE EXCEPTION 'Only the originating payroll preparer may delete this sheet' USING ERRCODE='42501';
 END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
  RAISE EXCEPTION 'A deletion reason is required (at most 2000 characters)' USING ERRCODE='22023';
 END IF;
 IF r.status='CANCELLED_DRAFT' THEN RETURN jsonb_build_object('run',to_jsonb(r),'cancelled_rows',0,'already_cancelled',true); END IF;
 -- Match review RPC locking order: sheet, employees, salary rows. Population and
 -- submission take a compatible shared sheet lock, so a racing submission is never erased.
 PERFORM 1 FROM public.hr_employees h WHERE h.id IN (SELECT employee_id FROM public.payroll_run_employees WHERE run_id=r.id) ORDER BY h.id FOR UPDATE;
 PERFORM 1 FROM public.payroll_run_employees WHERE run_id=r.id ORDER BY employee_id,id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.payroll_run_employees WHERE run_id=r.id AND
   (status NOT IN ('DRAFT','CALCULATED','RETURNED_TO_CREATOR','CANCELLED_DRAFT') OR (status<>'CANCELLED_DRAFT' AND created_by<>p_actor_id))) OR
  EXISTS(SELECT 1 FROM public.payroll_financial_snapshots f JOIN public.payroll_run_employees e ON e.id=f.row_id WHERE e.run_id=r.id) THEN
  RAISE EXCEPTION 'Cannot delete a sheet with submitted, under-review, locked or other preparer employee rows' USING ERRCODE='PY409';
 END IF;
 FOR employee_row IN SELECT * FROM public.payroll_run_employees WHERE run_id=r.id AND status<>'CANCELLED_DRAFT' ORDER BY employee_id,id LOOP
  PERFORM public.transition_payroll_employee_review(employee_row.id,employee_row.current_version,employee_row.review_version,'cancel',jsonb_build_object('reason',btrim(p_reason)),p_actor_id);
  affected:=affected+1;
 END LOOP;
 UPDATE public.payroll_runs SET status='CANCELLED_DRAFT',cancelled_at=now(),cancelled_by=p_actor_id,cancellation_reason=btrim(p_reason)
 WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('run',to_jsonb(r),'cancelled_rows',affected,'already_cancelled',false);
END; $$;
REVOKE ALL ON FUNCTION public.cancel_payroll_draft_run(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_payroll_draft_run(uuid,text,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.transition_payroll_employee_review(p_row_id uuid,p_expected_version integer,
 p_expected_review_version integer,p_action text,p_data jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; r public.payroll_runs%ROWTYPE; v public.payroll_review_revisions%ROWTYPE;
 role text; factory boolean; before_state text; next_state text; action_name text; reason text;
 src jsonb; token text; calc jsonb; blockers jsonb; m date; assignment uuid; beneficiary uuid;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 SELECT * INTO r FROM public.payroll_runs WHERE id=(SELECT run_id FROM public.payroll_run_employees WHERE id=p_row_id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 IF r.status<>'DRAFT' THEN RAISE EXCEPTION 'Payroll sheet has been deleted' USING ERRCODE='PY409'; END IF;
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

CREATE OR REPLACE FUNCTION public.add_payroll_draft_employee(p_run_id uuid,p_assignment_id uuid,p_from date,p_to date,p_actor_id uuid)
RETURNS public.payroll_run_employees LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; a public.payroll_employee_assignments%ROWTYPE; e public.payroll_run_employees%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 IF r.status<>'DRAFT' THEN RAISE EXCEPTION 'Payroll sheet has been deleted' USING ERRCODE='PY409'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 IF r.created_by<>p_actor_id AND public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','factory_manager'])<>'admin' THEN
  RAISE EXCEPTION 'Only draft creator may edit' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.payroll_employee_assignments WHERE id=p_assignment_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.hr_employees WHERE id=a.employee_id FOR SHARE;
 IF a.revision_id IS DISTINCT FROM (SELECT id FROM public.payroll_source_history_revisions
  WHERE employee_id=a.employee_id AND source_kind='ASSIGNMENT' ORDER BY version DESC LIMIT 1) THEN
  RAISE EXCEPTION 'Assignment timeline has changed; reload' USING ERRCODE='PY409'; END IF;
 INSERT INTO public.payroll_run_employees(run_id,employee_id,assignment_id,period_from,period_to,created_by)
  VALUES(r.id,a.employee_id,a.id,p_from,p_to,p_actor_id) RETURNING * INTO e;
 PERFORM public.payroll_append_draft_version(e.id,'',p_actor_id);
 RETURN e;
END; $$;

CREATE OR REPLACE FUNCTION public.revise_payroll_draft_note(p_row_id uuid,p_expected_version integer,p_note text,p_actor_id uuid)
RETURNS public.payroll_run_employees LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; e public.payroll_run_employees%ROWTYPE; role text;
BEGIN
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id FOR SHARE;
 IF r.status<>'DRAFT' THEN RAISE EXCEPTION 'Payroll sheet has been deleted' USING ERRCODE='PY409'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','factory_manager']);
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id FOR UPDATE;
 IF p_expected_version IS DISTINCT FROM e.current_version THEN RAISE EXCEPTION 'Payroll row version conflict' USING ERRCODE='PY409'; END IF;
 IF e.status NOT IN ('DRAFT','CALCULATED') OR (e.created_by<>p_actor_id AND (role<>'admin' OR e.review_revision IS NOT NULL)) THEN
  RAISE EXCEPTION 'Only an editable draft may be changed; returned rows require a reasoned correction' USING ERRCODE='42501'; END IF;
 UPDATE public.payroll_run_employees SET current_version=current_version+1,review_version=review_version+1,status='DRAFT',submitted_by=NULL,accounts_verified_by=NULL
  WHERE id=e.id RETURNING * INTO e;
 PERFORM public.payroll_append_draft_version(e.id,p_note,p_actor_id);
 RETURN e;
END; $$;

CREATE OR REPLACE FUNCTION public.populate_payroll_draft_run(p_run_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; role_name text; factory boolean; candidate record;
 e public.payroll_run_employees%ROWTYPE; initial_rows jsonb:='[]'; saved_rows jsonb:='[]'; issues jsonb:='[]';
 added integer:=0; retained integer:=0; eligible_count integer; missing jsonb;
BEGIN
 role_name:=public.payroll_require_actor(p_actor_id,ARRAY['accounts','factory_manager']);
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 IF r.status<>'DRAFT' THEN RAISE EXCEPTION 'Payroll sheet has been deleted' USING ERRCODE='PY409'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 SELECT is_factory INTO factory FROM public.payroll_groups WHERE code=r.group_code;
 IF r.created_by<>p_actor_id OR role_name<>(CASE WHEN factory THEN 'factory_manager' ELSE 'accounts' END) THEN
  RAISE EXCEPTION 'Only the originating payroll preparer may populate this sheet' USING ERRCODE='42501';
 END IF;
 WITH latest AS (SELECT DISTINCT ON(employee_id) id,employee_id FROM public.payroll_source_history_revisions
  WHERE source_kind='ASSIGNMENT' ORDER BY employee_id,version DESC)
 SELECT count(DISTINCT a.employee_id) INTO eligible_count FROM public.payroll_employee_assignments a JOIN latest l ON l.id=a.revision_id
 WHERE a.group_code=r.group_code AND a.department=r.department AND daterange(a.effective_from,a.effective_to,'[]') && daterange(r.period_from,r.period_to,'[]');
 IF eligible_count>1000 THEN RAISE EXCEPTION 'More than 1000 employees match; narrow the payroll period' USING ERRCODE='22023'; END IF;
 FOR candidate IN
  WITH latest AS (SELECT DISTINCT ON(employee_id) id,employee_id FROM public.payroll_source_history_revisions
   WHERE source_kind='ASSIGNMENT' ORDER BY employee_id,version DESC), eligible AS (
   SELECT a.*,h.employee_name,h.employee_code,greatest(a.effective_from,r.period_from) payable_from,
    least(a.effective_to,r.period_to) payable_to,count(*) OVER(PARTITION BY a.employee_id) intervals
   FROM public.payroll_employee_assignments a JOIN latest l ON l.id=a.revision_id JOIN public.hr_employees h ON h.id=a.employee_id
   WHERE a.group_code=r.group_code AND a.department=r.department AND daterange(a.effective_from,a.effective_to,'[]') && daterange(r.period_from,r.period_to,'[]'))
  SELECT DISTINCT ON(employee_id) * FROM eligible ORDER BY employee_id,effective_from,id
 LOOP
  SELECT * INTO e FROM public.payroll_run_employees WHERE run_id=r.id AND employee_id=candidate.employee_id;
  IF FOUND THEN
   retained:=retained+1;
   IF e.status='DRAFT' AND e.current_version=1 AND e.review_revision IS NULL AND e.created_by=p_actor_id THEN
    initial_rows:=initial_rows||jsonb_build_array(to_jsonb(e));
   END IF;
  ELSIF candidate.intervals>1 THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('employee_id',candidate.employee_id,'employee_name',candidate.employee_name,
    'employee_code',candidate.employee_code,'code','MULTIPLE_ASSIGNMENT_INTERVALS','message','Choose an evidenced interval individually; one employee row per sheet is required.'));
  ELSE
   BEGIN
    e:=public.add_payroll_draft_employee(r.id,candidate.id,candidate.payable_from,candidate.payable_to,p_actor_id);
    initial_rows:=initial_rows||jsonb_build_array(to_jsonb(e));added:=added+1;
   EXCEPTION WHEN OTHERS THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('employee_id',candidate.employee_id,'employee_name',candidate.employee_name,
     'employee_code',candidate.employee_code,'code',SQLSTATE,'message',SQLERRM));
   END;
  END IF;
 END LOOP;
 -- Source checks include retained rows no longer present in the latest candidate
 -- roster too. Refresh never deletes, reassigns or recalculates their saved work.
 SELECT coalesce(jsonb_agg(jsonb_build_object('row_id',salary.id,'source_fingerprint',v.source_fingerprint)),'[]') INTO saved_rows
 FROM public.payroll_run_employees salary JOIN public.payroll_review_revisions v ON v.row_id=salary.id AND v.revision=salary.review_revision
 WHERE salary.run_id=r.id AND salary.status NOT IN ('LOCKED','CANCELLED_DRAFT');
 SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id',h.id,'employee_name',h.employee_name,'employee_code',h.employee_code,
  'code','ASSIGNMENT_HISTORY_REQUIRED','message','Record dated payroll assignment history before generating this employee.')),'[]') INTO missing
 FROM public.hr_employees h JOIN public.payroll_groups g ON g.employee_category=h.employee_category
 WHERE g.code=r.group_code AND h.department=r.department AND h.active_status='Active' AND h.joining_date<=r.period_to
  AND NOT EXISTS(SELECT 1 FROM public.payroll_source_history_revisions s WHERE s.employee_id=h.id AND s.source_kind='ASSIGNMENT');
 RETURN jsonb_build_object('run',to_jsonb(r),'added',added,'retained',retained,'rows',initial_rows,'saved_rows',saved_rows,'issues',issues||missing);
END; $$;

CREATE OR REPLACE FUNCTION public.set_payroll_period_cutoff(p_run_id uuid,p_expected_version integer,p_action text,p_cutoff timestamptz,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE role text; r public.payroll_runs%ROWTYPE; prior public.payroll_period_cutoffs%ROWTYPE; result public.payroll_period_cutoffs%ROWTYPE;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['accounts','ho']);
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 IF r.status<>'DRAFT' THEN RAISE EXCEPTION 'Payroll sheet has been deleted' USING ERRCODE='PY409'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,false);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_cutoff:'||p_run_id::text,0));
 SELECT * INTO prior FROM public.payroll_period_cutoffs WHERE run_id=p_run_id ORDER BY version DESC LIMIT 1;
 IF p_expected_version IS DISTINCT FROM coalesce(prior.version,0) THEN RAISE EXCEPTION 'Cutoff version conflict' USING ERRCODE='PY409'; END IF;
 IF p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Cutoff evidence required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_run_employees WHERE run_id=p_run_id AND status='LOCKED') THEN RAISE EXCEPTION 'A financial cutoff is immutable after any employee locks' USING ERRCODE='PY409'; END IF;
 IF p_action='propose' AND role='accounts' THEN
  IF p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff<(r.period_to+1)::timestamp AT TIME ZONE 'Asia/Kolkata' THEN RAISE EXCEPTION 'Cutoff must follow the covered period' USING ERRCODE='22023'; END IF;
  INSERT INTO public.payroll_period_cutoffs(run_id,version,cutoff_at,status,proposed_by,evidence_reference) VALUES(r.id,p_expected_version+1,p_cutoff,'PROPOSED',p_actor_id,p_evidence) RETURNING * INTO result;
 ELSIF p_action='approve' AND role='ho' AND prior.status='PROPOSED' AND prior.proposed_by<>p_actor_id AND p_cutoff IS NULL THEN
  INSERT INTO public.payroll_period_cutoffs(run_id,version,cutoff_at,status,proposed_by,approved_by,evidence_reference) VALUES(r.id,p_expected_version+1,prior.cutoff_at,'APPROVED',prior.proposed_by,p_actor_id,p_evidence) RETURNING * INTO result;
 ELSE RAISE EXCEPTION 'Independent Accounts proposal and HO approval required' USING ERRCODE='42501'; END IF;
 RETURN to_jsonb(result);
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_draft_run(p_run_id uuid,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; v_result jsonb; progress jsonb;
BEGIN
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id AND status='DRAFT';
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,false);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 WITH rows AS (SELECT e.* FROM public.payroll_run_employees e WHERE e.run_id=r.id ORDER BY e.id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('run',to_jsonb(r),'rows',coalesce((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object(
  'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version) FROM public.payroll_row_versions v WHERE v.row_id=e.id),
  'source_links',(SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) FROM public.payroll_source_links l WHERE l.row_id=e.id))) FROM rows e),'[]'::jsonb),
  'total_rows',(SELECT count(*) FROM public.payroll_run_employees WHERE run_id=r.id),
  'page',p_page,'limit',p_limit,'financial_workflows_enabled',false) INTO v_result;
 progress:=public.payroll_review_progress(r.id);
 RETURN v_result||jsonb_build_object('progress',progress,'run',(v_result->'run')||jsonb_build_object('container_status',r.status,'status',progress->'status'));
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_draft_candidates(p_run_id uuid,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; v_result jsonb;
BEGIN
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id AND status='DRAFT';
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,false);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 WITH latest AS (
  SELECT DISTINCT ON (employee_id) id,employee_id FROM public.payroll_source_history_revisions
   WHERE source_kind='ASSIGNMENT' ORDER BY employee_id,version DESC
 ), eligible AS (
  SELECT a.*,h.employee_code,h.employee_name,g.is_permanent,
   greatest(a.effective_from,r.period_from) AS payable_from,least(a.effective_to,r.period_to) AS payable_to
  FROM public.payroll_employee_assignments a JOIN latest l ON l.id=a.revision_id
   JOIN public.hr_employees h ON h.id=a.employee_id JOIN public.payroll_groups g ON g.code=a.group_code
  WHERE a.group_code=r.group_code AND a.department=r.department
   AND daterange(a.effective_from,a.effective_to,'[]') && daterange(r.period_from,r.period_to,'[]')
 ), page AS (SELECT * FROM eligible ORDER BY employee_id,effective_from LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('candidates',coalesce((SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object(
  'pay_applicability',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.effective_from)
   FROM public.payroll_permanent_pay_applicability p WHERE p.employee_id=e.employee_id
    AND p.revision_id=(SELECT id FROM public.payroll_source_history_revisions WHERE employee_id=e.employee_id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1)
    AND daterange(p.effective_from,p.effective_to,'[]') && daterange(e.payable_from,e.payable_to,'[]')),'[]'::jsonb),
  'readiness','NOT_CALCULATED')) FROM page e),'[]'::jsonb),
  'total_intervals',(SELECT count(*) FROM eligible),'page',p_page,'limit',p_limit,
  'unknown_assignments_excluded',true,'financial_workflows_enabled',false) INTO v_result;
 RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_review_queue(p_actor_id uuid,p_run_id uuid DEFAULT NULL,p_status text DEFAULT NULL,
 p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE context jsonb; result jsonb; BEGIN
 context:=public.get_payroll_foundation_context(p_actor_id);
 IF p_page IS NULL OR p_limit IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 100
  OR (p_status IS NOT NULL AND p_status NOT IN ('DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED')) THEN
  RAISE EXCEPTION 'Invalid review queue selection' USING ERRCODE='22023'; END IF;
 IF p_run_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_runs WHERE id=p_run_id AND status='DRAFT') THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=p_run_id),false);
 END IF;
 WITH visible_runs AS (SELECT r.* FROM public.payroll_runs r WHERE r.status='DRAFT' AND EXISTS(SELECT 1 FROM jsonb_array_elements(context->'groups') g WHERE g->>'code'=r.group_code AND g->>'department'=r.department)),
 visible AS (SELECT e.*,r.group_code,r.department,h.employee_name,h.employee_code,coalesce(h.erp_user_id=p_actor_id,false) AS employee_self,v.source_fingerprint,
  jsonb_array_length(coalesce(v.calculation_snapshot->'blockers','[]'::jsonb)) AS calculation_blockers
  FROM public.payroll_run_employees e JOIN visible_runs r ON r.id=e.run_id JOIN public.hr_employees h ON h.id=e.employee_id
  LEFT JOIN public.payroll_review_revisions v ON v.row_id=e.id AND v.revision=e.review_revision
  WHERE (p_run_id IS NULL OR e.run_id=p_run_id) AND (p_status IS NULL OR e.status=p_status)),
 page AS (SELECT * FROM visible ORDER BY created_at DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit),
 sheets AS (SELECT r.* FROM visible_runs r WHERE r.id IN (SELECT run_id FROM page) OR r.id=p_run_id)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC,id) FROM page e),'[]'),
  'total',(SELECT count(*) FROM visible),'page',p_page,'limit',p_limit,
  'sheets',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('container_status',r.status,'status',public.payroll_review_progress(r.id)->'status','progress',public.payroll_review_progress(r.id)) ORDER BY created_at DESC,id) FROM sheets r),'[]'),
  'financial_finalization_enabled',false,'payment_status','NOT_ELIGIBLE') INTO result;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.list_payroll_preview_runs(p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE context jsonb; result jsonb; BEGIN
 context:=public.get_payroll_foundation_context(p_actor_id);
 IF p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 100 OR p_page IS NULL OR p_limit IS NULL THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 WITH visible AS (SELECT r.* FROM public.payroll_runs r WHERE r.status='DRAFT' AND EXISTS(SELECT 1 FROM jsonb_array_elements(context->'groups') g WHERE g->>'code'=r.group_code AND g->>'department'=r.department)),
 page AS (SELECT * FROM visible ORDER BY created_at DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('runs',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('container_status',r.status,'status',public.payroll_review_progress(r.id)->'status','progress',public.payroll_review_progress(r.id)) ORDER BY created_at DESC,id) FROM page r),'[]'),'total',(SELECT count(*) FROM visible),'page',p_page,'limit',p_limit,'financial_workflows_enabled',false) INTO result;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_salary_register(p_actor_id uuid,p_filters jsonb DEFAULT '{}'::jsonb,p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE context jsonb; role_name text; result jsonb; from_date date; to_date date;
BEGIN
 role_name:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_scope:'||p_actor_id::text,0));
 context:=public.get_payroll_foundation_context(p_actor_id);
 IF p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000
  OR EXISTS(SELECT 1 FROM jsonb_each(p_filters) x WHERE x.key NOT IN ('run_id','department','group_code','status','from','to','search') OR jsonb_typeof(x.value)<>'string')
  OR length(coalesce(p_filters->>'search',''))>120 THEN
  RAISE EXCEPTION 'Invalid salary register selection' USING ERRCODE='22023'; END IF;
 IF p_filters ? 'status' AND p_filters->>'status' NOT IN ('DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED') THEN
  RAISE EXCEPTION 'Invalid review status' USING ERRCODE='22023'; END IF;
 from_date:=(p_filters->>'from')::date; to_date:=(p_filters->>'to')::date;
 IF (from_date IS NOT NULL AND NOT isfinite(from_date)) OR (to_date IS NOT NULL AND NOT isfinite(to_date)) OR from_date>to_date THEN
  RAISE EXCEPTION 'Invalid reporting interval' USING ERRCODE='22023'; END IF;
 IF p_filters ? 'department' THEN PERFORM public.payroll_require_scope(p_actor_id,p_filters->>'department',false); END IF;
 IF p_filters ? 'run_id' THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_runs WHERE id=(p_filters->>'run_id')::uuid AND status='DRAFT') THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=(p_filters->>'run_id')::uuid),false);
 END IF;
 -- Scope and data selection share one snapshot. Saved cross-factory evidence is
 -- omitted if any of its departments is outside the FM's current grants.
 WITH scoped AS MATERIALIZED (
  SELECT e.*,r.department,r.group_code,r.cycle,a.employee_category,
   coalesce(v.calculation_snapshot->'employee'->>'employee_name',h.employee_name) employee_name,
   coalesce(v.calculation_snapshot->'employee'->>'employee_code',h.employee_code) employee_code,
   v.revision,v.content_version,v.source_fingerprint,v.created_at calculated_at,
   CASE WHEN e.status='LOCKED' THEN f.calculation_snapshot WHEN e.status<>'CANCELLED_DRAFT' AND v.content_version=e.current_version THEN v.calculation_snapshot END calc,
   CASE WHEN e.status='LOCKED' AND f.row_id IS NOT NULL THEN 'IMMUTABLE_LOCKED' WHEN e.status='LOCKED' THEN 'LOCKED_SNAPSHOT_UNAVAILABLE' WHEN e.status='CANCELLED_DRAFT' THEN 'WITHDRAWN'
    WHEN v.revision IS NULL THEN 'NO_CALCULATION' WHEN v.content_version<>e.current_version THEN 'SUPERSEDED_CONTENT' ELSE 'SAVED_DIAGNOSTIC' END evidence_status
  FROM public.payroll_run_employees e JOIN public.payroll_runs r ON r.id=e.run_id JOIN public.hr_employees h ON h.id=e.employee_id
   JOIN public.payroll_employee_assignments a ON a.id=e.assignment_id
   LEFT JOIN public.payroll_review_revisions v ON v.row_id=e.id AND v.revision=e.review_revision
   LEFT JOIN public.payroll_financial_snapshots f ON f.row_id=e.id
  WHERE r.status='DRAFT' AND EXISTS(SELECT 1 FROM jsonb_array_elements(context->'groups') g WHERE g->>'code'=r.group_code AND g->>'department'=r.department)
   AND (role_name<>'factory_manager' OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(coalesce(v.source_snapshot->'assignments','[]')||coalesce(v.source_snapshot->'attendance','[]')) x
    WHERE x->>'department' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'groups') g WHERE g->>'department'=x->>'department')))
   AND (NOT p_filters ? 'run_id' OR e.run_id=(p_filters->>'run_id')::uuid)
   AND (NOT p_filters ? 'department' OR r.department=p_filters->>'department')
   AND (NOT p_filters ? 'group_code' OR r.group_code=p_filters->>'group_code')
   AND (NOT p_filters ? 'status' OR e.status=p_filters->>'status')
   AND (from_date IS NULL OR e.period_to>=from_date) AND (to_date IS NULL OR e.period_from<=to_date)
 ), selected AS MATERIALIZED (
  SELECT * FROM scoped WHERE strpos(lower(employee_name||' '||employee_code),lower(coalesce(p_filters->>'search','')))>0
 ), amounts AS MATERIALIZED (
  SELECT s.*,
   CASE WHEN calc->>'known_earnings_total' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (calc->>'known_earnings_total')::numeric END earnings,
   CASE WHEN calc->>'gross_after_lop' ~ '^[0-9]+(\.[0-9]+)?$' THEN (calc->>'gross_after_lop')::numeric END gross,
   CASE WHEN calc->>'gross_after_lop' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(calc->'deductions') d WHERE d->>'code'='LOP' AND (d->>'amount' IS NULL OR d->>'amount' !~ '^[0-9]+(\.[0-9]+)?$'))
    THEN coalesce((SELECT sum((d->>'amount')::numeric) FROM jsonb_array_elements(calc->'deductions') d WHERE d->>'code'='LOP'),0.00) END lop,
   CASE WHEN calc->>'financial_readiness'='true' THEN (calc->>'final_net_salary')::numeric END net,
   CASE WHEN calc->>'financial_readiness'='true' THEN (calc->>'employee_statutory_total')::numeric END statutory_total,
   CASE WHEN calc->>'financial_readiness'='true' THEN (calc->>'employer_contributions_total')::numeric END employer_total
  FROM selected s
 ), page AS (SELECT * FROM amounts ORDER BY period_from DESC,employee_name,id LIMIT p_limit OFFSET (p_page-1)*p_limit),
 summaries AS (
  SELECT department,status,count(*) row_count,count(gross) gross_known_rows,
   sum(gross)::text known_gross_total,CASE WHEN count(gross)=count(*) THEN sum(gross)::text END gross_total,
   sum(lop)::text known_lop_total,sum(net)::text known_net_total,CASE WHEN count(net)=count(*) THEN sum(net)::text END net_total,sum(statutory_total)::text known_statutory_total,sum(employer_total)::text known_employer_total FROM amounts GROUP BY department,status
 )
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',id,'run_id',run_id,'employee_id',employee_id,'employee_name',employee_name,'employee_code',employee_code,'employee_category',employee_category,
  'department',department,'group_code',group_code,'cycle',cycle,'period_from',period_from,'period_to',period_to,'status',status,
  'current_version',current_version,'review_version',review_version,'revision',revision,'calculated_at',calculated_at,'source_fingerprint',source_fingerprint,
  'evidence_status',evidence_status,'source_freshness','NOT_REVALIDATED','earnings_total',earnings::text,'gross_after_lop',gross::text,'lop',lop::text,
  'epf',CASE WHEN net IS NOT NULL THEN coalesce((SELECT sum((x->>'employee_amount')::numeric)::text FROM jsonb_array_elements(calc->'statutory_entries') x WHERE x->>'scheme'='EPF'),'0.00') END,'esi',CASE WHEN net IS NOT NULL THEN coalesce((SELECT sum((x->>'employee_amount')::numeric)::text FROM jsonb_array_elements(calc->'statutory_entries') x WHERE x->>'scheme'='ESI'),'0.00') END,'pt',CASE WHEN net IS NOT NULL THEN coalesce((SELECT sum((x->>'employee_amount')::numeric)::text FROM jsonb_array_elements(calc->'statutory_entries') x WHERE x->>'scheme'='PT'),'0.00') END,'net_salary',net::text,'employer_contributions',employer_total::text,'statutory_status',CASE WHEN net IS NOT NULL THEN 'CALCULATED_NOT_SETTLED' ELSE 'UNRESOLVED' END,'payment_status',CASE WHEN status='LOCKED' AND net=0 THEN 'NOT_REQUIRED' WHEN status='LOCKED' THEN 'NOT_RECORDED' ELSE 'NOT_ELIGIBLE' END,'statutory_settlement_status','NOT_POSTED',
  'last_return_reason',last_return_reason,'calculation_status',calc->>'status','blockers',coalesce(calc->'blockers','[]'),
  'earnings',coalesce(calc->'earnings','[]'),'deductions',coalesce(calc->'deductions','[]'),'source_references',calc->'source_references',
  'monthly_reconciliation',coalesce(calc->'monthly_reconciliation','[]')) ORDER BY period_from DESC,employee_name,id) FROM page),'[]'),
  'total',(SELECT count(*) FROM amounts),'page',p_page,'limit',p_limit,
  'summaries',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY department,status) FROM summaries s),'[]'),
  'filters',p_filters,'generated_at',statement_timestamp(),'amount_basis','PER_ROW_EVIDENCE_STATUS',
  'financial_finalization_enabled',false,'official_payslips_enabled',false,'payment_status','NOT_ELIGIBLE') INTO result;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_preview_sources(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; r public.payroll_runs%ROWTYPE; permanent boolean; lo date; hi date; result jsonb;
BEGIN
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id;
 IF r.status<>'DRAFT' THEN RAISE EXCEPTION 'Payroll sheet has been deleted' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,false);
 SELECT is_permanent INTO permanent FROM public.payroll_groups WHERE code=r.group_code;
 lo:=CASE WHEN permanent THEN date_trunc('month',e.period_from)::date ELSE e.period_from END;
 hi:=CASE WHEN permanent THEN (date_trunc('month',e.period_to)+interval '1 month - 1 day')::date ELSE e.period_to END;
 IF hi-lo>731 THEN RAISE EXCEPTION 'Preview at most 24 months at a time' USING ERRCODE='22023'; END IF;
 -- One SQL statement provides one MVCC snapshot of all calculation inputs.
 WITH target AS (SELECT * FROM public.payroll_run_employees WHERE id=p_row_id),
 history AS (SELECT DISTINCT ON(source_kind) * FROM public.payroll_source_history_revisions WHERE employee_id=e.employee_id AND source_kind IN ('ASSIGNMENT','PERMANENT_PAY') ORDER BY source_kind,version DESC),
 assignments AS (SELECT a.* FROM public.payroll_employee_assignments a JOIN history h ON h.id=a.revision_id WHERE daterange(a.effective_from,a.effective_to,'[]') && daterange(lo,hi,'[]')),
 pay AS (SELECT a.* FROM public.payroll_permanent_pay_applicability a JOIN history h ON h.id=a.revision_id WHERE daterange(a.effective_from,a.effective_to,'[]') && daterange(lo,hi,'[]')),
 attendance AS (SELECT a.*,s.attendance_date,s.employee_category,s.department,s.status AS sheet_status,s.locked_at
  FROM public.hr_attendance_rows a JOIN public.hr_attendance_sheets s ON s.id=a.sheet_id
  WHERE a.employee_id=e.employee_id AND s.attendance_date BETWEEN lo-1 AND hi),
 profile_history AS (SELECT id,version FROM public.payroll_source_history_revisions WHERE employee_id=e.employee_id AND source_kind='STATUTORY_PROFILE' ORDER BY version DESC LIMIT 1),
 profiles AS (SELECT p.id,p.revision_id,p.scheme,p.statutory_scope_id,p.effective_from,p.effective_to,p.applicability,p.enrolled,p.verification_status
  FROM public.payroll_employee_statutory_profiles p JOIN profile_history h ON h.id=p.revision_id WHERE daterange(p.effective_from,p.effective_to,'[]') && daterange(date_trunc('month',lo)::date,hi,'[]')),
 rule_links AS (SELECT DISTINCT s.id,s.scheme,b.statutory_scope_id,s.effective_from,s.effective_to,s.revision_number
  FROM public.payroll_statutory_rule_revisions s JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=s.id JOIN profiles p ON p.scheme=s.scheme AND p.statutory_scope_id=b.statutory_scope_id
  WHERE s.status='PUBLISHED' AND s.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND p.applicability='APPLICABLE' AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
   AND daterange(s.effective_from,s.effective_to,'[]') && daterange(date_trunc('month',greatest(lo,p.effective_from))::date,(date_trunc('month',least(hi,p.effective_to))+interval '1 month - 1 day')::date,'[]')),
 scope_checks AS MATERIALIZED (
  -- Authorize departments from THIS snapshot, not an earlier history read.
  SELECT public.payroll_require_scope(p_actor_id,d.department,false) AS checked
  FROM (SELECT department FROM assignments UNION SELECT department FROM attendance WHERE department IS NOT NULL) d
 )
 SELECT jsonb_build_object(
  'row',(SELECT to_jsonb(t) FROM target t),'run',to_jsonb(r),'is_permanent',permanent,'source_from',lo,'source_to',hi,
  'employee',(SELECT jsonb_build_object('id',id,'employee_code',employee_code,'employee_name',employee_name) FROM public.hr_employees WHERE id=e.employee_id),
  'beneficiary',(SELECT CASE WHEN b.id IS NULL THEN jsonb_build_object('status','MISSING') ELSE jsonb_build_object(
   'status',CASE WHEN bank.is_active AND b.account_number ~ '^[0-9]{9,18}$' AND b.ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$' AND length(btrim(b.beneficiary_name))>0 THEN 'RECORDED' ELSE 'INCOMPLETE' END,
   'id',b.id,'beneficiary_name',b.beneficiary_name,'masked_account_number','****'||right(b.account_number,4),'ifsc',b.ifsc,'bank_id',bank.id,'bank_name',bank.bank_name,
   'details_fingerprint',encode(digest(jsonb_build_array(b.id,b.account_number,b.ifsc,b.beneficiary_name,bank.id,bank.bank_name,bank.is_active)::text,'sha256'),'hex')) END
   FROM public.hr_employees employee LEFT JOIN public.beneficiary_master b ON b.id=employee.beneficiary_id LEFT JOIN public.indian_bank_master bank ON bank.id=b.beneficiary_bank_id WHERE employee.id=e.employee_id),
  'draft_snapshot',(SELECT source_snapshot FROM public.payroll_row_versions v JOIN target t ON t.id=v.row_id AND t.current_version=v.version),
  'history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY source_kind) FROM history h),'[]'),
  'assignments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY effective_from,id) FROM assignments a),'[]'),
  'pay_applicability',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY effective_from,id) FROM pay a),'[]'),
  'pay_structures',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(p),ARRAY['guaranteed_monthly_gross','basic_salary','staff_welfare','other_fixed_components']) ORDER BY p.id) FROM public.hr_permanent_pay_structures p WHERE p.id IN (SELECT pay_structure_id FROM pay)),'[]'),
  'attendance',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a),ARRAY['actual_hours','ot_hours']) ORDER BY attendance_date,id) FROM attendance a),'[]'),
  'wages',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(w),ARRAY['daily_wage']) ORDER BY employee_category,effective_from,id) FROM public.hr_factory_wage_revisions w WHERE w.effective_from<=hi AND w.employee_category IN (SELECT employee_category FROM assignments)),'[]'),
  'factory_rules',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(w),ARRAY['standard_duty_hours','ot_rate','ot_multiplier','holiday_multiplier','double_duty_multiplier']) ORDER BY employee_category,effective_from,id) FROM public.hr_factory_pay_rule_revisions w WHERE w.effective_from<=hi AND w.employee_category IN (SELECT employee_category FROM assignments)),'[]'),
  'leave',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'employee_id',l.employee_id,'employee_category',l.employee_category,'from_date',l.from_date,'to_date',l.to_date,'leave_type',l.leave_type,'approval_status',l.approval_status,'pay_treatment',l.pay_treatment,'decided_by',l.decided_by,'decided_at',l.decided_at,'updated_at',l.updated_at) ORDER BY from_date,id) FROM public.hr_leave_requests l WHERE l.employee_id=e.employee_id AND daterange(l.from_date,l.to_date,'[]') && daterange(lo,hi,'[]')),'[]'),
  'policies',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(p),ARRAY['lop_fixed_divisor','partial_month_fixed_divisor'])||jsonb_build_object('data',public.payroll_master_payload('policies',to_jsonb(p))) ORDER BY effective_from,id) FROM public.payroll_policy_master_revisions p WHERE p.status='PUBLISHED' AND daterange(p.effective_from,p.effective_to,'[]') && daterange(date_trunc('month',lo)::date,hi,'[]') AND (p.group_code IS NULL OR p.group_code IN (SELECT group_code FROM assignments))),'[]'),
  'calendar',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY calendar_date,id) FROM public.payroll_work_calendar_days c WHERE c.calendar_date BETWEEN lo AND hi AND c.group_code=r.group_code AND c.department=r.department),'[]'),
  'month_rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'group_code',g.code,'is_permanent',g.is_permanent,'period_from',x.period_from,'period_to',x.period_to,'version',x.current_version,'status',x.status) ORDER BY x.period_from,x.id) FROM public.payroll_run_employees x JOIN public.payroll_runs y ON y.id=x.run_id JOIN public.payroll_groups g ON g.code=y.group_code WHERE x.employee_id=e.employee_id AND daterange(x.period_from,x.period_to,'[]') && daterange(lo,hi,'[]')),'[]'),
  'entitlements',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(m),ARRAY['contractual_gross','allocated_base','lop_amount']) ORDER BY salary_month,id) FROM public.payroll_employee_month_entitlements m WHERE m.employee_id=e.employee_id AND m.salary_month BETWEEN date_trunc('month',lo)::date AND hi),'[]'),
  'coverage',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY period_from,id) FROM public.payroll_employee_coverage c WHERE c.employee_id=e.employee_id AND daterange(c.period_from,c.period_to,'[]') && daterange(lo,hi,'[]')),'[]'),
  -- Full rule payloads and private advisor/profile evidence remain absent.
  -- Only applicable, canonical published rule IDs are added below for diagnostics.
  'statutory_rules','[]'::jsonb,
  'financial_context',jsonb_build_object('activation_enabled',public.payroll_financial_enabled(),'cutoff',(SELECT jsonb_build_object('version',version,'status',status,'cutoff_at',cutoff_at,'proposed_by',proposed_by,'approved_by',approved_by) FROM public.payroll_period_cutoffs WHERE run_id=r.id ORDER BY version DESC LIMIT 1)),
  'statutory_calculation_rules',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'scheme',s.scheme,'statutory_scope_id',b.statutory_scope_id,'effective_from',s.effective_from,'effective_to',s.effective_to,'configuration',s.configuration,
   'slabs',CASE WHEN s.scheme='PT' THEN public.payroll_master_payload('statutory',to_jsonb(s))->'slabs' ELSE '[]'::jsonb END))
   FROM public.payroll_statutory_rule_revisions s JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=s.id
   WHERE s.status='PUBLISHED' AND s.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND s.effective_from<=hi AND s.effective_to>=date_trunc('month',lo)::date
    AND EXISTS(SELECT 1 FROM profiles p WHERE p.scheme=s.scheme AND p.statutory_scope_id=b.statutory_scope_id AND p.applicability='APPLICABLE' AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'))),'[]'),
  'statutory_entries',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(t),ARRAY['employee_amount','employer_amount']) ORDER BY contribution_month,scheme,salary_row_id) FROM public.payroll_statutory_entries t WHERE t.employee_id=e.employee_id AND contribution_month BETWEEN date_trunc('month',lo)::date AND hi),'[]'),
  'adjustments',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a)-ARRAY['evidence_reference'],ARRAY['amount','installment']) ORDER BY effective_date,id) FROM public.payroll_adjustments a WHERE a.employee_id=e.employee_id AND (a.target_row_id=e.id OR a.kind='ADVANCE') AND a.effective_date<=hi),'[]'),
  'adjustment_applications',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a),ARRAY['amount']) ORDER BY contribution_month,salary_row_id,adjustment_id) FROM public.payroll_adjustment_applications a WHERE a.employee_id=e.employee_id),'[]'),
  'month_allocations',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a),ARRAY['base_amount','lop_amount']) ORDER BY entitlement_id,salary_row_id) FROM public.payroll_month_allocations a JOIN public.payroll_employee_month_entitlements m ON m.id=a.entitlement_id WHERE m.employee_id=e.employee_id AND m.salary_month BETWEEN date_trunc('month',lo)::date AND hi),'[]'),
  'statutory_profile',NULL,'financial_workflows_enabled',false
 )||CASE WHEN EXISTS(SELECT 1 FROM profile_history) THEN jsonb_build_object(
  'statutory_profile_history',(SELECT to_jsonb(h) FROM profile_history h),
  'statutory_profiles',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY scheme,effective_from,id) FROM profiles p),'[]'),
  'statutory_rule_links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY scheme,effective_from,id) FROM rule_links l),'[]'),
  'statutory_profile',(SELECT jsonb_build_object('verified',bool_and(verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')),'effective_from',max(effective_from),'effective_to',min(effective_to)) FROM profiles WHERE effective_from<=lo AND (effective_to IS NULL OR effective_to>=hi) HAVING count(*)=3)
 ) ELSE '{}'::jsonb END INTO result FROM (SELECT count(*) FROM scope_checks) authorized_scopes;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_employee_review(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; result jsonb; src jsonb; source_error jsonb; d text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 -- Authorize metadata independently of preview availability. Authorization
 -- errors are never converted to recoverable source errors.
 PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=e.run_id),false);
 -- Historical salary evidence is subject to scope too, including a former
 -- factory in a previous submission that the current assignment no longer lists.
 FOR d IN SELECT DISTINCT x->>'department' FROM public.payroll_review_revisions v,
  LATERAL jsonb_array_elements(coalesce(v.source_snapshot->'assignments','[]')||coalesce(v.source_snapshot->'attendance','[]')) x
  WHERE v.row_id=e.id AND x->>'department' IS NOT NULL LOOP
  PERFORM public.payroll_require_scope(p_actor_id,d,false);
 END LOOP;
 -- Invalid source parameters (including oversized legacy periods) must not
 -- hide the metadata needed to correct or withdraw the employee row.
 IF EXISTS(SELECT 1 FROM public.payroll_runs WHERE id=e.run_id AND status='CANCELLED_DRAFT') THEN
  source_error:=jsonb_build_object('code','PAYROLL_SHEET_CANCELLED','message','This deleted sheet retains historical evidence only.');
 ELSE
 BEGIN
  src:=public.payroll_review_source_snapshot(p_row_id,p_actor_id);
 EXCEPTION WHEN invalid_parameter_value THEN
  source_error:=jsonb_build_object('code','PAYROLL_SOURCE_UNAVAILABLE','sqlstate',SQLSTATE,'message',SQLERRM);
 END;
 END IF;
 SELECT jsonb_build_object('row',to_jsonb(e),'run',(SELECT to_jsonb(r)||jsonb_build_object('container_status',r.status,'status',public.payroll_review_progress(r.id)->'status') FROM public.payroll_runs r WHERE r.id=e.run_id),
  'employee_self',(SELECT coalesce(erp_user_id=p_actor_id,false) FROM public.hr_employees WHERE id=e.employee_id),
  'locked_calculation',(SELECT calculation_snapshot FROM public.payroll_financial_snapshots WHERE row_id=e.id),'period_cutoff',(SELECT to_jsonb(c) FROM public.payroll_period_cutoffs c WHERE run_id=e.run_id ORDER BY version DESC LIMIT 1),'source',src,'source_error',source_error,'progress',public.payroll_review_progress(e.run_id),
  'revisions',coalesce((SELECT jsonb_agg(to_jsonb(v)-ARRAY['source_snapshot','source_token'] ORDER BY revision) FROM public.payroll_review_revisions v WHERE row_id=e.id),'[]'),
  'content_versions',coalesce((SELECT jsonb_agg(jsonb_build_object('version',version,'note',note,'created_by',created_by,'created_at',created_at) ORDER BY version) FROM public.payroll_row_versions WHERE row_id=e.id),'[]'),
  'actions',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.payroll_action_history a WHERE row_id=e.id),'[]'),
  'financial_finalization_enabled',false,'payment_status',CASE WHEN e.status='LOCKED' THEN CASE WHEN (SELECT net_salary FROM public.payroll_financial_snapshots WHERE row_id=e.id)=0 THEN 'NOT_REQUIRED' ELSE 'NOT_RECORDED' END ELSE 'NOT_ELIGIBLE' END) INTO result;
 RETURN result;
END; $$;

NOTIFY pgrst,'reload schema';
