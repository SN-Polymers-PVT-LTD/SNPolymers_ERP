-- ============================================================
-- Migration 37: Fix DPR Monotonic Physical Progress & Backdated Report Overwrites
-- Ensures latest_progress in project_health_mv selects the MAX reported physical progress so far.
-- ============================================================

BEGIN;

-- Drop dependent views first in strict order
DROP MATERIALIZED VIEW IF EXISTS public.executive_kpi_mv CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.budget_leakage_mv CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.zone_performance_mv CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.project_health_mv CASCADE;

-- Recreate Layer 1: project_health_mv with Monotonic Physical Progress
CREATE MATERIALIZED VIEW public.project_health_mv AS
WITH latest_progress AS (
    SELECT DISTINCT ON (work_order_no)
        work_order_no,
        physical_work_progress,
        login_date
    FROM public.daily_progress_reports
    ORDER BY work_order_no, physical_work_progress DESC, login_date DESC, created_at DESC
),
approved_estimates AS (
    SELECT DISTINCT ON (work_order_no)
        work_order_no,
        estimate_id,
        estimate_no,
        estimate_amount
    FROM public.project_cost_estimates
    WHERE estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY work_order_no, estimate_revision DESC
),
requisitions_summary AS (
    SELECT
        work_order_no,
        COALESCE(SUM(approved_amount), 0) AS approved_amount
    FROM public.requisitions
    WHERE requisition_status = 'Approved'
    GROUP BY work_order_no
),
bills_summary AS (
    SELECT
        work_order_no,
        COALESCE(SUM(gross_bill), 0) AS total_billed
    FROM public.ra_final_bills
    GROUP BY work_order_no
),
pending_approvals AS (
    SELECT work_order_no, COUNT(*) AS pending_count
    FROM (
        SELECT work_order_no FROM public.requisitions
        WHERE requisition_status = 'Pending'
        UNION ALL
        SELECT work_order_no FROM public.project_cost_estimates
        WHERE estimate_status IN ('Submitted', 'Under ZO Review', 'Under HO Review')
    ) sub
    GROUP BY work_order_no
),
material_variance_calc AS (
    SELECT
        ae.work_order_no,
        COALESCE(AVG(
            CASE
                WHEN items.amount = 0 THEN 0
                ELSE ABS(COALESCE(reqs.approved_amount, 0) - items.amount) / items.amount * 100
            END
        ), 0) AS avg_variance_pct
    FROM approved_estimates ae
    JOIN public.project_cost_estimate_items items ON ae.estimate_id = items.estimate_id
    LEFT JOIN (
        SELECT work_order_no, material_main_head, SUM(approved_amount) AS approved_amount
        FROM public.requisitions
        WHERE requisition_status = 'Approved'
        GROUP BY work_order_no, material_main_head
    ) reqs ON ae.work_order_no = reqs.work_order_no
          AND items.material_main_head = reqs.material_main_head
    GROUP BY ae.work_order_no
),
scores_calculated AS (
    SELECT
        pm.work_order_no,
        pm.site_details,
        pm.zone,
        pm.district,
        pm.state,
        pm.department,
        pm.status,
        pm.work_order_value,
        pm.project_start_date,
        pm.project_end_date,
        pm.zo_user_id,
        pm.site_latitude,
        pm.site_longitude,
        COALESCE(ae.estimate_no, 'N/A')          AS estimate_no,
        COALESCE(ae.estimate_amount, 0)          AS approved_estimate_amount,
        COALESCE(rs.approved_amount, 0)          AS approved_requisitions_amount,
        COALESCE(bs.total_billed, 0)             AS total_billed_amount,
        COALESCE(lp.physical_work_progress, 0)   AS physical_progress,
        lp.login_date                            AS last_submission_date,
        CASE
            WHEN lp.login_date IS NULL THEN 999
            ELSE (NOW()::DATE - lp.login_date::DATE)
        END AS days_since_last_report,
        CASE
            WHEN lp.login_date IS NULL THEN 999
            ELSE (NOW()::DATE - lp.login_date::DATE)
        END AS days_since_last_progress_report,
        COALESCE(pa.pending_count, 0)            AS pending_approvals_count,
        COALESCE(mv.avg_variance_pct, 0)         AS material_variance_pct,
        -- ── Score Components ──
        CASE
            WHEN pm.work_order_value = 0 THEN 40
            ELSE GREATEST(0, LEAST(40,
                CASE
                    WHEN COALESCE(rs.approved_amount, 0) / pm.work_order_value <= 0.8 THEN 40
                    WHEN COALESCE(rs.approved_amount, 0) / pm.work_order_value <= 1.0
                        THEN 40 - ((COALESCE(rs.approved_amount, 0) / pm.work_order_value - 0.8) / 0.2 * 20)
                    ELSE GREATEST(0, 20 - ((COALESCE(rs.approved_amount, 0) / pm.work_order_value - 1.0) / 0.2 * 20))
                END))
        END AS budget_score,
        CASE
            WHEN pm.project_start_date IS NULL OR pm.project_end_date IS NULL THEN 20
            WHEN pm.project_end_date = pm.project_start_date                   THEN 20
            ELSE GREATEST(0, LEAST(20, 20 - (
                GREATEST(0,
                    (GREATEST(0, LEAST(1, ((NOW()::DATE - pm.project_start_date)::numeric / NULLIF(pm.project_end_date - pm.project_start_date, 0)::numeric))) * 100)
                    - COALESCE(lp.physical_work_progress, 0)
                ) / 100.0 * 20.0
            )))
        END AS progress_score,
        GREATEST(0, 15 - (COALESCE(pa.pending_count, 0) * 3)) AS approval_score,
        CASE
            WHEN lp.login_date IS NULL                              THEN 0
            WHEN (NOW()::DATE - lp.login_date::DATE) <= 1      THEN 15
            WHEN (NOW()::DATE - lp.login_date::DATE) <= 3      THEN 10
            WHEN (NOW()::DATE - lp.login_date::DATE) <= 7      THEN 5
            ELSE 0
        END AS reporting_score,
        CASE
            WHEN lp.login_date IS NULL                              THEN 0
            WHEN (NOW()::DATE - lp.login_date::DATE) <= 1      THEN 100
            WHEN (NOW()::DATE - lp.login_date::DATE) <= 3      THEN 66
            WHEN (NOW()::DATE - lp.login_date::DATE) <= 7      THEN 33
            ELSE 0
        END AS reporting_health_score,
        CASE
            WHEN COALESCE(mv.avg_variance_pct, 0) <= 5  THEN 10
            WHEN COALESCE(mv.avg_variance_pct, 0) <= 15 THEN 5
            ELSE 0
        END AS material_score,
        CASE
            WHEN pm.project_start_date IS NULL OR pm.project_end_date IS NULL THEN 0
            WHEN pm.project_end_date = pm.project_start_date                   THEN 100
            ELSE GREATEST(0.0, LEAST(100.0, 
                ((NOW()::DATE - pm.project_start_date)::numeric / NULLIF(pm.project_end_date - pm.project_start_date, 0)::numeric) * 100.0
            ))
        END AS timeline_progress_pct,
        CASE
            WHEN pm.project_start_date IS NULL OR pm.project_end_date IS NULL THEN 0
            ELSE COALESCE(
                (NOW()::DATE - pm.project_start_date) - 
                ((COALESCE(lp.physical_work_progress, 0) / 100.0) * NULLIF(pm.project_end_date - pm.project_start_date, 0)),
                0
            )::INTEGER
        END AS schedule_slack_days
    FROM public.projects_master pm
    LEFT JOIN approved_estimates ae    ON pm.work_order_no = ae.work_order_no
    LEFT JOIN latest_progress lp       ON pm.work_order_no = lp.work_order_no
    LEFT JOIN requisitions_summary rs  ON pm.work_order_no = rs.work_order_no
    LEFT JOIN bills_summary bs         ON pm.work_order_no = bs.work_order_no
    LEFT JOIN pending_approvals pa     ON pm.work_order_no = pa.work_order_no
    LEFT JOIN material_variance_calc mv ON pm.work_order_no = mv.work_order_no
)
SELECT
    s.*,
    (s.budget_score + s.progress_score + s.approval_score + s.reporting_score + s.material_score) AS health_score,
    CASE
        WHEN (s.budget_score + s.progress_score + s.approval_score + s.reporting_score + s.material_score) >= 80 THEN 'Healthy'
        WHEN (s.budget_score + s.progress_score + s.approval_score + s.reporting_score + s.material_score) >= 50 THEN 'Warning'
        ELSE 'Critical'
    END AS health_status,
    NOW() AS last_refreshed_at
FROM scores_calculated s;

-- Recreate Layer 2: zone_performance_mv
CREATE MATERIALIZED VIEW public.zone_performance_mv AS
SELECT
    pm.zone,
    COUNT(DISTINCT pm.work_order_no)                                         AS total_projects,
    SUM(CASE WHEN pm.status = 'Running'         THEN 1 ELSE 0 END)           AS running_projects,
    SUM(CASE WHEN ph.physical_progress < 100
             AND pm.project_end_date < CURRENT_DATE  THEN 1 ELSE 0 END)     AS delayed_projects,
    SUM(CASE WHEN ph.health_status = 'Critical' THEN 1 ELSE 0 END)           AS projects_at_risk,
    COALESCE(AVG(ph.health_score), 0.0)                                      AS average_health_score,
    SUM(pm.work_order_value)                                                  AS total_budget,
    SUM(ph.approved_requisitions_amount)                                      AS total_spent,
    CASE
        WHEN SUM(pm.work_order_value) = 0 THEN 0
        ELSE SUM(ph.approved_requisitions_amount) / SUM(pm.work_order_value) * 100
    END AS budget_utilization_pct,
    COALESCE(AVG(ph.schedule_slack_days), 0.0)                                AS average_timeline_slack_days,
    NOW() AS last_refreshed_at
FROM public.projects_master pm
LEFT JOIN public.project_health_mv ph ON pm.work_order_no = ph.work_order_no
GROUP BY pm.zone;

-- Recreate Layer 2: budget_leakage_mv
CREATE MATERIALIZED VIEW public.budget_leakage_mv AS
WITH estimate_revisions AS (
    SELECT work_order_no, COUNT(*) AS revisions_count
    FROM public.project_cost_estimates
    GROUP BY work_order_no
),
fund_request_counts AS (
    SELECT work_order_no, COUNT(*) AS requests_count
    FROM public.fund_requests
    WHERE work_order_no IS NOT NULL
      AND request_status != 'Cancelled'
    GROUP BY work_order_no
)
SELECT
    ph.work_order_no,
    ph.site_details,
    ph.zone,
    ph.work_order_value,
    ph.approved_requisitions_amount,
    CASE
        WHEN ph.work_order_value = 0 THEN 0
        ELSE ph.approved_requisitions_amount / ph.work_order_value * 100
    END AS budget_variance_pct,
    COALESCE(frc.requests_count, 0)    AS fund_requests_count,
    COALESCE(er.revisions_count, 0)    AS estimate_revisions_count,
    ph.days_since_last_progress_report,
    (ph.approved_requisitions_amount > ph.work_order_value)     AS has_budget_overrun,
    (COALESCE(frc.requests_count, 0) > 3)                       AS has_repeated_fund_requests,
    (COALESCE(er.revisions_count, 0) > 3)                       AS has_excessive_revisions,
    (ph.days_since_last_progress_report > 7 AND ph.physical_progress < 100) AS has_stalled_progress,
    (
        CASE WHEN ph.approved_requisitions_amount > ph.work_order_value THEN 3 ELSE 0 END +
        CASE WHEN COALESCE(frc.requests_count, 0) > 3            THEN 2 ELSE 0 END +
        CASE WHEN COALESCE(er.revisions_count, 0) > 3            THEN 1 ELSE 0 END +
        CASE WHEN ph.days_since_last_progress_report > 7 AND ph.physical_progress < 100 THEN 2 ELSE 0 END
    ) AS anomaly_score,
    CASE
        WHEN (CASE WHEN ph.approved_requisitions_amount>ph.work_order_value THEN 3 ELSE 0 END+CASE WHEN COALESCE(frc.requests_count,0)>3 THEN 2 ELSE 0 END+CASE WHEN COALESCE(er.revisions_count,0)>3 THEN 1 ELSE 0 END+CASE WHEN ph.days_since_last_progress_report>7 AND ph.physical_progress<100 THEN 2 ELSE 0 END) >= 4 THEN 'Critical'
        WHEN (CASE WHEN ph.approved_requisitions_amount>ph.work_order_value THEN 3 ELSE 0 END+CASE WHEN COALESCE(frc.requests_count,0)>3 THEN 2 ELSE 0 END+CASE WHEN COALESCE(er.revisions_count,0)>3 THEN 1 ELSE 0 END+CASE WHEN ph.days_since_last_progress_report>7 AND ph.physical_progress<100 THEN 2 ELSE 0 END) >= 1 THEN 'Warning'
        ELSE 'No Anomalies'
    END AS leakage_status,
    NOW() AS last_refreshed_at
FROM public.project_health_mv ph
LEFT JOIN estimate_revisions er   ON ph.work_order_no = er.work_order_no
LEFT JOIN fund_request_counts frc ON ph.work_order_no = frc.work_order_no;

-- Recreate Layer 2: executive_kpi_mv
CREATE MATERIALIZED VIEW public.executive_kpi_mv AS
SELECT
    1                                                                    AS id,
    COUNT(DISTINCT work_order_no)                                        AS total_projects,
    SUM(CASE WHEN status = 'Running'         THEN 1 ELSE 0 END)          AS active_projects,
    SUM(CASE WHEN health_status = 'Warning'  THEN 1 ELSE 0 END)          AS projects_at_warning,
    SUM(CASE WHEN health_status = 'Critical' THEN 1 ELSE 0 END)          AS projects_at_risk,
    COALESCE(AVG(health_score), 0.0)                                     AS average_project_health,
    SUM(work_order_value)                                                 AS total_budget,
    SUM(approved_requisitions_amount)                                     AS total_spent,
    CASE
        WHEN SUM(work_order_value) = 0 THEN 0
        ELSE SUM(approved_requisitions_amount) / SUM(work_order_value) * 100
    END AS budget_utilization_pct,
    NOW() AS last_refreshed_at
FROM public.project_health_mv;

-- Refresh all Materialized Views
REFRESH MATERIALIZED VIEW public.project_health_mv;
REFRESH MATERIALIZED VIEW public.zone_performance_mv;
REFRESH MATERIALIZED VIEW public.budget_leakage_mv;
REFRESH MATERIALIZED VIEW public.executive_kpi_mv;

-- Re-establish UNIQUE indexes for CONCURRENT REFRESHes
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_health_mv_wo
    ON public.project_health_mv (work_order_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_performance_mv_zone
    ON public.zone_performance_mv (zone);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_leakage_mv_wo
    ON public.budget_leakage_mv (work_order_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_executive_kpi_mv_id
    ON public.executive_kpi_mv (id);

-- Ensure background refresh helper RPC is up to date
CREATE OR REPLACE FUNCTION public.refresh_analytics_views()
RETURNS void
SECURITY DEFINER
LANGUAGE plpgsql
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

GRANT EXECUTE ON FUNCTION public.refresh_analytics_views() TO service_role;

COMMIT;
