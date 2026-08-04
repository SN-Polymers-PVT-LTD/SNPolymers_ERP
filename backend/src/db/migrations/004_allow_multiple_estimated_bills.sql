-- ===========================================================================
-- Migration 004: Drop unique constraint on work_order_no to allow multiple entries
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

ALTER TABLE public.estimated_bills DROP CONSTRAINT IF EXISTS estimated_bills_work_order_no_key;
