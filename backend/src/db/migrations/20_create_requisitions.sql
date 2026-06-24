-- Migration 20: Phase 4 — Requisitions
-- DB: PostgreSQL (Supabase)

CREATE TYPE requisition_status_enum AS ENUM (
  'Pending',
  'Approved',
  'Hold',
  'Cancelled'
);

CREATE TYPE gst_bill_enum AS ENUM ('Yes', 'No');

CREATE TYPE requisition_action_enum AS ENUM (
  'Approve',
  'Hold'
);

CREATE TABLE IF NOT EXISTS requisitions (
  requisition_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Requester fields
  requester_user_id            VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  login_date                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Work Order & Estimate Snapshot
  work_order_no                VARCHAR NOT NULL REFERENCES projects_master(work_order_no) ON DELETE RESTRICT,
  estimate_no                  VARCHAR NOT NULL,
  estimate_amount              NUMERIC(18,2),

  -- Geographic metadata snapshot
  state                        VARCHAR NOT NULL,
  district                     VARCHAR NOT NULL,
  area_code                    VARCHAR NOT NULL, -- projects_master.zone
  department                   VARCHAR NOT NULL,
  site_details                 TEXT NOT NULL,

  -- Requester inputs
  requisition_no               VARCHAR NOT NULL UNIQUE,
  material_main_head           VARCHAR NOT NULL,
  requisition_pdf_url          TEXT NOT NULL,
  original_filename            VARCHAR,
  requisition_amount           NUMERIC(18,2) NOT NULL CHECK (requisition_amount > 0),
  gst_bill                     gst_bill_enum NOT NULL,
  gst_bill_pdf_url             TEXT,
  bank_details                 TEXT NOT NULL,
  expen_head_remarks           TEXT,

  -- Status
  requisition_status           requisition_status_enum NOT NULL DEFAULT 'Pending',

  -- Authority fields
  approved_user_id             VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  payment_date                 TIMESTAMPTZ,
  approve_type                 requisition_action_enum,
  approved_amount              NUMERIC(18,2),
  approved_balance_amount      NUMERIC(18,2),
  remarks_approved_authority   TEXT,

  -- Cancellation
  cancelled_by                 VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  cancelled_at                 TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT chk_balance_amount
    CHECK (
      requisition_status != 'Approved'
      OR (
        approved_amount IS NOT NULL
        AND approved_amount <= requisition_amount
        AND approved_balance_amount IS NOT NULL
        AND approved_balance_amount = requisition_amount - approved_amount
      )
    ),

  CONSTRAINT chk_gst_bill_pdf
    CHECK (gst_bill != 'Yes' OR gst_bill_pdf_url IS NOT NULL),

  created_by                   VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON requisitions(requisition_status) WHERE requisition_status = 'Pending';
CREATE INDEX IF NOT EXISTS idx_requisitions_work_order ON requisitions(work_order_no);
CREATE INDEX IF NOT EXISTS idx_requisitions_requester ON requisitions(requester_user_id);

-- Triggers DDL
CREATE OR REPLACE FUNCTION set_requisition_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_requisition_updated_at ON requisitions;
CREATE TRIGGER trg_requisition_updated_at
BEFORE UPDATE ON requisitions
FOR EACH ROW EXECUTE FUNCTION set_requisition_updated_at();

CREATE OR REPLACE FUNCTION prevent_requisition_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of requisitions is permanently prohibited. Use status transitions instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_requisition_hard_delete ON requisitions;
CREATE TRIGGER trg_prevent_requisition_hard_delete
BEFORE DELETE ON requisitions
FOR EACH ROW EXECUTE FUNCTION prevent_requisition_hard_delete();

CREATE OR REPLACE FUNCTION audit_requisition_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      COALESCE(NEW.approved_user_id, NEW.cancelled_by, NEW.created_by),
      'STATUS_CHANGE',
      'Requisition',
      NEW.requisition_id::VARCHAR,
      jsonb_build_object('requisition_status', OLD.requisition_status),
      jsonb_build_object('requisition_status', NEW.requisition_status)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_requisition_status ON requisitions;
CREATE TRIGGER trg_audit_requisition_status
AFTER UPDATE ON requisitions
FOR EACH ROW EXECUTE FUNCTION audit_requisition_status_change();
