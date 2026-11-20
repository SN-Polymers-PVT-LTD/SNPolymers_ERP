-- Accounts can resume a previously saved guided setup draft.
CREATE FUNCTION public.get_payroll_guided_deduction_draft(p_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 SELECT to_jsonb(d) INTO result FROM public.payroll_guided_deduction_drafts d WHERE id=p_id;
 IF result IS NULL THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_payroll_guided_deduction_draft(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_guided_deduction_draft(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
