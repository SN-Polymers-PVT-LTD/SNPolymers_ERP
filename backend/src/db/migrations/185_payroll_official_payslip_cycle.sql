-- Include the payroll cycle for official payslips, including existing locked runs.
DO $patch$
DECLARE
 def text;
 target text := $sql$'group_code',(SELECT group_code FROM public.payroll_runs WHERE id=e.run_id),$sql$;
BEGIN
 SELECT pg_get_functiondef('public.get_payroll_official_payslip(uuid,uuid)'::regprocedure) INTO def;
 IF length(def)-length(replace(def,target,''))<>length(target) THEN
  RAISE EXCEPTION 'Expected exactly one official payslip group field';
 END IF;
 EXECUTE replace(def,target,target||$sql$'cycle',(SELECT cycle FROM public.payroll_runs WHERE id=e.run_id),$sql$);
END $patch$;

NOTIFY pgrst,'reload schema';
