-- Client decision: active Factory Managers may access payroll for both factories.
-- Remove the separate payroll grant lifecycle; retain department/role boundaries,
-- preparer ownership and independent Accounts/HO review in the existing RPCs.
CREATE OR REPLACE FUNCTION public.payroll_require_scope(p_actor_id uuid,p_department text,p_write boolean) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE v_role text;
BEGIN
 v_role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','ho','accounts','factory_manager']);
 IF v_role='admin' OR (NOT p_write AND v_role IN ('ho','accounts'))
   OR (p_write AND v_role='accounts' AND p_department IN ('Head Office','Projects'))
   OR (v_role='factory_manager' AND p_department IN ('SNP Factory','Fabric Factory')) THEN RETURN; END IF;
 RAISE EXCEPTION 'Payroll factory/department access denied' USING ERRCODE='42501';
END; $$;

CREATE OR REPLACE FUNCTION public.get_payroll_foundation_context(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_role text;
BEGIN
 v_role:=public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 RETURN jsonb_build_object('groups',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object('department',d.department) ORDER BY g.code,d.department)
  FROM public.payroll_groups g JOIN public.payroll_group_departments d ON d.group_code=g.code
  WHERE v_role<>'factory_manager' OR (g.is_factory AND d.department IN ('SNP Factory','Fabric Factory'))),'[]'::jsonb),
  'financial_workflows_enabled',false);
END; $$;

DROP TRIGGER payroll_revoke_factory_grants ON public.authorised_users;
DROP FUNCTION public.payroll_revoke_factory_grants();
DROP FUNCTION public.set_payroll_factory_scope(uuid,text,boolean,text,uuid);
DROP TABLE public.payroll_factory_scope_events;

-- CREATE OR REPLACE preserves existing ACLs; explicitly retain least privilege.
REVOKE ALL ON FUNCTION public.payroll_require_scope(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_payroll_foundation_context(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_foundation_context(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
