-- Permit incomplete Accounts drafts while retaining payment readiness at each handoff.
DO $migration$
DECLARE def text; before_patch text;
BEGIN
 SELECT pg_get_functiondef('public.save_payroll_payment_details(uuid,integer,text,text,uuid,text,text,uuid)'::regprocedure) INTO def;
 before_patch := def;
 def := replace(def,$old$IF p_mode IS NULL OR p_mode NOT IN ('Cheque','Bulk NEFT','RTGS','NEFT') OR NOT EXISTS(SELECT 1 FROM public.bank_balance_master WHERE bank_name=p_bank)$old$,
 $new$IF (p_mode IS NOT NULL AND p_mode NOT IN ('Cheque','Bulk NEFT','RTGS','NEFT')) OR (p_bank IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bank_balance_master WHERE bank_name=p_bank))$new$);
 IF def=before_patch THEN RAISE EXCEPTION 'Missing payment validation anchor'; END IF;
 def := replace(def,'IF recipient IS NULL THEN','IF p_beneficiary_id IS NOT NULL AND recipient IS NULL THEN');
 def := replace(def,$old$ IF p_mode='Cheque' AND (nullif(btrim(p_cheque_no),'') IS NULL OR nullif(btrim(p_cheque_date),'') IS NULL) THEN RAISE EXCEPTION 'Cheque number and date required' USING ERRCODE='22023'; END IF;$old$,'');
 EXECUTE def;

 SELECT pg_get_functiondef('public.submit_payroll_accounts_sheet(uuid,uuid)'::regprocedure) INTO def;
 before_patch := def;
 def := replace(def,'i.payment_mode IS NULL OR i.debit_bank_ac_type IS NULL',
  'i.payment_mode IS NULL OR i.debit_bank_ac_type IS NULL OR (i.payment_mode=''Cheque'' AND (nullif(btrim(i.cheque_no),'''') IS NULL OR nullif(btrim(i.cheque_date),'''') IS NULL))');
 IF def=before_patch THEN RAISE EXCEPTION 'Missing payroll submission guard anchor'; END IF;
 EXECUTE def;

 SELECT pg_get_functiondef('public.resubmit_payroll_payment(uuid,integer,uuid)'::regprocedure) INTO def;
 before_patch := def;
 def := replace(def,$old$PERFORM set_config('app.payroll_accounts','on',true);$old$,$new$
 IF NOT EXISTS(SELECT 1 FROM public.acct_requisition_line_items i WHERE i.id=d.item_id AND i.debit_bank_ac_type IS NOT NULL
  AND i.payment_mode IS NOT NULL AND (i.payment_mode<>'Cheque' OR (nullif(btrim(i.cheque_no),'') IS NOT NULL AND nullif(btrim(i.cheque_date),'') IS NOT NULL))) THEN
  RAISE EXCEPTION 'Complete the returned payment details first' USING ERRCODE='22023';
 END IF;
 PERFORM set_config('app.payroll_accounts','on',true);$new$);
 IF def=before_patch THEN RAISE EXCEPTION 'Missing payroll resubmission guard anchor'; END IF;
 EXECUTE def;

 SELECT pg_get_functiondef('public.get_payroll_accounts_sheet(uuid,uuid,integer,integer)'::regprocedure) INTO def;
 before_patch := def;
 def := replace(def,$old$'rows',coalesce($old$,$new$
 'bank_commitments',COALESCE((SELECT jsonb_object_agg(bank,amount::text) FROM (
  SELECT debit_bank_ac_type bank,sum(req_amount) amount FROM items
  WHERE active AND disposition IN ('WITH_ACCOUNTS','PAYMENT_RETURN','WITH_HO','HOLD') AND debit_bank_ac_type IS NOT NULL
  GROUP BY debit_bank_ac_type
 ) commitments),'{}'::jsonb),
 'rows',coalesce($new$);
 IF def=before_patch THEN RAISE EXCEPTION 'Missing payroll sheet projection anchor'; END IF;
 def := replace(def,'debit_bank_ac_type IS NULL OR payment_mode IS NULL)))','debit_bank_ac_type IS NULL OR payment_mode IS NULL OR (payment_mode=''Cheque'' AND (cheque_no IS NULL OR cheque_date IS NULL)))))');
 EXECUTE def;
END;
$migration$;
