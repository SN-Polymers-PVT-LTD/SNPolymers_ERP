-- ===========================================================================
-- Migration 33: Allow Nullable Work Order and Add Breakdown Column
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- 1. Alter work_order_no column to be nullable
ALTER TABLE public.excess_fund_returns ALTER COLUMN work_order_no DROP NOT NULL;

-- 2. Add breakdown JSONB column to store work order distribution
ALTER TABLE public.excess_fund_returns ADD COLUMN IF NOT EXISTS breakdown JSONB;
