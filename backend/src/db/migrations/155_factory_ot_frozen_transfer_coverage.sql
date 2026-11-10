-- A frozen salary may include another factory category after a dated transfer.
-- Protect the actual frozen rule references as well as the run heading.
CREATE OR REPLACE FUNCTION public.factory_calculation_impact(p_rule_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.hr_factory_pay_rule_revisions%ROWTYPE; finish date; result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM authorised_users WHERE id=p_actor_id AND is_active AND role IN ('admin','factory_manager','ho') FOR SHARE) THEN
  RAISE EXCEPTION 'Factory access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM hr_factory_pay_rule_revisions WHERE id=p_rule_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Factory rule not found' USING ERRCODE='P0002'; END IF;
 SELECT min(effective_from)-1 INTO finish FROM hr_factory_pay_rule_revisions WHERE employee_category=r.employee_category AND effective_from>r.effective_from;
 SELECT jsonb_build_object('effective_from',r.effective_from,'effective_to',finish,
  'draft_rows',count(*) FILTER(WHERE e.status IN ('DRAFT','CALCULATED')),
  'protected_rows',count(*) FILTER(WHERE e.status IN ('PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR')),
  'locked_rows',count(*) FILTER(WHERE e.status='LOCKED'),
  'already_configured',EXISTS(SELECT 1 FROM hr_factory_pay_rule_calculations WHERE rule_revision_id=p_rule_id)) INTO result
 FROM payroll_run_employees e JOIN payroll_runs run ON run.id=e.run_id JOIN payroll_groups g ON g.code=run.group_code
 LEFT JOIN payroll_financial_snapshots frozen ON frozen.row_id=e.id
 WHERE (g.employee_category=r.employee_category OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(frozen.source_snapshot->'factory_rules','[]'::jsonb)) used_rule WHERE used_rule->>'id'=r.id::text)) AND e.status<>'CANCELLED_DRAFT'
 AND daterange(e.period_from,e.period_to,'[]') && daterange(r.effective_from,finish,'[]');
 RETURN result;
END; $$;

NOTIFY pgrst,'reload schema';
