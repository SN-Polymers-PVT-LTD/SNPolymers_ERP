-- Migration: Add UNIQUE constraint to estimate_no in projects_master
-- DB: PostgreSQL (Supabase)

ALTER TABLE projects_master
ADD CONSTRAINT unique_estimate_no UNIQUE (estimate_no);
