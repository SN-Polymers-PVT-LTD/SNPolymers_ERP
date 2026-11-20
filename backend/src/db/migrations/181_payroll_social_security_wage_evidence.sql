-- Monthly amounts are classified by Accounts from actual pay, including applicable
-- factory earnings. They are independent of the contractual gross in HR.
CREATE TABLE public.payroll_social_security_wage_evidence (
 employee_id uuid NOT NULL REFERENCES public.hr_employees(id),
 wage_month date NOT NULL CHECK (isfinite(wage_month) AND extract(day FROM wage_month)=1 AND wage_month >= DATE '2025-12-01'),
 remuneration numeric(14,2) NOT NULL CHECK (remuneration BETWEEN 0 AND 999999999999.99),
 wages_before_addback numeric(14,2) NOT NULL CHECK (wages_before_addback BETWEEN 0 AND remuneration),
 excluded_for_addback numeric(14,2) NOT NULL CHECK (excluded_for_addback BETWEEN 0 AND remuneration-wages_before_addback),
 evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 2000),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 confirmed_by uuid NOT NULL REFERENCES public.authorised_users(id),
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (employee_id, wage_month)
);
ALTER TABLE public.payroll_social_security_wage_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_social_security_wage_evidence FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_payroll_social_security_wage_evidence(
 p_employee_id uuid, p_wage_month date, p_remuneration numeric, p_wages_before_addback numeric,
 p_excluded_for_addback numeric, p_evidence_reference text, p_expected_version integer, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE saved public.payroll_social_security_wage_evidence%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 IF p_employee_id IS NULL OR p_wage_month IS NULL OR NOT isfinite(p_wage_month)
    OR p_wage_month < DATE '2025-12-01' OR extract(day FROM p_wage_month)<>1
    OR p_expected_version IS NULL OR p_expected_version<0
    OR p_remuneration IS NULL OR p_wages_before_addback IS NULL OR p_excluded_for_addback IS NULL
    OR NOT (p_remuneration BETWEEN 0 AND 999999999999.99)
    OR NOT (p_wages_before_addback BETWEEN 0 AND p_remuneration)
    OR NOT (p_excluded_for_addback BETWEEN 0 AND p_remuneration-p_wages_before_addback)
    OR scale(p_remuneration)>2 OR scale(p_wages_before_addback)>2 OR scale(p_excluded_for_addback)>2
    OR coalesce(length(btrim(p_evidence_reference)),0) NOT BETWEEN 1 AND 2000
 THEN RAISE EXCEPTION 'Invalid monthly statutory wage evidence' USING ERRCODE='22023'; END IF;
 PERFORM public.payroll_source_fence('employee:'||p_employee_id::text,false);
 IF EXISTS (
  SELECT 1 FROM public.payroll_run_employees e
  WHERE e.employee_id=p_employee_id AND e.status='LOCKED'
    AND e.period_to>=p_wage_month AND e.period_from<(p_wage_month+interval '1 month')::date
 ) THEN RAISE EXCEPTION 'Payroll is already locked for this employee and month' USING ERRCODE='PY409'; END IF;
 IF p_expected_version=0 THEN
  INSERT INTO public.payroll_social_security_wage_evidence
   (employee_id,wage_month,remuneration,wages_before_addback,excluded_for_addback,evidence_reference,confirmed_by)
  VALUES (p_employee_id,p_wage_month,p_remuneration,p_wages_before_addback,p_excluded_for_addback,btrim(p_evidence_reference),p_actor_id)
  ON CONFLICT (employee_id,wage_month) DO NOTHING RETURNING * INTO saved;
 ELSE
  UPDATE public.payroll_social_security_wage_evidence
   SET remuneration=p_remuneration,wages_before_addback=p_wages_before_addback,
       excluded_for_addback=p_excluded_for_addback,evidence_reference=btrim(p_evidence_reference),
       confirmed_by=p_actor_id,confirmed_at=now(),version=version+1
   WHERE employee_id=p_employee_id AND wage_month=p_wage_month AND version=p_expected_version
   RETURNING * INTO saved;
 END IF;
 IF saved.employee_id IS NULL THEN RAISE EXCEPTION 'Wage evidence changed. Reload and retry.' USING ERRCODE='PY409'; END IF;
 RETURN public.payroll_preview_decimals(to_jsonb(saved),ARRAY['remuneration','wages_before_addback','excluded_for_addback']);
END $$;

CREATE FUNCTION public.get_payroll_social_security_wage_evidence(p_employee_id uuid,p_wage_month date,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 RETURN (SELECT public.payroll_preview_decimals(to_jsonb(w),ARRAY['remuneration','wages_before_addback','excluded_for_addback'])
  FROM public.payroll_social_security_wage_evidence w WHERE w.employee_id=p_employee_id AND w.wage_month=p_wage_month);
END $$;

REVOKE ALL ON FUNCTION public.record_payroll_social_security_wage_evidence(uuid,date,numeric,numeric,numeric,text,integer,uuid),
 public.get_payroll_social_security_wage_evidence(uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_payroll_social_security_wage_evidence(uuid,date,numeric,numeric,numeric,text,integer,uuid),
 public.get_payroll_social_security_wage_evidence(uuid,date,uuid) TO service_role;

-- Keep source fingerprints identical for employees without confirmed evidence.
DO $patch$ DECLARE def text; target text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_preview_sources(uuid,uuid)'::regprocedure) INTO def;
 target := ' INTO result';
 IF length(def)-length(replace(def,target,''))<>length(target)
 THEN RAISE EXCEPTION 'Payroll source patch target must occur once'; END IF;
 def := replace(def,target,$source$ || coalesce((
   SELECT jsonb_build_object('social_security_wage_evidence',jsonb_agg(
    public.payroll_preview_decimals(to_jsonb(w)-ARRAY['evidence_reference','confirmed_by'],ARRAY['remuneration','wages_before_addback','excluded_for_addback'])
    ORDER BY w.wage_month))
   FROM public.payroll_social_security_wage_evidence w
   WHERE w.employee_id=e.employee_id AND w.wage_month BETWEEN date_trunc('month',lo)::date AND hi
   HAVING count(*)>0
  ),'{}'::jsonb) INTO result$source$);
 EXECUTE def;
END $patch$;

NOTIFY pgrst,'reload schema';
