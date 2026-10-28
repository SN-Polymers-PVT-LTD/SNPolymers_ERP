-- Six factory/date/type rosters; category/department mapping and specific Projects categories.
-- Existing Projects identities and legacy combined Local sheets are never guessed or rewritten.
ALTER TABLE public.hr_employees DROP CONSTRAINT hr_employees_employee_category_check;
ALTER TABLE public.hr_employees ADD CONSTRAINT hr_employees_employee_category_check CHECK (employee_category IN ('HO Staff','Fabric Factory Permanent Employees','Fabric Factory Casual Factory Labour','SNP Casual Factory Labour','SNP Permanent Factory Labour','Zonal Office','Junior Engineer','Local project supervisor','Head office','Local Daily-Wage Workers','Projects Department Employees'));

-- Extend only the Casual category checks, retaining all existing money/policy constraints.
DO $$
DECLARE c record; definition text;
BEGIN
  FOR c IN SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE contype='c'
      AND conrelid IN ('public.hr_factory_wage_revisions'::regclass,'public.hr_factory_pay_rule_revisions'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%SNP Casual Factory Labour%'
  LOOP
    definition := replace(c.definition, '''SNP Casual Factory Labour''::text',
      '''SNP Casual Factory Labour''::text, ''Fabric Factory Casual Factory Labour''::text');
    IF definition = c.definition THEN RAISE EXCEPTION 'Unexpected Casual constraint shape: %', c.conname; END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tbl,c.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',c.tbl,c.conname,definition);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_employee_department_allowed(p_category text,p_department text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE
    WHEN p_category='HO Staff' THEN p_department='Head Office'
    WHEN p_category IN ('Fabric Factory Permanent Employees','Fabric Factory Casual Factory Labour') THEN p_department='Fabric Factory'
    WHEN p_category IN ('SNP Permanent Factory Labour','SNP Casual Factory Labour') THEN p_department='SNP Factory'
    WHEN p_category IN ('Zonal Office','Junior Engineer','Local project supervisor','Projects Department Employees') THEN p_department='Projects'
    WHEN p_category='Head office' THEN p_department IN ('Projects','Head Office')
    WHEN p_category='Local Daily-Wage Workers' THEN p_department IN ('Fabric Factory','SNP Factory')
    ELSE false END;
$$;
CREATE OR REPLACE FUNCTION public.hr_employee_department_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- Grandfather existing records until Admin confirms their real assignment.
  IF TG_OP='INSERT' OR (NEW.employee_category,NEW.department) IS DISTINCT FROM (OLD.employee_category,OLD.department) THEN
    IF (NEW.employee_category='Projects Department Employees' AND TG_OP='INSERT')
      OR NOT public.hr_employee_department_allowed(NEW.employee_category,NEW.department) THEN
      RAISE EXCEPTION 'Select a specific employee category and its allowed department' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.employee_category,NEW.department) IS DISTINCT FROM (OLD.employee_category,OLD.department)
      AND EXISTS(SELECT 1 FROM public.hr_attendance_rows a JOIN public.hr_attendance_sheets s ON s.id=a.sheet_id
        WHERE a.employee_id=OLD.id AND s.status IN ('Draft','Returned for Correction','Submitted','HO Reviewed')) THEN
      RAISE EXCEPTION 'Finish existing attendance sheets before changing category or department' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hr_employee_department_guard BEFORE INSERT OR UPDATE ON public.hr_employees
  FOR EACH ROW EXECUTE FUNCTION public.hr_employee_department_guard();

ALTER TABLE public.hr_attendance_sheets ADD COLUMN department text
  CHECK (department IN ('Fabric Factory','SNP Factory'));
ALTER TABLE public.hr_attendance_sheets DROP CONSTRAINT hr_attendance_sheets_employee_category_check;
ALTER TABLE public.hr_attendance_sheets ADD CONSTRAINT hr_attendance_sheets_employee_category_check
  CHECK(employee_category IN ('Fabric Factory Permanent Employees','Fabric Factory Casual Factory Labour',
    'SNP Permanent Factory Labour','SNP Casual Factory Labour','Local Daily-Wage Workers'));
ALTER TABLE public.hr_attendance_sheets DROP CONSTRAINT hr_sheet_date_category_unique;
ALTER TABLE public.hr_attendance_sheets ADD CONSTRAINT hr_sheet_date_category_factory_unique
  UNIQUE NULLS NOT DISTINCT (attendance_date,employee_category,department);
-- One employee can have only one recorded roster per date, including legacy combined sheets.
CREATE OR REPLACE FUNCTION public.hr_attendance_guard_employee_day()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_date date;
BEGIN
  SELECT attendance_date INTO v_date FROM public.hr_attendance_sheets WHERE id=NEW.sheet_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('hr_employee_attendance:'||NEW.employee_id::text||':'||v_date::text,0));
  IF EXISTS(SELECT 1 FROM public.hr_attendance_rows a JOIN public.hr_attendance_sheets s ON s.id=a.sheet_id
    WHERE a.employee_id=NEW.employee_id AND s.attendance_date=v_date AND a.sheet_id<>NEW.sheet_id) THEN
    RAISE EXCEPTION 'Employee already belongs to an attendance sheet for this date' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hr_attendance_employee_day_guard BEFORE INSERT ON public.hr_attendance_rows
  FOR EACH ROW EXECUTE FUNCTION public.hr_attendance_guard_employee_day();


CREATE OR REPLACE FUNCTION public.hr_employee_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Employee records cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.employee_code IS DISTINCT FROM OLD.employee_code
       OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Employee identity and creation audit fields are immutable' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.employee_category IS DISTINCT FROM OLD.employee_category
       AND NEW.employee_category IN ('SNP Casual Factory Labour','Fabric Factory Casual Factory Labour', 'Local Daily-Wage Workers')
       AND EXISTS (SELECT 1 FROM public.hr_permanent_pay_structures WHERE employee_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot change category to non-permanent because permanent pay structure records exist' USING ERRCODE = 'P0001';
    END IF;

    NEW.updated_at := now();
  END IF;
  INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END::text,
          TG_OP, 'HR Employee Master', NEW.employee_code,
          NULL,
          jsonb_build_object('changed_fields', CASE WHEN TG_OP = 'INSERT' THEN ARRAY['created']::text[]
            ELSE array_remove(ARRAY[
              CASE WHEN NEW.employee_name IS DISTINCT FROM OLD.employee_name THEN 'employee_name' END,
              CASE WHEN NEW.employee_category IS DISTINCT FROM OLD.employee_category THEN 'employee_category' END,
              CASE WHEN NEW.department IS DISTINCT FROM OLD.department THEN 'department' END,
              CASE WHEN NEW.contact_number IS DISTINCT FROM OLD.contact_number THEN 'contact_number' END,
              CASE WHEN NEW.erp_user_id IS DISTINCT FROM OLD.erp_user_id THEN 'erp_user_id' END,
              CASE WHEN NEW.joining_date IS DISTINCT FROM OLD.joining_date THEN 'joining_date' END,
              CASE WHEN NEW.active_status IS DISTINCT FROM OLD.active_status THEN 'active_status' END
            ], NULL) END));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_permanent_pay_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_category text;
  v_emp_code text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pay structure records cannot be deleted' USING ERRCODE = 'P0001';
  END IF;

  SELECT employee_category, employee_code INTO v_category, v_emp_code
  FROM public.hr_employees
  WHERE id = NEW.employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target employee does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF v_category NOT IN (
    'HO Staff', 'Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour', 'Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office'
  ) THEN
    RAISE EXCEPTION 'Permanent pay structures can only be created for permanent employee categories' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
       OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Pay structure identity, revision sequence, and creation audit fields are immutable' USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status IN ('Active', 'Superseded', 'Suspended') THEN
      IF NEW.pay_basis IS DISTINCT FROM OLD.pay_basis
         OR NEW.guaranteed_monthly_gross IS DISTINCT FROM OLD.guaranteed_monthly_gross
         OR NEW.basic_salary IS DISTINCT FROM OLD.basic_salary
         OR NEW.staff_welfare IS DISTINCT FROM OLD.staff_welfare
         OR NEW.other_fixed_components IS DISTINCT FROM OLD.other_fixed_components
         OR NEW.epf_enrolment IS DISTINCT FROM OLD.epf_enrolment
         OR NEW.esi_enrolment IS DISTINCT FROM OLD.esi_enrolment THEN
        RAISE EXCEPTION 'Active, Suspended, or Superseded pay structures cannot have their compensation terms modified. Create a new revision instead.' USING ERRCODE = 'P0001';
      END IF;
      IF OLD.status = 'Active' AND NEW.status NOT IN ('Active', 'Superseded', 'Suspended') THEN
        RAISE EXCEPTION 'Active pay structures can only transition to Superseded or Suspended' USING ERRCODE = 'P0001';
      END IF;
      IF OLD.status = 'Suspended' AND NEW.status NOT IN ('Suspended', 'Active', 'Superseded') THEN
        RAISE EXCEPTION 'Suspended pay structures can only transition to Active or Superseded' USING ERRCODE = 'P0001';
      END IF;
      IF OLD.status = 'Superseded' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Superseded pay structure status cannot be changed' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    NEW.updated_at := now();
  END IF;

  -- Audit without exposing monetary gross amounts (Spec §5)
  INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (
    CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END::text,
    CASE WHEN TG_OP = 'INSERT' THEN 'CREATE_PAY_STRUCTURE' ELSE 'UPDATE_PAY_STRUCTURE' END,
    'HR Permanent Pay Structure',
    v_emp_code,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object(
      'status', OLD.status,
      'revision_number', OLD.revision_number,
      'pay_basis_changed', NEW.pay_basis IS DISTINCT FROM OLD.pay_basis,
      'epf_enrolment_changed', NEW.epf_enrolment IS DISTINCT FROM OLD.epf_enrolment,
      'esi_enrolment_changed', NEW.esi_enrolment IS DISTINCT FROM OLD.esi_enrolment
    ) ELSE NULL END,
    jsonb_build_object(
      'status', NEW.status,
      'revision_number', NEW.revision_number,
      'pay_basis_changed', CASE WHEN TG_OP = 'INSERT' THEN true ELSE NEW.pay_basis IS DISTINCT FROM OLD.pay_basis END,
      'epf_enrolment_changed', CASE WHEN TG_OP = 'INSERT' THEN true ELSE NEW.epf_enrolment IS DISTINCT FROM OLD.epf_enrolment END,
      'esi_enrolment_changed', CASE WHEN TG_OP = 'INSERT' THEN true ELSE NEW.esi_enrolment IS DISTINCT FROM OLD.esi_enrolment END
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_leave_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE e public.hr_employees%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Leave requests cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO e FROM public.hr_employees WHERE id = NEW.employee_id FOR SHARE;
    -- Active status gates roster population, not correction of an already
    -- recorded historical row after an employee leaves the company.
    IF NOT FOUND OR e.joining_date > NEW.from_date THEN
      RAISE EXCEPTION 'Employee is not eligible for this leave' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.employee_category IS DISTINCT FROM e.employee_category THEN
      RAISE EXCEPTION 'Employee category changed; reload before recording leave' USING ERRCODE = 'P0001';
    END IF;
    NEW.employee_category := e.employee_category;
    IF NEW.request_source = 'FACTORY_MANAGER' THEN
      PERFORM public.hr_attendance_require_actor(NEW.created_by, ARRAY['admin','factory_manager']);
      IF e.employee_category IN ('HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office') OR NEW.leave_type = 'Other Leave' THEN
        RAISE EXCEPTION 'Factory source/type requires a factory employee' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      PERFORM public.hr_attendance_require_actor(NEW.created_by, ARRAY['admin','factory_manager','ho','je','zo','accounts']);
      IF (
        e.employee_category NOT IN ('HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office')
        AND NOT (
          (SELECT role FROM public.authorised_users WHERE id = NEW.created_by) IN ('factory_manager', 'admin')
          AND e.employee_category IN ('Fabric Factory Permanent Employees','SNP Permanent Factory Labour','HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office')
        )
      ) OR e.erp_user_id IS DISTINCT FROM NEW.created_by
        OR NEW.leave_type NOT IN ('Medical Leave','Other Leave') OR NEW.pay_treatment <> 'Pending' THEN
        RAISE EXCEPTION 'Self-service leave must be the linked employee own request' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.approval_status <> 'Pending' THEN RAISE EXCEPTION 'New leave must be Pending' USING ERRCODE = 'P0001'; END IF;
    NEW.decided_by := NULL; NEW.decided_at := NULL; NEW.decision_remarks := NULL;
    NEW.updated_by := NEW.created_by; NEW.created_at := now();
  ELSE
    IF (NEW.id,NEW.employee_id,NEW.employee_category,NEW.request_source,NEW.created_by,NEW.created_at) IS DISTINCT FROM
       (OLD.id,OLD.employee_id,OLD.employee_category,OLD.request_source,OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Leave identity/source is immutable' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.approval_status <> 'Pending' THEN RAISE EXCEPTION 'Decided leave is immutable' USING ERRCODE = 'P0001'; END IF;
    IF NEW.approval_status <> 'Pending' THEN
      PERFORM public.hr_attendance_require_actor(NEW.updated_by, ARRAY['admin','ho']);
      IF (NEW.from_date,NEW.to_date,NEW.leave_type,NEW.reason) IS DISTINCT FROM (OLD.from_date,OLD.to_date,OLD.leave_type,OLD.reason) THEN
        RAISE EXCEPTION 'A decision cannot rewrite leave facts' USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS(SELECT 1 FROM public.hr_attendance_rows a JOIN public.hr_attendance_sheets s ON s.id = a.sheet_id
        WHERE a.leave_request_id = NEW.id AND s.status IN ('HO Reviewed','Locked')) THEN
        RAISE EXCEPTION 'Leave linked to reviewed/locked attendance is immutable' USING ERRCODE = 'P0001';
      END IF;
      NEW.decided_by := NEW.updated_by; NEW.decided_at := now();
      IF NEW.approval_status = 'Rejected' THEN
        IF NEW.decision_remarks IS NULL OR length(btrim(NEW.decision_remarks)) NOT BETWEEN 1 AND 2000 THEN
          RAISE EXCEPTION 'Rejection remarks are required' USING ERRCODE = 'P0001';
        END IF;
        NEW.pay_treatment := 'Unpaid';
        UPDATE public.hr_attendance_sheets SET status = 'Returned for Correction', updated_by = NEW.updated_by,
          return_remarks = NEW.decision_remarks WHERE status = 'Submitted' AND id IN (
            SELECT sheet_id FROM public.hr_attendance_rows WHERE leave_request_id = NEW.id);
      END IF;
    ELSE
      IF NEW.request_source = 'FACTORY_MANAGER' THEN
        PERFORM public.hr_attendance_require_actor(NEW.updated_by, ARRAY['admin','factory_manager']);
      ELSE
        PERFORM public.hr_attendance_require_actor(NEW.updated_by, ARRAY['admin','factory_manager','ho','je','zo','accounts']);
        PERFORM 1 FROM public.hr_employees WHERE id = NEW.employee_id AND erp_user_id = NEW.updated_by;
        IF NOT FOUND THEN RAISE EXCEPTION 'Self-service leave is restricted to its linked employee' USING ERRCODE = '42501'; END IF;
        IF NEW.leave_type NOT IN ('Medical Leave','Other Leave') OR NEW.pay_treatment <> 'Pending' THEN
          RAISE EXCEPTION 'Self-service pay treatment is decided by HO' USING ERRCODE = 'P0001';
        END IF;
      END IF;
      IF EXISTS(SELECT 1 FROM public.hr_attendance_rows a JOIN public.hr_attendance_sheets s ON s.id = a.sheet_id
        WHERE a.leave_request_id = NEW.id AND (s.status NOT IN ('Draft','Returned for Correction')
          OR s.attendance_date NOT BETWEEN NEW.from_date AND NEW.to_date
          OR (NEW.leave_type = 'Medical Leave' AND a.attendance_status <> 'Medical Leave')
          OR (NEW.leave_type = 'Paid Leave' AND a.attendance_status <> 'Paid Leave')
          OR (NEW.leave_type IN ('Unpaid Leave','Leave / Not Working') AND a.attendance_status <> 'Unpaid Leave'))) THEN
        RAISE EXCEPTION 'Leave edit would alter protected attendance or invalidate a linked date/type' USING ERRCODE = 'P0001';
      END IF;
      NEW.decided_by := NULL; NEW.decided_at := NULL; NEW.decision_remarks := NULL;
    END IF;
  END IF;
  IF NEW.employee_category = 'Local Daily-Wage Workers' THEN
    IF NEW.pay_treatment <> 'Unpaid' OR NEW.leave_type = 'Paid Leave' THEN
      RAISE EXCEPTION 'Local leave is always Unpaid' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.request_source = 'FACTORY_MANAGER' AND NEW.leave_type = 'Other Leave' THEN
    RAISE EXCEPTION 'Other Leave belongs to self-service' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_hr_leave_request(p_leave_id uuid, p_employee_id uuid, p_source text,
  p_from_date date, p_to_date date, p_leave_type text, p_reason text, p_pay_treatment text, p_actor_id uuid)
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE l public.hr_leave_requests%ROWTYPE; v_category text; v_employee_id uuid;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','factory_manager','ho','je','zo','accounts']);
  IF p_leave_id IS NULL THEN SELECT employee_category,id INTO v_category,v_employee_id FROM public.hr_employees WHERE id = p_employee_id;
  ELSE SELECT employee_category,employee_id INTO v_category,v_employee_id FROM public.hr_leave_requests WHERE id = p_leave_id; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee/leave not found' USING ERRCODE = 'P0002'; END IF;
  IF v_category NOT IN ('HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office') THEN PERFORM public.hr_attendance_lock_category(v_category); END IF;
  -- Serialize exclusion-index probes for the same employee, avoiding deadlocks
  -- when concurrent self-service inserts first encounter each other in GiST.
  PERFORM pg_advisory_xact_lock(hashtextextended('hr_leave:' || v_employee_id::text, 0));
  IF p_leave_id IS NULL THEN
    INSERT INTO public.hr_leave_requests(employee_id,employee_category,request_source,from_date,to_date,leave_type,reason,pay_treatment,created_by,updated_by)
      VALUES(p_employee_id,v_category,p_source,p_from_date,p_to_date,p_leave_type,p_reason,p_pay_treatment,p_actor_id,p_actor_id) RETURNING * INTO l;
  ELSE
    SELECT * INTO l FROM public.hr_leave_requests WHERE id = p_leave_id FOR UPDATE;
    IF l.employee_id IS DISTINCT FROM p_employee_id OR l.request_source IS DISTINCT FROM p_source THEN
      RAISE EXCEPTION 'Leave identity/source is immutable' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.hr_leave_requests SET from_date = p_from_date, to_date = p_to_date, leave_type = p_leave_type,
      reason = p_reason, pay_treatment = p_pay_treatment, updated_by = p_actor_id WHERE id = p_leave_id RETURNING * INTO l;
  END IF;
  RETURN l;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_hr_leave_request(p_leave_id uuid, p_decision text, p_pay_treatment text, p_remarks text, p_actor_id uuid)
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE l public.hr_leave_requests%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','ho']);
  SELECT * INTO l FROM public.hr_leave_requests WHERE id = p_leave_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave not found' USING ERRCODE = 'P0002'; END IF;
  IF l.employee_category NOT IN ('HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office') THEN PERFORM public.hr_attendance_lock_category(l.employee_category); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hr_leave:' || l.employee_id::text, 0));
  SELECT * INTO l FROM public.hr_leave_requests WHERE id = p_leave_id FOR UPDATE;
  IF p_decision NOT IN ('Approved','Rejected') OR p_decision IS NULL THEN RAISE EXCEPTION 'Approve/Reject decision required' USING ERRCODE = '22023'; END IF;
  IF p_remarks IS NOT NULL AND length(p_remarks) > 2000 THEN RAISE EXCEPTION 'Remarks too long' USING ERRCODE = '22023'; END IF;
  UPDATE public.hr_leave_requests SET approval_status = p_decision,
    pay_treatment = CASE WHEN p_decision = 'Rejected' THEN 'Unpaid' ELSE p_pay_treatment END,
    decision_remarks = p_remarks, updated_by = p_actor_id WHERE id = p_leave_id RETURNING * INTO l;
  RETURN l;
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
    WHERE employee_category = s.employee_category AND effective_from <= s.attendance_date ORDER BY effective_from DESC LIMIT 1;
  NEW.pay_rule_revision_id := r.id;
  NEW.wage_revision_id := NULL;
  IF s.employee_category IN ('SNP Casual Factory Labour','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers') THEN
    SELECT id INTO NEW.wage_revision_id FROM public.hr_factory_wage_revisions
      WHERE employee_category = s.employee_category AND effective_from <= s.attendance_date ORDER BY effective_from DESC LIMIT 1;
  END IF;
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

CREATE OR REPLACE FUNCTION public.hr_attendance_validate_sheet(p_sheet_id uuid, p_locking boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id;
  IF NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows WHERE sheet_id = s.id) THEN
    RAISE EXCEPTION 'Cannot submit an empty attendance sheet' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.hr_employees e WHERE e.employee_category = s.employee_category
    AND (s.department IS NULL OR e.department=s.department)
    AND e.active_status = 'Active' AND e.joining_date <= s.attendance_date
    AND NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows a WHERE a.sheet_id = s.id AND a.employee_id = e.id)) THEN
    RAISE EXCEPTION 'Populate all eligible roster employees before submission' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.hr_attendance_rows a LEFT JOIN public.hr_leave_requests l ON l.id = a.leave_request_id
    WHERE a.sheet_id = s.id AND (
      a.attendance_status IS NULL OR a.pay_rule_revision_id IS NULL
      OR (s.employee_category IN ('SNP Casual Factory Labour','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers') AND a.wage_revision_id IS NULL)
      OR (a.attendance_status = 'Present' AND (a.entry_timestamp IS NULL OR a.exit_timestamp IS NULL))
      OR (a.attendance_status = 'Management Issue' AND ((a.entry_timestamp IS NULL) <> (a.exit_timestamp IS NULL)))
      OR (s.employee_category = 'Local Daily-Wage Workers' AND
          (a.attendance_status = 'Present' OR a.actual_hours > 0) AND a.duty_type IS NULL)
      OR (a.attendance_status IN ('Medical Leave','Paid Leave','Unpaid Leave') AND a.leave_request_id IS NULL)
      OR (a.leave_request_id IS NOT NULL AND (l.approval_status = 'Rejected'
        OR (p_locking AND (l.approval_status <> 'Approved' OR (a.attendance_status = 'Paid Leave' AND l.pay_treatment <> 'Paid')
          OR (a.attendance_status = 'Unpaid Leave' AND l.pay_treatment <> 'Unpaid')))))
    )) THEN
    RAISE EXCEPTION 'Sheet has incomplete attendance/configuration or unresolved leave' USING ERRCODE = 'P0001';
  END IF;
  -- An active covering factory leave must not be detached or contradicted at submission/review.
  IF EXISTS(
    SELECT 1 FROM public.hr_attendance_rows a
    JOIN public.hr_leave_requests l ON l.employee_id = a.employee_id
      AND l.request_source IN ('FACTORY_MANAGER', 'SELF_SERVICE')
      AND l.employee_category = s.employee_category
      AND l.approval_status IN ('Pending','Approved')
      AND s.attendance_date BETWEEN l.from_date AND l.to_date
    WHERE a.sheet_id = s.id AND (
      a.leave_request_id IS DISTINCT FROM l.id
      OR a.attendance_status IS DISTINCT FROM (
        CASE WHEN l.leave_type = 'Medical Leave' THEN 'Medical Leave'
             WHEN l.approval_status = 'Approved' AND l.pay_treatment = 'Paid' THEN 'Paid Leave'
             WHEN l.approval_status = 'Approved' THEN 'Unpaid Leave'
             WHEN l.leave_type = 'Paid Leave' THEN 'Paid Leave' ELSE 'Unpaid Leave' END
      )
    )
  ) THEN
    RAISE EXCEPTION 'Sheet has incomplete attendance/configuration or unresolved leave' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_attendance_guard_sheet()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attendance sheets cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    -- Three-argument legacy RPC callers default Local to SNP; new UI always supplies the factory.
    NEW.department := COALESCE(NEW.department,CASE WHEN NEW.employee_category LIKE 'Fabric Factory%' THEN 'Fabric Factory' ELSE 'SNP Factory' END);
    IF NOT public.hr_employee_department_allowed(NEW.employee_category,NEW.department) THEN
      RAISE EXCEPTION 'Attendance category and factory do not match' USING ERRCODE='23514';
    END IF;
    PERFORM public.hr_attendance_lock_category(NEW.employee_category);
    IF EXISTS(SELECT 1 FROM public.hr_attendance_sheets WHERE attendance_date=NEW.attendance_date
      AND employee_category=NEW.employee_category AND department IS NULL) THEN
      RAISE EXCEPTION 'Use the existing legacy attendance sheet for this date' USING ERRCODE='P0001';
    END IF;
    PERFORM public.hr_attendance_require_actor(NEW.created_by, ARRAY['admin','factory_manager']);
    IF NEW.status <> 'Draft' OR NEW.submission_count <> 0 OR NEW.submitted_at IS NOT NULL
      OR NEW.returned_at IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.locked_at IS NOT NULL
      OR NEW.submitted_by IS NOT NULL OR NEW.returned_by IS NOT NULL OR NEW.reviewed_by IS NOT NULL THEN
      RAISE EXCEPTION 'New sheets must start as Draft' USING ERRCODE = 'P0001';
    END IF;
    NEW.return_remarks := NULL; NEW.review_remarks := NULL;
    NEW.updated_by := NEW.created_by; NEW.created_at := now();
  ELSE
    IF (NEW.id,NEW.attendance_date,NEW.employee_category,NEW.department,NEW.created_by,NEW.created_at) IS DISTINCT FROM
       (OLD.id,OLD.attendance_date,OLD.employee_category,OLD.department,OLD.created_by,OLD.created_at) THEN
      RAISE EXCEPTION 'Sheet identity is immutable' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'Locked' OR NEW.status = OLD.status THEN
      RAISE EXCEPTION 'Sheet edits/reopening are not allowed' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status IN ('Draft','Returned for Correction') AND NEW.status = 'Submitted' THEN
      PERFORM public.hr_attendance_require_actor(NEW.updated_by, ARRAY['admin','factory_manager']);
      PERFORM public.hr_attendance_validate_sheet(NEW.id, false);
      NEW.submission_count := OLD.submission_count + 1; NEW.submitted_by := NEW.updated_by; NEW.submitted_at := now();
      NEW.returned_by := OLD.returned_by; NEW.returned_at := OLD.returned_at; NEW.return_remarks := OLD.return_remarks;
      NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_remarks := NULL; NEW.locked_at := NULL;
    ELSIF OLD.status = 'Submitted' AND NEW.status = 'Returned for Correction' THEN
      PERFORM public.hr_attendance_require_actor(NEW.updated_by, ARRAY['admin','ho']);
      IF NEW.return_remarks IS NULL OR length(btrim(NEW.return_remarks)) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'Return remarks are required' USING ERRCODE = 'P0001';
      END IF;
      NEW.returned_by := NEW.updated_by; NEW.returned_at := now();
      NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_remarks := NULL; NEW.locked_at := NULL;
    ELSIF OLD.status = 'Submitted' AND NEW.status = 'HO Reviewed' THEN
      PERFORM public.hr_attendance_require_actor(NEW.updated_by, ARRAY['admin','ho']);
      PERFORM public.hr_attendance_validate_sheet(NEW.id, true);
      NEW.reviewed_by := NEW.updated_by; NEW.reviewed_at := now(); NEW.locked_at := NULL;
    ELSIF OLD.status = 'HO Reviewed' AND NEW.status = 'Locked' THEN
      PERFORM public.hr_attendance_require_actor(NEW.updated_by, ARRAY['admin','ho']);
      NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at; NEW.review_remarks := OLD.review_remarks;
      NEW.locked_at := now();
    ELSE RAISE EXCEPTION 'Invalid attendance sheet transition' USING ERRCODE = 'P0001'; END IF;
    IF NEW.status <> 'Submitted' THEN
      NEW.submission_count := OLD.submission_count; NEW.submitted_by := OLD.submitted_by; NEW.submitted_at := OLD.submitted_at;
    END IF;
    IF NEW.status <> 'Returned for Correction' THEN
      NEW.returned_by := OLD.returned_by; NEW.returned_at := OLD.returned_at; NEW.return_remarks := OLD.return_remarks;
    END IF;
  END IF;
  NEW.updated_at := now(); RETURN NEW;
END;
$$;

DROP FUNCTION public.populate_hr_attendance_sheet(date,text,uuid);

CREATE OR REPLACE FUNCTION public.populate_hr_attendance_sheet(p_date date, p_category text, p_actor_id uuid, p_department text DEFAULT NULL)
RETURNS public.hr_attendance_sheets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE;
BEGIN
  p_department := COALESCE(p_department,CASE WHEN p_category LIKE 'Fabric Factory%' THEN 'Fabric Factory' ELSE 'SNP Factory' END);
  IF NOT public.hr_employee_department_allowed(p_category,p_department) OR p_category IN ('HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office') THEN
    RAISE EXCEPTION 'Attendance category and factory do not match' USING ERRCODE='22023';
  END IF;
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','factory_manager']);
  PERFORM public.hr_attendance_lock_category(p_category);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE attendance_date = p_date AND employee_category = p_category AND (department=p_department OR department IS NULL) FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.hr_attendance_sheets(attendance_date,employee_category,department,created_by,updated_by)
      VALUES(p_date,p_category,p_department,p_actor_id,p_actor_id) RETURNING * INTO s;
  END IF;
  IF s.status NOT IN ('Draft','Returned for Correction') THEN RAISE EXCEPTION 'Roster cannot change after submission' USING ERRCODE = 'P0001'; END IF;
  -- Hold roster employee identity/status stable through population and commit.
  PERFORM 1 FROM public.hr_employees WHERE employee_category = p_category AND (s.department IS NULL OR department=s.department) AND active_status = 'Active' AND joining_date <= p_date ORDER BY id FOR SHARE;
  INSERT INTO public.hr_attendance_rows(sheet_id,employee_id,attendance_status,leave_request_id,created_by,updated_by)
    SELECT s.id,e.id,CASE WHEN l.id IS NULL THEN NULL
        WHEN l.leave_type = 'Medical Leave' THEN 'Medical Leave'
        WHEN l.approval_status = 'Approved' AND l.pay_treatment = 'Paid' THEN 'Paid Leave'
        WHEN l.approval_status = 'Approved' THEN 'Unpaid Leave'
        WHEN l.leave_type = 'Paid Leave' THEN 'Paid Leave' ELSE 'Unpaid Leave' END,
      l.id,p_actor_id,p_actor_id FROM public.hr_employees e
      LEFT JOIN public.hr_leave_requests l ON l.employee_id = e.id AND l.request_source IN ('FACTORY_MANAGER', 'SELF_SERVICE')
        AND l.employee_category = p_category AND l.approval_status IN ('Pending','Approved') AND p_date BETWEEN l.from_date AND l.to_date
      WHERE e.employee_category = p_category AND (s.department IS NULL OR e.department=s.department) AND e.active_status = 'Active' AND e.joining_date <= p_date
      AND NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows WHERE sheet_id = s.id AND employee_id = e.id);
  RETURN s;
END;
$$;

DROP FUNCTION public.get_hr_attendance_review_queue(uuid,date,date,text,text,integer,integer);

CREATE OR REPLACE FUNCTION public.get_hr_attendance_review_queue(p_actor_id uuid,p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,p_category text DEFAULT NULL,p_status text DEFAULT NULL,
  p_page integer DEFAULT 1,p_limit integer DEFAULT 20,p_department text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id,ARRAY['admin','ho']);
  IF p_page IS NULL OR p_page<1 OR p_page>100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_from_date IS NOT NULL AND p_to_date IS NOT NULL AND p_from_date>p_to_date)
    OR (p_department IS NOT NULL AND p_department NOT IN ('Fabric Factory','SNP Factory'))
    OR (p_status IS NOT NULL AND p_status NOT IN ('Submitted','Returned for Correction','Locked'))
    OR (p_category IS NOT NULL AND p_category NOT IN ('Fabric Factory Permanent Employees',
      'SNP Permanent Factory Labour','SNP Casual Factory Labour','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers')) THEN
    RAISE EXCEPTION 'Invalid review queue filters' USING ERRCODE='22023';
  END IF;
  WITH filtered AS (
    SELECT s.* FROM public.hr_attendance_sheets s
    WHERE s.status IN ('Submitted','Returned for Correction','Locked')
      AND (p_from_date IS NULL OR s.attendance_date>=p_from_date)
      AND (p_to_date IS NULL OR s.attendance_date<=p_to_date)
      AND (p_category IS NULL OR s.employee_category=p_category)
      AND (p_department IS NULL OR s.department=p_department OR s.department IS NULL)
      AND (p_status IS NULL OR s.status=p_status)
  ), page AS (
    SELECT * FROM filtered ORDER BY attendance_date DESC,employee_category,id
      LIMIT p_limit OFFSET (p_page-1)*p_limit
  ), summaries AS (
    SELECT s.id,s.attendance_date,s.employee_category,s.department,s.status,s.submission_count,
      s.submitted_by,s.submitted_at,u.display_name AS submitted_by_name,
      CASE WHEN s.status='Returned for Correction' THEN s.return_remarks ELSE s.review_remarks END AS ho_remarks,
      count(a.id) AS roster,
      count(a.id) FILTER(WHERE a.attendance_status='Present') AS present,
      count(a.id) FILTER(WHERE a.attendance_status='Absent') AS absent,
      count(a.id) FILTER(WHERE a.attendance_status IN ('Medical Leave','Paid Leave','Unpaid Leave')) AS leave_medical,
      count(a.id) FILTER(WHERE a.attendance_status='Compensatory Off') AS comp_off,
      count(a.id) FILTER(WHERE a.attendance_status='Management Issue') AS management_issue,
      count(a.id) FILTER(WHERE a.holiday_pay_eligible) AS holiday_pay_eligible,
      coalesce(sum(a.ot_hours),0) AS total_ot_hours
    FROM page s LEFT JOIN public.hr_attendance_rows a ON a.sheet_id=s.id
    LEFT JOIN public.authorised_users u ON u.id=s.submitted_by
    GROUP BY s.id,s.attendance_date,s.employee_category,s.department,s.status,s.submission_count,
      s.submitted_by,s.submitted_at,u.display_name,s.return_remarks,s.review_remarks
  ) SELECT jsonb_build_object('sheets',coalesce((SELECT jsonb_agg(to_jsonb(q)
    ORDER BY q.attendance_date DESC,q.employee_category,q.id) FROM summaries q),'[]'::jsonb),
    'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'totalItems',(SELECT count(*) FROM filtered),
      'totalPages',greatest(1,ceil((SELECT count(*) FROM filtered)::numeric/p_limit)))) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.populate_hr_attendance_sheet(date,text,uuid,text),
  public.get_hr_attendance_review_queue(uuid,date,date,text,text,integer,integer,text),
  public.hr_employee_department_allowed(text,text),public.hr_employee_department_guard(),public.hr_attendance_guard_employee_day()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.populate_hr_attendance_sheet(date,text,uuid,text),
  public.get_hr_attendance_review_queue(uuid,date,date,text,text,integer,integer,text) TO service_role;
NOTIFY pgrst,'reload schema';
