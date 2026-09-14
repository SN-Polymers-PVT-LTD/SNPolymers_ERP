-- Migration 076: normalized Subcontractor Estimate foundation.
-- Additive only. Workflow, Cost Estimate synchronization, and Finance behavior
-- remain unchanged until later integration migrations.

CREATE OR REPLACE FUNCTION public.set_subcontractor_estimate_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.subcontract_work_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_head varchar NOT NULL,
  material_details varchar NOT NULL,
  unit varchar NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_swm_created_by FOREIGN KEY (created_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT fk_swm_updated_by FOREIGN KEY (updated_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT chk_swm_sub_head_nonempty CHECK (btrim(sub_head) <> ''),
  CONSTRAINT chk_swm_details_nonempty CHECK (btrim(material_details) <> ''),
  CONSTRAINT chk_swm_unit_nonempty CHECK (btrim(unit) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_work_master_identity
  ON public.subcontract_work_master (lower(btrim(sub_head)), lower(btrim(material_details)), lower(btrim(unit)));
CREATE INDEX IF NOT EXISTS idx_swm_active ON public.subcontract_work_master(is_active);
CREATE INDEX IF NOT EXISTS idx_swm_sub_head ON public.subcontract_work_master(sub_head);

CREATE TABLE IF NOT EXISTS public.subcontractor_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_name varchar NOT NULL,
  contact_person varchar,
  mobile varchar,
  email varchar,
  address text,
  pan_no varchar,
  gst_no varchar,
  primary_beneficiary_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_by varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_scm_primary_beneficiary FOREIGN KEY (primary_beneficiary_id)
    REFERENCES public.projects_beneficiary_master(id) ON DELETE SET NULL,
  CONSTRAINT fk_scm_created_by FOREIGN KEY (created_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT fk_scm_updated_by FOREIGN KEY (updated_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT chk_scm_name_nonempty CHECK (btrim(subcontractor_name) <> '')
);

CREATE TABLE IF NOT EXISTS public.project_subcontract_estimates (
  subcontract_estimate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_no varchar NOT NULL,
  estimate_revision integer NOT NULL DEFAULT 0,
  estimate_amount numeric(18,2) NOT NULL DEFAULT 0,
  estimate_status public.estimate_status_enum NOT NULL DEFAULT 'Draft',
  last_approved_amount numeric(18,2),
  last_modified_by varchar,
  je_user_id varchar,
  je_date timestamptz,
  je_remarks text,
  zo_approved_by varchar,
  zo_approval_date timestamptz,
  zo_remarks text,
  ho_approved_by varchar,
  ho_approval_date timestamptz,
  ho_remarks text,
  created_by varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_pse_work_order FOREIGN KEY (work_order_no)
    REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
  CONSTRAINT fk_pse_created_by FOREIGN KEY (created_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT fk_pse_last_modified_by FOREIGN KEY (last_modified_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT fk_pse_je FOREIGN KEY (je_user_id)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT fk_pse_zo FOREIGN KEY (zo_approved_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT fk_pse_ho FOREIGN KEY (ho_approved_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT chk_pse_revision_nonnegative CHECK (estimate_revision >= 0),
  CONSTRAINT chk_pse_amount_nonnegative CHECK (estimate_amount >= 0),
  CONSTRAINT chk_pse_last_approved_nonnegative CHECK (
    last_approved_amount IS NULL OR last_approved_amount >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pse_one_live_estimate_per_wo
  ON public.project_subcontract_estimates(work_order_no)
  WHERE estimate_status NOT IN ('Rejected by ZO', 'Rejected by HO');
CREATE INDEX IF NOT EXISTS idx_pse_work_order ON public.project_subcontract_estimates(work_order_no);
CREATE INDEX IF NOT EXISTS idx_pse_status ON public.project_subcontract_estimates(estimate_status);
CREATE INDEX IF NOT EXISTS idx_pse_updated_at ON public.project_subcontract_estimates(updated_at DESC);

CREATE TABLE IF NOT EXISTS public.project_subcontract_estimate_lines (
  line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontract_estimate_id uuid NOT NULL,
  subcontractor_id uuid NOT NULL,
  subcontract_work_id uuid NOT NULL,
  qty numeric(18,4) NOT NULL DEFAULT 0,
  rate numeric(18,4) NOT NULL DEFAULT 0,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  rate_reference varchar,
  remarks text,
  entry_kind varchar NOT NULL DEFAULT 'BASE',
  adjusts_line_id uuid,
  zo_office_approve public.row_approval_enum,
  zo_remarks text,
  ho_office_approve public.row_approval_enum,
  ho_remarks text,
  created_by varchar NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_psel_estimate FOREIGN KEY (subcontract_estimate_id)
    REFERENCES public.project_subcontract_estimates(subcontract_estimate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_psel_subcontractor FOREIGN KEY (subcontractor_id)
    REFERENCES public.subcontractor_master(id) ON DELETE RESTRICT,
  CONSTRAINT fk_psel_work FOREIGN KEY (subcontract_work_id)
    REFERENCES public.subcontract_work_master(id) ON DELETE RESTRICT,
  CONSTRAINT fk_psel_adjusted_line FOREIGN KEY (adjusts_line_id)
    REFERENCES public.project_subcontract_estimate_lines(line_id) ON DELETE RESTRICT,
  CONSTRAINT fk_psel_created_by FOREIGN KEY (created_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT fk_psel_updated_by FOREIGN KEY (updated_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT chk_psel_amount CHECK (amount = round(qty * rate, 2)),
  CONSTRAINT chk_psel_entry_kind CHECK (entry_kind IN ('BASE', 'ADDITION', 'ADJUSTMENT')),
  CONSTRAINT chk_psel_structural_values CHECK (
    (
      entry_kind IN ('BASE', 'ADDITION')
      AND adjusts_line_id IS NULL
      AND qty > 0 AND rate > 0 AND amount > 0
    ) OR (
      entry_kind = 'ADJUSTMENT'
      AND adjusts_line_id IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_psel_estimate ON public.project_subcontract_estimate_lines(subcontract_estimate_id);
CREATE INDEX IF NOT EXISTS idx_psel_subcontractor ON public.project_subcontract_estimate_lines(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_psel_work ON public.project_subcontract_estimate_lines(subcontract_work_id);
CREATE INDEX IF NOT EXISTS idx_psel_estimate_work
  ON public.project_subcontract_estimate_lines(subcontract_estimate_id, subcontract_work_id);
CREATE INDEX IF NOT EXISTS idx_psel_estimate_party_work
  ON public.project_subcontract_estimate_lines(subcontract_estimate_id, subcontractor_id, subcontract_work_id);

CREATE TABLE IF NOT EXISTS public.subcontract_estimate_revision_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontract_estimate_id uuid NOT NULL,
  revision_cycle integer NOT NULL DEFAULT 1,
  stage varchar NOT NULL,
  requested_by varchar NOT NULL,
  revision_deadline timestamptz NOT NULL,
  resubmitted_at timestamptz,
  resubmitted_by varchar,
  is_auto_resubmitted boolean NOT NULL DEFAULT false,
  modified_line_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_serl_estimate FOREIGN KEY (subcontract_estimate_id)
    REFERENCES public.project_subcontract_estimates(subcontract_estimate_id) ON DELETE RESTRICT,
  CONSTRAINT fk_serl_requested_by FOREIGN KEY (requested_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT fk_serl_resubmitted_by FOREIGN KEY (resubmitted_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT chk_serl_stage CHECK (stage IN ('ZO', 'HO')),
  CONSTRAINT chk_serl_cycle_positive CHECK (revision_cycle >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_serl_one_active_revision
  ON public.subcontract_estimate_revision_log(subcontract_estimate_id)
  WHERE resubmitted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cost_estimate_subcontract_contributions (
  contribution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_estimate_item_id uuid NOT NULL,
  subcontract_estimate_line_id uuid NOT NULL,
  qty_contribution numeric(18,4) NOT NULL,
  amount_contribution numeric(18,2) NOT NULL,
  created_by varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_cesc_cost_item FOREIGN KEY (cost_estimate_item_id)
    REFERENCES public.project_cost_estimate_items(item_id) ON DELETE RESTRICT,
  CONSTRAINT fk_cesc_subcontract_line FOREIGN KEY (subcontract_estimate_line_id)
    REFERENCES public.project_subcontract_estimate_lines(line_id) ON DELETE RESTRICT,
  CONSTRAINT fk_cesc_created_by FOREIGN KEY (created_by)
    REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
  CONSTRAINT uq_cesc_item_source_line UNIQUE (cost_estimate_item_id, subcontract_estimate_line_id)
);

ALTER TABLE public.project_cost_estimate_items
  ADD COLUMN IF NOT EXISTS source_type varchar,
  ADD COLUMN IF NOT EXISTS subcontract_work_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_pcei_subcontract_work'
  ) THEN
    ALTER TABLE public.project_cost_estimate_items
      ADD CONSTRAINT fk_pcei_subcontract_work
      FOREIGN KEY (subcontract_work_id)
      REFERENCES public.subcontract_work_master(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pcei_source_type'
  ) THEN
    ALTER TABLE public.project_cost_estimate_items
      ADD CONSTRAINT chk_pcei_source_type
      CHECK (source_type IS NULL OR source_type IN ('MANUAL', 'SUBCONTRACT_ESTIMATE'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pcei_generated_subcontract_work
  ON public.project_cost_estimate_items(estimate_id, subcontract_work_id)
  WHERE source_type = 'SUBCONTRACT_ESTIMATE';

ALTER TABLE public.requisitions
  ADD COLUMN IF NOT EXISTS subcontractor_id uuid,
  ADD COLUMN IF NOT EXISTS subcontract_work_id uuid,
  ADD COLUMN IF NOT EXISTS subcontract_estimate_line_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_requisitions_subcontractor') THEN
    ALTER TABLE public.requisitions ADD CONSTRAINT fk_requisitions_subcontractor
      FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractor_master(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_requisitions_subcontract_work') THEN
    ALTER TABLE public.requisitions ADD CONSTRAINT fk_requisitions_subcontract_work
      FOREIGN KEY (subcontract_work_id) REFERENCES public.subcontract_work_master(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_requisitions_subcontract_line') THEN
    ALTER TABLE public.requisitions ADD CONSTRAINT fk_requisitions_subcontract_line
      FOREIGN KEY (subcontract_estimate_line_id) REFERENCES public.project_subcontract_estimate_lines(line_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_requisitions_subcontract_scope
  ON public.requisitions(work_order_no, subcontractor_id, subcontract_work_id)
  WHERE subcontractor_id IS NOT NULL;

ALTER TABLE public.subcontractor_balances
  ADD COLUMN IF NOT EXISTS subcontractor_id uuid,
  ADD COLUMN IF NOT EXISTS subcontract_work_id uuid;
ALTER TABLE public.subcontractor_ledger
  ADD COLUMN IF NOT EXISTS subcontractor_id uuid,
  ADD COLUMN IF NOT EXISTS subcontract_work_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scb_subcontractor') THEN
    ALTER TABLE public.subcontractor_balances ADD CONSTRAINT fk_scb_subcontractor
      FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractor_master(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scb_subcontract_work') THEN
    ALTER TABLE public.subcontractor_balances ADD CONSTRAINT fk_scb_subcontract_work
      FOREIGN KEY (subcontract_work_id) REFERENCES public.subcontract_work_master(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scl_subcontractor') THEN
    ALTER TABLE public.subcontractor_ledger ADD CONSTRAINT fk_scl_subcontractor
      FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractor_master(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scl_subcontract_work') THEN
    ALTER TABLE public.subcontractor_ledger ADD CONSTRAINT fk_scl_subcontract_work
      FOREIGN KEY (subcontract_work_id) REFERENCES public.subcontract_work_master(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scb_relational_scope
  ON public.subcontractor_balances(work_order_no, subcontractor_id, subcontract_work_id);
CREATE INDEX IF NOT EXISTS idx_scl_relational_scope
  ON public.subcontractor_ledger(work_order_no, subcontractor_id, subcontract_work_id);

DROP TRIGGER IF EXISTS trg_swm_updated_at ON public.subcontract_work_master;
CREATE TRIGGER trg_swm_updated_at BEFORE UPDATE ON public.subcontract_work_master
FOR EACH ROW EXECUTE FUNCTION public.set_subcontractor_estimate_updated_at();
DROP TRIGGER IF EXISTS trg_scm_updated_at ON public.subcontractor_master;
CREATE TRIGGER trg_scm_updated_at BEFORE UPDATE ON public.subcontractor_master
FOR EACH ROW EXECUTE FUNCTION public.set_subcontractor_estimate_updated_at();
DROP TRIGGER IF EXISTS trg_pse_updated_at ON public.project_subcontract_estimates;
CREATE TRIGGER trg_pse_updated_at BEFORE UPDATE ON public.project_subcontract_estimates
FOR EACH ROW EXECUTE FUNCTION public.set_subcontractor_estimate_updated_at();
DROP TRIGGER IF EXISTS trg_psel_updated_at ON public.project_subcontract_estimate_lines;
CREATE TRIGGER trg_psel_updated_at BEFORE UPDATE ON public.project_subcontract_estimate_lines
FOR EACH ROW EXECUTE FUNCTION public.set_subcontractor_estimate_updated_at();

GRANT ALL ON TABLE public.subcontract_work_master TO service_role;
GRANT ALL ON TABLE public.subcontractor_master TO service_role;
GRANT ALL ON TABLE public.project_subcontract_estimates TO service_role;
GRANT ALL ON TABLE public.project_subcontract_estimate_lines TO service_role;
GRANT ALL ON TABLE public.subcontract_estimate_revision_log TO service_role;
GRANT ALL ON TABLE public.cost_estimate_subcontract_contributions TO service_role;

