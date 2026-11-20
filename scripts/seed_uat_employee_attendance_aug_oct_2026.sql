-- Synthetic UAT attendance: 1 August–14 October 2026 inclusive.
-- Factory employees only, including Local workers. Joining dates are respected.
-- Existing sheets/rows and all leave decisions remain unchanged.
-- New sheets are reviewed/locked via normal RPCs; pending leave stays Draft.
BEGIN;
CREATE TEMP TABLE uat_attendance_seed_result (
 sheet_id uuid, attendance_date date, employee_category text, department text,
 outcome text, employee_rows integer
) ON COMMIT DROP;

DO $$
DECLARE maker uuid; reviewer uuid; candidate record;
 sheet public.hr_attendance_sheets%ROWTYPE; payload jsonb;
 from_date constant date:='2026-08-01'; to_date constant date:='2026-10-14';
BEGIN
 IF to_date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN
  RAISE EXCEPTION 'Attendance seed must not include future dates';
 END IF;
 SELECT id INTO maker FROM public.authorised_users WHERE role='factory_manager' AND is_active ORDER BY id LIMIT 1;
 SELECT id INTO reviewer FROM public.authorised_users WHERE role='ho' AND is_active ORDER BY id LIMIT 1;
 IF maker IS NULL OR reviewer IS NULL THEN RAISE EXCEPTION 'Active Factory Manager and HO actors are required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('uat_attendance_aug_oct_2026',0));
 -- Stabilize the active roster, category and joining-date facts during the seed.
 PERFORM 1 FROM public.hr_employees WHERE active_status='Active' AND department IN ('SNP Factory','Fabric Factory') ORDER BY id FOR SHARE;
 FOR candidate IN
  SELECT DISTINCT dates.day::date attendance_date,e.employee_category,e.department
  FROM public.hr_employees e CROSS JOIN generate_series(from_date,to_date,interval '1 day') dates(day)
  WHERE e.active_status='Active' AND e.joining_date<=dates.day::date
   AND e.department IN ('SNP Factory','Fabric Factory')
   AND e.employee_category IN ('SNP Permanent Factory Labour','SNP Casual Factory Labour','Fabric Factory Permanent Employees','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers')
  ORDER BY 1,2,3
 LOOP
  PERFORM public.hr_attendance_lock_category(candidate.employee_category);
  SELECT * INTO sheet FROM public.hr_attendance_sheets
  WHERE attendance_date=candidate.attendance_date AND employee_category=candidate.employee_category
   AND (department=candidate.department OR department IS NULL) FOR UPDATE;
  IF FOUND THEN
   INSERT INTO uat_attendance_seed_result VALUES(sheet.id,candidate.attendance_date,candidate.employee_category,candidate.department,
    'EXISTING_UNCHANGED',(SELECT count(*) FROM public.hr_attendance_rows WHERE sheet_id=sheet.id));
   CONTINUE;
  END IF;
  SELECT * INTO sheet FROM public.populate_hr_attendance_sheet(candidate.attendance_date,candidate.employee_category,maker,candidate.department);
  IF EXISTS(SELECT 1 FROM public.hr_attendance_rows WHERE sheet_id=sheet.id AND
    (pay_rule_revision_id IS NULL OR (candidate.employee_category IN ('SNP Casual Factory Labour','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers') AND wage_revision_id IS NULL))) THEN
   RAISE EXCEPTION 'Effective pay/wage master missing for % on %; seed cancelled',candidate.employee_category,candidate.attendance_date;
  END IF;
  WITH facts AS (
   SELECT a.*,rule.standard_duty_hours,
    (('x'||substr(replace(a.employee_id::text,'-',''),1,2))::bit(8)::integer + (candidate.attendance_date-from_date)) pattern
   FROM public.hr_attendance_rows a JOIN public.hr_factory_pay_rule_revisions rule ON rule.id=a.pay_rule_revision_id WHERE a.sheet_id=sheet.id
  ), classifications AS (
   SELECT f.*,CASE WHEN leave_request_id IS NOT NULL THEN attendance_status WHEN mod(pattern,23)=0 THEN 'Absent' ELSE 'Present' END synthetic_status,
    CASE WHEN candidate.employee_category='Local Daily-Wage Workers' AND mod(pattern,19)=0 AND candidate.attendance_date<to_date THEN 'Double Duty'
     WHEN candidate.employee_category='Local Daily-Wage Workers' THEN 'Single Duty' END synthetic_duty
   FROM facts f
  ), hours AS (
   SELECT c.*,CASE WHEN synthetic_status<>'Present' THEN 0
    WHEN synthetic_duty='Double Duty' THEN standard_duty_hours*2
    ELSE standard_duty_hours+CASE WHEN mod(pattern,11)=0 AND candidate.attendance_date<to_date THEN 2 ELSE 0 END END duty_hours,
    (candidate.attendance_date + CASE WHEN candidate.employee_category='Local Daily-Wage Workers' THEN time '05:00' ELSE time '08:00' END) AT TIME ZONE 'Asia/Kolkata' started_at
   FROM classifications c
  )
  SELECT jsonb_agg(jsonb_build_object(
   'employee_id',employee_id,'attendance_status',synthetic_status,
   'entry_timestamp',CASE WHEN synthetic_status='Present' THEN to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
   'exit_timestamp',CASE WHEN synthetic_status='Present' THEN to_char((started_at+duty_hours*interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
   'duty_type',CASE WHEN synthetic_status='Present' THEN synthetic_duty END,
   'holiday_pay_eligible',false,'leave_request_id',leave_request_id,
   'remarks','[UAT TEST] Synthetic attendance; not an actual employee attendance record.'
  ) ORDER BY employee_id) INTO payload FROM hours;
  PERFORM public.save_hr_attendance_rows(sheet.id,payload,maker);
  IF EXISTS(SELECT 1 FROM public.hr_attendance_rows a JOIN public.hr_leave_requests l ON l.id=a.leave_request_id WHERE a.sheet_id=sheet.id AND l.approval_status<>'Approved') THEN
   INSERT INTO uat_attendance_seed_result VALUES(sheet.id,candidate.attendance_date,candidate.employee_category,candidate.department,'DRAFT_PENDING_LEAVE',jsonb_array_length(payload));
  ELSE
   PERFORM public.transition_hr_attendance_sheet(sheet.id,'submit','[UAT TEST] Synthetic attendance submitted for test payroll',maker);
   PERFORM public.transition_hr_attendance_sheet(sheet.id,'review','[UAT TEST] Simulated HO review for attendance/payroll testing',reviewer);
   INSERT INTO uat_attendance_seed_result VALUES(sheet.id,candidate.attendance_date,candidate.employee_category,candidate.department,'SEEDED_LOCKED',jsonb_array_length(payload));
  END IF;
 END LOOP;
END $$;

SELECT to_char(attendance_date,'YYYY-MM') attendance_month,employee_category,department,outcome,
 count(*) sheet_count,sum(employee_rows) employee_rows
FROM uat_attendance_seed_result GROUP BY 1,2,3,4 ORDER BY 1,3,2,4;
COMMIT;
