-- ===========================================================================
-- Migration 003: Billing Forecast Accuracy View & Executive KPI Forecast Column
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- 1. Billing forecast accuracy materialized view (mirrors estimate_accuracy_mv pattern)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.billing_forecast_accuracy_mv AS
WITH actuals AS (
    SELECT
        work_order_no,
        COALESCE(SUM(agency_payment), 0.00) AS actual_paid_amount,
        COALESCE(SUM(gross_bill), 0.00) AS actual_gross_billed
    FROM public.ra_final_bills
    GROUP BY work_order_no
)
SELECT
    eb.work_order_no,
    eb.estimated_bill_amount,
    eb.estimated_payment_date,
    eb.surety_pct,
    COALESCE(a.actual_paid_amount, 0.00) AS actual_paid_amount,
    COALESCE(a.actual_gross_billed, 0.00) AS actual_gross_billed,
    (COALESCE(a.actual_paid_amount, 0.00) - eb.estimated_bill_amount) AS variance_amount,
    CASE
        WHEN eb.estimated_bill_amount = 0 THEN 0.00
        ELSE ((COALESCE(a.actual_paid_amount, 0.00) - eb.estimated_bill_amount) / eb.estimated_bill_amount) * 100.00
    END AS variance_pct,
    CASE
        WHEN eb.estimated_bill_amount = 0 THEN 'No Forecast'
        WHEN ABS(
            ((COALESCE(a.actual_paid_amount, 0.00) - eb.estimated_bill_amount) / eb.estimated_bill_amount) * 100.00
        ) <= 5.00 THEN 'Highly Accurate'
        WHEN ABS(
            ((COALESCE(a.actual_paid_amount, 0.00) - eb.estimated_bill_amount) / eb.estimated_bill_amount) * 100.00
        ) <= 15.00 THEN 'Moderate Variance'
        ELSE 'High Variance'
    END AS accuracy_status,
    now() AS last_refreshed_at
FROM public.estimated_bills eb
LEFT JOIN actuals a ON a.work_order_no = eb.work_order_no
WITH DATA;

ALTER MATERIALIZED VIEW public.billing_forecast_accuracy_mv OWNER TO postgres;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_forecast_accuracy_wo ON public.billing_forecast_accuracy_mv (work_order_no);

GRANT SELECT ON public.billing_forecast_accuracy_mv TO anon;
GRANT SELECT ON public.billing_forecast_accuracy_mv TO authenticated;
GRANT SELECT ON public.billing_forecast_accuracy_mv TO service_role;

-- 2. Add total_forecasted_billing to executive_kpi_mv
DROP MATERIALIZED VIEW IF EXISTS public.executive_kpi_mv CASCADE;

CREATE MATERIALIZED VIEW public.executive_kpi_mv AS
SELECT 1 AS id,
    COUNT(DISTINCT work_order_no) AS total_projects,
    SUM(CASE WHEN status = 'Running'::public.project_status THEN 1 ELSE 0 END) AS active_projects,
    SUM(CASE WHEN health_status = 'Warning'::text THEN 1 ELSE 0 END) AS projects_at_warning,
    SUM(CASE WHEN health_status = 'Critical'::text THEN 1 ELSE 0 END) AS projects_at_risk,
    COALESCE(AVG(health_score), 0.0) AS average_project_health,
    SUM(work_order_value) AS total_budget,
    SUM(approved_requisitions_amount) AS total_spent,
    CASE WHEN SUM(work_order_value) = 0 THEN 0
        ELSE (SUM(approved_requisitions_amount) / SUM(work_order_value)) * 100
    END AS budget_utilization_pct,
    (SELECT COALESCE(SUM(estimated_bill_amount), 0.00)
       FROM public.estimated_bills eb
       JOIN public.projects_master pm ON pm.work_order_no = eb.work_order_no
       WHERE pm.status = 'Running'::public.project_status
    ) AS total_forecasted_billing,
    now() AS last_refreshed_at
FROM public.project_health_mv
WITH DATA;

ALTER MATERIALIZED VIEW public.executive_kpi_mv OWNER TO postgres;
CREATE UNIQUE INDEX IF NOT EXISTS idx_executive_kpi_mv_id ON public.executive_kpi_mv (id);

GRANT SELECT ON public.executive_kpi_mv TO anon;
GRANT SELECT ON public.executive_kpi_mv TO authenticated;
GRANT SELECT ON public.executive_kpi_mv TO service_role;

-- 3. Update refresh_analytics_views() RPC to refresh billing_forecast_accuracy_mv
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
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.billing_forecast_accuracy_mv;

  -- Layer 2
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.zone_performance_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.budget_leakage_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.executive_kpi_mv;
END;
$$;

-- 4. Initial non-concurrent population of views created/re-created in this migration
REFRESH MATERIALIZED VIEW public.billing_forecast_accuracy_mv;
REFRESH MATERIALIZED VIEW public.executive_kpi_mv;

