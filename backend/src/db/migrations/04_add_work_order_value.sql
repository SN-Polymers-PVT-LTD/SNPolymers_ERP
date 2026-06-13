-- Migration: Add work_order_value to projects_master and Update Audit Triggers
-- DB: PostgreSQL (Supabase)

-- 1. Add column to projects_master as nullable first
ALTER TABLE projects_master 
ADD COLUMN IF NOT EXISTS work_order_value NUMERIC(18,2);

-- 2. Populate existing records with a default value of 0.00
UPDATE projects_master 
SET work_order_value = 0.00 
WHERE work_order_value IS NULL;

-- 3. Enforce NOT NULL constraint on work_order_value
ALTER TABLE projects_master 
ALTER COLUMN work_order_value SET NOT NULL;

-- 4. Update the audit trigger function to include work_order_value
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
      'work_order_value', NEW.work_order_value,
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

    IF NEW.work_order_value IS DISTINCT FROM OLD.work_order_value THEN
      v_old_json := v_old_json || jsonb_build_object('work_order_value', OLD.work_order_value);
      v_new_json := v_new_json || jsonb_build_object('work_order_value', NEW.work_order_value);
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
