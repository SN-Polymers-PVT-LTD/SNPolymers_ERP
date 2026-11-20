-- Accounts confirms the recurring wage basis separately from the HR salary.
CREATE TABLE public.payroll_epf_wage_bases (
 employee_id uuid NOT NULL REFERENCES public.hr_employees(id),
 pay_structure_id uuid NOT NULL,
 effective_from date NOT NULL CHECK (isfinite(effective_from) AND effective_from>=DATE '2025-12-01' AND extract(day FROM effective_from)=1),
 regular_wages numeric(14,2) NOT NULL CHECK (regular_wages BETWEEN 0 AND 999999999999.99),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
 confirmed_by uuid NOT NULL REFERENCES public.authorised_users(id),
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(employee_id,pay_structure_id,effective_from),
 FOREIGN KEY(pay_structure_id,employee_id) REFERENCES public.hr_permanent_pay_structures(id,employee_id)
);
ALTER TABLE public.payroll_epf_wage_bases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_epf_wage_bases FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_payroll_epf_wage_bases(p_employee_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 RETURN jsonb_build_object(
  'salary_revisions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'revision',p.revision_number,'gross',p.guaranteed_monthly_gross::text) ORDER BY p.revision_number DESC)
    FROM public.hr_permanent_pay_structures p WHERE p.employee_id=p_employee_id AND p.epf_enrolment AND p.status IN ('Active','Superseded')),'[]'),
  'wage_bases',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(b),ARRAY['regular_wages']) ORDER BY b.effective_from DESC,b.pay_structure_id)
    FROM public.payroll_epf_wage_bases b WHERE b.employee_id=p_employee_id),'[]'));
END $$;

CREATE FUNCTION public.record_payroll_epf_wage_basis(p_employee_id uuid,p_pay_structure_id uuid,p_effective_from date,p_regular_wages numeric,p_reason text,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE salary public.hr_permanent_pay_structures%ROWTYPE;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts']);
 PERFORM public.payroll_source_fence('employee:'||p_employee_id::text,false);
 SELECT * INTO salary FROM public.hr_permanent_pay_structures p
 WHERE p.id=p_pay_structure_id AND p.employee_id=p_employee_id AND p.epf_enrolment AND p.status IN ('Active','Superseded');
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an EPF-enrolled salary revision for this employee' USING ERRCODE='22023'; END IF;
 IF p_effective_from IS NULL OR NOT isfinite(p_effective_from) OR p_effective_from<DATE '2025-12-01'
    OR extract(day FROM p_effective_from)<>1 OR p_regular_wages IS NULL
    OR NOT (p_regular_wages BETWEEN 0 AND salary.guaranteed_monthly_gross) OR scale(p_regular_wages)>2
    OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 1 AND 2000
 THEN RAISE EXCEPTION 'Enter regular wages within the agreed gross, a month start and a reason' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_epf_wage_bases b WHERE b.employee_id=p_employee_id AND b.pay_structure_id=p_pay_structure_id AND b.effective_from=p_effective_from AND b.regular_wages=p_regular_wages AND b.reason=btrim(p_reason))
 THEN RETURN public.get_payroll_epf_wage_bases(p_employee_id,p_actor_id); END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_employee_coverage c WHERE c.employee_id=p_employee_id AND c.period_to>=p_effective_from)
 THEN RAISE EXCEPTION 'Choose a month after the last locked payroll for this employee' USING ERRCODE='PY409'; END IF;
 INSERT INTO public.payroll_epf_wage_bases(employee_id,pay_structure_id,effective_from,regular_wages,reason,confirmed_by)
 VALUES(p_employee_id,p_pay_structure_id,p_effective_from,p_regular_wages,btrim(p_reason),p_actor_id);
 RETURN public.get_payroll_epf_wage_bases(p_employee_id,p_actor_id);
END $$;

REVOKE ALL ON FUNCTION public.get_payroll_epf_wage_bases(uuid,uuid),
 public.record_payroll_epf_wage_basis(uuid,uuid,date,numeric,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_epf_wage_bases(uuid,uuid),
 public.record_payroll_epf_wage_basis(uuid,uuid,date,numeric,text,uuid) TO service_role;

ALTER TABLE public.payroll_statutory_entries ADD COLUMN epf_wage_inputs jsonb;

DO $patch$ DECLARE def text; target text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_preview_sources(uuid,uuid)'::regprocedure) INTO def;
 target := ' INTO result';
 IF length(def)-length(replace(def,target,''))<>length(target) THEN RAISE EXCEPTION 'EPF payroll source patch target must occur once'; END IF;
 def := replace(def,target,$source$ || coalesce((
   SELECT jsonb_build_object('epf_wage_bases',jsonb_agg(
    public.payroll_preview_decimals(to_jsonb(b)-ARRAY['reason','confirmed_by','confirmed_at'],ARRAY['regular_wages'])
    ORDER BY b.effective_from,b.pay_structure_id))
   FROM public.payroll_epf_wage_bases b
   WHERE b.employee_id=e.employee_id AND b.effective_from<=hi
     AND b.pay_structure_id IN (SELECT pay_structure_id FROM pay)
   HAVING count(*)>0
  ),'{}'::jsonb) INTO result$source$);
 -- Keep the shape and fingerprint of existing sources when no new ledger inputs exist.
 target := 'payroll_preview_decimals(to_jsonb(t),ARRAY[''employee_amount'',''employer_amount''])';
 IF length(def)-length(replace(def,target,''))<>length(target) THEN RAISE EXCEPTION 'EPF ledger source patch target must occur once'; END IF;
 EXECUTE replace(def,target,'payroll_preview_decimals(CASE WHEN t.epf_wage_inputs IS NULL THEN to_jsonb(t)-''epf_wage_inputs'' ELSE to_jsonb(t) END,ARRAY[''employee_amount'',''employer_amount''])');

 SELECT pg_get_functiondef('public.payroll_finalize_employee(uuid,jsonb,jsonb,uuid)'::regprocedure) INTO def;
 target := 'eligible_wage,employee_amount,employer_amount,source_profile_id)';
 IF length(def)-length(replace(def,target,''))<>length(target) THEN RAISE EXCEPTION 'EPF ledger write patch target must occur once'; END IF;
 def := replace(def,target,'eligible_wage,employee_amount,employer_amount,source_profile_id,epf_wage_inputs)');
 target := '(x->>''source_profile_id'')::uuid);';
 IF length(def)-length(replace(def,target,''))<>length(target) THEN RAISE EXCEPTION 'EPF ledger values patch target must occur once'; END IF;
 EXECUTE replace(def,target,'(x->>''source_profile_id'')::uuid,x->''epf_wage_inputs'');');
END $patch$;
NOTIFY pgrst,'reload schema';
