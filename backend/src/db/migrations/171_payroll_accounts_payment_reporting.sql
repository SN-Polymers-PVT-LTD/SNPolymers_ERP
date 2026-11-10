-- Reports reflect confirmed payment without rewriting immutable salary snapshots.
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_official_payslip(uuid,uuid)'::regprocedure) INTO def;
 def:=replace(def,$old$'payment_status',CASE WHEN f.net_salary=0 THEN 'NOT_REQUIRED' ELSE 'NOT_RECORDED' END$old$,$new$'payment_status',CASE WHEN f.net_salary=0 THEN 'NOT_REQUIRED' WHEN EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries dl JOIN public.payroll_payment_confirmations pc ON pc.delivery_id=dl.id WHERE dl.row_id=e.id) THEN 'PAID' ELSE 'NOT_RECORDED' END$new$);EXECUTE def;
 SELECT pg_get_functiondef('public.get_payroll_accounts_sheet(uuid,uuid,integer,integer)'::regprocedure) INTO def;
 def:=replace(def,'RETURN result;', $new$RETURN result||jsonb_build_object('financial_finalization_enabled',public.payroll_financial_enabled());$new$);EXECUTE def;
END $patch$;
NOTIFY pgrst,'reload schema';
