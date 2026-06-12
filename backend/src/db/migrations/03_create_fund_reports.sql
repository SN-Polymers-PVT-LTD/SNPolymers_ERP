-- Migration: Create fund_reports Table & Audit Triggers

-- 1. Create fund_reports table
CREATE TABLE IF NOT EXISTS fund_reports (
  fund_report_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_no     VARCHAR NOT NULL REFERENCES projects_master(work_order_no),
  amount            NUMERIC NOT NULL,
  remarks           TEXT,
  
  -- Standard audit fields
  created_by        VARCHAR NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_by         VARCHAR NOT NULL,
  edited_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Soft deletion fields
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by        VARCHAR,
  deleted_at        TIMESTAMPTZ
);

-- 2. Create trigger to automatically update edited_at timestamp for fund_reports
CREATE OR REPLACE FUNCTION set_fund_reports_edited_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.edited_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fund_reports_edited_at ON fund_reports;
CREATE TRIGGER trg_fund_reports_edited_at
BEFORE UPDATE ON fund_reports
FOR EACH ROW
EXECUTE FUNCTION set_fund_reports_edited_at();


-- 3. Create trigger to automatically audit fund_reports CRUD operations
CREATE OR REPLACE FUNCTION audit_fund_reports_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_old_json JSONB := '{}';
  v_new_json JSONB := '{}';
  v_action VARCHAR := 'EDIT';
  v_changed BOOLEAN := FALSE;
  v_user_id VARCHAR;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_json := jsonb_build_object(
      'fund_report_id', NEW.fund_report_id,
      'work_order_no', NEW.work_order_no,
      'amount', NEW.amount,
      'remarks', NEW.remarks
    );
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'CREATE', 'Fund Report', NEW.fund_report_id::VARCHAR, NULL, v_new_json);
    
  ELSIF TG_OP = 'UPDATE' THEN
    v_user_id := NEW.edited_by;
    
    -- Check for Soft Delete / Restore transitions
    IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
      IF NEW.is_deleted = TRUE THEN
        v_action := 'SOFT_DELETE';
        v_old_json := jsonb_build_object('is_deleted', OLD.is_deleted);
        v_new_json := jsonb_build_object('is_deleted', NEW.is_deleted, 'deleted_by', NEW.deleted_by, 'deleted_at', NEW.deleted_at);
        v_user_id := NEW.deleted_by;
        v_changed := TRUE;
      ELSE
        v_action := 'RESTORE';
        v_old_json := jsonb_build_object('is_deleted', OLD.is_deleted, 'deleted_by', OLD.deleted_by, 'deleted_at', OLD.deleted_at);
        v_new_json := jsonb_build_object('is_deleted', NEW.is_deleted);
        v_changed := TRUE;
      END IF;
    END IF;

    -- Compare other fields if not a pure soft delete/restore, or if fields changed concurrently
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
      v_old_json := v_old_json || jsonb_build_object('amount', OLD.amount);
      v_new_json := v_new_json || jsonb_build_object('amount', NEW.amount);
      v_changed := TRUE;
    END IF;
    
    IF NEW.remarks IS DISTINCT FROM OLD.remarks THEN
      v_old_json := v_old_json || jsonb_build_object('remarks', OLD.remarks);
      v_new_json := v_new_json || jsonb_build_object('remarks', NEW.remarks);
      v_changed := TRUE;
    END IF;
    
    IF NEW.work_order_no IS DISTINCT FROM OLD.work_order_no THEN
      v_old_json := v_old_json || jsonb_build_object('work_order_no', OLD.work_order_no);
      v_new_json := v_new_json || jsonb_build_object('work_order_no', NEW.work_order_no);
      v_changed := TRUE;
    END IF;

    IF v_changed THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (v_user_id, v_action, 'Fund Report', NEW.fund_report_id::VARCHAR, v_old_json, v_new_json);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_fund_reports ON fund_reports;
CREATE TRIGGER trg_audit_fund_reports
AFTER INSERT OR UPDATE ON fund_reports
FOR EACH ROW
EXECUTE FUNCTION audit_fund_reports_changes();
