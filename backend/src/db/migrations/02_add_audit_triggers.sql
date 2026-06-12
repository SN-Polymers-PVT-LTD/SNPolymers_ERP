-- Migration: Add Auto-Auditing & Timestamp Triggers to projects_master

-- 1. Create trigger function to automatically update edited_at timestamp
CREATE OR REPLACE FUNCTION set_projects_master_edited_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.edited_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trg_projects_master_edited_at ON projects_master;

CREATE TRIGGER trg_projects_master_edited_at
BEFORE UPDATE ON projects_master
FOR EACH ROW
EXECUTE FUNCTION set_projects_master_edited_at();


-- 2. Create trigger function to automatically log changes in audit_log
CREATE OR REPLACE FUNCTION audit_projects_master_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_old_json JSONB := '{}';
  v_new_json JSONB := '{}';
  v_action VARCHAR := 'EDIT';
  v_changed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_json := jsonb_build_object(
      'work_order_no', NEW.work_order_no,
      'status', NEW.status,
      'estimate_no', NEW.estimate_no,
      'site_details', NEW.site_details,
      'state', NEW.state,
      'district', NEW.district,
      'zone', NEW.zone,
      'department', NEW.department
    );
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'CREATE', 'Project Management', NEW.work_order_no, NULL, v_new_json);
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- If status changes, mark action as STATUS_CHANGE, but continue collecting other modifications
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'STATUS_CHANGE';
      v_old_json := v_old_json || jsonb_build_object('status', OLD.status);
      v_new_json := v_new_json || jsonb_build_object('status', NEW.status);
      v_changed := TRUE;
    END IF;

    -- Compare each business field to build old/new value snapshots
    IF NEW.estimate_no IS DISTINCT FROM OLD.estimate_no THEN
      v_old_json := v_old_json || jsonb_build_object('estimate_no', OLD.estimate_no);
      v_new_json := v_new_json || jsonb_build_object('estimate_no', NEW.estimate_no);
      v_changed := TRUE;
    END IF;
    
    IF NEW.site_details IS DISTINCT FROM OLD.site_details THEN
      v_old_json := v_old_json || jsonb_build_object('site_details', OLD.site_details);
      v_new_json := v_new_json || jsonb_build_object('site_details', NEW.site_details);
      v_changed := TRUE;
    END IF;
    
    IF NEW.state IS DISTINCT FROM OLD.state THEN
      v_old_json := v_old_json || jsonb_build_object('state', OLD.state);
      v_new_json := v_new_json || jsonb_build_object('state', NEW.state);
      v_changed := TRUE;
    END IF;
    
    IF NEW.district IS DISTINCT FROM OLD.district THEN
      v_old_json := v_old_json || jsonb_build_object('district', OLD.district);
      v_new_json := v_new_json || jsonb_build_object('district', NEW.district);
      v_changed := TRUE;
    END IF;
    
    IF NEW.zone IS DISTINCT FROM OLD.zone THEN
      v_old_json := v_old_json || jsonb_build_object('zone', OLD.zone);
      v_new_json := v_new_json || jsonb_build_object('zone', NEW.zone);
      v_changed := TRUE;
    END IF;
    
    IF NEW.department IS DISTINCT FROM OLD.department THEN
      v_old_json := v_old_json || jsonb_build_object('department', OLD.department);
      v_new_json := v_new_json || jsonb_build_object('department', NEW.department);
      v_changed := TRUE;
    END IF;

    -- Only write to audit_log if changes actually occurred
    IF v_changed THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (NEW.edited_by, v_action, 'Project Management', NEW.work_order_no, v_old_json, v_new_json);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS trg_audit_projects_master ON projects_master;

CREATE TRIGGER trg_audit_projects_master
AFTER INSERT OR UPDATE ON projects_master
FOR EACH ROW
EXECUTE FUNCTION audit_projects_master_changes();
