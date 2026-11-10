-- Match salary action visibility to the authoritative maker/checker checks.
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_accounts_sheet(uuid,uuid,integer,integer)'::regprocedure) INTO def;
 def:=replace(def,'d.calculation_snapshot salary', $new$d.calculation_snapshot salary,
  (pr.created_by IS DISTINCT FROM p_actor_id AND pr.submitted_by IS DISTINCT FROM p_actor_id AND pr.accounts_verified_by IS DISTINCT FROM p_actor_id AND e.erp_user_id IS DISTINCT FROM p_actor_id) independent_reviewer,
  (NOT g.is_factory OR (pr.created_by IS DISTINCT FROM p_actor_id AND e.erp_user_id IS DISTINCT FROM p_actor_id)) independent_accounts$new$);
 def:=replace(def,'JOIN public.hr_employees e ON e.id=d.employee_id WHERE i.sheet_id=s.id', $new$JOIN public.hr_employees e ON e.id=d.employee_id JOIN public.payroll_run_employees pr ON pr.id=d.row_id JOIN public.payroll_runs prun ON prun.id=pr.run_id JOIN public.payroll_groups g ON g.code=prun.group_code WHERE i.sheet_id=s.id$new$);
 EXECUTE def;
END $patch$;
NOTIFY pgrst,'reload schema';
