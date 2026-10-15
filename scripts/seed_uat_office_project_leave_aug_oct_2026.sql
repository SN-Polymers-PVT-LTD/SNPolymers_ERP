-- Synthetic UAT office/project leave, 1 August–14 October 2026.
-- Uses each employee's linked active ERP identity, then a distinct Admin/HO
-- approves pay treatment via the normal RPC. Never changes existing leave.
-- Unlinked employees are reported; this script does not create ERP accounts.
BEGIN;
CREATE TEMP TABLE uat_office_leave_seed_result (
 employee_id uuid, employee_code text, scenario text, leave_id uuid,
 outcome text, from_date date, to_date date, pay_treatment text
) ON COMMIT DROP;
DO $$
DECLARE employee record; scenario record; reviewer uuid; leave_row public.hr_leave_requests%ROWTYPE;
 start_date date; end_date date; eligible_from date; preferred date; span integer;
 marker text; previous_count integer;
 window_from constant date:='2026-08-01'; window_to constant date:='2026-10-14';
BEGIN
 IF window_to>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Test leave cannot be seeded into future dates'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('uat_office_leave_aug_oct_2026',0));
 FOR employee IN
  SELECT e.id,e.employee_code,e.employee_category,e.joining_date,e.erp_user_id,u.role,u.is_active
  FROM public.hr_employees e LEFT JOIN public.authorised_users u ON u.id=e.erp_user_id
  WHERE e.active_status='Active' AND e.department IN ('Head Office','Projects')
   AND e.employee_category IN ('HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office')
  ORDER BY e.id FOR SHARE OF e
 LOOP
  IF employee.erp_user_id IS NULL OR NOT coalesce(employee.is_active,false)
   OR employee.role NOT IN ('admin','factory_manager','ho','je','zo','accounts') THEN
   INSERT INTO uat_office_leave_seed_result(employee_id,employee_code,outcome) VALUES(employee.id,employee.employee_code,'ERP_LINK_REQUIRED');
   CONTINUE;
  END IF;
  SELECT id INTO reviewer FROM public.authorised_users WHERE is_active AND role IN ('admin','ho') AND id<>employee.erp_user_id
   ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id LIMIT 1;
  IF reviewer IS NULL THEN RAISE EXCEPTION 'Independent active Admin/HO reviewer is required'; END IF;
  eligible_from:=greatest(window_from,employee.joining_date);span:=window_to-eligible_from+1;
  IF span<7 THEN RAISE EXCEPTION 'Insufficient employed days for four nonoverlapping test scenarios: %',employee.employee_code; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hr_leave:'||employee.id::text,0));
  FOR scenario IN SELECT * FROM (VALUES
   ('paid_single','Paid',1,0.10::numeric),('unpaid_single','Unpaid',1,0.30::numeric),
   ('paid_consecutive','Paid',2,0.55::numeric),('unpaid_consecutive','Unpaid',3,0.80::numeric)
  ) scenarios(code,treatment,days,position)
  LOOP
   marker:='[UAT TEST OFFICE LEAVE] '||scenario.code||' / 2026-08-01 through 2026-10-14';
   SELECT count(*) INTO previous_count FROM public.hr_leave_requests WHERE employee_id=employee.id AND reason=marker;
   IF previous_count>1 THEN RAISE EXCEPTION 'Duplicate test marker for % / %',employee.employee_code,scenario.code; END IF;
   IF previous_count=1 THEN
    SELECT * INTO leave_row FROM public.hr_leave_requests WHERE employee_id=employee.id AND reason=marker;
    IF leave_row.approval_status<>'Approved' OR leave_row.pay_treatment<>scenario.treatment THEN
     RAISE EXCEPTION 'Existing test leave needs manual review: % / %',employee.employee_code,scenario.code;
    END IF;
    INSERT INTO uat_office_leave_seed_result VALUES(employee.id,employee.employee_code,scenario.code,leave_row.id,'EXISTING_UNCHANGED',leave_row.from_date,leave_row.to_date,leave_row.pay_treatment);
    CONTINUE;
   END IF;
   preferred:=eligible_from+least(floor(span*scenario.position)::integer,span-scenario.days);
   SELECT candidate.day::date INTO start_date
   FROM generate_series(eligible_from,window_to-(scenario.days-1),interval '1 day') candidate(day)
   WHERE NOT EXISTS(SELECT 1 FROM public.hr_leave_requests existing WHERE existing.employee_id=employee.id
    AND daterange(existing.from_date,existing.to_date,'[]') && daterange(candidate.day::date,candidate.day::date+(scenario.days-1),'[]'))
   ORDER BY CASE WHEN candidate.day::date>=preferred THEN 0 ELSE 1 END,candidate.day LIMIT 1;
   IF start_date IS NULL THEN RAISE EXCEPTION 'No free date interval for % / %',employee.employee_code,scenario.code; END IF;
   end_date:=start_date+(scenario.days-1);
   SELECT * INTO leave_row FROM public.save_hr_leave_request(NULL,employee.id,'SELF_SERVICE',start_date,end_date,'Other Leave',marker,'Pending',employee.erp_user_id);
   SELECT * INTO leave_row FROM public.decide_hr_leave_request(leave_row.id,'Approved',scenario.treatment,
    '[UAT TEST] Simulated approval for paid/unpaid payroll testing; not actual leave.',reviewer);
   INSERT INTO uat_office_leave_seed_result VALUES(employee.id,employee.employee_code,scenario.code,leave_row.id,'SEEDED_APPROVED',leave_row.from_date,leave_row.to_date,leave_row.pay_treatment);
  END LOOP;
 END LOOP;
END $$;
SELECT * FROM uat_office_leave_seed_result ORDER BY employee_code,from_date,scenario;
COMMIT;
