-- Phase 3 only: persistent attendance facts, range-based leave, and atomic workflow.
-- ERP user IDs are supplied by trusted backend code, never by an end-user payload.
SET LOCAL search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.hr_attendance_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_date date NOT NULL CHECK (isfinite(attendance_date)),
  employee_category text NOT NULL CHECK (employee_category IN (
    'Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour',
    'SNP Casual Factory Labour', 'Local Daily-Wage Workers')),
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Submitted', 'Returned for Correction', 'HO Reviewed', 'Locked')),
  submission_count integer NOT NULL DEFAULT 0 CHECK (submission_count >= 0),
  submitted_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  returned_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  returned_at timestamptz,
  return_remarks text,
  reviewed_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_remarks text,
  locked_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_sheet_date_category_unique UNIQUE (attendance_date, employee_category)
);
CREATE INDEX hr_sheets_queue_idx ON public.hr_attendance_sheets(status, attendance_date, employee_category);

CREATE TABLE public.hr_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE RESTRICT,
  -- Category at recording time preserves the meaning if Employee Master changes later.
  employee_category text NOT NULL,
  request_source text NOT NULL CHECK (request_source IN ('FACTORY_MANAGER', 'SELF_SERVICE')),
  from_date date NOT NULL CHECK (isfinite(from_date)),
  to_date date NOT NULL CHECK (isfinite(to_date) AND to_date >= from_date),
  leave_type text NOT NULL CHECK (leave_type IN ('Medical Leave', 'Paid Leave', 'Unpaid Leave', 'Leave / Not Working', 'Other Leave')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  approval_status text NOT NULL DEFAULT 'Pending' CHECK (approval_status IN ('Pending', 'Approved', 'Rejected')),
  pay_treatment text NOT NULL DEFAULT 'Pending' CHECK (pay_treatment IN ('Pending', 'Paid', 'Unpaid')),
  decided_by uuid REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_remarks text,
  created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (employee_category <> 'Local Daily-Wage Workers' OR (pay_treatment = 'Unpaid' AND leave_type <> 'Paid Leave')),
  CHECK ((approval_status = 'Pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (approval_status <> 'Pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (approval_status <> 'Approved' OR pay_treatment IN ('Paid', 'Unpaid')),
  CONSTRAINT hr_leave_active_range_excl EXCLUDE USING gist (
    employee_id WITH =, daterange(from_date, to_date, '[]') WITH &&
  ) WHERE (approval_status IN ('Pending', 'Approved'))
);
CREATE INDEX hr_leave_queue_idx ON public.hr_leave_requests(approval_status, request_source, from_date);

CREATE TABLE public.hr_attendance_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.hr_attendance_sheets(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE RESTRICT,
  attendance_status text CHECK (attendance_status IN ('Present', 'Absent', 'Medical Leave', 'Paid Leave', 'Unpaid Leave', 'Compensatory Off', 'Management Issue')),
  entry_timestamp timestamptz CHECK (entry_timestamp IS NULL OR isfinite(entry_timestamp)),
  exit_timestamp timestamptz CHECK (exit_timestamp IS NULL OR isfinite(exit_timestamp)),
  actual_hours numeric NOT NULL DEFAULT 0 CHECK (actual_hours >= 0 AND actual_hours < 'Infinity'::numeric),
  ot_hours numeric NOT NULL DEFAULT 0 CHECK (ot_hours >= 0 AND ot_hours < 'Infinity'::numeric),
  duty_type text CHECK (duty_type IN ('Single Duty', 'Double Duty')),
  holiday_pay_eligible boolean NOT NULL DEFAULT false,
  leave_request_id uuid REFERENCES public.hr_leave_requests(id) ON DELETE RESTRICT,
  pay_rule_revision_id uuid REFERENCES public.hr_factory_pay_rule_revisions(id) ON DELETE RESTRICT,
  wage_revision_id uuid REFERENCES public.hr_factory_wage_revisions(id) ON DELETE RESTRICT,
  remarks text CHECK (remarks IS NULL OR length(remarks) <= 2000),
  created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_row_sheet_employee_unique UNIQUE (sheet_id, employee_id),
  CHECK (exit_timestamp IS NULL OR (entry_timestamp IS NOT NULL AND exit_timestamp > entry_timestamp))
);
CREATE INDEX hr_rows_employee_idx ON public.hr_attendance_rows(employee_id, sheet_id);
CREATE INDEX hr_rows_leave_idx ON public.hr_attendance_rows(leave_request_id, sheet_id) WHERE leave_request_id IS NOT NULL;

CREATE FUNCTION public.hr_attendance_require_actor(p_actor_id uuid, p_roles text[])
RETURNS text LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM public.authorised_users WHERE id = p_actor_id AND is_active FOR SHARE;
  IF NOT FOUND OR NOT (v_role = ANY(p_roles)) THEN
    RAISE EXCEPTION 'Attendance/leave access denied' USING ERRCODE = '42501';
  END IF;
  RETURN v_role;
END;
$$;

-- Shared lock order for factory leave, row edits, population, and transitions.
-- Per-category serialization also prevents review/rejection and submit/edit races.
-- Take the Phase 2 master locks before resolving applicable configurations.
CREATE FUNCTION public.hr_attendance_lock_category(p_category text)
RETURNS void LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hr_attendance:' || p_category, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('hr_factory_pay_rule_revisions:' || p_category, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('hr_factory_wage_revisions:' || p_category, 0));
END;
$$;

CREATE FUNCTION public.hr_attendance_guard_row()
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
    IF NOT FOUND OR e.employee_category <> s.employee_category OR e.active_status <> 'Active' OR e.joining_date > s.attendance_date THEN
      RAISE EXCEPTION 'Employee is not eligible for this sheet roster' USING ERRCODE = 'P0001';
    END IF;
    NEW.created_by := NEW.updated_by; NEW.created_at := now();
  END IF;
  SELECT * INTO r FROM public.hr_factory_pay_rule_revisions
    WHERE employee_category = s.employee_category AND effective_from <= s.attendance_date ORDER BY effective_from DESC LIMIT 1;
  NEW.pay_rule_revision_id := r.id;
  NEW.wage_revision_id := NULL;
  IF s.employee_category IN ('SNP Casual Factory Labour','Local Daily-Wage Workers') THEN
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
    IF NOT FOUND OR l.employee_id <> NEW.employee_id OR l.request_source <> 'FACTORY_MANAGER'
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
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER hr_attendance_row_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hr_attendance_rows
  FOR EACH ROW EXECUTE FUNCTION public.hr_attendance_guard_row();

CREATE FUNCTION public.hr_attendance_validate_sheet(p_sheet_id uuid, p_locking boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id;
  IF NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows WHERE sheet_id = s.id) THEN
    RAISE EXCEPTION 'Cannot submit an empty attendance sheet' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.hr_employees e WHERE e.employee_category = s.employee_category
    AND e.active_status = 'Active' AND e.joining_date <= s.attendance_date
    AND NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows a WHERE a.sheet_id = s.id AND a.employee_id = e.id)) THEN
    RAISE EXCEPTION 'Populate all eligible roster employees before submission' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.hr_attendance_rows a LEFT JOIN public.hr_leave_requests l ON l.id = a.leave_request_id
    WHERE a.sheet_id = s.id AND (
      a.attendance_status IS NULL OR a.pay_rule_revision_id IS NULL
      OR (s.employee_category IN ('SNP Casual Factory Labour','Local Daily-Wage Workers') AND a.wage_revision_id IS NULL)
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
END;
$$;

CREATE FUNCTION public.hr_attendance_guard_sheet()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attendance sheets cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.hr_attendance_require_actor(NEW.created_by, ARRAY['admin','factory_manager']);
    IF NEW.status <> 'Draft' OR NEW.submission_count <> 0 OR NEW.submitted_at IS NOT NULL
      OR NEW.returned_at IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.locked_at IS NOT NULL
      OR NEW.submitted_by IS NOT NULL OR NEW.returned_by IS NOT NULL OR NEW.reviewed_by IS NOT NULL THEN
      RAISE EXCEPTION 'New sheets must start as Draft' USING ERRCODE = 'P0001';
    END IF;
    NEW.return_remarks := NULL; NEW.review_remarks := NULL;
    NEW.updated_by := NEW.created_by; NEW.created_at := now();
  ELSE
    IF (NEW.id,NEW.attendance_date,NEW.employee_category,NEW.created_by,NEW.created_at) IS DISTINCT FROM
       (OLD.id,OLD.attendance_date,OLD.employee_category,OLD.created_by,OLD.created_at) THEN
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
CREATE TRIGGER hr_attendance_sheet_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hr_attendance_sheets
  FOR EACH ROW EXECUTE FUNCTION public.hr_attendance_guard_sheet();
CREATE FUNCTION public.hr_attendance_require_atomic_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.hr_attendance_sheets WHERE id = NEW.id AND status = 'HO Reviewed') THEN
    RAISE EXCEPTION 'HO review must lock attendance in the same transaction' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER hr_sheet_review_must_lock AFTER INSERT OR UPDATE ON public.hr_attendance_sheets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hr_attendance_require_atomic_lock();

CREATE FUNCTION public.hr_leave_guard()
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
      IF e.employee_category IN ('HO Staff','Projects Department Employees') OR NEW.leave_type = 'Other Leave' THEN
        RAISE EXCEPTION 'Factory source/type requires a factory employee' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      PERFORM public.hr_attendance_require_actor(NEW.created_by, ARRAY['admin','factory_manager','ho','je','zo','accounts']);
      IF e.employee_category NOT IN ('HO Staff','Projects Department Employees') OR e.erp_user_id IS DISTINCT FROM NEW.created_by
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
CREATE TRIGGER hr_leave_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.hr_leave_guard();

CREATE FUNCTION public.hr_attendance_leave_audit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_action text; v_module text;
BEGIN
  IF TG_TABLE_NAME = 'hr_attendance_sheets' THEN
    v_module := 'HR Attendance';
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'SHEET_CREATED'
      WHEN NEW.status = 'Submitted' AND OLD.status = 'Returned for Correction' THEN 'SHEET_RESUBMITTED'
      WHEN NEW.status = 'Submitted' THEN 'SHEET_SUBMITTED'
      WHEN NEW.status = 'Returned for Correction' THEN 'SHEET_RETURNED'
      WHEN NEW.status = 'HO Reviewed' THEN 'SHEET_HO_REVIEWED' ELSE 'SHEET_LOCKED' END;
  ELSIF TG_TABLE_NAME = 'hr_attendance_rows' THEN
    v_module := 'HR Attendance'; v_action := CASE WHEN TG_OP = 'INSERT' THEN 'ROSTER_ROW_CREATED' ELSE 'ATTENDANCE_EDITED' END;
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at' - 'updated_by') = (to_jsonb(OLD) - 'updated_at' - 'updated_by') THEN RETURN NEW; END IF;
  ELSE
    v_module := 'HR Leave'; v_action := CASE WHEN TG_OP = 'INSERT' THEN 'LEAVE_CREATED'
      WHEN NEW.approval_status = 'Approved' THEN 'LEAVE_APPROVED'
      WHEN NEW.approval_status = 'Rejected' THEN 'LEAVE_REJECTED' ELSE 'LEAVE_CHANGED' END;
  END IF;
  INSERT INTO public.audit_log(user_id,action,module_name,record_identifier,old_value,new_value)
    VALUES(NEW.updated_by::text,v_action,v_module,NEW.id::text,CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END;
$$;
CREATE TRIGGER hr_sheet_audit AFTER INSERT OR UPDATE ON public.hr_attendance_sheets FOR EACH ROW EXECUTE FUNCTION public.hr_attendance_leave_audit();
CREATE TRIGGER hr_row_audit AFTER INSERT OR UPDATE ON public.hr_attendance_rows FOR EACH ROW EXECUTE FUNCTION public.hr_attendance_leave_audit();
CREATE TRIGGER hr_leave_audit AFTER INSERT OR UPDATE ON public.hr_leave_requests FOR EACH ROW EXECUTE FUNCTION public.hr_attendance_leave_audit();

-- Transactional RPCs; service role has no direct write privilege on these tables.
CREATE FUNCTION public.populate_hr_attendance_sheet(p_date date, p_category text, p_actor_id uuid)
RETURNS public.hr_attendance_sheets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','factory_manager']);
  PERFORM public.hr_attendance_lock_category(p_category);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE attendance_date = p_date AND employee_category = p_category FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.hr_attendance_sheets(attendance_date,employee_category,created_by,updated_by)
      VALUES(p_date,p_category,p_actor_id,p_actor_id) RETURNING * INTO s;
  END IF;
  IF s.status NOT IN ('Draft','Returned for Correction') THEN RAISE EXCEPTION 'Roster cannot change after submission' USING ERRCODE = 'P0001'; END IF;
  -- Hold roster employee identity/status stable through population and commit.
  PERFORM 1 FROM public.hr_employees WHERE employee_category = p_category AND active_status = 'Active' AND joining_date <= p_date ORDER BY id FOR SHARE;
  INSERT INTO public.hr_attendance_rows(sheet_id,employee_id,attendance_status,leave_request_id,created_by,updated_by)
    SELECT s.id,e.id,CASE WHEN l.id IS NULL THEN NULL
        WHEN l.leave_type = 'Medical Leave' THEN 'Medical Leave'
        WHEN l.approval_status = 'Approved' AND l.pay_treatment = 'Paid' THEN 'Paid Leave'
        WHEN l.approval_status = 'Approved' THEN 'Unpaid Leave'
        WHEN l.leave_type = 'Paid Leave' THEN 'Paid Leave' ELSE 'Unpaid Leave' END,
      l.id,p_actor_id,p_actor_id FROM public.hr_employees e
      LEFT JOIN public.hr_leave_requests l ON l.employee_id = e.id AND l.request_source = 'FACTORY_MANAGER'
        AND l.employee_category = p_category AND l.approval_status IN ('Pending','Approved') AND p_date BETWEEN l.from_date AND l.to_date
      WHERE e.employee_category = p_category AND e.active_status = 'Active' AND e.joining_date <= p_date
      AND NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows WHERE sheet_id = s.id AND employee_id = e.id);
  RETURN s;
END;
$$;

CREATE FUNCTION public.save_hr_attendance_rows(p_sheet_id uuid, p_rows jsonb, p_actor_id uuid)
RETURNS SETOF public.hr_attendance_rows LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE; item jsonb; v_employee_id uuid; a public.hr_attendance_rows%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','factory_manager']);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.hr_attendance_lock_category(s.employee_category);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF s.status NOT IN ('Draft','Returned for Correction') THEN RAISE EXCEPTION 'Sheet is not editable' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Attendance rows must be a nonempty array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) t GROUP BY t->>'employee_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Employee occurs more than once in this batch' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item) <> 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN (
      'employee_id','attendance_status','entry_timestamp','exit_timestamp','duty_type','holiday_pay_eligible','leave_request_id','remarks'))
      OR NOT item ? 'employee_id' THEN
      RAISE EXCEPTION 'Unexpected or missing attendance fields' USING ERRCODE = '22023';
    END IF;
    v_employee_id := (item->>'employee_id')::uuid;
    IF EXISTS(SELECT 1 FROM jsonb_each_text(item) kv WHERE kv.key IN ('entry_timestamp','exit_timestamp')
      AND kv.value IS NOT NULL AND kv.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?([Zz]|[+-][0-9]{2}:[0-9]{2})$') THEN
      RAISE EXCEPTION 'Full timestamps with timezone offsets are required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.hr_attendance_rows SET
      attendance_status = CASE WHEN item ? 'attendance_status' THEN item->>'attendance_status' ELSE attendance_status END,
      entry_timestamp = CASE WHEN item ? 'entry_timestamp' THEN (item->>'entry_timestamp')::timestamptz ELSE entry_timestamp END,
      exit_timestamp = CASE WHEN item ? 'exit_timestamp' THEN (item->>'exit_timestamp')::timestamptz ELSE exit_timestamp END,
      duty_type = CASE WHEN item ? 'duty_type' THEN item->>'duty_type' ELSE duty_type END,
      holiday_pay_eligible = CASE WHEN item ? 'holiday_pay_eligible' THEN (item->>'holiday_pay_eligible')::boolean ELSE holiday_pay_eligible END,
      leave_request_id = CASE WHEN item ? 'leave_request_id' THEN (item->>'leave_request_id')::uuid ELSE leave_request_id END,
      remarks = CASE WHEN item ? 'remarks' THEN item->>'remarks' ELSE remarks END, updated_by = p_actor_id
      WHERE sheet_id = s.id AND employee_id = v_employee_id RETURNING * INTO a;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee attendance row not found in roster' USING ERRCODE = 'P0002'; END IF;
    RETURN NEXT a;
  END LOOP;
END;
$$;

CREATE FUNCTION public.transition_hr_attendance_sheet(p_sheet_id uuid, p_action text, p_remarks text, p_actor_id uuid)
RETURNS public.hr_attendance_sheets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, CASE WHEN p_action = 'submit' THEN ARRAY['admin','factory_manager'] ELSE ARRAY['admin','ho'] END);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.hr_attendance_lock_category(s.employee_category);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF p_remarks IS NOT NULL AND length(p_remarks) > 2000 THEN RAISE EXCEPTION 'Remarks too long' USING ERRCODE = '22023'; END IF;
  IF p_action = 'submit' AND s.status IN ('Draft','Returned for Correction') THEN
    -- Refresh config IDs/calculations for every draft row under the master locks.
    UPDATE public.hr_attendance_rows SET updated_by = p_actor_id WHERE sheet_id = s.id;
    UPDATE public.hr_attendance_sheets SET status = 'Submitted', updated_by = p_actor_id WHERE id = s.id RETURNING * INTO s;
  ELSIF p_action = 'return' AND s.status = 'Submitted' THEN
    UPDATE public.hr_attendance_sheets SET status = 'Returned for Correction', return_remarks = p_remarks, updated_by = p_actor_id WHERE id = s.id RETURNING * INTO s;
  ELSIF p_action = 'review' AND s.status = 'Submitted' THEN
    UPDATE public.hr_attendance_sheets SET status = 'HO Reviewed', review_remarks = p_remarks, updated_by = p_actor_id WHERE id = s.id;
    UPDATE public.hr_attendance_sheets SET status = 'Locked', updated_by = p_actor_id WHERE id = s.id RETURNING * INTO s;
  ELSE RAISE EXCEPTION 'Invalid attendance sheet action/state' USING ERRCODE = 'P0001'; END IF;
  RETURN s;
END;
$$;

CREATE FUNCTION public.save_hr_leave_request(p_leave_id uuid, p_employee_id uuid, p_source text,
  p_from_date date, p_to_date date, p_leave_type text, p_reason text, p_pay_treatment text, p_actor_id uuid)
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE l public.hr_leave_requests%ROWTYPE; v_category text; v_employee_id uuid;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','factory_manager','ho','je','zo','accounts']);
  IF p_leave_id IS NULL THEN SELECT employee_category,id INTO v_category,v_employee_id FROM public.hr_employees WHERE id = p_employee_id;
  ELSE SELECT employee_category,employee_id INTO v_category,v_employee_id FROM public.hr_leave_requests WHERE id = p_leave_id; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee/leave not found' USING ERRCODE = 'P0002'; END IF;
  IF v_category NOT IN ('HO Staff','Projects Department Employees') THEN PERFORM public.hr_attendance_lock_category(v_category); END IF;
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

CREATE FUNCTION public.decide_hr_leave_request(p_leave_id uuid, p_decision text, p_pay_treatment text, p_remarks text, p_actor_id uuid)
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE l public.hr_leave_requests%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','ho']);
  SELECT * INTO l FROM public.hr_leave_requests WHERE id = p_leave_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave not found' USING ERRCODE = 'P0002'; END IF;
  IF l.request_source = 'FACTORY_MANAGER' THEN PERFORM public.hr_attendance_lock_category(l.employee_category); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hr_leave:' || l.employee_id::text, 0));
  SELECT * INTO l FROM public.hr_leave_requests WHERE id = p_leave_id FOR UPDATE;
  IF p_decision NOT IN ('Approved','Rejected') OR p_decision IS NULL THEN RAISE EXCEPTION 'Approve/Reject decision required' USING ERRCODE = '22023'; END IF;
  IF p_remarks IS NOT NULL AND length(p_remarks) > 2000 THEN RAISE EXCEPTION 'Remarks too long' USING ERRCODE = '22023'; END IF;
  UPDATE public.hr_leave_requests SET approval_status = p_decision, pay_treatment = p_pay_treatment,
    decision_remarks = p_remarks, updated_by = p_actor_id WHERE id = p_leave_id RETURNING * INTO l;
  RETURN l;
END;
$$;

ALTER TABLE public.hr_attendance_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_attendance_sheets,public.hr_attendance_rows,public.hr_leave_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hr_attendance_sheets,public.hr_attendance_rows,public.hr_leave_requests TO service_role;
REVOKE ALL ON FUNCTION public.hr_attendance_require_actor(uuid,text[]), public.hr_attendance_lock_category(text),
  public.hr_attendance_guard_row(), public.hr_attendance_guard_sheet(), public.hr_attendance_validate_sheet(uuid,boolean),
  public.hr_attendance_require_atomic_lock(), public.hr_leave_guard(), public.hr_attendance_leave_audit()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.populate_hr_attendance_sheet(date,text,uuid),public.save_hr_attendance_rows(uuid,jsonb,uuid),
  public.transition_hr_attendance_sheet(uuid,text,text,uuid),
  public.save_hr_leave_request(uuid,uuid,text,date,date,text,text,text,uuid),
  public.decide_hr_leave_request(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.populate_hr_attendance_sheet(date,text,uuid),public.save_hr_attendance_rows(uuid,jsonb,uuid),
  public.transition_hr_attendance_sheet(uuid,text,text,uuid),
  public.save_hr_leave_request(uuid,uuid,text,date,date,text,text,text,uuid),
  public.decide_hr_leave_request(uuid,text,text,text,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
