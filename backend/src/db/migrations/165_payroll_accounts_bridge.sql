-- Payroll is delivered to the existing Accounts requisition workflow.
SET LOCAL search_path=public,extensions;
ALTER TABLE public.acct_requisition_sheets ADD COLUMN payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE RESTRICT;
CREATE INDEX acct_payroll_sheet_run ON public.acct_requisition_sheets(payroll_run_id) WHERE payroll_run_id IS NOT NULL;
ALTER TABLE public.acct_requisition_line_items ADD COLUMN payroll_row_id uuid REFERENCES public.payroll_run_employees(id) ON DELETE RESTRICT;
ALTER TABLE public.acct_requisition_line_items DROP CONSTRAINT chk_arli_req_amount, DROP CONSTRAINT chk_arli_ho_pass_amount;
ALTER TABLE public.acct_requisition_line_items ADD CONSTRAINT chk_arli_req_amount CHECK(req_amount IS NULL OR req_amount>0 OR (payroll_row_id IS NOT NULL AND req_amount=0)), ADD CONSTRAINT chk_arli_ho_pass_amount CHECK(ho_pass_amount IS NULL OR (ho_pass_amount>0 AND ho_pass_amount<=req_amount) OR (payroll_row_id IS NOT NULL AND req_amount=0 AND ho_pass_amount=0));
CREATE TABLE public.payroll_accounts_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), row_id uuid NOT NULL REFERENCES public.payroll_run_employees(id),
 item_id uuid NOT NULL UNIQUE REFERENCES public.acct_requisition_line_items(id),
 employee_id uuid NOT NULL REFERENCES public.hr_employees(id), period_from date NOT NULL,period_to date NOT NULL CHECK(period_to>=period_from),
 review_revision integer NOT NULL, FOREIGN KEY(row_id,review_revision) REFERENCES public.payroll_review_revisions(row_id,revision),
 source_snapshot jsonb NOT NULL, calculation_snapshot jsonb NOT NULL,
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 disposition text NOT NULL DEFAULT 'WITH_ACCOUNTS' CHECK(disposition IN ('WITH_ACCOUNTS','WITH_HO','RETURNED','PAYMENT_RETURN','HOLD','APPROVED')),
 beneficiary_id uuid REFERENCES public.beneficiary_master(id), recipient_snapshot jsonb,
 submitted_by uuid NOT NULL REFERENCES public.authorised_users(id),verified_by uuid REFERENCES public.authorised_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(row_id,review_revision),
 EXCLUDE USING gist(employee_id WITH =, daterange(period_from,period_to,'[]') WITH &&) WHERE(active)
);
CREATE UNIQUE INDEX payroll_accounts_one_active_row ON public.payroll_accounts_deliveries(row_id) WHERE active;
CREATE TABLE public.payroll_accounts_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,delivery_id uuid NOT NULL REFERENCES public.payroll_accounts_deliveries(id),
 action text NOT NULL,actor_id uuid NOT NULL REFERENCES public.authorised_users(id),details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payroll_payment_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),delivery_id uuid NOT NULL UNIQUE REFERENCES public.payroll_accounts_deliveries(id),
 amount numeric(18,2) NOT NULL CHECK(amount>0),paid_on date NOT NULL CHECK(isfinite(paid_on)),reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 200),
 recorded_by uuid NOT NULL REFERENCES public.authorised_users(id),created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['payroll_accounts_deliveries','payroll_accounts_events','payroll_payment_confirmations'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
 END LOOP; END $$;
CREATE TRIGGER payroll_immutable BEFORE UPDATE OR DELETE ON public.payroll_accounts_events FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();
CREATE TRIGGER payroll_immutable BEFORE UPDATE OR DELETE ON public.payroll_payment_confirmations FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();
-- User-facing state; existing historical states remain readable.
ALTER TABLE public.payroll_run_employees DROP CONSTRAINT payroll_employee_review_status;
ALTER TABLE public.payroll_run_employees ADD CONSTRAINT payroll_run_employees_status_check CHECK(status IN ('DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED','IN_ACCOUNTS_SHEET'));
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.payroll_guard_draft_row()'::regprocedure) INTO def;
 def:=replace(def,$old$(OLD.status='PENDING_ACCOUNTS_REVIEW' AND NEW.status IN ('PENDING_HO_APPROVAL','RETURNED_TO_CREATOR'))$old$,$new$(OLD.status='PENDING_ACCOUNTS_REVIEW' AND NEW.status IN ('PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','IN_ACCOUNTS_SHEET')) OR (OLD.status='PENDING_HO_APPROVAL' AND NEW.status='IN_ACCOUNTS_SHEET') OR (OLD.status='IN_ACCOUNTS_SHEET' AND NEW.status IN ('PENDING_HO_APPROVAL','RETURNED_TO_CREATOR'))$new$);
 EXECUTE def;
END $patch$;
-- Keep workflow acceptance and payout routing out of salary equality comparisons.
-- Recipient details are validated independently and frozen at Accounts submission.
CREATE FUNCTION public.payroll_accounts_salary_source(p_source jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT (p_source-'beneficiary') #- '{financial_context,cutoff}' #- '{financial_context,activation_enabled}'
$$;
CREATE FUNCTION public.payroll_accounts_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE p uuid; expected numeric; owner_run uuid;
BEGIN
 IF TG_TABLE_NAME='acct_requisition_sheets' THEN
  IF TG_OP='DELETE' AND OLD.payroll_run_id IS NOT NULL THEN RAISE EXCEPTION 'Salary delivery sheets retain audit history' USING ERRCODE='PY409'; END IF;
  IF TG_OP='UPDATE' AND (NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id OR (OLD.payroll_run_id IS NOT NULL AND NEW.sheet_status IS DISTINCT FROM OLD.sheet_status)) AND current_setting('app.payroll_accounts',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Use the payroll sheet workflow' USING ERRCODE='PY409'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 p:=CASE WHEN TG_OP='DELETE' THEN OLD.payroll_row_id ELSE NEW.payroll_row_id END;
 IF TG_OP='UPDATE' AND OLD.payroll_row_id IS NOT NULL AND NEW.payroll_row_id IS DISTINCT FROM OLD.payroll_row_id THEN RAISE EXCEPTION 'Salary source is immutable' USING ERRCODE='PY409'; END IF;
 IF TG_OP='INSERT' AND NEW.imported_from_item_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.acct_requisition_line_items WHERE id=NEW.imported_from_item_id AND payroll_row_id IS NOT NULL) THEN RAISE EXCEPTION 'Use the linked payroll continuation, not generic import' USING ERRCODE='PY409'; END IF;
 IF p IS NULL THEN
  IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM public.acct_requisition_sheets WHERE id=NEW.sheet_id AND payroll_run_id IS NOT NULL) THEN RAISE EXCEPTION 'Only linked salary rows belong in payroll sheets' USING ERRCODE='PY409'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Return salary to its preparer instead of deleting it' USING ERRCODE='PY409'; END IF;
 -- NEFT export flags may change on approved rows; no other generic edits.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['neft_exported','neft_exported_at','neft_exported_by','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['neft_exported','neft_exported_at','neft_exported_by','updated_at']) AND OLD.requisition_status='Approved' THEN RETURN NEW; END IF;
 IF current_setting('app.payroll_accounts',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Salary amounts and decisions use the payroll workflow' USING ERRCODE='PY409'; END IF;
 SELECT r.run_id,(v.calculation_snapshot->>'final_net_salary')::numeric INTO owner_run,expected FROM public.payroll_run_employees r JOIN public.payroll_review_revisions v ON v.row_id=r.id AND v.revision=r.review_revision WHERE r.id=p;
 IF NEW.req_amount IS DISTINCT FROM expected OR NEW.payment_mode='Credit' OR NEW.debit_bank_ac_type='Credit' OR NEW.source_requisition_id IS NOT NULL OR NEW.source_fund_request_id IS NOT NULL OR NEW.credit_ledger_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.acct_requisition_sheets WHERE id=NEW.sheet_id AND payroll_run_id=owner_run) THEN RAISE EXCEPTION 'Invalid salary amount, source or payment route' USING ERRCODE='23514'; END IF;
 IF NEW.requisition_status IN ('Partially Approved','Credit Approved','Rejected') THEN RAISE EXCEPTION 'Salary decisions are Approve, Return or Hold' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a00_payroll_bridge_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_requisition_line_items FOR EACH ROW EXECUTE FUNCTION public.payroll_accounts_guard();
CREATE TRIGGER a00_payroll_bridge_guard BEFORE UPDATE OR DELETE ON public.acct_requisition_sheets FOR EACH ROW EXECUTE FUNCTION public.payroll_accounts_guard();
CREATE FUNCTION public.payroll_accounts_event(p_delivery uuid,p_action text,p_actor uuid,p_details jsonb DEFAULT '{}') RETURNS void LANGUAGE sql SET search_path=public AS $$
 INSERT INTO public.payroll_accounts_events(delivery_id,action,actor_id,details) VALUES(p_delivery,p_action,p_actor,p_details)
$$;
CREATE FUNCTION public.deliver_payroll_to_accounts(p_row_id uuid,p_expected_version integer,p_expected_review_version integer,p_fingerprint text,p_actor_id uuid,p_migrate boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e public.payroll_run_employees; r public.payroll_runs; v public.payroll_review_revisions; link public.payroll_accounts_deliveries; s public.acct_requisition_sheets; item public.acct_requisition_line_items; actor public.authorised_users; result jsonb; src jsonb; name text;
BEGIN
 SELECT * INTO actor FROM public.authorised_users WHERE id=p_actor_id;
 PERFORM public.payroll_require_actor(p_actor_id,CASE WHEN p_migrate THEN ARRAY['admin','accounts'] ELSE ARRAY['accounts','factory_manager'] END);
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Salary row not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_lock_review_sources(e.employee_id,e.run_id);
 SELECT * INTO r FROM public.payroll_runs WHERE id=e.run_id FOR UPDATE;
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=p_row_id FOR UPDATE;
 PERFORM public.payroll_require_scope(p_actor_id,r.department,false);
 SELECT * INTO link FROM public.payroll_accounts_deliveries WHERE row_id=e.id AND active;
 IF FOUND THEN
  IF NOT p_migrate AND e.created_by<>p_actor_id THEN RAISE EXCEPTION 'Only the preparer can submit this salary' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('applied',true,'row',to_jsonb(e),'accounts_sheet_id',(SELECT sheet_id FROM public.acct_requisition_line_items WHERE id=link.item_id),'delivery_id',link.id,'already_sent',true);
 END IF;
 SELECT * INTO v FROM public.payroll_review_revisions WHERE row_id=e.id AND revision=e.review_revision;
 IF v.row_id IS NULL OR v.calculation_snapshot->>'financial_readiness' IS DISTINCT FROM 'true' OR v.calculation_snapshot->>'final_net_salary' IS NULL THEN RAISE EXCEPTION 'Complete salary calculation before sending to Accounts' USING ERRCODE='PY409'; END IF;
 IF e.current_version<>p_expected_version OR e.review_version<>p_expected_review_version OR v.source_fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Salary version changed; refresh' USING ERRCODE='PY409'; END IF;
 IF p_migrate THEN
  IF e.status NOT IN ('PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL') THEN RAISE EXCEPTION 'Only unlinked pending salaries can be moved' USING ERRCODE='PY409'; END IF;
  src:=public.payroll_review_source_snapshot(e.id,p_actor_id);
  IF public.payroll_accounts_salary_source(src) IS DISTINCT FROM public.payroll_accounts_salary_source(v.source_snapshot) THEN RAISE EXCEPTION 'Pending salary sources changed; return and recalculate first' USING ERRCODE='PY409'; END IF;
 ELSE
  result:=public.transition_payroll_employee_review(e.id,p_expected_version,p_expected_review_version,'submit',jsonb_build_object('source_fingerprint',p_fingerprint),p_actor_id);
 END IF;
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=e.id;
 SELECT * INTO s FROM public.acct_requisition_sheets WHERE payroll_run_id=r.id AND sheet_status='Open' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
 PERFORM set_config('app.payroll_accounts','on',true);
 IF s.id IS NULL THEN s:=public.create_acct_sheet_transact(actor.mobile_number::varchar); UPDATE public.acct_requisition_sheets SET payroll_run_id=r.id WHERE id=s.id RETURNING * INTO s; END IF;
 SELECT employee_name||' · '||employee_code INTO name FROM public.hr_employees WHERE id=e.employee_id;
 INSERT INTO public.acct_requisition_line_items(sheet_id,created_by,account_sub_title_text,particulars,req_amount,payroll_row_id)
 VALUES(s.id,actor.mobile_number,'Salary and wages',name||' · '||e.period_from||' to '||e.period_to,(v.calculation_snapshot->>'final_net_salary')::numeric,e.id) RETURNING * INTO item;
 INSERT INTO public.payroll_accounts_deliveries(row_id,item_id,employee_id,period_from,period_to,review_revision,source_snapshot,calculation_snapshot,submitted_by,beneficiary_id)
 VALUES(e.id,item.id,e.employee_id,e.period_from,e.period_to,e.review_revision,v.source_snapshot,v.calculation_snapshot,p_actor_id,(SELECT beneficiary_id FROM public.hr_employees WHERE id=e.employee_id)) RETURNING * INTO link;
 UPDATE public.payroll_run_employees SET status='IN_ACCOUNTS_SHEET',review_version=review_version+1,accounts_verified_by=NULL WHERE id=e.id RETURNING * INTO e;
 -- Existing action type carries the bridge event while the dedicated log records delivery identity.
 INSERT INTO public.payroll_action_history(run_id,row_id,row_version,action,actor_id,actor_role,from_status,to_status,reason,review_version,review_revision) VALUES(e.run_id,e.id,e.current_version,'SUBMITTED',p_actor_id,actor.role,'CALCULATED',e.status,'Delivered to Accounts sheet '||s.sheet_number,e.review_version,e.review_revision);
 PERFORM public.payroll_accounts_event(link.id,'DELIVERED',p_actor_id,jsonb_build_object('sheet_id',s.id,'migrated',p_migrate));
 PERFORM set_config('app.payroll_accounts','off',true);
 RETURN jsonb_build_object('applied',true,'row',to_jsonb(e),'accounts_sheet_id',s.id,'accounts_sheet_number',s.sheet_number,'delivery_id',link.id);
END $$;
CREATE FUNCTION public.payroll_accounts_recipient(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 SELECT jsonb_build_object('id',b.id,'account_number',b.account_number,'ifsc',b.ifsc,'name',b.beneficiary_name,'bank_id',bank.id,'bank_name',bank.bank_name)
 FROM public.beneficiary_master b JOIN public.indian_bank_master bank ON bank.id=b.beneficiary_bank_id
 WHERE b.id=p_id AND bank.is_active AND b.account_number ~ '^[0-9]{9,18}$' AND b.ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$' AND length(btrim(b.beneficiary_name))>0
$$;
CREATE FUNCTION public.get_payroll_accounts_sheet(p_sheet_id uuid,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE s public.acct_requisition_sheets; result jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','ho','admin']);
 SELECT * INTO s FROM public.acct_requisition_sheets WHERE id=p_sheet_id;
 IF s.payroll_run_id IS NULL THEN RAISE EXCEPTION 'Payroll Accounts sheet not found' USING ERRCODE='P0002'; END IF;
 SELECT jsonb_build_object('sheet',to_jsonb(s),'run',(SELECT to_jsonb(r) FROM public.payroll_runs r WHERE id=s.payroll_run_id),
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('delivery_id',d.id,'delivery_version',d.version,'disposition',d.disposition,'active',d.active,'employee_name',e.employee_name,'employee_code',e.employee_code,'employee_id',e.id,'beneficiary_id',d.beneficiary_id,'period_from',d.period_from,'period_to',d.period_to,'salary',d.calculation_snapshot,'source_stale',CASE WHEN d.disposition='APPROVED' THEN false ELSE public.payroll_accounts_salary_source(d.source_snapshot) IS DISTINCT FROM public.payroll_accounts_salary_source(public.payroll_review_source_snapshot(d.row_id,p_actor_id)) END,'payment',(SELECT to_jsonb(p) FROM public.payroll_payment_confirmations p WHERE p.delivery_id=d.id)) ORDER BY e.employee_name,i.id)
 FROM public.acct_requisition_line_items i JOIN public.payroll_accounts_deliveries d ON d.item_id=i.id JOIN public.hr_employees e ON e.id=d.employee_id WHERE i.sheet_id=s.id),'[]')) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.save_payroll_payment_details(p_delivery_id uuid,p_expected_version integer,p_bank text,p_mode text,p_beneficiary_id uuid,p_cheque_no text,p_cheque_date text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE d public.payroll_accounts_deliveries; i public.acct_requisition_line_items; recipient jsonb;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']);
 SELECT * INTO d FROM public.payroll_accounts_deliveries WHERE id=p_delivery_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Salary delivery not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO i FROM public.acct_requisition_line_items WHERE id=d.item_id FOR UPDATE;
 IF NOT d.active OR d.disposition NOT IN ('WITH_ACCOUNTS','PAYMENT_RETURN') OR d.version<>p_expected_version THEN RAISE EXCEPTION 'Salary payment details changed or are under review' USING ERRCODE='PY409'; END IF;
 IF p_mode IS NULL OR p_mode NOT IN ('Cheque','Bulk NEFT','RTGS','NEFT') OR NOT EXISTS(SELECT 1 FROM public.bank_balance_master WHERE bank_name=p_bank) THEN RAISE EXCEPTION 'Choose a valid debit bank and payment mode' USING ERRCODE='22023'; END IF;
 recipient:=public.payroll_accounts_recipient(p_beneficiary_id);
 IF recipient IS NULL THEN RAISE EXCEPTION 'Select a complete saved employee beneficiary with an active bank' USING ERRCODE='22023'; END IF;
 IF p_mode='Cheque' AND (nullif(btrim(p_cheque_no),'') IS NULL OR nullif(btrim(p_cheque_date),'') IS NULL) THEN RAISE EXCEPTION 'Cheque number and date required' USING ERRCODE='22023'; END IF;
 PERFORM set_config('app.payroll_accounts','on',true);
 UPDATE public.acct_requisition_line_items SET debit_bank_ac_type=p_bank,payment_mode=p_mode,beneficiary_ac_no=recipient->>'account_number',beneficiary_ifsc=recipient->>'ifsc',beneficiary_name=recipient->>'name',beneficiary_bank_id=(recipient->>'bank_id')::uuid,beneficiary_bank_name=recipient->>'bank_name',cheque_no=nullif(p_cheque_no,''),cheque_date=nullif(p_cheque_date,''),updated_at=now() WHERE id=i.id;
 UPDATE public.payroll_accounts_deliveries SET beneficiary_id=p_beneficiary_id,recipient_snapshot=recipient,version=version+1,updated_at=now() WHERE id=d.id RETURNING * INTO d;
 PERFORM public.payroll_accounts_event(d.id,'PAYMENT_DETAILS',p_actor_id,jsonb_build_object('bank',p_bank,'mode',p_mode,'beneficiary_id',p_beneficiary_id));
 PERFORM set_config('app.payroll_accounts','off',true);RETURN jsonb_build_object('version',d.version);
END $$;
CREATE FUNCTION public.submit_payroll_accounts_sheet(p_sheet_id uuid,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE s public.acct_requisition_sheets; d public.payroll_accounts_deliveries; i public.acct_requisition_line_items; e public.payroll_run_employees; actor public.authorised_users; cutoff public.payroll_period_cutoffs; r public.payroll_runs; factory boolean;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']);
 SELECT * INTO actor FROM public.authorised_users WHERE id=p_actor_id;
 SELECT payroll_run_id INTO r.id FROM public.acct_requisition_sheets WHERE id=p_sheet_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Payroll sheet not found' USING ERRCODE='P0002'; END IF;
 -- Same run-before-sheet order as delivery; generic calls cannot update typed sheets.
 SELECT * INTO r FROM public.payroll_runs WHERE id=r.id FOR UPDATE;
 SELECT * INTO s FROM public.acct_requisition_sheets WHERE id=p_sheet_id FOR UPDATE;
 IF s.sheet_status<>'Open' THEN RETURN jsonb_build_object('sheet',to_jsonb(s),'already_sent',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries d JOIN public.acct_requisition_line_items i ON i.id=d.item_id WHERE i.sheet_id=s.id AND d.active) THEN RAISE EXCEPTION 'No active salaries to send' USING ERRCODE='22023'; END IF;
 SELECT is_factory INTO factory FROM public.payroll_groups WHERE code=r.group_code;
 PERFORM set_config('app.payroll_accounts','on',true);
 FOR d IN SELECT d.* FROM public.payroll_accounts_deliveries d JOIN public.acct_requisition_line_items i ON i.id=d.item_id WHERE i.sheet_id=s.id AND d.active ORDER BY d.employee_id FOR UPDATE OF d LOOP
  SELECT * INTO e FROM public.payroll_run_employees WHERE id=d.row_id;
  PERFORM public.payroll_lock_review_sources(e.employee_id,e.run_id);
  SELECT * INTO e FROM public.payroll_run_employees WHERE id=d.row_id FOR UPDATE;
  IF d.disposition<>'WITH_ACCOUNTS' OR e.status<>'IN_ACCOUNTS_SHEET' OR (factory AND (e.created_by=p_actor_id OR (SELECT erp_user_id=p_actor_id FROM public.hr_employees WHERE id=e.employee_id))) THEN RAISE EXCEPTION 'Salary is not eligible for independent Accounts submission' USING ERRCODE='PY409'; END IF;
  IF public.payroll_accounts_salary_source(d.source_snapshot) IS DISTINCT FROM public.payroll_accounts_salary_source(public.payroll_review_source_snapshot(e.id,p_actor_id)) THEN RAISE EXCEPTION 'Salary inputs changed. Return and recalculate the employee.' USING ERRCODE='PY409'; END IF;
  SELECT * INTO i FROM public.acct_requisition_line_items WHERE id=d.item_id FOR UPDATE;
  IF i.req_amount>0 AND (i.payment_mode IS NULL OR i.debit_bank_ac_type IS NULL OR d.recipient_snapshot IS NULL OR d.recipient_snapshot IS DISTINCT FROM public.payroll_accounts_recipient(d.beneficiary_id)) THEN RAISE EXCEPTION 'Complete or refresh employee payment details before sending to HO' USING ERRCODE='22023'; END IF;
  UPDATE public.acct_requisition_line_items SET requisition_status='Pending HO Review',updated_at=now() WHERE id=i.id;
  UPDATE public.payroll_run_employees SET status='PENDING_HO_APPROVAL',accounts_verified_by=CASE WHEN factory THEN p_actor_id ELSE NULL END,review_version=review_version+1 WHERE id=e.id RETURNING * INTO e;
  INSERT INTO public.payroll_action_history(run_id,row_id,row_version,action,actor_id,actor_role,from_status,to_status,reason,review_version,review_revision) VALUES(e.run_id,e.id,e.current_version,'ACCOUNTS_FORWARDED',p_actor_id,actor.role,'IN_ACCOUNTS_SHEET',e.status,'Accounts sheet submitted to HO',e.review_version,e.review_revision);
  UPDATE public.payroll_accounts_deliveries SET disposition='WITH_HO',verified_by=p_actor_id,version=version+1 WHERE id=d.id;
  PERFORM public.payroll_accounts_event(d.id,'SENT_TO_HO',p_actor_id);
 END LOOP;
 SELECT * INTO cutoff FROM public.payroll_period_cutoffs WHERE run_id=r.id ORDER BY version DESC LIMIT 1;
 IF cutoff.run_id IS NULL THEN
  INSERT INTO public.payroll_period_cutoffs(run_id,version,cutoff_at,status,proposed_by,evidence_reference) VALUES(r.id,1,greatest(public.payroll_financial_clock(),(r.period_to+1)::timestamp AT TIME ZONE 'Asia/Kolkata'),'PROPOSED',p_actor_id,'Accounts sheet '||s.sheet_number||' submission');
 END IF;
 UPDATE public.acct_requisition_sheets SET sheet_status='Submitted',submitted_by=actor.mobile_number,submitted_at=now(),row_count_at_submission=(SELECT count(*) FROM public.acct_requisition_line_items WHERE sheet_id=s.id),updated_at=now() WHERE id=s.id RETURNING * INTO s;
 PERFORM set_config('app.payroll_accounts','off',true);RETURN jsonb_build_object('sheet',to_jsonb(s));
END $$;
CREATE FUNCTION public.act_payroll_accounts_item(p_delivery_id uuid,p_expected_version integer,p_action text,p_reason text,p_source jsonb,p_calculation jsonb,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE d public.payroll_accounts_deliveries; i public.acct_requisition_line_items; e public.payroll_run_employees; actor public.authorised_users; src jsonb; cutoff public.payroll_period_cutoffs; s public.acct_requisition_sheets;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,CASE WHEN p_action='ReturnSalary' THEN ARRAY['accounts','admin','ho'] ELSE ARRAY['admin','ho'] END);
 SELECT * INTO actor FROM public.authorised_users WHERE id=p_actor_id;
 SELECT * INTO d FROM public.payroll_accounts_deliveries WHERE id=p_delivery_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Salary delivery not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=d.row_id;
 PERFORM public.payroll_lock_review_sources(e.employee_id,e.run_id);
 SELECT * INTO e FROM public.payroll_run_employees WHERE id=d.row_id FOR UPDATE;
 SELECT * INTO d FROM public.payroll_accounts_deliveries WHERE id=p_delivery_id FOR UPDATE;
 SELECT * INTO i FROM public.acct_requisition_line_items WHERE id=d.item_id FOR UPDATE;
 IF p_action='Approve' AND d.disposition='APPROVED' THEN RETURN jsonb_build_object('applied',true,'already_approved',true); END IF;
 IF NOT d.active OR d.version<>p_expected_version OR d.disposition NOT IN ('WITH_ACCOUNTS','WITH_HO','HOLD') THEN RAISE EXCEPTION 'Salary review changed; refresh' USING ERRCODE='PY409'; END IF;
 IF e.created_by=p_actor_id OR e.submitted_by=p_actor_id OR (p_action<>'ReturnSalary' AND d.verified_by=p_actor_id) OR EXISTS(SELECT 1 FROM public.hr_employees WHERE id=e.employee_id AND erp_user_id=p_actor_id) THEN RAISE EXCEPTION 'Independent salary reviewer required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('Approve','ReturnSalary','ReturnPayment','Hold') OR (p_action<>'Approve' AND nullif(btrim(p_reason),'') IS NULL) THEN RAISE EXCEPTION 'Choose a salary action and provide a return/hold reason' USING ERRCODE='22023'; END IF;
 IF p_action<>'ReturnSalary' AND d.disposition='WITH_ACCOUNTS' THEN RAISE EXCEPTION 'Accounts must send the sheet to HO first' USING ERRCODE='PY409'; END IF;
 PERFORM set_config('app.payroll_accounts','on',true);
 IF p_action='Approve' THEN
  IF NOT public.payroll_financial_enabled() THEN RAISE EXCEPTION 'Financial finalization is disabled in this environment' USING ERRCODE='42501'; END IF;
  src:=public.payroll_review_source_snapshot(e.id,p_actor_id);
  IF p_source IS DISTINCT FROM src OR public.payroll_accounts_salary_source(src) IS DISTINCT FROM public.payroll_accounts_salary_source(d.source_snapshot) OR (p_calculation-'source_fingerprint') IS DISTINCT FROM (d.calculation_snapshot-'source_fingerprint') OR p_calculation->>'financial_readiness' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Salary sources or calculation changed; return for recalculation' USING ERRCODE='PY409'; END IF;
  IF i.req_amount>0 AND (d.recipient_snapshot IS NULL OR d.recipient_snapshot IS DISTINCT FROM public.payroll_accounts_recipient(d.beneficiary_id)) THEN RAISE EXCEPTION 'Employee payment details changed; return to Accounts' USING ERRCODE='PY409'; END IF;
  SELECT * INTO cutoff FROM public.payroll_period_cutoffs WHERE run_id=e.run_id ORDER BY version DESC LIMIT 1;
  IF cutoff.status='PROPOSED' THEN
   IF cutoff.proposed_by=p_actor_id THEN RAISE EXCEPTION 'Independent cutoff acceptance required' USING ERRCODE='42501'; END IF;
   INSERT INTO public.payroll_period_cutoffs(run_id,version,cutoff_at,status,proposed_by,approved_by,evidence_reference) VALUES(cutoff.run_id,cutoff.version+1,cutoff.cutoff_at,'APPROVED',cutoff.proposed_by,p_actor_id,'Accepted with salary approval') RETURNING * INTO cutoff;
  END IF;
  src:=jsonb_set(src,'{financial_context,cutoff}',to_jsonb(cutoff));
  PERFORM public.payroll_finalize_employee(e.id,d.calculation_snapshot,src,p_actor_id);
  UPDATE public.payroll_run_employees SET status='LOCKED',review_version=review_version+1 WHERE id=e.id RETURNING * INTO e;
  INSERT INTO public.payroll_action_history(run_id,row_id,row_version,action,actor_id,actor_role,from_status,to_status,review_version,review_revision) VALUES(e.run_id,e.id,e.current_version,'LOCKED',p_actor_id,actor.role,'PENDING_HO_APPROVAL','LOCKED',e.review_version,e.review_revision);
  IF i.req_amount>0 THEN i:=public.approve_acct_line_item_transact(i.id,'Approved',NULL,actor.mobile_number,p_reason);
  ELSE UPDATE public.acct_requisition_line_items SET requisition_status='Approved',ho_process='Approved',ho_pass_amount=0,ho_actioned_by=actor.mobile_number,ho_actioned_at=now() WHERE id=i.id; END IF;
  UPDATE public.payroll_accounts_deliveries SET disposition='APPROVED',version=version+1 WHERE id=d.id;
 ELSIF p_action='ReturnSalary' THEN
  UPDATE public.payroll_run_employees SET status='RETURNED_TO_CREATOR',review_version=review_version+1,accounts_verified_by=NULL,last_return_reason=p_reason,last_return_stage=CASE WHEN actor.role='accounts' THEN 'ACCOUNTS' ELSE 'HO' END WHERE id=e.id RETURNING * INTO e;
  INSERT INTO public.payroll_action_history(run_id,row_id,row_version,action,actor_id,actor_role,from_status,to_status,reason,review_version,review_revision) VALUES(e.run_id,e.id,e.current_version,'RETURNED',p_actor_id,actor.role,'PENDING_HO_APPROVAL',e.status,p_reason,e.review_version,e.review_revision);
  UPDATE public.acct_requisition_line_items SET requisition_status='Returned for Correction',ho_process='Returned for Correction',ho_remarks=p_reason,ho_actioned_by=actor.mobile_number,ho_actioned_at=now() WHERE id=i.id;
  UPDATE public.payroll_accounts_deliveries SET disposition='RETURNED',active=false,version=version+1 WHERE id=d.id;
 ELSE
  UPDATE public.acct_requisition_line_items SET requisition_status=CASE WHEN p_action='Hold' THEN 'On Hold' ELSE 'Returned for Correction' END,ho_process=CASE WHEN p_action='Hold' THEN 'Hold' ELSE 'Returned for Correction' END,ho_remarks=p_reason,ho_actioned_by=actor.mobile_number,ho_actioned_at=now() WHERE id=i.id;
  UPDATE public.payroll_accounts_deliveries SET disposition=CASE WHEN p_action='Hold' THEN 'HOLD' ELSE 'PAYMENT_RETURN' END,version=version+1 WHERE id=d.id;
 END IF;
 PERFORM public.payroll_accounts_event(d.id,p_action,p_actor_id,jsonb_build_object('reason',p_reason));
 PERFORM set_config('app.payroll_accounts','off',true);RETURN jsonb_build_object('applied',true);
END $$;
CREATE FUNCTION public.resubmit_payroll_payment(p_delivery_id uuid,p_expected_version integer,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE d public.payroll_accounts_deliveries;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']);
 SELECT * INTO d FROM public.payroll_accounts_deliveries WHERE id=p_delivery_id FOR UPDATE;
 IF d.id IS NULL OR NOT d.active OR d.version<>p_expected_version OR d.disposition<>'PAYMENT_RETURN' OR d.recipient_snapshot IS NULL OR d.recipient_snapshot IS DISTINCT FROM public.payroll_accounts_recipient(d.beneficiary_id) THEN RAISE EXCEPTION 'Refresh and complete the returned payment details first' USING ERRCODE='PY409'; END IF;
 PERFORM set_config('app.payroll_accounts','on',true);
 UPDATE public.acct_requisition_line_items SET last_ho_process=ho_process,last_ho_remarks=ho_remarks,last_ho_actioned_by=ho_actioned_by,last_ho_actioned_at=ho_actioned_at,ho_process=NULL,ho_remarks=NULL,ho_actioned_by=NULL,ho_actioned_at=NULL,requisition_status='Pending HO Review',revision_number=revision_number+1 WHERE id=d.item_id;
 UPDATE public.payroll_accounts_deliveries SET disposition='WITH_HO',verified_by=p_actor_id,version=version+1 WHERE id=d.id;
 PERFORM public.payroll_accounts_event(d.id,'PAYMENT_RESUBMITTED',p_actor_id);PERFORM set_config('app.payroll_accounts','off',true);RETURN jsonb_build_object('applied',true);
END $$;
CREATE FUNCTION public.confirm_payroll_payment(p_delivery_id uuid,p_paid_on date,p_reference text,p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE d public.payroll_accounts_deliveries; prior public.payroll_payment_confirmations; result public.payroll_payment_confirmations; amount numeric;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['accounts','admin']);
 SELECT * INTO d FROM public.payroll_accounts_deliveries WHERE id=p_delivery_id FOR UPDATE;
 IF d.disposition IS DISTINCT FROM 'APPROVED' THEN RAISE EXCEPTION 'Only approved salary can be recorded as paid' USING ERRCODE='PY409'; END IF;
 amount:=(d.calculation_snapshot->>'final_net_salary')::numeric;
 IF amount<=0 OR p_paid_on IS NULL OR NOT isfinite(p_paid_on) OR p_paid_on>(now() AT TIME ZONE 'Asia/Kolkata')::date OR nullif(btrim(p_reference),'') IS NULL OR length(p_reference)>200 THEN RAISE EXCEPTION 'Valid payment date and bank reference required for a positive payout' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM public.payroll_payment_confirmations WHERE delivery_id=d.id;
 IF FOUND THEN IF prior.paid_on IS DISTINCT FROM p_paid_on OR prior.reference IS DISTINCT FROM btrim(p_reference) THEN RAISE EXCEPTION 'Salary payment already recorded; use reconciliation corrections' USING ERRCODE='PY409'; END IF;RETURN to_jsonb(prior); END IF;
 INSERT INTO public.payroll_payment_confirmations(delivery_id,amount,paid_on,reference,recorded_by) VALUES(d.id,amount,p_paid_on,btrim(p_reference),p_actor_id) RETURNING * INTO result;
 PERFORM public.payroll_accounts_event(d.id,'PAYMENT_RECORDED',p_actor_id,jsonb_build_object('confirmation_id',result.id));RETURN to_jsonb(result);
END $$;
-- Enforce the single action route for linked salary rows, including raw RPC callers.
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.transition_payroll_employee_review(uuid,integer,integer,text,jsonb,uuid)'::regprocedure) INTO def;
 def:=replace(def,'BEGIN',E'BEGIN\n IF current_setting(''app.payroll_accounts'',true) IS DISTINCT FROM ''on'' AND EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries WHERE row_id=p_row_id AND active) THEN RAISE EXCEPTION ''Use the linked Accounts salary sheet'' USING ERRCODE=''PY409''; END IF;');
 EXECUTE def;
END $patch$;
-- A held salary resumes on its current linked row, retaining the previous decision.
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.act_payroll_accounts_item(uuid,integer,text,text,jsonb,jsonb,uuid)'::regprocedure) INTO def;
 def:=replace(def,'IF i.req_amount>0 THEN i:=public.approve_acct_line_item_transact',$new$IF d.disposition='HOLD' THEN UPDATE public.acct_requisition_line_items SET last_ho_process=ho_process,last_ho_remarks=ho_remarks,last_ho_actioned_by=ho_actioned_by,last_ho_actioned_at=ho_actioned_at,ho_process=NULL,ho_actioned_by=NULL,ho_actioned_at=NULL,requisition_status='Pending HO Review' WHERE id=i.id; END IF;
  IF i.req_amount>0 THEN i:=public.approve_acct_line_item_transact$new$);
 EXECUTE def;
END $patch$;
DO $permissions$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('payroll_accounts_salary_source','payroll_accounts_guard','payroll_accounts_event','deliver_payroll_to_accounts','payroll_accounts_recipient','get_payroll_accounts_sheet','save_payroll_payment_details','submit_payroll_accounts_sheet','act_payroll_accounts_item','resubmit_payroll_payment','confirm_payroll_payment') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP; END $permissions$;
GRANT EXECUTE ON FUNCTION public.deliver_payroll_to_accounts(uuid,integer,integer,text,uuid,boolean),public.get_payroll_accounts_sheet(uuid,uuid),public.save_payroll_payment_details(uuid,integer,text,text,uuid,text,text,uuid),public.submit_payroll_accounts_sheet(uuid,uuid),public.act_payroll_accounts_item(uuid,integer,text,text,jsonb,jsonb,uuid),public.resubmit_payroll_payment(uuid,integer,uuid),public.confirm_payroll_payment(uuid,date,text,uuid) TO service_role;
