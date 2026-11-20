-- Migration 100: Enable Self-Service Leave for Factory Manager & linked factory permanent employees
-- Extends hr_leave_guard() to permit factory_manager role to submit self-service leaves
-- for their linked permanent employee record, and ensures attendance sheets recognize
-- both FACTORY_MANAGER and SELF_SERVICE leaves.

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
      IF e.employee_category IN ('HO Staff','Projects Department Employees') OR NEW.leave_type = 'Other Leave' THEN
        RAISE EXCEPTION 'Factory source/type requires a factory employee' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      PERFORM public.hr_attendance_require_actor(NEW.created_by, ARRAY['admin','factory_manager','ho','je','zo','accounts']);
      IF (
        e.employee_category NOT IN ('HO Staff','Projects Department Employees')
        AND NOT (
          (SELECT role FROM public.authorised_users WHERE id = NEW.created_by) IN ('factory_manager', 'admin')
          AND e.employee_category IN ('Fabric Factory Permanent Employees','SNP Permanent Factory Labour','HO Staff','Projects Department Employees')
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

-- Allow populate_hr_attendance_sheet to link both FACTORY_MANAGER and SELF_SERVICE leaves
CREATE OR REPLACE FUNCTION public.populate_hr_attendance_sheet(p_date date, p_category text, p_actor_id uuid)
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
      LEFT JOIN public.hr_leave_requests l ON l.employee_id = e.id AND l.request_source IN ('FACTORY_MANAGER', 'SELF_SERVICE')
        AND l.employee_category = p_category AND l.approval_status IN ('Pending','Approved') AND p_date BETWEEN l.from_date AND l.to_date
      WHERE e.employee_category = p_category AND e.active_status = 'Active' AND e.joining_date <= p_date
      AND NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows WHERE sheet_id = s.id AND employee_id = e.id);
  RETURN s;
END;
$$;

-- Allow hr_attendance_validate_sheet to recognize both FACTORY_MANAGER and SELF_SERVICE leaves
CREATE OR REPLACE FUNCTION public.hr_attendance_validate_sheet(p_sheet_id uuid, p_locking boolean)
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
