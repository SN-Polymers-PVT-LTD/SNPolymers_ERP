-- An unbounded salary interval covers all dates from its effective start.
-- Preserve all authorization, enrolment, version and audit checks.
CREATE OR REPLACE FUNCTION public.record_payroll_statutory_profiles(p_employee_id uuid,p_expected_version integer,p_intervals jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE current_version integer; rid uuid; item jsonb; s text; detail jsonb;
 category text; pay public.hr_permanent_pay_structures%ROWTYPE; pay_revision uuid; from_date date; to_date date;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT employee_category INTO category FROM public.hr_employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(max(version),0) INTO current_version FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='STATUTORY_PROFILE';
 IF p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'Expected profile version required' USING ERRCODE='22023'; END IF;
 IF p_expected_version<>current_version THEN RAISE EXCEPTION 'Statutory profile history changed; reload before correcting' USING ERRCODE='PY409'; END IF;
 IF jsonb_typeof(p_intervals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_intervals) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Supply a complete profile timeline of 1 to 100 intervals' USING ERRCODE='22023'; END IF;
 INSERT INTO public.payroll_source_history_revisions(employee_id,source_kind,version,evidence_reference,created_by)
 VALUES(p_employee_id,'STATUTORY_PROFILE',current_version+1,p_evidence,p_actor_id) RETURNING id INTO rid;
 FOR item IN SELECT * FROM jsonb_array_elements(p_intervals) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('effective_from','effective_to','verification_status','advisor_name','verification_reference','verified_on','schemes'))
   OR jsonb_typeof(item->'schemes') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item->'schemes'))<>3
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(item->'schemes') k WHERE k NOT IN ('EPF','ESI','PT')) THEN RAISE EXCEPTION 'Invalid statutory profile interval' USING ERRCODE='22023'; END IF;
  -- Permanent/office enrolment is owned by Employee Management, never a second editable source.
  IF category IN ('HO Staff','Fabric Factory Permanent Employees','SNP Permanent Factory Labour','Zonal Office','Junior Engineer','Local project supervisor','Head office','Projects Department Employees') THEN
   from_date:=(item->>'effective_from')::date;to_date:=(item->>'effective_to')::date;
   SELECT id INTO pay_revision FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='PERMANENT_PAY' ORDER BY version DESC LIMIT 1;
   IF pay_revision IS NOT NULL THEN
    SELECT p.* INTO pay FROM public.payroll_permanent_pay_applicability a JOIN public.hr_permanent_pay_structures p ON p.id=a.pay_structure_id
     WHERE a.revision_id=pay_revision AND daterange(a.effective_from,a.effective_to,'[]') @> from_date AND p.status<>'Draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee Management pay source does not cover profile start date' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.payroll_permanent_pay_applicability a JOIN public.hr_permanent_pay_structures p ON p.id=a.pay_structure_id
     WHERE a.revision_id=pay_revision AND daterange(a.effective_from,a.effective_to,'[]') && daterange(from_date,to_date,'[]')
      AND (p.epf_enrolment,p.esi_enrolment) IS DISTINCT FROM (pay.epf_enrolment,pay.esi_enrolment)) THEN
     RAISE EXCEPTION 'Pay-structure enrolment changes within interval; split the statutory interval at the change' USING ERRCODE='22023';
    END IF;
   ELSE
    SELECT * INTO pay FROM public.hr_permanent_pay_structures WHERE employee_id=p_employee_id AND status='Active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Configure Employee Management pay structure before statutory setup' USING ERRCODE='22023'; END IF;
   END IF;
   item:=jsonb_set(jsonb_set(item,'{schemes,EPF,enrolled}',to_jsonb(pay.epf_enrolment)),'{schemes,ESI,enrolled}',to_jsonb(pay.esi_enrolment));
  END IF;
  FOREACH s IN ARRAY ARRAY['EPF','ESI','PT'] LOOP
   item:=jsonb_set(item,ARRAY['schemes',s,'applicability'],to_jsonb(CASE
    WHEN s='PT' AND category<>'Local Daily-Wage Workers' THEN 'APPLICABLE'
    WHEN s='EPF' AND pay.epf_enrolment IS TRUE THEN 'APPLICABLE'
    WHEN s='ESI' AND pay.esi_enrolment IS TRUE THEN 'APPLICABLE' ELSE 'NOT_APPLICABLE' END));
   IF s<>'PT' AND category NOT IN ('HO Staff','Fabric Factory Permanent Employees','SNP Permanent Factory Labour','Zonal Office','Junior Engineer','Local project supervisor','Head office','Projects Department Employees') THEN
    item:=jsonb_set(item,ARRAY['schemes',s,'enrolled'],'false'::jsonb);
   END IF;
   IF item->'schemes'->s->>'applicability'='NOT_APPLICABLE' THEN item:=jsonb_set(item,ARRAY['schemes',s,'statutory_scope_id'],'null'::jsonb); END IF;
  END LOOP;
  IF (item->>'verified_on')::date>(now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Verification cannot be future dated' USING ERRCODE='22023'; END IF;
  FOREACH s IN ARRAY ARRAY['EPF','ESI','PT'] LOOP
   detail:=item->'schemes'->s;
   IF jsonb_typeof(detail) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(detail) k WHERE k NOT IN ('statutory_scope_id','applicability','enrolled','basis_reference'))
    OR jsonb_typeof(detail->'enrolled') IS NULL OR jsonb_typeof(detail->'enrolled') NOT IN ('boolean','null') THEN RAISE EXCEPTION 'Invalid scheme profile' USING ERRCODE='22023'; END IF;
   INSERT INTO public.payroll_employee_statutory_profiles(revision_id,employee_id,scheme,statutory_scope_id,effective_from,effective_to,applicability,enrolled,basis_reference,verification_status,advisor_name,verification_reference,verified_on)
   VALUES(rid,p_employee_id,s,(detail->>'statutory_scope_id')::uuid,(item->>'effective_from')::date,(item->>'effective_to')::date,detail->>'applicability',(detail->>'enrolled')::boolean,detail->>'basis_reference',item->>'verification_status',item->>'advisor_name',item->>'verification_reference',(item->>'verified_on')::date);
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('revision_id',rid,'version',current_version+1,'financial_workflows_enabled',false);
END; $$;
NOTIFY pgrst,'reload schema';
