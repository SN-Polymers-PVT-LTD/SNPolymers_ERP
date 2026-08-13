-- ===========================================================================
-- Migration 021: Work Order Activity Breaks
-- DB: PostgreSQL (Supabase)
--
-- 1. New table work_order_activity_breaks (7-state status, expected_end_date)
-- 2. Rewrite project_health_mv to freeze schedule/reporting penalties for
--    work orders on an Active break. The freeze gate is status = 'Active'
--    ONLY -- there is deliberately no date-window predicate anywhere in this
--    migration. Gating on expected_end_date would let the freeze silently
--    lift while a break is still Active but has run past its planned date,
--    reintroducing the false "stalled/behind schedule" penalty this feature
--    exists to eliminate.
-- 3. Re-create the three views CASCADE-dropped by the project_health_mv
--    rewrite (budget_leakage_mv, executive_kpi_mv, zone_performance_mv),
--    sourced via pg_dump against a live local Supabase instance so their
--    current definitions (including later drift such as migration 018's
--    estimate-based budget cap) are captured exactly, not hand-copied from
--    the original 00_full_schema_dump.sql snapshot.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. work_order_activity_breaks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.work_order_activity_breaks (
    id                     UUID          DEFAULT gen_random_uuid() NOT NULL,
    work_order_no          VARCHAR       NOT NULL,
    status                 VARCHAR       NOT NULL,

    -- Break period (expected_end_date is the JE's estimate, not an enforcement bound)
    start_date             DATE          NOT NULL,
    expected_end_date      DATE          NOT NULL,

    -- JE submission
    je_user_id             VARCHAR       NOT NULL,
    je_remarks             TEXT          NOT NULL,

    -- ZO action
    zo_user_id             VARCHAR,
    zo_remarks             TEXT,
    zo_actioned_at         TIMESTAMPTZ,

    -- HO action (approve-only, no rejection)
    ho_user_id             VARCHAR,
    ho_actioned_at         TIMESTAMPTZ,

    -- Reopen
    reopen_requested_by    VARCHAR,
    reopen_remarks         TEXT,
    reopen_requested_at    TIMESTAMPTZ,
    reopen_ho_user_id      VARCHAR,
    reopen_ho_actioned_at  TIMESTAMPTZ,

    created_at             TIMESTAMPTZ   DEFAULT now() NOT NULL,
    updated_at             TIMESTAMPTZ   DEFAULT now() NOT NULL,

    CONSTRAINT work_order_activity_breaks_pkey
        PRIMARY KEY (id),
    CONSTRAINT work_order_activity_breaks_wo_fkey
        FOREIGN KEY (work_order_no)
        REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    CONSTRAINT work_order_activity_breaks_je_fkey
        FOREIGN KEY (je_user_id)
        REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    CONSTRAINT work_order_activity_breaks_status_check
        CHECK (status IN (
            'Pending ZO Review',
            'Pending HO Review',
            'Active',
            'Reopen Requested',
            'Rejected by ZO',
            'Cancelled by JE',
            'Ended'
        )),
    CONSTRAINT work_order_activity_breaks_date_order_check
        CHECK (expected_end_date >= start_date)  -- input sanity only; never used for enforcement
);

ALTER TABLE public.work_order_activity_breaks OWNER TO postgres;

-- Fast lookup: "does this WO have a non-terminal break right now?"
CREATE INDEX IF NOT EXISTS idx_activity_breaks_wo_status
    ON public.work_order_activity_breaks (work_order_no, status);

-- Fast lookup used in the daily-progress submission guard and inactivity service
CREATE INDEX IF NOT EXISTS idx_activity_breaks_active
    ON public.work_order_activity_breaks (work_order_no)
    WHERE status = 'Active';

-- One non-terminal break per work order (business rule) via unique partial index
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_breaks_one_active_per_wo
    ON public.work_order_activity_breaks (work_order_no)
    WHERE status NOT IN ('Rejected by ZO', 'Cancelled by JE', 'Ended');

-- Audit trigger, following the trg_audit_fund_request_status pattern
CREATE OR REPLACE FUNCTION public.audit_activity_break_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
        VALUES (
            COALESCE(NEW.ho_user_id, NEW.zo_user_id, NEW.je_user_id),
            'STATUS_CHANGE',
            'Activity Break',
            NEW.id::VARCHAR,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status)
        );
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.audit_activity_break_status_change() OWNER TO postgres;

CREATE OR REPLACE TRIGGER trg_audit_activity_break_status_change
AFTER UPDATE ON public.work_order_activity_breaks
FOR EACH ROW EXECUTE FUNCTION public.audit_activity_break_status_change();

GRANT ALL ON TABLE public.work_order_activity_breaks TO anon;
GRANT ALL ON TABLE public.work_order_activity_breaks TO authenticated;
GRANT ALL ON TABLE public.work_order_activity_breaks TO service_role;

-- Enable Row-Level Security for defense-in-depth consistency with sibling tables.
-- Zero policies added -> defaults to deny-all for `anon` and `authenticated` roles.
-- Backend service_role key bypasses RLS while preventing unauthenticated/direct access.
ALTER TABLE public.work_order_activity_breaks ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. project_health_mv rewrite -- freeze scoring for Active breaks
--
-- DROP ... CASCADE also drops budget_leakage_mv, executive_kpi_mv, and
-- zone_performance_mv, which are re-created verbatim (via pg_dump) below.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS public.project_health_mv CASCADE;

CREATE MATERIALIZED VIEW public.project_health_mv AS
 WITH latest_progress AS (
         SELECT DISTINCT ON (daily_progress_reports.work_order_no) daily_progress_reports.work_order_no,
            daily_progress_reports.physical_work_progress,
            daily_progress_reports.login_date
           FROM public.daily_progress_reports
          ORDER BY daily_progress_reports.work_order_no, daily_progress_reports.physical_work_progress DESC, daily_progress_reports.login_date DESC, daily_progress_reports.created_at DESC
        ), approved_estimates AS (
         SELECT DISTINCT ON (project_cost_estimates.work_order_no) project_cost_estimates.work_order_no,
            project_cost_estimates.estimate_id,
            project_cost_estimates.estimate_no,
            project_cost_estimates.estimate_amount
           FROM public.project_cost_estimates
          WHERE (project_cost_estimates.estimate_status = 'Final Approved'::public.estimate_status_enum)
          ORDER BY project_cost_estimates.work_order_no, project_cost_estimates.estimate_revision DESC
        ), requisitions_summary AS (
         SELECT requisitions.work_order_no,
            COALESCE(sum(requisitions.approved_amount), (0)::numeric) AS approved_amount
           FROM public.requisitions
          WHERE (requisitions.requisition_status = 'Approved'::public.requisition_status_enum)
          GROUP BY requisitions.work_order_no
        ), bills_summary AS (
         SELECT ra_final_bills.work_order_no,
            COALESCE(sum(ra_final_bills.gross_bill), (0)::numeric) AS total_billed
           FROM public.ra_final_bills
          GROUP BY ra_final_bills.work_order_no
        ), pending_approvals AS (
         SELECT sub.work_order_no,
            count(*) AS pending_count
           FROM ( SELECT requisitions.work_order_no
                   FROM public.requisitions
                  WHERE (requisitions.requisition_status = 'Pending'::public.requisition_status_enum)
                UNION ALL
                 SELECT project_cost_estimates.work_order_no
                   FROM public.project_cost_estimates
                  WHERE (project_cost_estimates.estimate_status = ANY (ARRAY['Submitted'::public.estimate_status_enum, 'Under ZO Review'::public.estimate_status_enum, 'Under HO Review'::public.estimate_status_enum]))) sub
          GROUP BY sub.work_order_no
        ), material_variance_calc AS (
         SELECT ae.work_order_no,
            COALESCE(avg(
                CASE
                    WHEN (items.amount = (0)::numeric) THEN (0)::numeric
                    ELSE ((abs((COALESCE(reqs.approved_amount, (0)::numeric) - items.amount)) / items.amount) * (100)::numeric)
                END), (0)::numeric) AS avg_variance_pct
           FROM ((approved_estimates ae
             JOIN public.project_cost_estimate_items items ON ((ae.estimate_id = items.estimate_id)))
             LEFT JOIN ( SELECT requisitions.work_order_no,
                    requisitions.material_main_head,
                    sum(requisitions.approved_amount) AS approved_amount
                   FROM public.requisitions
                  WHERE (requisitions.requisition_status = 'Approved'::public.requisition_status_enum)
                  GROUP BY requisitions.work_order_no, requisitions.material_main_head) reqs ON ((((ae.work_order_no)::text = (reqs.work_order_no)::text) AND ((items.material_main_head)::text = (reqs.material_main_head)::text))))
          GROUP BY ae.work_order_no
        ), active_breaks AS (
         SELECT b.work_order_no,
            b.start_date AS break_start,
            b.expected_end_date AS break_expected_end,
            TRUE AS is_on_break
           FROM public.work_order_activity_breaks b
          WHERE b.status = 'Active'
          -- status-only gate; NO date predicate. A break that has run past
          -- expected_end_date but is still Active must keep freezing the
          -- score -- that was the bug this rewrite exists to fix.
        ), scores_calculated AS (
         SELECT pm.work_order_no,
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
            COALESCE(ae.estimate_no, 'N/A'::character varying) AS estimate_no,
            COALESCE(ae.estimate_amount, (0)::numeric) AS approved_estimate_amount,
            COALESCE(rs.approved_amount, (0)::numeric) AS approved_requisitions_amount,
            COALESCE(bs.total_billed, (0)::numeric) AS total_billed_amount,
            COALESCE(lp.physical_work_progress, (0)::numeric) AS physical_progress,
            lp.login_date AS last_submission_date,
                CASE
                    WHEN ab.is_on_break IS TRUE THEN 0
                    WHEN lp.login_date IS NULL THEN 999
                    ELSE ((now())::date - (lp.login_date)::date)
                END AS days_since_last_report,
                CASE
                    WHEN ab.is_on_break IS TRUE THEN 0
                    WHEN lp.login_date IS NULL THEN 999
                    ELSE ((now())::date - (lp.login_date)::date)
                END AS days_since_last_progress_report,
            COALESCE(pa.pending_count, (0)::bigint) AS pending_approvals_count,
            COALESCE(mv.avg_variance_pct, (0)::numeric) AS material_variance_pct,
                CASE
                    WHEN (pm.work_order_value = (0)::numeric) THEN (40)::numeric
                    ELSE GREATEST((0)::numeric, LEAST((40)::numeric,
                    CASE
                        WHEN ((COALESCE(rs.approved_amount, (0)::numeric) / pm.work_order_value) <= 0.8) THEN (40)::numeric
                        WHEN ((COALESCE(rs.approved_amount, (0)::numeric) / pm.work_order_value) <= 1.0) THEN ((40)::numeric - ((((COALESCE(rs.approved_amount, (0)::numeric) / pm.work_order_value) - 0.8) / 0.2) * (20)::numeric))
                        ELSE GREATEST((0)::numeric, ((20)::numeric - ((((COALESCE(rs.approved_amount, (0)::numeric) / pm.work_order_value) - 1.0) / 0.2) * (20)::numeric)))
                    END))
                END AS budget_score,
                CASE
                    WHEN ((pm.project_start_date IS NULL) OR (pm.project_end_date IS NULL)) THEN (20)::numeric
                    WHEN (pm.project_end_date = pm.project_start_date) THEN (20)::numeric
                    ELSE GREATEST((0)::numeric, LEAST((20)::numeric, ((20)::numeric - ((GREATEST((0)::numeric, ((GREATEST((0)::numeric, LEAST((1)::numeric, (((COALESCE(ab.break_start, (now())::date) - pm.project_start_date))::numeric / (NULLIF((pm.project_end_date - pm.project_start_date), 0))::numeric))) * (100)::numeric) - COALESCE(lp.physical_work_progress, (0)::numeric))) / 100.0) * 20.0))))
                    -- Elapsed-time numerator frozen at break_start while on break;
                    -- physical progress used is still the real reported value.
                END AS progress_score,
            GREATEST((0)::bigint, (15 - (COALESCE(pa.pending_count, (0)::bigint) * 3))) AS approval_score,
                CASE
                    WHEN ab.is_on_break IS TRUE THEN 15
                    WHEN lp.login_date IS NULL THEN 0
                    WHEN (((now())::date - (lp.login_date)::date) <= 1) THEN 15
                    WHEN (((now())::date - (lp.login_date)::date) <= 3) THEN 10
                    WHEN (((now())::date - (lp.login_date)::date) <= 7) THEN 5
                    ELSE 0
                END AS reporting_score,
                CASE
                    WHEN ab.is_on_break IS TRUE THEN 100
                    WHEN lp.login_date IS NULL THEN 0
                    WHEN (((now())::date - (lp.login_date)::date) <= 1) THEN 100
                    WHEN (((now())::date - (lp.login_date)::date) <= 3) THEN 66
                    WHEN (((now())::date - (lp.login_date)::date) <= 7) THEN 33
                    ELSE 0
                END AS reporting_health_score,
                CASE
                    WHEN (COALESCE(mv.avg_variance_pct, (0)::numeric) <= (5)::numeric) THEN 10
                    WHEN (COALESCE(mv.avg_variance_pct, (0)::numeric) <= (15)::numeric) THEN 5
                    ELSE 0
                END AS material_score,
                CASE
                    WHEN ((pm.project_start_date IS NULL) OR (pm.project_end_date IS NULL)) THEN (0)::numeric
                    WHEN (pm.project_end_date = pm.project_start_date) THEN (100)::numeric
                    ELSE GREATEST(0.0, LEAST(100.0, (((((now())::date - pm.project_start_date))::numeric / (NULLIF((pm.project_end_date - pm.project_start_date), 0))::numeric) * 100.0)))
                END AS timeline_progress_pct,
                CASE
                    WHEN ((pm.project_start_date IS NULL) OR (pm.project_end_date IS NULL)) THEN 0
                    ELSE (COALESCE(((((now())::date - pm.project_start_date))::numeric - ((COALESCE(lp.physical_work_progress, (0)::numeric) / 100.0) * (NULLIF((pm.project_end_date - pm.project_start_date), 0))::numeric)), (0)::numeric))::integer
                END AS schedule_slack_days,
            ab.is_on_break,
            ab.break_start,
            ab.break_expected_end
           FROM public.projects_master pm
             LEFT JOIN approved_estimates ae ON pm.work_order_no::text = ae.work_order_no::text
             LEFT JOIN latest_progress lp ON pm.work_order_no::text = lp.work_order_no::text
             LEFT JOIN requisitions_summary rs ON pm.work_order_no::text = rs.work_order_no::text
             LEFT JOIN bills_summary bs ON pm.work_order_no::text = bs.work_order_no::text
             LEFT JOIN pending_approvals pa ON pm.work_order_no::text = pa.work_order_no::text
             LEFT JOIN material_variance_calc mv ON pm.work_order_no::text = mv.work_order_no::text
             LEFT JOIN active_breaks ab ON pm.work_order_no::text = ab.work_order_no::text
        )
 SELECT work_order_no,
    site_details,
    zone,
    district,
    state,
    department,
    status,
    work_order_value,
    project_start_date,
    project_end_date,
    zo_user_id,
    site_latitude,
    site_longitude,
    estimate_no,
    approved_estimate_amount,
    approved_requisitions_amount,
    total_billed_amount,
    physical_progress,
    last_submission_date,
    days_since_last_report,
    days_since_last_progress_report,
    pending_approvals_count,
    material_variance_pct,
    budget_score,
    progress_score,
    approval_score,
    reporting_score,
    reporting_health_score,
    material_score,
    timeline_progress_pct,
    schedule_slack_days,
    ((((budget_score + progress_score) + (approval_score)::numeric) + (reporting_score)::numeric) + (material_score)::numeric) AS health_score,
        CASE
            WHEN (((((budget_score + progress_score) + (approval_score)::numeric) + (reporting_score)::numeric) + (material_score)::numeric) >= (80)::numeric) THEN 'Healthy'::text
            WHEN (((((budget_score + progress_score) + (approval_score)::numeric) + (reporting_score)::numeric) + (material_score)::numeric) >= (50)::numeric) THEN 'Warning'::text
            ELSE 'Critical'::text
        END AS health_status,
    COALESCE(is_on_break, FALSE) AS is_on_break,
    break_start,
    break_expected_end,
    (is_on_break IS TRUE AND CURRENT_DATE > break_expected_end) AS break_overrun,
    now() AS last_refreshed_at
   FROM scores_calculated s
  WITH NO DATA;

ALTER MATERIALIZED VIEW public.project_health_mv OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_health_mv_wo ON public.project_health_mv USING btree (work_order_no);

GRANT ALL ON TABLE public.project_health_mv TO anon;
GRANT ALL ON TABLE public.project_health_mv TO authenticated;
GRANT ALL ON TABLE public.project_health_mv TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Re-create CASCADE-dropped dependent views
--
-- Sourced via `pg_dump --schema-only` against a live local Supabase instance
-- (all prior migrations, including 018_budget_leakage_estimate_cap.sql,
-- applied) immediately before this migration was authored. This is
-- deliberate: 00_full_schema_dump.sql is a point-in-time snapshot and does
-- NOT reflect 018's later change to budget_leakage_mv's cap logic (approved
-- estimate amount, not raw work_order_value). Hand-copying from the dump
-- file would have silently reverted that fix. Definitions below are
-- otherwise byte-for-byte what pg_dump produced -- no manual edits.
-- ---------------------------------------------------------------------------

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
         SELECT DISTINCT ON (project_cost_estimates.work_order_no) project_cost_estimates.work_order_no,
            project_cost_estimates.estimate_amount
           FROM public.project_cost_estimates
          WHERE (project_cost_estimates.estimate_status = 'Final Approved'::public.estimate_status_enum)
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
           FROM (public.project_health_mv ph
             LEFT JOIN approved_estimates ae ON (((ph.work_order_no)::text = (ae.work_order_no)::text)))
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
   FROM ((budget_caps bc
     LEFT JOIN estimate_revisions er ON (((bc.work_order_no)::text = (er.work_order_no)::text)))
     LEFT JOIN fund_request_counts frc ON (((bc.work_order_no)::text = (frc.work_order_no)::text)))
  WITH NO DATA;

ALTER MATERIALIZED VIEW public.budget_leakage_mv OWNER TO postgres;

CREATE UNIQUE INDEX idx_budget_leakage_mv_wo ON public.budget_leakage_mv USING btree (work_order_no);

GRANT ALL ON TABLE public.budget_leakage_mv TO anon;
GRANT ALL ON TABLE public.budget_leakage_mv TO authenticated;
GRANT ALL ON TABLE public.budget_leakage_mv TO service_role;

CREATE MATERIALIZED VIEW public.executive_kpi_mv AS
 SELECT 1 AS id,
    count(DISTINCT work_order_no) AS total_projects,
    sum(
        CASE
            WHEN (status = 'Running'::public.project_status) THEN 1
            ELSE 0
        END) AS active_projects,
    sum(
        CASE
            WHEN (health_status = 'Warning'::text) THEN 1
            ELSE 0
        END) AS projects_at_warning,
    sum(
        CASE
            WHEN (health_status = 'Critical'::text) THEN 1
            ELSE 0
        END) AS projects_at_risk,
    COALESCE(avg(health_score), 0.0) AS average_project_health,
    sum(work_order_value) AS total_budget,
    sum(approved_requisitions_amount) AS total_spent,
        CASE
            WHEN (sum(work_order_value) = (0)::numeric) THEN (0)::numeric
            ELSE ((sum(approved_requisitions_amount) / sum(work_order_value)) * (100)::numeric)
        END AS budget_utilization_pct,
    now() AS last_refreshed_at
   FROM public.project_health_mv
  WITH NO DATA;

ALTER MATERIALIZED VIEW public.executive_kpi_mv OWNER TO postgres;

CREATE UNIQUE INDEX idx_executive_kpi_mv_id ON public.executive_kpi_mv USING btree (id);

GRANT ALL ON TABLE public.executive_kpi_mv TO anon;
GRANT ALL ON TABLE public.executive_kpi_mv TO authenticated;
GRANT ALL ON TABLE public.executive_kpi_mv TO service_role;

CREATE MATERIALIZED VIEW public.zone_performance_mv AS
 SELECT pm.zone,
    count(DISTINCT pm.work_order_no) AS total_projects,
    sum(
        CASE
            WHEN (pm.status = 'Running'::public.project_status) THEN 1
            ELSE 0
        END) AS running_projects,
    sum(
        CASE
            WHEN ((ph.physical_progress < (100)::numeric) AND (pm.project_end_date < CURRENT_DATE)) THEN 1
            ELSE 0
        END) AS delayed_projects,
    sum(
        CASE
            WHEN (ph.health_status = 'Critical'::text) THEN 1
            ELSE 0
        END) AS projects_at_risk,
    COALESCE(avg(ph.health_score), 0.0) AS average_health_score,
    sum(pm.work_order_value) AS total_budget,
    sum(ph.approved_requisitions_amount) AS total_spent,
        CASE
            WHEN (sum(pm.work_order_value) = (0)::numeric) THEN (0)::numeric
            ELSE ((sum(ph.approved_requisitions_amount) / sum(pm.work_order_value)) * (100)::numeric)
        END AS budget_utilization_pct,
    COALESCE(avg(ph.schedule_slack_days), 0.0) AS average_timeline_slack_days,
    now() AS last_refreshed_at
   FROM (public.projects_master pm
     LEFT JOIN public.project_health_mv ph ON (((pm.work_order_no)::text = (ph.work_order_no)::text)))
  GROUP BY pm.zone
  WITH NO DATA;

ALTER MATERIALIZED VIEW public.zone_performance_mv OWNER TO postgres;

CREATE UNIQUE INDEX idx_zone_performance_mv_zone ON public.zone_performance_mv USING btree (zone);

GRANT ALL ON TABLE public.zone_performance_mv TO anon;
GRANT ALL ON TABLE public.zone_performance_mv TO authenticated;
GRANT ALL ON TABLE public.zone_performance_mv TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Populate all views immediately
--
-- The 4 views recreated above were just CREATEd WITH NO DATA, so each needs
-- one non-concurrent REFRESH first -- REFRESH ... CONCURRENTLY (used by
-- refresh_analytics_views()) requires the view to already be populated.
-- Same reason 00D_populate_analytics_views.sql exists for the initial schema.
-- ---------------------------------------------------------------------------

REFRESH MATERIALIZED VIEW public.project_health_mv;
REFRESH MATERIALIZED VIEW public.budget_leakage_mv;
REFRESH MATERIALIZED VIEW public.executive_kpi_mv;
REFRESH MATERIALIZED VIEW public.zone_performance_mv;

SELECT public.refresh_analytics_views();
