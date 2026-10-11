-- Forward-only review-read recovery; financial and transition guards are unchanged.
CREATE OR REPLACE FUNCTION public.get_payroll_employee_review(p_row_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees%ROWTYPE; result jsonb; src jsonb; source_error jsonb; d text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','accounts','ho','factory_manager']);
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payroll employee row not found' USING ERRCODE='P0002'; END IF;
 -- Authorize metadata independently of preview availability. Authorization
 -- errors are never converted to recoverable source errors.
 PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=e.run_id),false);
 -- Historical salary evidence is subject to scope too, including a former
 -- factory in a previous submission that the current assignment no longer lists.
 FOR d IN SELECT DISTINCT x->>'department' FROM public.payroll_review_revisions v,
  LATERAL jsonb_array_elements(coalesce(v.source_snapshot->'assignments','[]')||coalesce(v.source_snapshot->'attendance','[]')) x
  WHERE v.row_id=e.id AND x->>'department' IS NOT NULL LOOP
  PERFORM public.payroll_require_scope(p_actor_id,d,false);
 END LOOP;
 -- Invalid source parameters (including oversized legacy periods) must not
 -- hide the metadata needed to correct or withdraw the employee row.
 BEGIN
  src:=public.payroll_review_source_snapshot(p_row_id,p_actor_id);
 EXCEPTION WHEN invalid_parameter_value THEN
  source_error:=jsonb_build_object('code','PAYROLL_SOURCE_UNAVAILABLE','sqlstate',SQLSTATE,'message',SQLERRM);
 END;
 SELECT jsonb_build_object('row',to_jsonb(e),'run',(SELECT to_jsonb(r)||jsonb_build_object('container_status',r.status,'status',public.payroll_review_progress(r.id)->'status') FROM public.payroll_runs r WHERE r.id=e.run_id),
  'employee_self',(SELECT coalesce(erp_user_id=p_actor_id,false) FROM public.hr_employees WHERE id=e.employee_id),
  'source',src,'source_error',source_error,'progress',public.payroll_review_progress(e.run_id),
  'revisions',coalesce((SELECT jsonb_agg(to_jsonb(v)-ARRAY['source_snapshot','source_token'] ORDER BY revision) FROM public.payroll_review_revisions v WHERE row_id=e.id),'[]'),
  'content_versions',coalesce((SELECT jsonb_agg(jsonb_build_object('version',version,'note',note,'created_by',created_by,'created_at',created_at) ORDER BY version) FROM public.payroll_row_versions WHERE row_id=e.id),'[]'),
  'actions',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.payroll_action_history a WHERE row_id=e.id),'[]'),
  'financial_finalization_enabled',false,'payment_status','NOT_ELIGIBLE') INTO result;
 RETURN result;
END; $$;
