-- Finish missing factory pay settings in one transaction, preserving confirmed settings.
CREATE FUNCTION public.factory_setup_impact(p_rule_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 RETURN (factory_calculation_impact(p_rule_id,p_actor_id)-'already_configured') || jsonb_build_object(
  'calculation_configured',EXISTS(SELECT 1 FROM hr_factory_pay_rule_calculations WHERE rule_revision_id=p_rule_id),
  'treatment_configured',EXISTS(SELECT 1 FROM hr_factory_pay_rule_treatments WHERE rule_revision_id=p_rule_id));
END; $$;
CREATE FUNCTION public.complete_factory_setup(p_rule_id uuid,p_salary_days numeric,p_holiday_salary_days numeric,p_reason text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r public.hr_factory_pay_rule_revisions%ROWTYPE; c jsonb; t jsonb; missing_c boolean; missing_t boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM authorised_users WHERE id=p_actor_id AND is_active AND role IN ('admin','factory_manager') FOR SHARE) THEN
  RAISE EXCEPTION 'Factory Manager or Admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM hr_factory_pay_rule_revisions WHERE id=p_rule_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Factory rule not found' USING ERRCODE='P0002'; END IF;
 PERFORM payroll_source_fence('factory:'||r.employee_category,false);
 missing_c:=r.ot_enabled AND NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_calculations WHERE rule_revision_id=r.id);
 missing_t:=NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_treatments WHERE rule_revision_id=r.id);
 IF NOT missing_c AND NOT missing_t THEN RAISE EXCEPTION 'Pay rule setup is already complete' USING ERRCODE='23505'; END IF;
 -- Never silently accept values that would modify previously confirmed settings.
 IF (NOT missing_c AND p_salary_days IS NOT NULL) OR (NOT missing_t AND p_holiday_salary_days IS NOT NULL) THEN
  RAISE EXCEPTION 'Confirmed settings cannot be changed; reload the rule' USING ERRCODE='23514'; END IF;
 IF missing_c THEN c:=complete_factory_calculation(r.id,p_salary_days,p_reason,p_actor_id); END IF;
 IF missing_t THEN t:=complete_factory_treatment(r.id,p_holiday_salary_days,p_reason,p_actor_id); END IF;
 RETURN jsonb_build_object('calculation',c,'treatment',t);
END; $$;
REVOKE ALL ON FUNCTION public.factory_setup_impact(uuid,uuid),public.complete_factory_setup(uuid,numeric,numeric,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.factory_setup_impact(uuid,uuid),public.complete_factory_setup(uuid,numeric,numeric,text,uuid) TO service_role;
