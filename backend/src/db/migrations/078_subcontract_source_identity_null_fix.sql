-- Migration 078: make generated Cost Estimate source/work identity NULL-safe.
-- PostgreSQL CHECK constraints accept UNKNOWN/NULL, so use CASE semantics.

ALTER TABLE public.project_cost_estimate_items
  DROP CONSTRAINT IF EXISTS chk_pcei_subcontract_source_identity;

ALTER TABLE public.project_cost_estimate_items
  ADD CONSTRAINT chk_pcei_subcontract_source_identity
  CHECK (
    CASE
      WHEN source_type = 'SUBCONTRACT_ESTIMATE'
        THEN subcontract_work_id IS NOT NULL
      ELSE
        subcontract_work_id IS NULL
    END
  );
