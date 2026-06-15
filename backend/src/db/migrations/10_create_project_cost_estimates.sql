-- Migration: Create Project Cost Estimate tables, enums, triggers, and indexes
-- DB: PostgreSQL (Supabase)

CREATE TYPE estimate_status_enum AS ENUM (
  'Draft',
  'Submitted',
  'Under ZO Review',
  'ZO Revision Requested',
  'ZO Approved',
  'Rejected by ZO',
  'Under HO Review',
  'HO Revision Requested',
  'Final Approved',
  'Rejected by HO'
);

CREATE TYPE row_approval_enum AS ENUM ('Approve', 'Not Approve');

CREATE TABLE IF NOT EXISTS project_cost_estimates (
  estimate_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_no     VARCHAR NOT NULL REFERENCES projects_master(work_order_no) ON DELETE RESTRICT,
  estimate_no       VARCHAR NOT NULL,
  area_code         VARCHAR NOT NULL,
  estimate_revision INT NOT NULL DEFAULT 0,
  zonal_office_no   VARCHAR NOT NULL,
  estimate_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
  estimate_status   estimate_status_enum NOT NULL DEFAULT 'Draft',
  last_modified_by  VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  
  -- Submitter details (JE)
  je_user_id        VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  je_date           TIMESTAMPTZ,
  je_remarks        TEXT,

  -- Reviewer details (ZO)
  zo_approved_by    VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  zo_approval_date  TIMESTAMPTZ,
  zo_remarks        TEXT,

  -- Approver details (HO)
  ho_approved_by    VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  ho_approval_date  TIMESTAMPTZ,
  ho_remarks        TEXT,

  created_by        VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_cost_estimate_items (
  item_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id         UUID NOT NULL REFERENCES project_cost_estimates(estimate_id) ON DELETE RESTRICT,
  material_main_head  VARCHAR NOT NULL,
  material_sub_head   VARCHAR NOT NULL,
  material_details    VARCHAR NOT NULL,
  unit                VARCHAR NOT NULL,
  qty                 NUMERIC(18,4) NOT NULL DEFAULT 0,
  rate                NUMERIC(18,4) NOT NULL DEFAULT 0,
  rate_reference      VARCHAR,
  amount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  source_of_purchase  UUID REFERENCES purchase_data(id) ON DELETE RESTRICT,

  zo_office_approve   row_approval_enum,
  zo_remarks          TEXT,

  ho_office_approve   row_approval_enum,
  ho_remarks          TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Enforce that amount matches rate * qty exactly to block frontend rounding bugs
  CONSTRAINT chk_item_amount CHECK (amount = ROUND((qty * rate)::NUMERIC, 2))
);

CREATE TABLE IF NOT EXISTS estimate_revision_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id         UUID NOT NULL REFERENCES project_cost_estimates(estimate_id) ON DELETE RESTRICT,
  revision_cycle      INT NOT NULL DEFAULT 1,
  stage               VARCHAR NOT NULL,
  requested_by        VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  revision_deadline   TIMESTAMPTZ NOT NULL,
  resubmitted_at      TIMESTAMPTZ,
  resubmitted_by      VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  is_auto_resubmitted BOOLEAN NOT NULL DEFAULT FALSE,
  modified_item_ids   UUID[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_pce_work_order ON project_cost_estimates(work_order_no);
CREATE INDEX IF NOT EXISTS idx_pce_status ON project_cost_estimates(estimate_status);
CREATE INDEX IF NOT EXISTS idx_pcei_estimate ON project_cost_estimate_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_erl_estimate ON estimate_revision_log(estimate_id);
CREATE INDEX IF NOT EXISTS idx_erl_created ON estimate_revision_log(created_at DESC);

-- Triggers
CREATE OR REPLACE FUNCTION set_estimate_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_estimate_updated_at
BEFORE UPDATE ON project_cost_estimates
FOR EACH ROW EXECUTE FUNCTION set_estimate_updated_at();

CREATE OR REPLACE FUNCTION set_estimate_item_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_estimate_item_updated_at
BEFORE UPDATE ON project_cost_estimate_items
FOR EACH ROW EXECUTE FUNCTION set_estimate_item_updated_at();

CREATE OR REPLACE FUNCTION prevent_estimate_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of project_cost_estimates is permanently prohibited. Records are immutable.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_estimate_hard_delete
BEFORE DELETE ON project_cost_estimates
FOR EACH ROW EXECUTE FUNCTION prevent_estimate_hard_delete();

-- Audit status trigger
CREATE OR REPLACE FUNCTION audit_estimate_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_status IS DISTINCT FROM OLD.estimate_status THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      NEW.last_modified_by,
      'STATUS_CHANGE',
      'Project Cost Estimate',
      NEW.estimate_id::VARCHAR,
      jsonb_build_object(
        'estimate_status', OLD.estimate_status,
        'estimate_revision', OLD.estimate_revision
      ),
      jsonb_build_object(
        'estimate_status', NEW.estimate_status,
        'estimate_revision', NEW.estimate_revision
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_estimate_status
AFTER UPDATE ON project_cost_estimates
FOR EACH ROW EXECUTE FUNCTION audit_estimate_status_change();
