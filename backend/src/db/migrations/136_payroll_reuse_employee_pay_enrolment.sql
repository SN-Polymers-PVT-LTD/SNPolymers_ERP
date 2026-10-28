-- Employee Management owns permanent/office enrolment. Historical profiles remain immutable.
CREATE OR REPLACE FUNCTION public.record_payroll_statutory_profiles(p_employee_id uuid,p_expected_version integer,p_intervals jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE current_version integer; rid uuid; item jsonb; s text; detail jsonb;
 category text; pay public.hr_permanent_pay_structures%ROWTYPE; pay_revision uuid; from_date date; to_date date;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
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
     WHERE a.revision_id=pay_revision AND from_date BETWEEN a.effective_from AND a.effective_to AND p.status<>'Draft';
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

CREATE OR REPLACE FUNCTION public.get_payroll_statutory_profiles(p_employee_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 IF NOT EXISTS(SELECT 1 FROM public.hr_employees WHERE id=p_employee_id) THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 WITH intervals AS (
  SELECT revision_id,effective_from,effective_to,verification_status,advisor_name,verification_reference,verified_on,
   jsonb_object_agg(scheme,jsonb_build_object('statutory_scope_id',statutory_scope_id,'applicability',applicability,'enrolled',enrolled,'basis_reference',basis_reference)) schemes
  FROM public.payroll_employee_statutory_profiles WHERE employee_id=p_employee_id
  GROUP BY revision_id,effective_from,effective_to,verification_status,advisor_name,verification_reference,verified_on
 ) SELECT jsonb_build_object('employee_id',p_employee_id,'version',coalesce(max(h.version),0),
  'revisions',coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('intervals',(SELECT jsonb_agg(to_jsonb(i)-'revision_id' ORDER BY effective_from) FROM intervals i WHERE i.revision_id=h.id)) ORDER BY h.version),'[]'),
  'enrolment_managed_by_pay_structure',(SELECT employee_category IN ('HO Staff','Fabric Factory Permanent Employees','SNP Permanent Factory Labour','Zonal Office','Junior Engineer','Local project supervisor','Head office','Projects Department Employees') FROM public.hr_employees WHERE id=p_employee_id),'financial_workflows_enabled',false) INTO result FROM public.payroll_source_history_revisions h WHERE h.employee_id=p_employee_id AND h.source_kind='STATUTORY_PROFILE';
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.bulk_record_payroll_statutory_profiles(p_employees jsonb,p_interval jsonb,p_evidence text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE item jsonb; employee public.hr_employees%ROWTYPE; profile jsonb; saved jsonb; results jsonb:='[]';
 start_date date; end_date date; code text; detail text; status_code integer;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts']);
 IF p_employees IS NULL OR jsonb_typeof(p_employees)<>'array' OR jsonb_array_length(p_employees) NOT BETWEEN 1 AND 100
  OR p_interval IS NULL OR jsonb_typeof(p_interval)<>'object' OR p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 2000 THEN
  RAISE EXCEPTION 'Supply 1–100 selected employees, a common interval and evidence' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x WHERE jsonb_typeof(x)<>'object'
  OR NOT x ? 'employee_id' OR NOT x ? 'expected_version' OR x->'expected_version'<>'0'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('employee_id','expected_version')))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_employees) x GROUP BY x->>'employee_id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Bulk setup accepts unique employees with no existing profile (expected version 0)' USING ERRCODE='22023';
 END IF;
 start_date:=(p_interval->>'effective_from')::date;end_date:=(p_interval->>'effective_to')::date;
 IF start_date IS NULL OR NOT isfinite(start_date) OR (end_date IS NOT NULL AND (NOT isfinite(end_date) OR end_date<start_date)) THEN
  RAISE EXCEPTION 'Invalid common effective interval' USING ERRCODE='22023';
 END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_employees) ORDER BY value->>'employee_id' LOOP
  BEGIN
   SELECT * INTO employee FROM public.hr_employees WHERE id=(item->>'employee_id')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
   IF employee.active_status<>'Active' THEN RAISE EXCEPTION 'Employee is no longer active; refresh selection' USING ERRCODE='PY409'; END IF;
   IF end_date IS NOT NULL AND employee.joining_date>end_date THEN
    RAISE EXCEPTION 'Employee joined after the selected interval' USING ERRCODE='22023';
   END IF;
   profile:=jsonb_set(p_interval,'{effective_from}',to_jsonb(greatest(start_date,employee.joining_date)::text));
   -- Reuse the audited, version-checked, canonical-scope-checked write path.
   saved:=public.record_payroll_statutory_profiles(employee.id,0,jsonb_build_array(profile),p_evidence,p_actor_id);
   results:=results||jsonb_build_array(jsonb_build_object('employee_id',employee.id,'success',true,'status',201,'effective_from',profile->>'effective_from','result',saved));
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,detail=MESSAGE_TEXT;
   status_code:=CASE WHEN code='42501' THEN 403 WHEN code='P0002' THEN 404 WHEN code IN ('PY409','23505','23P01','40P01','40001') THEN 409
    WHEN code IN ('22023','22P02','23503','23514','23502','22007','22008') THEN 400 ELSE 500 END;
   results:=results||jsonb_build_array(jsonb_build_object('employee_id',item->>'employee_id','success',false,'status',status_code,'code',code,
    'message',CASE WHEN status_code=500 THEN 'Employee profile setup failed' ELSE detail END));
  END;
 END LOOP;
 RETURN jsonb_build_object('results',results,'success',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(results) r WHERE r->>'success'='false'));
END; $$;
REVOKE ALL ON FUNCTION public.bulk_record_payroll_statutory_profiles(jsonb,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_record_payroll_statutory_profiles(jsonb,jsonb,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
