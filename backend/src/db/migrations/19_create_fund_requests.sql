-- Migration 19: Phase 3 — Fund Requests
-- DB: PostgreSQL (Supabase)

CREATE TYPE fund_request_status_enum AS ENUM (
  'Pending',
  'Approved',
  'Hold',
  'Cancelled'
);

CREATE TYPE transfer_account_enum AS ENUM ('CC', 'OD', 'CR');

CREATE TABLE IF NOT EXISTS fund_requests (
  fund_request_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zo_user_id            VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  zo_date               TIMESTAMPTZ NOT NULL DEFAULT now(),
  zo_fr_no              VARCHAR NOT NULL UNIQUE,
  zo_fr_amount          NUMERIC(18,2) NOT NULL,
  zo_remarks            TEXT,
  request_status        fund_request_status_enum NOT NULL DEFAULT 'Pending',
  approve_ho_user_id    VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  approve_ho_date       TIMESTAMPTZ,
  approve_ho_amount     NUMERIC(18,2),
  transfer_from_account transfer_account_enum,
  ho_remarks            TEXT,
  cancelled_by          VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  cancelled_at          TIMESTAMPTZ,
  created_by            VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fund_requests_status
  ON fund_requests(request_status)
  WHERE request_status = 'Pending';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_fund_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fund_request_updated_at ON fund_requests;
CREATE TRIGGER trg_fund_request_updated_at
BEFORE UPDATE ON fund_requests
FOR EACH ROW EXECUTE FUNCTION set_fund_request_updated_at();

-- Block hard DELETE
CREATE OR REPLACE FUNCTION prevent_fund_request_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of fund_requests is permanently prohibited. Use status transitions instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_fund_request_hard_delete ON fund_requests;
CREATE TRIGGER trg_prevent_fund_request_hard_delete
BEFORE DELETE ON fund_requests
FOR EACH ROW EXECUTE FUNCTION prevent_fund_request_hard_delete();

-- Audit status changes
CREATE OR REPLACE FUNCTION audit_fund_request_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.request_status IS DISTINCT FROM OLD.request_status THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      COALESCE(NEW.approve_ho_user_id, NEW.cancelled_by, NEW.created_by),
      'STATUS_CHANGE',
      'Fund Request',
      NEW.fund_request_id::VARCHAR,
      jsonb_build_object('request_status', OLD.request_status),
      jsonb_build_object('request_status', NEW.request_status)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_fund_request_status ON fund_requests;
CREATE TRIGGER trg_audit_fund_request_status
AFTER UPDATE ON fund_requests
FOR EACH ROW EXECUTE FUNCTION audit_fund_request_status_change();
