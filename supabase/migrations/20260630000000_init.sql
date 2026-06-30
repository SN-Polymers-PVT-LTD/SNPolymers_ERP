


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."estimate_status_enum" AS ENUM (
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


ALTER TYPE "public"."estimate_status_enum" OWNER TO "postgres";


CREATE TYPE "public"."fund_request_status_enum" AS ENUM (
    'Pending',
    'Approved',
    'Hold',
    'Cancelled'
);


ALTER TYPE "public"."fund_request_status_enum" OWNER TO "postgres";


CREATE TYPE "public"."gst_bill_enum" AS ENUM (
    'Yes',
    'No'
);


ALTER TYPE "public"."gst_bill_enum" OWNER TO "postgres";


CREATE TYPE "public"."project_status" AS ENUM (
    'Running',
    'Closed',
    'Complete Under Maintenance'
);


ALTER TYPE "public"."project_status" OWNER TO "postgres";


CREATE TYPE "public"."requisition_action_enum" AS ENUM (
    'Approve',
    'Hold'
);


ALTER TYPE "public"."requisition_action_enum" OWNER TO "postgres";


CREATE TYPE "public"."requisition_status_enum" AS ENUM (
    'Pending',
    'Approved',
    'Hold',
    'Cancelled'
);


ALTER TYPE "public"."requisition_status_enum" OWNER TO "postgres";


CREATE TYPE "public"."row_approval_enum" AS ENUM (
    'Approve',
    'Not Approve'
);


ALTER TYPE "public"."row_approval_enum" OWNER TO "postgres";


CREATE TYPE "public"."transfer_account_enum" AS ENUM (
    'CC',
    'OD',
    'CR'
);


ALTER TYPE "public"."transfer_account_enum" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_daily_progress_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
  VALUES (
    NEW.created_by,
    'CREATE',
    'DailyProgress',
    NEW.report_id::VARCHAR,
    NULL,
    jsonb_build_object(
      'work_order_no',           NEW.work_order_no,
      'site_visit_date',         NEW.site_visit_date,
      'physical_work_progress',  NEW.physical_work_progress
    )
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_daily_progress_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_estimate_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.estimate_status IS DISTINCT FROM OLD.estimate_status THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      NEW.last_modified_by, -- NULL for system auto-resubmissions (no fake mobile number)
      CASE WHEN NEW.last_modified_by IS NULL THEN 'AUTO_RESUBMIT' ELSE 'STATUS_CHANGE' END,
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
$$;


ALTER FUNCTION "public"."audit_estimate_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_fund_reports_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."audit_fund_reports_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_fund_request_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."audit_fund_request_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_material_master_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_old_json JSONB := '{}';
  v_new_json JSONB := '{}';
  v_action VARCHAR := 'EDIT';
  v_changed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_json := jsonb_build_object(
      'id', NEW.id,
      'Material_Main_Head', NEW."Material_Main_Head",
      'Material_Sub_Head', NEW."Material_Sub_Head",
      'Material_Details', NEW."Material_Details",
      'M_Unit', NEW."M_Unit",
      'is_active', NEW.is_active
    );
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'CREATE', 'Material Master', NEW.id::VARCHAR, NULL, v_new_json);
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- If is_active changes, mark action as STATUS_CHANGE
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      v_action := 'STATUS_CHANGE';
      v_old_json := v_old_json || jsonb_build_object('is_active', OLD.is_active);
      v_new_json := v_new_json || jsonb_build_object('is_active', NEW.is_active);
      v_changed := TRUE;
    END IF;

    -- Compare each business field to build old/new value snapshots
    IF NEW."Material_Main_Head" IS DISTINCT FROM OLD."Material_Main_Head" THEN
      v_old_json := v_old_json || jsonb_build_object('Material_Main_Head', OLD."Material_Main_Head");
      v_new_json := v_new_json || jsonb_build_object('Material_Main_Head', NEW."Material_Main_Head");
      v_changed := TRUE;
    END IF;

    IF NEW."Material_Sub_Head" IS DISTINCT FROM OLD."Material_Sub_Head" THEN
      v_old_json := v_old_json || jsonb_build_object('Material_Sub_Head', OLD."Material_Sub_Head");
      v_new_json := v_new_json || jsonb_build_object('Material_Sub_Head', NEW."Material_Sub_Head");
      v_changed := TRUE;
    END IF;

    IF NEW."Material_Details" IS DISTINCT FROM OLD."Material_Details" THEN
      v_old_json := v_old_json || jsonb_build_object('Material_Details', OLD."Material_Details");
      v_new_json := v_new_json || jsonb_build_object('Material_Details', NEW."Material_Details");
      v_changed := TRUE;
    END IF;

    IF NEW."M_Unit" IS DISTINCT FROM OLD."M_Unit" THEN
      v_old_json := v_old_json || jsonb_build_object('M_Unit', OLD."M_Unit");
      v_new_json := v_new_json || jsonb_build_object('M_Unit', NEW."M_Unit");
      v_changed := TRUE;
    END IF;

    -- Only write to audit_log if changes actually occurred
    IF v_changed THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (NEW.edited_by, v_action, 'Material Master', NEW.id::VARCHAR, v_old_json, v_new_json);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_material_master_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_projects_master_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."audit_projects_master_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_ra_final_bill_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."audit_ra_final_bill_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_requisition_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."audit_requisition_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_resubmit_estimate"("p_estimate_id" "uuid", "p_stage" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_status              estimate_status_enum;
  v_new_revision        INT;
  v_open_log_count      INT;
  v_log_id              UUID;
  v_new_amount          NUMERIC(18,2);
  v_target_status       estimate_status_enum;
BEGIN
  -- Lock the estimate header and validate existence
  SELECT estimate_status, estimate_revision INTO v_status, v_new_revision
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;

  -- Validate stage and current status match
  IF p_stage = 'ZO' THEN
    IF v_status <> 'ZO Revision Requested'::estimate_status_enum THEN
      RAISE EXCEPTION 'Expected ZO Revision Requested, found %', v_status;
    END IF;
    v_target_status := 'Submitted'::estimate_status_enum;
  ELSIF p_stage = 'HO' THEN
    IF v_status <> 'HO Revision Requested'::estimate_status_enum THEN
      RAISE EXCEPTION 'Expected HO Revision Requested, found %', v_status;
    END IF;
    v_target_status := 'Under HO Review'::estimate_status_enum;
  ELSE
    RAISE EXCEPTION 'Invalid stage: %. Must be ZO or HO.', p_stage;
  END IF;

  -- Ensure exactly one open revision log entry for this stage
  SELECT COUNT(*) INTO v_open_log_count
  FROM estimate_revision_log
  WHERE estimate_id = p_estimate_id
    AND stage = p_stage
    AND resubmitted_at IS NULL;

  IF v_open_log_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one open revision log, found %', v_open_log_count;
  END IF;

  SELECT id INTO v_log_id
  FROM estimate_revision_log
  WHERE estimate_id = p_estimate_id
    AND stage = p_stage
    AND resubmitted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  -- Close the active revision log entry
  UPDATE estimate_revision_log
  SET resubmitted_at = now(),
      resubmitted_by = NULL,
      is_auto_resubmitted = TRUE,
      modified_item_ids = '{}'
  WHERE id = v_log_id;

  -- Reset unapproved items
  IF p_stage = 'ZO' THEN
    UPDATE project_cost_estimate_items
    SET zo_office_approve = NULL,
        updated_at = now()
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Not Approve';
  ELSIF p_stage = 'HO' THEN
    UPDATE project_cost_estimate_items
    SET ho_office_approve = NULL,
        updated_at = now()
    WHERE estimate_id = p_estimate_id
      AND ho_office_approve = 'Not Approve';
  END IF;

  -- Recalculate amount based on final target status rules
  IF p_stage = 'ZO' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;
  ELSIF p_stage = 'HO' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve';
  END IF;

  -- Update header (last_modified_by = NULL indicates system trigger)
  UPDATE project_cost_estimates
  SET estimate_status = v_target_status,
      estimate_revision = v_new_revision + 1,
      estimate_amount = v_new_amount,
      last_modified_by = NULL,
      updated_at = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;


ALTER FUNCTION "public"."auto_resubmit_estimate"("p_estimate_id" "uuid", "p_stage" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_audit_log_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Updates are not permitted on the audit_log table.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Deletions are not permitted on the audit_log table.';
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."enforce_audit_log_append_only"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_projects_master_immutability"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.work_order_no IS DISTINCT FROM OLD.work_order_no THEN
    RAISE EXCEPTION 'work_order_no is immutable and cannot be edited after creation.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_projects_master_immutability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_daily_progress_hard_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of daily progress reports is permanently prohibited. Records are immutable.';
END;
$$;


ALTER FUNCTION "public"."prevent_daily_progress_hard_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_estimate_hard_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.work_order_no LIKE 'TEST_WO_%' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Hard deletion of project_cost_estimates is permanently prohibited. Records are immutable.';
END;
$$;


ALTER FUNCTION "public"."prevent_estimate_hard_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_fund_request_hard_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of fund_requests is permanently prohibited. Use status transitions instead.';
END;
$$;


ALTER FUNCTION "public"."prevent_fund_request_hard_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_ra_final_bills_hard_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of RA/Final bill records is permanently prohibited. Records are immutable financial documents.';
END;
$$;


ALTER FUNCTION "public"."prevent_ra_final_bills_hard_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_requisition_hard_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of requisitions is permanently prohibited. Use status transitions instead.';
END;
$$;


ALTER FUNCTION "public"."prevent_requisition_hard_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_daily_progress_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_daily_progress_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_estimate_item_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_estimate_item_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_estimate_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_estimate_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_fund_reports_edited_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.edited_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_fund_reports_edited_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_fund_request_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_fund_request_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_material_master_edited_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.edited_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_material_master_edited_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_projects_master_edited_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.edited_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_projects_master_edited_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_ra_final_bills_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_ra_final_bills_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_requisition_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_requisition_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_estimate"("p_estimate_id" "uuid", "p_stage" "text", "p_mobile_number" character varying, "p_new_revision" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_log_id              UUID;
  v_open_log_count      INT;
  v_modified_item_ids   UUID[] := '{}';
  v_new_amount          NUMERIC(18,2);
  v_status              estimate_status_enum;
BEGIN
  -- 1. Lock the estimate header for update to prevent race conditions
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found: %', p_estimate_id;
  END IF;

  -- Enforce expected workflow status inside the RPC itself
  IF p_stage = 'ZO' AND v_status <> 'ZO Revision Requested'::estimate_status_enum THEN
    RAISE EXCEPTION 'Expected ZO Revision Requested, found %', v_status;
  END IF;

  IF p_stage = 'HO' AND v_status <> 'HO Revision Requested'::estimate_status_enum THEN
    RAISE EXCEPTION 'Expected HO Revision Requested, found %', v_status;
  END IF;

  -- 2. Route based on submit stage
  IF p_stage = 'FirstSubmit' THEN
    -- Verify status is Draft before first submit
    IF v_status <> 'Draft'::estimate_status_enum THEN
      RAISE EXCEPTION 'Invalid status for first submission: %', v_status;
    END IF;

  ELSIF p_stage IN ('ZO', 'HO') THEN
    -- Enforce exactly one open revision log entry
    SELECT COUNT(*) INTO v_open_log_count
    FROM estimate_revision_log
    WHERE estimate_id = p_estimate_id
      AND resubmitted_at IS NULL;

    IF v_open_log_count <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one open revision log, found %', v_open_log_count;
    END IF;

    -- Collect modified item IDs BEFORE resetting approval fields
    IF p_stage = 'ZO' THEN
      SELECT ARRAY(
        SELECT item_id FROM project_cost_estimate_items
        WHERE estimate_id = p_estimate_id
          AND zo_office_approve = 'Not Approve'
      ) INTO v_modified_item_ids;

      UPDATE project_cost_estimate_items
      SET zo_office_approve = NULL,
          updated_at = now()
      WHERE estimate_id = p_estimate_id
        AND zo_office_approve = 'Not Approve';

    ELSIF p_stage = 'HO' THEN
      SELECT ARRAY(
        SELECT item_id FROM project_cost_estimate_items
        WHERE estimate_id = p_estimate_id
          AND ho_office_approve = 'Not Approve'
      ) INTO v_modified_item_ids;

      UPDATE project_cost_estimate_items
      SET ho_office_approve = NULL,
          updated_at = now()
      WHERE estimate_id = p_estimate_id
        AND ho_office_approve = 'Not Approve';
    END IF;

    -- Close the active revision log entry (deterministic fetch)
    SELECT id INTO v_log_id
    FROM estimate_revision_log
    WHERE estimate_id = p_estimate_id
      AND resubmitted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    UPDATE estimate_revision_log
    SET resubmitted_at = now(),
        resubmitted_by = p_mobile_number,
        modified_item_ids = v_modified_item_ids
    WHERE id = v_log_id;

  ELSE
    RAISE EXCEPTION 'Invalid submit stage: %. Must be FirstSubmit, ZO, or HO.', p_stage;
  END IF;

  -- 3. Recalculate amount for Submitted status (sum of all items)
  SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id;

  -- 4. Update header status, revision, amount, and timestamp
  IF p_stage = 'FirstSubmit' THEN
    UPDATE project_cost_estimates
    SET estimate_status = 'Submitted'::estimate_status_enum,
        estimate_revision = p_new_revision,
        estimate_amount = v_new_amount,
        last_modified_by = p_mobile_number,
        je_user_id = p_mobile_number,
        je_date = now(),
        updated_at = now()
    WHERE estimate_id = p_estimate_id;
  ELSE
    UPDATE project_cost_estimates
    SET estimate_status = 'Submitted'::estimate_status_enum,
        estimate_revision = p_new_revision,
        estimate_amount = v_new_amount,
        last_modified_by = p_mobile_number,
        updated_at = now()
    WHERE estimate_id = p_estimate_id;
  END IF;

END;
$$;


ALTER FUNCTION "public"."submit_estimate"("p_estimate_id" "uuid", "p_stage" "text", "p_mobile_number" character varying, "p_new_revision" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_ho_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_status              estimate_status_enum;
  v_user_role           VARCHAR;
  v_item_count          INT;
  v_undecided_count     INT;
  v_rejected_count      INT;
  v_target_status       estimate_status_enum;
  v_new_amount          NUMERIC(18,2);
  v_inconsistent_count  INT;
BEGIN
  -- 1. Security Check: Confirm reviewer exists, is active, and is HO or Admin
  SELECT role INTO v_user_role
  FROM authorised_users
  WHERE mobile_number = p_reviewer AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.';
  END IF;

  IF v_user_role NOT IN ('ho', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have HO or Admin role.';
  END IF;

  -- 2. Lock header and validate existence
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;

  -- 3. Acquire exclusive row-level locks on estimate items to prevent concurrent modifications
  PERFORM 1
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  -- 4. Defensive Check: Prevent submission if the estimate contains zero line items
  SELECT COUNT(*) INTO v_item_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Estimate contains no line items.';
  END IF;

  -- 5. Enforce status is Under HO Review
  IF v_status <> 'Under HO Review'::estimate_status_enum THEN
    RAISE EXCEPTION 'Expected Under HO Review, found %', v_status;
  END IF;

  -- 6. Validate all items decided by HO
  SELECT COUNT(*) INTO v_undecided_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND ho_office_approve IS NULL;

  IF v_undecided_count > 0 THEN
    RAISE EXCEPTION 'All rows must be decided. Found % undecided rows.', v_undecided_count;
  END IF;

  -- 7. Determine if any item was rejected by HO
  SELECT COUNT(*) INTO v_rejected_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND ho_office_approve = 'Not Approve';

  IF v_rejected_count > 0 THEN
    v_target_status := 'Rejected by HO'::estimate_status_enum;
    
    -- Rejected is terminal; sum all items for record-keeping
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;
  ELSE
    v_target_status := 'Final Approved'::estimate_status_enum;
    
    -- Defensive Check: Verify all HO approved items were also ZO approved
    SELECT COUNT(*) INTO v_inconsistent_count
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND ho_office_approve = 'Approve'
      AND (zo_office_approve IS NULL OR zo_office_approve <> 'Approve');

    IF v_inconsistent_count > 0 THEN
      RAISE EXCEPTION 'Inconsistent review state: found % items approved by HO that were not approved by ZO.', v_inconsistent_count;
    END IF;

    -- Final Approved: sum items where both ZO and HO approved
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve'
      AND ho_office_approve = 'Approve';
  END IF;

  -- 8. Update header and audit fields (let trigger handle updated_at)
  UPDATE project_cost_estimates
  SET estimate_status = v_target_status,
      estimate_amount = v_new_amount,
      ho_approved_by = p_reviewer,
      ho_approval_date = now(),
      ho_remarks = p_remarks,
      last_modified_by = p_reviewer
  WHERE estimate_id = p_estimate_id;

END;
$$;


ALTER FUNCTION "public"."submit_ho_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_row_approvals"("p_estimate_id" "uuid", "p_approvals" "jsonb", "p_stage" "text", "p_modified_by" character varying) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_role     VARCHAR;
  approval        JSONB;
  v_item_id       UUID;
  v_approve_status TEXT;
  v_remarks       TEXT;
  v_status        estimate_status_enum;
  v_new_amount    NUMERIC(18,2);
  v_rows          INT;
BEGIN
  -- 1. Security Check: Confirm modifier role has authorization for the stage
  SELECT role INTO v_user_role
  FROM authorised_users
  WHERE mobile_number = p_modified_by AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.';
  END IF;

  IF p_stage = 'ZO' AND v_user_role NOT IN ('zo', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have ZO or Admin role.';
  END IF;

  IF p_stage = 'HO' AND v_user_role NOT IN ('ho', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have HO or Admin role.';
  END IF;

  -- 2. Read current estimate status
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found: %', p_estimate_id;
  END IF;

  -- 3. Apply each row approval
  FOR approval IN SELECT * FROM jsonb_array_elements(p_approvals)
  LOOP
    v_item_id       := (approval->>'item_id')::UUID;
    v_approve_status := approval->>'approve_status';
    v_remarks        := approval->>'remarks';

    IF p_stage = 'ZO' THEN
      UPDATE project_cost_estimate_items
      SET
        zo_office_approve = v_approve_status::row_approval_enum,
        zo_remarks        = v_remarks,
        updated_at        = now()
      WHERE item_id = v_item_id
        AND estimate_id = p_estimate_id;
    ELSIF p_stage = 'HO' THEN
      UPDATE project_cost_estimate_items
      SET
        ho_office_approve = v_approve_status::row_approval_enum,
        ho_remarks        = v_remarks,
        updated_at        = now()
      WHERE item_id = v_item_id
        AND estimate_id = p_estimate_id;
    ELSE
      RAISE EXCEPTION 'Invalid stage: %. Must be ZO or HO.', p_stage;
    END IF;

    -- Rollback Safety Check: Validate the target item row was modified
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'Item ID % not found or does not belong to estimate %.', v_item_id, p_estimate_id;
    END IF;
  END LOOP;

  -- 4. Recalculate amount based on current status (Workflow calculation matrix)
  -- Rationale: Approved grand total depends on estimate stage:
  -- - Pre-review / Draft: Sum all items regardless of approvals.
  -- - Under HO Review / ZO Approved: Sum ZO-approved rows.
  -- - Final Approved: Sum rows approved by both ZO and HO.
  -- - Rejected: Sum all items.
  IF v_status IN ('Draft', 'Submitted', 'Under ZO Review', 'ZO Revision Requested',
                  'Rejected by ZO', 'Rejected by HO') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;

  ELSIF v_status IN ('ZO Approved', 'Under HO Review', 'HO Revision Requested') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve';

  ELSIF v_status = 'Final Approved' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve'
      AND ho_office_approve = 'Approve';
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;
  END IF;

  -- 5. Write back to header
  UPDATE project_cost_estimates
  SET
    estimate_amount  = v_new_amount,
    last_modified_by = p_modified_by,
    updated_at       = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;


ALTER FUNCTION "public"."submit_row_approvals"("p_estimate_id" "uuid", "p_approvals" "jsonb", "p_stage" "text", "p_modified_by" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_zo_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_status              estimate_status_enum;
  v_user_role           VARCHAR;
  v_undecided_count     INT;
  v_rejected_count      INT;
  v_target_status       estimate_status_enum;
  v_new_amount          NUMERIC(18,2);
BEGIN
  -- Security Check: Confirm reviewer exists, is active, and is zo or admin
  SELECT role INTO v_user_role
  FROM authorised_users
  WHERE mobile_number = p_reviewer AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.';
  END IF;

  IF v_user_role NOT IN ('zo', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have ZO or Admin role.';
  END IF;

  -- Lock header and validate existence
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;

  -- Enforce status is Under ZO Review
  IF v_status <> 'Under ZO Review'::estimate_status_enum THEN
    RAISE EXCEPTION 'Expected Under ZO Review, found %', v_status;
  END IF;

  -- Validate all items decided
  SELECT COUNT(*) INTO v_undecided_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND zo_office_approve IS NULL;

  IF v_undecided_count > 0 THEN
    RAISE EXCEPTION 'All rows must be decided. Found % undecided rows.', v_undecided_count;
  END IF;

  -- Check for rejected items
  SELECT COUNT(*) INTO v_rejected_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND zo_office_approve = 'Not Approve';

  IF v_rejected_count > 0 THEN
    v_target_status := 'Rejected by ZO'::estimate_status_enum;
    -- Rejected is terminal; sum all items for record-keeping
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;
  ELSE
    v_target_status := 'ZO Approved'::estimate_status_enum;
    -- ZO Approved: sum approved items only (all of them since rejected_count = 0)
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve';
  END IF;

  -- Update header
  UPDATE project_cost_estimates
  SET estimate_status = v_target_status,
      estimate_amount = v_new_amount,
      zo_approved_by = p_reviewer,
      zo_approval_date = now(),
      zo_remarks = p_remarks,
      last_modified_by = p_reviewer,
      updated_at = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;


ALTER FUNCTION "public"."submit_zo_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."purchase_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."purchase_data" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_purchase_option_status"("p_id" "uuid") RETURNS "public"."purchase_data"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_updated_row purchase_data;
BEGIN
  UPDATE purchase_data
  SET is_active = NOT is_active
  WHERE id = p_id
  RETURNING * INTO v_updated_row;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase option with ID % not found.', p_id;
  END IF;
  
  RETURN v_updated_row;
END;
$$;


ALTER FUNCTION "public"."toggle_purchase_option_status"("p_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" character varying,
    "action" character varying NOT NULL,
    "module_name" character varying NOT NULL,
    "record_identifier" character varying NOT NULL,
    "old_value" "jsonb",
    "new_value" "jsonb",
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."authorised_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mobile_number" character varying(15) NOT NULL,
    "display_name" character varying(100),
    "role" character varying(50) DEFAULT 'staff'::character varying,
    "permissions" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true,
    "telegram_chat_id" character varying(50) DEFAULT NULL::character varying,
    CONSTRAINT "authorised_users_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['staff'::character varying, 'admin'::character varying, 'je'::character varying, 'zo'::character varying, 'ho'::character varying])::"text"[])))
);


ALTER TABLE "public"."authorised_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_progress_reports" (
    "report_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" character varying NOT NULL,
    "login_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "work_order_no" character varying NOT NULL,
    "state" character varying NOT NULL,
    "district" character varying NOT NULL,
    "area_code" character varying NOT NULL,
    "department" character varying NOT NULL,
    "site_details" "text" NOT NULL,
    "site_visit_date" "date" NOT NULL,
    "work_progress_details" "text" NOT NULL,
    "physical_work_progress" numeric(5,2) NOT NULL,
    "daily_site_photo_url" "text" NOT NULL,
    "original_photo_filename" character varying,
    "remarks_after_site_visit" "text",
    "remarks_approved_authority" "text",
    "approved_user_id" character varying,
    "approval_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_authority_remarks_consistency" CHECK (((("approved_user_id" IS NULL) AND ("approval_date" IS NULL) AND ("remarks_approved_authority" IS NULL)) OR (("approved_user_id" IS NOT NULL) AND ("approval_date" IS NOT NULL) AND ("remarks_approved_authority" IS NOT NULL)))),
    CONSTRAINT "chk_physical_work_progress" CHECK ((("physical_work_progress" >= (0)::numeric) AND ("physical_work_progress" <= (100)::numeric)))
);


ALTER TABLE "public"."daily_progress_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."estimate_revision_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "estimate_id" "uuid" NOT NULL,
    "revision_cycle" integer DEFAULT 1 NOT NULL,
    "stage" character varying NOT NULL,
    "requested_by" character varying NOT NULL,
    "revision_deadline" timestamp with time zone NOT NULL,
    "resubmitted_at" timestamp with time zone,
    "resubmitted_by" character varying,
    "is_auto_resubmitted" boolean DEFAULT false NOT NULL,
    "modified_item_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."estimate_revision_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fund_reports" (
    "fund_report_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_order_no" character varying NOT NULL,
    "amount" numeric NOT NULL,
    "remarks" "text",
    "created_by" character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_by" character varying NOT NULL,
    "edited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_by" character varying,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."fund_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fund_requests" (
    "fund_request_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "zo_user_id" character varying NOT NULL,
    "zo_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "zo_fr_no" character varying NOT NULL,
    "zo_fr_amount" numeric(18,2) NOT NULL,
    "zo_remarks" "text",
    "request_status" "public"."fund_request_status_enum" DEFAULT 'Pending'::"public"."fund_request_status_enum" NOT NULL,
    "approve_ho_user_id" character varying,
    "approve_ho_date" timestamp with time zone,
    "approve_ho_amount" numeric(18,2),
    "transfer_from_account" "public"."transfer_account_enum",
    "ho_remarks" "text",
    "cancelled_by" character varying,
    "cancelled_at" timestamp with time zone,
    "created_by" character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attachments" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."fund_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_master" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "Material_Main_Head" character varying NOT NULL,
    "Material_Sub_Head" character varying NOT NULL,
    "Material_Details" "text" NOT NULL,
    "M_Unit" character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" character varying DEFAULT '+918276071523'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_by" character varying,
    "edited_at" timestamp with time zone
);


ALTER TABLE "public"."material_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."otp_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mobile_number" character varying(15) NOT NULL,
    "otp_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "is_used" boolean DEFAULT false,
    "attempts" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."otp_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_cost_estimate_items" (
    "item_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "estimate_id" "uuid" NOT NULL,
    "material_main_head" character varying NOT NULL,
    "material_sub_head" character varying NOT NULL,
    "material_details" character varying NOT NULL,
    "unit" character varying NOT NULL,
    "qty" numeric(18,4) DEFAULT 0 NOT NULL,
    "rate" numeric(18,4) DEFAULT 0 NOT NULL,
    "rate_reference" character varying,
    "amount" numeric(18,2) DEFAULT 0 NOT NULL,
    "source_of_purchase" "uuid",
    "zo_office_approve" "public"."row_approval_enum",
    "zo_remarks" "text",
    "ho_office_approve" "public"."row_approval_enum",
    "ho_remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_item_amount" CHECK (("amount" = "round"(("qty" * "rate"), 2)))
);


ALTER TABLE "public"."project_cost_estimate_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_cost_estimates" (
    "estimate_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_order_no" character varying NOT NULL,
    "estimate_no" character varying NOT NULL,
    "area_code" character varying NOT NULL,
    "estimate_revision" integer DEFAULT 0 NOT NULL,
    "zonal_office_no" character varying NOT NULL,
    "estimate_amount" numeric(18,2) DEFAULT 0 NOT NULL,
    "estimate_status" "public"."estimate_status_enum" DEFAULT 'Draft'::"public"."estimate_status_enum" NOT NULL,
    "last_modified_by" character varying,
    "je_user_id" character varying,
    "je_date" timestamp with time zone,
    "je_remarks" "text",
    "zo_approved_by" character varying,
    "zo_approval_date" timestamp with time zone,
    "zo_remarks" "text",
    "ho_approved_by" character varying,
    "ho_approval_date" timestamp with time zone,
    "ho_remarks" "text",
    "created_by" character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_cost_estimates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects_master" (
    "work_order_no" character varying NOT NULL,
    "estimate_no" character varying NOT NULL,
    "site_details" "text" NOT NULL,
    "state" character varying NOT NULL,
    "district" character varying NOT NULL,
    "zone" character varying NOT NULL,
    "department" character varying NOT NULL,
    "status" "public"."project_status" DEFAULT 'Running'::"public"."project_status" NOT NULL,
    "created_by" character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "edited_by" character varying NOT NULL,
    "edited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "work_order_value" numeric(18,2) NOT NULL
);


ALTER TABLE "public"."projects_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ra_final_bills" (
    "bill_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" character varying NOT NULL,
    "login_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "work_order_no" character varying NOT NULL,
    "state" character varying NOT NULL,
    "district" character varying NOT NULL,
    "area_code" character varying NOT NULL,
    "department" character varying NOT NULL,
    "site_details" "text" NOT NULL,
    "payment_type" character varying NOT NULL,
    "bill_date" "date" NOT NULL,
    "bill_no" character varying NOT NULL,
    "bill_amount_with_gst" numeric(18,2) NOT NULL,
    "earnest_money_deposit" numeric(18,2) DEFAULT 0 NOT NULL,
    "security_deposit_amount" numeric(18,2) DEFAULT 0 NOT NULL,
    "bill_copy_url" "text" NOT NULL,
    "original_bill_filename" character varying,
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_bill_amount_positive" CHECK (("bill_amount_with_gst" > (0)::numeric)),
    CONSTRAINT "chk_emd_non_negative" CHECK (("earnest_money_deposit" >= (0)::numeric)),
    CONSTRAINT "chk_payment_type_format" CHECK ((("payment_type")::"text" ~ '^(RA Bill [1-9][0-9]*|Final Bill)$'::"text")),
    CONSTRAINT "chk_sd_non_negative" CHECK (("security_deposit_amount" >= (0)::numeric))
);


ALTER TABLE "public"."ra_final_bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."requisitions" (
    "requisition_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requester_user_id" character varying NOT NULL,
    "login_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "work_order_no" character varying NOT NULL,
    "estimate_no" character varying NOT NULL,
    "estimate_amount" numeric(18,2),
    "state" character varying NOT NULL,
    "district" character varying NOT NULL,
    "area_code" character varying NOT NULL,
    "department" character varying NOT NULL,
    "site_details" "text" NOT NULL,
    "requisition_no" character varying NOT NULL,
    "material_main_head" character varying NOT NULL,
    "requisition_pdf_url" "text" NOT NULL,
    "original_filename" character varying,
    "requisition_amount" numeric(18,2) NOT NULL,
    "gst_bill" "public"."gst_bill_enum" NOT NULL,
    "gst_bill_pdf_url" "text",
    "bank_details" "text" NOT NULL,
    "expen_head_remarks" "text",
    "requisition_status" "public"."requisition_status_enum" DEFAULT 'Pending'::"public"."requisition_status_enum" NOT NULL,
    "approved_user_id" character varying,
    "payment_date" timestamp with time zone,
    "approve_type" "public"."requisition_action_enum",
    "approved_amount" numeric(18,2),
    "approved_balance_amount" numeric(18,2),
    "remarks_approved_authority" "text",
    "cancelled_by" character varying,
    "cancelled_at" timestamp with time zone,
    "created_by" character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_balance_amount" CHECK ((("requisition_status" <> 'Approved'::"public"."requisition_status_enum") OR (("approved_amount" IS NOT NULL) AND ("approved_amount" <= "requisition_amount") AND ("approved_balance_amount" IS NOT NULL) AND ("approved_balance_amount" = ("requisition_amount" - "approved_amount"))))),
    CONSTRAINT "chk_gst_bill_pdf" CHECK ((("gst_bill" <> 'Yes'::"public"."gst_bill_enum") OR ("gst_bill_pdf_url" IS NOT NULL))),
    CONSTRAINT "requisitions_requisition_amount_check" CHECK (("requisition_amount" > (0)::numeric))
);


ALTER TABLE "public"."requisitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "login_at" timestamp with time zone DEFAULT "now"(),
    "logout_at" timestamp with time zone,
    "duration_seconds" integer,
    "ip_address" "inet",
    "user_agent" "text",
    "module" character varying(50) DEFAULT 'office'::character varying,
    "jwt_jti" character varying(100),
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_login_stats" WITH ("security_invoker"='true') AS
 SELECT "u"."id",
    "u"."mobile_number",
    "u"."display_name",
    "u"."role",
    "u"."permissions",
    "u"."created_at",
    "u"."is_active",
    "u"."telegram_chat_id",
    ("count"("s"."id"))::integer AS "session_count",
    "max"("s"."login_at") AS "last_login_at"
   FROM ("public"."authorised_users" "u"
     LEFT JOIN "public"."sessions" "s" ON (("u"."id" = "s"."user_id")))
  GROUP BY "u"."id", "u"."mobile_number", "u"."display_name", "u"."role", "u"."permissions", "u"."created_at", "u"."is_active", "u"."telegram_chat_id";


ALTER VIEW "public"."user_login_stats" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."authorised_users"
    ADD CONSTRAINT "authorised_users_mobile_number_key" UNIQUE ("mobile_number");



ALTER TABLE ONLY "public"."authorised_users"
    ADD CONSTRAINT "authorised_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "daily_progress_reports_pkey" PRIMARY KEY ("report_id");



ALTER TABLE ONLY "public"."estimate_revision_log"
    ADD CONSTRAINT "estimate_revision_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fund_reports"
    ADD CONSTRAINT "fund_reports_pkey" PRIMARY KEY ("fund_report_id");



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_pkey" PRIMARY KEY ("fund_request_id");



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_zo_fr_no_key" UNIQUE ("zo_fr_no");



ALTER TABLE ONLY "public"."material_master"
    ADD CONSTRAINT "material_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."otp_requests"
    ADD CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_cost_estimate_items"
    ADD CONSTRAINT "project_cost_estimate_items_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."project_cost_estimates"
    ADD CONSTRAINT "project_cost_estimates_pkey" PRIMARY KEY ("estimate_id");



ALTER TABLE ONLY "public"."projects_master"
    ADD CONSTRAINT "projects_master_pkey" PRIMARY KEY ("work_order_no");



ALTER TABLE ONLY "public"."purchase_data"
    ADD CONSTRAINT "purchase_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ra_final_bills"
    ADD CONSTRAINT "ra_final_bills_pkey" PRIMARY KEY ("bill_id");



ALTER TABLE ONLY "public"."requisitions"
    ADD CONSTRAINT "requisitions_pkey" PRIMARY KEY ("requisition_id");



ALTER TABLE ONLY "public"."requisitions"
    ADD CONSTRAINT "requisitions_requisition_no_key" UNIQUE ("requisition_no");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_jwt_jti_key" UNIQUE ("jwt_jti");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects_master"
    ADD CONSTRAINT "unique_estimate_no" UNIQUE ("estimate_no");



ALTER TABLE ONLY "public"."ra_final_bills"
    ADD CONSTRAINT "uq_bill_per_payment_type" UNIQUE ("work_order_no", "payment_type");



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "uq_daily_progress_work_order_date" UNIQUE ("work_order_no", "site_visit_date");



CREATE INDEX "idx_daily_progress_created_by" ON "public"."daily_progress_reports" USING "btree" ("created_by");



CREATE INDEX "idx_daily_progress_site_visit_date" ON "public"."daily_progress_reports" USING "btree" ("site_visit_date" DESC);



CREATE INDEX "idx_daily_progress_work_order" ON "public"."daily_progress_reports" USING "btree" ("work_order_no");



CREATE INDEX "idx_erl_created" ON "public"."estimate_revision_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_erl_estimate" ON "public"."estimate_revision_log" USING "btree" ("estimate_id");



CREATE INDEX "idx_fund_requests_status" ON "public"."fund_requests" USING "btree" ("request_status") WHERE ("request_status" = 'Pending'::"public"."fund_request_status_enum");



CREATE INDEX "idx_material_active" ON "public"."material_master" USING "btree" ("is_active");



CREATE INDEX "idx_material_main_head" ON "public"."material_master" USING "btree" ("Material_Main_Head");



CREATE INDEX "idx_material_sub_head" ON "public"."material_master" USING "btree" ("Material_Sub_Head");



CREATE INDEX "idx_pce_status" ON "public"."project_cost_estimates" USING "btree" ("estimate_status");



CREATE INDEX "idx_pce_work_order" ON "public"."project_cost_estimates" USING "btree" ("work_order_no");



CREATE INDEX "idx_pcei_estimate" ON "public"."project_cost_estimate_items" USING "btree" ("estimate_id");



CREATE INDEX "idx_ra_final_bills_bill_date" ON "public"."ra_final_bills" USING "btree" ("bill_date" DESC);



CREATE INDEX "idx_ra_final_bills_created_by" ON "public"."ra_final_bills" USING "btree" ("created_by");



CREATE INDEX "idx_ra_final_bills_work_order" ON "public"."ra_final_bills" USING "btree" ("work_order_no");



CREATE INDEX "idx_requisitions_requester" ON "public"."requisitions" USING "btree" ("requester_user_id");



CREATE INDEX "idx_requisitions_status" ON "public"."requisitions" USING "btree" ("requisition_status") WHERE ("requisition_status" = 'Pending'::"public"."requisition_status_enum");



CREATE INDEX "idx_requisitions_work_order" ON "public"."requisitions" USING "btree" ("work_order_no");



CREATE INDEX "idx_sessions_user_login" ON "public"."sessions" USING "btree" ("user_id", "login_at" DESC);



CREATE UNIQUE INDEX "purchase_data_name_key" ON "public"."purchase_data" USING "btree" ("name");



CREATE UNIQUE INDEX "purchase_data_name_unique" ON "public"."purchase_data" USING "btree" ("lower"(("name")::"text"));



CREATE UNIQUE INDEX "uniq_active_revision" ON "public"."estimate_revision_log" USING "btree" ("estimate_id") WHERE ("resubmitted_at" IS NULL);



CREATE OR REPLACE TRIGGER "trg_audit_daily_progress_insert" AFTER INSERT ON "public"."daily_progress_reports" FOR EACH ROW EXECUTE FUNCTION "public"."audit_daily_progress_insert"();



CREATE OR REPLACE TRIGGER "trg_audit_estimate_status" AFTER UPDATE ON "public"."project_cost_estimates" FOR EACH ROW EXECUTE FUNCTION "public"."audit_estimate_status_change"();



CREATE OR REPLACE TRIGGER "trg_audit_fund_reports" AFTER INSERT OR UPDATE ON "public"."fund_reports" FOR EACH ROW EXECUTE FUNCTION "public"."audit_fund_reports_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_fund_request_status" AFTER UPDATE ON "public"."fund_requests" FOR EACH ROW EXECUTE FUNCTION "public"."audit_fund_request_status_change"();



CREATE OR REPLACE TRIGGER "trg_audit_log_append_only" BEFORE DELETE OR UPDATE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_audit_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_audit_material_master" AFTER INSERT OR UPDATE ON "public"."material_master" FOR EACH ROW EXECUTE FUNCTION "public"."audit_material_master_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_projects_master" AFTER INSERT OR UPDATE ON "public"."projects_master" FOR EACH ROW EXECUTE FUNCTION "public"."audit_projects_master_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_ra_final_bill_insert" AFTER INSERT ON "public"."ra_final_bills" FOR EACH ROW EXECUTE FUNCTION "public"."audit_ra_final_bill_insert"();



CREATE OR REPLACE TRIGGER "trg_audit_requisition_status" AFTER UPDATE ON "public"."requisitions" FOR EACH ROW EXECUTE FUNCTION "public"."audit_requisition_status_change"();



CREATE OR REPLACE TRIGGER "trg_daily_progress_updated_at" BEFORE UPDATE ON "public"."daily_progress_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_daily_progress_updated_at"();



CREATE OR REPLACE TRIGGER "trg_estimate_item_updated_at" BEFORE UPDATE ON "public"."project_cost_estimate_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_estimate_item_updated_at"();



CREATE OR REPLACE TRIGGER "trg_estimate_updated_at" BEFORE UPDATE ON "public"."project_cost_estimates" FOR EACH ROW EXECUTE FUNCTION "public"."set_estimate_updated_at"();



CREATE OR REPLACE TRIGGER "trg_fund_reports_edited_at" BEFORE UPDATE ON "public"."fund_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_fund_reports_edited_at"();



CREATE OR REPLACE TRIGGER "trg_fund_request_updated_at" BEFORE UPDATE ON "public"."fund_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_fund_request_updated_at"();



CREATE OR REPLACE TRIGGER "trg_material_master_edited_at" BEFORE UPDATE ON "public"."material_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_material_master_edited_at"();



CREATE OR REPLACE TRIGGER "trg_prevent_daily_progress_hard_delete" BEFORE DELETE ON "public"."daily_progress_reports" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_daily_progress_hard_delete"();



CREATE OR REPLACE TRIGGER "trg_prevent_estimate_hard_delete" BEFORE DELETE ON "public"."project_cost_estimates" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_estimate_hard_delete"();



CREATE OR REPLACE TRIGGER "trg_prevent_fund_request_hard_delete" BEFORE DELETE ON "public"."fund_requests" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fund_request_hard_delete"();



CREATE OR REPLACE TRIGGER "trg_prevent_ra_final_bills_hard_delete" BEFORE DELETE ON "public"."ra_final_bills" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_ra_final_bills_hard_delete"();



CREATE OR REPLACE TRIGGER "trg_prevent_requisition_hard_delete" BEFORE DELETE ON "public"."requisitions" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_requisition_hard_delete"();



CREATE OR REPLACE TRIGGER "trg_projects_master_edited_at" BEFORE UPDATE ON "public"."projects_master" FOR EACH ROW EXECUTE FUNCTION "public"."set_projects_master_edited_at"();



CREATE OR REPLACE TRIGGER "trg_projects_master_immutability" BEFORE UPDATE ON "public"."projects_master" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_projects_master_immutability"();



CREATE OR REPLACE TRIGGER "trg_ra_final_bills_updated_at" BEFORE UPDATE ON "public"."ra_final_bills" FOR EACH ROW EXECUTE FUNCTION "public"."set_ra_final_bills_updated_at"();



CREATE OR REPLACE TRIGGER "trg_requisition_updated_at" BEFORE UPDATE ON "public"."requisitions" FOR EACH ROW EXECUTE FUNCTION "public"."set_requisition_updated_at"();



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "daily_progress_reports_approved_user_id_fkey" FOREIGN KEY ("approved_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "daily_progress_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "daily_progress_reports_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimate_revision_log"
    ADD CONSTRAINT "estimate_revision_log_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "public"."project_cost_estimates"("estimate_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimate_revision_log"
    ADD CONSTRAINT "estimate_revision_log_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimate_revision_log"
    ADD CONSTRAINT "estimate_revision_log_resubmitted_by_fkey" FOREIGN KEY ("resubmitted_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_reports"
    ADD CONSTRAINT "fund_reports_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no");



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_approve_ho_user_id_fkey" FOREIGN KEY ("approve_ho_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_cost_estimate_items"
    ADD CONSTRAINT "project_cost_estimate_items_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "public"."project_cost_estimates"("estimate_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_cost_estimate_items"
    ADD CONSTRAINT "project_cost_estimate_items_source_of_purchase_fkey" FOREIGN KEY ("source_of_purchase") REFERENCES "public"."purchase_data"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_cost_estimates"
    ADD CONSTRAINT "project_cost_estimates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_cost_estimates"
    ADD CONSTRAINT "project_cost_estimates_ho_approved_by_fkey" FOREIGN KEY ("ho_approved_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_cost_estimates"
    ADD CONSTRAINT "project_cost_estimates_je_user_id_fkey" FOREIGN KEY ("je_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_cost_estimates"
    ADD CONSTRAINT "project_cost_estimates_last_modified_by_fkey" FOREIGN KEY ("last_modified_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_cost_estimates"
    ADD CONSTRAINT "project_cost_estimates_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_cost_estimates"
    ADD CONSTRAINT "project_cost_estimates_zo_approved_by_fkey" FOREIGN KEY ("zo_approved_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_data"
    ADD CONSTRAINT "purchase_data_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ra_final_bills"
    ADD CONSTRAINT "ra_final_bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ra_final_bills"
    ADD CONSTRAINT "ra_final_bills_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."requisitions"
    ADD CONSTRAINT "requisitions_approved_user_id_fkey" FOREIGN KEY ("approved_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."requisitions"
    ADD CONSTRAINT "requisitions_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."requisitions"
    ADD CONSTRAINT "requisitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."requisitions"
    ADD CONSTRAINT "requisitions_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."requisitions"
    ADD CONSTRAINT "requisitions_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."authorised_users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."authorised_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_progress_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."estimate_revision_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fund_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fund_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."otp_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_cost_estimate_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_cost_estimates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ra_final_bills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."requisitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_daily_progress_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_daily_progress_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_daily_progress_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_estimate_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_estimate_status_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_estimate_status_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_fund_reports_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_fund_reports_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_fund_reports_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_fund_request_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_fund_request_status_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_fund_request_status_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_material_master_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_material_master_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_material_master_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_projects_master_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_projects_master_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_projects_master_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_ra_final_bill_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_ra_final_bill_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_ra_final_bill_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_requisition_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_requisition_status_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_requisition_status_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_resubmit_estimate"("p_estimate_id" "uuid", "p_stage" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."auto_resubmit_estimate"("p_estimate_id" "uuid", "p_stage" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_resubmit_estimate"("p_estimate_id" "uuid", "p_stage" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_audit_log_append_only"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_audit_log_append_only"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_audit_log_append_only"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_projects_master_immutability"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_projects_master_immutability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_projects_master_immutability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_daily_progress_hard_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_daily_progress_hard_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_daily_progress_hard_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_estimate_hard_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_estimate_hard_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_estimate_hard_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_fund_request_hard_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_fund_request_hard_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_fund_request_hard_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_ra_final_bills_hard_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_ra_final_bills_hard_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_ra_final_bills_hard_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_requisition_hard_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_requisition_hard_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_requisition_hard_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_daily_progress_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_daily_progress_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_daily_progress_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_estimate_item_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_estimate_item_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_estimate_item_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_estimate_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_estimate_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_estimate_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_fund_reports_edited_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_fund_reports_edited_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_fund_reports_edited_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_fund_request_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_fund_request_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_fund_request_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_material_master_edited_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_material_master_edited_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_material_master_edited_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_projects_master_edited_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_projects_master_edited_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_projects_master_edited_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_ra_final_bills_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_ra_final_bills_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_ra_final_bills_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_requisition_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_requisition_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_requisition_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_estimate"("p_estimate_id" "uuid", "p_stage" "text", "p_mobile_number" character varying, "p_new_revision" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."submit_estimate"("p_estimate_id" "uuid", "p_stage" "text", "p_mobile_number" character varying, "p_new_revision" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_estimate"("p_estimate_id" "uuid", "p_stage" "text", "p_mobile_number" character varying, "p_new_revision" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_ho_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_ho_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_ho_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_row_approvals"("p_estimate_id" "uuid", "p_approvals" "jsonb", "p_stage" "text", "p_modified_by" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."submit_row_approvals"("p_estimate_id" "uuid", "p_approvals" "jsonb", "p_stage" "text", "p_modified_by" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_row_approvals"("p_estimate_id" "uuid", "p_approvals" "jsonb", "p_stage" "text", "p_modified_by" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_zo_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_zo_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_zo_review"("p_estimate_id" "uuid", "p_reviewer" character varying, "p_remarks" "text") TO "service_role";



GRANT ALL ON TABLE "public"."purchase_data" TO "anon";
GRANT ALL ON TABLE "public"."purchase_data" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_data" TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_purchase_option_status"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_purchase_option_status"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_purchase_option_status"("p_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."authorised_users" TO "anon";
GRANT ALL ON TABLE "public"."authorised_users" TO "authenticated";
GRANT ALL ON TABLE "public"."authorised_users" TO "service_role";



GRANT ALL ON TABLE "public"."daily_progress_reports" TO "anon";
GRANT ALL ON TABLE "public"."daily_progress_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_progress_reports" TO "service_role";



GRANT ALL ON TABLE "public"."estimate_revision_log" TO "anon";
GRANT ALL ON TABLE "public"."estimate_revision_log" TO "authenticated";
GRANT ALL ON TABLE "public"."estimate_revision_log" TO "service_role";



GRANT ALL ON TABLE "public"."fund_reports" TO "anon";
GRANT ALL ON TABLE "public"."fund_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."fund_reports" TO "service_role";



GRANT ALL ON TABLE "public"."fund_requests" TO "anon";
GRANT ALL ON TABLE "public"."fund_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."fund_requests" TO "service_role";



GRANT ALL ON TABLE "public"."material_master" TO "anon";
GRANT ALL ON TABLE "public"."material_master" TO "authenticated";
GRANT ALL ON TABLE "public"."material_master" TO "service_role";



GRANT ALL ON TABLE "public"."otp_requests" TO "anon";
GRANT ALL ON TABLE "public"."otp_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."otp_requests" TO "service_role";



GRANT ALL ON TABLE "public"."project_cost_estimate_items" TO "anon";
GRANT ALL ON TABLE "public"."project_cost_estimate_items" TO "authenticated";
GRANT ALL ON TABLE "public"."project_cost_estimate_items" TO "service_role";



GRANT ALL ON TABLE "public"."project_cost_estimates" TO "anon";
GRANT ALL ON TABLE "public"."project_cost_estimates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_cost_estimates" TO "service_role";



GRANT ALL ON TABLE "public"."projects_master" TO "anon";
GRANT ALL ON TABLE "public"."projects_master" TO "authenticated";
GRANT ALL ON TABLE "public"."projects_master" TO "service_role";



GRANT ALL ON TABLE "public"."ra_final_bills" TO "anon";
GRANT ALL ON TABLE "public"."ra_final_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."ra_final_bills" TO "service_role";



GRANT ALL ON TABLE "public"."requisitions" TO "anon";
GRANT ALL ON TABLE "public"."requisitions" TO "authenticated";
GRANT ALL ON TABLE "public"."requisitions" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."user_login_stats" TO "anon";
GRANT ALL ON TABLE "public"."user_login_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."user_login_stats" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







