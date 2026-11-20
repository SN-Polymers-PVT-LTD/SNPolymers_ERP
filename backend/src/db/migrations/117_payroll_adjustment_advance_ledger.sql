-- Approved employee ledger. Payments are not recorded or initiated here.
CREATE TABLE public.payroll_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE RESTRICT,
 assignment_id uuid NOT NULL, target_row_id uuid,
 kind text NOT NULL CHECK(kind IN ('BONUS','SALARY_ARREARS','ADVANCE')),
 amount numeric(14,2) NOT NULL CHECK(amount<>0 AND abs(amount)<1000000000000),
 effective_date date NOT NULL CHECK(isfinite(effective_date)),
 original_period_from date,original_period_to date,
 installment numeric(14,2), recovery_start_month date,
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 2000),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REJECTED','PAUSED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES public.authorised_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES public.authorised_users(id),approved_at timestamptz,
 FOREIGN KEY(assignment_id,employee_id) REFERENCES public.payroll_employee_assignments(id,employee_id),
 FOREIGN KEY(target_row_id,employee_id) REFERENCES public.payroll_run_employees(id,employee_id),
 CHECK((kind='ADVANCE' AND amount>0 AND installment IS NOT NULL AND installment>0 AND installment<=amount AND recovery_start_month IS NOT NULL AND isfinite(recovery_start_month) AND extract(day FROM recovery_start_month)=1 AND target_row_id IS NULL)
  OR (kind<>'ADVANCE' AND target_row_id IS NOT NULL AND installment IS NULL AND recovery_start_month IS NULL)),
 CHECK(kind<>'BONUS' OR amount>0),
 CHECK((kind='SALARY_ARREARS' AND original_period_from IS NOT NULL AND original_period_to IS NOT NULL AND isfinite(original_period_from) AND isfinite(original_period_to) AND original_period_to>=original_period_from AND original_period_to<effective_date)
  OR (kind<>'SALARY_ARREARS' AND original_period_from IS NULL AND original_period_to IS NULL)),
 CHECK((status IN ('APPROVED','PAUSED') AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by<>created_by) OR (status IN ('DRAFT','REJECTED') AND approved_by IS NULL AND approved_at IS NULL)),
 UNIQUE(id,employee_id)
);
CREATE INDEX payroll_adjustment_employee_idx ON public.payroll_adjustments(employee_id,effective_date,id);
CREATE TABLE public.payroll_adjustment_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,adjustment_id uuid NOT NULL REFERENCES public.payroll_adjustments(id),version integer NOT NULL,
 action text NOT NULL CHECK(action IN ('CREATE','APPROVE','REJECT','PAUSE','RESUME','REVISE_PLAN')),
 before_snapshot jsonb,after_snapshot jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES public.authorised_users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(adjustment_id,version)
);
CREATE TRIGGER payroll_immutable BEFORE UPDATE OR DELETE ON public.payroll_adjustment_events FOR EACH ROW EXECUTE FUNCTION public.payroll_immutable();
ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_adjustment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_adjustments,public.payroll_adjustment_events FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_payroll_adjustment(p_employee_id uuid,p_data jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE a public.payroll_employee_assignments%ROWTYPE; r public.payroll_adjustments%ROWTYPE; role text; target public.payroll_run_employees%ROWTYPE;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['factory_manager','accounts','ho','admin']);
 PERFORM 1 FROM public.hr_employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('kind','amount','effective_date','target_row_id','original_period_from','original_period_to','installment','recovery_start_month','evidence_reference'))
  OR coalesce(p_data->>'amount','') !~ '^-?[0-9]+(\.[0-9]{1,2})?$' OR public.payroll_check_decimal(to_jsonb(ltrim(p_data->>'amount','-')),999999999999) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Invalid adjustment fields' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.payroll_employee_assignments WHERE employee_id=p_employee_id AND revision_id=(SELECT id FROM public.payroll_source_history_revisions WHERE employee_id=p_employee_id AND source_kind='ASSIGNMENT' ORDER BY version DESC LIMIT 1)
  AND (p_data->>'effective_date')::date>=effective_from AND (effective_to IS NULL OR (p_data->>'effective_date')::date<=effective_to);
 IF NOT FOUND THEN RAISE EXCEPTION 'Current evidenced assignment required' USING ERRCODE='22023'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,a.department,false);
 IF p_data->>'kind'='ADVANCE' AND ((p_data->>'effective_date')::date>(now() AT TIME ZONE 'Asia/Kolkata')::date OR coalesce(p_data->>'installment','') !~ '^[0-9]+(\.[0-9]{1,2})?$') THEN RAISE EXCEPTION 'Record an already issued advance with a paise-precision recovery plan' USING ERRCODE='22023'; END IF;
 IF p_data->>'kind'<>'ADVANCE' THEN
  SELECT * INTO target FROM public.payroll_run_employees WHERE id=(p_data->>'target_row_id')::uuid AND employee_id=p_employee_id FOR UPDATE;
  IF NOT FOUND OR target.status IN ('LOCKED','CANCELLED_DRAFT') OR (p_data->>'effective_date')::date NOT BETWEEN target.period_from AND target.period_to THEN RAISE EXCEPTION 'Select an unlocked employee row covering the adjustment date' USING ERRCODE='22023'; END IF;
  PERFORM public.payroll_require_scope(p_actor_id,(SELECT department FROM public.payroll_runs WHERE id=target.run_id),false);
 END IF;
 INSERT INTO public.payroll_adjustments(employee_id,assignment_id,target_row_id,kind,amount,effective_date,original_period_from,original_period_to,installment,recovery_start_month,evidence_reference,created_by)
 VALUES(p_employee_id,a.id,(p_data->>'target_row_id')::uuid,p_data->>'kind',(p_data->>'amount')::numeric,(p_data->>'effective_date')::date,(p_data->>'original_period_from')::date,(p_data->>'original_period_to')::date,(p_data->>'installment')::numeric,(p_data->>'recovery_start_month')::date,p_data->>'evidence_reference',p_actor_id) RETURNING * INTO r;
 INSERT INTO public.payroll_adjustment_events(adjustment_id,version,action,after_snapshot,reason,actor_id) VALUES(r.id,r.version,'CREATE',to_jsonb(r),r.evidence_reference,p_actor_id);
 RETURN public.payroll_preview_decimals(to_jsonb(r),ARRAY['amount','installment']);
END; $$;
CREATE FUNCTION public.act_payroll_adjustment(p_id uuid,p_expected_version integer,p_action text,p_reason text,p_data jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.payroll_adjustments%ROWTYPE; old_r jsonb; emp uuid; role text; department text;
BEGIN
 role:=public.payroll_require_actor(p_actor_id,ARRAY['accounts','ho','admin','factory_manager']);
 SELECT employee_id INTO emp FROM public.payroll_adjustments WHERE id=p_id;
 PERFORM 1 FROM public.hr_employees WHERE id=emp FOR UPDATE;
 SELECT * INTO r FROM public.payroll_adjustments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found' USING ERRCODE='P0002'; END IF;
 SELECT a.department INTO department FROM public.payroll_employee_assignments a WHERE a.id=r.assignment_id;
 PERFORM public.payroll_require_scope(p_actor_id,department,false);
 IF r.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Adjustment changed; reload' USING ERRCODE='PY409'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Action reason required' USING ERRCODE='22023'; END IF;
 old_r:=to_jsonb(r);
 IF p_action='revise_plan' THEN
  IF r.kind<>'ADVANCE' OR r.status NOT IN ('APPROVED','PAUSED') OR role NOT IN ('accounts','admin') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('installment','recovery_start_month')) THEN RAISE EXCEPTION 'Only Accounts may prepare an advance plan revision' USING ERRCODE='42501'; END IF;
  IF coalesce(p_data->>'installment','') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Paise-precision installment required' USING ERRCODE='22023'; END IF;
  UPDATE public.payroll_adjustments SET status='DRAFT',installment=(p_data->>'installment')::numeric,recovery_start_month=(p_data->>'recovery_start_month')::date,approved_by=NULL,approved_at=NULL,version=version+1 WHERE id=p_id RETURNING * INTO r;
 ELSE
  IF role<>'ho' OR r.created_by=p_actor_id OR EXISTS(SELECT 1 FROM public.hr_employees WHERE id=r.employee_id AND erp_user_id=p_actor_id) THEN RAISE EXCEPTION 'Independent HO adjustment approval required' USING ERRCODE='42501'; END IF;
  IF p_data<>'{}'::jsonb OR NOT ((p_action IN ('approve','reject') AND r.status='DRAFT') OR (p_action='pause' AND r.kind='ADVANCE' AND r.status='APPROVED') OR (p_action='resume' AND r.kind='ADVANCE' AND r.status='PAUSED')) THEN RAISE EXCEPTION 'Invalid adjustment transition' USING ERRCODE='PY409'; END IF;
  UPDATE public.payroll_adjustments SET status=CASE p_action WHEN 'approve' THEN 'APPROVED' WHEN 'reject' THEN 'REJECTED' WHEN 'pause' THEN 'PAUSED' ELSE 'APPROVED' END,
   approved_by=CASE WHEN p_action='reject' THEN NULL ELSE p_actor_id END,approved_at=CASE WHEN p_action='reject' THEN NULL ELSE now() END,version=version+1 WHERE id=p_id RETURNING * INTO r;
 END IF;
 INSERT INTO public.payroll_adjustment_events(adjustment_id,version,action,before_snapshot,after_snapshot,reason,actor_id) VALUES(r.id,r.version,upper(p_action),old_r,to_jsonb(r),p_reason,p_actor_id);
 RETURN public.payroll_preview_decimals(to_jsonb(r),ARRAY['amount','installment']);
END; $$;
CREATE FUNCTION public.get_payroll_adjustments(p_employee_id uuid,p_actor_id uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; d text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['factory_manager','accounts','ho','admin']);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023'; END IF;
 -- Reclassification cannot hide the historical factory grant needed for a ledger row.
 SELECT department INTO d FROM public.hr_employees WHERE id=p_employee_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found' USING ERRCODE='P0002'; END IF;
 PERFORM public.payroll_require_scope(p_actor_id,d,false);
 FOR d IN SELECT DISTINCT a.department FROM public.payroll_adjustments x JOIN public.payroll_employee_assignments a ON a.id=x.assignment_id WHERE x.employee_id=p_employee_id LOOP PERFORM public.payroll_require_scope(p_actor_id,d,false); END LOOP;
 WITH page AS (SELECT * FROM public.payroll_adjustments WHERE employee_id=p_employee_id ORDER BY created_at DESC,id LIMIT p_limit OFFSET (p_page-1)*p_limit)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(public.payroll_preview_decimals(to_jsonb(x),ARRAY['amount','installment'])||jsonb_build_object('history',(SELECT jsonb_agg(to_jsonb(e) ORDER BY version) FROM public.payroll_adjustment_events e WHERE e.adjustment_id=x.id)) ORDER BY created_at DESC,id) FROM page x),'[]'),
  'total',(SELECT count(*) FROM public.payroll_adjustments WHERE employee_id=p_employee_id),'page',p_page,'limit',p_limit,'payments_enabled',false) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.create_payroll_adjustment(uuid,jsonb,uuid),public.act_payroll_adjustment(uuid,integer,text,text,jsonb,uuid),public.get_payroll_adjustments(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_payroll_adjustment(uuid,jsonb,uuid),public.act_payroll_adjustment(uuid,integer,text,text,jsonb,uuid),public.get_payroll_adjustments(uuid,uuid,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
