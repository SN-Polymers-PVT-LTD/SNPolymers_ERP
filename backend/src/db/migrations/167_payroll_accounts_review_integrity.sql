-- Preserve source fences and monthly serialization on the unified approval path.
CREATE FUNCTION public.payroll_accounts_source_current(p_delivery uuid,p_actor uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=public,extensions AS $$
DECLARE d public.payroll_accounts_deliveries;
BEGIN
 SELECT * INTO d FROM public.payroll_accounts_deliveries WHERE id=p_delivery;
 IF NOT d.active OR d.disposition='APPROVED' THEN RETURN true; END IF;
 RETURN public.payroll_accounts_salary_source(d.source_snapshot) IS NOT DISTINCT FROM public.payroll_accounts_salary_source(public.payroll_review_source_snapshot(d.row_id,p_actor));
EXCEPTION WHEN invalid_parameter_value THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.payroll_accounts_source_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_accounts_sheet(uuid,uuid)'::regprocedure) INTO def;
 def:=replace(def,$old$CASE WHEN d.disposition='APPROVED' THEN false ELSE public.payroll_accounts_salary_source(d.source_snapshot) IS DISTINCT FROM public.payroll_accounts_salary_source(public.payroll_review_source_snapshot(d.row_id,p_actor_id)) END$old$,$new$NOT public.payroll_accounts_source_current(d.id,p_actor_id)$new$);EXECUTE def;
 SELECT pg_get_functiondef('public.get_payroll_employee_review(uuid,uuid)'::regprocedure) INTO def;
 def:=replace(def,'RETURN result||jsonb_build_object', $new$result:=result||jsonb_build_object('delivery_source_current',(SELECT public.payroll_accounts_salary_source(dl.source_snapshot) IS NOT DISTINCT FROM public.payroll_accounts_salary_source(src) FROM public.payroll_accounts_deliveries dl WHERE dl.row_id=e.id AND dl.active));
 RETURN result||jsonb_build_object$new$);EXECUTE def;
 SELECT pg_get_functiondef('public.get_payroll_review_queue(uuid,uuid,text,integer,integer)'::regprocedure) INTO def;
 def:=replace(def,$old$'DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW'$old$,$new$'DRAFT','CALCULATED','IN_ACCOUNTS_SHEET','PENDING_ACCOUNTS_REVIEW'$new$);
 def:=replace(def,'jsonb_agg(to_jsonb(e) ORDER BY created_at DESC,id) FROM page e', $new$jsonb_agg(to_jsonb(e)||jsonb_build_object('accounts_delivery',public.payroll_accounts_receipt(e.id)) ORDER BY created_at DESC,id) FROM page e$new$);EXECUTE def;
 SELECT pg_get_functiondef('public.get_payroll_salary_register(uuid,jsonb,integer,integer)'::regprocedure) INTO def;
 def:=replace(def,$old$'DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW'$old$,$new$'DRAFT','CALCULATED','IN_ACCOUNTS_SHEET','PENDING_ACCOUNTS_REVIEW'$new$);EXECUTE def;
 SELECT pg_get_functiondef('public.act_payroll_accounts_item(uuid,integer,text,text,jsonb,jsonb,uuid)'::regprocedure) INTO def;
 def:=replace(def,'s public.acct_requisition_sheets;','s public.acct_requisition_sheets; m date; recipient_bank uuid;');
 def:=replace(def,'PERFORM public.payroll_lock_review_sources(e.employee_id,e.run_id);',$new$PERFORM public.payroll_lock_review_sources(e.employee_id,e.run_id);
 PERFORM 1 FROM public.hr_employees WHERE id=e.employee_id FOR UPDATE;
 IF p_action='Approve' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll_cutoff:'||e.run_id::text,0));
  FOR m IN SELECT generate_series(date_trunc('month',e.period_from),date_trunc('month',e.period_to),interval '1 month')::date LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('payroll_employee_month:'||e.employee_id::text||':'||m::text,0));
  END LOOP;
 END IF;$new$);
 def:=replace(def,$old$IF e.created_by=p_actor_id OR e.submitted_by=p_actor_id OR (p_action<>'ReturnSalary' AND d.verified_by=p_actor_id) OR EXISTS(SELECT 1 FROM public.hr_employees WHERE id=e.employee_id AND erp_user_id=p_actor_id) THEN$old$,$new$IF (p_action<>'ReturnSalary' AND (e.created_by=p_actor_id OR e.submitted_by=p_actor_id OR d.verified_by=p_actor_id OR EXISTS(SELECT 1 FROM public.hr_employees WHERE id=e.employee_id AND erp_user_id=p_actor_id))) THEN$new$);
 def:=replace(def,$match$ IF p_action NOT IN$match$,$new$ IF actor.role='accounts' AND d.disposition<>'WITH_ACCOUNTS' THEN RAISE EXCEPTION 'Only HO can return a salary that is under HO review' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN$new$);
 def:=replace(def,$match$(p_calculation-'source_fingerprint') IS DISTINCT FROM (d.calculation_snapshot-'source_fingerprint')$match$,$new$(p_calculation-ARRAY['source_fingerprint','beneficiary']) IS DISTINCT FROM (d.calculation_snapshot-ARRAY['source_fingerprint','beneficiary'])$new$);
 def:=replace(def,$match$  src:=public.payroll_review_source_snapshot(e.id,p_actor_id);$match$,$new$  IF d.beneficiary_id IS NOT NULL THEN
   PERFORM public.payroll_source_fence('beneficiary:'||d.beneficiary_id::text,true);
   SELECT beneficiary_bank_id INTO recipient_bank FROM public.beneficiary_master WHERE id=d.beneficiary_id;
   IF recipient_bank IS NOT NULL THEN PERFORM public.payroll_source_fence('bank:'||recipient_bank::text,true); END IF;
  END IF;
  src:=public.payroll_review_source_snapshot(e.id,p_actor_id);$new$);
 def:=replace(def,$match$  PERFORM public.payroll_finalize_employee(e.id,d.calculation_snapshot,src,p_actor_id);$match$,$new$  src:=src||jsonb_build_object('payment_recipient',d.recipient_snapshot);
  PERFORM public.payroll_finalize_employee(e.id,d.calculation_snapshot,src,p_actor_id);$new$);
 def:=replace(def,$match$'PENDING_HO_APPROVAL',e.status,p_reason$match$,$new$CASE WHEN d.disposition='WITH_ACCOUNTS' THEN 'IN_ACCOUNTS_SHEET' ELSE 'PENDING_HO_APPROVAL' END,e.status,p_reason$new$);
 def:=replace(def,$match$ PERFORM public.payroll_accounts_event(d.id,p_action$match$,$new$ SELECT * INTO s FROM public.acct_requisition_sheets WHERE id=i.sheet_id;
 IF s.sheet_status='Submitted' AND NOT EXISTS(SELECT 1 FROM public.payroll_accounts_deliveries dl JOIN public.acct_requisition_line_items li ON li.id=dl.item_id WHERE li.sheet_id=s.id AND dl.active AND dl.disposition<>'APPROVED') THEN
  UPDATE public.acct_requisition_sheets SET sheet_status='Reviewed',updated_at=now() WHERE id=s.id;
 END IF;
 PERFORM public.payroll_accounts_event(d.id,p_action$new$);EXECUTE def;
 -- Valid known recipients are prefilled; bank/mode remain explicit Accounts choices.
 SELECT pg_get_functiondef('public.deliver_payroll_to_accounts(uuid,integer,integer,text,uuid,boolean)'::regprocedure) INTO def;
 def:=replace(def,' PERFORM public.payroll_accounts_event(link.id,', $new$ IF link.beneficiary_id IS NOT NULL AND public.payroll_accounts_recipient(link.beneficiary_id) IS NOT NULL THEN
  UPDATE public.acct_requisition_line_items SET beneficiary_ac_no=b.account_number,beneficiary_ifsc=b.ifsc,beneficiary_name=b.beneficiary_name,beneficiary_bank_id=b.beneficiary_bank_id,beneficiary_bank_name=b.beneficiary_bank_name FROM public.beneficiary_master b WHERE acct_requisition_line_items.id=item.id AND b.id=link.beneficiary_id;
  UPDATE public.payroll_accounts_deliveries SET recipient_snapshot=public.payroll_accounts_recipient(link.beneficiary_id),version=version+1 WHERE id=link.id;
 END IF;
 PERFORM public.payroll_accounts_event(link.id,$new$);EXECUTE def;
END $patch$;
CREATE FUNCTION public.payroll_accounts_delivery_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,extensions AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.disposition='APPROVED' OR
 (to_jsonb(NEW)-ARRAY['active','version','disposition','beneficiary_id','recipient_snapshot','verified_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','version','disposition','beneficiary_id','recipient_snapshot','verified_by','updated_at']) OR NEW.version<>OLD.version+1 OR (NOT OLD.active AND NEW.active) THEN RAISE EXCEPTION 'Salary delivery history is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_accounts_delivery_guard BEFORE UPDATE OR DELETE ON public.payroll_accounts_deliveries FOR EACH ROW EXECUTE FUNCTION public.payroll_accounts_delivery_guard();
REVOKE ALL ON FUNCTION public.payroll_accounts_delivery_guard() FROM PUBLIC,anon,authenticated,service_role;
