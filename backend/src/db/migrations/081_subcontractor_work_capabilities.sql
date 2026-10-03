-- Migration 081: Subcontractor Work Capabilities
-- Introduces a normalized capabilities mapping between subcontractor_master and subcontract_work_master.
-- Decouples global master data from work orders, rates, and quantities.

CREATE TABLE IF NOT EXISTS public.subcontractor_work_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES public.subcontractor_master(id) ON DELETE CASCADE,
  subcontract_work_id uuid NOT NULL REFERENCES public.subcontract_work_master(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar REFERENCES public.authorised_users(mobile_number) ON DELETE SET NULL,
  CONSTRAINT uq_subcontractor_work_capability UNIQUE (subcontractor_id, subcontract_work_id)
);

CREATE INDEX IF NOT EXISTS idx_swc_subcontractor ON public.subcontractor_work_capabilities(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_swc_work ON public.subcontractor_work_capabilities(subcontract_work_id);

GRANT ALL ON TABLE public.subcontractor_work_capabilities TO service_role;

-- Safe backfill from existing subcontractor_work_assignments
INSERT INTO public.subcontractor_work_capabilities (subcontractor_id, subcontract_work_id, created_at, created_by)
SELECT DISTINCT ON (subcontractor_id, subcontract_work_id)
  subcontractor_id,
  subcontract_work_id,
  min(created_at) OVER (PARTITION BY subcontractor_id, subcontract_work_id),
  created_by
FROM public.subcontractor_work_assignments
ON CONFLICT (subcontractor_id, subcontract_work_id) DO NOTHING;
