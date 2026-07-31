-- Migration 00D: Initial non-concurrent population of analytics materialized views
-- PostgreSQL requires an initial non-concurrent refresh before CONCURRENTLY can be used.

REFRESH MATERIALIZED VIEW public.project_health_mv;
REFRESH MATERIALIZED VIEW public.zone_performance_mv;
REFRESH MATERIALIZED VIEW public.executive_kpi_mv;
REFRESH MATERIALIZED VIEW public.budget_leakage_mv;
REFRESH MATERIALIZED VIEW public.monthly_cashflow_trends_mv;
