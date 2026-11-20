-- Financial architecture remains deployment-gated pending separate UAT activation.
CREATE FUNCTION public.payroll_financial_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.payroll_financial_enabled() FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.payroll_financial_snapshots (
 row_id uuid PRIMARY KEY,employee_id uuid NOT NULL,review_revision integer NOT NULL,
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),source_token text NOT NULL,
 source_snapshot jsonb NOT NULL,calculation_snapshot jsonb NOT NULL,
 earnings_total numeric(18,6) NOT NULL CHECK(earnings_total>=0),deductions_total numeric(18,6) NOT NULL CHECK(deductions_total>=0),
 net_salary numeric(14,2) NOT NULL CHECK(net_salary>=0),locked_by uuid NOT NULL REFERENCES public.authorised_users(id),locked_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(row_id,employee_id) REFERENCES public.payroll_run_employees(id,employee_id),
 FOREIGN KEY(row_id,review_revision) REFERENCES public.payroll_review_revisions(row_id,revision),
 CHECK(jsonb_typeof(source_snapshot)='object' AND jsonb_typeof(calculation_snapshot)='object' AND calculation_snapshot->'blockers'='[]'::jsonb
  AND calculation_snapshot->>'status'='READY_FOR_REVIEW' AND calculation_snapshot->>'source_fingerprint'=source_fingerprint
  AND (calculation_snapshot->>'final_net_salary')::numeric=net_salary AND round(earnings_total-deductions_total,2)=net_salary),UNIQUE(row_id,employee_id)
);
CREATE TABLE public.payroll_statutory_entries (
 salary_row_id uuid NOT NULL,employee_id uuid NOT NULL,scheme text NOT NULL CHECK(scheme IN ('EPF','ESI','PT')),
 contribution_month date NOT NULL CHECK(isfinite(contribution_month) AND extract(day FROM contribution_month)=1),
 statutory_scope_id uuid NOT NULL REFERENCES public.payroll_statutory_scopes(id),rule_revision_id uuid REFERENCES public.payroll_statutory_rule_revisions(id),
 eligible_wage jsonb NOT NULL CHECK(jsonb_typeof(eligible_wage)='object' AND eligible_wage ?& ARRAY['numerator','denominator']),
 employee_amount numeric(18,6) NOT NULL CHECK(employee_amount>=0),employer_amount numeric(18,6) NOT NULL CHECK(employer_amount>=0),
 source_profile_id uuid NOT NULL REFERENCES public.payroll_employee_statutory_profiles(id),
 FOREIGN KEY(salary_row_id,employee_id) REFERENCES public.payroll_financial_snapshots(row_id,employee_id),
 PRIMARY KEY(salary_row_id,scheme,contribution_month)
);
CREATE INDEX payroll_statutory_month_idx ON public.payroll_statutory_entries(employee_id,scheme,contribution_month,salary_row_id);
-- One logical accumulator per employee/scheme/month, derived from immutable entries.
-- This view's numeric wage is for reporting; calculation sums exact fractions.
CREATE VIEW public.payroll_statutory_accumulators WITH (security_invoker=true) AS
 SELECT employee_id,scheme,contribution_month,sum(employee_amount) employee_collected,sum(employer_amount) employer_accrued,count(*) posted_runs
 FROM public.payroll_statutory_entries GROUP BY employee_id,scheme,contribution_month;
CREATE TABLE public.payroll_adjustment_applications (
 adjustment_id uuid NOT NULL,salary_row_id uuid NOT NULL,employee_id uuid NOT NULL,
 contribution_month date NOT NULL CHECK(isfinite(contribution_month) AND extract(day FROM contribution_month)=1),amount numeric(14,2) NOT NULL CHECK(amount<>0),
 FOREIGN KEY(adjustment_id,employee_id) REFERENCES public.payroll_adjustments(id,employee_id),
 FOREIGN KEY(salary_row_id,employee_id) REFERENCES public.payroll_financial_snapshots(row_id,employee_id),
 PRIMARY KEY(adjustment_id,salary_row_id,contribution_month)
);
CREATE INDEX payroll_advance_application_month_idx ON public.payroll_adjustment_applications(adjustment_id,contribution_month,salary_row_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['payroll_financial_snapshots','payroll_statutory_entries','payroll_adjustment_applications'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER payroll_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable()',t);
 END LOOP;
END; $$;
REVOKE ALL ON public.payroll_statutory_accumulators FROM PUBLIC,anon,authenticated,service_role;
-- Strip only new explicit configuration fields before the legacy strict validator.
ALTER FUNCTION public.payroll_validate_master(text,jsonb) RENAME TO payroll_validate_master_108;
CREATE FUNCTION public.payroll_validate_master(p_kind text,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE c jsonb:=d->'configuration'; legacy jsonb:=d;
BEGIN
 IF p_kind='statutory' THEN
  IF c ? 'arrears_period' AND c->>'arrears_period' NOT IN ('UNRESOLVED','CURRENT_RUN_MONTH') THEN RAISE EXCEPTION 'Invalid arrears contribution period' USING ERRCODE='22023'; END IF;
  IF c ? 'collection_timing' AND c->>'collection_timing' NOT IN ('UNRESOLVED','INCREMENTAL_MONTHLY','MONTH_CLOSE') THEN RAISE EXCEPTION 'Invalid statutory collection timing' USING ERRCODE='22023'; END IF;
  IF c ? 'lop_wage_basis' AND c->>'lop_wage_basis' NOT IN ('UNRESOLVED','PROPORTIONAL_COMPONENTS') THEN RAISE EXCEPTION 'Invalid LOP wage basis' USING ERRCODE='22023'; END IF;
  legacy:=jsonb_set(d,'{configuration}',c-ARRAY['collection_timing','lop_wage_basis','arrears_period']);
 END IF;
 RETURN public.payroll_validate_master_108(p_kind,legacy);
END; $$;
REVOKE ALL ON FUNCTION public.payroll_validate_master_108(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.publish_payroll_calendar_days(p_group text,p_department text,p_days jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE d jsonb; ids jsonb:='[]'; id uuid;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['ho','admin']);
 PERFORM public.payroll_require_scope(p_actor_id,p_department,false);
 IF jsonb_typeof(p_days) IS DISTINCT FROM 'array' OR jsonb_array_length(p_days) NOT BETWEEN 1 AND 732 OR p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Calendar evidence required' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT * FROM jsonb_array_elements(p_days) LOOP
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('calendar_date','day_type','compensation_treatment')) THEN RAISE EXCEPTION 'Invalid calendar day' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_employee_coverage c JOIN public.payroll_run_employees e ON e.id=c.salary_row_id JOIN public.payroll_runs r ON r.id=e.run_id WHERE r.group_code=p_group AND r.department=p_department AND (d->>'calendar_date')::date BETWEEN c.period_from AND c.period_to) THEN RAISE EXCEPTION 'A Locked calendar period is immutable' USING ERRCODE='PY409'; END IF;
  INSERT INTO public.payroll_work_calendar_days(group_code,department,calendar_date,day_type,compensation_treatment,status,evidence_reference,created_by)
  VALUES(p_group,p_department,(d->>'calendar_date')::date,d->>'day_type',d->>'compensation_treatment','PUBLISHED',p_evidence,p_actor_id) RETURNING payroll_work_calendar_days.id INTO id;
  ids:=ids||to_jsonb(id);
 END LOOP;
 RETURN jsonb_build_object('ids',ids,'payments_enabled',false);
END; $$;
REVOKE ALL ON FUNCTION public.publish_payroll_calendar_days(text,text,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_payroll_calendar_days(text,text,jsonb,text,uuid) TO service_role;


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
  'financial_context',jsonb_build_object('activation_enabled',public.payroll_financial_enabled()),
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
NOTIFY pgrst,'reload schema';
