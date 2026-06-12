-- Migration: Create Project Management Module Tables & Constraints
-- DB: PostgreSQL (Supabase)

-- 1. Create enum type for project status
CREATE TYPE project_status AS ENUM ('Running', 'Closed', 'Complete Under Maintenance');

-- 2. Create projects_master table (no soft delete support)
CREATE TABLE IF NOT EXISTS projects_master (
  work_order_no     VARCHAR PRIMARY KEY NOT NULL,
  estimate_no       VARCHAR NOT NULL,
  site_details      TEXT NOT NULL,
  state             VARCHAR NOT NULL,
  district          VARCHAR NOT NULL,
  zone              VARCHAR NOT NULL,
  department        VARCHAR NOT NULL,
  status            project_status NOT NULL DEFAULT 'Running',
  created_by        VARCHAR NOT NULL, -- Stored as user mobile number (e.g., +918276071523)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_by         VARCHAR NOT NULL,  -- Stored as user mobile number (e.g., +918276071523)
  edited_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create audit_log table (append-only)
CREATE TABLE IF NOT EXISTS audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           VARCHAR NOT NULL, -- Stored as mobile number of acting user
  action            VARCHAR NOT NULL, -- e.g., 'CREATE', 'EDIT', 'STATUS_CHANGE'
  module_name       VARCHAR NOT NULL, -- e.g., 'Project Management', 'Fund Report'
  record_identifier VARCHAR NOT NULL, -- e.g., work_order_no or report ID
  old_value         JSONB,            -- NULL on CREATE. Snapshot of changed fields before
  new_value         JSONB,            -- Snapshot of changed fields after
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Create trigger to enforce immutability of work_order_no on projects_master
CREATE OR REPLACE FUNCTION enforce_projects_master_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.work_order_no IS DISTINCT FROM OLD.work_order_no THEN
    RAISE EXCEPTION 'work_order_no is immutable and cannot be edited after creation.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_master_immutability
BEFORE UPDATE ON projects_master
FOR EACH ROW
EXECUTE FUNCTION enforce_projects_master_immutability();

-- 5. Create trigger to enforce append-only behavior on audit_log
CREATE OR REPLACE FUNCTION enforce_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Updates are not permitted on the audit_log table.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Deletions are not permitted on the audit_log table.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION enforce_audit_log_append_only();

-- 6. Insert initial seed data for projects_master (20 records)
INSERT INTO projects_master (work_order_no, estimate_no, site_details, state, district, zone, department, status, created_by, edited_by) VALUES
('WB_APD_101', 'APD_1', 'Main Road Work-1', 'West Bengal', 'Alipurduar', 'North Bengal', 'PWD', 'Running', '+918276071523', '+918276071523'),
('WB_BAN_102', 'BAN_2', 'Main Road Work-2', 'West Bengal', 'Bankura', 'South Bengal', 'PWD', 'Running', '+918276071523', '+918276071523'),
('WB_BIR_103', 'BIR_3', 'Main Road Work-3', 'West Bengal', 'Birbhum', 'South Bengal', 'PWD', 'Running', '+918276071523', '+918276071523'),
('WB_COB_104', 'COB_4', 'Main Road Work-4', 'West Bengal', 'Cooch Behar', 'North Bengal', 'PWD', 'Running', '+918276071523', '+918276071523'),
('SK_GAN_201', 'GAN_1', 'Main Road Work-5', 'Sikkim', 'Gangtok', 'East Sikkim', 'PWD', 'Running', '+918276071523', '+918276071523'),
('SK_GYA_202', 'GYA_2', 'Pipe Line Work-1', 'Sikkim', 'Gyalshing', 'West Sikkim', 'PHE', 'Running', '+918276071523', '+918276071523'),
('OD_ANG_301', 'ANG_1', 'Pipe Line Work-2', 'Odisha', 'Angul', 'Central Odisha', 'PHE', 'Running', '+918276071523', '+918276071523'),
('OD_BAL_302', 'BAL_2', 'Pipe Line Work-3', 'Odisha', 'Balangir', 'Western Odisha', 'PHE', 'Running', '+918276071523', '+918276071523'),
('OD_BALS_303', 'BALS_3', 'Pipe Line Work-4', 'Odisha', 'Balasore', 'North Odisha', 'PHE', 'Running', '+918276071523', '+918276071523'),
('JH_BOK_401', 'BOK_1', 'Pipe Line Work-5', 'Jharkhand', 'Bokaro', 'North Jharkhand', 'PHE', 'Running', '+918276071523', '+918276071523'),
('JH_CHA_402', 'CHA_1', 'River Embankment Construction 1', 'Jharkhand', 'Chatra', 'North Jharkhand', 'Irrigation', 'Running', '+918276071523', '+918276071523'),
('JH_DEO_403', 'DEO_1', 'River Embankment Construction 2', 'Jharkhand', 'Deoghar', 'East Jharkhand', 'Irrigation', 'Running', '+918276071523', '+918276071523'),
('BH_ARA_501', 'ARA_1', 'River Embankment Construction 3', 'Bihar', 'Araria', 'North Bihar', 'Irrigation', 'Running', '+918276071523', '+918276071523'),
('BH_ARW_502', 'ARW_1', 'River Embankment Construction 4', 'Bihar', 'Arwal', 'South Bihar', 'Irrigation', 'Running', '+918276071523', '+918276071523'),
('BH_AUR_503', 'AUR_1', 'River Embankment Construction 5', 'Bihar', 'Aurangabad', 'South Bihar', 'Irrigation', 'Running', '+918276071523', '+918276071523'),
('BH_BAN_504', 'BAN_1', 'Agriculture Irrigation Work-1', 'Bihar', 'Banka', 'South Bihar', 'WRDD', 'Running', '+918276071523', '+918276071523'),
('BH_BEG_505', 'BEG_1', 'Agriculture Irrigation Work-2', 'Bihar', 'Begusarai', 'North Bihar', 'WRDD', 'Running', '+918276071523', '+918276071523'),
('WB_PUM_601', 'PUM_1', 'Agriculture Irrigation Work-3', 'West Bengal', 'Purba Medinipur', 'South Bengal', 'WRDD', 'Running', '+918276071523', '+918276071523'),
('WB_PUR_602', 'PUR_1', 'Agriculture Irrigation Work-4', 'West Bengal', 'Purulia', 'South Bengal', 'WRDD', 'Running', '+918276071523', '+918276071523'),
('WB_S24_603', 'S24_1', 'Agriculture Irrigation Work-5', 'West Bengal', 'South 24 Parganas', 'South Bengal', 'WRDD', 'Running', '+918276071523', '+918276071523')
ON CONFLICT (work_order_no) DO NOTHING;
