-- Migration 00D: Initial non-concurrent population of analytics materialized views
-- PostgreSQL requires an initial non-concurrent refresh before REFRESH CONCURRENTLY can be executed.

REFRESH MATERIALIZED VIEW public.project_health_mv;
REFRESH MATERIALIZED VIEW public.approval_sla_mv;
REFRESH MATERIALIZED VIEW public.estimate_accuracy_mv;
REFRESH MATERIALIZED VIEW public.material_variance_mv;
REFRESH MATERIALIZED VIEW public.resource_utilization_mv;
REFRESH MATERIALIZED VIEW public.zone_performance_mv;
REFRESH MATERIALIZED VIEW public.budget_leakage_mv;
REFRESH MATERIALIZED VIEW public.executive_kpi_mv;
