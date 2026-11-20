-- Allow a blank approval reference in guided publication while keeping downstream audit evidence.
CREATE OR REPLACE FUNCTION public.publish_payroll_guided_deduction_draft(
 p_id uuid,p_expected_version integer,p_initial boolean,p_review_token text,p_reference text,p_key uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE
 draft public.payroll_guided_deduction_drafts%ROWTYPE;
 request jsonb;
 review jsonb;
 result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF p_key IS NULL OR p_review_token IS NULL OR p_review_token !~ '^[a-f0-9]{64}$'
    OR length(btrim(p_reference))>2000 THEN
  RAISE EXCEPTION 'Valid review token, retry key and reference length required' USING ERRCODE='22023';
 END IF;
 SELECT * INTO draft FROM public.payroll_guided_deduction_drafts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002'; END IF;
 p_reference := nullif(btrim(p_reference),'');
 request := jsonb_build_array(p_expected_version,p_initial,p_review_token,btrim(p_reference));
 IF draft.publication IS NOT NULL THEN
  IF draft.published_by=p_actor_id AND draft.publication_key=p_key AND draft.publication->'request'=request THEN
   RETURN draft.publication->'result';
  END IF;
  RAISE EXCEPTION 'This guided setup is already published' USING ERRCODE='PY409';
 END IF;
 review := public.review_payroll_guided_deduction_draft(p_id,p_expected_version,p_initial,p_actor_id);
 IF review->>'review_token' IS DISTINCT FROM p_review_token THEN
  RAISE EXCEPTION 'Setup changed. Review again.' USING ERRCODE='PY409';
 END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_guided_deduction_drafts d WHERE d.published_by=p_actor_id AND d.publication_key=p_key) THEN
  RAISE EXCEPTION 'Retry key already used for another publication' USING ERRCODE='PY409';
 END IF;
 result := public.run_payroll_guided_publication(draft.data,p_initial,
    coalesce(p_reference,'Guided Accounts publication (no approval reference supplied)'),p_actor_id);
 IF (result->>'publishable')::boolean IS NOT TRUE THEN
  RAISE EXCEPTION 'Setup changed. Review again.' USING ERRCODE='PY409';
 END IF;
 result := jsonb_build_object('draft_id',p_id,'version',draft.version,'setup',result->'setup','setups',result->'setups');
 UPDATE public.payroll_guided_deduction_drafts
 SET published_by=p_actor_id,publication_key=p_key,publication=jsonb_build_object('request',request,'result',result)
 WHERE id=p_id;
 RETURN result;
END; $$;

