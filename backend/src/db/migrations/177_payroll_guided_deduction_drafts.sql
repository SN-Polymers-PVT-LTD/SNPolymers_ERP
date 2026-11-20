-- Guided drafts do not publish statutory rules or affect payroll.
CREATE TABLE public.payroll_guided_deduction_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id),
 updated_by uuid NOT NULL REFERENCES public.authorised_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_guided_deduction_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_guided_deduction_drafts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.save_payroll_guided_deduction_draft(p_id uuid, p_expected_version integer, p_data jsonb, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result public.payroll_guided_deduction_drafts%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR p_expected_version IS NULL OR p_expected_version < 0 THEN
  RAISE EXCEPTION 'Invalid draft or expected version' USING ERRCODE='22023';
 END IF;
 IF p_id IS NULL THEN
  IF p_expected_version <> 0 THEN RAISE EXCEPTION 'New draft version must be zero' USING ERRCODE='PY409'; END IF;
  INSERT INTO public.payroll_guided_deduction_drafts(data,created_by,updated_by) VALUES(p_data,p_actor_id,p_actor_id) RETURNING * INTO result;
 ELSE
  UPDATE public.payroll_guided_deduction_drafts SET data=p_data, version=version+1, updated_by=p_actor_id, updated_at=now()
   WHERE id=p_id AND version=p_expected_version RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft missing or changed; reload before saving' USING ERRCODE='PY409'; END IF;
 END IF;
 RETURN to_jsonb(result);
END; $$;
REVOKE ALL ON FUNCTION public.save_payroll_guided_deduction_draft(uuid,integer,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_payroll_guided_deduction_draft(uuid,integer,jsonb,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
