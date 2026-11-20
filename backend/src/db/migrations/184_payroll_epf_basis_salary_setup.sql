ALTER TABLE public.payroll_epf_wage_bases ADD COLUMN pending_accounts_confirmation boolean NOT NULL DEFAULT false;

-- HR records the wage breakdown with the salary. Accounts confirms it separately.
DO $patch$
DECLARE def text; target text;
BEGIN
 SELECT pg_get_functiondef('public.save_hr_payroll_salary(uuid,uuid,date,integer,jsonb,text,uuid)'::regprocedure) INTO def;
 target := 'DECLARE e public.hr_employees';
 IF strpos(def,target)=0 THEN RAISE EXCEPTION 'Salary declaration patch target missing'; END IF;
 def:=replace(def,target,'DECLARE epf_basis jsonb; regular numeric; e public.hr_employees');
 target := ' IF p_existing_id IS NOT NULL THEN' || chr(10) || '  IF p_pay IS NOT NULL';
 IF strpos(def,target)=0 THEN RAISE EXCEPTION 'Salary input patch target missing'; END IF;
 def:=replace(def,target,$code$
 epf_basis := p_pay->'epf_wage_basis';
 IF epf_basis IS NOT NULL THEN
  IF (p_pay->>'epf_enrolment') IS DISTINCT FROM 'true' OR p_from<DATE '2025-12-01'
     OR jsonb_typeof(epf_basis) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'EPF wage basis requires an enrolled salary from December 2025 onward' USING ERRCODE='22023';
  END IF;
  IF epf_basis='{"kind":"FULL_GROSS"}'::jsonb THEN
   regular := (p_pay->>'guaranteed_monthly_gross')::numeric;
  ELSIF epf_basis->>'kind'='REGULAR_WAGES' AND epf_basis ? 'amount'
        AND epf_basis-ARRAY['kind','amount']='{}'::jsonb
        AND coalesce(epf_basis->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' THEN
   regular := (epf_basis->>'amount')::numeric;
  ELSE
   RAISE EXCEPTION 'Choose the full gross or enter regular EPF wages' USING ERRCODE='22023';
  END IF;
  IF regular>(p_pay->>'guaranteed_monthly_gross')::numeric THEN
   RAISE EXCEPTION 'Regular EPF wages cannot exceed monthly gross' USING ERRCODE='22023';
  END IF;
  p_pay := p_pay-'epf_wage_basis';
 END IF;
 IF p_existing_id IS NOT NULL THEN
  IF p_pay IS NOT NULL$code$);
 target := ' PERFORM public.record_payroll_source_history(p_employee_id,''PERMANENT_PAY'',intervals,p_reason,p_actor_id);';
 IF strpos(def,target)=0 THEN RAISE EXCEPTION 'Salary history patch target missing'; END IF;
 EXECUTE replace(def,target,target||$code$
 IF epf_basis IS NOT NULL THEN
  INSERT INTO public.payroll_epf_wage_bases(employee_id,pay_structure_id,effective_from,regular_wages,reason,confirmed_by,pending_accounts_confirmation)
  VALUES(p_employee_id,salary.id,date_trunc('month',p_from)::date,regular,btrim(p_reason),p_actor_id,true);
 END IF;$code$);

 SELECT pg_get_functiondef('public.get_payroll_preview_sources(uuid,uuid)'::regprocedure) INTO def;
 target := 'to_jsonb(b)-ARRAY[''reason'',''confirmed_by'',''confirmed_at'']';
 IF strpos(def,target)=0 THEN RAISE EXCEPTION 'EPF source patch target missing'; END IF;
 EXECUTE replace(def,target,'(to_jsonb(b)-ARRAY[''reason'',''confirmed_by'',''confirmed_at'',''pending_accounts_confirmation'']) || CASE WHEN b.pending_accounts_confirmation THEN ''{"pending_accounts_confirmation":true}''::jsonb ELSE ''{}''::jsonb END');
END $patch$;

CREATE FUNCTION public.confirm_payroll_epf_wage_basis(p_employee_id uuid,p_pay_structure_id uuid,p_effective_from date,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE basis public.payroll_epf_wage_bases%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 PERFORM public.payroll_source_fence('employee:'||p_employee_id::text,false);
 SELECT * INTO basis FROM public.payroll_epf_wage_bases b WHERE b.employee_id=p_employee_id AND b.pay_structure_id=p_pay_structure_id AND b.effective_from=p_effective_from;
 IF NOT FOUND THEN RAISE EXCEPTION 'EPF wage basis not found' USING ERRCODE='P0002'; END IF;
 IF basis.pending_accounts_confirmation THEN
  IF EXISTS (SELECT 1 FROM public.payroll_employee_coverage c WHERE c.employee_id=p_employee_id AND c.period_to>=p_effective_from)
  THEN RAISE EXCEPTION 'Payroll already locked for this period' USING ERRCODE='PY409'; END IF;
  UPDATE public.payroll_epf_wage_bases SET pending_accounts_confirmation=false,confirmed_by=p_actor_id,confirmed_at=now()
  WHERE employee_id=p_employee_id AND pay_structure_id=p_pay_structure_id AND effective_from=p_effective_from;
 END IF;
 RETURN public.get_payroll_epf_wage_bases(p_employee_id,p_actor_id);
END $$;
REVOKE ALL ON FUNCTION public.confirm_payroll_epf_wage_basis(uuid,uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_payroll_epf_wage_basis(uuid,uuid,date,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
