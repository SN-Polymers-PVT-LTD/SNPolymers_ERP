# IDBP Phase 2 — Project Management Module Specification

This document defines the requirements, database structure, API specification, validation logic, role permission matrix, mutability constraints, audit logging system, and frontend design guidelines for the **Project Management Module** of the S.N. Polymers ERP platform.

---

## 1. Database Schema

The module uses the `projects_master` table to store project details, including the newly introduced monetary `work_order_value` field.

### Table: `projects_master`

Stores master data records for projects. Physical deletion is strictly prohibited.

```sql
CREATE TABLE projects_master (
  work_order_no    varchar(100) PRIMARY KEY, -- Unique Identifier
  estimate_no      varchar(100) NOT NULL,
  work_order_value numeric(18,2) NOT NULL,    -- Monetary value, must be non-negative
  site_details     text NOT NULL,
  state            varchar(100) NOT NULL,
  district         varchar(100) NOT NULL,
  zone             varchar(100) NOT NULL,
  department       varchar(100) NOT NULL,
  status           varchar(50) DEFAULT 'Running' NOT NULL, -- 'Running' | 'Closed' | 'Complete Under Maintenance'
  created_by       varchar(15) REFERENCES authorised_users(mobile_number),
  created_at       timestamptz DEFAULT now() NOT NULL,
  edited_by        varchar(15) REFERENCES authorised_users(mobile_number),
  edited_at        timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT chk_work_order_value_non_negative CHECK (work_order_value >= 0),
  CONSTRAINT chk_allowed_status CHECK (status IN ('Running', 'Closed', 'Complete Under Maintenance'))
);
```

### Table: `fund_reports`

Tracks transaction/report records mapped to projects. Mapped as many-to-one with `projects_master` through `work_order_no`.

```sql
CREATE TABLE fund_reports (
  fund_report_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_no    varchar(100) REFERENCES projects_master(work_order_no) NOT NULL,
  amount           numeric(18,2) NOT NULL,
  remarks          text,
  is_deleted       boolean DEFAULT false NOT NULL,
  created_by       varchar(15) REFERENCES authorised_users(mobile_number) NOT NULL,
  created_at       timestamptz DEFAULT now() NOT NULL,
  edited_by        varchar(15) REFERENCES authorised_users(mobile_number),
  edited_at        timestamptz DEFAULT now(),
  deleted_by       varchar(15) REFERENCES authorised_users(mobile_number),
  deleted_at       timestamptz
);
```

---

## 2. API Specification

All routes are prefixed by `/api/v1/auth/projects` (or reports).

### 2.1 Project Master API

#### GET `/api/v1/auth/projects`
* **Access:** Authenticated Staff or Admin
* **Description:** Retrieves all projects.

#### GET `/api/v1/auth/projects/:work_order_no`
* **Access:** Authenticated Staff or Admin
* **Description:** Retrieves a project by work order number.

#### POST `/api/v1/auth/projects`
* **Access:** Admin only
* **Body:**
  ```json
  {
    "work_order_no": "WB_APD_101",
    "estimate_no": "EST/SNP/2026/08",
    "work_order_value": 2500000.00,
    "site_details": "Alipurduar PWD Site",
    "state": "West Bengal",
    "district": "Alipurduar",
    "zone": "North Bengal",
    "department": "PWD",
    "status": "Running"
  }
  ```
* **Validation:** All fields are mandatory. `work_order_value` must be a valid, non-negative number.

#### PUT `/api/v1/auth/projects/:work_order_no`
* **Access:** Admin only
* **Body:** Same as POST (excluding `work_order_no`)
* **Validation:** Fields must be validated with the same constraints.

#### PATCH `/api/v1/auth/projects/:work_order_no/status`
* **Access:** Admin only
* **Body:**
  ```json
  {
    "status": "Closed"
  }
  ```
* **Validation:** Status must be one of `Running`, `Closed`, `Complete Under Maintenance`.

---

## 3. Role Permission Matrix & Mutability Rules

### 3.1 Permissions Matrix

| Module / Action | Admin | Staff (Project Manager) |
| :--- | :--- | :--- |
| **Create Project** | Yes | No (403 Forbidden) |
| **Edit Project Master** | Yes | No (403 Forbidden) |
| **Change Project Status** | Yes | No (403 Forbidden) |
| **Create Fund Report** | Yes | Yes (Only if project is Running / Maintenance) |
| **Edit/Delete Fund Report** | Yes | Yes (Only if project is Running / Maintenance) |

### 3.2 Mutability Gates

Any attempts to write (create, update, delete, or restore) a fund report must check the status of the parent project in `projects_master`.

* **Running**: Allowed.
* **Complete Under Maintenance**: Allowed.
* **Closed**: Blocked. Attempting to write a report for a Closed project returns `403 Forbidden` with the message: `"Action forbidden: Cannot submit, modify, or delete reports for projects that are Closed."`

---

## 4. Audit Logging

Database level triggers automatically audit operations on `projects_master` and `fund_reports` into the `audit_log` table.

### Triggers
1. **`audit_projects_master_changes`**:
   - Captures `CREATE`, `EDIT`, and `STATUS_CHANGE` actions.
   - Captures the exact field modified including `work_order_value`.
2. **`audit_fund_reports_changes`**:
   - Captures `CREATE`, `EDIT`, `SOFT_DELETE`, and `RESTORE` actions.

---

## 5. Frontend UI & Currency Formatting

* **Currency Display:** All monetary representations of `Work Order Value` or `Amount` on the UI must be formatted in Indian Rupees using:
  ```javascript
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(value)
  ```
  Example: `₹25,00,000.00`
* **Input Fields:** Form inputs for `Work Order Value` must use `<input type="number">` with numeric validation boundaries (minimum of `0` and step `0.01`).
