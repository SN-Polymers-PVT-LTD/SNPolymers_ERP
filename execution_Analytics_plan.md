# Master ERP Analytics & Dashboard Blueprint
## Milestone-Driven Execution Plan — Senior Architect Review v5

- **Status**: Draft v5 — Resolved ZO Recent Activity Auditing (Awaiting Final User Check)
- **Review Date**: 2026-07-19
- **Technology Stack**:
  - **Database**: PostgreSQL (Supabase) + Materialized Views
  - **Backend**: Node.js + Express + Supabase-JS Client (v2, `service_role`)
  - **Frontend**: React 19 (Vite) + **Tailwind CSS v3.4** + Axios + React Router Dom (v6) + TanStack React Query (v5)
- **Existing modules this feature depends on**:
  - `projects_master` — project metadata, `zo_user_id`, `project_start_date`, `project_end_date`, `work_order_value`, `status`, `zone`, `district`, `state` (migrations 01, 24, 26)
  - `authorised_users` — roles (`je`, `zo`, `ho`, `admin`), `mobile_number` (PK reference), `display_name`, `daily_streak`, `last_report_date`, `telegram_chat_id` (migrations 01, 25, 34)
  - `project_cost_estimates` — `estimate_id`, `estimate_revision`, `estimate_status` (enum), `je_date`, `zo_approval_date`, `zo_approved_by`, `ho_approval_date`, `ho_approved_by`, `estimate_amount` (migration 10)
  - `project_cost_estimate_items` — `estimate_id`, `material_main_head`, `qty`, `amount` (migration 10)
  - `requisitions` — `requisition_id`, `work_order_no`, `material_main_head`, `approved_amount`, `requisition_status` (enum), `payment_date`, `approved_user_id`, `created_at` (migration 20)
  - `ra_final_bills` — `work_order_no`, `bill_amount_with_gst` (migration 23)
  - `fund_requests` — `fund_request_id`, `zo_date`, `approve_ho_date`, `approve_ho_user_id`, `work_order_no`, `request_status` (migrations 19, 26)
  - `fund_reports` — `work_order_no`, `is_deleted` (migration 03)
  - `daily_progress_reports` — `work_order_no`, `physical_work_progress`, `login_date`, `created_by`, `daily_site_photo_url`, `zo_user_id` (migration 21)
  - `audit_log` — `user_id`, `action`, `module_name`, `record_identifier`, `old_value`, `new_value`, `timestamp` (migration 01)
  - `je_zo_mappings` — `je_user_id`, `zo_user_id`, `is_active` (migration 26)
  - `work_order_mappings` — `work_order_no`, `je_user_id`, `is_active` (migration 26)

---

## Architectural Guardrails (Enum, Transaction & Audit Refinements)

1. **`daily_streak` Table Safety**: To prevent view compilation failures if the backend-only `daily_streak` migration is out of sync on Supabase, the DB views migration will execute safety schema assertions at the very beginning of the transaction.
2. **Postgres Transaction Limitation Rework (Critical)**:
   - PostgreSQL prohibits `REFRESH MATERIALIZED VIEW CONCURRENTLY` inside transaction blocks. Since Supabase PostgREST RPC requests (`supabase.rpc`) wrap every execution in a transaction block, using `CONCURRENTLY` inside the RPC function will fail.
   - **Correction**: The database function `refresh_analytics_views()` will execute standard, **non-concurrent** `REFRESH MATERIALIZED VIEW` commands. Since the view queries execute in <1s, read-locking duration is negligible and safe.
3. **Verified Enum Values & Column Names (Critical)**:
   - *Fund Requests*: The status column on `fund_requests` is **`request_status`** (not `status`), and its enum values are `'Pending'`, `'Approved'`, `'Hold'`, `'Cancelled'`. The query inside `budget_leakage_mv` has been updated to use `request_status != 'Cancelled'`.
   - *Requisitions*: The status column is `requisition_status`, and its enum values are `'Pending'`, `'Approved'`, `'Hold'`, `'Cancelled'`. Verified match inside `project_health_mv` and `material_variance_mv`.
   - *Estimates*: The status column is `estimate_status`, and its enum values are `'Draft'`, `'Submitted'`, `'Under ZO Review'`, `'ZO Revision Requested'`, `'ZO Approved'`, `'Rejected by ZO'`, `'Under HO Review'`, `'HO Revision Requested'`, `'Final Approved'`, `'Rejected by HO'`. Verified match inside health views.
   - *Projects*: The status column is `status`, and its enum values are `'Running'`, `'Closed'`, `'Complete Under Maintenance'`. Verified match.
4. **Database Function Security**: Execution permissions on the PL/pgSQL refresh function are strictly restricted to `service_role`. Access is revoked for standard `authenticated` database tokens. The Express backend invokes the RPC using its server-side `service_role` client.
5. **Concrete Backend API Endpoints & ZO Audit Resolution (Critical)**:
   - `GET /api/v1/auth/analytics/recent-activity`: Solves the M5b activity feed gap. Enforces zone-isolation for ZO users by retrieving only audits related to projects, requisitions, daily reports, or estimates in their zone.
   - `GET /api/v1/auth/analytics/audit-log`: Solves the M5c audit search center gap. Provides pagination and filter queries.
6. **Frontend xlsx Integration**: Verification shows `xlsx` is already installed and imported in `frontend/src/utils/exportHelpers.js`. A new utility helper `exportAuditLogToExcel` will be appended to this file.

---

## Role Authorization Matrix

| Action / View | HO | ZO | JE | Admin | Security Checkpoint |
| :--- | :--- | :--- | :--- | :--- | :--- |
| HO Executive Analytics (`/analytics/ho`) | ✅ View | ❌ | ❌ | ✅ View | `requireRole(['ho','admin'])` |
| Audit Compliance Center (`/analytics/audit`) | ✅ View | ❌ | ❌ | ✅ View | `requireRole(['ho','admin'])` |
| ZO Productivity Dashboard (`/analytics/zo`) | ✅ All zones | ✅ Own zone only | ❌ | ✅ All zones | `requireRole(['ho','zo','admin'])` + zone filter |
| Project Digital Twin (`/projects/:wo/digital-twin`) | ✅ All | ✅ Own zone | ✅ Assigned only | ✅ All | `verifyJwt` + controller mapping check |
| Recent Activity Feed (`GET /analytics/recent-activity`) | ✅ All | ✅ Own zone | ❌ | ✅ All | `requireRole(['ho','zo','admin'])` + zone filter |
| Trigger View Refresh (`POST /analytics/refresh`) | ✅ | ❌ | ❌ | ✅ | `requireRole(['ho','admin'])` |

---

## Milestone Overview

| # | Milestone | Primary Layer | Depends On | Deliverable |
| - | --------- | ------------- | ---------- | ----------- |
| **M1a** | View Definitions & Initial Populate | Database | Migrations 01–35 | 8 materialized views created |
| **M1b** | Unique Indexes & Refresh Function | Database | M1a | Database refresh function created |
| **M2** | Backend Analytics API — Routes & Controller Implementation | Backend | M1b | All API routes return 200 / 403 / Paginated JSON |
| **M3** | Background Refresh Scheduler | Backend | M1b, M2 | Auto-refresh every 15 min |
| **M4** | Frontend API Client & Navigation Shell | Frontend | M2 | Sidebar links + empty page shells |
| **M5a** | HO Executive Dashboard | Frontend | M4 | KPIs, risk panel, leakage detector |
| **M5b** | ZO Productivity Dashboard & Activity Feed | Frontend | M4 | JE table, recent activity stream |
| **M5c** | Audit Compliance Center | Frontend | M4 | Searchable audit log table + xlsx export |
| **M6** | Project Digital Twin | Frontend | M4, M5a | 13-panel drill-down view |
| **M7** | Integration & End-to-End Verification | Testing | M1b–M6 | Test suites pass, manual QA |

---

# Milestone Detail

---

## M1a — View Definitions & Initial Populate

### Objective
Create all 8 PostgreSQL materialized views in dependency order, with the first populate (non-concurrent) done at migration time. Assert and alter baseline tables beforehand to guarantee column presence.

### Files Created or Modified
- `[NEW]` [36_analytics_dashboard_views.sql](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/db/migrations/36_analytics_dashboard_views.sql)

### Implementation Work

Create `36_analytics_dashboard_views.sql`. The SQL must run as a single transaction:

```sql
-- ============================================================
-- Migration 36: Analytics Materialized Views (Dependency-Ordered)
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 0. SCHEMA INTEGRITY ASSERTIONS
-- Guarantee the presence of daily_streak columns on authorised_users
-- before compiling materialized views that query them.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.authorised_users ADD COLUMN IF NOT EXISTS daily_streak INTEGER DEFAULT 0;
ALTER TABLE public.authorised_users ADD COLUMN IF NOT EXISTS last_report_date DATE;

-- ─────────────────────────────────────────────────────────────
-- VIEW 1: project_health_mv (No dependencies on other MVs)
-- Base view. All other views that need project-level health
-- data read from this view.
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.project_health_mv AS
WITH latest_progress AS (
    SELECT DISTINCT ON (work_order_no)
        work_order_no,
        physical_work_progress,
        login_date
    FROM public.daily_progress_reports
    ORDER BY work_order_no, login_date DESC
),
approved_estimates AS (
    SELECT DISTINCT ON (work_order_no)
        work_order_no,
        estimate_id,
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
        pm.status,
        pm.work_order_value,
        pm.project_start_date,
        pm.project_end_date,
        pm.zo_user_id,
        COALESCE(ae.estimate_amount, 0)          AS approved_estimate_amount,
        COALESCE(rs.approved_amount, 0)          AS approved_requisitions_amount,
        COALESCE(bs.total_billed, 0)             AS total_billed_amount,
        COALESCE(lp.physical_work_progress, 0)   AS physical_progress,
        CASE
            WHEN lp.login_date IS NULL THEN 999
            ELSE (NOW()::DATE - lp.login_date)
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
            WHEN (NOW()::DATE - lp.login_date) <= 1      THEN 15
            WHEN (NOW()::DATE - lp.login_date) <= 3      THEN 10
            WHEN (NOW()::DATE - lp.login_date) <= 7      THEN 5
            ELSE 0
        END AS reporting_score,
        CASE
            WHEN COALESCE(mv.avg_variance_pct, 0) <= 5  THEN 10
            WHEN COALESCE(mv.avg_variance_pct, 0) <= 15 THEN 5
            ELSE 0
        END AS material_score
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

-- ─────────────────────────────────────────────────────────────
-- VIEW 2: zone_performance_mv (Depends on: project_health_mv)
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.zone_performance_mv AS
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
    NOW() AS last_refreshed_at
FROM public.projects_master pm
LEFT JOIN public.project_health_mv ph ON pm.work_order_no = ph.work_order_no
GROUP BY pm.zone;

-- ─────────────────────────────────────────────────────────────
-- VIEW 3: approval_sla_mv (No MV dependencies)
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.approval_sla_mv AS
-- Estimate: JE Submission → ZO Approval
SELECT
    work_order_no,
    'Estimate'::VARCHAR         AS module,
    estimate_id::VARCHAR        AS record_identifier,
    'ZO Review'::VARCHAR        AS stage,
    je_date                     AS submitted_at,
    zo_approval_date            AS actioned_at,
    EXTRACT(EPOCH FROM (zo_approval_date - je_date)) / 3600.0 AS duration_hours,
    48.0                        AS sla_limit_hours,
    (EXTRACT(EPOCH FROM (zo_approval_date - je_date)) / 3600.0 > 48.0) AS is_violated,
    zo_approved_by              AS actioned_by
FROM public.project_cost_estimates
WHERE je_date IS NOT NULL AND zo_approval_date IS NOT NULL
UNION ALL
-- Estimate: ZO Approved → HO Approved
SELECT
    work_order_no,
    'Estimate'::VARCHAR         AS module,
    estimate_id::VARCHAR        AS record_identifier,
    'HO Approval'::VARCHAR      AS stage,
    zo_approval_date            AS submitted_at,
    ho_approval_date            AS actioned_at,
    EXTRACT(EPOCH FROM (ho_approval_date - zo_approval_date)) / 3600.0 AS duration_hours,
    72.0                        AS sla_limit_hours,
    (EXTRACT(EPOCH FROM (ho_approval_date - zo_approval_date)) / 3600.0 > 72.0) AS is_violated,
    ho_approved_by              AS actioned_by
FROM public.project_cost_estimates
WHERE zo_approval_date IS NOT NULL AND ho_approval_date IS NOT NULL
UNION ALL
-- Requisition: Created → Payment Date
SELECT
    work_order_no,
    'Requisition'::VARCHAR      AS module,
    requisition_id::VARCHAR     AS record_identifier,
    'ZO Requisition Approval'::VARCHAR AS stage,
    created_at                  AS submitted_at,
    payment_date                AS actioned_at,
    EXTRACT(EPOCH FROM (payment_date - created_at)) / 3600.0 AS duration_hours,
    48.0                        AS sla_limit_hours,
    (EXTRACT(EPOCH FROM (payment_date - created_at)) / 3600.0 > 48.0) AS is_violated,
    approved_user_id            AS actioned_by
FROM public.requisitions
WHERE payment_date IS NOT NULL
UNION ALL
-- Fund Request: ZO Submitted → HO Approved
SELECT
    work_order_no,
    'Fund Request'::VARCHAR     AS module,
    fund_request_id::VARCHAR    AS record_identifier,
    'HO Fund Request Approval'::VARCHAR AS stage,
    zo_date                     AS submitted_at,
    approve_ho_date             AS actioned_at,
    EXTRACT(EPOCH FROM (approve_ho_date - zo_date)) / 3600.0 AS duration_hours,
    72.0                        AS sla_limit_hours,
    (EXTRACT(EPOCH FROM (approve_ho_date - zo_date)) / 3600.0 > 72.0) AS is_violated,
    approve_ho_user_id          AS actioned_by
FROM public.fund_requests
WHERE approve_ho_date IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- VIEW 4: estimate_accuracy_mv (No MV dependencies)
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.estimate_accuracy_mv AS
WITH original_estimates AS (
    SELECT DISTINCT ON (work_order_no)
        work_order_no, estimate_id, estimate_amount, estimate_no, created_at
    FROM public.project_cost_estimates
    WHERE estimate_revision = 0
    ORDER BY work_order_no, created_at ASC
),
final_estimates AS (
    SELECT DISTINCT ON (work_order_no)
        work_order_no, estimate_id, estimate_amount, estimate_revision
    FROM public.project_cost_estimates
    WHERE estimate_status = 'Final Approved'
    ORDER BY work_order_no, estimate_revision DESC
)
SELECT
    oe.work_order_no,
    oe.estimate_no,
    oe.estimate_amount                                                         AS original_estimate_amount,
    COALESCE(fe.estimate_amount, oe.estimate_amount)                           AS final_approved_estimate_amount,
    COALESCE(fe.estimate_amount, oe.estimate_amount) - oe.estimate_amount      AS variance_amount,
    CASE
        WHEN oe.estimate_amount = 0 THEN 0
        ELSE (COALESCE(fe.estimate_amount, oe.estimate_amount) - oe.estimate_amount) / oe.estimate_amount * 100
    END AS variance_pct,
    COALESCE(fe.estimate_revision, 0) AS number_of_revisions,
    CASE
        WHEN ABS(CASE WHEN oe.estimate_amount=0 THEN 0 ELSE (COALESCE(fe.estimate_amount,oe.estimate_amount)-oe.estimate_amount)/oe.estimate_amount*100 END) <= 5  THEN 'Highly Accurate'
        WHEN ABS(CASE WHEN oe.estimate_amount=0 THEN 0 ELSE (COALESCE(fe.estimate_amount,oe.estimate_amount)-oe.estimate_amount)/oe.estimate_amount*100 END) <= 15 THEN 'Moderate Variance'
        ELSE 'High Variance'
    END AS accuracy_status,
    NOW() AS last_refreshed_at
FROM original_estimates oe
LEFT JOIN final_estimates fe ON oe.work_order_no = fe.work_order_no;

-- ─────────────────────────────────────────────────────────────
-- VIEW 5: material_variance_mv (No MV dependencies)
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.material_variance_mv AS
WITH approved_estimates AS (
    SELECT DISTINCT ON (work_order_no)
        work_order_no, estimate_id
    FROM public.project_cost_estimates
    WHERE estimate_status = 'Final Approved'
    ORDER BY work_order_no, estimate_revision DESC
),
estimated_materials AS (
    SELECT
        ae.work_order_no,
        items.material_main_head,
        SUM(items.qty)    AS estimated_qty,
        SUM(items.amount) AS estimated_amount
    FROM approved_estimates ae
    JOIN public.project_cost_estimate_items items ON ae.estimate_id = items.estimate_id
    GROUP BY ae.work_order_no, items.material_main_head
),
approved_requisitions AS (
    SELECT
        work_order_no,
        material_main_head,
        SUM(approved_amount) AS approved_amount
    FROM public.requisitions
    WHERE requisition_status = 'Approved'
    GROUP BY work_order_no, material_main_head
)
SELECT
    em.work_order_no,
    em.material_main_head,
    em.estimated_qty,
    em.estimated_amount,
    COALESCE(ar.approved_amount, 0)                AS approved_amount,
    COALESCE(ar.approved_amount, 0) - em.estimated_amount AS variance_amount,
    CASE
        WHEN em.estimated_amount = 0 THEN NULL
        ELSE (COALESCE(ar.approved_amount, 0) - em.estimated_amount) / em.estimated_amount * 100
    END AS variance_pct,
    -- Flag rows where quantity comparison is not meaningful
    CASE WHEN em.estimated_qty = 0 THEN TRUE ELSE FALSE END AS quantity_data_unavailable,
    NOW() AS last_refreshed_at
FROM estimated_materials em
LEFT JOIN approved_requisitions ar
       ON em.work_order_no = ar.work_order_no
      AND em.material_main_head = ar.material_main_head;

-- ─────────────────────────────────────────────────────────────
-- VIEW 6: resource_utilization_mv (No MV dependencies)
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.resource_utilization_mv AS
WITH je_projects AS (
    SELECT je_user_id, COUNT(DISTINCT work_order_no) AS assigned_projects
    FROM public.work_order_mappings
    WHERE is_active = true
    GROUP BY je_user_id
),
je_reports AS (
    SELECT created_by, COUNT(*) AS submitted_reports
    FROM public.daily_progress_reports
    GROUP BY created_by
),
je_zo_link AS (
    SELECT DISTINCT ON (je_user_id) je_user_id, zo_user_id
    FROM public.je_zo_mappings
    WHERE is_active = true
    ORDER BY je_user_id, assigned_at DESC
)
SELECT
    au.id                                        AS user_uuid,
    au.mobile_number                             AS je_user_id,
    au.display_name                              AS je_name,
    au.telegram_chat_id,
    COALESCE(jzl.zo_user_id, 'Unmapped')         AS zo_user_id,
    COALESCE(jp.assigned_projects, 0)            AS assigned_projects_count,
    COALESCE(jr.submitted_reports, 0)            AS daily_reports_submitted_count,
    COALESCE(au.daily_streak, 0)                 AS streak_days,
    NOW()                                        AS last_refreshed_at
FROM public.authorised_users au
LEFT JOIN je_projects jp  ON au.mobile_number = jp.je_user_id
LEFT JOIN je_reports jr   ON au.mobile_number = jr.created_by
LEFT JOIN je_zo_link jzl  ON au.mobile_number = jzl.je_user_id
WHERE au.role = 'je' AND au.is_active = true;

-- ─────────────────────────────────────────────────────────────
-- VIEW 7: budget_leakage_mv (Depends on: project_health_mv)
-- CORRECTED: counts fund_requests (not fund_reports) per WO
-- ENUM CHECK: request_status instead of status column
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.budget_leakage_mv AS
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

-- ─────────────────────────────────────────────────────────────
-- VIEW 8: executive_kpi_mv (Depends on: project_health_mv)
-- ─────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.executive_kpi_mv AS
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

-- ─────────────────────────────────────────────────────────────
-- INITIAL POPULATE: Run WITHOUT CONCURRENTLY (first time only)
-- ─────────────────────────────────────────────────────────────
REFRESH MATERIALIZED VIEW public.project_health_mv;
REFRESH MATERIALIZED VIEW public.zone_performance_mv;
REFRESH MATERIALIZED VIEW public.approval_sla_mv;
REFRESH MATERIALIZED VIEW public.estimate_accuracy_mv;
REFRESH MATERIALIZED VIEW public.material_variance_mv;
REFRESH MATERIALIZED VIEW public.resource_utilization_mv;
REFRESH MATERIALIZED VIEW public.budget_leakage_mv;
REFRESH MATERIALIZED VIEW public.executive_kpi_mv;

COMMIT;
```

### Acceptance Criteria
- [ ] Migration script applies without syntax errors.
- [ ] All 8 materialized views exist and return rows (or empty sets, not errors).
- [ ] Views dependent on `project_health_mv` are created AFTER it.

---

## M1b — Unique Indexes & Refresh Function

### Objective
Add unique indexes (required for query acceleration) and create the PL/pgSQL refresh function. Restrict function execution rights strictly to `service_role` and run **non-concurrent** refreshes to bypass the PostgREST transaction wrapper constraint.

### Files Created or Modified
- `[MODIFY]` [36_analytics_dashboard_views.sql](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/db/migrations/36_analytics_dashboard_views.sql) *(Append to end of file)*

### Implementation Work

Append the following SQL to the end of `36_analytics_dashboard_views.sql`:

```sql
-- ─────────────────────────────────────────────────────────────
-- INDEXES: Required for query optimization
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
```

### Acceptance Criteria
- [ ] All 8 unique indexes exist.
- [ ] Direct call `SELECT public.refresh_analytics_views()` as `authenticated` user fails with 403 / permission error.
- [ ] Call `SELECT public.refresh_analytics_views()` as `service_role` succeeds inside PostgREST RPC wrappers.

---

## M2 — Backend Analytics API Routes & Controller Implementation

### Objective
Create the analytics API routes and a controller that enforces strict role-based security boundaries. Implement the pagination/search capabilities for the Audit Search Center and the zone-isolated Activity Feed.

### Files Created or Modified
- `[NEW]` [analytics.routes.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/routes/analytics.routes.js)
- `[NEW]` [analytics.controller.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/controllers/analytics.controller.js)
- `[MODIFY]` [app.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/app.js)

### Implementation Work

#### 1. Create `analytics.routes.js`
Create the routing definitions:

```js
const express = require('express');
const {
  getHoKpis,
  getHoResourceUtilization,
  getHoApprovalSla,
  getHoZoneBenchmarking,
  getHoBudgetLeakage,
  getZoProductivity,
  getProjectDigitalTwin,
  getRecentActivity,
  getAuditLog,
  triggerRefresh
} = require('../controllers/analytics.controller');
const verifyJwt  = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(verifyJwt);

// HO Executive Routes
const hoRoles = ['ho', 'admin'];
router.get('/ho/kpis',                requireRole(hoRoles), getHoKpis);
router.get('/ho/resource-utilization',requireRole(hoRoles), getHoResourceUtilization);
router.get('/ho/approval-sla',        requireRole(hoRoles), getHoApprovalSla);
router.get('/ho/zone-benchmarking',   requireRole(hoRoles), getHoZoneBenchmarking);
router.get('/ho/budget-leakage',      requireRole(hoRoles), getHoBudgetLeakage);

// ZO + HO Routes
router.get('/zo/productivity',        requireRole(['zo','ho','admin']), getZoProductivity);
router.get('/recent-activity',        requireRole(['zo','ho','admin']), getRecentActivity);

// Audit Center Route
router.get('/audit-log',              requireRole(hoRoles), getAuditLog);

// Project digital twin (controller enforces custom mapping checks)
router.get('/project/:work_order_no/digital-twin', getProjectDigitalTwin);

// Admin/HO trigger for manual refresh
router.post('/refresh',               requireRole(hoRoles), triggerRefresh);

module.exports = router;
```

#### 2. Create `analytics.controller.js`
Implement the controllers. Note the **audit-to-work-order resolution mechanism** in `getRecentActivity` to resolve linked entities:

- **`getHoKpis`**: Reads `executive_kpi_mv` (`.single()`) and `project_health_mv` for portfolio distribution count.
- **`getHoResourceUtilization`**: Reads `resource_utilization_mv`.
- **`getHoApprovalSla`**: Reads `approval_sla_mv`.
- **`getHoZoneBenchmarking`**: Reads `zone_performance_mv`.
- **`getHoBudgetLeakage`**: Reads `budget_leakage_mv` where `anomaly_score > 0`.
- **`getZoProductivity`**: For `zo` role, filters `resource_utilization_mv` where `zo_user_id = req.user.mobile_number`.
- **`getRecentActivity`**:
  - For `zo` role: Fetches recent `audit_log` rows associated with projects belonging to their zone (resolving indirect entity identifiers). Executes:
    ```js
    const zoMobile = req.user.mobile_number;

    // 1. Fetch all work_order_no owned by this ZO
    const { data: woData } = await supabase
      .from('projects_master')
      .select('work_order_no')
      .eq('zo_user_id', zoMobile);

    const woList = (woData || []).map(w => w.work_order_no);
    if (woList.length === 0) return res.status(200).json({ success: true, activities: [] });

    // 2. Fetch linked entity IDs in parallel (resolving indirect entities)
    const [estimatesRes, requisitionsRes, progressRes, fundRequestsRes] = await Promise.all([
      supabase.from('project_cost_estimates').select('estimate_id').in('work_order_no', woList),
      supabase.from('requisitions').select('requisition_id').in('work_order_no', woList),
      supabase.from('daily_progress_reports').select('id').in('work_order_no', woList),
      supabase.from('fund_requests').select('fund_request_id').in('work_order_no', woList)
    ]);

    // 3. Flat-map and compile a comprehensive list of record identifiers
    const allowedIdentifiers = [
      ...woList,
      ...(estimatesRes.data || []).map(e => e.estimate_id.toString()),
      ...(requisitionsRes.data || []).map(r => r.requisition_id.toString()),
      ...(progressRes.data || []).map(p => p.id.toString()),
      ...(fundRequestsRes.data || []).map(f => f.fund_request_id.toString())
    ];

    // 4. Query the audit_log with the resolved identifier set
    const { data: audits, error } = await supabase
      .from('audit_log')
      .select('*, authorised_users(display_name)')
      .in('record_identifier', allowedIdentifiers)
      .order('timestamp', { ascending: false })
      .limit(50);

    if (error) throw error;
    return res.status(200).json({ success: true, activities: audits || [] });
    ```
  - For `ho` / `admin` role: Returns the unfiltered global recent activity list.
- **`getAuditLog`**:
  - Implements server-side filtering for search & pagination.
  - Supports query params: `?module_name=`, `?user_id=`, `?record_identifier=`, `?page=1&limit=50`.
  - Performs `.select('*, authorised_users(display_name)', { count: 'exact' })` on `audit_log`.
- **`getProjectDigitalTwin`**: Enforces strict security check:
  - If role is `je`, verify active status in `work_order_mappings` for this work order.
  - If role is `zo`, verify `projects_master.zo_user_id === req.user.mobile_number`.
  - Performs `Promise.all` queries for overview, materials, progress, budget leakage, approvals, and audits.
- **`triggerRefresh`**: Executes `await supabase.rpc('refresh_analytics_views')` using the backend service client instance.

#### 3. Mount Route in `app.js`
In `backend/src/app.js`, register the router route in the authenticated route mounting block (after existing mapping/balances routes and before the health check):

```js
const analyticsRoutes = require('./routes/analytics.routes');
// ...
app.use('/api/v1/auth/analytics', analyticsRoutes);
```

### Acceptance Criteria
- [ ] API routes respond with 200 and valid JSON payloads.
- [ ] Security check: Accessing HO endpoints as a ZO or JE user returns a 403 Forbidden.
- [ ] ZO requests to `/zo/productivity` only return results mapped to their own `zo_user_id`.
- [ ] Audit search `/audit-log` returns correct paginated structures (`{ data, totalCount, page, totalPages }`).
- [ ] Recent Activity endpoint isolates audit logs to ZO-specific project scope for ZO users (verifying both direct WO audits and indirect entity audits).

---

## M3 — Background Refresh Scheduler

### Objective
Implement an automatic background routine to refresh the precomputed materialized views periodically, ensuring dashboard data remains fresh without manual intervention.

### Files Created or Modified
- `[NEW]` [analyticsRefresh.service.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/services/analyticsRefresh.service.js)
- `[MODIFY]` [app.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/src/app.js)

### Implementation Work

#### 1. Create `analyticsRefresh.service.js`
Implement using recursive `setTimeout` logic matching `reconciliation.service.js`:

```js
const { supabase } = require('../db/supabase');

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

async function executeAnalyticsRefresh() {
  const { error } = await supabase.rpc('refresh_analytics_views');
  if (error) throw error;
}

function startAnalyticsRefreshScheduler() {
  console.log('[ANALYTICS SCHEDULER] Periodic materialized views refresh scheduler registered (15m).');

  const runRefresh = async () => {
    console.log('[ANALYTICS SCHEDULER] Running scheduled view refresh...');
    const startTime = Date.now();
    try {
      await executeAnalyticsRefresh();
      const duration = Date.now() - startTime;
      console.log(`[ANALYTICS SCHEDULER] Completed successfully in ${duration} ms.`);
    } catch (err) {
      console.error('[ANALYTICS SCHEDULER] Periodic refresh failed:', err.message || err);
    } finally {
      scheduleNext();
    }
  };

  const scheduleNext = () => {
    setTimeout(runRefresh, REFRESH_INTERVAL_MS);
  };

  scheduleNext();
}

module.exports = {
  executeAnalyticsRefresh,
  startAnalyticsRefreshScheduler
};
```

#### 2. Register in `app.js`
Import and start the scheduler in the startup block of `backend/src/app.js` inside the `app.listen()` block (after the reconciliation and streak schedulers):

```js
const { startAnalyticsRefreshScheduler } = require('./services/analyticsRefresh.service');
// ...
startAnalyticsRefreshScheduler();
```

### Acceptance Criteria
- [ ] Scheduler successfully initializes on application launch.
- [ ] View refresh executes periodically at the 15-minute mark.
- [ ] Database errors do not crash the Node.js server.

---

## M4 — Frontend API Client & Navigation Shell

### Objective
Expose the frontend API endpoints using the Axios `authApi` client, add routes in `App.jsx`, and create empty dashboard views linked from the Sidebar.

### Files Created or Modified
- `[NEW]` [analyticsApi.js](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/api/analyticsApi.js)
- `[NEW]` [HoDashboard.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/HoDashboard.jsx) *(shell template)*
- `[NEW]` [ZoDashboard.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/ZoDashboard.jsx) *(shell template)*
- `[NEW]` [AuditComplianceCenter.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/AuditComplianceCenter.jsx) *(shell template)*
- `[NEW]` [ProjectDigitalTwin.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/ProjectDigitalTwin.jsx) *(shell template)*
- `[MODIFY]` [App.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/App.jsx)
- `[MODIFY]` [Sidebar.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/components/Sidebar.jsx)

### Implementation Work

#### 1. Create `analyticsApi.js`
Define Axios endpoints mapping to M2:

```js
import authApi from './authApi';

export const getHoKpis              = ()       => authApi.get('/analytics/ho/kpis');
export const getHoResourceUtil      = ()       => authApi.get('/analytics/ho/resource-utilization');
export const getHoApprovalSla       = (params) => authApi.get('/analytics/ho/approval-sla', { params });
export const getHoZoneBenchmarking  = ()       => authApi.get('/analytics/ho/zone-benchmarking');
export const getHoBudgetLeakage     = ()       => authApi.get('/analytics/ho/budget-leakage');
export const getZoProductivity      = ()       => authApi.get('/analytics/zo/productivity');
export const getRecentActivity      = ()       => authApi.get('/analytics/recent-activity');
export const getAuditLog            = (params) => authApi.get('/analytics/audit-log', { params });
export const getProjectDigitalTwin  = (wo)     => authApi.get(`/analytics/project/${wo}/digital-twin`);
export const refreshAnalyticsViews  = ()       => authApi.post('/analytics/refresh');
```

#### 2. Register Routes in `App.jsx`
Register path mappings inside role-gated `ProtectedRoute` groups.
- `/analytics/ho` and `/analytics/audit` go inside the `['ho', 'admin']` group.
- `/analytics/zo` goes inside the `['zo', 'ho', 'admin']` group.
- `/projects/:work_order_no/digital-twin` goes inside the `['je', 'zo', 'ho', 'admin']` group.

#### 3. Update `Sidebar.jsx`
Append navigation items to the `navItems` array, utilizing role checks:
- Render "Executive Analytics" and "Audit Center" for `ho` and `admin` roles.
- Render "Zonal Analytics" for `zo`, `ho`, and `admin` roles.

### Acceptance Criteria
- [ ] Navigation updates URL path and loads correct page components.
- [ ] Sidebar dynamically displays entries based on roles.
- [ ] Unauthenticated users are redirected to login.

---

## M5a — HO Executive Dashboard

### Objective
Create the HO Executive dashboard interface containing high-level portfolio KPIs, zonal benchmarking tables, and the budget leakage anomaly detector list.

### Files Created or Modified
- `[MODIFY]` [HoDashboard.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/HoDashboard.jsx)

### Implementation Work
- Implement TanStack React Query `useQuery` calls pointing to `getHoKpis`, `getHoZoneBenchmarking`, and `getHoBudgetLeakage`.
- Add top-level metrics cards (Total Projects, Active, Warning, Risk, Budget Utilization) with standard skeleton loaders.
- Add circular progress score gauges for portfolio average health.
- Add Zone Benchmarking table ranking zones by average project health score.
- Add **Budget Leakage Anomaly List**: Color-codes project rows based on severity, listing overrun flags and revisions. Clicking takes the user to the Project Digital Twin page.
- Add manual refresh button executing `refreshAnalyticsViews` and invalidating React Query states.

### Acceptance Criteria
- [ ] HO KPIs load and render correctly.
- [ ] Refresh button prompts a success message and triggers a query invalidate.
- [ ] Layout displays fallback panels if query data returns empty.

---

## M5b — ZO Productivity Dashboard & Activity Feed

### Objective
Build the ZO Dashboard displaying JE project distribution and a real-time site audit activity timeline feed.

### Files Created or Modified
- `[MODIFY]` [ZoDashboard.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/ZoDashboard.jsx)

### Implementation Work
- Implement TanStack Query calling `getZoProductivity` and `getRecentActivity`.
- Render **JE Performance Table**: Lists JEs, their assigned projects count, reports submitted, and streak metrics.
- Render **Workload Bar Chart**: Generates visual bars representing workload density per engineer.
- Render **Site Activity Feed**: Chronological timeline of site edits (requisitions created, estimates submitted) retrieved from `recent-activity` (zone-restricted and audit-resolved by backend).

### Acceptance Criteria
- [ ] Timeline feed displays formatted activity descriptions (e.g. "JE John Doe submitted Estimate EST-01").
- [ ] Non-ZO/HO/Admin users are blocked from loading this interface.
- [ ] Empty state renders if no activities exist.

---

## M5c — Audit Compliance Center

### Objective
Create the Audit Search Center page providing search queries, page pagination, and spreadsheets export capabilities.

### Files Created or Modified
- `[MODIFY]` [AuditComplianceCenter.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/AuditComplianceCenter.jsx)
- `[MODIFY]` [exportHelpers.js](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/utils/exportHelpers.js)

### Implementation Work

#### 1. Extend `exportHelpers.js`
Append the following export function:

```js
export function exportAuditLogToExcel(logs) {
  if (!logs || logs.length === 0) {
    alert('No audit logs to export.');
    return;
  }
  const formattedRows = logs.map((log, index) => ({
    "Sl. No.": index + 1,
    "Timestamp": log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : '',
    "User ID (Mobile)": log.user_id || '',
    "User Name": log.authorised_users?.display_name || 'N/A',
    "Action": log.action || '',
    "Module": log.module_name || '',
    "Record Identifier": log.record_identifier || '',
    "Old Value": log.old_value ? JSON.stringify(log.old_value) : '',
    "New Value": log.new_value ? JSON.stringify(log.new_value) : ''
  }));
  const worksheet = XLSX.utils.json_to_sheet(formattedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Audit Logs");
  XLSX.writeFile(workbook, `Audit_Logs_${new Date().toISOString().split('T')[0]}.xlsx`);
}
```

#### 2. Implement `AuditComplianceCenter.jsx`
- Place search text field inputs for: Mobile Number, Module Name (dropdown), Record ID.
- Render results in a table showing Timestamp, User, Action, Module, Record ID, and a collapsible JSON block for changes.
- Add paging control buttons (Next / Prev) updating query params.
- Add "Export to Excel" button triggering `exportAuditLogToExcel(data)`.

### Acceptance Criteria
- [ ] Queries successfully filter logs on search input submit.
- [ ] Export file contains name resolutions and timestamp formats.
- [ ] Pagination controls work correctly.

---

## M6 — Project Digital Twin

### Objective
Build the flagship tabbed Project Digital Twin view compiling the full project lifecycle into 13 distinct panels.

### Files Created or Modified
- `[MODIFY]` [ProjectDigitalTwin.jsx](file:///Users/aswint/Documents/GitHub/SNPolymers/frontend/src/pages/ProjectDigitalTwin.jsx)

### Implementation Work
- Extract parameter `work_order_no` from router parameters.
- Call `getProjectDigitalTwin(work_order_no)`.
- Render a 13-panel dashboard using a vertical or horizontal tab structure:
  - *Overview*: Site info, status, state/district, coordinates map link.
  - *Financial*: Approved Estimate vs Approved Requisitions vs Billed Amount comparisons.
  - *Progress*: Trend listings of DPR entries.
  - *Materials*: Estimated material quantities vs approved requisitions.
  - *Documents*: Estimate revisions list and bill URLs.
  - *Timeline*: Project start/end calendars and schedule progress calculations.
  - *Approvals*: SLA metrics (duration hours) highlighting breaches.
  - *Audit*: Historic change logs from `audit_log` matching this project's record ID.
  - *Risks*: Flag status for overrun, stalled progress, and request counts.
  - *Forecast*: Completion projections based on average progress rate.
  - *Alerts*: Notification chips.
  - *Photos*: Image carousel displaying site attachments.
  - *Analytics*: Scoring breakdown (reporting score, budget score).

### Acceptance Criteria
- [ ] View blocks access for unauthorized JEs/ZOs (returns 403 screen).
- [ ] Image gallery loads correct storage files.
- [ ] Trend charts load coordinate plots.

---

## M7 — Integration & End-to-End Verification

### Objective
Establish comprehensive automated validation test suites to verify system capabilities under different role constraints, and ensure the new analytics database structures do not introduce regressions into existing core workflows (Estimates, Requisitions, DPR, and Fund allocation).

### Files Created or Modified
- `[NEW]` [milestone_p8_m1.test.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/tests/vitest/milestones/milestone_p8_m1.test.js) *(DB views regression tests)*
- `[NEW]` [milestone_p8_m2.test.js](file:///Users/aswint/Documents/GitHub/SNPolymers/backend/tests/vitest/milestones/milestone_p8_m2.test.js) *(API endpoints & RBAC safety tests)*

### Implementation Work

#### 1. Implement `milestone_p8_m1.test.js` (Database Regression Proofing)
The database regression tests must verify that the new materialized views and refresh triggers do not interfere with standard transactional CRUD behavior.
- **Test Case 1.1: Materialized Views Exist & Compile**: Query each of the 8 views to assert columns are exact.
- **Test Case 1.2: Idempotent & Transaction-Safe Refresh**: Call `refresh_analytics_views()` multiple times to assert it does not lock baseline tables or fail under concurrent reads.
- **Test Case 1.3: Trigger Mutex & Append-Only Assertions**: Mutate a mock project, a mock requisition, and a mock estimate. Verify that:
  - Base mutations succeed (no blocking or deadlocks from triggers).
  - The immutability of `audit_log` is preserved (attempting to update or delete `audit_log` rows raises DB exceptions).
- **Test Case 1.4: Null Handling & Empty-State Robustness**: Clear test projects, refresh, and assert that health views and KPI views return default values (e.g. `0` or `0.00` via `COALESCE`) rather than `null` values that would break frontend page rendering.
- **Test Case 1.5: Accuracy & Formula Verifications**:
  - Insert a project with a baseline budget of 100,000 INR and requisitions totaling 120,000 INR. Assert `budget_leakage_mv` flags `has_budget_overrun = TRUE` and `anomaly_score` increases correctly.
  - Insert project timelines where current date is past `project_end_date` but `physical_progress < 100`. Assert `zone_performance_mv.delayed_projects` increments.

#### 2. Implement `milestone_p8_m2.test.js` (API & Workflow Regression Proofing)
The API tests must verify security restrictions and confirm that core business transactions continue to update statistics correctly.
- **Test Case 2.1: Strict Security Checkpoints (RBAC)**:
  - Assert HO routes (`/analytics/ho/*`, `/analytics/audit-log`) return HTTP 403 when called with a ZO or JE token.
  - Assert `/zo/productivity` only returns rows matching the ZO's zone mobile ID when called by a ZO, but returns all when called by HO/Admin.
  - Assert that Digital Twin endpoints return 403 for unauthorized JE tokens (unassigned work orders).
- **Test Case 2.2: ZO Recent Activity Isolation & Link Resolution**:
  - Create a new project assigned to ZO A, along with a related estimate, requisition, and progress report.
  - Create a project assigned to ZO B with its own entities.
  - Perform actions generating audit entries (submit estimate, approve requisition).
  - Call `GET /api/v1/auth/analytics/recent-activity` with ZO A's token. Assert it returns both the direct project audit AND the indirect estimate/requisition audits belonging to ZO A.
  - Assert ZO A's response contains **zero** audit logs from ZO B's entities (proving total isolation).
- **Test Case 2.3: Requisition Mutation & Balance Deduction Regression**:
  - Call `/api/v1/auth/requisitions` to submit and approve a new requisition. Assert ZO balance is deducted correctly.
  - Trigger refresh and call GET `/api/v1/auth/analytics/project/:work_order_no/digital-twin`. Assert the new requisition amount is reflected in the financial progress card.
- **Test Case 2.4: Estimate Revision Regression**:
  - Walk a cost estimate through a rejection and revision request flow.
  - Verify that the standard revision history APIs still function, and verify that the `estimate_accuracy_mv` updates the `number_of_revisions` count after view refresh.
- **Test Case 2.5: Progress Report & Streak Analytics Check**:
  - Submit a new Daily Progress Report for a project. Assert the streak updates correctly in the user table.
  - Refresh views, fetch `/api/v1/auth/analytics/zo/productivity` and assert that the new streak count is immediately available.

### Acceptance Criteria
- [ ] All automated Vitest tests run and pass without syntax errors or connection hangs.
- [ ] No regression detected in core estimate/requisition endpoints after migrating the database views.
- [ ] Background service execution successfully logs outputs and refreshes data without database transaction lockouts.

