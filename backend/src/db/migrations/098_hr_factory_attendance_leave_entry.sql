-- Compose the Phase 3 operations: leave entry and its daily row are one transaction.
CREATE FUNCTION public.save_hr_factory_attendance_leave(
  p_sheet_id uuid, p_employee_id uuid, p_leave_id uuid,
  p_from_date date, p_to_date date, p_leave_type text, p_reason text,
  p_pay_treatment text, p_actor_id uuid)
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE; l public.hr_leave_requests%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id, ARRAY['admin','factory_manager']);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.hr_attendance_lock_category(s.employee_category);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF s.attendance_date NOT BETWEEN p_from_date AND p_to_date THEN
    RAISE EXCEPTION 'Leave range must cover the attendance date' USING ERRCODE = '22023';
  END IF;
  -- Unlink only this editable row before changing a Pending request's type/range.
  -- Other linked dates remain protected by the existing leave guard.
  PERFORM public.save_hr_attendance_rows(p_sheet_id,
    jsonb_build_array(jsonb_build_object('employee_id',p_employee_id,'leave_request_id',NULL)),p_actor_id);
  l := public.save_hr_leave_request(p_leave_id,p_employee_id,'FACTORY_MANAGER',
    p_from_date,p_to_date,p_leave_type,p_reason,p_pay_treatment,p_actor_id);
  PERFORM public.save_hr_attendance_rows(p_sheet_id,jsonb_build_array(jsonb_build_object(
    'employee_id',p_employee_id,'leave_request_id',l.id,
    'attendance_status',CASE WHEN l.leave_type = 'Medical Leave' THEN 'Medical Leave'
      WHEN l.leave_type = 'Paid Leave' THEN 'Paid Leave' ELSE 'Unpaid Leave' END,
    'entry_timestamp',NULL,'exit_timestamp',NULL,'duty_type',NULL,'holiday_pay_eligible',false)),p_actor_id);
  RETURN l;
END;
$$;
REVOKE ALL ON FUNCTION public.save_hr_factory_attendance_leave(uuid,uuid,uuid,date,date,text,text,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_hr_factory_attendance_leave(uuid,uuid,uuid,date,date,text,text,text,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
