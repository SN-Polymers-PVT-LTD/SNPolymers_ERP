-- Migration 077: corrective hardening for the Subcontractor Estimate foundation.
-- Keeps 076 immutable while correcting provenance, adjustment, and lookup semantics.

ALTER TABLE public.requisitions
  DROP CONSTRAINT IF EXISTS fk_requisitions_subcontract_line,
  DROP COLUMN IF EXISTS subcontract_estimate_line_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pcei_subcontract_source_identity'
  ) THEN
    ALTER TABLE public.project_cost_estimate_items
      ADD CONSTRAINT chk_pcei_subcontract_source_identity
      CHECK (
        (
          source_type = 'SUBCONTRACT_ESTIMATE'
          AND subcontract_work_id IS NOT NULL
        ) OR (
          (source_type IS NULL OR source_type = 'MANUAL')
          AND subcontract_work_id IS NULL
        )
      );
  END IF;
END $$;

ALTER TABLE public.project_subcontract_estimate_lines
  DROP CONSTRAINT IF EXISTS chk_psel_structural_values;

ALTER TABLE public.project_subcontract_estimate_lines
  ADD CONSTRAINT chk_psel_structural_values
  CHECK (
    (
      entry_kind IN ('BASE', 'ADDITION')
      AND adjusts_line_id IS NULL
      AND qty > 0
      AND rate > 0
      AND amount > 0
    ) OR (
      entry_kind = 'ADJUSTMENT'
      AND adjusts_line_id IS NOT NULL
      AND adjusts_line_id <> line_id
      AND qty <> 0
      AND rate > 0
      AND amount <> 0
    )
  );

CREATE INDEX IF NOT EXISTS idx_cesc_source_line
  ON public.cost_estimate_subcontract_contributions(subcontract_estimate_line_id);

CREATE INDEX IF NOT EXISTS idx_psel_adjusts_line
  ON public.project_subcontract_estimate_lines(adjusts_line_id)
  WHERE adjusts_line_id IS NOT NULL;
