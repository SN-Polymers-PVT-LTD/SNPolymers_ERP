-- FOR DEVELOPMENT DB ONLY. DO NOT USE THIS IN PROD.
--
-- Same nuke script as before, with a reseed step added right after the
-- TRUNCATE (step 1b) — before step 2 deletes users, since step 2 could
-- remove every admin account (if none have telegram_chat_id set), and the
-- reseed needs at least one admin to exist to attribute the seeded row to.

-- 1. Nuke all database tables
TRUNCATE TABLE
  -- Accounts HO Requisitions & Banking
  acct_requisition_line_items,
  acct_requisition_sheets,
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

  -- Field Operations & Billing
  requisitions,
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
CASCADE;

-- 1b. Reseed rows the app assumes always exist, that TRUNCATE just wiped.
--     Must run before step 2 — see note above. Prefer an admin who HAS a
--     telegram_chat_id set: bank_balance_master.created_by/updated_by are
--     FK'd to authorised_users ON DELETE RESTRICT, so if the seed picked an
--     admin step 2 is about to delete, step 2's DELETE would hit a FK
--     violation and fail outright (rolling back that whole statement,
--     leaving every other no-telegram user undeleted too). Falls back to
--     any admin if none have telegram configured — in that case step 2
--     will still fail to remove that one admin; that's a pre-existing
--     tension in this script, not something this reseed step introduces.
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

  IF v_seed_user IS NOT NULL THEN
    -- 'Credit' sentinel in bank_balance_master (042_credit_purchases_and_ledger.sql)
    -- — without this, Debit Bank Type = 'Credit' disappears from the dropdown.
    INSERT INTO bank_balance_master (bank_name, balance_date, available_balance, is_virtual, created_by, updated_by)
    VALUES ('Credit', CURRENT_DATE, 0, true, v_seed_user, v_seed_user)
    ON CONFLICT (bank_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'Credit sentinel reseed skipped: no admin user found in authorised_users.';
  END IF;
END $$;

-- 2. Remove users with NULL or empty Telegram ID
DELETE FROM public.authorised_users
WHERE telegram_chat_id IS NULL OR TRIM(telegram_chat_id) = '';

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
