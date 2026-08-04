-- ===========================================================================
-- Migration 006: Remove Estimated Bills from Analytics
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- 1. Drop the billing forecast accuracy materialized view cascadingly
DROP MATERIALIZED VIEW IF EXISTS public.billing_forecast_accuracy_mv CASCADE;

-- 2. Re-create executive_kpi_mv to completely omit the total_forecasted_billing column
DROP MATERIALIZED VIEW IF EXISTS public.executive_kpi_mv CASCADE;

CREATE MATERIALIZED VIEW public.executive_kpi_mv AS
SELECT 1 AS id,
    count(DISTINCT work_order_no) AS total_projects,
    sum(CASE WHEN status = 'Running'::public.project_status THEN 1 ELSE 0 END) AS active_projects,
    sum(CASE WHEN health_status = 'Warning'::text THEN 1 ELSE 0 END) AS projects_at_warning,
    sum(CASE WHEN health_status = 'Critical'::text THEN 1 ELSE 0 END) AS projects_at_risk,
    COALESCE(avg(health_score), 0.0) AS average_project_health,
    sum(work_order_value) AS total_budget,
    sum(approved_requisitions_amount) AS total_spent,
    CASE WHEN sum(work_order_value) = 0 THEN 0
        ELSE (sum(approved_requisitions_amount) / sum(work_order_value)) * 100
    END AS budget_utilization_pct,
    now() AS last_refreshed_at
FROM public.project_health_mv
WITH DATA;

ALTER MATERIALIZED VIEW public.executive_kpi_mv OWNER TO postgres;
CREATE UNIQUE INDEX IF NOT EXISTS idx_executive_kpi_mv_id ON public.executive_kpi_mv (id);

GRANT SELECT ON public.executive_kpi_mv TO anon;
GRANT SELECT ON public.executive_kpi_mv TO authenticated;
GRANT SELECT ON public.executive_kpi_mv TO service_role;

-- 3. Update refresh_analytics_views() RPC to remove billing_forecast_accuracy_mv
CREATE OR REPLACE FUNCTION public.refresh_analytics_views() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Layer 1
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.project_health_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.approval_sla_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.estimate_accuracy_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.material_variance_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.resource_utilization_mv;

  -- Layer 2
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.zone_performance_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.budget_leakage_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.executive_kpi_mv;
END;
$$;

-- 4. Re-populate the executive KPI materialized view
REFRESH MATERIALIZED VIEW public.executive_kpi_mv;
