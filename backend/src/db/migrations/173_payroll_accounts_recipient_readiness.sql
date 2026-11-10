-- Show stale payment routing before a reviewer attempts submission/approval.
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_accounts_sheet(uuid,uuid,integer,integer)'::regprocedure) INTO def;
 def:=replace(def,'d.calculation_snapshot salary,',$new$d.calculation_snapshot salary,
  ((d.calculation_snapshot->>'final_net_salary')::numeric=0 OR (d.recipient_snapshot IS NOT NULL AND d.recipient_snapshot IS NOT DISTINCT FROM public.payroll_accounts_recipient(d.beneficiary_id))) payment_details_current,$new$);
 EXECUTE def;
END $patch$;
NOTIFY pgrst,'reload schema';
