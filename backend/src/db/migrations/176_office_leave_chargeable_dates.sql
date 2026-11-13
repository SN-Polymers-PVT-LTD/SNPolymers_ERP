-- Office payroll uses the dates explicitly confirmed by HO, not an attendance calendar.
-- Existing decisions remain NULL and continue through the historical calculation path.
ALTER TABLE public.hr_leave_requests ADD COLUMN chargeable_dates date[];

CREATE FUNCTION public.hr_office_leave_chargeable_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,extensions AS $$
DECLARE office boolean;
BEGIN
 office := NEW.request_source='SELF_SERVICE' AND NEW.employee_category IN ('HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office');
 IF TG_OP='INSERT' OR NEW.approval_status='Pending' THEN
  IF NEW.chargeable_dates IS NOT NULL THEN RAISE EXCEPTION 'Chargeable days are confirmed only when leave is decided' USING ERRCODE='22023'; END IF;
 ELSIF TG_OP='UPDATE' AND OLD.approval_status='Pending' AND office THEN
  IF NEW.pay_treatment='Unpaid' OR NEW.approval_status='Rejected' THEN
   IF NEW.chargeable_dates IS NULL OR cardinality(NEW.chargeable_dates)>733 OR
      EXISTS (SELECT 1 FROM unnest(NEW.chargeable_dates) d WHERE d IS NULL OR d<NEW.from_date OR d>NEW.to_date) OR
      cardinality(NEW.chargeable_dates)<>(SELECT count(DISTINCT d) FROM unnest(NEW.chargeable_dates) d)
   THEN RAISE EXCEPTION 'Select valid, unique chargeable dates within the leave period' USING ERRCODE='22023'; END IF;
  ELSIF NEW.chargeable_dates IS NOT NULL THEN
   RAISE EXCEPTION 'Paid leave cannot have chargeable dates' USING ERRCODE='22023';
  END IF;
 ELSIF NEW.chargeable_dates IS DISTINCT FROM OLD.chargeable_dates THEN
  RAISE EXCEPTION 'Chargeable dates are immutable' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a01_office_leave_chargeable_guard BEFORE INSERT OR UPDATE ON public.hr_leave_requests FOR EACH ROW EXECUTE FUNCTION public.hr_office_leave_chargeable_guard();
REVOKE ALL ON FUNCTION public.hr_office_leave_chargeable_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.decide_office_leave_with_chargeable_dates(p_leave_id uuid,p_decision text,p_pay_treatment text,p_remarks text,p_actor_id uuid,p_chargeable_dates date[])
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE l public.hr_leave_requests%ROWTYPE;
BEGIN
 PERFORM public.hr_attendance_require_actor(p_actor_id,ARRAY['admin','ho']);
 SELECT * INTO l FROM public.hr_leave_requests WHERE id=p_leave_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Leave not found' USING ERRCODE='P0002'; END IF;
 IF l.request_source<>'SELF_SERVICE' OR l.employee_category NOT IN ('HO Staff','Projects Department Employees','Zonal Office','Junior Engineer','Local project supervisor','Head office') THEN RAISE EXCEPTION 'Office self-service leave required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hr_leave:'||l.employee_id::text,0));
 SELECT * INTO l FROM public.hr_leave_requests WHERE id=p_leave_id FOR UPDATE;
 IF l.approval_status<>'Pending' THEN RAISE EXCEPTION 'Decided leave is immutable' USING ERRCODE='P0001'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('Approved','Rejected') OR p_pay_treatment IS NULL OR p_pay_treatment NOT IN ('Paid','Unpaid') OR (p_decision='Rejected' AND p_pay_treatment<>'Unpaid') OR (p_remarks IS NOT NULL AND length(p_remarks)>2000) THEN RAISE EXCEPTION 'Invalid leave decision' USING ERRCODE='22023'; END IF;
 UPDATE public.hr_leave_requests SET approval_status=p_decision,pay_treatment=p_pay_treatment,decision_remarks=p_remarks,updated_by=p_actor_id,chargeable_dates=p_chargeable_dates WHERE id=p_leave_id RETURNING * INTO l;
 RETURN l;
END $$;
REVOKE ALL ON FUNCTION public.decide_office_leave_with_chargeable_dates(uuid,text,text,text,uuid,date[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.decide_office_leave_with_chargeable_dates(uuid,text,text,text,uuid,date[]) TO service_role;

-- Preserve the existing source resolver and its locking semantics while including the
-- immutable decision in the same MVCC snapshot and source fingerprint.
DO $patch$ DECLARE def text; target text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_preview_sources(uuid,uuid)'::regprocedure) INTO def;
 target := '''updated_at'',l.updated_at) ORDER BY from_date,id';
 IF position(target IN def)=0 THEN RAISE EXCEPTION 'Leave source patch target missing'; END IF;
 def:=replace(def,target,'''updated_at'',l.updated_at) || CASE WHEN l.chargeable_dates IS NULL THEN ''{}''::jsonb ELSE jsonb_build_object(''request_source'',l.request_source,''chargeable_dates'',l.chargeable_dates) END ORDER BY from_date,id');
 EXECUTE def;
END $patch$;
