-- Projects Department Employees is a one-way legacy category.
-- Existing legacy records may be edited/reclassified, but new or reclassified records cannot enter it.
CREATE OR REPLACE FUNCTION public.hr_employee_department_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- Grandfather existing records until Admin confirms their real assignment.
  IF TG_OP='INSERT' OR (NEW.employee_category,NEW.department) IS DISTINCT FROM (OLD.employee_category,OLD.department) THEN
    IF (NEW.employee_category='Projects Department Employees'
        AND (TG_OP='INSERT' OR OLD.employee_category IS DISTINCT FROM 'Projects Department Employees'))
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
