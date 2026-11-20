-- Preview employee assignment dates and recheck the confirmed dates before writing.
CREATE FUNCTION public.review_company_deduction_assignment_dates(
 p_setup_id uuid,p_pt_setup_id uuid,p_from date,p_employees jsonb,p_evidence text,p_confirmed_dates jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE employee public.hr_employees%ROWTYPE; item jsonb; pay_revision uuid;
 requested date; proposed date; first_pay date; ends date; issue text;
 proposals jsonb := '[]'; dates jsonb := '{}'; results jsonb := '[]'; batch record;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF p_from IS NULL OR NOT isfinite(p_from) OR jsonb_typeof(p_employees) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_employees) NOT BETWEEN 1 AND 100
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x
       WHERE x->>'employee_id' IS NULL OR x->'expected_version' IS DISTINCT FROM '0'::jsonb)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x GROUP BY x->>'employee_id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Select a valid date and unique employees with no existing setup' USING ERRCODE='22023';
 END IF;
 SELECT min(effective_to) INTO ends FROM public.payroll_company_deduction_setups
 WHERE id IN (p_setup_id,p_pt_setup_id);
 IF NOT EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups WHERE id=p_setup_id)
    OR (p_pt_setup_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups WHERE id=p_pt_setup_id))
    OR EXISTS(SELECT 1 FROM public.payroll_company_deduction_setups WHERE id IN (p_setup_id,p_pt_setup_id)
      AND (effective_from>p_from OR effective_to<p_from)) THEN
  RAISE EXCEPTION 'Employee start date must fall within the selected company setup dates' USING ERRCODE='22023';
 END IF;
 IF p_confirmed_dates IS NOT NULL THEN
  PERFORM 1 FROM public.hr_employees WHERE id IN
    (SELECT (x->>'employee_id')::uuid FROM jsonb_array_elements(p_employees) x)
   ORDER BY id FOR UPDATE;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_employees) LOOP
  SELECT * INTO employee FROM public.hr_employees WHERE id=(item->>'employee_id')::uuid;
  requested := greatest(p_from,employee.joining_date);
  proposed := requested;
  first_pay := NULL;
  issue := NULL;
  IF NOT FOUND OR employee.active_status<>'Active' THEN
   issue := 'Employee is no longer active or available.';
  ELSIF employee.employee_category IN ('HO Staff','Fabric Factory Permanent Employees','SNP Permanent Factory Labour',
    'Zonal Office','Junior Engineer','Local project supervisor','Head office','Projects Department Employees') THEN
   SELECT id INTO pay_revision FROM public.payroll_source_history_revisions
    WHERE employee_id=employee.id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1;
   IF pay_revision IS NOT NULL THEN
    SELECT min(a.effective_from) INTO first_pay FROM public.payroll_permanent_pay_applicability a
      JOIN public.hr_permanent_pay_structures p ON p.id=a.pay_structure_id
      WHERE a.revision_id=pay_revision AND p.status<>'Draft';
    proposed := greatest(requested,first_pay);
    IF NOT EXISTS(SELECT 1 FROM public.payroll_permanent_pay_applicability a
      JOIN public.hr_permanent_pay_structures p ON p.id=a.pay_structure_id
      WHERE a.revision_id=pay_revision AND p.status<>'Draft'
        AND daterange(a.effective_from,a.effective_to,'[]') @> proposed) THEN
     issue := 'Salary history does not cover this start date.';
    END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM public.hr_permanent_pay_structures WHERE employee_id=employee.id AND status='Active') THEN
    issue := 'Set up an active salary structure in Employee Management first.';
   END IF;
  END IF;
  IF proposed>ends THEN issue := 'The proposed date is after the selected setup ends.'; END IF;
  proposals := proposals || jsonb_build_array(jsonb_build_object('employee_id',item->>'employee_id',
    'requested_from',requested,'effective_from',proposed,'pay_from',first_pay,'issue',issue));
  dates := dates || jsonb_build_object(item->>'employee_id',proposed);
 END LOOP;
 IF p_confirmed_dates IS NULL THEN RETURN jsonb_build_object('proposals',proposals,'dates',dates); END IF;
 IF dates IS DISTINCT FROM p_confirmed_dates OR EXISTS(SELECT 1 FROM jsonb_array_elements(proposals) x WHERE x->>'issue' IS NOT NULL) THEN
  RAISE EXCEPTION 'Employee start dates or pay history changed. Review the proposed dates again.' USING ERRCODE='PY409';
 END IF;
 FOR batch IN SELECT (dates->>(x->>'employee_id'))::date AS starts,jsonb_agg(x) AS employees
   FROM jsonb_array_elements(p_employees) x GROUP BY 1 ORDER BY 1 LOOP
  results := results || (public.apply_payroll_company_deduction_setups(
   p_setup_id,p_pt_setup_id,batch.starts,batch.employees,p_evidence,p_actor_id)->'results');
 END LOOP;
 RETURN jsonb_build_object('results',results,'success',NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(results) r WHERE r->>'success'='false'));
END; $$;
REVOKE ALL ON FUNCTION public.review_company_deduction_assignment_dates(uuid,uuid,date,jsonb,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_company_deduction_assignment_dates(uuid,uuid,date,jsonb,text,jsonb,uuid) TO service_role;
