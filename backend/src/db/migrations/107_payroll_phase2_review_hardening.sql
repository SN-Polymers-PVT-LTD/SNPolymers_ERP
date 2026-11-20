-- Phase 2 review: source applicability, grant lifecycle and ledger ownership.
-- No calculation, finalization, statutory posting or payment gate is enabled.
ALTER TABLE public.payroll_employee_assignments
 ALTER COLUMN effective_to DROP NOT NULL,
 DROP CONSTRAINT payroll_employee_assignments_check,
 DROP CONSTRAINT payroll_employee_assignments_check1,
 ADD CONSTRAINT payroll_assignment_range CHECK(effective_to IS NULL OR (isfinite(effective_to) AND effective_to>=effective_from)),
 ADD CONSTRAINT payroll_assignment_employment CHECK(effective_from>=employment_joined_on AND (employment_exited_on IS NULL OR
  (employment_exited_on>=employment_joined_on AND effective_to IS NOT NULL AND effective_to<=employment_exited_on)));
ALTER TABLE public.payroll_permanent_pay_applicability ALTER COLUMN effective_to DROP NOT NULL;
-- Its existing finite/end>=start CHECK accepts NULL; exclusion ranges already
-- treat NULL as unbounded, so overlapping ongoing intervals remain rejected.

ALTER TABLE public.payroll_factory_scope_events ADD COLUMN event_source text NOT NULL DEFAULT 'ADMIN'
 CHECK(event_source IN ('ADMIN','ACCOUNT_ACCESS_CHANGE'));
CREATE FUNCTION public.payroll_revoke_factory_grants() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF OLD.role='factory_manager' AND OLD.is_active AND (NEW.role<>'factory_manager' OR NOT NEW.is_active) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_scope:'||NEW.id::text,0));
  INSERT INTO public.payroll_factory_scope_events(user_id,department,allowed,reason,created_by,event_source)
   SELECT NEW.id,s.department,false,'Automatic revocation on account role/inactivation; explicit Admin regrant required',NEW.id,'ACCOUNT_ACCESS_CHANGE'
   FROM (SELECT DISTINCT ON(department) department,allowed FROM public.payroll_factory_scope_events WHERE user_id=NEW.id ORDER BY department,id DESC) s WHERE s.allowed;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payroll_revoke_factory_grants AFTER UPDATE OF role,is_active ON public.authorised_users
 FOR EACH ROW EXECUTE FUNCTION public.payroll_revoke_factory_grants();
-- Retire already-ineligible legacy grants too. created_by identifies the affected
-- account for SYSTEM events, not a fabricated Admin authorizer.
INSERT INTO public.payroll_factory_scope_events(user_id,department,allowed,reason,created_by,event_source)
 SELECT s.user_id,s.department,false,'Migration revocation of ineligible account; explicit Admin regrant required',s.user_id,'ACCOUNT_ACCESS_CHANGE'
 FROM (SELECT DISTINCT ON(user_id,department) user_id,department,allowed FROM public.payroll_factory_scope_events ORDER BY user_id,department,id DESC) s
 JOIN public.authorised_users u ON u.id=s.user_id WHERE s.allowed AND (u.role<>'factory_manager' OR NOT u.is_active);
REVOKE ALL ON FUNCTION public.payroll_revoke_factory_grants() FROM PUBLIC,anon,authenticated,service_role;

-- Existing Phase 1 gates make allocations impossible. Fail closed if anomalous
-- preexisting postings exist, rather than infer or rewrite their ownership.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.payroll_month_allocations) THEN
 RAISE EXCEPTION 'Existing payroll allocations require an explicit ownership migration before proceeding'; END IF; END; $$;
ALTER TABLE public.payroll_employee_month_entitlements ADD CONSTRAINT payroll_entitlement_employee_unique UNIQUE(id,employee_id);
ALTER TABLE public.payroll_month_allocations ADD COLUMN employee_id uuid NOT NULL,
 ADD CONSTRAINT payroll_allocation_entitlement_employee FOREIGN KEY(entitlement_id,employee_id) REFERENCES public.payroll_employee_month_entitlements(id,employee_id) ON DELETE RESTRICT,
 ADD CONSTRAINT payroll_allocation_row_employee FOREIGN KEY(salary_row_id,employee_id) REFERENCES public.payroll_run_employees(id,employee_id) ON DELETE RESTRICT;

-- Preserve existing draft invariants while allowing explicit ongoing history.
CREATE OR REPLACE FUNCTION public.payroll_guard_draft_row() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payroll rows cannot be deleted' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'current_version') IS DISTINCT FROM (to_jsonb(OLD)-'current_version') OR NEW.current_version<>OLD.current_version+1) THEN
  RAISE EXCEPTION 'Only append a new draft row version' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payroll_runs r JOIN public.payroll_employee_assignments a ON a.id=NEW.assignment_id
  WHERE r.id=NEW.run_id AND a.employee_id=NEW.employee_id AND a.group_code=r.group_code AND a.department=r.department
  AND NEW.period_from>=r.period_from AND NEW.period_to<=r.period_to
  AND NEW.period_from>=a.effective_from AND (a.effective_to IS NULL OR NEW.period_to<=a.effective_to)) THEN
  RAISE EXCEPTION 'Salary row period must match its run and historical assignment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
