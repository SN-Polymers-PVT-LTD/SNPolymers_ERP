-- Phase 4: independent employee review. Financial finalization is STILL disabled.
-- No Accounts payment RPC, bank update, coverage, allocation or liability write.
ALTER TABLE public.payroll_run_employees
 DROP CONSTRAINT payroll_run_employees_status_check,
 ADD CONSTRAINT payroll_employee_review_status CHECK(status IN
  ('DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED')),
 ADD COLUMN review_version integer NOT NULL DEFAULT 0 CHECK(review_version>=0),
 ADD COLUMN review_revision integer,
 ADD COLUMN submitted_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 ADD COLUMN accounts_verified_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 ADD COLUMN last_return_reason text CHECK(length(btrim(last_return_reason)) BETWEEN 1 AND 2000),
 ADD COLUMN last_return_stage text CHECK(last_return_stage IN ('ACCOUNTS','HO'));
CREATE TABLE public.payroll_review_revisions (
 row_id uuid NOT NULL REFERENCES public.payroll_run_employees(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>0),
 content_version integer NOT NULL,
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
 source_token text NOT NULL CHECK(source_token ~ '^[a-f0-9]{64}$'),
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 calculation_snapshot jsonb NOT NULL CHECK(jsonb_typeof(calculation_snapshot)='object'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(row_id,revision),
 FOREIGN KEY(row_id,content_version) REFERENCES public.payroll_row_versions(row_id,version) ON DELETE RESTRICT,
 CONSTRAINT payroll_review_source_row CHECK((source_snapshot->'row'->>'id') IS NOT NULL AND source_snapshot->'row'->>'id'=row_id::text),
 CONSTRAINT payroll_review_calculation_row CHECK((calculation_snapshot->>'row_id') IS NOT NULL AND calculation_snapshot->>'row_id'=row_id::text),
 CONSTRAINT payroll_review_calculation_fingerprint CHECK((calculation_snapshot->>'source_fingerprint') IS NOT NULL AND calculation_snapshot->>'source_fingerprint'=source_fingerprint),
 CONSTRAINT payroll_review_calculation_version CHECK((calculation_snapshot->>'row_version') IS NOT NULL AND calculation_snapshot->>'row_version'=content_version::text)
);
ALTER TABLE public.payroll_run_employees ADD CONSTRAINT payroll_employee_review_revision_fk
 FOREIGN KEY(id,review_revision) REFERENCES public.payroll_review_revisions(row_id,revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.payroll_action_history
 DROP CONSTRAINT payroll_action_history_action_check,
 ADD CONSTRAINT payroll_action_review_action CHECK(action IN ('DRAFT_CREATED','DRAFT_VERSION_CREATED',
  'CALCULATED','SUBMITTED','ACCOUNTS_FORWARDED','RETURNED','CORRECTED','CANCELLED_DRAFT','LOCK_BLOCKED')),
 ADD COLUMN from_status text,
 ADD COLUMN to_status text,
 ADD COLUMN reason text,
 ADD COLUMN actor_role text,
 ADD COLUMN review_version integer,
 ADD COLUMN review_revision integer,
 ADD CONSTRAINT payroll_action_review_revision_fk FOREIGN KEY(row_id,review_revision)
  REFERENCES public.payroll_review_revisions(row_id,revision) ON DELETE RESTRICT;
CREATE UNIQUE INDEX payroll_review_action_version_unique ON public.payroll_action_history(row_id,review_version)
 WHERE review_version IS NOT NULL AND action<>'LOCK_BLOCKED';
CREATE INDEX payroll_employee_review_queue_idx ON public.payroll_run_employees(status,run_id,id);
CREATE TRIGGER payroll_immutable BEFORE UPDATE OR DELETE ON public.payroll_review_revisions
 FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();
ALTER TABLE public.payroll_review_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_review_revisions FROM PUBLIC,anon,authenticated,service_role;

-- Review metadata must not invalidate its own saved calculation. Content versions,
-- notes, other month plans, source facts and policy revisions remain fingerprinted.
-- Cancelled rows cease participating in monthly entitlement/coverage plans.
CREATE FUNCTION public.payroll_review_source_snapshot(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE s jsonb; BEGIN
 s:=public.get_payroll_preview_sources(p_row_id,p_actor_id);
 s:=jsonb_set(s,'{row}',((s->'row')-ARRAY['review_version','review_revision','submitted_by','accounts_verified_by',
  'last_return_reason','last_return_stage','status'])||jsonb_build_object('status','DRAFT'));
 s:=jsonb_set(s,'{month_rows}',coalesce((SELECT jsonb_agg(x||jsonb_build_object('status',
  CASE WHEN x->>'status'='LOCKED' THEN 'LOCKED' ELSE 'DRAFT' END) ORDER BY x->>'period_from',x->>'id')
  FROM jsonb_array_elements(s->'month_rows') x WHERE x->>'status'<>'CANCELLED_DRAFT'),'[]'));
 RETURN s;
END; $$;
CREATE FUNCTION public.get_payroll_review_sources(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,extensions AS $$
 SELECT public.payroll_review_source_snapshot(p_row_id,p_actor_id);
$$;

CREATE OR REPLACE FUNCTION public.payroll_guard_draft_row() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE factory boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payroll rows cannot be deleted' USING ERRCODE='42501'; END IF;
 IF NEW.status='LOCKED' THEN RAISE EXCEPTION 'Financial finalization is disabled' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND (NEW.status<>'DRAFT' OR NEW.current_version<>1 OR NEW.review_version<>0 OR NEW.review_revision IS NOT NULL
  OR NEW.submitted_by IS NOT NULL OR NEW.accounts_verified_by IS NOT NULL) THEN
  RAISE EXCEPTION 'New salary rows must start as drafts' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status IN ('LOCKED','CANCELLED_DRAFT') THEN RAISE EXCEPTION 'Terminal salary rows are immutable' USING ERRCODE='42501'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','current_version','assignment_id','review_version','review_revision','submitted_by','accounts_verified_by','last_return_reason','last_return_stage'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_version','assignment_id','review_version','review_revision','submitted_by','accounts_verified_by','last_return_reason','last_return_stage'])
   OR NEW.review_version<>OLD.review_version+1 THEN
   RAISE EXCEPTION 'Salary row identity is immutable; append a review action' USING ERRCODE='42501'; END IF;
  IF NEW.current_version=OLD.current_version+1 THEN
   IF OLD.status NOT IN ('DRAFT','CALCULATED','RETURNED_TO_CREATOR') OR NEW.status<>'DRAFT' OR NEW.review_revision IS DISTINCT FROM OLD.review_revision THEN
    RAISE EXCEPTION 'Only unsubmitted salary rows can be corrected' USING ERRCODE='PY409'; END IF;
  ELSIF NEW.current_version=OLD.current_version THEN
   IF NEW.assignment_id<>OLD.assignment_id OR NOT (
    (OLD.status IN ('DRAFT','CALCULATED','RETURNED_TO_CREATOR') AND NEW.status IN ('CALCULATED','CANCELLED_DRAFT')) OR
    (OLD.status='CALCULATED' AND NEW.status IN ('PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL')) OR
    (OLD.status='PENDING_ACCOUNTS_REVIEW' AND NEW.status IN ('PENDING_HO_APPROVAL','RETURNED_TO_CREATOR')) OR
    (OLD.status='PENDING_HO_APPROVAL' AND NEW.status='RETURNED_TO_CREATOR')) THEN
    RAISE EXCEPTION 'Invalid employee review transition' USING ERRCODE='PY409'; END IF;
   IF (NEW.status='CALCULATED' AND NEW.review_revision IS DISTINCT FROM coalesce(OLD.review_revision,0)+1) OR
    (NEW.status<>'CALCULATED' AND NEW.review_revision IS DISTINCT FROM OLD.review_revision) THEN
    RAISE EXCEPTION 'Calculation revisions are append-only' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Salary content version conflict' USING ERRCODE='PY409'; END IF;
 END IF;
 SELECT g.is_factory INTO factory FROM public.payroll_runs r JOIN public.payroll_groups g ON g.code=r.group_code
  JOIN public.payroll_employee_assignments a ON a.id=NEW.assignment_id
  WHERE r.id=NEW.run_id AND a.employee_id=NEW.employee_id AND a.group_code=r.group_code AND a.department=r.department
   AND NEW.period_from>=r.period_from AND NEW.period_to<=r.period_to AND NEW.period_from>=a.effective_from
   AND (a.effective_to IS NULL OR NEW.period_to<=a.effective_to);
 IF NOT FOUND THEN RAISE EXCEPTION 'Salary row period must match its run and historical assignment' USING ERRCODE='23514'; END IF;
 IF NEW.status NOT IN ('DRAFT','CANCELLED_DRAFT') AND NEW.review_revision IS NULL THEN
  RAISE EXCEPTION 'A calculation revision is required' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL') AND NEW.submitted_by IS NULL THEN
  RAISE EXCEPTION 'Submission provenance is required' USING ERRCODE='23514'; END IF;
 IF NEW.status='PENDING_ACCOUNTS_REVIEW' AND (NOT factory OR NEW.accounts_verified_by IS NOT NULL) THEN
  RAISE EXCEPTION 'Only unverified factory rows await Accounts' USING ERRCODE='23514'; END IF;
 IF NEW.status='PENDING_HO_APPROVAL' AND ((factory AND NEW.accounts_verified_by IS NULL) OR (NOT factory AND NEW.accounts_verified_by IS NOT NULL)) THEN
  RAISE EXCEPTION 'Accounts verification provenance does not match the payroll group' USING ERRCODE='23514'; END IF;
 IF NEW.status='RETURNED_TO_CREATOR' AND (NEW.last_return_reason IS NULL OR NEW.last_return_stage IS NULL OR NEW.accounts_verified_by IS NOT NULL) THEN
  RAISE EXCEPTION 'Returns require reason/stage and fresh Accounts review' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

-- Legacy note edits remain available for original draft preparation. They cannot
-- modify submitted rows or bypass the reasoned Phase 4 correction route.
CREATE OR REPLACE FUNCTION public.revise_payroll_draft_note(p_row_id uuid,p_expected_version integer,p_note text,p_actor_id uuid)
RETURNS public.payroll_run_employees LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; e public.payroll_run_employees%ROWTYPE; role text;
BEGIN
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id;
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

CREATE FUNCTION public.transition_payroll_employee_review(p_row_id uuid,p_expected_version integer,
 p_expected_review_version integer,p_action text,p_data jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; r public.payroll_runs%ROWTYPE; v public.payroll_review_revisions%ROWTYPE;
 role text; factory boolean; before_state text; next_state text; action_name text; reason text;
 src jsonb; token text; calc jsonb; blockers jsonb; m date; assignment uuid; beneficiary uuid;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
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
 IF p_action='approve_lock' THEN
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
  -- No path to LOCKED exists in Phase 4, even for forged service-role results.
  -- A later migration must implement real statutory-month reconciliation and
  -- immutable posting together, not flip a UI/server flag or drop one trigger.
  blockers:=coalesce(calc->'blockers','[]'::jsonb);
  IF src->'statutory_profile'='null'::jsonb THEN blockers:=blockers||'[{"code":"EMPLOYEE_STATUTORY_PROFILE_REQUIRED","kind":"statutory"}]'; END IF;
  IF calc->>'gross_after_lop' IS NULL THEN blockers:=blockers||'[{"code":"COMPLETE_GROSS_REQUIRED","kind":"calculation"}]'; END IF;
  IF calc->>'final_net_salary' IS NULL THEN blockers:=blockers||'[{"code":"FINAL_NET_SALARY_REQUIRED","kind":"statutory"}]'; END IF;
  IF factory AND (e.accounts_verified_by IS NULL OR e.accounts_verified_by=e.submitted_by) THEN
   RAISE EXCEPTION 'Independent Accounts provenance required' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_employee_coverage c WHERE c.employee_id=e.employee_id AND daterange(c.period_from,c.period_to,'[]') && daterange(e.period_from,e.period_to,'[]')) THEN
   blockers:=blockers||'[{"code":"FINALIZED_COVERAGE_EXISTS","kind":"reconciliation"}]'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_employee_month_entitlements m WHERE m.employee_id=e.employee_id AND m.salary_month BETWEEN date_trunc('month',e.period_from)::date AND e.period_to AND (m.allocated_base<>0 OR m.lop_amount<>0)) THEN
   blockers:=blockers||'[{"code":"POSTED_MONTH_REQUIRES_RECONCILIATION","kind":"reconciliation"}]'; END IF;
  blockers:=blockers||'[{"code":"STATUTORY_MONTH_FINALIZATION_NOT_IMPLEMENTED","kind":"reconciliation"},{"code":"FINANCIAL_FINALIZATION_DISABLED","kind":"gate"}]';
  INSERT INTO public.payroll_action_history(run_id,row_id,row_version,action,actor_id,actor_role,from_status,to_status,reason,review_version,review_revision)
   VALUES(e.run_id,e.id,e.current_version,'LOCK_BLOCKED',p_actor_id,role,e.status,e.status,'Final lock blocked by statutory/reconciliation dependencies',e.review_version,e.review_revision);
  RETURN jsonb_build_object('applied',false,'code','PAYROLL_LOCK_BLOCKED','row',to_jsonb(e),'blockers',blockers,'financial_finalization_enabled',false);
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

-- Parent status is derived; the immutable Phase 1 container is not an approval.
CREATE FUNCTION public.payroll_review_progress(p_run_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 WITH counts AS (SELECT count(*) total,count(*) FILTER(WHERE status='LOCKED') locked,
  count(*) FILTER(WHERE status='CANCELLED_DRAFT') cancelled,count(*) FILTER(WHERE status IN ('DRAFT','CALCULATED')) draft,
  count(*) FILTER(WHERE status='PENDING_ACCOUNTS_REVIEW') accounts,count(*) FILTER(WHERE status='PENDING_HO_APPROVAL') ho,
  count(*) FILTER(WHERE status='RETURNED_TO_CREATOR') returned FROM public.payroll_run_employees WHERE run_id=p_run_id)
 SELECT to_jsonb(c)||jsonb_build_object('status',CASE WHEN total=0 THEN 'DRAFT' WHEN cancelled=total THEN 'CANCELLED_EMPTY'
  WHEN locked=total THEN 'COMPLETE' WHEN locked>0 THEN 'PARTIALLY_LOCKED' WHEN draft+cancelled=total THEN 'DRAFT'
  WHEN returned>0 OR EXISTS(SELECT 1 FROM public.payroll_action_history WHERE run_id=p_run_id AND action='ACCOUNTS_FORWARDED') THEN 'IN_REVIEW'
  ELSE 'SUBMITTED' END,'financial_finalization_enabled',false) FROM counts c;
$$;
CREATE FUNCTION public.get_payroll_review_queue(p_actor_id uuid,p_run_id uuid DEFAULT NULL,p_status text DEFAULT NULL,
 p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE context jsonb; result jsonb; BEGIN
 context:=public.get_payroll_foundation_context(p_actor_id);
 IF p_page IS NULL OR p_limit IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 100
  OR (p_status IS NOT NULL AND p_status NOT IN ('DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED')) THEN
  RAISE EXCEPTION 'Invalid review queue selection' USING ERRCODE='22023'; END IF;
 IF p_run_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.payroll_runs WHERE id=p_run_id) THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=p_run_id),false);
 END IF;
 WITH visible_runs AS (SELECT r.* FROM public.payroll_runs r WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(context->'groups') g WHERE g->>'code'=r.group_code AND g->>'department'=r.department)),
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
CREATE FUNCTION public.get_payroll_employee_review(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; result jsonb; src jsonb; d text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 src:=public.payroll_review_source_snapshot(p_row_id,p_actor_id);
 -- Historical salary evidence is subject to scope too, including a former
 -- factory in a previous submission that the current assignment no longer lists.
 FOR d IN SELECT DISTINCT x->>'department' FROM public.payroll_review_revisions v,
  LATERAL jsonb_array_elements(coalesce(v.source_snapshot->'assignments','[]')||coalesce(v.source_snapshot->'attendance','[]')) x
  WHERE v.row_id=e.id AND x->>'department' IS NOT NULL LOOP
  PERFORM public.payroll_require_scope(p_actor_id,d,false);
 END LOOP;
 SELECT jsonb_build_object('row',to_jsonb(e),'run',(SELECT to_jsonb(r)||jsonb_build_object('container_status',r.status,'status',public.payroll_review_progress(r.id)->'status') FROM public.payroll_runs r WHERE r.id=e.run_id),
  'employee_self',(SELECT coalesce(erp_user_id=p_actor_id,false) FROM public.hr_employees WHERE id=e.employee_id),
  'source',src,'progress',public.payroll_review_progress(e.run_id),
  'revisions',coalesce((SELECT jsonb_agg(to_jsonb(v)-ARRAY['source_snapshot','source_token'] ORDER BY revision) FROM public.payroll_review_revisions v WHERE row_id=e.id),'[]'),
  'content_versions',coalesce((SELECT jsonb_agg(jsonb_build_object('version',version,'note',note,'created_by',created_by,'created_at',created_at) ORDER BY version) FROM public.payroll_row_versions WHERE row_id=e.id),'[]'),
  'actions',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.payroll_action_history a WHERE row_id=e.id),'[]'),
  'financial_finalization_enabled',false,'payment_status','NOT_ELIGIBLE') INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_review_source_snapshot(uuid,uuid),public.payroll_review_progress(uuid),
 public.get_payroll_review_sources(uuid,uuid),public.transition_payroll_employee_review(uuid,integer,integer,text,jsonb,uuid),
 public.get_payroll_review_queue(uuid,uuid,text,integer,integer),public.get_payroll_employee_review(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_review_sources(uuid,uuid),
 public.transition_payroll_employee_review(uuid,integer,integer,text,jsonb,uuid),
 public.get_payroll_review_queue(uuid,uuid,text,integer,integer),public.get_payroll_employee_review(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';

-- Extend the existing read surfaces too: parent approval status is always derived.
CREATE OR REPLACE FUNCTION public.get_payroll_draft_run(p_run_id uuid,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; v_result jsonb; progress jsonb;
BEGIN
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id;
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
CREATE OR REPLACE FUNCTION public.list_payroll_preview_runs(p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE context jsonb; result jsonb; BEGIN
 context:=public.get_payroll_foundation_context(p_actor_id);
 IF p_page NOT BETWEEN 1 AND 100000 OR p_limit NOT BETWEEN 1 AND 100 OR p_page IS NULL OR p_limit IS NULL THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 WITH visible AS (SELECT r.* FROM public.payroll_runs r WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(context->'groups') g WHERE g->>'code'=r.group_code AND g->>'department'=r.department)),
 page AS (SELECT * FROM visible ORDER BY created_at DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('runs',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('container_status',r.status,'status',public.payroll_review_progress(r.id)->'status','progress',public.payroll_review_progress(r.id)) ORDER BY created_at DESC,id) FROM page r),'[]'),'total',(SELECT count(*) FROM visible),'page',p_page,'limit',p_limit,'financial_workflows_enabled',false) INTO result;
 RETURN result;
END; $$;
