-- FOR DEVELOPMENT DB ONLY. DO NOT USE THIS IN PROD.
--
-- Nuke and reseed script for development/staging environments:
-- 1.  Truncates all application tables with RESTART IDENTITY CASCADE.
-- 1b. Reseeds baseline sentinel row that the application assumes always exists
--     ('Credit' virtual bank in bank_balance_master for credit purchases / 042 & 045).
--     Ensures an admin user is available and attributed to satisfy FK constraints.
-- 2.  Cleans up transient test users without a Telegram ID, safely preserving
--     admin and accounts role users.
-- 3.  Reset user daily streaks and report timestamps.
-- 4.  Refreshes all analytics materialized views.

-- 1. Nuke all database tables
TRUNCATE TABLE
  -- Accounts HO Requisitions & Banking
  acct_requisition_line_items,
  acct_requisition_sheets,
  credit_ledger,
  account_sub_title_master,
  beneficiary_master,
  bank_balance_master,
  indian_bank_master,
  particulars_master,

  -- Estimates, Work Orders & Activity Breaks
  work_order_activity_breaks,
  estimated_bills,
  estimate_quotations,
  project_cost_estimate_items,
  project_cost_estimates,
  estimate_revision_log,

  -- Subcontractor Ledger & Balances
  subcontractor_ledger,
  subcontractor_balances,

  -- Field Operations & Billing
  requisitions,
  projects_beneficiary_master,
  ra_final_bills,
  daily_progress_reports,
  fund_requests,
  fund_reports,
  excess_fund_returns,

  -- Master Data & Mappings
  audit_log,
  purchase_data,
  material_master,
  projects_master,
  je_zo_mappings,
  work_order_mappings,
  zo_balances,
  zo_fund_ledger,

  -- Auth & Sessions
  sessions,
  otp_requests
RESTART IDENTITY CASCADE;

-- 1b. Reseed rows the app assumes always exist, that TRUNCATE just wiped.
--     Must run before step 2. Prefer an admin who HAS a telegram_chat_id set.
--     If no admin exists, creates/ensures a default admin to satisfy FK constraints.
DO $$
DECLARE
  v_seed_user varchar;
BEGIN
  SELECT mobile_number INTO v_seed_user FROM authorised_users
  WHERE role = 'admin' AND telegram_chat_id IS NOT NULL AND TRIM(telegram_chat_id) <> ''
  LIMIT 1;

  IF v_seed_user IS NULL THEN
    SELECT mobile_number INTO v_seed_user FROM authorised_users WHERE role = 'admin' LIMIT 1;
  END IF;

  IF v_seed_user IS NULL THEN
    INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name, telegram_chat_id)
    VALUES ('919000000003', 'admin', true, 'System Admin Test User', '9988776655')
    ON CONFLICT (mobile_number) DO UPDATE SET role = 'admin', is_active = true
    RETURNING mobile_number INTO v_seed_user;
  END IF;

  IF v_seed_user IS NOT NULL THEN
    -- 'Credit' sentinel in bank_balance_master (042_credit_purchases_and_ledger.sql / 045)
    -- — without this, Debit Bank Type = 'Credit' disappears from the dropdown.
    INSERT INTO bank_balance_master (bank_name, balance_date, available_balance, is_virtual, created_by, updated_by)
    VALUES ('Credit', CURRENT_DATE, 0, true, v_seed_user, v_seed_user)
    ON CONFLICT (bank_name) DO UPDATE SET created_by = v_seed_user, updated_by = v_seed_user;
  ELSE
    RAISE NOTICE 'Credit sentinel reseed skipped: no admin user found in authorised_users.';
  END IF;
END $$;

-- 2. Remove transient test users without a Telegram ID, preserving admin and accounts roles
DELETE FROM public.authorised_users
WHERE (telegram_chat_id IS NULL OR TRIM(telegram_chat_id) = '')
  AND role NOT IN ('admin', 'accounts');

-- 3. Reset user daily streaks and last report dates
UPDATE public.authorised_users
SET daily_streak = 0,
    last_report_date = NULL;

-- 4. Refresh materialized views to clear cached analytics data
REFRESH MATERIALIZED VIEW public.project_health_mv;
REFRESH MATERIALIZED VIEW public.approval_sla_mv;
REFRESH MATERIALIZED VIEW public.estimate_accuracy_mv;
REFRESH MATERIALIZED VIEW public.material_variance_mv;
REFRESH MATERIALIZED VIEW public.resource_utilization_mv;
REFRESH MATERIALIZED VIEW public.zone_performance_mv;
REFRESH MATERIALIZED VIEW public.budget_leakage_mv;
REFRESH MATERIALIZED VIEW public.executive_kpi_mv;

-- This is FOR DEVELOPMENT DB ONLY. DO NOT USE THIS IN PROD
