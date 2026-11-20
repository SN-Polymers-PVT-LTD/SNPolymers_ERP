-- Bound shared header/run fences to the source months (and prior-day
-- comp-off evidence). Immutable sheet identities cannot move an old header
-- into this window; employee fences still protect new attendance/run rows.
SET LOCAL search_path=public,extensions;

CREATE OR REPLACE FUNCTION public.payroll_lock_review_sources(p_employee_id uuid,p_run_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE key text; r public.payroll_runs%ROWTYPE; b uuid; bank uuid; lo date; hi date;
BEGIN
 -- Employee fence stabilizes history, profiles, leave, attendance rows, pay and
 -- monthly run membership before discovering their shared header/master scopes.
 PERFORM public.payroll_source_fence('employee:'||p_employee_id::text,true);
 PERFORM public.payroll_source_fence('run:'||p_run_id::text,true);
 SELECT * INTO r FROM public.payroll_runs WHERE id=p_run_id;
 lo:=date_trunc('month',r.period_from)::date;
 hi:=(date_trunc('month',r.period_to)+interval '1 month - 1 day')::date;
 FOR key IN
  SELECT 'sheet:'||a.sheet_id::text FROM public.hr_attendance_rows a JOIN public.hr_attendance_sheets s ON s.id=a.sheet_id
    WHERE a.employee_id=p_employee_id AND s.attendance_date BETWEEN lo-1 AND hi
  UNION SELECT 'run:'||run_id::text FROM public.payroll_run_employees
    WHERE employee_id=p_employee_id AND daterange(period_from,period_to,'[]') && daterange(lo,hi,'[]')
  UNION SELECT 'run:'||p_run_id::text
  UNION SELECT 'policy:ALL'
  UNION SELECT 'statutory'
  UNION SELECT 'policy:'||group_code FROM public.payroll_employee_assignments WHERE employee_id=p_employee_id
  UNION SELECT 'factory:'||employee_category FROM public.payroll_employee_assignments WHERE employee_id=p_employee_id
  UNION SELECT 'policy:'||r.group_code
  UNION SELECT 'calendar:'||r.group_code||':'||r.department||':'||to_char(m,'YYYY-MM')
    FROM generate_series(lo,hi,interval '1 month') m
  ORDER BY 1
 LOOP PERFORM public.payroll_source_fence(key,true); END LOOP;
 SELECT e.beneficiary_id,bm.beneficiary_bank_id INTO b,bank FROM public.hr_employees e LEFT JOIN public.beneficiary_master bm ON bm.id=e.beneficiary_id WHERE e.id=p_employee_id;
 IF b IS NOT NULL THEN
  PERFORM public.payroll_source_fence('beneficiary:'||b::text,true);
  -- Re-read bank identity after fencing the beneficiary: a committed bank-link
  -- change between initial read and acquisition must not evade the bank fence.
  SELECT beneficiary_bank_id INTO bank FROM public.beneficiary_master WHERE id=b;
  IF bank IS NOT NULL THEN PERFORM public.payroll_source_fence('bank:'||bank::text,true); END IF;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_lock_review_sources(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.payroll_source_write_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE images jsonb[]; image jsonb; keys text[]:='{}'; sheet_keys text[]:='{}'; key text; employee uuid;
BEGIN
 IF TG_OP='INSERT' THEN images:=ARRAY[to_jsonb(NEW)];
 ELSIF TG_OP='DELETE' THEN images:=ARRAY[to_jsonb(OLD)];
 ELSE images:=ARRAY[to_jsonb(OLD),to_jsonb(NEW)]; END IF;
 FOREACH image IN ARRAY images LOOP
  CASE TG_TABLE_NAME
  WHEN 'hr_attendance_sheets' THEN keys:=array_append(keys,'sheet:'||(image->>'id'));
  WHEN 'hr_attendance_rows' THEN
   keys:=array_append(keys,'employee:'||(image->>'employee_id'));
   -- Rows of OTHER employees on the same sheet can still be recorded together.
   -- A header change must coordinate with every referencing row writer.
   sheet_keys:=array_append(sheet_keys,'sheet:'||(image->>'sheet_id'));
  WHEN 'payroll_employee_statutory_profiles' THEN
   SELECT employee_id INTO employee FROM public.payroll_source_history_revisions WHERE id=(image->>'revision_id')::uuid;
   keys:=array_append(keys,'employee:'||employee::text);
  WHEN 'payroll_policy_master_revisions' THEN keys:=array_append(keys,'policy:'||coalesce(image->>'group_code','ALL'));
  WHEN 'hr_factory_wage_revisions','hr_factory_pay_rule_revisions' THEN keys:=array_append(keys,'factory:'||(image->>'employee_category'));
  WHEN 'payroll_work_calendar_days' THEN
   keys:=array_append(keys,'calendar:'||(image->>'group_code')||':'||(image->>'department')||':'||left(image->>'calendar_date',7));
  WHEN 'payroll_statutory_rule_revisions','payroll_statutory_scope_bindings','payroll_professional_tax_slabs' THEN
   -- Infrequent statutory configuration only; never an attendance/leave fence.
   -- Binding insertion must be fenced even before an applicable rule exists.
   keys:=array_append(keys,'statutory');
  WHEN 'payroll_runs' THEN keys:=array_append(keys,'run:'||(image->>'id'));
  WHEN 'beneficiary_master' THEN keys:=array_append(keys,'beneficiary:'||(image->>'id'));
  WHEN 'indian_bank_master' THEN keys:=array_append(keys,'bank:'||(image->>'id'));
  ELSE keys:=array_append(keys,'employee:'||(image->>'employee_id'));
  END CASE;
 END LOOP;
 FOR key IN SELECT DISTINCT unnest(keys) k ORDER BY k LOOP
  IF key IS NOT NULL THEN
   IF TG_TABLE_NAME IN ('hr_factory_wage_revisions','hr_factory_pay_rule_revisions') AND TG_OP='INSERT' THEN
    -- New immutable revisions have no existing operational tuple lock. Preserve
    -- the original serialized revision-number allocation for concurrent dates;
    -- finalization uses try/shared acquisition and cannot wait on this writer.
    PERFORM pg_advisory_xact_lock(hashtextextended('payroll_source:'||key,0));
   ELSE PERFORM public.payroll_source_fence(key,false); END IF;
  END IF;
 END LOOP;
 FOR key IN SELECT DISTINCT unnest(sheet_keys) k ORDER BY k LOOP
  IF key IS NOT NULL THEN PERFORM public.payroll_source_fence(key,true); END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_source_write_fence() FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
