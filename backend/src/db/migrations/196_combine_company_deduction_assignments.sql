-- Assign separate EPF/ESI and PT scopes in one versioned employee profile.
CREATE FUNCTION public.apply_payroll_company_deduction_setups(p_setup_id uuid,p_pt_setup_id uuid,p_from date,p_employees jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE c public.payroll_company_deduction_setups%ROWTYPE; pt public.payroll_company_deduction_setups%ROWTYPE; interval_data jsonb; s text; rules jsonb; owner_name text;
 evidence text:=coalesce(nullif(btrim(p_evidence),''),'Accounts employee deduction setup');
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT * INTO c FROM public.payroll_company_deduction_setups WHERE id=p_setup_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company deduction setup not found' USING ERRCODE='P0002'; END IF;
 pt := c;
 IF p_pt_setup_id IS NOT NULL THEN
  IF c.pt_revision_id IS NOT NULL OR (c.epf_revision_id IS NULL AND c.esi_revision_id IS NULL) THEN
   RAISE EXCEPTION 'Select a separate PT setup only with an EPF or ESI setup that has no PT rule' USING ERRCODE='22023';
  END IF;
  SELECT * INTO pt FROM public.payroll_company_deduction_setups WHERE id=p_pt_setup_id;
  IF NOT FOUND OR pt.pt_revision_id IS NULL OR pt.state_id IS NULL
   OR lower(btrim(pt.establishment_name))<>lower(btrim(c.establishment_name))
   OR (c.state_id IS NOT NULL AND pt.state_id<>c.state_id) THEN
   RAISE EXCEPTION 'Select a state-specific PT setup for the same establishment and applicable state' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_from IS NULL OR NOT isfinite(p_from) OR p_from<greatest(c.effective_from,pt.effective_from) OR p_from>least(c.effective_to,pt.effective_to) THEN
  RAISE EXCEPTION 'Employee start date must fall within the company setup dates' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[c.epf_revision_id,c.esi_revision_id,pt.pt_revision_id]) selected(id)
  LEFT JOIN public.payroll_statutory_rule_revisions r ON r.id=selected.id
  WHERE selected.id IS NOT NULL AND NOT public.payroll_statutory_components_supported(r.configuration)) THEN
  RAISE EXCEPTION 'Company setup uses retired or unsupported wage components. Create a setup with supported replacement rules.' USING ERRCODE='22023';
 END IF;
 -- Do not silently omit a scheme required by any selected employee.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x JOIN public.hr_employees e ON e.id=(x->>'employee_id')::uuid
 WHERE e.employee_category<>'Local Daily-Wage Workers' AND pt.pt_revision_id IS NULL) THEN RAISE EXCEPTION 'This setup needs a PT rule for the selected employees' USING ERRCODE='22023'; END IF;
 SELECT coalesce(nullif(display_name,''),'Accounts') INTO owner_name FROM public.authorised_users WHERE id=p_actor_id;
 rules:='{}';
 FOREACH s IN ARRAY ARRAY['EPF','ESI','PT'] LOOP
  rules:=rules||jsonb_build_object(s,jsonb_build_object('statutory_scope_id',CASE WHEN s='PT' THEN CASE WHEN pt.pt_revision_id IS NOT NULL THEN pt.statutory_scope_id END WHEN to_jsonb(c)->>(lower(s)||'_revision_id') IS NOT NULL THEN c.statutory_scope_id ELSE NULL END,'applicability','APPLICABLE','enrolled',null,'basis_reference',evidence));
 END LOOP;
 interval_data:=jsonb_build_object('effective_from',p_from,'effective_to',least(c.effective_to,pt.effective_to),'verification_status','ACCOUNTS_CONFIRMED',
 'advisor_name',owner_name,'verification_reference',evidence,'verified_on',(now() AT TIME ZONE 'Asia/Kolkata')::date,'schemes',rules);
 -- Existing RPC clips joining dates, derives enrolment, rejects stale versions and reports each employee independently.
 RETURN public.bulk_record_payroll_statutory_profiles(p_employees,interval_data,evidence,p_actor_id);
END; $$;

REVOKE ALL ON FUNCTION public.apply_payroll_company_deduction_setups(uuid,uuid,date,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payroll_company_deduction_setups(uuid,uuid,date,jsonb,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_payroll_company_deduction_setup(p_setup_id uuid,p_from date,p_employees jsonb,p_evidence text,p_actor_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,extensions AS $$
 SELECT public.apply_payroll_company_deduction_setups(p_setup_id,NULL,p_from,p_employees,p_evidence,p_actor_id);
$$;
