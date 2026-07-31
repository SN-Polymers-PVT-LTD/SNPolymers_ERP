BEGIN;

-- ─────────────────────────────────────────────────────────────
-- INDEXES: Required for query optimization & CONCURRENTLY refreshes
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_health_mv_wo
    ON public.project_health_mv (work_order_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_performance_mv_zone
    ON public.zone_performance_mv (zone);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_sla_mv_id
    ON public.approval_sla_mv (record_identifier, stage);

CREATE UNIQUE INDEX IF NOT EXISTS idx_estimate_accuracy_mv_wo
    ON public.estimate_accuracy_mv (work_order_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_material_variance_mv_wo_head
    ON public.material_variance_mv (work_order_no, material_main_head);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_utilization_mv_je
    ON public.resource_utilization_mv (je_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_leakage_mv_wo
    ON public.budget_leakage_mv (work_order_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_executive_kpi_mv_id
    ON public.executive_kpi_mv (id);

-- Optimize audit_log queries for Audit Center
CREATE INDEX IF NOT EXISTS idx_audit_log_module_name
    ON public.audit_log (module_name);

CREATE INDEX IF NOT EXISTS idx_audit_log_record_identifier
    ON public.audit_log (record_identifier);

-- ─────────────────────────────────────────────────────────────
-- REFRESH FUNCTION: Strict 2-Layer Dependency-Ordered Refresh
-- NOTE: We use plain REFRESH (non-concurrent) inside the function.
-- PostgREST executes RPCs inside transaction blocks, where
-- CONCURRENTLY is prohibited by PostgreSQL.
-- Since the views compile in <1s, non-concurrent locks are negligible.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_analytics_views()
RETURNS void
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Layer 1 (Independent Materialized Views):
  REFRESH MATERIALIZED VIEW public.project_health_mv;
  REFRESH MATERIALIZED VIEW public.approval_sla_mv;
  REFRESH MATERIALIZED VIEW public.estimate_accuracy_mv;
  REFRESH MATERIALIZED VIEW public.material_variance_mv;
  REFRESH MATERIALIZED VIEW public.resource_utilization_mv;

  -- Layer 2 (Materialized Views depending on public.project_health_mv):
  REFRESH MATERIALIZED VIEW public.zone_performance_mv;
  REFRESH MATERIALIZED VIEW public.budget_leakage_mv;
  REFRESH MATERIALIZED VIEW public.executive_kpi_mv;
END;
$$;

-- Revoke all permissions for standard users to secure direct DB access
REVOKE ALL ON FUNCTION public.refresh_analytics_views() FROM PUBLIC, authenticated;
-- Expose strictly to service_role (used by server-side controller)
GRANT EXECUTE ON FUNCTION public.refresh_analytics_views() TO service_role;

COMMIT;