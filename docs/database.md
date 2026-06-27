# Part 3: Database Schema & Engine Configuration
## Supabase PostgreSQL Technical Reference

This document provides database definitions, schema designs, constraints, indexes, triggers, and database-level audit triggers.

---

## 1. Database Schema DDL & Relationships

The database runs on Supabase PostgreSQL. Below is the complete relational structure of the database.

```
       +--------------------+
       |  authorised_users  |<---+
       +----------+---------+    |
                  |              |
                  | 1:N          | 1:N
                  v              |
       +----------+---------+    |
       |      sessions      |    |
       +--------------------+    |
                                 |
       +--------------------+    |
       |    projects_master |<---+
       +----------+---------+    |
                  |              |
                  | 1:N          | 1:N
                  v              |
       +----------+---------+    |
       |    fund_reports    |----+
       +--------------------+
```

---

## 2. Table Specifications & Business Rules

### 2.1 Table: `authorised_users`
Acts as the gatekeeper whitelist. All system users must be registered here.
* **Indexes**: 
  - `authorised_users_pkey` on `id` (B-tree PRIMARY KEY).
  - `authorised_users_mobile_number_key` on `mobile_number` (B-tree UNIQUE).
* **Constraints**:
  - `authorised_users_role_check`: Role must be one of `('staff', 'admin', 'je', 'zo', 'ho')`.
* **Business Rules**:
  - `is_active` defaults to `true`. Toggling to `false` blocks session refreshes and deletes all linked active sessions.

### 2.2 Table: `otp_requests`
Stores bcrypt hashes of login verification codes.
* **Indexes**:
  - `otp_requests_pkey` on `id` (B-tree PRIMARY KEY).
  - `idx_otp_requests_mobile_is_used` on `(mobile_number, is_used)`.
* **Business Rules**:
  - `attempts` default to `0`. Incremented dynamically. Locks OTP if `attempts >= 3`.
  - Expiry set to 5 minutes from `created_at`.

### 2.3 Table: `sessions`
Ledger of user logins. Contains a session ID `jwt_jti` mapped directly to JWT token payloads.
* **Indexes**:
  - `sessions_pkey` on `id` (B-tree PRIMARY KEY).
  - `sessions_jwt_jti_key` on `jwt_jti` (B-tree UNIQUE).
* **Business Rules**:
  - `is_active` set to `false` on logout.
  - Duration is computed on logout in seconds: `duration_seconds = logout_at - login_at`.

### 2.4 Table: `projects_master`
Stores all contracted projects.
* **Constraints**:
  - `chk_work_order_value_non_negative`: `work_order_value >= 0`.
  - `chk_allowed_status`: Status must be `Running`, `Closed`, or `Complete Under Maintenance`.
* **Triggers**:
  - `trg_projects_master_immutability`: Blocks editing the `work_order_no` after creation.

### 2.5 Table: `fund_reports`
Tracks disbursement logs associated with projects.
* **Triggers**:
  - `trg_fund_reports_edited_at`: Updates `edited_at` automatically on edit.
  - `trg_audit_fund_reports`: Inserts CRUD logs into `audit_log`.

---

## 3. Database Triggers

### 3.1 Work Order Number Immutability Trigger
```sql
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
FOR EACH ROW EXECUTE FUNCTION enforce_projects_master_immutability();
```

### 3.2 Audit Log Triggers
Standardizes audit collection across database tables. Below is the trigger function used by the `fund_reports` table:
```sql
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

    IF v_changed THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (v_user_id, v_action, 'Fund Report', NEW.fund_report_id::VARCHAR, v_old_json, v_new_json);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```
Similar triggers log audit trail data for `projects_master`, `requisitions`, `daily_progress_reports`, and `fund_requests` into the `audit_log` table.
