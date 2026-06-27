-- ===========================================================================
-- Migration 23: Phase 6 — RA / Final Bill Entry
-- PREREQUISITE: Migrations 01–22 must have been applied.
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ra_final_bills table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ra_final_bills (
  bill_id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Creator identity (auto-populated from session — never from request body)
  created_by                   VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  login_date                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Work Order linkage (geo-metadata snapshot stored at creation time)
  work_order_no                VARCHAR NOT NULL REFERENCES projects_master(work_order_no) ON DELETE RESTRICT,

  -- Frozen geographic metadata (snapshot from projects_master at creation time)
  -- NOTE: area_code maps from projects_master.zone — NOT from a column called area_code
  state                        VARCHAR NOT NULL,
  district                     VARCHAR NOT NULL,
  area_code                    VARCHAR NOT NULL,
  department                   VARCHAR NOT NULL,
  site_details                 TEXT NOT NULL,

  -- Bill classification — must match "RA Bill N" (N >= 1) or "Final Bill"
  payment_type                 VARCHAR NOT NULL,

  -- User-entered bill fields
  bill_date                    DATE NOT NULL,
  bill_no                      VARCHAR NOT NULL,
  bill_amount_with_gst         NUMERIC(18,2) NOT NULL,
  earnest_money_deposit        NUMERIC(18,2) NOT NULL DEFAULT 0,
  security_deposit_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,

  -- Bill copy storage (relative path in 'ra-bill-copies' private bucket)
  bill_copy_url                TEXT NOT NULL,
  original_bill_filename       VARCHAR,    -- Original user-supplied filename (for UI display only)

  -- Optional remarks
  remarks                      TEXT,

  -- Constraints
  CONSTRAINT uq_bill_per_payment_type
    UNIQUE (work_order_no, payment_type),

  CONSTRAINT chk_bill_amount_positive
    CHECK (bill_amount_with_gst > 0),

  CONSTRAINT chk_emd_non_negative
    CHECK (earnest_money_deposit >= 0),

  CONSTRAINT chk_sd_non_negative
    CHECK (security_deposit_amount >= 0),

  -- Enforces valid payment_type format at DB level (defence in depth)
  CONSTRAINT chk_payment_type_format
    CHECK (payment_type ~ '^(RA Bill [1-9][0-9]*|Final Bill)$'),

  -- Audit fields
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes for performance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ra_final_bills_work_order
  ON ra_final_bills(work_order_no);

CREATE INDEX IF NOT EXISTS idx_ra_final_bills_created_by
  ON ra_final_bills(created_by);

CREATE INDEX IF NOT EXISTS idx_ra_final_bills_bill_date
  ON ra_final_bills(bill_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: auto-update updated_at
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_ra_final_bills_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ra_final_bills_updated_at ON ra_final_bills;
CREATE TRIGGER trg_ra_final_bills_updated_at
BEFORE UPDATE ON ra_final_bills
FOR EACH ROW EXECUTE FUNCTION set_ra_final_bills_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: block hard DELETE (records are permanent financial documents)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_ra_final_bills_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of RA/Final bill records is permanently prohibited. Records are immutable financial documents.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ra_final_bills_hard_delete ON ra_final_bills;
CREATE TRIGGER trg_prevent_ra_final_bills_hard_delete
BEFORE DELETE ON ra_final_bills
FOR EACH ROW EXECUTE FUNCTION prevent_ra_final_bills_hard_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: audit log on INSERT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_ra_final_bill_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (
    NEW.created_by,
    'CREATE',
    'RAFinalBill',
    NEW.bill_id::VARCHAR,
    NULL,
    jsonb_build_object(
      'work_order_no',        NEW.work_order_no,
      'payment_type',         NEW.payment_type,
      'bill_date',            NEW.bill_date,
      'bill_amount_with_gst', NEW.bill_amount_with_gst
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_ra_final_bill_insert ON ra_final_bills;
CREATE TRIGGER trg_audit_ra_final_bill_insert
AFTER INSERT ON ra_final_bills
FOR EACH ROW EXECUTE FUNCTION audit_ra_final_bill_insert();
