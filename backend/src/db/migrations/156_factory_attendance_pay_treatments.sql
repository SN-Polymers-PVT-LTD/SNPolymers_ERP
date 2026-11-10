-- Executable attendance treatments from the client's 28 October decisions.
SET LOCAL search_path=public,extensions;
CREATE TABLE public.hr_factory_pay_rule_treatments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 rule_revision_id uuid NOT NULL UNIQUE REFERENCES public.hr_factory_pay_rule_revisions(id) ON DELETE RESTRICT,
 holiday_salary_days numeric(8,4) CHECK(holiday_salary_days>0 AND holiday_salary_days<=366),
 short_hours_method text NOT NULL DEFAULT 'MISSING_HOURS' CHECK(short_hours_method='MISSING_HOURS'),
 management_stoppage_method text NOT NULL DEFAULT 'RETAIN_NORMAL_PAY' CHECK(management_stoppage_method='RETAIN_NORMAL_PAY'),
 holiday_method text NOT NULL DEFAULT 'TOTAL_DAILY_ENTITLEMENT' CHECK(holiday_method='TOTAL_DAILY_ENTITLEMENT'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_factory_pay_rule_treatments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_factory_pay_rule_treatments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hr_factory_pay_rule_treatments TO service_role;
CREATE FUNCTION public.factory_treatment_impact(p_rule_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 RETURN factory_calculation_impact(p_rule_id,p_actor_id)||jsonb_build_object('already_configured',EXISTS(SELECT 1 FROM hr_factory_pay_rule_treatments WHERE rule_revision_id=p_rule_id));
END; $$;
CREATE FUNCTION public.guard_factory_treatment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.hr_factory_pay_rule_revisions%ROWTYPE; required boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Attendance pay settings are immutable; create a new rule revision' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM authorised_users WHERE id=NEW.created_by AND is_active AND role IN ('admin','factory_manager') FOR SHARE) THEN RAISE EXCEPTION 'Factory Manager or Admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM hr_factory_pay_rule_revisions WHERE id=NEW.rule_revision_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Factory rule not found' USING ERRCODE='23503'; END IF;
 PERFORM payroll_source_fence('factory:'||r.employee_category,false);
 required:=r.holiday_pay_enabled AND r.employee_category IN ('SNP Permanent Factory Labour','Fabric Factory Permanent Employees');
 IF required<>(NEW.holiday_salary_days IS NOT NULL) THEN RAISE EXCEPTION 'Confirm salary conversion days for enabled permanent holiday duty only' USING ERRCODE='23514'; END IF;
 IF (factory_treatment_impact(r.id,NEW.created_by)->>'locked_rows')::bigint>0 THEN RAISE EXCEPTION 'Attendance pay setup overlaps locked payroll; use a future rule or correction' USING ERRCODE='PY409'; END IF;
 NEW.created_at:=now();RETURN NEW;
END; $$;
CREATE TRIGGER guard_factory_treatment BEFORE INSERT OR UPDATE OR DELETE ON public.hr_factory_pay_rule_treatments FOR EACH ROW EXECUTE FUNCTION public.guard_factory_treatment();
CREATE FUNCTION public.audit_factory_treatment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 INSERT INTO audit_log(user_id,action,module_name,record_identifier,old_value,new_value) VALUES(NEW.created_by::text,'CREATE_REVISION','HR Factory Attendance Pay',NEW.id::text,NULL,to_jsonb(NEW));RETURN NEW;
END; $$;
CREATE TRIGGER audit_factory_treatment AFTER INSERT ON public.hr_factory_pay_rule_treatments FOR EACH ROW EXECUTE FUNCTION public.audit_factory_treatment();
CREATE FUNCTION public.complete_factory_treatment(p_rule_id uuid,p_holiday_salary_days numeric,p_reason text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t public.hr_factory_pay_rule_treatments%ROWTYPE;
BEGIN
 INSERT INTO hr_factory_pay_rule_treatments(rule_revision_id,holiday_salary_days,reason,created_by) VALUES(p_rule_id,p_holiday_salary_days,p_reason,p_actor_id) RETURNING * INTO t;
 RETURN to_jsonb(t)||jsonb_build_object('holiday_salary_days',t.holiday_salary_days::text);
END; $$;
-- One signature, with an optional new argument; no conflicting overload.
DROP FUNCTION public.create_factory_rule(jsonb,jsonb,uuid);
CREATE FUNCTION public.create_factory_rule(p_rule jsonb,p_calculation jsonb,p_actor_id uuid,p_treatment jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.hr_factory_pay_rule_revisions%ROWTYPE; c jsonb; t jsonb;
BEGIN
 IF p_calculation IS NULL AND coalesce((p_rule->>'ot_enabled')::boolean,false) AND p_rule->>'ot_method'<>'Fixed Hourly' THEN
  RAISE EXCEPTION 'Explicit OT calculation setup required' USING ERRCODE='23514'; END IF;
 INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,ot_multiplier,
 holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,short_hours_treatment,comp_off_rule,double_duty_multiplier,created_by,revision_number)
 VALUES(p_rule->>'employee_category',(p_rule->>'effective_from')::date,(p_rule->>'standard_duty_hours')::numeric,(p_rule->>'ot_enabled')::boolean,
 p_rule->>'ot_method',(p_rule->>'ot_rate')::numeric,(p_rule->>'ot_multiplier')::numeric,(p_rule->>'holiday_pay_enabled')::boolean,
 (p_rule->>'holiday_multiplier')::numeric,p_rule->>'management_stoppage_treatment',p_rule->>'short_hours_treatment',p_rule->>'comp_off_rule',(p_rule->>'double_duty_multiplier')::numeric,p_actor_id,1) RETURNING * INTO r;
 IF p_calculation IS NOT NULL THEN c:=complete_factory_calculation(r.id,(p_calculation->>'salary_days')::numeric,p_calculation->>'reason',p_actor_id); END IF;
 IF p_treatment IS NOT NULL THEN t:=complete_factory_treatment(r.id,(p_treatment->>'holiday_salary_days')::numeric,p_treatment->>'reason',p_actor_id); END IF;
 RETURN to_jsonb(r)||jsonb_build_object('calculation',c,'treatment',t);
END; $$;
REVOKE ALL ON FUNCTION public.factory_treatment_impact(uuid,uuid),public.complete_factory_treatment(uuid,numeric,text,uuid),public.guard_factory_treatment(),public.audit_factory_treatment(),public.create_factory_rule(jsonb,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.factory_treatment_impact(uuid,uuid),public.complete_factory_treatment(uuid,numeric,text,uuid),public.create_factory_rule(jsonb,jsonb,uuid,jsonb) TO service_role;
-- Double duty authoring is 2x; retain old immutable revisions as evidence.
ALTER TABLE public.hr_factory_pay_rule_revisions ADD CONSTRAINT local_double_duty_twice CHECK(employee_category<>'Local Daily-Wage Workers' OR double_duty_multiplier=2) NOT VALID;

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
  WHERE s.status='PUBLISHED' AND s.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED')
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
  'pay_structures',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(p)-ARRAY['basic_salary','staff_welfare','other_fixed_components'],ARRAY['guaranteed_monthly_gross']) ORDER BY p.id) FROM public.hr_permanent_pay_structures p WHERE p.id IN (SELECT pay_structure_id FROM pay)),'[]'),
  'attendance',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(a),ARRAY['actual_hours','ot_hours']) ORDER BY attendance_date,id) FROM attendance a),'[]'),
  'wages',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(w),ARRAY['daily_wage']) ORDER BY employee_category,effective_from,id) FROM public.hr_factory_wage_revisions w WHERE w.effective_from<=hi AND w.employee_category IN (SELECT employee_category FROM assignments)),'[]'),
  'factory_rules',coalesce((SELECT jsonb_agg((public.payroll_preview_decimals(to_jsonb(w),ARRAY['standard_duty_hours','ot_rate','ot_multiplier','holiday_multiplier','double_duty_multiplier'])||jsonb_build_object('calculation',(SELECT public.payroll_preview_decimals(to_jsonb(c),ARRAY['salary_days']) FROM public.hr_factory_pay_rule_calculations c WHERE c.rule_revision_id=w.id))||jsonb_build_object('treatment',(SELECT public.payroll_preview_decimals(to_jsonb(t),ARRAY['holiday_salary_days']) FROM public.hr_factory_pay_rule_treatments t WHERE t.rule_revision_id=w.id))) ORDER BY employee_category,effective_from,id) FROM public.hr_factory_pay_rule_revisions w WHERE w.effective_from<=hi AND w.employee_category IN (SELECT employee_category FROM assignments)),'[]'),
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
   WHERE s.status='PUBLISHED' AND s.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED') AND daterange(s.effective_from,s.effective_to,'[]') && daterange(date_trunc('month',lo)::date,hi,'[]')
    AND EXISTS(SELECT 1 FROM profiles p WHERE p.scheme=s.scheme AND p.statutory_scope_id=b.statutory_scope_id AND p.verification_status IN ('ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'))),'[]'),
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
NOTIFY pgrst,'reload schema';
