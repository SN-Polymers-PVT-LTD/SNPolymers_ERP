-- Complete presentation contracts without changing historical salary calculations.
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.submit_payroll_accounts_sheet(uuid,uuid)'::regprocedure) INTO def;
 def:=replace(def,'SELECT 1 FROM public.payroll_accounts_deliveries d JOIN public.acct_requisition_line_items i ON i.id=d.item_id WHERE i.sheet_id=s.id AND d.active','SELECT 1 FROM public.payroll_accounts_deliveries del JOIN public.acct_requisition_line_items li ON li.id=del.item_id WHERE li.sheet_id=s.id AND del.active');
 def:=replace(def,'SELECT d.* FROM public.payroll_accounts_deliveries d JOIN public.acct_requisition_line_items i ON i.id=d.item_id WHERE i.sheet_id=s.id AND d.active ORDER BY d.employee_id FOR UPDATE OF d','SELECT del.* FROM public.payroll_accounts_deliveries del JOIN public.acct_requisition_line_items li ON li.id=del.item_id WHERE li.sheet_id=s.id AND del.active ORDER BY del.employee_id FOR UPDATE OF del');
 EXECUTE def;
 SELECT pg_get_functiondef('public.payroll_review_progress(uuid)'::regprocedure) INTO def;
 def:=replace(def,$old$status='PENDING_ACCOUNTS_REVIEW'$old$,$new$status IN ('PENDING_ACCOUNTS_REVIEW','IN_ACCOUNTS_SHEET')$new$);EXECUTE def;
END $patch$;
CREATE FUNCTION public.payroll_accounts_receipt(p_row uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('delivery_id',d.id,'sheet_id',s.id,'sheet_number',s.sheet_number,'disposition',d.disposition,'payment_recorded',EXISTS(SELECT 1 FROM public.payroll_payment_confirmations pc WHERE pc.delivery_id=d.id))
 FROM public.payroll_accounts_deliveries d JOIN public.acct_requisition_line_items i ON i.id=d.item_id JOIN public.acct_requisition_sheets s ON s.id=i.sheet_id
 WHERE d.row_id=p_row ORDER BY d.active DESC,d.created_at DESC,d.id DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.payroll_accounts_receipt(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_employee_review(uuid,uuid)'::regprocedure) INTO def;
 def:=replace(def,'RETURN result;',$new$RETURN result||jsonb_build_object('accounts_delivery',public.payroll_accounts_receipt(e.id),'payment_status',CASE WHEN EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries dl JOIN public.payroll_payment_confirmations pc ON pc.delivery_id=dl.id WHERE dl.row_id=e.id) THEN 'PAID' ELSE result->>'payment_status' END);$new$);EXECUTE def;
 SELECT pg_get_functiondef('public.get_payroll_salary_register(uuid,jsonb,integer,integer)'::regprocedure) INTO def;
 def:=replace(def,$old$'payment_status',CASE WHEN status='LOCKED' AND net=0 THEN 'NOT_REQUIRED' WHEN status='LOCKED' THEN 'NOT_RECORDED' ELSE 'NOT_ELIGIBLE' END$old$,$new$'accounts_delivery',public.payroll_accounts_receipt(page.id),'payment_status',CASE WHEN EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries dl JOIN public.payroll_payment_confirmations pc ON pc.delivery_id=dl.id WHERE dl.row_id=page.id) THEN 'PAID' WHEN status='LOCKED' AND net=0 THEN 'NOT_REQUIRED' WHEN status='LOCKED' THEN 'NOT_RECORDED' ELSE 'NOT_ELIGIBLE' END$new$);EXECUTE def;
END $patch$;
