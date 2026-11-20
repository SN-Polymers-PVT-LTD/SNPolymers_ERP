-- Factory-specific settings; existing rows and attendance references remain intact.
SET LOCAL search_path=public,extensions;
CREATE FUNCTION public.factory_category_department(p_category text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT CASE
 WHEN p_category IN ('SNP Casual Factory Labour','SNP Permanent Factory Labour') THEN 'SNP Factory'
 WHEN p_category IN ('Fabric Factory Casual Factory Labour','Fabric Factory Permanent Employees') THEN 'Fabric Factory' END $$;
REVOKE ALL ON FUNCTION public.factory_category_department(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.factory_category_department(text) TO service_role;
ALTER TABLE public.hr_factory_wage_revisions ADD COLUMN department text, ADD COLUMN setup_reason text;
ALTER TABLE public.hr_factory_pay_rule_revisions ADD COLUMN department text, ADD COLUMN setup_reason text;
ALTER TABLE public.hr_attendance_rows ADD COLUMN master_scope_version smallint NOT NULL DEFAULT 0 CHECK(master_scope_version IN (0,1));
DO $migration$ DECLARE t text; c record; BEGIN
 FOREACH t IN ARRAY ARRAY['hr_factory_wage_revisions','hr_factory_pay_rule_revisions'] LOOP
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid=('public.'||t)::regclass AND contype='u' LOOP
   EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',t,c.conname);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK(department IS NULL OR (department IN (''SNP Factory'',''Fabric Factory'') AND (employee_category=''Local Daily-Wage Workers'' OR department=public.factory_category_department(employee_category))))',t,t||'_scope_check');
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK(setup_reason IS NULL OR length(btrim(setup_reason)) BETWEEN 1 AND 500)',t,t||'_reason_check');
  EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I(employee_category,department,effective_from) WHERE department IS NOT NULL',t||'_scope_date',t);
  EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I(employee_category,department,revision_number) WHERE department IS NOT NULL',t||'_scope_revision',t);
  EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I(employee_category,effective_from) WHERE department IS NULL',t||'_legacy_date',t);
  EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I(employee_category,revision_number) WHERE department IS NULL',t||'_legacy_revision',t);
 END LOOP;
END $migration$;
CREATE OR REPLACE FUNCTION public.guard_factory_master_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_role text; v_active boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Factory master revisions are immutable; create a new revision' USING ERRCODE = 'P0001';
  END IF;
  SELECT role, is_active INTO v_role, v_active FROM public.authorised_users WHERE id = NEW.created_by FOR SHARE;
  IF NOT COALESCE(v_active, false) OR v_role NOT IN ('admin', 'factory_manager') THEN
    RAISE EXCEPTION 'Factory Manager or Admin required' USING ERRCODE = '42501';
  END IF;
  NEW.department:=coalesce(NEW.department,public.factory_category_department(NEW.employee_category));
  IF NEW.department IS NULL THEN RAISE EXCEPTION 'Select a factory for Local workers' USING ERRCODE='23514'; END IF;
  IF NEW.employee_category='Local Daily-Wage Workers' AND (NEW.setup_reason IS NULL OR length(btrim(NEW.setup_reason))=0) THEN
   RAISE EXCEPTION 'Record the reason for factory-specific Local setup' USING ERRCODE='23514'; END IF;
  PERFORM public.payroll_source_fence('factory:'||NEW.employee_category,false);
  -- Serialize sequence allocation per master/category; unrelated categories remain independent.
  PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME || ':' || NEW.employee_category, 0));
  IF TG_TABLE_NAME = 'hr_factory_wage_revisions' THEN
    SELECT COALESCE(max(revision_number), 0) + 1 INTO NEW.revision_number
      FROM public.hr_factory_wage_revisions WHERE employee_category = NEW.employee_category AND department=NEW.department;
  ELSE
    SELECT COALESCE(max(revision_number), 0) + 1 INTO NEW.revision_number
      FROM public.hr_factory_pay_rule_revisions WHERE employee_category = NEW.employee_category AND department=NEW.department;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.hr_attendance_guard_row()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE; e public.hr_employees%ROWTYPE;
  r public.hr_factory_pay_rule_revisions%ROWTYPE; l public.hr_leave_requests%ROWTYPE;
  v_leave_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attendance rows cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = NEW.sheet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found' USING ERRCODE = 'P0002'; END IF;
  IF s.status NOT IN ('Draft', 'Returned for Correction') THEN
    RAISE EXCEPTION 'Submitted/reviewed/locked attendance cannot be edited' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.hr_attendance_require_actor(NEW.updated_by, ARRAY['admin','factory_manager']);
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id,NEW.sheet_id,NEW.employee_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM
       (OLD.id,OLD.sheet_id,OLD.employee_id,OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Attendance row identity is immutable' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT * INTO e FROM public.hr_employees WHERE id = NEW.employee_id FOR SHARE;
    IF NOT FOUND OR e.employee_category <> s.employee_category OR (s.department IS NOT NULL AND e.department <> s.department) OR e.active_status <> 'Active' OR e.joining_date > s.attendance_date THEN
      RAISE EXCEPTION 'Employee is not eligible for this sheet roster' USING ERRCODE = 'P0001';
    END IF;
    NEW.created_by := NEW.updated_by; NEW.created_at := now();
  END IF;
  SELECT * INTO r FROM public.hr_factory_pay_rule_revisions
   WHERE employee_category=s.employee_category AND effective_from<=s.attendance_date
   AND (department=s.department OR (department IS NULL AND public.factory_category_department(employee_category)=s.department))
   ORDER BY (department IS NOT NULL) DESC,effective_from DESC LIMIT 1;
  NEW.pay_rule_revision_id:=r.id;
  NEW.wage_revision_id:=NULL;
  NEW.master_scope_version:=1;
  IF s.employee_category IN ('SNP Casual Factory Labour','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers') THEN
   SELECT id INTO NEW.wage_revision_id FROM public.hr_factory_wage_revisions
    WHERE employee_category=s.employee_category AND effective_from<=s.attendance_date
    AND (department=s.department OR (department IS NULL AND public.factory_category_department(employee_category)=s.department))
    ORDER BY (department IS NOT NULL) DESC,effective_from DESC LIMIT 1;
  END IF;
  IF s.employee_category='Local Daily-Wage Workers' AND (r.id IS NULL OR NEW.wage_revision_id IS NULL) THEN
   RAISE EXCEPTION 'Complete Local wage and pay-rule setup for this factory and date' USING ERRCODE='23514'; END IF;
  IF NEW.entry_timestamp IS NOT NULL AND (NEW.entry_timestamp AT TIME ZONE 'Asia/Kolkata')::date <> s.attendance_date THEN
    RAISE EXCEPTION 'Attendance date must be the duty start date in Asia/Kolkata' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.attendance_status IS DISTINCT FROM 'Present' AND NEW.attendance_status IS DISTINCT FROM 'Management Issue' THEN
    IF NEW.entry_timestamp IS NOT NULL OR NEW.exit_timestamp IS NOT NULL THEN
      RAISE EXCEPTION 'Non-working attendance cannot contain duty timestamps' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- A Management Issue may record reduced working hours or a complete stoppage.
  IF NEW.exit_timestamp IS NOT NULL AND (NEW.entry_timestamp IS NULL OR NEW.exit_timestamp <= NEW.entry_timestamp) THEN
    RAISE EXCEPTION 'Exit timestamp must be after Entry' USING ERRCODE = 'P0001';
  END IF;
  NEW.actual_hours := CASE WHEN NEW.entry_timestamp IS NOT NULL AND NEW.exit_timestamp IS NOT NULL
    THEN extract(epoch FROM (NEW.exit_timestamp - NEW.entry_timestamp))::numeric / 3600 ELSE 0 END;
  -- OT hours are attendance facts. For Local workers, Double Duty is a separate duty/pay classification and does not accumulate OT.
  -- Local Single Duty accumulates OT beyond standard hours (normally 12h). Double Duty does not stack OT or OT-after-24h.
  NEW.ot_hours := CASE
    WHEN s.employee_category = 'Local Daily-Wage Workers' AND NEW.duty_type = 'Double Duty' THEN 0
    WHEN r.id IS NOT NULL THEN greatest(0, NEW.actual_hours - r.standard_duty_hours)
    ELSE 0
  END;
  IF s.employee_category = 'Local Daily-Wage Workers' THEN
    IF NEW.holiday_pay_eligible OR NEW.attendance_status = 'Paid Leave' THEN
      RAISE EXCEPTION 'Local leave is unpaid and holiday eligibility is not allowed' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.duty_type IS NOT NULL AND NEW.attendance_status IS DISTINCT FROM 'Present'
       AND NOT (NEW.attendance_status = 'Management Issue' AND NEW.entry_timestamp IS NOT NULL) THEN
      RAISE EXCEPTION 'Local duty type applies only to working rows' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.duty_type IS NOT NULL THEN
    RAISE EXCEPTION 'Single/Double Duty applies only to Local workers' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.holiday_pay_eligible AND (NEW.attendance_status IS DISTINCT FROM 'Present'
      OR r.id IS NULL OR NOT r.holiday_pay_enabled) THEN
    RAISE EXCEPTION 'Holiday eligibility requires Present and an enabled rule' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.leave_request_id IS NOT NULL THEN
    SELECT * INTO l FROM public.hr_leave_requests WHERE id = NEW.leave_request_id;
    IF NOT FOUND OR l.employee_id <> NEW.employee_id OR l.request_source NOT IN ('FACTORY_MANAGER','SELF_SERVICE')
      OR l.employee_category <> s.employee_category OR s.attendance_date NOT BETWEEN l.from_date AND l.to_date
      OR NEW.attendance_status IS NULL OR NEW.attendance_status NOT IN ('Medical Leave','Paid Leave','Unpaid Leave') THEN
      RAISE EXCEPTION 'Linked leave must belong to this employee, cover this date, and match a leave row' USING ERRCODE = 'P0001';
    END IF;
    v_leave_status := CASE WHEN l.leave_type = 'Medical Leave' THEN 'Medical Leave'
      WHEN l.approval_status = 'Approved' AND l.pay_treatment = 'Paid' THEN 'Paid Leave'
      WHEN l.approval_status = 'Approved' THEN 'Unpaid Leave'
      WHEN l.leave_type = 'Paid Leave' THEN 'Paid Leave' ELSE 'Unpaid Leave' END;
    IF NEW.attendance_status <> v_leave_status THEN
      RAISE EXCEPTION 'Attendance leave type/treatment does not match its request' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Locked prior duty is immutable; category locking in the RPC serializes
  -- concurrent row saves and sheet transitions. Recheck on every save/submit.
  IF NEW.attendance_status = 'Compensatory Off' AND NOT EXISTS (
    SELECT 1 FROM public.hr_attendance_rows previous_row
    JOIN public.hr_attendance_sheets previous_sheet ON previous_sheet.id = previous_row.sheet_id
    WHERE previous_row.employee_id = NEW.employee_id
      AND previous_sheet.attendance_date = s.attendance_date - 1
      AND previous_sheet.status = 'Locked' AND previous_row.actual_hours >= 24
  ) THEN
    RAISE EXCEPTION 'Compensatory Off requires an approved 24-hour duty on the previous day' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.create_factory_rule(p_rule jsonb,p_calculation jsonb,p_actor_id uuid,p_treatment jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.hr_factory_pay_rule_revisions%ROWTYPE; c jsonb; t jsonb;
BEGIN
 IF p_calculation IS NULL AND coalesce((p_rule->>'ot_enabled')::boolean,false) AND p_rule->>'ot_method'<>'Fixed Hourly' THEN
  RAISE EXCEPTION 'Explicit OT calculation setup required' USING ERRCODE='23514'; END IF;
 INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,ot_multiplier,
 holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,short_hours_treatment,comp_off_rule,double_duty_multiplier,created_by,revision_number,department,setup_reason)
 VALUES(p_rule->>'employee_category',(p_rule->>'effective_from')::date,(p_rule->>'standard_duty_hours')::numeric,(p_rule->>'ot_enabled')::boolean,
 p_rule->>'ot_method',(p_rule->>'ot_rate')::numeric,(p_rule->>'ot_multiplier')::numeric,(p_rule->>'holiday_pay_enabled')::boolean,
 (p_rule->>'holiday_multiplier')::numeric,p_rule->>'management_stoppage_treatment',p_rule->>'short_hours_treatment',p_rule->>'comp_off_rule',(p_rule->>'double_duty_multiplier')::numeric,p_actor_id,1,p_rule->>'department',p_rule->>'setup_reason') RETURNING * INTO r;
 IF p_calculation IS NOT NULL THEN c:=complete_factory_calculation(r.id,(p_calculation->>'salary_days')::numeric,p_calculation->>'reason',p_actor_id); END IF;
 IF p_treatment IS NOT NULL THEN t:=complete_factory_treatment(r.id,(p_treatment->>'holiday_salary_days')::numeric,p_treatment->>'reason',p_actor_id); END IF;
 RETURN to_jsonb(r)||jsonb_build_object('calculation',c,'treatment',t);
END; $$;
CREATE OR REPLACE FUNCTION public.factory_calculation_impact(p_rule_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.hr_factory_pay_rule_revisions%ROWTYPE; finish date; result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM authorised_users WHERE id=p_actor_id AND is_active AND role IN ('admin','factory_manager','ho') FOR SHARE) THEN
  RAISE EXCEPTION 'Factory access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM hr_factory_pay_rule_revisions WHERE id=p_rule_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Factory rule not found' USING ERRCODE='P0002'; END IF;
 SELECT min(effective_from)-1 INTO finish FROM hr_factory_pay_rule_revisions WHERE employee_category=r.employee_category AND department IS NOT DISTINCT FROM r.department AND effective_from>r.effective_from;
 SELECT jsonb_build_object('effective_from',r.effective_from,'effective_to',finish,
  'draft_rows',count(*) FILTER(WHERE e.status IN ('DRAFT','CALCULATED')),
  'protected_rows',count(*) FILTER(WHERE e.status IN ('PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR')),
  'locked_rows',count(*) FILTER(WHERE e.status='LOCKED'),
  'department',r.department,'already_configured',EXISTS(SELECT 1 FROM hr_factory_pay_rule_calculations WHERE rule_revision_id=p_rule_id)) INTO result
 FROM payroll_run_employees e JOIN payroll_runs run ON run.id=e.run_id JOIN payroll_groups g ON g.code=run.group_code
 LEFT JOIN payroll_financial_snapshots frozen ON frozen.row_id=e.id
 WHERE ((g.employee_category=r.employee_category AND (r.department IS NULL OR run.department=r.department)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(frozen.source_snapshot->'factory_rules','[]'::jsonb)) used_rule WHERE used_rule->>'id'=r.id::text)) AND e.status<>'CANCELLED_DRAFT'
 AND daterange(e.period_from,e.period_to,'[]') && daterange(r.effective_from,finish,'[]');
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
  'wages',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(w),ARRAY['daily_wage']) ORDER BY employee_category,effective_from,id) FROM public.hr_factory_wage_revisions w WHERE w.effective_from<=hi AND w.employee_category IN (SELECT employee_category FROM assignments) AND (w.department IS NULL OR EXISTS(SELECT 1 FROM assignments a WHERE a.employee_category=w.employee_category AND a.department=w.department))),'[]'),
  'factory_rules',coalesce((SELECT jsonb_agg((public.payroll_preview_decimals(to_jsonb(w),ARRAY['standard_duty_hours','ot_rate','ot_multiplier','holiday_multiplier','double_duty_multiplier'])||jsonb_build_object('calculation',(SELECT public.payroll_preview_decimals(to_jsonb(c),ARRAY['salary_days']) FROM public.hr_factory_pay_rule_calculations c WHERE c.rule_revision_id=w.id))||jsonb_build_object('treatment',(SELECT public.payroll_preview_decimals(to_jsonb(t),ARRAY['holiday_salary_days']) FROM public.hr_factory_pay_rule_treatments t WHERE t.rule_revision_id=w.id))) ORDER BY employee_category,effective_from,id) FROM public.hr_factory_pay_rule_revisions w WHERE w.effective_from<=hi AND w.employee_category IN (SELECT employee_category FROM assignments) AND (w.department IS NULL OR EXISTS(SELECT 1 FROM assignments a WHERE a.employee_category=w.employee_category AND a.department=w.department))),'[]'),
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
