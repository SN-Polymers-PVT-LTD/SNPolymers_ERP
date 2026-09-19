-- Phase 1 follow-up: renamed legacy functions must not be callable directly.
-- The public wrappers in 087 are the only supported runtime entry points.

REVOKE ALL ON FUNCTION public.reconcile_subcontract_estimate_lines_phase1_legacy(uuid, varchar, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_subcontract_estimate_workflow_phase1_legacy(uuid, varchar, varchar, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_reopened_subcontract_estimate_phase1_legacy(uuid, varchar, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.reconcile_subcontract_estimate_lines_phase1_legacy(uuid, varchar, timestamptz, jsonb)
  IS 'Private Phase 1 implementation; direct execution is revoked.';
COMMENT ON FUNCTION public.transition_subcontract_estimate_workflow_phase1_legacy(uuid, varchar, varchar, text, timestamptz, integer)
  IS 'Private Phase 1 implementation; direct execution is revoked.';
COMMENT ON FUNCTION public.submit_reopened_subcontract_estimate_phase1_legacy(uuid, varchar, timestamptz)
  IS 'Private Phase 1 implementation; direct execution is revoked.';
