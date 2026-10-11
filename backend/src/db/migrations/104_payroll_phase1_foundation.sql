-- Phase 1: no calculations, approval, locking, payment or Accounts mutations.
-- The migration runner wraps this file and its migration-log entry in one transaction.
SET LOCAL search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.payroll_groups (
  code text PRIMARY KEY,
  employee_category text NOT NULL,
  is_factory boolean NOT NULL,
  is_permanent boolean NOT NULL,
  UNIQUE(code,employee_category)
);
CREATE TABLE public.payroll_group_departments (
  group_code text NOT NULL REFERENCES public.payroll_groups(code) ON DELETE RESTRICT,
  department text NOT NULL,
  PRIMARY KEY(group_code,department)
);
-- Classification metadata only: never seed people, compensation or historical dates.
INSERT INTO public.payroll_groups VALUES
 ('SNP_PERMANENT','SNP Permanent Factory Labour',true,true),
 ('SNP_CASUAL','SNP Casual Factory Labour',true,false),
 ('SNP_LOCAL','Local Daily-Wage Workers',true,false),
 ('FABRIC_PERMANENT','Fabric Factory Permanent Employees',true,true),
 ('FABRIC_CASUAL','Fabric Factory Casual Factory Labour',true,false),
 ('FABRIC_LOCAL','Local Daily-Wage Workers',true,false),
 ('HO_STAFF','HO Staff',false,true),
 ('PROJECTS_ZO','Zonal Office',false,true),
 ('PROJECTS_JE','Junior Engineer',false,true),
 ('PROJECTS_SUPERVISOR','Local project supervisor',false,true),
 ('PROJECTS_HEAD_OFFICE','Head office',false,true),
 ('LEGACY_PROJECTS','Projects Department Employees',false,true);
INSERT INTO public.payroll_group_departments VALUES
 ('SNP_PERMANENT','SNP Factory'),('SNP_CASUAL','SNP Factory'),('SNP_LOCAL','SNP Factory'),
 ('FABRIC_PERMANENT','Fabric Factory'),('FABRIC_CASUAL','Fabric Factory'),('FABRIC_LOCAL','Fabric Factory'),
 ('HO_STAFF','Head Office'),('PROJECTS_ZO','Projects'),('PROJECTS_JE','Projects'),
 ('PROJECTS_SUPERVISOR','Projects'),('PROJECTS_HEAD_OFFICE','Projects'),
 ('PROJECTS_HEAD_OFFICE','Head Office'),('LEGACY_PROJECTS','Projects');

-- Complete, evidenced timeline revisions. Correcting a timeline appends a new
-- revision; prior assignment and pay references remain readable and immutable.
CREATE TABLE public.payroll_source_history_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE RESTRICT,
 source_kind text NOT NULL CHECK(source_kind IN ('ASSIGNMENT','PERMANENT_PAY')),
 version integer NOT NULL CHECK(version>0),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(employee_id,source_kind,version), UNIQUE(id,employee_id,source_kind)
);
CREATE TABLE public.payroll_employee_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 revision_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 source_kind text NOT NULL DEFAULT 'ASSIGNMENT' CHECK(source_kind='ASSIGNMENT'),
 group_code text NOT NULL,
 employee_category text NOT NULL,
 department text NOT NULL,
 effective_from date NOT NULL CHECK(isfinite(effective_from)),
 effective_to date NOT NULL CHECK(isfinite(effective_to) AND effective_to>=effective_from),
 employment_joined_on date NOT NULL CHECK(isfinite(employment_joined_on)),
 employment_exited_on date CHECK(isfinite(employment_exited_on)),
 CHECK(effective_from>=employment_joined_on AND (employment_exited_on IS NULL OR
   (employment_exited_on>=employment_joined_on AND effective_to<=employment_exited_on))),
 FOREIGN KEY(revision_id,employee_id,source_kind) REFERENCES public.payroll_source_history_revisions(id,employee_id,source_kind) ON DELETE RESTRICT,
 FOREIGN KEY(group_code,employee_category) REFERENCES public.payroll_groups(code,employee_category) ON DELETE RESTRICT,
 FOREIGN KEY(group_code,department) REFERENCES public.payroll_group_departments(group_code,department) ON DELETE RESTRICT,
 UNIQUE(id,employee_id),
 CONSTRAINT payroll_assignment_nonoverlap EXCLUDE USING gist
  (revision_id WITH =,daterange(effective_from,effective_to,'[]') WITH &&)
);
ALTER TABLE public.hr_permanent_pay_structures ADD CONSTRAINT hr_pay_identity_employee_unique UNIQUE(id,employee_id);
CREATE TABLE public.payroll_permanent_pay_applicability (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 revision_id uuid NOT NULL,
 employee_id uuid NOT NULL,
 source_kind text NOT NULL DEFAULT 'PERMANENT_PAY' CHECK(source_kind='PERMANENT_PAY'),
 pay_structure_id uuid NOT NULL,
 effective_from date NOT NULL CHECK(isfinite(effective_from)),
 effective_to date NOT NULL CHECK(isfinite(effective_to) AND effective_to>=effective_from),
 FOREIGN KEY(revision_id,employee_id,source_kind) REFERENCES public.payroll_source_history_revisions(id,employee_id,source_kind) ON DELETE RESTRICT,
 FOREIGN KEY(pay_structure_id,employee_id) REFERENCES public.hr_permanent_pay_structures(id,employee_id) ON DELETE RESTRICT,
 CONSTRAINT payroll_pay_applicability_nonoverlap EXCLUDE USING gist
  (revision_id WITH =,daterange(effective_from,effective_to,'[]') WITH &&)
);
-- Observations are not effective-dated employment facts. No migration backfill.
CREATE TABLE public.payroll_employee_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE RESTRICT,
 old_values jsonb NOT NULL, new_values jsonb NOT NULL,
 effective_date_known boolean NOT NULL DEFAULT false CHECK(NOT effective_date_known),
 observed_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_employee_observations_employee_idx ON public.payroll_employee_observations(employee_id,observed_at);
CREATE FUNCTION public.payroll_observe_employee_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF (NEW.employee_category,NEW.department,NEW.joining_date,NEW.active_status) IS DISTINCT FROM
    (OLD.employee_category,OLD.department,OLD.joining_date,OLD.active_status) THEN
  INSERT INTO public.payroll_employee_observations(employee_id,old_values,new_values,observed_by)
   VALUES(NEW.id,jsonb_build_object('category',OLD.employee_category,'department',OLD.department,'joining_date',OLD.joining_date,'status',OLD.active_status),
    jsonb_build_object('category',NEW.employee_category,'department',NEW.department,'joining_date',NEW.joining_date,'status',NEW.active_status),NEW.updated_by);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payroll_observe_employee_change AFTER UPDATE ON public.hr_employees
 FOR EACH ROW EXECUTE FUNCTION public.payroll_observe_employee_change();

-- Explicit payroll-only factory grants; attendance permissions are unchanged.
CREATE TABLE public.payroll_factory_scope_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 department text NOT NULL CHECK(department IN ('SNP Factory','Fabric Factory')),
 allowed boolean NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_factory_scope_latest_idx ON public.payroll_factory_scope_events(user_id,department,id DESC);
CREATE FUNCTION public.payroll_require_actor(p_actor_id uuid,p_roles text[]) RETURNS text
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE v_role text;
BEGIN
 SELECT role INTO v_role FROM public.authorised_users WHERE id=p_actor_id AND is_active FOR SHARE;
 IF NOT FOUND OR NOT(v_role=ANY(p_roles)) THEN
  RAISE EXCEPTION 'Payroll access denied' USING ERRCODE='42501';
 END IF;
 RETURN v_role;
END; $$;
CREATE FUNCTION public.payroll_require_scope(p_actor_id uuid,p_department text,p_write boolean) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE v_role text; v_allowed boolean;
BEGIN
 v_role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','ho','accounts','factory_manager']);
 -- Serialize actions with scope revocation; current account role is locked above.
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_scope:'||p_actor_id::text,0));
 IF v_role='admin' OR (NOT p_write AND v_role IN ('ho','accounts'))
   OR (p_write AND v_role='accounts' AND p_department IN ('Head Office','Projects')) THEN RETURN; END IF;
 IF v_role='factory_manager' AND p_department IN ('SNP Factory','Fabric Factory') THEN
  SELECT allowed INTO v_allowed FROM public.payroll_factory_scope_events
   WHERE user_id=p_actor_id AND department=p_department ORDER BY id DESC LIMIT 1;
  IF v_allowed IS TRUE THEN RETURN; END IF;
 END IF;
 RAISE EXCEPTION 'Payroll factory/department access denied' USING ERRCODE='42501';
END; $$;
CREATE FUNCTION public.set_payroll_factory_scope(p_user_id uuid,p_department text,p_allowed boolean,p_reason text,p_actor_id uuid)
RETURNS public.payroll_factory_scope_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_event public.payroll_factory_scope_events%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 PERFORM public.payroll_require_actor(p_user_id,ARRAY['factory_manager']);
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_scope:'||p_user_id::text,0));
 INSERT INTO public.payroll_factory_scope_events(user_id,department,allowed,reason,created_by)
  VALUES(p_user_id,p_department,p_allowed,p_reason,p_actor_id) RETURNING * INTO v_event;
 RETURN v_event;
END; $$;
CREATE FUNCTION public.record_payroll_source_history(p_employee_id uuid,p_kind text,p_intervals jsonb,p_evidence text,p_actor_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_id uuid; v_version integer; item jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 PERFORM 1 FROM public.hr_employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('ASSIGNMENT','PERMANENT_PAY') OR jsonb_typeof(p_intervals) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid source history' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_intervals) NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION 'Supply a complete evidenced timeline of 1 to 1000 intervals' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(max(version),0)+1 INTO v_version FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind=p_kind;
 INSERT INTO public.payroll_source_history_revisions(employee_id,source_kind,version,evidence_reference,created_by)
  VALUES(p_employee_id,p_kind,v_version,p_evidence,p_actor_id) RETURNING id INTO v_id;
 FOR item IN SELECT * FROM jsonb_array_elements(p_intervals) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid interval' USING ERRCODE='22023'; END IF;
  IF p_kind='ASSIGNMENT' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('group_code','employee_category','department','effective_from','effective_to','employment_joined_on','employment_exited_on')) THEN
    RAISE EXCEPTION 'Unexpected assignment field' USING ERRCODE='22023'; END IF;
   INSERT INTO public.payroll_employee_assignments(revision_id,employee_id,group_code,employee_category,department,effective_from,effective_to,employment_joined_on,employment_exited_on)
    VALUES(v_id,p_employee_id,item->>'group_code',item->>'employee_category',item->>'department',
     (item->>'effective_from')::date,(item->>'effective_to')::date,(item->>'employment_joined_on')::date,(item->>'employment_exited_on')::date);
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('pay_structure_id','effective_from','effective_to')) THEN
    RAISE EXCEPTION 'Unexpected pay applicability field' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM public.hr_permanent_pay_structures WHERE id=(item->>'pay_structure_id')::uuid AND status='Draft') THEN
    RAISE EXCEPTION 'Draft pay structure is not a payroll source' USING ERRCODE='23514'; END IF;
   INSERT INTO public.payroll_permanent_pay_applicability(revision_id,employee_id,pay_structure_id,effective_from,effective_to)
    VALUES(v_id,p_employee_id,(item->>'pay_structure_id')::uuid,(item->>'effective_from')::date,(item->>'effective_to')::date);
  END IF;
 END LOOP;
 RETURN v_id;
END; $$;

-- Policy architecture from v1.4, without guessed rounding/proration or seeded rates.
-- Publication is intentionally unavailable in Phase 1.
CREATE TABLE public.payroll_policy_master_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_code text REFERENCES public.payroll_groups(code) ON DELETE RESTRICT,
 effective_from date NOT NULL CHECK(isfinite(effective_from)),
 effective_to date NOT NULL CHECK(isfinite(effective_to) AND effective_to>=effective_from),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status='DRAFT'),
 monthly_entitlement_method text NOT NULL CHECK(monthly_entitlement_method='CONTRACTUAL_MONTHLY_GROSS'),
 lop_method text NOT NULL CHECK(lop_method IN ('FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS')),
 lop_fixed_divisor numeric CHECK(lop_fixed_divisor>0 AND lop_fixed_divisor<10000),
 CHECK((lop_method='FIXED_DIVISOR' AND lop_fixed_divisor IS NOT NULL) OR (lop_method='ACTUAL_CALENDAR_DAYS' AND lop_fixed_divisor IS NULL)),
 partial_month_proration_method text NOT NULL DEFAULT 'UNRESOLVED' CHECK(partial_month_proration_method IN ('UNRESOLVED','FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS','WORK_CALENDAR')),
 partial_month_fixed_divisor numeric CHECK(partial_month_fixed_divisor>0 AND partial_month_fixed_divisor<10000),
 CHECK((partial_month_proration_method='FIXED_DIVISOR' AND partial_month_fixed_divisor IS NOT NULL) OR (partial_month_proration_method<>'FIXED_DIVISOR' AND partial_month_fixed_divisor IS NULL)),
 split_period_allocation_method text NOT NULL DEFAULT 'UNRESOLVED' CHECK(split_period_allocation_method IN ('UNRESOLVED','CALENDAR_WEIGHTED_WITH_RESIDUAL')),
 full_month_unpaid_treatment text NOT NULL DEFAULT 'UNRESOLVED' CHECK(full_month_unpaid_treatment='UNRESOLVED'),
 leave_weekly_off_method text NOT NULL DEFAULT 'UNRESOLVED' CHECK(leave_weekly_off_method='UNRESOLVED'),
 monetary_rounding_method text NOT NULL DEFAULT 'UNRESOLVED' CHECK(monetary_rounding_method='UNRESOLVED'),
 sandwich_enabled boolean NOT NULL DEFAULT false CHECK(NOT sandwich_enabled),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payroll_work_calendar_days (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_code text NOT NULL, department text NOT NULL,
 calendar_date date NOT NULL CHECK(isfinite(calendar_date)),
 day_type text NOT NULL CHECK(day_type IN ('Scheduled Workday','Weekly Off','Paid Holiday','Unpaid Closure','Special Working Day')),
 compensation_treatment text NOT NULL DEFAULT 'UNRESOLVED' CHECK(compensation_treatment='UNRESOLVED'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status='DRAFT'),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(group_code,department) REFERENCES public.payroll_group_departments(group_code,department) ON DELETE RESTRICT
);
CREATE INDEX payroll_calendar_group_date_idx ON public.payroll_work_calendar_days(group_code,department,calendar_date);
CREATE TABLE public.payroll_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_code text NOT NULL, department text NOT NULL,
 period_from date NOT NULL CHECK(isfinite(period_from)),
 period_to date NOT NULL CHECK(isfinite(period_to) AND period_to>=period_from),
 cycle text NOT NULL CHECK(cycle IN ('Monthly','Fortnightly','Weekly','Custom')),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status='DRAFT'),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(group_code,department) REFERENCES public.payroll_group_departments(group_code,department) ON DELETE RESTRICT
);
CREATE INDEX payroll_runs_scope_period_idx ON public.payroll_runs(department,group_code,period_from,period_to);
CREATE TABLE public.payroll_run_employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
 employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE RESTRICT,
 assignment_id uuid NOT NULL,
 period_from date NOT NULL CHECK(isfinite(period_from)),
 period_to date NOT NULL CHECK(isfinite(period_to) AND period_to>=period_from),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status='DRAFT'),
 current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(assignment_id,employee_id) REFERENCES public.payroll_employee_assignments(id,employee_id) ON DELETE RESTRICT,
 UNIQUE(run_id,employee_id), UNIQUE(id,employee_id)
);
CREATE TABLE public.payroll_row_versions (
 row_id uuid NOT NULL REFERENCES public.payroll_run_employees(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 note text NOT NULL CHECK(length(note)<=2000),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
 source_fingerprint text NOT NULL,
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(row_id,version)
);
ALTER TABLE public.payroll_run_employees ADD CONSTRAINT payroll_row_current_version_fk
 FOREIGN KEY(id,current_version) REFERENCES public.payroll_row_versions(row_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.payroll_source_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 row_id uuid NOT NULL, row_version integer NOT NULL,
 attendance_row_id uuid REFERENCES public.hr_attendance_rows(id) ON DELETE RESTRICT,
 leave_request_id uuid REFERENCES public.hr_leave_requests(id) ON DELETE RESTRICT,
 pay_applicability_id uuid REFERENCES public.payroll_permanent_pay_applicability(id) ON DELETE RESTRICT,
 wage_revision_id uuid REFERENCES public.hr_factory_wage_revisions(id) ON DELETE RESTRICT,
 pay_rule_revision_id uuid REFERENCES public.hr_factory_pay_rule_revisions(id) ON DELETE RESTRICT,
 FOREIGN KEY(row_id,row_version) REFERENCES public.payroll_row_versions(row_id,version) ON DELETE RESTRICT,
 CHECK(num_nonnulls(attendance_row_id,leave_request_id,pay_applicability_id,wage_revision_id,pay_rule_revision_id)=1)
);
CREATE INDEX payroll_sources_row_version_idx ON public.payroll_source_links(row_id,row_version);
CREATE TABLE public.payroll_action_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
 row_id uuid, row_version integer,
 action text NOT NULL CHECK(action IN ('DRAFT_CREATED','DRAFT_VERSION_CREATED')),
 actor_id uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(row_id,row_version) REFERENCES public.payroll_row_versions(row_id,version) ON DELETE RESTRICT,
 CHECK((row_id IS NULL AND row_version IS NULL AND run_id IS NOT NULL) OR (row_id IS NOT NULL AND row_version IS NOT NULL))
);
CREATE INDEX payroll_history_run_idx ON public.payroll_action_history(run_id,id);
CREATE TABLE public.payroll_employee_coverage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE RESTRICT,
 salary_row_id uuid NOT NULL,
 period_from date NOT NULL CHECK(isfinite(period_from)),
 period_to date NOT NULL CHECK(isfinite(period_to) AND period_to>=period_from),
 finalized_at timestamptz NOT NULL,
 FOREIGN KEY(salary_row_id,employee_id) REFERENCES public.payroll_run_employees(id,employee_id) ON DELETE RESTRICT,
 UNIQUE(salary_row_id),
 CONSTRAINT payroll_employee_finalized_nonoverlap EXCLUDE USING gist
  (employee_id WITH =,daterange(period_from,period_to,'[]') WITH &&)
);
CREATE TABLE public.payroll_employee_month_entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE RESTRICT,
 salary_month date NOT NULL CHECK(isfinite(salary_month) AND extract(day FROM salary_month)=1),
 policy_revision_id uuid REFERENCES public.payroll_policy_master_revisions(id) ON DELETE RESTRICT,
 source_segments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(source_segments)='array'),
 status text NOT NULL DEFAULT 'UNRESOLVED' CHECK(status='UNRESOLVED'),
 contractual_gross numeric(14,2) CHECK(contractual_gross>=0 AND contractual_gross<1000000000000),
 allocated_base numeric(14,2) NOT NULL DEFAULT 0 CHECK(allocated_base=0),
 lop_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(lop_amount=0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(employee_id,salary_month)
);
CREATE TABLE public.payroll_month_allocations (
 entitlement_id uuid NOT NULL REFERENCES public.payroll_employee_month_entitlements(id) ON DELETE RESTRICT,
 salary_row_id uuid NOT NULL REFERENCES public.payroll_run_employees(id) ON DELETE RESTRICT,
 base_amount numeric(14,2) NOT NULL CHECK(base_amount>=0 AND base_amount<1000000000000),
 PRIMARY KEY(entitlement_id,salary_row_id)
);
-- No ordinary role, including service_role, may post finalized coverage or money.
-- A later forward migration must replace this gate alongside atomic finalization.
CREATE FUNCTION public.payroll_phase1_no_posting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payroll finalization and monthly posting are disabled in Phase 1' USING ERRCODE='42501'; END; $$;
CREATE TRIGGER payroll_coverage_phase1_gate BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_employee_coverage
 FOR EACH ROW EXECUTE FUNCTION public.payroll_phase1_no_posting();
CREATE TRIGGER payroll_entitlement_phase1_gate BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_employee_month_entitlements
 FOR EACH ROW EXECUTE FUNCTION public.payroll_phase1_no_posting();
CREATE TRIGGER payroll_allocation_phase1_gate BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_month_allocations
 FOR EACH ROW EXECUTE FUNCTION public.payroll_phase1_no_posting();
CREATE FUNCTION public.payroll_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payroll history is append-only' USING ERRCODE='42501'; END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['payroll_groups','payroll_group_departments','payroll_source_history_revisions',
 'payroll_employee_assignments','payroll_permanent_pay_applicability','payroll_employee_observations',
 'payroll_factory_scope_events','payroll_policy_master_revisions','payroll_work_calendar_days','payroll_runs',
 'payroll_row_versions','payroll_source_links','payroll_action_history'] LOOP
  EXECUTE format('CREATE TRIGGER payroll_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable()',t);
 END LOOP;
END; $$;
CREATE FUNCTION public.payroll_guard_draft_row() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payroll rows cannot be deleted' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'current_version') IS DISTINCT FROM (to_jsonb(OLD)-'current_version') OR NEW.current_version<>OLD.current_version+1) THEN
  RAISE EXCEPTION 'Only append a new draft row version' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payroll_runs r JOIN public.payroll_employee_assignments a ON a.id=NEW.assignment_id
  WHERE r.id=NEW.run_id AND a.employee_id=NEW.employee_id AND a.group_code=r.group_code AND a.department=r.department
  AND NEW.period_from>=r.period_from AND NEW.period_to<=r.period_to
  AND NEW.period_from>=a.effective_from AND NEW.period_to<=a.effective_to) THEN
  RAISE EXCEPTION 'Salary row period must match its run and historical assignment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payroll_draft_row_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_run_employees
 FOR EACH ROW EXECUTE FUNCTION public.payroll_guard_draft_row();

CREATE FUNCTION public.create_payroll_draft_run(p_group_code text,p_department text,p_from date,p_to date,p_cycle text,p_actor_id uuid)
RETURNS public.payroll_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_scope(p_actor_id,p_department,true);
 INSERT INTO public.payroll_runs(group_code,department,period_from,period_to,cycle,created_by)
  VALUES(p_group_code,p_department,p_from,p_to,p_cycle,p_actor_id) RETURNING * INTO r;
 INSERT INTO public.payroll_action_history(run_id,action,actor_id) VALUES(r.id,'DRAFT_CREATED',p_actor_id);
 RETURN r;
END; $$;

-- Internal snapshot builder. Never executable by API roles. No manually entered
-- monetary/statutory inputs; incomplete sources are references, not calculations.
CREATE FUNCTION public.payroll_append_draft_version(p_row_id uuid,p_note text,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; r public.payroll_runs%ROWTYPE;
 v_snapshot jsonb; v_pay_revision uuid;
BEGIN
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id;
 SELECT id INTO v_pay_revision FROM public.payroll_source_history_revisions
  WHERE employee_id=e.employee_id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1;
 SELECT jsonb_build_object('employee_id',h.id,'employee_code',h.employee_code,'employee_name',h.employee_name,
  'assignment',to_jsonb(a),'pay_history_revision_id',v_pay_revision,
  'period_from',e.period_from,'period_to',e.period_to,'readiness','NOT_CALCULATED',
  'missing_source_is_zero',false) INTO v_snapshot
  FROM public.hr_employees h JOIN public.payroll_employee_assignments a ON a.id=e.assignment_id WHERE h.id=e.employee_id;
 INSERT INTO public.payroll_row_versions(row_id,version,note,source_snapshot,source_fingerprint,created_by)
  VALUES(e.id,e.current_version,p_note,v_snapshot,md5(v_snapshot::text),p_actor_id);
 INSERT INTO public.payroll_source_links(row_id,row_version,pay_applicability_id)
  SELECT e.id,e.current_version,a.id FROM public.payroll_permanent_pay_applicability a
   WHERE a.revision_id=v_pay_revision AND a.employee_id=e.employee_id
    AND daterange(a.effective_from,a.effective_to,'[]') && daterange(e.period_from,e.period_to,'[]');
 -- Legacy null-department factory evidence is intentionally not attributed.
 INSERT INTO public.payroll_source_links(row_id,row_version,attendance_row_id)
  SELECT e.id,e.current_version,a.id FROM public.hr_attendance_rows a JOIN public.hr_attendance_sheets s ON s.id=a.sheet_id
   JOIN public.payroll_groups g ON g.code=r.group_code
   WHERE g.is_factory AND a.employee_id=e.employee_id AND s.status='Locked'
    AND s.department=r.department AND s.employee_category=g.employee_category
    AND s.attendance_date BETWEEN e.period_from AND e.period_to;
 INSERT INTO public.payroll_source_links(row_id,row_version,wage_revision_id)
  SELECT DISTINCT e.id,e.current_version,a.wage_revision_id FROM public.payroll_source_links l
   JOIN public.hr_attendance_rows a ON a.id=l.attendance_row_id
   WHERE l.row_id=e.id AND l.row_version=e.current_version AND a.wage_revision_id IS NOT NULL;
 INSERT INTO public.payroll_source_links(row_id,row_version,pay_rule_revision_id)
  SELECT DISTINCT e.id,e.current_version,a.pay_rule_revision_id FROM public.payroll_source_links l
   JOIN public.hr_attendance_rows a ON a.id=l.attendance_row_id
   WHERE l.row_id=e.id AND l.row_version=e.current_version AND a.pay_rule_revision_id IS NOT NULL;
 INSERT INTO public.payroll_source_links(row_id,row_version,leave_request_id)
  SELECT e.id,e.current_version,l.id FROM public.hr_leave_requests l
   WHERE l.employee_id=e.employee_id AND l.approval_status IN ('Approved','Rejected')
    AND l.pay_treatment IN ('Paid','Unpaid') AND daterange(l.from_date,l.to_date,'[]') && daterange(e.period_from,e.period_to,'[]');
 INSERT INTO public.payroll_action_history(run_id,row_id,row_version,action,actor_id)
  VALUES(e.run_id,e.id,e.current_version,'DRAFT_VERSION_CREATED',p_actor_id);
END; $$;
CREATE FUNCTION public.add_payroll_draft_employee(p_run_id uuid,p_assignment_id uuid,p_from date,p_to date,p_actor_id uuid)
RETURNS public.payroll_run_employees LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; a public.payroll_employee_assignments%ROWTYPE; e public.payroll_run_employees%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 IF r.created_by<>p_actor_id AND public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','factory_manager'])<>'admin' THEN
  RAISE EXCEPTION 'Only draft creator may edit' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.payroll_employee_assignments WHERE id=p_assignment_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.hr_employees WHERE id=a.employee_id FOR SHARE;
 IF a.revision_id IS DISTINCT FROM (SELECT id FROM public.payroll_source_history_revisions
  WHERE employee_id=a.employee_id AND source_kind='ASSIGNMENT' ORDER BY version DESC LIMIT 1) THEN
  RAISE EXCEPTION 'Assignment timeline has changed; reload' USING ERRCODE='40001'; END IF;
 INSERT INTO public.payroll_run_employees(run_id,employee_id,assignment_id,period_from,period_to,created_by)
  VALUES(r.id,a.employee_id,a.id,p_from,p_to,p_actor_id) RETURNING * INTO e;
 PERFORM public.payroll_append_draft_version(e.id,'',p_actor_id);
 RETURN e;
END; $$;
CREATE FUNCTION public.revise_payroll_draft_note(p_row_id uuid,p_expected_version integer,p_note text,p_actor_id uuid)
RETURNS public.payroll_run_employees LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; e public.payroll_run_employees%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,true);
 IF r.created_by<>p_actor_id AND public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','factory_manager'])<>'admin' THEN
  RAISE EXCEPTION 'Only draft creator may edit' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id FOR UPDATE;
 IF p_expected_version IS DISTINCT FROM e.current_version THEN
  RAISE EXCEPTION 'Payroll row version conflict' USING ERRCODE='40001'; END IF;
 UPDATE public.payroll_run_employees SET current_version=current_version+1 WHERE id=e.id RETURNING * INTO e;
 PERFORM public.payroll_append_draft_version(e.id,p_note,p_actor_id);
 RETURN e;
END; $$;
CREATE FUNCTION public.get_payroll_draft_run(p_run_id uuid,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; v_result jsonb;
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
 RETURN v_result;
END; $$;
CREATE FUNCTION public.get_payroll_foundation_context(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_role text;
BEGIN
 v_role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 RETURN jsonb_build_object('groups',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object('department',d.department) ORDER BY g.code,d.department)
  FROM public.payroll_groups g JOIN public.payroll_group_departments d ON d.group_code=g.code
  WHERE v_role<>'factory_manager' OR (g.is_factory AND coalesce((SELECT allowed FROM public.payroll_factory_scope_events s
   WHERE s.user_id=p_actor_id AND s.department=d.department ORDER BY s.id DESC LIMIT 1),false))),'[]'::jsonb),
  'financial_workflows_enabled',false);
END; $$;
CREATE FUNCTION public.get_payroll_source_history(p_employee_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin']);
 IF NOT EXISTS(SELECT 1 FROM public.hr_employees WHERE id=p_employee_id) THEN
  RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('revisions',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object(
  'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.payroll_employee_assignments a WHERE a.revision_id=r.id),
  'pay_applicability',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.payroll_permanent_pay_applicability a WHERE a.revision_id=r.id)) ORDER BY r.source_kind,r.version)
  FROM public.payroll_source_history_revisions r WHERE r.employee_id=p_employee_id),'[]'::jsonb),
  'observations',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.observed_at) FROM public.payroll_employee_observations o WHERE o.employee_id=p_employee_id),'[]'::jsonb));
END; $$;

CREATE FUNCTION public.get_payroll_draft_candidates(p_run_id uuid,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_runs%ROWTYPE; v_result jsonb;
BEGIN
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id;
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

-- Least privilege: no direct reads or writes by browser OR service role. Read
-- RPCs apply current roles/scopes; actor IDs come only from backend JWT sessions.
DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['payroll_groups','payroll_group_departments','payroll_source_history_revisions',
 'payroll_employee_assignments','payroll_permanent_pay_applicability','payroll_employee_observations',
 'payroll_factory_scope_events','payroll_policy_master_revisions','payroll_work_calendar_days','payroll_runs',
 'payroll_run_employees','payroll_row_versions','payroll_source_links','payroll_action_history',
 'payroll_employee_coverage','payroll_employee_month_entitlements','payroll_month_allocations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 -- Also revoke EXECUTE inherited from public/default privileges on every helper.
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'payroll_%' OR p.proname IN (
   'set_payroll_factory_scope','record_payroll_source_history','create_payroll_draft_run',
   'add_payroll_draft_employee','revise_payroll_draft_note','get_payroll_draft_run',
   'get_payroll_foundation_context','get_payroll_source_history','get_payroll_draft_candidates')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END; $$;
REVOKE ALL ON SEQUENCE public.payroll_factory_scope_events_id_seq,public.payroll_action_history_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_payroll_factory_scope(uuid,text,boolean,text,uuid),
 public.record_payroll_source_history(uuid,text,jsonb,text,uuid),
 public.create_payroll_draft_run(text,text,date,date,text,uuid),
 public.add_payroll_draft_employee(uuid,uuid,date,date,uuid),
 public.revise_payroll_draft_note(uuid,integer,text,uuid),
 public.get_payroll_draft_run(uuid,uuid,integer,integer),
 public.get_payroll_foundation_context(uuid),public.get_payroll_source_history(uuid,uuid),
 public.get_payroll_draft_candidates(uuid,uuid,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
