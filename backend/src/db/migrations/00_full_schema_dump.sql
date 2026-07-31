


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


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






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
    'Rejected by HO',
    'Estimate Reopened'
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

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."excess_fund_returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "zo_user_id" character varying NOT NULL,
    "work_order_no" character varying,
    "requested_amount" numeric(18,2) NOT NULL,
    "status" character varying NOT NULL,
    "remarks_ho" "text",
    "remarks_zo" "text",
    "requested_by" character varying NOT NULL,
    "actioned_by" character varying,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "breakdown" "jsonb",
    CONSTRAINT "excess_fund_returns_requested_amount_check" CHECK (("requested_amount" > 0.00)),
    CONSTRAINT "excess_fund_returns_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['Requested'::character varying, 'Completed'::character varying, 'Awaiting HO Review'::character varying, 'Rejected'::character varying, 'Cancelled'::character varying])::"text"[])))
);


ALTER TABLE "public"."excess_fund_returns" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_excess_fund_return"("p_return_id" "uuid", "p_client_updated_at" timestamp with time zone, "p_actioned_by" character varying) RETURNS "public"."excess_fund_returns"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_return public.excess_fund_returns;
    v_balance NUMERIC(18,2);
BEGIN
    -- 1. Lock the return request row
    SELECT * INTO v_return FROM public.excess_fund_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Excess fund return request not found.';
    END IF;

    -- 2. Validate current status is Requested or Awaiting HO Review
    IF v_return.status NOT IN ('Requested', 'Awaiting HO Review') THEN
        RAISE EXCEPTION 'Excess fund return request cannot be accepted in its current status.';
    END IF;

    -- 3. Optimistic concurrency lock: check updated_at mismatch
    IF v_return.updated_at != p_client_updated_at THEN
        RAISE EXCEPTION 'Stale acceptance request.';
    END IF;

    -- 4. Lock the ZO balance row
    SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_return.zo_user_id FOR UPDATE;
    IF NOT FOUND OR v_balance < v_return.requested_amount THEN
        RAISE EXCEPTION 'Insufficient available balance.';
    END IF;

    -- 5. Deduct from balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance - v_return.requested_amount, updated_at = now()
    WHERE zo_user_id = v_return.zo_user_id;

    -- 6. Insert ledger debit record
    INSERT INTO public.zo_fund_ledger (
        zo_user_id,
        transaction_type,
        reference_type,
        reference_id,
        amount,
        work_order_no,
        created_by
    ) VALUES (
        v_return.zo_user_id,
        'RETURN',
        'RETURN',
        p_return_id,
        -v_return.requested_amount,
        v_return.work_order_no,
        p_actioned_by
    );

    -- Initial population of analytics materialized views
    SELECT public.refresh_analytics_views();

    -- 7. Update status to Completed
    UPDATE public.excess_fund_returns
    SET 
        status = 'Completed',
        actioned_by = p_actioned_by,
        updated_at = now()
    WHERE id = p_return_id
    RETURNING * INTO v_return;

    RETURN v_return;
END;
$$;


ALTER FUNCTION "public"."accept_excess_fund_return"("p_return_id" "uuid", "p_client_updated_at" timestamp with time zone, "p_actioned_by" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."action_excess_fund_return"("p_return_id" "uuid", "p_status" character varying, "p_actioned_by" character varying, "p_action_remarks" "text" DEFAULT NULL::"text") RETURNS "public"."excess_fund_returns"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_return public.excess_fund_returns;
    v_balance NUMERIC(18,2);
BEGIN
    -- 1. Validate status parameter
    IF p_status NOT IN ('Approved', 'Rejected') THEN
        RAISE EXCEPTION 'Invalid status. Must be Approved or Rejected.';
    END IF;

    -- 2. Lock the return request row
    SELECT * INTO v_return FROM public.excess_fund_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Excess fund return request not found.';
    END IF;

    -- 3. Validate current status is Pending
    IF v_return.status != 'Pending' THEN
        RAISE EXCEPTION 'Excess fund return request has already been actioned.';
    END IF;

    -- 4. If Approved, validate balance and perform debit
    IF p_status = 'Approved' THEN
        -- Lock the ZO balance row
        SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_return.zo_user_id FOR UPDATE;
        IF NOT FOUND OR v_balance < v_return.requested_amount THEN
            RAISE EXCEPTION 'Insufficient Zonal Office balance for return.';
        END IF;

        -- Deduct from balance
        UPDATE public.zo_balances 
        SET available_balance = available_balance - v_return.requested_amount, updated_at = now()
        WHERE zo_user_id = v_return.zo_user_id;

        -- Insert ledger entry (negative debit amount)
        INSERT INTO public.zo_fund_ledger (
            zo_user_id,
            transaction_type,
            reference_type,
            reference_id,
            amount,
            created_by
        ) VALUES (
            v_return.zo_user_id,
            'RETURN',
            'RETURN',
            p_return_id,
            -v_return.requested_amount,
            p_actioned_by
        );
    END IF;

    -- 5. Update the return request status
    UPDATE public.excess_fund_returns
    SET 
        status = p_status,
        actioned_by = p_actioned_by,
        actioned_at = now(),
        action_remarks = p_action_remarks,
        updated_at = now()
    WHERE id = p_return_id
    RETURNING * INTO v_return;

    RETURN v_return;
END;
$$;


ALTER FUNCTION "public"."action_excess_fund_return"("p_return_id" "uuid", "p_status" character varying, "p_actioned_by" character varying, "p_action_remarks" "text") OWNER TO "postgres";


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
    "attachments" "jsonb" DEFAULT '[]'::"jsonb",
    "work_order_no" character varying
);


ALTER TABLE "public"."fund_requests" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_fund_request_transact"("p_fund_request_id" "uuid", "p_approved_amount" numeric, "p_transfer_from_account" character varying, "p_actioned_by" character varying, "p_remarks" "text") RETURNS "public"."fund_requests"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_fr public.fund_requests;
BEGIN
    -- Lock fund request row
    SELECT * INTO v_fr FROM public.fund_requests WHERE fund_request_id = p_fund_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fund request not found.';
    END IF;

    -- Validate status is Pending or Hold
    IF v_fr.request_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Fund request status must be Pending or Hold.';
    END IF;

    -- Initialize balance cache row with ON CONFLICT DO NOTHING if missing
    INSERT INTO public.zo_balances (zo_user_id, available_balance)
    VALUES (v_fr.zo_user_id, 0.00)
    ON CONFLICT (zo_user_id) DO NOTHING;

    -- Lock and increment ZO balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance + p_approved_amount, updated_at = now()
    WHERE zo_user_id = v_fr.zo_user_id;

    -- Insert ledger entry (positive credit amount)
    INSERT INTO public.zo_fund_ledger (
        zo_user_id,
        transaction_type,
        reference_type,
        reference_id,
        amount,
        work_order_no,
        created_by
    ) VALUES (
        v_fr.zo_user_id,
        'ALLOCATION',
        'FUND_REQUEST',
        p_fund_request_id,
        p_approved_amount,
        v_fr.work_order_no,
        p_actioned_by
    );

    -- Update Fund Request status
    UPDATE public.fund_requests
    SET
        request_status = 'Approved',
        approve_ho_amount = p_approved_amount,
        transfer_from_account = p_transfer_from_account::transfer_account_enum,
        approve_ho_user_id = p_actioned_by,
        approve_ho_date = now(),
        ho_remarks = p_remarks,
        updated_at = now()
    WHERE fund_request_id = p_fund_request_id
    RETURNING * INTO v_fr;

    RETURN v_fr;
END;
$$;


ALTER FUNCTION "public"."approve_fund_request_transact"("p_fund_request_id" "uuid", "p_approved_amount" numeric, "p_transfer_from_account" character varying, "p_actioned_by" character varying, "p_remarks" "text") OWNER TO "postgres";


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
    "zo_user_id" character varying,
    CONSTRAINT "chk_balance_amount" CHECK ((("requisition_status" <> 'Approved'::"public"."requisition_status_enum") OR (("approved_amount" IS NOT NULL) AND ("approved_amount" <= "requisition_amount") AND ("approved_balance_amount" IS NOT NULL) AND ("approved_balance_amount" = ("requisition_amount" - "approved_amount"))))),
    CONSTRAINT "chk_gst_bill_pdf" CHECK ((("gst_bill" <> 'Yes'::"public"."gst_bill_enum") OR ("gst_bill_pdf_url" IS NOT NULL))),
    CONSTRAINT "requisitions_requisition_amount_check" CHECK (("requisition_amount" > (0)::numeric))
);


ALTER TABLE "public"."requisitions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_requisition_transact"("p_requisition_id" "uuid", "p_approved_amount" numeric, "p_actioned_by" character varying, "p_remarks_approved_authority" "text") RETURNS "public"."requisitions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_req public.requisitions;
    v_balance NUMERIC(18,2);
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
BEGIN
    -- 1. Lock and fetch Requisition Row
    SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.requisition_status NOT IN ('Pending', 'Hold') THEN
        RAISE EXCEPTION 'Requisition status must be Pending or Hold.' USING ERRCODE = 'STA01';
    END IF;

    -- 2. Find estimate ID of the latest Final Approved cost estimate
    SELECT estimate_id INTO v_estimate_id
    FROM public.project_cost_estimates
    WHERE work_order_no = v_req.work_order_no
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
    END IF;

    -- 3. Calculate Main Head Cost Estimate Amount
    SELECT COALESCE(SUM(amount), 0.00) INTO v_main_head_estimate
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_estimate_id
      AND material_main_head = v_req.material_main_head;

    -- 4. Calculate cumulative approved amount (excluding current requisition)
    SELECT COALESCE(SUM(approved_amount), 0.00) INTO v_cumulative_approved
    FROM public.requisitions
    WHERE work_order_no = v_req.work_order_no
      AND material_main_head = v_req.material_main_head
      AND requisition_status = 'Approved'::public.requisition_status_enum
      AND requisition_id <> p_requisition_id;

    -- 5. Validate against Main Head Capacity
    v_remaining_capacity := v_main_head_estimate - v_cumulative_approved;
    IF p_approved_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Approved amount exceeds the remaining Main Head capacity (Capacity: %, Attempted: %).',
            v_remaining_capacity, p_approved_amount
            USING ERRCODE = 'BUD02';
    END IF;

    -- 6. Lock and check ZO Balance row
    SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_req.zo_user_id FOR UPDATE;
    IF NOT FOUND OR v_balance < p_approved_amount THEN
        RAISE EXCEPTION 'Insufficient available Zonal Office balance.' USING ERRCODE = 'BAL01';
    END IF;

    -- 7. Deduct ZO balance
    UPDATE public.zo_balances 
    SET available_balance = available_balance - p_approved_amount, updated_at = now()
    WHERE zo_user_id = v_req.zo_user_id;

    -- 8. Insert ledger entry (negative debit)
    INSERT INTO public.zo_fund_ledger (
        zo_user_id,
        transaction_type,
        reference_type,
        reference_id,
        amount,
        work_order_no,
        created_by
    ) VALUES (
        v_req.zo_user_id,
        'REQUISITION_APPROVAL',
        'REQUISITION',
        p_requisition_id,
        -p_approved_amount,
        v_req.work_order_no,
        p_actioned_by
    );

    -- 9. Update Requisition
    UPDATE public.requisitions
    SET
        requisition_status = 'Approved',
        approve_type = 'Approve',
        approved_amount = p_approved_amount,
        approved_balance_amount = requisition_amount - p_approved_amount,
        approved_user_id = p_actioned_by,
        payment_date = now(),
        remarks_approved_authority = p_remarks_approved_authority,
        updated_at = now()
    WHERE requisition_id = p_requisition_id
    RETURNING * INTO v_req;

    RETURN v_req;
END;
$$;


ALTER FUNCTION "public"."approve_requisition_transact"("p_requisition_id" "uuid", "p_approved_amount" numeric, "p_actioned_by" character varying, "p_remarks_approved_authority" "text") OWNER TO "postgres";


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
      'earnest_money_deposit', NEW.earnest_money_deposit,
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

    IF NEW.earnest_money_deposit IS DISTINCT FROM OLD.earnest_money_deposit THEN
      v_old_json := v_old_json || jsonb_build_object('earnest_money_deposit', OLD.earnest_money_deposit);
      v_new_json := v_new_json || jsonb_build_object('earnest_money_deposit', NEW.earnest_money_deposit);
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
      'work_order_no', NEW.work_order_no,
      'payment_type',  NEW.payment_type,
      'bill_date',     NEW.bill_date,
      'gross_bill',    NEW.gross_bill
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


CREATE OR REPLACE FUNCTION "public"."create_requisition_secure"("p_requester_user_id" character varying, "p_work_order_no" character varying, "p_estimate_no" character varying, "p_estimate_amount" numeric, "p_state" character varying, "p_district" character varying, "p_area_code" character varying, "p_department" character varying, "p_site_details" "text", "p_requisition_no" character varying, "p_material_main_head" character varying, "p_requisition_pdf_url" "text", "p_original_filename" character varying, "p_requisition_amount" numeric, "p_gst_bill" "public"."gst_bill_enum", "p_gst_bill_pdf_url" "text", "p_bank_details" "text", "p_expen_head_remarks" "text", "p_requisition_status" "public"."requisition_status_enum", "p_created_by" character varying) RETURNS "public"."requisitions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_project_status public.project_status;
    v_estimate_id UUID;
    v_main_head_estimate numeric(18,2) := 0.00;
    v_cumulative_approved numeric(18,2) := 0.00;
    v_remaining_capacity numeric(18,2) := 0.00;
    v_inserted public.requisitions;
BEGIN
    -- 1. Lock the corresponding project row for update to serialize concurrent requisition insertions
    SELECT status INTO v_project_status
    FROM public.projects_master
    WHERE work_order_no = p_work_order_no
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % not found.', p_work_order_no USING ERRCODE = 'P0002';
    END IF;

    -- 2. Verify project is not closed
    IF v_project_status = 'Closed'::public.project_status THEN
        RAISE EXCEPTION 'Cannot create requisitions for projects with "Closed" status. All linked reports are immutable.' USING ERRCODE = 'PR001';
    END IF;

    -- 3. Re-verify uniqueness of requisition_no
    IF EXISTS (
        SELECT 1 FROM public.requisitions WHERE requisition_no = p_requisition_no
    ) THEN
        RAISE EXCEPTION 'A requisition with number % already exists.', p_requisition_no USING ERRCODE = '23505';
    END IF;

    -- 4. Find the estimate ID of the latest Final Approved cost estimate
    SELECT estimate_id INTO v_estimate_id
    FROM public.project_cost_estimates
    WHERE work_order_no = p_work_order_no
      AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No Final Approved cost estimate found for Work Order %.', p_work_order_no USING ERRCODE = 'EST01';
    END IF;

    -- 5. Calculate Main Head Cost Estimate Amount
    SELECT COALESCE(SUM(amount), 0.00) INTO v_main_head_estimate
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_estimate_id
      AND material_main_head = p_material_main_head;

    -- 6. Sum Cumulative ZO-Approved Requisitions for this main head
    SELECT COALESCE(SUM(approved_amount), 0.00) INTO v_cumulative_approved
    FROM public.requisitions
    WHERE work_order_no = p_work_order_no
      AND material_main_head = p_material_main_head
      AND requisition_status = 'Approved'::public.requisition_status_enum;

    -- 7. Validate budget capacity
    v_remaining_capacity := v_main_head_estimate - v_cumulative_approved;
    IF p_requisition_amount > v_remaining_capacity THEN
        RAISE EXCEPTION 'Requisition amount exceeds the remaining Main Head capacity (Capacity: %, Requested: %).', 
            v_remaining_capacity, p_requisition_amount
            USING ERRCODE = 'BUD01';
    END IF;

    -- 8. Insert the requisition
    INSERT INTO public.requisitions (
        requester_user_id,
        work_order_no,
        estimate_no,
        estimate_amount,
        state,
        district,
        area_code,
        department,
        site_details,
        requisition_no,
        material_main_head,
        requisition_pdf_url,
        original_filename,
        requisition_amount,
        gst_bill,
        gst_bill_pdf_url,
        bank_details,
        expen_head_remarks,
        requisition_status,
        created_by
    ) VALUES (
        p_requester_user_id,
        p_work_order_no,
        p_estimate_no,
        p_estimate_amount,
        p_state,
        p_district,
        p_area_code,
        p_department,
        p_site_details,
        p_requisition_no,
        p_material_main_head,
        p_requisition_pdf_url,
        p_original_filename,
        p_requisition_amount,
        p_gst_bill,
        p_gst_bill_pdf_url,
        p_bank_details,
        p_expen_head_remarks,
        p_requisition_status,
        p_created_by
    ) RETURNING * INTO v_inserted;

    RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."create_requisition_secure"("p_requester_user_id" character varying, "p_work_order_no" character varying, "p_estimate_no" character varying, "p_estimate_amount" numeric, "p_state" character varying, "p_district" character varying, "p_area_code" character varying, "p_department" character varying, "p_site_details" "text", "p_requisition_no" character varying, "p_material_main_head" character varying, "p_requisition_pdf_url" "text", "p_original_filename" character varying, "p_requisition_amount" numeric, "p_gst_bill" "public"."gst_bill_enum", "p_gst_bill_pdf_url" "text", "p_bank_details" "text", "p_expen_head_remarks" "text", "p_requisition_status" "public"."requisition_status_enum", "p_created_by" character varying) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."fn_audit_zonal_modules"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_user_id VARCHAR;
    v_rec_id  VARCHAR;
BEGIN
    IF TG_TABLE_NAME = 'je_zo_mappings' THEN
        v_user_id := NEW.assigned_by;
        v_rec_id  := NEW.id::VARCHAR;
    ELSIF TG_TABLE_NAME = 'work_order_mappings' THEN
        v_user_id := NEW.assigned_by;
        v_rec_id  := NEW.id::VARCHAR;
    ELSIF TG_TABLE_NAME = 'excess_fund_returns' THEN
        v_user_id := NEW.requested_by;
        v_rec_id  := NEW.id::VARCHAR;
    ELSE
        v_user_id := 'SYSTEM';
        v_rec_id  := COALESCE(NEW.id::VARCHAR, NEW.zo_user_id);
    END IF;

    INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
        COALESCE(v_user_id, 'SYSTEM'),
        TG_OP,
        TG_TABLE_NAME,
        v_rec_id,
        CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_audit_zonal_modules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_init_zo_balance_on_user_creation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.role = 'zo' THEN
        INSERT INTO public.zo_balances (zo_user_id, available_balance)
        VALUES (NEW.mobile_number, 0.00)
        ON CONFLICT (zo_user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_init_zo_balance_on_user_creation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_validate_je_zo_mapping_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_je_role VARCHAR;
    v_zo_role VARCHAR;
BEGIN
    SELECT role INTO v_je_role FROM public.authorised_users WHERE mobile_number = NEW.je_user_id;
    SELECT role INTO v_zo_role FROM public.authorised_users WHERE mobile_number = NEW.zo_user_id;

    IF v_je_role != 'je' THEN
        RAISE EXCEPTION 'Target user (%) is not a Junior Engineer.', NEW.je_user_id;
    END IF;

    IF v_zo_role != 'zo' THEN
        RAISE EXCEPTION 'Target user (%) is not a Zonal Office user.', NEW.zo_user_id;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_validate_je_zo_mapping_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_validate_work_order_mapping_zonal_consistency"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_je_zo   VARCHAR;
    v_wo_zo   VARCHAR;
BEGIN
    -- 1. Get the ZO of the JE being assigned
    SELECT zo_user_id INTO v_je_zo 
      FROM public.je_zo_mappings 
     WHERE je_user_id = NEW.je_user_id AND is_active = true;

    IF v_je_zo IS NULL THEN
        RAISE EXCEPTION 'Junior Engineer % is not assigned to any active Zonal Office.', NEW.je_user_id;
    END IF;

    -- 2. Get the ZO of the Work Order
    SELECT zo_user_id INTO v_wo_zo
      FROM public.projects_master
     WHERE work_order_no = NEW.work_order_no;

    IF v_wo_zo IS NULL THEN
        RAISE EXCEPTION 'Work Order % has no assigned owning Zonal Office.', NEW.work_order_no;
    END IF;

    -- 3. Block if they differ
    IF v_wo_zo != v_je_zo THEN
        RAISE EXCEPTION 'Mismatched ZO assignment. Junior Engineer belongs to ZO %, but Work Order belongs to ZO %.',
            v_je_zo, v_wo_zo;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_validate_work_order_mapping_zonal_consistency"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."reconcile_zonal_balances"("p_zo_user_id" character varying DEFAULT NULL::character varying, "p_actioned_by" character varying DEFAULT 'SYSTEM'::character varying) RETURNS TABLE("out_zo_user_id" character varying, "old_balance" numeric, "new_balance" numeric, "difference" numeric, "adjusted" boolean)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    r RECORD;
    v_zo_exists BOOLEAN;
    v_old NUMERIC(18,2);
BEGIN
    -- 1. Validate p_zo_user_id belongs to a valid Zonal Office user if supplied
    IF p_zo_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.authorised_users 
            WHERE mobile_number = p_zo_user_id AND role = 'zo'
        ) INTO v_zo_exists;

        IF NOT v_zo_exists THEN
            RAISE EXCEPTION 'Target user (%) is not a Zonal Office user.', p_zo_user_id;
        END IF;
    END IF;

    -- 2. Use a single grouped aggregation query to calculate balances for target ZO(s)
    FOR r IN 
        SELECT 
            u.mobile_number AS zo_id,
            COALESCE(SUM(l.amount), 0.00) AS calculated_balance
        FROM public.authorised_users u
        LEFT JOIN public.zo_fund_ledger l ON u.mobile_number = l.zo_user_id
        WHERE u.role = 'zo' AND (p_zo_user_id IS NULL OR u.mobile_number = p_zo_user_id)
        GROUP BY u.mobile_number
    LOOP
        -- 3. Eliminate race conditions: initialize balance row with ON CONFLICT DO NOTHING
        INSERT INTO public.zo_balances (zo_user_id, available_balance)
        VALUES (r.zo_id, 0.00)
        ON CONFLICT (zo_user_id) DO NOTHING;

        -- 4. Lock the balance row using row-level locking
        SELECT available_balance INTO v_old 
        FROM public.zo_balances 
        WHERE public.zo_balances.zo_user_id = r.zo_id 
        FOR UPDATE;

        -- 5. Only update and record audit if a discrepancy exists (idempotency check)
        IF v_old != r.calculated_balance THEN
            UPDATE public.zo_balances 
            SET available_balance = r.calculated_balance, updated_at = now() 
            WHERE public.zo_balances.zo_user_id = r.zo_id;

            INSERT INTO public.audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
            VALUES (
                p_actioned_by,
                'UPDATE',
                'zo_balances',
                r.zo_id,
                jsonb_build_object('available_balance', v_old),
                jsonb_build_object('available_balance', r.calculated_balance)
            );

            out_zo_user_id := r.zo_id;
            old_balance := v_old;
            new_balance := r.calculated_balance;
            difference := r.calculated_balance - v_old;
            adjusted := true;
            RETURN NEXT;
        ELSE
            out_zo_user_id := r.zo_id;
            old_balance := v_old;
            new_balance := v_old;
            difference := 0.00;
            adjusted := false;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."reconcile_zonal_balances"("p_zo_user_id" character varying, "p_actioned_by" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_analytics_views"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Layer 1
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.project_health_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.approval_sla_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.estimate_accuracy_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.material_variance_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.resource_utilization_mv;

  -- Layer 2
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.zone_performance_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.budget_leakage_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.executive_kpi_mv;
END;
$$;


ALTER FUNCTION "public"."refresh_analytics_views"() OWNER TO "postgres";


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
  v_is_revision_stage   BOOLEAN;
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

  -- ENFORCE: stage HO supports both HO Revision Requested and Estimate Reopened status
  IF p_stage = 'HO' AND v_status <> 'HO Revision Requested'::estimate_status_enum AND v_status <> 'Estimate Reopened'::estimate_status_enum THEN
    RAISE EXCEPTION 'Expected HO Revision Requested or Estimate Reopened, found %', v_status;
  END IF;

  -- Express workflow transition intent explicitly:
  -- Reopened estimates preserve historical review decisions.
  -- Only Revision Requested workflows clear rejected items for re-audit.
  v_is_revision_stage := v_status IN (
    'ZO Revision Requested'::estimate_status_enum,
    'HO Revision Requested'::estimate_status_enum
  );

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

    -- ONLY perform item reset and collect modified IDs if this is a Revision Request transition
    IF v_is_revision_stage THEN
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
    ELSE
      -- For Reopened Estimates, explicitly initialize modified_item_ids to empty array
      v_modified_item_ids := '{}';
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
  IF v_status IN ('Draft', 'Submitted', 'Under ZO Review', 'ZO Revision Requested',
                  'Rejected by ZO', 'Rejected by HO') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;

  ELSIF v_status IN ('ZO Approved', 'Under HO Review', 'HO Revision Requested', 'Estimate Reopened') THEN
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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_approved_amount" numeric(18,2) DEFAULT NULL::numeric
);


ALTER TABLE "public"."project_cost_estimates" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."approval_sla_mv" AS
 SELECT "project_cost_estimates"."work_order_no",
    'Estimate'::character varying AS "module",
    ("project_cost_estimates"."estimate_id")::character varying AS "record_identifier",
    'ZO Review'::character varying AS "stage",
    "project_cost_estimates"."je_date" AS "submitted_at",
    "project_cost_estimates"."zo_approval_date" AS "actioned_at",
    (EXTRACT(epoch FROM ("project_cost_estimates"."zo_approval_date" - "project_cost_estimates"."je_date")) / 3600.0) AS "duration_hours",
    48.0 AS "sla_limit_hours",
    ((EXTRACT(epoch FROM ("project_cost_estimates"."zo_approval_date" - "project_cost_estimates"."je_date")) / 3600.0) > 48.0) AS "is_violated",
    "project_cost_estimates"."zo_approved_by" AS "actioned_by"
   FROM "public"."project_cost_estimates"
  WHERE (("project_cost_estimates"."je_date" IS NOT NULL) AND ("project_cost_estimates"."zo_approval_date" IS NOT NULL))
UNION ALL
 SELECT "project_cost_estimates"."work_order_no",
    'Estimate'::character varying AS "module",
    ("project_cost_estimates"."estimate_id")::character varying AS "record_identifier",
    'HO Approval'::character varying AS "stage",
    "project_cost_estimates"."zo_approval_date" AS "submitted_at",
    "project_cost_estimates"."ho_approval_date" AS "actioned_at",
    (EXTRACT(epoch FROM ("project_cost_estimates"."ho_approval_date" - "project_cost_estimates"."zo_approval_date")) / 3600.0) AS "duration_hours",
    72.0 AS "sla_limit_hours",
    ((EXTRACT(epoch FROM ("project_cost_estimates"."ho_approval_date" - "project_cost_estimates"."zo_approval_date")) / 3600.0) > 72.0) AS "is_violated",
    "project_cost_estimates"."ho_approved_by" AS "actioned_by"
   FROM "public"."project_cost_estimates"
  WHERE (("project_cost_estimates"."zo_approval_date" IS NOT NULL) AND ("project_cost_estimates"."ho_approval_date" IS NOT NULL))
UNION ALL
 SELECT "requisitions"."work_order_no",
    'Requisition'::character varying AS "module",
    ("requisitions"."requisition_id")::character varying AS "record_identifier",
    'ZO Requisition Approval'::character varying AS "stage",
    "requisitions"."created_at" AS "submitted_at",
    "requisitions"."payment_date" AS "actioned_at",
    (EXTRACT(epoch FROM ("requisitions"."payment_date" - "requisitions"."created_at")) / 3600.0) AS "duration_hours",
    48.0 AS "sla_limit_hours",
    ((EXTRACT(epoch FROM ("requisitions"."payment_date" - "requisitions"."created_at")) / 3600.0) > 48.0) AS "is_violated",
    "requisitions"."approved_user_id" AS "actioned_by"
   FROM "public"."requisitions"
  WHERE ("requisitions"."payment_date" IS NOT NULL)
UNION ALL
 SELECT "fund_requests"."work_order_no",
    'Fund Request'::character varying AS "module",
    ("fund_requests"."fund_request_id")::character varying AS "record_identifier",
    'HO Fund Request Approval'::character varying AS "stage",
    "fund_requests"."zo_date" AS "submitted_at",
    "fund_requests"."approve_ho_date" AS "actioned_at",
    (EXTRACT(epoch FROM ("fund_requests"."approve_ho_date" - "fund_requests"."zo_date")) / 3600.0) AS "duration_hours",
    72.0 AS "sla_limit_hours",
    ((EXTRACT(epoch FROM ("fund_requests"."approve_ho_date" - "fund_requests"."zo_date")) / 3600.0) > 72.0) AS "is_violated",
    "fund_requests"."approve_ho_user_id" AS "actioned_by"
   FROM "public"."fund_requests"
  WHERE ("fund_requests"."approve_ho_date" IS NOT NULL)
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."approval_sla_mv" OWNER TO "postgres";


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
    "role" character varying(50) DEFAULT 'je'::character varying,
    "permissions" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true,
    "telegram_chat_id" character varying(50) DEFAULT NULL::character varying,
    "daily_streak" integer DEFAULT 0,
    "last_report_date" "date",
    CONSTRAINT "authorised_users_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['admin'::character varying, 'je'::character varying, 'zo'::character varying, 'ho'::character varying])::"text"[])))
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
    "approval_status" character varying DEFAULT 'Approved'::character varying NOT NULL,
    "zo_user_id" character varying,
    CONSTRAINT "chk_approval_status" CHECK ((("approval_status")::"text" = ANY ((ARRAY['Approved'::character varying, 'Pending'::character varying, 'Rejected'::character varying])::"text"[]))),
    CONSTRAINT "chk_authority_remarks_consistency" CHECK (((("approved_user_id" IS NULL) AND ("approval_date" IS NULL) AND ("remarks_approved_authority" IS NULL)) OR (("approved_user_id" IS NOT NULL) AND ("approval_date" IS NOT NULL) AND ("remarks_approved_authority" IS NOT NULL)))),
    CONSTRAINT "chk_physical_work_progress" CHECK ((("physical_work_progress" >= (0)::numeric) AND ("physical_work_progress" <= (100)::numeric)))
);


ALTER TABLE "public"."daily_progress_reports" OWNER TO "postgres";


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
    "work_order_value" numeric(18,2) NOT NULL,
    "earnest_money_deposit" numeric(18,2) DEFAULT 0.00 NOT NULL,
    "site_latitude" numeric(10,7),
    "site_longitude" numeric(10,7),
    "project_start_date" "date",
    "project_end_date" "date",
    "zo_user_id" character varying
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
    "gross_bill" numeric(18,2) NOT NULL,
    "earnest_money_deposit" numeric(18,2) DEFAULT 0 NOT NULL,
    "security_deposit_amount" numeric(18,2) DEFAULT 0 NOT NULL,
    "bill_copy_url" "text" NOT NULL,
    "original_bill_filename" character varying,
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "agency_payment" numeric(18,2) DEFAULT 0,
    "special_security_amount" numeric(18,2) DEFAULT 0,
    "other_retention" numeric(18,2) DEFAULT 0,
    "it_tds" numeric(18,2) DEFAULT 0,
    "sgst" numeric(18,2) DEFAULT 0,
    "cgst" numeric(18,2) DEFAULT 0,
    "sd" numeric(18,2) DEFAULT 0,
    CONSTRAINT "chk_emd_non_negative" CHECK (("earnest_money_deposit" >= (0)::numeric)),
    CONSTRAINT "chk_gross_bill_non_negative" CHECK (("gross_bill" >= (0)::numeric)),
    CONSTRAINT "chk_payment_type_format" CHECK ((("payment_type")::"text" ~ '^(RA Bill [1-9][0-9]*|Final Bill)$'::"text")),
    CONSTRAINT "chk_sd_non_negative" CHECK (("security_deposit_amount" >= (0)::numeric))
);


ALTER TABLE "public"."ra_final_bills" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."project_health_mv" AS
 WITH "latest_progress" AS (
         SELECT DISTINCT ON ("daily_progress_reports"."work_order_no") "daily_progress_reports"."work_order_no",
            "daily_progress_reports"."physical_work_progress",
            "daily_progress_reports"."login_date"
           FROM "public"."daily_progress_reports"
          ORDER BY "daily_progress_reports"."work_order_no", "daily_progress_reports"."physical_work_progress" DESC, "daily_progress_reports"."login_date" DESC, "daily_progress_reports"."created_at" DESC
        ), "approved_estimates" AS (
         SELECT DISTINCT ON ("project_cost_estimates"."work_order_no") "project_cost_estimates"."work_order_no",
            "project_cost_estimates"."estimate_id",
            "project_cost_estimates"."estimate_no",
            "project_cost_estimates"."estimate_amount"
           FROM "public"."project_cost_estimates"
          WHERE ("project_cost_estimates"."estimate_status" = 'Final Approved'::"public"."estimate_status_enum")
          ORDER BY "project_cost_estimates"."work_order_no", "project_cost_estimates"."estimate_revision" DESC
        ), "requisitions_summary" AS (
         SELECT "requisitions"."work_order_no",
            COALESCE("sum"("requisitions"."approved_amount"), (0)::numeric) AS "approved_amount"
           FROM "public"."requisitions"
          WHERE ("requisitions"."requisition_status" = 'Approved'::"public"."requisition_status_enum")
          GROUP BY "requisitions"."work_order_no"
        ), "bills_summary" AS (
         SELECT "ra_final_bills"."work_order_no",
            COALESCE("sum"("ra_final_bills"."gross_bill"), (0)::numeric) AS "total_billed"
           FROM "public"."ra_final_bills"
          GROUP BY "ra_final_bills"."work_order_no"
        ), "pending_approvals" AS (
         SELECT "sub"."work_order_no",
            "count"(*) AS "pending_count"
           FROM ( SELECT "requisitions"."work_order_no"
                   FROM "public"."requisitions"
                  WHERE ("requisitions"."requisition_status" = 'Pending'::"public"."requisition_status_enum")
                UNION ALL
                 SELECT "project_cost_estimates"."work_order_no"
                   FROM "public"."project_cost_estimates"
                  WHERE ("project_cost_estimates"."estimate_status" = ANY (ARRAY['Submitted'::"public"."estimate_status_enum", 'Under ZO Review'::"public"."estimate_status_enum", 'Under HO Review'::"public"."estimate_status_enum"]))) "sub"
          GROUP BY "sub"."work_order_no"
        ), "material_variance_calc" AS (
         SELECT "ae"."work_order_no",
            COALESCE("avg"(
                CASE
                    WHEN ("items"."amount" = (0)::numeric) THEN (0)::numeric
                    ELSE (("abs"((COALESCE("reqs"."approved_amount", (0)::numeric) - "items"."amount")) / "items"."amount") * (100)::numeric)
                END), (0)::numeric) AS "avg_variance_pct"
           FROM (("approved_estimates" "ae"
             JOIN "public"."project_cost_estimate_items" "items" ON (("ae"."estimate_id" = "items"."estimate_id")))
             LEFT JOIN ( SELECT "requisitions"."work_order_no",
                    "requisitions"."material_main_head",
                    "sum"("requisitions"."approved_amount") AS "approved_amount"
                   FROM "public"."requisitions"
                  WHERE ("requisitions"."requisition_status" = 'Approved'::"public"."requisition_status_enum")
                  GROUP BY "requisitions"."work_order_no", "requisitions"."material_main_head") "reqs" ON (((("ae"."work_order_no")::"text" = ("reqs"."work_order_no")::"text") AND (("items"."material_main_head")::"text" = ("reqs"."material_main_head")::"text"))))
          GROUP BY "ae"."work_order_no"
        ), "scores_calculated" AS (
         SELECT "pm"."work_order_no",
            "pm"."site_details",
            "pm"."zone",
            "pm"."district",
            "pm"."state",
            "pm"."department",
            "pm"."status",
            "pm"."work_order_value",
            "pm"."project_start_date",
            "pm"."project_end_date",
            "pm"."zo_user_id",
            "pm"."site_latitude",
            "pm"."site_longitude",
            COALESCE("ae"."estimate_no", 'N/A'::character varying) AS "estimate_no",
            COALESCE("ae"."estimate_amount", (0)::numeric) AS "approved_estimate_amount",
            COALESCE("rs"."approved_amount", (0)::numeric) AS "approved_requisitions_amount",
            COALESCE("bs"."total_billed", (0)::numeric) AS "total_billed_amount",
            COALESCE("lp"."physical_work_progress", (0)::numeric) AS "physical_progress",
            "lp"."login_date" AS "last_submission_date",
                CASE
                    WHEN ("lp"."login_date" IS NULL) THEN 999
                    ELSE (("now"())::"date" - ("lp"."login_date")::"date")
                END AS "days_since_last_report",
                CASE
                    WHEN ("lp"."login_date" IS NULL) THEN 999
                    ELSE (("now"())::"date" - ("lp"."login_date")::"date")
                END AS "days_since_last_progress_report",
            COALESCE("pa"."pending_count", (0)::bigint) AS "pending_approvals_count",
            COALESCE("mv"."avg_variance_pct", (0)::numeric) AS "material_variance_pct",
                CASE
                    WHEN ("pm"."work_order_value" = (0)::numeric) THEN (40)::numeric
                    ELSE GREATEST((0)::numeric, LEAST((40)::numeric,
                    CASE
                        WHEN ((COALESCE("rs"."approved_amount", (0)::numeric) / "pm"."work_order_value") <= 0.8) THEN (40)::numeric
                        WHEN ((COALESCE("rs"."approved_amount", (0)::numeric) / "pm"."work_order_value") <= 1.0) THEN ((40)::numeric - ((((COALESCE("rs"."approved_amount", (0)::numeric) / "pm"."work_order_value") - 0.8) / 0.2) * (20)::numeric))
                        ELSE GREATEST((0)::numeric, ((20)::numeric - ((((COALESCE("rs"."approved_amount", (0)::numeric) / "pm"."work_order_value") - 1.0) / 0.2) * (20)::numeric)))
                    END))
                END AS "budget_score",
                CASE
                    WHEN (("pm"."project_start_date" IS NULL) OR ("pm"."project_end_date" IS NULL)) THEN (20)::numeric
                    WHEN ("pm"."project_end_date" = "pm"."project_start_date") THEN (20)::numeric
                    ELSE GREATEST((0)::numeric, LEAST((20)::numeric, ((20)::numeric - ((GREATEST((0)::numeric, ((GREATEST((0)::numeric, LEAST((1)::numeric, (((("now"())::"date" - "pm"."project_start_date"))::numeric / (NULLIF(("pm"."project_end_date" - "pm"."project_start_date"), 0))::numeric))) * (100)::numeric) - COALESCE("lp"."physical_work_progress", (0)::numeric))) / 100.0) * 20.0))))
                END AS "progress_score",
            GREATEST((0)::bigint, (15 - (COALESCE("pa"."pending_count", (0)::bigint) * 3))) AS "approval_score",
                CASE
                    WHEN ("lp"."login_date" IS NULL) THEN 0
                    WHEN ((("now"())::"date" - ("lp"."login_date")::"date") <= 1) THEN 15
                    WHEN ((("now"())::"date" - ("lp"."login_date")::"date") <= 3) THEN 10
                    WHEN ((("now"())::"date" - ("lp"."login_date")::"date") <= 7) THEN 5
                    ELSE 0
                END AS "reporting_score",
                CASE
                    WHEN ("lp"."login_date" IS NULL) THEN 0
                    WHEN ((("now"())::"date" - ("lp"."login_date")::"date") <= 1) THEN 100
                    WHEN ((("now"())::"date" - ("lp"."login_date")::"date") <= 3) THEN 66
                    WHEN ((("now"())::"date" - ("lp"."login_date")::"date") <= 7) THEN 33
                    ELSE 0
                END AS "reporting_health_score",
                CASE
                    WHEN (COALESCE("mv"."avg_variance_pct", (0)::numeric) <= (5)::numeric) THEN 10
                    WHEN (COALESCE("mv"."avg_variance_pct", (0)::numeric) <= (15)::numeric) THEN 5
                    ELSE 0
                END AS "material_score",
                CASE
                    WHEN (("pm"."project_start_date" IS NULL) OR ("pm"."project_end_date" IS NULL)) THEN (0)::numeric
                    WHEN ("pm"."project_end_date" = "pm"."project_start_date") THEN (100)::numeric
                    ELSE GREATEST(0.0, LEAST(100.0, ((((("now"())::"date" - "pm"."project_start_date"))::numeric / (NULLIF(("pm"."project_end_date" - "pm"."project_start_date"), 0))::numeric) * 100.0)))
                END AS "timeline_progress_pct",
                CASE
                    WHEN (("pm"."project_start_date" IS NULL) OR ("pm"."project_end_date" IS NULL)) THEN 0
                    ELSE (COALESCE((((("now"())::"date" - "pm"."project_start_date"))::numeric - ((COALESCE("lp"."physical_work_progress", (0)::numeric) / 100.0) * (NULLIF(("pm"."project_end_date" - "pm"."project_start_date"), 0))::numeric)), (0)::numeric))::integer
                END AS "schedule_slack_days"
           FROM (((((("public"."projects_master" "pm"
             LEFT JOIN "approved_estimates" "ae" ON ((("pm"."work_order_no")::"text" = ("ae"."work_order_no")::"text")))
             LEFT JOIN "latest_progress" "lp" ON ((("pm"."work_order_no")::"text" = ("lp"."work_order_no")::"text")))
             LEFT JOIN "requisitions_summary" "rs" ON ((("pm"."work_order_no")::"text" = ("rs"."work_order_no")::"text")))
             LEFT JOIN "bills_summary" "bs" ON ((("pm"."work_order_no")::"text" = ("bs"."work_order_no")::"text")))
             LEFT JOIN "pending_approvals" "pa" ON ((("pm"."work_order_no")::"text" = ("pa"."work_order_no")::"text")))
             LEFT JOIN "material_variance_calc" "mv" ON ((("pm"."work_order_no")::"text" = ("mv"."work_order_no")::"text")))
        )
 SELECT "work_order_no",
    "site_details",
    "zone",
    "district",
    "state",
    "department",
    "status",
    "work_order_value",
    "project_start_date",
    "project_end_date",
    "zo_user_id",
    "site_latitude",
    "site_longitude",
    "estimate_no",
    "approved_estimate_amount",
    "approved_requisitions_amount",
    "total_billed_amount",
    "physical_progress",
    "last_submission_date",
    "days_since_last_report",
    "days_since_last_progress_report",
    "pending_approvals_count",
    "material_variance_pct",
    "budget_score",
    "progress_score",
    "approval_score",
    "reporting_score",
    "reporting_health_score",
    "material_score",
    "timeline_progress_pct",
    "schedule_slack_days",
    (((("budget_score" + "progress_score") + ("approval_score")::numeric) + ("reporting_score")::numeric) + ("material_score")::numeric) AS "health_score",
        CASE
            WHEN ((((("budget_score" + "progress_score") + ("approval_score")::numeric) + ("reporting_score")::numeric) + ("material_score")::numeric) >= (80)::numeric) THEN 'Healthy'::"text"
            WHEN ((((("budget_score" + "progress_score") + ("approval_score")::numeric) + ("reporting_score")::numeric) + ("material_score")::numeric) >= (50)::numeric) THEN 'Warning'::"text"
            ELSE 'Critical'::"text"
        END AS "health_status",
    "now"() AS "last_refreshed_at"
   FROM "scores_calculated" "s"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."project_health_mv" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."budget_leakage_mv" AS
 WITH "estimate_revisions" AS (
         SELECT "project_cost_estimates"."work_order_no",
            "count"(*) AS "revisions_count"
           FROM "public"."project_cost_estimates"
          GROUP BY "project_cost_estimates"."work_order_no"
        ), "fund_request_counts" AS (
         SELECT "fund_requests"."work_order_no",
            "count"(*) AS "requests_count"
           FROM "public"."fund_requests"
          WHERE (("fund_requests"."work_order_no" IS NOT NULL) AND ("fund_requests"."request_status" <> 'Cancelled'::"public"."fund_request_status_enum"))
          GROUP BY "fund_requests"."work_order_no"
        )
 SELECT "ph"."work_order_no",
    "ph"."site_details",
    "ph"."zone",
    "ph"."work_order_value",
    "ph"."approved_requisitions_amount",
        CASE
            WHEN ("ph"."work_order_value" = (0)::numeric) THEN (0)::numeric
            ELSE (("ph"."approved_requisitions_amount" / "ph"."work_order_value") * (100)::numeric)
        END AS "budget_variance_pct",
    COALESCE("frc"."requests_count", (0)::bigint) AS "fund_requests_count",
    COALESCE("er"."revisions_count", (0)::bigint) AS "estimate_revisions_count",
    "ph"."days_since_last_progress_report",
    ("ph"."approved_requisitions_amount" > "ph"."work_order_value") AS "has_budget_overrun",
    (COALESCE("frc"."requests_count", (0)::bigint) > 3) AS "has_repeated_fund_requests",
    (COALESCE("er"."revisions_count", (0)::bigint) > 3) AS "has_excessive_revisions",
    (("ph"."days_since_last_progress_report" > 7) AND ("ph"."physical_progress" < (100)::numeric)) AS "has_stalled_progress",
    (((
        CASE
            WHEN ("ph"."approved_requisitions_amount" > "ph"."work_order_value") THEN 3
            ELSE 0
        END +
        CASE
            WHEN (COALESCE("frc"."requests_count", (0)::bigint) > 3) THEN 2
            ELSE 0
        END) +
        CASE
            WHEN (COALESCE("er"."revisions_count", (0)::bigint) > 3) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (("ph"."days_since_last_progress_report" > 7) AND ("ph"."physical_progress" < (100)::numeric)) THEN 2
            ELSE 0
        END) AS "anomaly_score",
        CASE
            WHEN ((((
            CASE
                WHEN ("ph"."approved_requisitions_amount" > "ph"."work_order_value") THEN 3
                ELSE 0
            END +
            CASE
                WHEN (COALESCE("frc"."requests_count", (0)::bigint) > 3) THEN 2
                ELSE 0
            END) +
            CASE
                WHEN (COALESCE("er"."revisions_count", (0)::bigint) > 3) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN (("ph"."days_since_last_progress_report" > 7) AND ("ph"."physical_progress" < (100)::numeric)) THEN 2
                ELSE 0
            END) >= 4) THEN 'Critical'::"text"
            WHEN ((((
            CASE
                WHEN ("ph"."approved_requisitions_amount" > "ph"."work_order_value") THEN 3
                ELSE 0
            END +
            CASE
                WHEN (COALESCE("frc"."requests_count", (0)::bigint) > 3) THEN 2
                ELSE 0
            END) +
            CASE
                WHEN (COALESCE("er"."revisions_count", (0)::bigint) > 3) THEN 1
                ELSE 0
            END) +
            CASE
                WHEN (("ph"."days_since_last_progress_report" > 7) AND ("ph"."physical_progress" < (100)::numeric)) THEN 2
                ELSE 0
            END) >= 1) THEN 'Warning'::"text"
            ELSE 'No Anomalies'::"text"
        END AS "leakage_status",
    "now"() AS "last_refreshed_at"
   FROM (("public"."project_health_mv" "ph"
     LEFT JOIN "estimate_revisions" "er" ON ((("ph"."work_order_no")::"text" = ("er"."work_order_no")::"text")))
     LEFT JOIN "fund_request_counts" "frc" ON ((("ph"."work_order_no")::"text" = ("frc"."work_order_no")::"text")))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."budget_leakage_mv" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."estimate_accuracy_mv" AS
 WITH "original_estimates" AS (
         SELECT DISTINCT ON ("project_cost_estimates"."work_order_no") "project_cost_estimates"."work_order_no",
            "project_cost_estimates"."estimate_id",
            "project_cost_estimates"."estimate_amount",
            "project_cost_estimates"."estimate_no",
            "project_cost_estimates"."created_at"
           FROM "public"."project_cost_estimates"
          WHERE ("project_cost_estimates"."estimate_revision" = 0)
          ORDER BY "project_cost_estimates"."work_order_no", "project_cost_estimates"."created_at"
        ), "final_estimates" AS (
         SELECT DISTINCT ON ("project_cost_estimates"."work_order_no") "project_cost_estimates"."work_order_no",
            "project_cost_estimates"."estimate_id",
            "project_cost_estimates"."estimate_amount",
            "project_cost_estimates"."estimate_revision"
           FROM "public"."project_cost_estimates"
          WHERE ("project_cost_estimates"."estimate_status" = 'Final Approved'::"public"."estimate_status_enum")
          ORDER BY "project_cost_estimates"."work_order_no", "project_cost_estimates"."estimate_revision" DESC
        )
 SELECT "oe"."work_order_no",
    "oe"."estimate_no",
    "oe"."estimate_amount" AS "original_estimate_amount",
    COALESCE("fe"."estimate_amount", "oe"."estimate_amount") AS "final_approved_estimate_amount",
    (COALESCE("fe"."estimate_amount", "oe"."estimate_amount") - "oe"."estimate_amount") AS "variance_amount",
        CASE
            WHEN ("oe"."estimate_amount" = (0)::numeric) THEN (0)::numeric
            ELSE (((COALESCE("fe"."estimate_amount", "oe"."estimate_amount") - "oe"."estimate_amount") / "oe"."estimate_amount") * (100)::numeric)
        END AS "variance_pct",
    COALESCE("fe"."estimate_revision", 0) AS "number_of_revisions",
        CASE
            WHEN ("abs"(
            CASE
                WHEN ("oe"."estimate_amount" = (0)::numeric) THEN (0)::numeric
                ELSE (((COALESCE("fe"."estimate_amount", "fe"."estimate_amount") - "oe"."estimate_amount") / "oe"."estimate_amount") * (100)::numeric)
            END) <= (5)::numeric) THEN 'Highly Accurate'::"text"
            WHEN ("abs"(
            CASE
                WHEN ("oe"."estimate_amount" = (0)::numeric) THEN (0)::numeric
                ELSE (((COALESCE("fe"."estimate_amount", "fe"."estimate_amount") - "oe"."estimate_amount") / "oe"."estimate_amount") * (100)::numeric)
            END) <= (15)::numeric) THEN 'Moderate Variance'::"text"
            ELSE 'High Variance'::"text"
        END AS "accuracy_status",
    "now"() AS "last_refreshed_at"
   FROM ("original_estimates" "oe"
     LEFT JOIN "final_estimates" "fe" ON ((("oe"."work_order_no")::"text" = ("fe"."work_order_no")::"text")))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."estimate_accuracy_mv" OWNER TO "postgres";


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


CREATE MATERIALIZED VIEW "public"."executive_kpi_mv" AS
 SELECT 1 AS "id",
    "count"(DISTINCT "work_order_no") AS "total_projects",
    "sum"(
        CASE
            WHEN ("status" = 'Running'::"public"."project_status") THEN 1
            ELSE 0
        END) AS "active_projects",
    "sum"(
        CASE
            WHEN ("health_status" = 'Warning'::"text") THEN 1
            ELSE 0
        END) AS "projects_at_warning",
    "sum"(
        CASE
            WHEN ("health_status" = 'Critical'::"text") THEN 1
            ELSE 0
        END) AS "projects_at_risk",
    COALESCE("avg"("health_score"), 0.0) AS "average_project_health",
    "sum"("work_order_value") AS "total_budget",
    "sum"("approved_requisitions_amount") AS "total_spent",
        CASE
            WHEN ("sum"("work_order_value") = (0)::numeric) THEN (0)::numeric
            ELSE (("sum"("approved_requisitions_amount") / "sum"("work_order_value")) * (100)::numeric)
        END AS "budget_utilization_pct",
    "now"() AS "last_refreshed_at"
   FROM "public"."project_health_mv"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."executive_kpi_mv" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."je_zo_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "je_user_id" character varying NOT NULL,
    "zo_user_id" character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" character varying NOT NULL,
    "deactivated_at" timestamp with time zone,
    "deactivated_by" character varying
);


ALTER TABLE "public"."je_zo_mappings" OWNER TO "postgres";


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


CREATE MATERIALIZED VIEW "public"."material_variance_mv" AS
 WITH "approved_estimates" AS (
         SELECT DISTINCT ON ("project_cost_estimates"."work_order_no") "project_cost_estimates"."work_order_no",
            "project_cost_estimates"."estimate_id"
           FROM "public"."project_cost_estimates"
          WHERE ("project_cost_estimates"."estimate_status" = 'Final Approved'::"public"."estimate_status_enum")
          ORDER BY "project_cost_estimates"."work_order_no", "project_cost_estimates"."estimate_revision" DESC
        ), "estimated_materials" AS (
         SELECT "ae"."work_order_no",
            "items"."material_main_head",
            "sum"("items"."qty") AS "estimated_qty",
            "sum"("items"."amount") AS "estimated_amount"
           FROM ("approved_estimates" "ae"
             JOIN "public"."project_cost_estimate_items" "items" ON (("ae"."estimate_id" = "items"."estimate_id")))
          GROUP BY "ae"."work_order_no", "items"."material_main_head"
        ), "approved_requisitions" AS (
         SELECT "requisitions"."work_order_no",
            "requisitions"."material_main_head",
            "sum"("requisitions"."approved_amount") AS "approved_amount"
           FROM "public"."requisitions"
          WHERE ("requisitions"."requisition_status" = 'Approved'::"public"."requisition_status_enum")
          GROUP BY "requisitions"."work_order_no", "requisitions"."material_main_head"
        )
 SELECT "em"."work_order_no",
    "em"."material_main_head",
    "em"."estimated_qty",
    "em"."estimated_amount",
    COALESCE("ar"."approved_amount", (0)::numeric) AS "approved_amount",
    (COALESCE("ar"."approved_amount", (0)::numeric) - "em"."estimated_amount") AS "variance_amount",
        CASE
            WHEN ("em"."estimated_amount" = (0)::numeric) THEN NULL::numeric
            ELSE (((COALESCE("ar"."approved_amount", (0)::numeric) - "em"."estimated_amount") / "em"."estimated_amount") * (100)::numeric)
        END AS "variance_pct",
        CASE
            WHEN ("em"."estimated_qty" = (0)::numeric) THEN true
            ELSE false
        END AS "quantity_data_unavailable",
    "now"() AS "last_refreshed_at"
   FROM ("estimated_materials" "em"
     LEFT JOIN "approved_requisitions" "ar" ON (((("em"."work_order_no")::"text" = ("ar"."work_order_no")::"text") AND (("em"."material_main_head")::"text" = ("ar"."material_main_head")::"text"))))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."material_variance_mv" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."work_order_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_order_no" character varying NOT NULL,
    "je_user_id" character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "reason" character varying NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" character varying NOT NULL,
    "deactivated_at" timestamp with time zone,
    "deactivated_by" character varying,
    CONSTRAINT "work_order_mappings_reason_check" CHECK ((("reason")::"text" = ANY ((ARRAY['Assigned'::character varying, 'Transferred'::character varying, 'Removed'::character varying, 'Project Closed'::character varying])::"text"[])))
);


ALTER TABLE "public"."work_order_mappings" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."resource_utilization_mv" AS
 WITH "je_projects" AS (
         SELECT "work_order_mappings"."je_user_id",
            "count"(DISTINCT "work_order_mappings"."work_order_no") AS "assigned_projects"
           FROM "public"."work_order_mappings"
          WHERE ("work_order_mappings"."is_active" = true)
          GROUP BY "work_order_mappings"."je_user_id"
        ), "je_reports" AS (
         SELECT "daily_progress_reports"."created_by",
            "count"(*) AS "submitted_reports"
           FROM "public"."daily_progress_reports"
          GROUP BY "daily_progress_reports"."created_by"
        ), "je_last_report" AS (
         SELECT "daily_progress_reports"."created_by",
            "max"("daily_progress_reports"."login_date") AS "last_submission_date"
           FROM "public"."daily_progress_reports"
          GROUP BY "daily_progress_reports"."created_by"
        ), "je_zo_link" AS (
         SELECT DISTINCT ON ("je_zo_mappings"."je_user_id") "je_zo_mappings"."je_user_id",
            "je_zo_mappings"."zo_user_id"
           FROM "public"."je_zo_mappings"
          WHERE ("je_zo_mappings"."is_active" = true)
          ORDER BY "je_zo_mappings"."je_user_id", "je_zo_mappings"."assigned_at" DESC
        )
 SELECT "au"."id" AS "user_uuid",
    "au"."mobile_number" AS "je_user_id",
    "au"."display_name" AS "je_name",
    "au"."telegram_chat_id",
    COALESCE("jzl"."zo_user_id", 'Unmapped'::character varying) AS "zo_user_id",
    COALESCE("jp"."assigned_projects", (0)::bigint) AS "assigned_projects_count",
    COALESCE("jr"."submitted_reports", (0)::bigint) AS "daily_reports_submitted_count",
    "jlr"."last_submission_date",
    COALESCE("au"."daily_streak", 0) AS "streak_days",
    "now"() AS "last_refreshed_at"
   FROM (((("public"."authorised_users" "au"
     LEFT JOIN "je_projects" "jp" ON ((("au"."mobile_number")::"text" = ("jp"."je_user_id")::"text")))
     LEFT JOIN "je_reports" "jr" ON ((("au"."mobile_number")::"text" = ("jr"."created_by")::"text")))
     LEFT JOIN "je_last_report" "jlr" ON ((("au"."mobile_number")::"text" = ("jlr"."created_by")::"text")))
     LEFT JOIN "je_zo_link" "jzl" ON ((("au"."mobile_number")::"text" = ("jzl"."je_user_id")::"text")))
  WHERE ((("au"."role")::"text" = 'je'::"text") AND ("au"."is_active" = true))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."resource_utilization_mv" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."zo_balances" (
    "zo_user_id" character varying NOT NULL,
    "available_balance" numeric(18,2) DEFAULT 0.00 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_zo_balance_positive" CHECK (("available_balance" >= 0.00))
);


ALTER TABLE "public"."zo_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zo_fund_ledger" (
    "ledger_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "zo_user_id" character varying NOT NULL,
    "transaction_type" character varying NOT NULL,
    "reference_type" character varying NOT NULL,
    "reference_id" "uuid" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "work_order_no" character varying,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" character varying NOT NULL,
    CONSTRAINT "zo_fund_ledger_reference_type_check" CHECK ((("reference_type")::"text" = ANY ((ARRAY['FUND_REQUEST'::character varying, 'REQUISITION'::character varying, 'RETURN'::character varying])::"text"[]))),
    CONSTRAINT "zo_fund_ledger_transaction_type_check" CHECK ((("transaction_type")::"text" = ANY ((ARRAY['ALLOCATION'::character varying, 'REQUISITION_APPROVAL'::character varying, 'RETURN'::character varying, 'TRANSFER'::character varying])::"text"[])))
);


ALTER TABLE "public"."zo_fund_ledger" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."zone_performance_mv" AS
 SELECT "pm"."zone",
    "count"(DISTINCT "pm"."work_order_no") AS "total_projects",
    "sum"(
        CASE
            WHEN ("pm"."status" = 'Running'::"public"."project_status") THEN 1
            ELSE 0
        END) AS "running_projects",
    "sum"(
        CASE
            WHEN (("ph"."physical_progress" < (100)::numeric) AND ("pm"."project_end_date" < CURRENT_DATE)) THEN 1
            ELSE 0
        END) AS "delayed_projects",
    "sum"(
        CASE
            WHEN ("ph"."health_status" = 'Critical'::"text") THEN 1
            ELSE 0
        END) AS "projects_at_risk",
    COALESCE("avg"("ph"."health_score"), 0.0) AS "average_health_score",
    "sum"("pm"."work_order_value") AS "total_budget",
    "sum"("ph"."approved_requisitions_amount") AS "total_spent",
        CASE
            WHEN ("sum"("pm"."work_order_value") = (0)::numeric) THEN (0)::numeric
            ELSE (("sum"("ph"."approved_requisitions_amount") / "sum"("pm"."work_order_value")) * (100)::numeric)
        END AS "budget_utilization_pct",
    COALESCE("avg"("ph"."schedule_slack_days"), 0.0) AS "average_timeline_slack_days",
    "now"() AS "last_refreshed_at"
   FROM ("public"."projects_master" "pm"
     LEFT JOIN "public"."project_health_mv" "ph" ON ((("pm"."work_order_no")::"text" = ("ph"."work_order_no")::"text")))
  GROUP BY "pm"."zone"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."zone_performance_mv" OWNER TO "postgres";


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



ALTER TABLE ONLY "public"."excess_fund_returns"
    ADD CONSTRAINT "excess_fund_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fund_reports"
    ADD CONSTRAINT "fund_reports_pkey" PRIMARY KEY ("fund_report_id");



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_pkey" PRIMARY KEY ("fund_request_id");



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_zo_fr_no_key" UNIQUE ("zo_fr_no");



ALTER TABLE ONLY "public"."je_zo_mappings"
    ADD CONSTRAINT "je_zo_mappings_pkey" PRIMARY KEY ("id");



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
    ADD CONSTRAINT "uq_daily_progress_work_order_date" UNIQUE ("work_order_no", "site_visit_date", "created_by");



ALTER TABLE ONLY "public"."work_order_mappings"
    ADD CONSTRAINT "work_order_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zo_balances"
    ADD CONSTRAINT "zo_balances_pkey" PRIMARY KEY ("zo_user_id");



ALTER TABLE ONLY "public"."zo_fund_ledger"
    ADD CONSTRAINT "zo_fund_ledger_pkey" PRIMARY KEY ("ledger_id");



CREATE UNIQUE INDEX "idx_approval_sla_mv_id" ON "public"."approval_sla_mv" USING "btree" ("record_identifier", "stage");



CREATE INDEX "idx_audit_log_module_name" ON "public"."audit_log" USING "btree" ("module_name");



CREATE INDEX "idx_audit_log_record_identifier" ON "public"."audit_log" USING "btree" ("record_identifier");



CREATE INDEX "idx_bills_wo_created" ON "public"."ra_final_bills" USING "btree" ("work_order_no", "created_at");



CREATE UNIQUE INDEX "idx_budget_leakage_mv_wo" ON "public"."budget_leakage_mv" USING "btree" ("work_order_no");



CREATE INDEX "idx_daily_progress_created_by" ON "public"."daily_progress_reports" USING "btree" ("created_by");



CREATE INDEX "idx_daily_progress_site_visit_date" ON "public"."daily_progress_reports" USING "btree" ("site_visit_date" DESC);



CREATE INDEX "idx_daily_progress_work_order" ON "public"."daily_progress_reports" USING "btree" ("work_order_no");



CREATE INDEX "idx_dpr_wo_visit" ON "public"."daily_progress_reports" USING "btree" ("work_order_no", "site_visit_date");



CREATE INDEX "idx_erl_created" ON "public"."estimate_revision_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_erl_estimate" ON "public"."estimate_revision_log" USING "btree" ("estimate_id");



CREATE UNIQUE INDEX "idx_estimate_accuracy_mv_wo" ON "public"."estimate_accuracy_mv" USING "btree" ("work_order_no");



CREATE UNIQUE INDEX "idx_executive_kpi_mv_id" ON "public"."executive_kpi_mv" USING "btree" ("id");



CREATE INDEX "idx_fund_requests_status" ON "public"."fund_requests" USING "btree" ("request_status") WHERE ("request_status" = 'Pending'::"public"."fund_request_status_enum");



CREATE UNIQUE INDEX "idx_je_zo_mappings_active_unique" ON "public"."je_zo_mappings" USING "btree" ("je_user_id") WHERE ("is_active" = true);



CREATE INDEX "idx_material_active" ON "public"."material_master" USING "btree" ("is_active");



CREATE INDEX "idx_material_main_head" ON "public"."material_master" USING "btree" ("Material_Main_Head");



CREATE INDEX "idx_material_sub_head" ON "public"."material_master" USING "btree" ("Material_Sub_Head");



CREATE UNIQUE INDEX "idx_material_variance_mv_wo_head" ON "public"."material_variance_mv" USING "btree" ("work_order_no", "material_main_head");



CREATE INDEX "idx_pce_status" ON "public"."project_cost_estimates" USING "btree" ("estimate_status");



CREATE INDEX "idx_pce_work_order" ON "public"."project_cost_estimates" USING "btree" ("work_order_no");



CREATE INDEX "idx_pcei_estimate" ON "public"."project_cost_estimate_items" USING "btree" ("estimate_id");



CREATE UNIQUE INDEX "idx_project_health_mv_wo" ON "public"."project_health_mv" USING "btree" ("work_order_no");



CREATE INDEX "idx_projects_zo_user" ON "public"."projects_master" USING "btree" ("zo_user_id");



CREATE INDEX "idx_ra_final_bills_bill_date" ON "public"."ra_final_bills" USING "btree" ("bill_date" DESC);



CREATE INDEX "idx_ra_final_bills_created_by" ON "public"."ra_final_bills" USING "btree" ("created_by");



CREATE INDEX "idx_ra_final_bills_work_order" ON "public"."ra_final_bills" USING "btree" ("work_order_no");



CREATE INDEX "idx_requisitions_payment_date" ON "public"."requisitions" USING "btree" ("payment_date");



CREATE INDEX "idx_requisitions_requester" ON "public"."requisitions" USING "btree" ("requester_user_id");



CREATE INDEX "idx_requisitions_status" ON "public"."requisitions" USING "btree" ("requisition_status") WHERE ("requisition_status" = 'Pending'::"public"."requisition_status_enum");



CREATE INDEX "idx_requisitions_work_order" ON "public"."requisitions" USING "btree" ("work_order_no");



CREATE UNIQUE INDEX "idx_resource_utilization_mv_je" ON "public"."resource_utilization_mv" USING "btree" ("je_user_id");



CREATE INDEX "idx_sessions_user_login" ON "public"."sessions" USING "btree" ("user_id", "login_at" DESC);



CREATE UNIQUE INDEX "idx_work_order_mappings_active_unique" ON "public"."work_order_mappings" USING "btree" ("work_order_no", "je_user_id") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "idx_zo_fund_ledger_ref_unique" ON "public"."zo_fund_ledger" USING "btree" ("reference_type", "reference_id");



CREATE INDEX "idx_zo_fund_ledger_zo" ON "public"."zo_fund_ledger" USING "btree" ("zo_user_id");



CREATE UNIQUE INDEX "idx_zone_performance_mv_zone" ON "public"."zone_performance_mv" USING "btree" ("zone");



CREATE UNIQUE INDEX "purchase_data_name_key" ON "public"."purchase_data" USING "btree" ("name");



CREATE UNIQUE INDEX "purchase_data_name_unique" ON "public"."purchase_data" USING "btree" ("lower"(("name")::"text"));



CREATE UNIQUE INDEX "uniq_active_revision" ON "public"."estimate_revision_log" USING "btree" ("estimate_id") WHERE ("resubmitted_at" IS NULL);



CREATE OR REPLACE TRIGGER "trg_audit_daily_progress_insert" AFTER INSERT ON "public"."daily_progress_reports" FOR EACH ROW EXECUTE FUNCTION "public"."audit_daily_progress_insert"();



CREATE OR REPLACE TRIGGER "trg_audit_estimate_status" AFTER UPDATE ON "public"."project_cost_estimates" FOR EACH ROW EXECUTE FUNCTION "public"."audit_estimate_status_change"();



CREATE OR REPLACE TRIGGER "trg_audit_excess_fund_returns" AFTER INSERT OR UPDATE ON "public"."excess_fund_returns" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_zonal_modules"();



CREATE OR REPLACE TRIGGER "trg_audit_fund_reports" AFTER INSERT OR UPDATE ON "public"."fund_reports" FOR EACH ROW EXECUTE FUNCTION "public"."audit_fund_reports_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_fund_request_status" AFTER UPDATE ON "public"."fund_requests" FOR EACH ROW EXECUTE FUNCTION "public"."audit_fund_request_status_change"();



CREATE OR REPLACE TRIGGER "trg_audit_je_zo_mappings" AFTER INSERT OR UPDATE ON "public"."je_zo_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_zonal_modules"();



CREATE OR REPLACE TRIGGER "trg_audit_log_append_only" BEFORE DELETE OR UPDATE ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_audit_log_append_only"();



CREATE OR REPLACE TRIGGER "trg_audit_material_master" AFTER INSERT OR UPDATE ON "public"."material_master" FOR EACH ROW EXECUTE FUNCTION "public"."audit_material_master_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_projects_master" AFTER INSERT OR UPDATE ON "public"."projects_master" FOR EACH ROW EXECUTE FUNCTION "public"."audit_projects_master_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_ra_final_bill_insert" AFTER INSERT ON "public"."ra_final_bills" FOR EACH ROW EXECUTE FUNCTION "public"."audit_ra_final_bill_insert"();



CREATE OR REPLACE TRIGGER "trg_audit_requisition_status" AFTER UPDATE ON "public"."requisitions" FOR EACH ROW EXECUTE FUNCTION "public"."audit_requisition_status_change"();



CREATE OR REPLACE TRIGGER "trg_audit_work_order_mappings" AFTER INSERT OR UPDATE ON "public"."work_order_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_zonal_modules"();



CREATE OR REPLACE TRIGGER "trg_daily_progress_updated_at" BEFORE UPDATE ON "public"."daily_progress_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_daily_progress_updated_at"();



CREATE OR REPLACE TRIGGER "trg_estimate_item_updated_at" BEFORE UPDATE ON "public"."project_cost_estimate_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_estimate_item_updated_at"();



CREATE OR REPLACE TRIGGER "trg_estimate_updated_at" BEFORE UPDATE ON "public"."project_cost_estimates" FOR EACH ROW EXECUTE FUNCTION "public"."set_estimate_updated_at"();



CREATE OR REPLACE TRIGGER "trg_fund_reports_edited_at" BEFORE UPDATE ON "public"."fund_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_fund_reports_edited_at"();



CREATE OR REPLACE TRIGGER "trg_fund_request_updated_at" BEFORE UPDATE ON "public"."fund_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_fund_request_updated_at"();



CREATE OR REPLACE TRIGGER "trg_init_zo_balance_on_user_creation" AFTER INSERT OR UPDATE OF "role" ON "public"."authorised_users" FOR EACH ROW EXECUTE FUNCTION "public"."fn_init_zo_balance_on_user_creation"();



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



CREATE OR REPLACE TRIGGER "trg_validate_je_zo_mapping_roles" BEFORE INSERT OR UPDATE ON "public"."je_zo_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_validate_je_zo_mapping_roles"();



CREATE OR REPLACE TRIGGER "trg_validate_work_order_mapping_zonal_consistency" BEFORE INSERT OR UPDATE ON "public"."work_order_mappings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_validate_work_order_mapping_zonal_consistency"();



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "daily_progress_reports_approved_user_id_fkey" FOREIGN KEY ("approved_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "daily_progress_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "daily_progress_reports_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_progress_reports"
    ADD CONSTRAINT "daily_progress_reports_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimate_revision_log"
    ADD CONSTRAINT "estimate_revision_log_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "public"."project_cost_estimates"("estimate_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimate_revision_log"
    ADD CONSTRAINT "estimate_revision_log_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimate_revision_log"
    ADD CONSTRAINT "estimate_revision_log_resubmitted_by_fkey" FOREIGN KEY ("resubmitted_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."excess_fund_returns"
    ADD CONSTRAINT "excess_fund_returns_actioned_by_fkey" FOREIGN KEY ("actioned_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."excess_fund_returns"
    ADD CONSTRAINT "excess_fund_returns_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."excess_fund_returns"
    ADD CONSTRAINT "excess_fund_returns_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."excess_fund_returns"
    ADD CONSTRAINT "excess_fund_returns_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_reports"
    ADD CONSTRAINT "fund_reports_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no");



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_approve_ho_user_id_fkey" FOREIGN KEY ("approve_ho_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."fund_requests"
    ADD CONSTRAINT "fund_requests_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."je_zo_mappings"
    ADD CONSTRAINT "je_zo_mappings_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."je_zo_mappings"
    ADD CONSTRAINT "je_zo_mappings_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."je_zo_mappings"
    ADD CONSTRAINT "je_zo_mappings_je_user_id_fkey" FOREIGN KEY ("je_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."je_zo_mappings"
    ADD CONSTRAINT "je_zo_mappings_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



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



ALTER TABLE ONLY "public"."projects_master"
    ADD CONSTRAINT "projects_master_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



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



ALTER TABLE ONLY "public"."requisitions"
    ADD CONSTRAINT "requisitions_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."authorised_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_order_mappings"
    ADD CONSTRAINT "work_order_mappings_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."work_order_mappings"
    ADD CONSTRAINT "work_order_mappings_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."work_order_mappings"
    ADD CONSTRAINT "work_order_mappings_je_user_id_fkey" FOREIGN KEY ("je_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."work_order_mappings"
    ADD CONSTRAINT "work_order_mappings_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."zo_balances"
    ADD CONSTRAINT "zo_balances_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."zo_fund_ledger"
    ADD CONSTRAINT "zo_fund_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."zo_fund_ledger"
    ADD CONSTRAINT "zo_fund_ledger_work_order_no_fkey" FOREIGN KEY ("work_order_no") REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."zo_fund_ledger"
    ADD CONSTRAINT "zo_fund_ledger_zo_user_id_fkey" FOREIGN KEY ("zo_user_id") REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT;



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."authorised_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_progress_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."estimate_revision_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."excess_fund_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fund_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fund_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."je_zo_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."otp_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_cost_estimate_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_cost_estimates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ra_final_bills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."requisitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_order_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zo_balances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zo_fund_ledger" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON TABLE "public"."excess_fund_returns" TO "anon";
GRANT ALL ON TABLE "public"."excess_fund_returns" TO "authenticated";
GRANT ALL ON TABLE "public"."excess_fund_returns" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_excess_fund_return"("p_return_id" "uuid", "p_client_updated_at" timestamp with time zone, "p_actioned_by" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."accept_excess_fund_return"("p_return_id" "uuid", "p_client_updated_at" timestamp with time zone, "p_actioned_by" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_excess_fund_return"("p_return_id" "uuid", "p_client_updated_at" timestamp with time zone, "p_actioned_by" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."action_excess_fund_return"("p_return_id" "uuid", "p_status" character varying, "p_actioned_by" character varying, "p_action_remarks" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."action_excess_fund_return"("p_return_id" "uuid", "p_status" character varying, "p_actioned_by" character varying, "p_action_remarks" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."action_excess_fund_return"("p_return_id" "uuid", "p_status" character varying, "p_actioned_by" character varying, "p_action_remarks" "text") TO "service_role";



GRANT ALL ON TABLE "public"."fund_requests" TO "anon";
GRANT ALL ON TABLE "public"."fund_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."fund_requests" TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_fund_request_transact"("p_fund_request_id" "uuid", "p_approved_amount" numeric, "p_transfer_from_account" character varying, "p_actioned_by" character varying, "p_remarks" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_fund_request_transact"("p_fund_request_id" "uuid", "p_approved_amount" numeric, "p_transfer_from_account" character varying, "p_actioned_by" character varying, "p_remarks" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_fund_request_transact"("p_fund_request_id" "uuid", "p_approved_amount" numeric, "p_transfer_from_account" character varying, "p_actioned_by" character varying, "p_remarks" "text") TO "service_role";



GRANT ALL ON TABLE "public"."requisitions" TO "anon";
GRANT ALL ON TABLE "public"."requisitions" TO "authenticated";
GRANT ALL ON TABLE "public"."requisitions" TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_requisition_transact"("p_requisition_id" "uuid", "p_approved_amount" numeric, "p_actioned_by" character varying, "p_remarks_approved_authority" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_requisition_transact"("p_requisition_id" "uuid", "p_approved_amount" numeric, "p_actioned_by" character varying, "p_remarks_approved_authority" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_requisition_transact"("p_requisition_id" "uuid", "p_approved_amount" numeric, "p_actioned_by" character varying, "p_remarks_approved_authority" "text") TO "service_role";



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



GRANT ALL ON FUNCTION "public"."create_requisition_secure"("p_requester_user_id" character varying, "p_work_order_no" character varying, "p_estimate_no" character varying, "p_estimate_amount" numeric, "p_state" character varying, "p_district" character varying, "p_area_code" character varying, "p_department" character varying, "p_site_details" "text", "p_requisition_no" character varying, "p_material_main_head" character varying, "p_requisition_pdf_url" "text", "p_original_filename" character varying, "p_requisition_amount" numeric, "p_gst_bill" "public"."gst_bill_enum", "p_gst_bill_pdf_url" "text", "p_bank_details" "text", "p_expen_head_remarks" "text", "p_requisition_status" "public"."requisition_status_enum", "p_created_by" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."create_requisition_secure"("p_requester_user_id" character varying, "p_work_order_no" character varying, "p_estimate_no" character varying, "p_estimate_amount" numeric, "p_state" character varying, "p_district" character varying, "p_area_code" character varying, "p_department" character varying, "p_site_details" "text", "p_requisition_no" character varying, "p_material_main_head" character varying, "p_requisition_pdf_url" "text", "p_original_filename" character varying, "p_requisition_amount" numeric, "p_gst_bill" "public"."gst_bill_enum", "p_gst_bill_pdf_url" "text", "p_bank_details" "text", "p_expen_head_remarks" "text", "p_requisition_status" "public"."requisition_status_enum", "p_created_by" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_requisition_secure"("p_requester_user_id" character varying, "p_work_order_no" character varying, "p_estimate_no" character varying, "p_estimate_amount" numeric, "p_state" character varying, "p_district" character varying, "p_area_code" character varying, "p_department" character varying, "p_site_details" "text", "p_requisition_no" character varying, "p_material_main_head" character varying, "p_requisition_pdf_url" "text", "p_original_filename" character varying, "p_requisition_amount" numeric, "p_gst_bill" "public"."gst_bill_enum", "p_gst_bill_pdf_url" "text", "p_bank_details" "text", "p_expen_head_remarks" "text", "p_requisition_status" "public"."requisition_status_enum", "p_created_by" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_audit_log_append_only"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_audit_log_append_only"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_audit_log_append_only"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_projects_master_immutability"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_projects_master_immutability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_projects_master_immutability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_audit_zonal_modules"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_audit_zonal_modules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_audit_zonal_modules"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_init_zo_balance_on_user_creation"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_init_zo_balance_on_user_creation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_init_zo_balance_on_user_creation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_validate_je_zo_mapping_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_validate_je_zo_mapping_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_validate_je_zo_mapping_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_validate_work_order_mapping_zonal_consistency"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_validate_work_order_mapping_zonal_consistency"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_validate_work_order_mapping_zonal_consistency"() TO "service_role";



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



GRANT ALL ON FUNCTION "public"."reconcile_zonal_balances"("p_zo_user_id" character varying, "p_actioned_by" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_zonal_balances"("p_zo_user_id" character varying, "p_actioned_by" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_zonal_balances"("p_zo_user_id" character varying, "p_actioned_by" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_analytics_views"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_analytics_views"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_analytics_views"() TO "service_role";



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


















GRANT ALL ON TABLE "public"."project_cost_estimates" TO "anon";
GRANT ALL ON TABLE "public"."project_cost_estimates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_cost_estimates" TO "service_role";



GRANT ALL ON TABLE "public"."approval_sla_mv" TO "anon";
GRANT ALL ON TABLE "public"."approval_sla_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."approval_sla_mv" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."authorised_users" TO "anon";
GRANT ALL ON TABLE "public"."authorised_users" TO "authenticated";
GRANT ALL ON TABLE "public"."authorised_users" TO "service_role";



GRANT ALL ON TABLE "public"."daily_progress_reports" TO "anon";
GRANT ALL ON TABLE "public"."daily_progress_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_progress_reports" TO "service_role";



GRANT ALL ON TABLE "public"."project_cost_estimate_items" TO "anon";
GRANT ALL ON TABLE "public"."project_cost_estimate_items" TO "authenticated";
GRANT ALL ON TABLE "public"."project_cost_estimate_items" TO "service_role";



GRANT ALL ON TABLE "public"."projects_master" TO "anon";
GRANT ALL ON TABLE "public"."projects_master" TO "authenticated";
GRANT ALL ON TABLE "public"."projects_master" TO "service_role";



GRANT ALL ON TABLE "public"."ra_final_bills" TO "anon";
GRANT ALL ON TABLE "public"."ra_final_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."ra_final_bills" TO "service_role";



GRANT ALL ON TABLE "public"."project_health_mv" TO "anon";
GRANT ALL ON TABLE "public"."project_health_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."project_health_mv" TO "service_role";



GRANT ALL ON TABLE "public"."budget_leakage_mv" TO "anon";
GRANT ALL ON TABLE "public"."budget_leakage_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_leakage_mv" TO "service_role";



GRANT ALL ON TABLE "public"."estimate_accuracy_mv" TO "anon";
GRANT ALL ON TABLE "public"."estimate_accuracy_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."estimate_accuracy_mv" TO "service_role";



GRANT ALL ON TABLE "public"."estimate_revision_log" TO "anon";
GRANT ALL ON TABLE "public"."estimate_revision_log" TO "authenticated";
GRANT ALL ON TABLE "public"."estimate_revision_log" TO "service_role";



GRANT ALL ON TABLE "public"."executive_kpi_mv" TO "anon";
GRANT ALL ON TABLE "public"."executive_kpi_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."executive_kpi_mv" TO "service_role";



GRANT ALL ON TABLE "public"."fund_reports" TO "anon";
GRANT ALL ON TABLE "public"."fund_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."fund_reports" TO "service_role";



GRANT ALL ON TABLE "public"."je_zo_mappings" TO "anon";
GRANT ALL ON TABLE "public"."je_zo_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."je_zo_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."material_master" TO "anon";
GRANT ALL ON TABLE "public"."material_master" TO "authenticated";
GRANT ALL ON TABLE "public"."material_master" TO "service_role";



GRANT ALL ON TABLE "public"."material_variance_mv" TO "anon";
GRANT ALL ON TABLE "public"."material_variance_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."material_variance_mv" TO "service_role";



GRANT ALL ON TABLE "public"."otp_requests" TO "anon";
GRANT ALL ON TABLE "public"."otp_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."otp_requests" TO "service_role";



GRANT ALL ON TABLE "public"."work_order_mappings" TO "anon";
GRANT ALL ON TABLE "public"."work_order_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."work_order_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."resource_utilization_mv" TO "anon";
GRANT ALL ON TABLE "public"."resource_utilization_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."resource_utilization_mv" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."user_login_stats" TO "anon";
GRANT ALL ON TABLE "public"."user_login_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."user_login_stats" TO "service_role";



GRANT ALL ON TABLE "public"."zo_balances" TO "anon";
GRANT ALL ON TABLE "public"."zo_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."zo_balances" TO "service_role";



GRANT ALL ON TABLE "public"."zo_fund_ledger" TO "anon";
GRANT ALL ON TABLE "public"."zo_fund_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."zo_fund_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."zone_performance_mv" TO "anon";
GRANT ALL ON TABLE "public"."zone_performance_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."zone_performance_mv" TO "service_role";









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



































