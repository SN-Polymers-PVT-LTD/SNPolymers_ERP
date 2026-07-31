-- Migration 38: Add last_approved_amount column to project_cost_estimates
-- This preserves the old approved estimate amount while a new revision/reopened estimate is under review.

ALTER TABLE public.project_cost_estimates
ADD COLUMN IF NOT EXISTS last_approved_amount NUMERIC(18,2) DEFAULT NULL;

-- Backfill existing Final Approved estimates
UPDATE public.project_cost_estimates
SET last_approved_amount = estimate_amount
WHERE estimate_status = 'Final Approved' AND (last_approved_amount IS NULL OR last_approved_amount = 0);
