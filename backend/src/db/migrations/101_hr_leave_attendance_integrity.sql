-- Forward correction for migration 100. Preserve request identity and existing RPC signatures.

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

CREATE OR REPLACE FUNCTION public.hr_factory_leave_approval_correction()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_sheet uuid;
BEGIN
  IF NEW.request_source IN ('FACTORY_MANAGER','SELF_SERVICE') AND OLD.approval_status = 'Pending'
    AND NEW.approval_status = 'Approved' THEN
    FOR v_sheet IN
      SELECT DISTINCT s.id FROM public.hr_attendance_sheets s
      JOIN public.hr_attendance_rows a ON a.sheet_id = s.id
      WHERE s.status = 'Submitted' AND a.leave_request_id = NEW.id
        AND a.attendance_status IS DISTINCT FROM CASE
          WHEN NEW.leave_type = 'Medical Leave' THEN 'Medical Leave'
          WHEN NEW.pay_treatment = 'Paid' THEN 'Paid Leave' ELSE 'Unpaid Leave' END
      ORDER BY s.id
    LOOP
      PERFORM public.transition_hr_attendance_sheet(v_sheet,'return',
        'Leave approved as ' || NEW.pay_treatment || '. Correct attendance treatment before resubmission.'
          || CASE WHEN NULLIF(btrim(NEW.decision_remarks),'') IS NULL THEN '' ELSE ' ' || left(NEW.decision_remarks,1800) END,
        NEW.updated_by);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_hr_leave_request(p_leave_id uuid, p_decision text, p_pay_treatment text, p_remarks text, p_actor_id uuid)
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE l public.hr_leave_requests%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','ho']);
  SELECT * INTO l FROM public.hr_leave_requests WHERE id = p_leave_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave not found' USING ERRCODE = 'P0002'; END IF;
  IF l.employee_category NOT IN ('HO Staff','Projects Department Employees') THEN PERFORM public.hr_attendance_lock_category(l.employee_category); END IF;
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

CREATE OR REPLACE FUNCTION public.decide_hr_factory_sheet_leave(p_sheet_id uuid,p_leave_id uuid,
  p_decision text,p_pay_treatment text,p_remarks text,p_actor_id uuid)
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id,ARRAY['admin','ho']);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.hr_attendance_lock_category(s.employee_category);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF s.status <> 'Submitted' THEN RAISE EXCEPTION 'Leave decisions require a Submitted sheet' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows a JOIN public.hr_leave_requests l ON l.id=a.leave_request_id
    WHERE a.sheet_id=s.id AND l.id=p_leave_id AND l.request_source IN ('FACTORY_MANAGER','SELF_SERVICE')
      AND l.employee_id=a.employee_id AND l.employee_category=s.employee_category
      AND s.attendance_date BETWEEN l.from_date AND l.to_date) THEN
    RAISE EXCEPTION 'Linked factory leave not found' USING ERRCODE='P0002';
  END IF;
  -- Local treatment and rejection treatment are forced here and independently protected by the leave guard.
  RETURN public.decide_hr_leave_request(p_leave_id,p_decision,
    CASE WHEN s.employee_category='Local Daily-Wage Workers' OR p_decision='Rejected' THEN 'Unpaid' ELSE p_pay_treatment END,
    p_remarks,p_actor_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
