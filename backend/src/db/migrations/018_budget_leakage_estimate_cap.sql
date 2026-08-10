-- ===========================================================================
-- Migration 018: budget_leakage_mv estimate-based overrun detection
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

DROP MATERIALIZED VIEW IF EXISTS public.budget_leakage_mv CASCADE;

CREATE MATERIALIZED VIEW public.budget_leakage_mv AS
 WITH estimate_revisions AS (
         SELECT project_cost_estimates.work_order_no,
            count(*) AS revisions_count
           FROM public.project_cost_estimates
          GROUP BY project_cost_estimates.work_order_no
        ), fund_request_counts AS (
         SELECT fund_requests.work_order_no,
            count(*) AS requests_count
           FROM public.fund_requests
          WHERE ((fund_requests.work_order_no IS NOT NULL) AND (fund_requests.request_status <> 'Cancelled'::public.fund_request_status_enum))
          GROUP BY fund_requests.work_order_no
        ), approved_estimates AS (
         SELECT DISTINCT ON (project_cost_estimates.work_order_no)
            project_cost_estimates.work_order_no,
            project_cost_estimates.estimate_amount
           FROM public.project_cost_estimates
          WHERE project_cost_estimates.estimate_status = 'Final Approved'::public.estimate_status_enum
          ORDER BY project_cost_estimates.work_order_no, project_cost_estimates.estimate_revision DESC
        ), budget_caps AS (
         SELECT ph.work_order_no,
            ph.site_details,
            ph.zone,
            ph.work_order_value,
            ph.approved_requisitions_amount,
            ph.days_since_last_progress_report,
            ph.physical_progress,
            COALESCE(ae.estimate_amount, ph.work_order_value) AS budget_cap
           FROM public.project_health_mv ph
           LEFT JOIN approved_estimates ae ON ph.work_order_no::text = ae.work_order_no::text
        )
 SELECT bc.work_order_no,
    bc.site_details,
    bc.zone,
    bc.work_order_value,
    bc.approved_requisitions_amount,
        CASE
            WHEN (bc.budget_cap = (0)::numeric) THEN (0)::numeric
            ELSE ((bc.approved_requisitions_amount / bc.budget_cap) * (100)::numeric)
        END AS budget_variance_pct,
    COALESCE(frc.requests_count, (0)::bigint) AS fund_requests_count,
    COALESCE(er.revisions_count, (0)::bigint) AS estimate_revisions_count,
    bc.days_since_last_progress_report,
    (bc.approved_requisitions_amount > bc.budget_cap) AS has_budget_overrun,
    (COALESCE(frc.requests_count, (0)::bigint) > 3) AS has_repeated_fund_requests,
    (COALESCE(er.revisions_count, (0)::bigint) > 3) AS has_excessive_revisions,
    ((bc.days_since_last_progress_report > 7) AND (bc.physical_progress < (100)::numeric)) AS has_stalled_progress,
    (((
        CASE
            WHEN (bc.approved_requisitions_amount > bc.budget_cap) THEN 3
            ELSE 0
        END +
        CASE
            WHEN (COALESCE(frc.requests_count, (0)::bigint) > 3) THEN 2
            ELSE 0
        END) +
        CASE
            WHEN (COALESCE(er.revisions_count, (0)::bigint) > 3) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN ((bc.days_since_last_progress_report > 7) AND (bc.physical_progress < (100)::numeric)) THEN 2
            ELSE 0
        END) AS anomaly_score,
        CASE
            WHEN ((((
            CASE
                WHEN (bc.approved_requisitions_amount > bc.budget_cap) THEN 3
                ELSE 0
            END +
            CASE
                WHEN (COALESCE(frc.requests_count, (0)::bigint) > 3) THEN 2
                ELSE 0
            END) +
            CASE
                WHEN (COALESCE(er.revisions_count, (0)::bigint) > 3) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((bc.days_since_last_progress_report > 7) AND (bc.physical_progress < (100)::numeric)) THEN 2
                ELSE 0
            END) >= 4) THEN 'Critical'::text
            WHEN ((((
            CASE
                WHEN (bc.approved_requisitions_amount > bc.budget_cap) THEN 3
                ELSE 0
            END +
            CASE
                WHEN (COALESCE(frc.requests_count, (0)::bigint) > 3) THEN 2
                ELSE 0
            END) +
            CASE
                WHEN (COALESCE(er.revisions_count, (0)::bigint) > 3) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN ((bc.days_since_last_progress_report > 7) AND (bc.physical_progress < (100)::numeric)) THEN 2
                ELSE 0
            END) >= 1) THEN 'Warning'::text
            ELSE 'No Anomalies'::text
        END AS leakage_status,
    now() AS last_refreshed_at
   FROM budget_caps bc
     LEFT JOIN estimate_revisions er ON bc.work_order_no::text = er.work_order_no::text
     LEFT JOIN fund_request_counts frc ON bc.work_order_no::text = frc.work_order_no::text
  WITH NO DATA;

ALTER MATERIALIZED VIEW public.budget_leakage_mv OWNER TO postgres;
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_leakage_mv_wo ON public.budget_leakage_mv (work_order_no);

GRANT SELECT ON public.budget_leakage_mv TO anon;
GRANT SELECT ON public.budget_leakage_mv TO authenticated;
GRANT SELECT ON public.budget_leakage_mv TO service_role;

REFRESH MATERIALIZED VIEW public.budget_leakage_mv;
