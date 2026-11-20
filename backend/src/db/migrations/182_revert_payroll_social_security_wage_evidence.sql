-- Disable monthly EPF wage evidence while retaining any previously recorded evidence.
DO $patch$ DECLARE def text; fragment text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_preview_sources(uuid,uuid)'::regprocedure) INTO def;
 fragment := $source$ || coalesce((
   SELECT jsonb_build_object('social_security_wage_evidence',jsonb_agg(
    public.payroll_preview_decimals(to_jsonb(w)-ARRAY['evidence_reference','confirmed_by'],ARRAY['remuneration','wages_before_addback','excluded_for_addback'])
    ORDER BY w.wage_month))
   FROM public.payroll_social_security_wage_evidence w
   WHERE w.employee_id=e.employee_id AND w.wage_month BETWEEN date_trunc('month',lo)::date AND hi
   HAVING count(*)>0
  ),'{}'::jsonb)$source$;
 IF length(def)-length(replace(def,fragment,''))<>length(fragment)
 THEN RAISE EXCEPTION 'Expected one monthly EPF wage evidence source fragment'; END IF;
 EXECUTE replace(def,fragment,'');
END $patch$;

DROP FUNCTION public.record_payroll_social_security_wage_evidence(uuid,date,numeric,numeric,numeric,text,integer,uuid);
DROP FUNCTION public.get_payroll_social_security_wage_evidence(uuid,date,uuid);
NOTIFY pgrst,'reload schema';
