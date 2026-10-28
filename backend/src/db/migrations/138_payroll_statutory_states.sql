-- Shared states for statutory drafts. Legacy jurisdiction labels remain audit snapshots.
CREATE TABLE public.payroll_statutory_states(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120 AND name=btrim(name)),
 name_key text GENERATED ALWAYS AS(lower(regexp_replace(btrim(name),'\s+',' ','g'))) STORED UNIQUE,
 created_by uuid REFERENCES public.authorised_users(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_statutory_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_statutory_states FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.payroll_statutory_states(name) VALUES('Assam'),('Bihar'),('West Bengal'),('Odisha');
ALTER TABLE public.payroll_statutory_rule_revisions ADD COLUMN state_id uuid REFERENCES public.payroll_statutory_states(id);
CREATE FUNCTION public.get_payroll_statutory_states(p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM public.payroll_statutory_states),'[]');
END; $$;
CREATE FUNCTION public.register_payroll_statutory_state(p_name text,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; clean text:=regexp_replace(btrim(p_name),'\s+',' ','g');
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']);
 IF clean IS NULL OR length(clean) NOT BETWEEN 1 AND 120 OR clean !~ '^[[:alpha:]][[:alpha:] .-]*$' THEN RAISE EXCEPTION 'Enter a valid state name' USING ERRCODE='22023'; END IF;
 INSERT INTO public.payroll_statutory_states(name,created_by) VALUES(clean,p_actor_id) ON CONFLICT(name_key) DO NOTHING;
 SELECT jsonb_build_object('id',id,'name',name) INTO result FROM public.payroll_statutory_states WHERE name_key=lower(clean);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_payroll_statutory_states(uuid),public.register_payroll_statutory_state(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_statutory_states(uuid),public.register_payroll_statutory_state(text,uuid) TO service_role;
-- Existing validators still own all rate/slab/evidence checks. The new wrapper validates canonical state identity.
ALTER FUNCTION public.payroll_validate_master(text,jsonb) RENAME TO payroll_validate_master_before_states;
REVOKE ALL ON FUNCTION public.payroll_validate_master_before_states(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.payroll_validate_master(p_kind text,d jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF p_kind='statutory' AND d->>'state_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.payroll_statutory_states s WHERE s.id=(d->>'state_id')::uuid AND s.name=d->>'jurisdiction') THEN
  RAISE EXCEPTION 'Select a saved state matching the jurisdiction' USING ERRCODE='22023';
 END IF;
 RETURN public.payroll_validate_master_before_states(p_kind,CASE WHEN p_kind='statutory' THEN d-'state_id' ELSE d END);
END; $$;
REVOKE ALL ON FUNCTION public.payroll_validate_master(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.payroll_master_payload(k text,r jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d jsonb; BEGIN
 d:=r-ARRAY['id','status','version','revision_number','created_by','created_at','published_by','published_at','approval_reference','published_effective_to'];
 IF k='policies' THEN
  d:=d||jsonb_build_object('lop_fixed_divisor',CASE WHEN r->>'lop_fixed_divisor' IS NULL THEN NULL ELSE r->>'lop_fixed_divisor' END,
  'partial_month_fixed_divisor',CASE WHEN r->>'partial_month_fixed_divisor' IS NULL THEN NULL ELSE r->>'partial_month_fixed_divisor' END);
 ELSE
  d:=d||jsonb_build_object('slabs',coalesce((SELECT jsonb_agg(jsonb_build_object('month',month,'lower_bound',lower_bound::text,'upper_bound',upper_bound::text,'deduction_amount',deduction_amount::text) ORDER BY month,lower_bound)
    FROM public.payroll_professional_tax_slabs WHERE revision_id=(r->>'id')::uuid),'[]'::jsonb));
 END IF; IF k='statutory' AND d->>'state_id' IS NULL THEN d:=d-'state_id'; END IF; RETURN d;
END; $$;
CREATE FUNCTION public.payroll_link_draft_state() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF NEW.status='DRAFT' AND NEW.state_id IS NULL THEN
  SELECT id INTO NEW.state_id FROM public.payroll_statutory_states WHERE name=NEW.jurisdiction;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payroll_link_draft_state() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a10_payroll_draft_state BEFORE INSERT OR UPDATE ON public.payroll_statutory_rule_revisions FOR EACH ROW EXECUTE FUNCTION public.payroll_link_draft_state();
