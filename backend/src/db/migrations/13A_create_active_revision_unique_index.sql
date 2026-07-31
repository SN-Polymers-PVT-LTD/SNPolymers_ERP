-- Migration: Prevent multiple active revision logs per estimate
-- DB: PostgreSQL (Supabase)

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_revision
ON estimate_revision_log (estimate_id)
WHERE resubmitted_at IS NULL;
