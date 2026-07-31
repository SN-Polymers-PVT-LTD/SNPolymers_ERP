-- Migration 00D: Initial population of analytics materialized views
-- Ensures project_health_mv, zone_performance_mv, executive_kpi_mv, etc. are populated upon setup.

SELECT public.refresh_analytics_views();
