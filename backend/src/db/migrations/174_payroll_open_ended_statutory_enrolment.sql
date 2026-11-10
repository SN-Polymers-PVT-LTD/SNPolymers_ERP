-- Open-ended pay applicability must participate in statutory approval checks.
-- Preserve category rules, missing-source fallback and historical financial records.
CREATE OR REPLACE FUNCTION public.payroll_category_scheme_applies(p_row_id uuid,p_scheme text,p_month date) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 SELECT CASE WHEN p_scheme='PT' THEN a.employee_category<>'Local Daily-Wage Workers'
 WHEN a.employee_category IN ('SNP Casual Factory Labour','Fabric Factory Casual Factory Labour','Local Daily-Wage Workers') THEN false
 ELSE coalesce((SELECT bool_or(CASE WHEN p_scheme='EPF' THEN p.epf_enrolment ELSE p.esi_enrolment END)
  FROM public.payroll_permanent_pay_applicability ap JOIN public.hr_permanent_pay_structures p ON p.id=ap.pay_structure_id
  WHERE ap.revision_id=(SELECT id FROM public.payroll_source_history_revisions WHERE employee_id=e.employee_id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1)
  AND ap.effective_from<=least(e.period_to,(p_month+interval '1 month -1 day')::date) AND (ap.effective_to IS NULL OR ap.effective_to>=greatest(e.period_from,p_month))),true) END
 FROM public.payroll_run_employees e JOIN public.payroll_employee_assignments a ON a.id=e.assignment_id WHERE e.id=p_row_id;
$$;
REVOKE ALL ON FUNCTION public.payroll_category_scheme_applies(uuid,text,date) FROM PUBLIC,anon,authenticated,service_role;
