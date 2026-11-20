-- Client decision: new employee pay setup records agreed gross only. Component
-- amounts on historical revisions remain immutable evidence, not editable inputs.
ALTER FUNCTION public.create_hr_pay_structure(uuid,text,numeric,numeric,numeric,numeric,boolean,boolean,text,uuid)
 RENAME TO hr_create_legacy_pay_structure;
REVOKE ALL ON FUNCTION public.hr_create_legacy_pay_structure(uuid,text,numeric,numeric,numeric,numeric,boolean,boolean,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.create_hr_pay_structure(p_employee_id uuid,p_pay_basis text,p_guaranteed_monthly_gross numeric,
 p_epf_enrolment boolean,p_esi_enrolment boolean,p_status text,p_actor_id uuid)
RETURNS public.hr_permanent_pay_structures LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM public.hr_attendance_require_actor(p_actor_id,ARRAY['admin']);
 RETURN public.hr_create_legacy_pay_structure(p_employee_id,p_pay_basis,p_guaranteed_monthly_gross,
  NULL,NULL,NULL,p_epf_enrolment,p_esi_enrolment,p_status,p_actor_id);
END; $$;
REVOKE ALL ON FUNCTION public.create_hr_pay_structure(uuid,text,numeric,boolean,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_hr_pay_structure(uuid,text,numeric,boolean,boolean,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
