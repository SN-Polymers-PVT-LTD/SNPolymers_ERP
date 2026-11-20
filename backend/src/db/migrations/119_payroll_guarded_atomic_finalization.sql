-- Guarded atomic finalization. Deployment activation remains false in 118.
CREATE TABLE public.payroll_period_cutoffs (
 run_id uuid NOT NULL REFERENCES public.payroll_runs(id),version integer NOT NULL CHECK(version>0),
 cutoff_at timestamptz NOT NULL CHECK(isfinite(cutoff_at)),status text NOT NULL CHECK(status IN ('PROPOSED','APPROVED')),
 proposed_by uuid NOT NULL REFERENCES public.authorised_users(id),approved_by uuid REFERENCES public.authorised_users(id),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 2000),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,version),CHECK((status='PROPOSED' AND approved_by IS NULL) OR (status='APPROVED' AND approved_by IS NOT NULL AND approved_by<>proposed_by))
);
ALTER TABLE public.payroll_period_cutoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_period_cutoffs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payroll_immutable BEFORE UPDATE OR DELETE ON public.payroll_period_cutoffs FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();
CREATE FUNCTION public.set_payroll_period_cutoff(p_run_id uuid,p_expected_version integer,p_action text,p_cutoff timestamptz,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE role text; r public.payroll_runs%ROWTYPE; prior public.payroll_period_cutoffs%ROWTYPE; result public.payroll_period_cutoffs%ROWTYPE;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['accounts','ho']);
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
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
REVOKE ALL ON FUNCTION public.set_payroll_period_cutoff(uuid,integer,text,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_payroll_period_cutoff(uuid,integer,text,timestamptz,text,uuid) TO service_role;
-- Monetary records cannot be inserted before the private deployment gate opens.
CREATE FUNCTION public.payroll_financial_insert_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NOT public.payroll_financial_enabled() THEN RAISE EXCEPTION 'Financial finalization is disabled' USING ERRCODE='42501'; END IF; RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.payroll_financial_insert_gate() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['payroll_financial_snapshots','payroll_statutory_entries','payroll_adjustment_applications'] LOOP
 EXECUTE format('CREATE TRIGGER payroll_financial_gate BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.payroll_financial_insert_gate()',t);
END LOOP; END; $$;
ALTER TABLE public.payroll_financial_snapshots ADD CONSTRAINT payroll_complete_snapshot CHECK(
 calculation_snapshot ?& ARRAY['status','blockers','source_fingerprint','final_net_salary','financial_readiness','calculation_revision'] AND
 calculation_snapshot->>'financial_readiness'='true' AND calculation_snapshot->>'calculation_revision'='PHASE6_V1' AND calculation_snapshot->>'final_net_salary' IS NOT NULL);
ALTER TABLE public.payroll_adjustments ADD CONSTRAINT payroll_advance_start_after_issue CHECK(kind<>'ADVANCE' OR recovery_start_month>=date_trunc('month',effective_date)::date);
-- Keep the original posting gates; replace their bodies only alongside atomic writes.
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.payroll_employee_month_entitlements'::regclass AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%status%' OR pg_get_constraintdef(oid) LIKE '%allocated_base%' OR pg_get_constraintdef(oid) LIKE '%lop_amount%') LOOP
 EXECUTE format('ALTER TABLE public.payroll_employee_month_entitlements DROP CONSTRAINT %I',c.conname); END LOOP; END; $$;
ALTER TABLE public.payroll_employee_month_entitlements ADD CHECK(status IN ('UNRESOLVED','FINALIZED')),
 ADD CHECK(allocated_base>=0 AND lop_amount>=0 AND (contractual_gross IS NULL OR allocated_base<=contractual_gross)),
 ADD CHECK(status<>'FINALIZED' OR (contractual_gross IS NOT NULL AND policy_revision_id IS NOT NULL));
ALTER TABLE public.payroll_month_allocations ADD COLUMN lop_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(lop_amount>=0);
CREATE OR REPLACE FUNCTION public.payroll_phase1_no_posting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT public.payroll_financial_enabled() THEN RAISE EXCEPTION 'Payroll financial posting is disabled' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND TG_TABLE_NAME<>'payroll_employee_month_entitlements') THEN RAISE EXCEPTION 'Financial records are immutable' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='payroll_employee_month_entitlements' AND TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['allocated_base','lop_amount','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['allocated_base','lop_amount','version']) OR NEW.version<>OLD.version+1 OR NEW.allocated_base<OLD.allocated_base OR NEW.lop_amount<OLD.lop_amount THEN RAISE EXCEPTION 'Monthly entitlement identity is immutable' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME='payroll_employee_coverage' AND NOT EXISTS(SELECT 1 FROM public.payroll_financial_snapshots f JOIN public.payroll_run_employees e ON e.id=f.row_id WHERE f.row_id=NEW.salary_row_id AND f.employee_id=NEW.employee_id AND e.period_from=NEW.period_from AND e.period_to=NEW.period_to) THEN RAISE EXCEPTION 'Immutable salary snapshot required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='payroll_month_allocations' AND NOT EXISTS(SELECT 1 FROM public.payroll_financial_snapshots f JOIN public.payroll_employee_month_entitlements m ON m.id=NEW.entitlement_id WHERE f.row_id=NEW.salary_row_id AND f.employee_id=m.employee_id) THEN RAISE EXCEPTION 'Allocation employee ownership required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.get_payroll_preview_sources(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; r public.payroll_runs%ROWTYPE; permanent boolean; lo date; hi date; result jsonb;
BEGIN
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id;
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
   AND daterange(s.effective_from,s.effective_to,'[]') && daterange(greatest(lo,p.effective_from),least(hi,p.effective_to),'[]')),
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
REVOKE ALL ON FUNCTION public.get_payroll_preview_sources(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_preview_sources(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.payroll_guard_draft_row() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE factory boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payroll rows cannot be deleted' USING ERRCODE='42501'; END IF;
 IF NEW.status='LOCKED' AND (NOT public.payroll_financial_enabled() OR TG_OP<>'UPDATE' OR NOT EXISTS(SELECT 1 FROM public.payroll_financial_snapshots WHERE row_id=NEW.id AND review_revision=NEW.review_revision)) THEN RAISE EXCEPTION 'Financial finalization is disabled or incomplete' USING ERRCODE='42501'; END IF;
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
    (OLD.status='PENDING_HO_APPROVAL' AND NEW.status IN ('RETURNED_TO_CREATOR','LOCKED'))) THEN
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

CREATE FUNCTION public.payroll_finalize_employee(p_row_id uuid,p_calc jsonb,p_source jsonb,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; x jsonb; m public.payroll_employee_month_entitlements%ROWTYPE; a public.payroll_adjustments%ROWTYPE;
 prior_employee numeric; prior_employer numeric; outstanding numeric; month_collected numeric; earnings numeric; deductions numeric; base numeric; lop numeric; cutoff jsonb;
BEGIN
 IF NOT public.payroll_financial_enabled() THEN RAISE EXCEPTION 'Financial finalization is disabled' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 cutoff:=p_source->'financial_context'->'cutoff';
 IF cutoff->>'status' IS DISTINCT FROM 'APPROVED' OR (cutoff->>'cutoff_at')::timestamptz>now() THEN RAISE EXCEPTION 'Approved cutoff must be reached before locking' USING ERRCODE='PY409'; END IF;
 IF p_calc->>'financial_readiness' IS DISTINCT FROM 'true' OR p_calc->>'status' IS DISTINCT FROM 'READY_FOR_REVIEW' OR p_calc->'blockers' IS DISTINCT FROM '[]'::jsonb OR p_calc->>'final_net_salary' IS NULL THEN RAISE EXCEPTION 'Complete financial readiness required' USING ERRCODE='23514'; END IF;
 SELECT sum((v->>'amount')::numeric) INTO earnings FROM jsonb_array_elements(p_calc->'earnings') v;
 SELECT coalesce(sum((v->>'amount')::numeric),0) INTO deductions FROM jsonb_array_elements(p_calc->'deductions') v;
 IF earnings IS DISTINCT FROM (p_calc->>'earnings_total')::numeric OR deductions IS DISTINCT FROM (p_calc->>'deductions_total')::numeric OR earnings<0 OR deductions<0 OR earnings-deductions<0 OR round(earnings-deductions,2) IS DISTINCT FROM (p_calc->>'final_net_salary')::numeric THEN RAISE EXCEPTION 'Salary line reconciliation failed' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(p_calc->'statutory_entries')<>3*(12*(extract(year FROM e.period_to)-extract(year FROM e.period_from))+extract(month FROM e.period_to)-extract(month FROM e.period_from)+1) THEN RAISE EXCEPTION 'Every statutory scheme/month needs a verified entry' USING ERRCODE='23514'; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'statutory_entries') LOOP
  IF NOT EXISTS(SELECT 1 FROM public.payroll_employee_statutory_profiles p JOIN public.payroll_source_history_revisions h ON h.id=p.revision_id WHERE p.id=(x->>'source_profile_id')::uuid AND h.employee_id=e.employee_id AND p.scheme=x->>'scheme' AND p.statutory_scope_id=(x->>'statutory_scope_id')::uuid AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND p.applicability<>'UNRESOLVED') THEN RAISE EXCEPTION 'Verified statutory profile required' USING ERRCODE='23514'; END IF;
  IF (x->>'salary_month')::date NOT BETWEEN date_trunc('month',e.period_from)::date AND date_trunc('month',e.period_to)::date THEN RAISE EXCEPTION 'Statutory contribution month mismatch' USING ERRCODE='23514'; END IF;
  IF x->>'rule_revision_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payroll_statutory_rule_revisions r JOIN public.payroll_statutory_scope_bindings b ON b.revision_id=r.id WHERE r.id=(x->>'rule_revision_id')::uuid AND r.status='PUBLISHED' AND r.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND r.scheme=x->>'scheme' AND b.statutory_scope_id=(x->>'statutory_scope_id')::uuid AND (x->>'salary_month')::date BETWEEN r.effective_from AND r.effective_to) THEN RAISE EXCEPTION 'Published applicable statutory revision required' USING ERRCODE='23514'; END IF;
  SELECT coalesce(sum(employee_amount),0),coalesce(sum(employer_amount),0) INTO prior_employee,prior_employer FROM public.payroll_statutory_entries WHERE employee_id=e.employee_id AND scheme=x->>'scheme' AND contribution_month=(x->>'salary_month')::date;
  IF prior_employee IS DISTINCT FROM (x->>'previous_employee_collected')::numeric OR prior_employer IS DISTINCT FROM (x->>'previous_employer_accrued')::numeric OR (x->>'employee_amount')::numeric+prior_employee IS DISTINCT FROM (x->>'monthly_employee_liability')::numeric OR (x->>'employer_amount')::numeric+prior_employer IS DISTINCT FROM (x->>'monthly_employer_liability')::numeric THEN RAISE EXCEPTION 'Statutory month changed or failed reconciliation' USING ERRCODE='PY409'; END IF;
  IF (x->'eligible_wage'->>'numerator')::numeric<0 OR (x->'eligible_wage'->>'denominator')::numeric<=0 THEN RAISE EXCEPTION 'Invalid exact statutory wage' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'adjustment_applications') LOOP
  SELECT * INTO a FROM public.payroll_adjustments WHERE id=(x->>'adjustment_id')::uuid FOR UPDATE;
  IF NOT FOUND OR a.employee_id<>e.employee_id OR a.status<>'APPROVED' OR a.version<>(x->>'version')::integer OR a.approved_by IS NULL OR a.approved_by=a.created_by THEN RAISE EXCEPTION 'Approved adjustment changed' USING ERRCODE='PY409'; END IF;
  IF a.kind='ADVANCE' THEN
   SELECT a.amount-coalesce(sum(amount),0),coalesce(sum(amount) FILTER(WHERE contribution_month=(x->>'contribution_month')::date),0) INTO outstanding,month_collected FROM public.payroll_adjustment_applications WHERE adjustment_id=a.id;
   IF (x->>'amount')::numeric<=0 OR (x->>'amount')::numeric>outstanding OR (x->>'amount')::numeric+month_collected>a.installment OR (x->>'contribution_month')::date<a.recovery_start_month THEN RAISE EXCEPTION 'Advance balance or monthly recovery limit exceeded' USING ERRCODE='PY409'; END IF;
  ELSIF a.target_row_id<>e.id OR (x->>'amount')::numeric<>a.amount OR EXISTS(SELECT 1 FROM public.payroll_adjustment_applications WHERE adjustment_id=a.id) THEN RAISE EXCEPTION 'Adjustment target mismatch or already applied' USING ERRCODE='PY409'; END IF;
 END LOOP;
 INSERT INTO public.payroll_financial_snapshots(row_id,employee_id,review_revision,source_fingerprint,source_token,source_snapshot,calculation_snapshot,earnings_total,deductions_total,net_salary,locked_by)
 VALUES(e.id,e.employee_id,e.review_revision,p_calc->>'source_fingerprint',encode(digest(p_source::text,'sha256'),'hex'),p_source,p_calc,earnings,deductions,(p_calc->>'final_net_salary')::numeric,p_actor_id);
 INSERT INTO public.payroll_employee_coverage(employee_id,salary_row_id,period_from,period_to,finalized_at) VALUES(e.employee_id,e.id,e.period_from,e.period_to,now());
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'monthly_reconciliation') LOOP
  SELECT (v->>'amount')::numeric INTO base FROM jsonb_array_elements(x->'allocations') v WHERE v->>'row_id'=e.id::text;
  SELECT coalesce(sum((v->>'amount')::numeric),0) INTO lop FROM jsonb_array_elements(p_calc->'deductions') v WHERE v->>'code'='LOP' AND v->>'salary_month'=x->>'salary_month';
  IF base IS NULL OR x->>'contractual_entitlement' IS NULL OR jsonb_array_length(x->'policy_revision_ids')<>1 OR x->>'unallocated_entitlement' IS DISTINCT FROM '0.00' THEN RAISE EXCEPTION 'Complete monthly salary plan required' USING ERRCODE='23514'; END IF;
  SELECT * INTO m FROM public.payroll_employee_month_entitlements WHERE employee_id=e.employee_id AND salary_month=(x->>'salary_month')::date FOR UPDATE;
  IF NOT FOUND THEN
   INSERT INTO public.payroll_employee_month_entitlements(employee_id,salary_month,policy_revision_id,source_segments,status,contractual_gross)
   VALUES(e.employee_id,(x->>'salary_month')::date,(x->'policy_revision_ids'->>0)::uuid,x->'allocations','FINALIZED',(x->>'contractual_entitlement')::numeric) RETURNING * INTO m;
  ELSIF m.status<>'FINALIZED' OR m.contractual_gross<>(x->>'contractual_entitlement')::numeric OR m.policy_revision_id<>(x->'policy_revision_ids'->>0)::uuid OR m.source_segments IS DISTINCT FROM x->'allocations' THEN RAISE EXCEPTION 'Frozen monthly entitlement or allocation plan changed' USING ERRCODE='PY409'; END IF;
  IF m.allocated_base+base>m.contractual_gross OR m.lop_amount+lop>m.contractual_gross THEN RAISE EXCEPTION 'Monthly entitlement exceeded' USING ERRCODE='23514'; END IF;
  INSERT INTO public.payroll_month_allocations(entitlement_id,salary_row_id,base_amount,lop_amount) VALUES(m.id,e.id,base,lop);
  UPDATE public.payroll_employee_month_entitlements SET allocated_base=allocated_base+base,lop_amount=lop_amount+lop,version=version+1 WHERE id=m.id;
 END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'statutory_entries') LOOP
  INSERT INTO public.payroll_statutory_entries(salary_row_id,employee_id,scheme,contribution_month,statutory_scope_id,rule_revision_id,eligible_wage,employee_amount,employer_amount,source_profile_id)
  VALUES(e.id,e.employee_id,x->>'scheme',(x->>'salary_month')::date,(x->>'statutory_scope_id')::uuid,(x->>'rule_revision_id')::uuid,x->'eligible_wage',(x->>'employee_amount')::numeric,(x->>'employer_amount')::numeric,(x->>'source_profile_id')::uuid);
 END LOOP;
 FOR x IN SELECT * FROM jsonb_array_elements(p_calc->'adjustment_applications') LOOP
  INSERT INTO public.payroll_adjustment_applications(adjustment_id,salary_row_id,employee_id,contribution_month,amount) VALUES((x->>'adjustment_id')::uuid,e.id,e.employee_id,(x->>'contribution_month')::date,(x->>'amount')::numeric);
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_finalize_employee(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.payroll_action_history'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%action%' LOOP EXECUTE format('ALTER TABLE public.payroll_action_history DROP CONSTRAINT %I',c.conname); END LOOP; END; $$;
ALTER TABLE public.payroll_action_history ADD CHECK(action IN ('DRAFT_CREATED','DRAFT_VERSION_CREATED','CALCULATED','SUBMITTED','ACCOUNTS_FORWARDED','RETURNED','CORRECTED','CANCELLED_DRAFT','LOCK_BLOCKED','LOCKED'));
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
  LOCK TABLE public.payroll_source_history_revisions,public.payroll_employee_assignments,public.payroll_permanent_pay_applicability,public.hr_permanent_pay_structures,public.hr_attendance_rows,public.hr_attendance_sheets,public.hr_leave_requests,public.payroll_policy_master_revisions,public.payroll_work_calendar_days,public.payroll_statutory_rule_revisions,public.payroll_statutory_scope_bindings,public.payroll_employee_statutory_profiles,public.payroll_professional_tax_slabs,public.hr_factory_wage_revisions,public.hr_factory_pay_rule_revisions IN SHARE MODE;
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
