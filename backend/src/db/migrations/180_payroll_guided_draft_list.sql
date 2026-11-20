CREATE FUNCTION public.list_payroll_guided_deduction_drafts(p_actor_id uuid, p_page integer, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id, ARRAY['accounts']);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Invalid draft pagination' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_build_object(
  'drafts', coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY updated_at DESC, id)
    FROM (SELECT d.id,d.data->>'establishment' AS establishment,s.name AS state_name,d.updated_at
     FROM public.payroll_guided_deduction_drafts d
     LEFT JOIN public.payroll_statutory_states s ON s.id::text=d.data->>'state_id'
     WHERE d.publication IS NULL ORDER BY d.updated_at DESC,d.id LIMIT p_limit OFFSET (p_page-1)*p_limit) page), '[]'::jsonb),
  'total', (SELECT count(*) FROM public.payroll_guided_deduction_drafts WHERE publication IS NULL),
  'page', p_page, 'limit', p_limit) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.list_payroll_guided_deduction_drafts(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_payroll_guided_deduction_drafts(uuid,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
