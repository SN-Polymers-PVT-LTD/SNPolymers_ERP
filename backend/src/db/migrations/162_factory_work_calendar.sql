-- Recurring factory calendars. Existing published calendar evidence remains intact.
SET LOCAL search_path=public,extensions;
CREATE TABLE public.factory_calendar_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 department text NOT NULL CHECK(department IN ('SNP Factory','Fabric Factory')),
 version integer NOT NULL CHECK(version>0),
 action text NOT NULL CHECK(action IN ('SCHEDULE','DAY_OFF','WORKING','RESET')),
 applies_on date NOT NULL CHECK(isfinite(applies_on)),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120),
 created_by uuid NOT NULL REFERENCES public.authorised_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(department,version)
);
CREATE UNIQUE INDEX factory_calendar_initial_schedule ON public.factory_calendar_revisions(department) WHERE action='SCHEDULE';
CREATE INDEX factory_calendar_date_revision ON public.factory_calendar_revisions(department,applies_on,version DESC);
ALTER TABLE public.factory_calendar_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.factory_calendar_revisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.factory_calendar_revisions TO service_role;
CREATE FUNCTION public.guard_factory_calendar_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE first_day date;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Calendar history is immutable' USING ERRCODE='PY409'; END IF;
 PERFORM public.payroll_require_actor(NEW.created_by,ARRAY['admin','ho']);
 PERFORM public.payroll_require_scope(NEW.created_by,NEW.department,false);
 PERFORM public.payroll_source_fence('factory-calendar:'||NEW.department,false);
 SELECT applies_on INTO first_day FROM public.factory_calendar_revisions WHERE department=NEW.department AND action='SCHEDULE';
 IF NEW.action<>'SCHEDULE' AND (first_day IS NULL OR NEW.applies_on<first_day) THEN RAISE EXCEPTION 'Set up the calendar first; exceptions must be on or after its start date' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.payroll_run_employees e JOIN public.payroll_runs r ON r.id=e.run_id
  WHERE e.status='LOCKED' AND r.department=NEW.department AND
   (CASE WHEN NEW.action='SCHEDULE' THEN e.period_to>=NEW.applies_on ELSE NEW.applies_on BETWEEN e.period_from AND e.period_to END)) THEN
  RAISE EXCEPTION 'This calendar change affects locked payroll; use the payroll correction workflow' USING ERRCODE='PY409'; END IF;
 SELECT coalesce(max(version),0)+1 INTO NEW.version FROM public.factory_calendar_revisions WHERE department=NEW.department;
 NEW.created_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER factory_calendar_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON public.factory_calendar_revisions FOR EACH ROW EXECUTE FUNCTION public.guard_factory_calendar_revision();
CREATE FUNCTION public.save_factory_calendar(p_department text,p_expected_version integer,p_action text,p_date date,p_label text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE current_version integer; saved public.factory_calendar_revisions;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','ho']);
 PERFORM public.payroll_require_scope(p_actor_id,p_department,false);
 IF p_department NOT IN ('SNP Factory','Fabric Factory') OR p_department IS NULL OR p_action NOT IN ('SCHEDULE','DAY_OFF','WORKING','RESET') OR p_action IS NULL OR p_date IS NULL OR NOT isfinite(p_date) OR p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid factory calendar change' USING ERRCODE='22023'; END IF;
 PERFORM public.payroll_source_fence('factory-calendar:'||p_department,false);
 SELECT coalesce(max(version),0) INTO current_version FROM public.factory_calendar_revisions WHERE department=p_department;
 IF p_expected_version IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'Calendar changed. Refresh and try again.' USING ERRCODE='PY409'; END IF;
 INSERT INTO public.factory_calendar_revisions(department,version,action,applies_on,label,created_by) VALUES(p_department,1,p_action,p_date,btrim(p_label),p_actor_id) RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
-- Read-only date resolution; no writes or background jobs are needed for future months.
CREATE FUNCTION public.resolve_factory_calendar(p_department text,p_group text,p_from date,p_to date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
 WITH schedule AS (SELECT * FROM public.factory_calendar_revisions WHERE department=p_department AND action='SCHEDULE'),
 dates AS (SELECT d::date cal_date FROM generate_series(p_from,p_to,interval '1 day') d WHERE p_to-p_from BETWEEN 0 AND 731),
 resolved AS (
 SELECT d.cal_date,s.id schedule_id,x.id exception_id,x.action,x.label,
  CASE WHEN x.action='WORKING' THEN 'Special Working Day' WHEN x.action='DAY_OFF' THEN CASE WHEN g.is_permanent THEN 'Paid Holiday' ELSE 'Unpaid Closure' END
   WHEN extract(isodow FROM d.cal_date)=7 THEN 'Weekly Off' ELSE 'Scheduled Workday' END day_type,
  CASE WHEN g.is_permanent OR (x.action IS DISTINCT FROM 'DAY_OFF' AND (x.action='WORKING' OR extract(isodow FROM d.cal_date)<>7)) THEN 'PAID' ELSE 'UNPAID' END compensation,
  CASE WHEN x.action='WORKING' THEN false WHEN x.action='DAY_OFF' THEN true ELSE extract(isodow FROM d.cal_date)=7 END is_off
 FROM dates d JOIN schedule s ON d.cal_date>=s.applies_on JOIN public.payroll_groups g ON g.code=p_group
 LEFT JOIN LATERAL (SELECT * FROM public.factory_calendar_revisions e WHERE e.department=p_department AND e.applies_on=d.cal_date AND e.action<>'SCHEDULE' ORDER BY version DESC LIMIT 1) x ON true),
 rows AS (
 SELECT to_jsonb(c) obj,c.calendar_date cal_date FROM public.payroll_work_calendar_days c
 WHERE c.department=p_department AND c.group_code=p_group AND c.calendar_date BETWEEN p_from AND p_to
 AND NOT EXISTS(SELECT 1 FROM resolved r WHERE r.cal_date=c.calendar_date AND r.action IN ('WORKING','DAY_OFF'))
 UNION ALL
 SELECT jsonb_build_object('id','factory-calendar:'||r.schedule_id||':'||coalesce(r.exception_id::text,'default')||':'||p_group||':'||r.cal_date,
  'calendar_date',r.cal_date,'department',p_department,'group_code',p_group,'day_type',r.day_type,'compensation_treatment',r.compensation,'status','PUBLISHED',
  'managed',true,'is_off',r.is_off,'holiday',r.action='DAY_OFF','label',CASE WHEN r.action IN ('WORKING','DAY_OFF') THEN r.label WHEN r.is_off THEN 'Sunday off' ELSE 'Working day' END,
  'schedule_revision_id',r.schedule_id,'exception_revision_id',r.exception_id) obj,r.cal_date
 FROM resolved r WHERE r.action IN ('WORKING','DAY_OFF') OR NOT EXISTS(SELECT 1 FROM public.payroll_work_calendar_days c WHERE c.department=p_department AND c.group_code=p_group AND c.calendar_date=r.cal_date)
 ) SELECT coalesce(jsonb_agg(obj ORDER BY cal_date,obj->>'id'),'[]') FROM rows
$$;
CREATE FUNCTION public.get_factory_calendar(p_department text,p_from date,p_to date,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE grp text;
BEGIN
 PERFORM public.payroll_require_actor(p_actor_id,ARRAY['admin','ho','accounts','factory_manager']);
 PERFORM public.payroll_require_scope(p_actor_id,p_department,false);
 IF p_department IS NULL OR p_department NOT IN ('SNP Factory','Fabric Factory') OR p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to-p_from NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'Select a factory and a calendar range of at most one year' USING ERRCODE='22023'; END IF;
 SELECT d.group_code INTO grp FROM public.payroll_group_departments d JOIN public.payroll_groups g ON g.code=d.group_code WHERE d.department=p_department AND g.is_permanent ORDER BY d.group_code LIMIT 1;
 RETURN jsonb_build_object('version',(SELECT coalesce(max(version),0) FROM public.factory_calendar_revisions WHERE department=p_department),
  'schedule',(SELECT to_jsonb(s) FROM public.factory_calendar_revisions s WHERE department=p_department AND action='SCHEDULE'),
  'days',public.resolve_factory_calendar(p_department,grp,p_from,p_to),
  'changes',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.version DESC) FROM (SELECT * FROM public.factory_calendar_revisions WHERE department=p_department AND applies_on BETWEEN p_from AND p_to ORDER BY version DESC LIMIT 100) e),'[]'));
END $$;
-- Preserve one MVCC source snapshot and resolve every dated assignment scope (including transfers).
DO $patch$ DECLARE def text; old text; BEGIN
 SELECT pg_get_functiondef('public.get_payroll_preview_sources(uuid,uuid)'::regprocedure) INTO def;
 old:='''calendar'',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY calendar_date,id) FROM public.payroll_work_calendar_days c WHERE c.calendar_date BETWEEN lo AND hi AND c.group_code=r.group_code AND c.department=r.department),''[]'')';
 IF position(old IN def)=0 THEN RAISE EXCEPTION 'Calendar source patch target missing'; END IF;
 def:=replace(def,old,'''calendar'',coalesce((SELECT jsonb_agg(c.value ORDER BY c.value->>''calendar_date'',c.value->>''id'') FROM (SELECT DISTINCT department,group_code FROM assignments) a CROSS JOIN LATERAL jsonb_array_elements(public.resolve_factory_calendar(a.department,a.group_code,lo,hi)) c),''[]'')');
 EXECUTE def;
 SELECT pg_get_functiondef('public.payroll_lock_review_sources(uuid,uuid)'::regprocedure) INTO def;
 def:=replace(def,'UNION SELECT ''policy:ALL''','UNION SELECT ''factory-calendar:''||department FROM public.payroll_employee_assignments WHERE employee_id=p_employee_id UNION SELECT ''factory-calendar:''||r.department UNION SELECT ''policy:ALL''');
 EXECUTE def;
END $patch$;
-- Existing publisher is retained for compatibility, but managed calendars have one write path.
CREATE FUNCTION public.guard_managed_calendar_legacy_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$ BEGIN
 PERFORM public.payroll_source_fence('factory-calendar:'||NEW.department,false);
 IF EXISTS(SELECT 1 FROM public.factory_calendar_revisions WHERE department=NEW.department AND action='SCHEDULE' AND applies_on<=NEW.calendar_date) THEN RAISE EXCEPTION 'Use Factory Masters Work Calendar to change this date' USING ERRCODE='PY409'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a01_managed_calendar_guard BEFORE INSERT ON public.payroll_work_calendar_days FOR EACH ROW EXECUTE FUNCTION public.guard_managed_calendar_legacy_write();
REVOKE ALL ON FUNCTION public.guard_factory_calendar_revision(),public.guard_managed_calendar_legacy_write(),public.resolve_factory_calendar(text,text,date,date),public.save_factory_calendar(text,integer,text,date,text,uuid),public.get_factory_calendar(text,date,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_factory_calendar(text,integer,text,date,text,uuid),public.get_factory_calendar(text,date,date,uuid) TO service_role;
