-- Phase 6: reuse existing row facts, category serialization and atomic review/lock.
CREATE FUNCTION public.hr_factory_leave_approval_correction()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE v_sheet uuid;
BEGIN
  IF NEW.request_source = 'FACTORY_MANAGER' AND OLD.approval_status = 'Pending'
    AND NEW.approval_status = 'Approved' THEN
    FOR v_sheet IN
      SELECT DISTINCT s.id FROM public.hr_attendance_sheets s
      JOIN public.hr_attendance_rows a ON a.sheet_id = s.id
      WHERE s.status = 'Submitted' AND a.leave_request_id = NEW.id
        AND a.attendance_status IS DISTINCT FROM CASE
          WHEN NEW.leave_type = 'Medical Leave' THEN 'Medical Leave'
          WHEN NEW.pay_treatment = 'Paid' THEN 'Paid Leave' ELSE 'Unpaid Leave' END
      ORDER BY s.id
    LOOP
      PERFORM public.transition_hr_attendance_sheet(v_sheet,'return',
        'Leave approved as ' || NEW.pay_treatment || '. Correct attendance treatment before resubmission.'
          || CASE WHEN NULLIF(btrim(NEW.decision_remarks),'') IS NULL THEN '' ELSE ' ' || left(NEW.decision_remarks,1800) END,
        NEW.updated_by);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hr_factory_leave_approval_correction AFTER UPDATE ON public.hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.hr_factory_leave_approval_correction();
REVOKE ALL ON FUNCTION public.hr_factory_leave_approval_correction() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.decide_hr_factory_sheet_leave(p_sheet_id uuid,p_leave_id uuid,
  p_decision text,p_pay_treatment text,p_remarks text,p_actor_id uuid)
RETURNS public.hr_leave_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id,ARRAY['admin','ho']);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found' USING ERRCODE='P0002'; END IF;
  PERFORM public.hr_attendance_lock_category(s.employee_category);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF s.status <> 'Submitted' THEN RAISE EXCEPTION 'Leave decisions require a Submitted sheet' USING ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hr_attendance_rows a JOIN public.hr_leave_requests l ON l.id=a.leave_request_id
    WHERE a.sheet_id=s.id AND l.id=p_leave_id AND l.request_source='FACTORY_MANAGER'
      AND l.employee_id=a.employee_id AND l.employee_category=s.employee_category
      AND s.attendance_date BETWEEN l.from_date AND l.to_date) THEN
    RAISE EXCEPTION 'Linked factory leave not found' USING ERRCODE='P0002';
  END IF;
  -- Local treatment is forced here and independently protected by the leave guard.
  RETURN public.decide_hr_leave_request(p_leave_id,p_decision,
    CASE WHEN s.employee_category='Local Daily-Wage Workers' THEN 'Unpaid' ELSE p_pay_treatment END,
    p_remarks,p_actor_id);
END;
$$;

CREATE FUNCTION public.get_hr_attendance_review_state(p_sheet_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s public.hr_attendance_sheets%ROWTYPE; v_reason text;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id,ARRAY['admin','ho']);
  SELECT * INTO s FROM public.hr_attendance_sheets WHERE id=p_sheet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found' USING ERRCODE='P0002'; END IF;
  IF s.status NOT IN ('Submitted','Returned for Correction','Locked') THEN
    RAISE EXCEPTION 'Sheet has not been submitted' USING ERRCODE='P0001';
  END IF;
  IF s.status='Submitted' THEN
    BEGIN
      PERFORM public.hr_attendance_validate_sheet(s.id,true);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN v_reason := SQLERRM;
    END;
  ELSE v_reason := 'Only Submitted sheets can be reviewed.';
  END IF;
  RETURN jsonb_build_object('can_review',v_reason IS NULL,'blocking_reason',v_reason);
END;
$$;

CREATE FUNCTION public.get_hr_attendance_review_queue(p_actor_id uuid,p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,p_category text DEFAULT NULL,p_status text DEFAULT NULL,
  p_page integer DEFAULT 1,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.hr_attendance_require_actor(p_actor_id,ARRAY['admin','ho']);
  IF p_page IS NULL OR p_page<1 OR p_page>100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_from_date IS NOT NULL AND p_to_date IS NOT NULL AND p_from_date>p_to_date)
    OR (p_status IS NOT NULL AND p_status NOT IN ('Submitted','Returned for Correction','Locked'))
    OR (p_category IS NOT NULL AND p_category NOT IN ('Fabric Factory Permanent Employees',
      'SNP Permanent Factory Labour','SNP Casual Factory Labour','Local Daily-Wage Workers')) THEN
    RAISE EXCEPTION 'Invalid review queue filters' USING ERRCODE='22023';
  END IF;
  WITH filtered AS (
    SELECT s.* FROM public.hr_attendance_sheets s
    WHERE s.status IN ('Submitted','Returned for Correction','Locked')
      AND (p_from_date IS NULL OR s.attendance_date>=p_from_date)
      AND (p_to_date IS NULL OR s.attendance_date<=p_to_date)
      AND (p_category IS NULL OR s.employee_category=p_category)
      AND (p_status IS NULL OR s.status=p_status)
  ), page AS (
    SELECT * FROM filtered ORDER BY attendance_date DESC,employee_category,id
      LIMIT p_limit OFFSET (p_page-1)*p_limit
  ), summaries AS (
    SELECT s.id,s.attendance_date,s.employee_category,s.status,s.submission_count,
      s.submitted_by,s.submitted_at,u.display_name AS submitted_by_name,
      CASE WHEN s.status='Returned for Correction' THEN s.return_remarks ELSE s.review_remarks END AS ho_remarks,
      count(a.id) AS roster,
      count(a.id) FILTER(WHERE a.attendance_status='Present') AS present,
      count(a.id) FILTER(WHERE a.attendance_status='Absent') AS absent,
      count(a.id) FILTER(WHERE a.attendance_status IN ('Medical Leave','Paid Leave','Unpaid Leave')) AS leave_medical,
      count(a.id) FILTER(WHERE a.attendance_status='Compensatory Off') AS comp_off,
      count(a.id) FILTER(WHERE a.attendance_status='Management Issue') AS management_issue,
      count(a.id) FILTER(WHERE a.holiday_pay_eligible) AS holiday_pay_eligible,
      coalesce(sum(a.ot_hours),0) AS total_ot_hours
    FROM page s LEFT JOIN public.hr_attendance_rows a ON a.sheet_id=s.id
    LEFT JOIN public.authorised_users u ON u.id=s.submitted_by
    GROUP BY s.id,s.attendance_date,s.employee_category,s.status,s.submission_count,
      s.submitted_by,s.submitted_at,u.display_name,s.return_remarks,s.review_remarks
  ) SELECT jsonb_build_object('sheets',coalesce((SELECT jsonb_agg(to_jsonb(q)
    ORDER BY q.attendance_date DESC,q.employee_category,q.id) FROM summaries q),'[]'::jsonb),
    'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'totalItems',(SELECT count(*) FROM filtered),
      'totalPages',greatest(1,ceil((SELECT count(*) FROM filtered)::numeric/p_limit)))) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.decide_hr_factory_sheet_leave(uuid,uuid,text,text,text,uuid),
  public.get_hr_attendance_review_state(uuid,uuid),public.get_hr_attendance_review_queue(uuid,date,date,text,text,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.decide_hr_factory_sheet_leave(uuid,uuid,text,text,text,uuid),
  public.get_hr_attendance_review_state(uuid,uuid),public.get_hr_attendance_review_queue(uuid,date,date,text,text,integer,integer)
  TO service_role;
NOTIFY pgrst,'reload schema';
