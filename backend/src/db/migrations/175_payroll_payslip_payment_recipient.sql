-- Read the approved Accounts recipient separately from immutable salary evidence.
-- Never resolve historical payslips against the editable beneficiary master.
DO $patch$ DECLARE def text; old text := $old$'calculation',f.calculation_snapshot$old$; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_official_payslip(uuid,uuid)'::regprocedure) INTO def;
 IF position(old IN def)=0 THEN RAISE EXCEPTION 'Official payslip contract changed'; END IF;
 def:=replace(def,old,$new$'payment_recipient',(SELECT jsonb_build_object('status','RECORDED','beneficiary_name',dl.recipient_snapshot->>'name','masked_account_number','****'||right(dl.recipient_snapshot->>'account_number',4),'ifsc',dl.recipient_snapshot->>'ifsc','bank_name',dl.recipient_snapshot->>'bank_name') FROM public.payroll_accounts_deliveries dl WHERE dl.row_id=e.id AND dl.disposition='APPROVED' AND dl.recipient_snapshot IS NOT NULL ORDER BY dl.created_at DESC LIMIT 1),'calculation',f.calculation_snapshot$new$);
 EXECUTE def;
END $patch$;
NOTIFY pgrst,'reload schema';
