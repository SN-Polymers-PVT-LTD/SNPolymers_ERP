# Phase 4 — Requisition Management Module
# Milestone-Driven Execution Plan

> **Status:** Implementation Plan approved and frozen. This document converts it into a sequential,
> dependency-ordered execution plan for AI-assisted development.
>
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Assumed existing:** Phase 1 (auth, fund reports) + Phase 2 (estimates) + Phase 3 (fund requests)
> **Process flow source:** Requisition Management Flow diagram + Excel data spec sheet

---

## Milestone Overview

| # | Milestone | Primary Layer | Depends On |
|---|---|---|---|
| M1 | Database Foundation | DB | Phase 3 migrations complete (migration 19 applied) |
| M2 | Requisitions API — Core CRUD | Backend | M1 |
| M3 | Requisitions API — Workflow (Act/Cancel) | Backend | M2 |
| M4 | File Upload API (PDF Storage) | Backend | M2 |
| M5 | Code Quality & Security Hardening (Phase 3 Carry-Over + Phase 4 New) | Backend | Any (independent) |
| M6a | Frontend — Requisition Entry Form | Frontend | M2, M3, M4 |
| M6b | Frontend — Approver Dashboard | Frontend | M6a |
| M6c | Frontend — Dashboard Integration & Navigation | Frontend | M6b |
| M7 | Test Suite — Phase 4 | All | M1–M6c |
| M8 | UAT & Release Gate | All | M7 |

---

A milestone is complete only if:

✓ Code implemented  
✓ Acceptance criteria pass  
✓ All milestone test cases pass  
✓ No failing lint checks  
✓ No open P1 (Critical/High) security defects  

---

## M1 — Database Foundation

### Objective
Establish all schema objects required by Phase 4: enums, the `requisitions` table, indexes, and triggers. The migration number is `20` (following migration `19_create_fund_requests.sql` from Phase 3).

### Scope
- Apply migration `20_create_requisitions.sql` to the Supabase project.
- Verify all objects are created correctly before any backend work begins.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/db/migrations/20_create_requisitions.sql` | **NEW** — apply to DB |

### Database Work

**`20_create_requisitions.sql`** creates:
- Enum `requisition_status_enum`: `'Pending'`, `'Approved'`, `'Hold'`, `'Cancelled'`
- Enum `gst_bill_enum`: `'Yes'`, `'No'`
- Table `requisitions` with all columns (linked to projects_master and authorised_users)
- Performance indexes on status, work_order_no, and requester
- 3 triggers: `trg_requisition_updated_at`, `trg_prevent_requisition_hard_delete`, `trg_audit_requisition_status`
- DB-level CHECK constraint for approved_balance_amount integrity on Approved records

### SQL to Create

```sql
-- ===========================================================================
-- Migration 20: Phase 4 — Requisitions
-- PREREQUISITE: Migrations 01–19 must have been applied.
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Enum types
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE requisition_status_enum AS ENUM (
  'Pending',    -- Requester submitted, awaiting authority action
  'Approved',   -- Authority approved with amount and remarks
  'Hold',       -- Authority placed on hold
  'Cancelled'   -- Requester cancelled before authority acted
);

CREATE TYPE gst_bill_enum AS ENUM ('Yes', 'No');

-- ────────────────────────────────────────────────────────────────────────────
-- 2. requisitions table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS requisitions (
  requisition_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Requester fields (auto-populated from session + master data)
  requester_user_id            VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  login_date                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Work Order linkage (triggers auto-fill of geo-metadata)
  work_order_no                VARCHAR NOT NULL REFERENCES projects_master(work_order_no) ON DELETE RESTRICT,
  estimate_no                  VARCHAR NOT NULL,               -- Auto-fetched from projects_master
  estimate_amount              NUMERIC(18,2),                  -- Auto-fetched (Final Approved estimate); NULL if none

  -- Auto-fetched geographic metadata (from projects_master at creation time, snapshot stored)
  state                        VARCHAR NOT NULL,
  district                     VARCHAR NOT NULL,
  area_code                    VARCHAR NOT NULL,               -- Corresponds to projects_master.zone
  department                   VARCHAR NOT NULL,
  site_details                 TEXT NOT NULL,

  -- Requester user-entered fields
  requisition_no               VARCHAR NOT NULL UNIQUE,        -- User-entered, unique, filename must match
  material_main_head           VARCHAR NOT NULL,               -- Dropdown from material_master
  requisition_pdf_url          TEXT NOT NULL,                  -- Supabase Storage URL (private bucket)
  requisition_amount           NUMERIC(18,2) NOT NULL CHECK (requisition_amount > 0),
  gst_bill                     gst_bill_enum NOT NULL,
  gst_bill_pdf_url             TEXT,                           -- Required only when gst_bill = 'Yes'
  bank_details                 TEXT NOT NULL,
  expen_head_remarks           TEXT,                           -- Optional

  -- Status
  requisition_status           requisition_status_enum NOT NULL DEFAULT 'Pending',

  -- Authority fields (auto-populated + user-entered on action)
  approved_user_id             VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  payment_date                 TIMESTAMPTZ,
  approve_type                 VARCHAR,                        -- 'Approve' or 'Hold'
  approved_amount              NUMERIC(18,2),                  -- Required on Approve; NULL on Hold
  approved_balance_amount      NUMERIC(18,2),                  -- Computed: requisition_amount - approved_amount
  remarks_approved_authority   TEXT,                           -- Required on Approve; NULL on Hold

  -- Cancellation tracking
  cancelled_by                 VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  cancelled_at                 TIMESTAMPTZ,

  -- DB-level integrity: when Approved, balance must equal requisition_amount - approved_amount
  CONSTRAINT chk_balance_amount
    CHECK (
      requisition_status != 'Approved'
      OR (
        approved_amount IS NOT NULL
        AND approved_balance_amount IS NOT NULL
        AND approved_balance_amount = requisition_amount - approved_amount
      )
    ),

  -- GST bill PDF required when gst_bill = 'Yes'
  CONSTRAINT chk_gst_bill_pdf
    CHECK (gst_bill != 'Yes' OR gst_bill_pdf_url IS NOT NULL),

  -- approve_type must be valid value when set
  CONSTRAINT chk_approve_type
    CHECK (approve_type IS NULL OR approve_type IN ('Approve', 'Hold')),

  -- Audit fields
  created_by                   VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Indexes for performance
-- ────────────────────────────────────────────────────────────────────────────

-- Partial index on Pending status — primary query pattern for approver queue
CREATE INDEX IF NOT EXISTS idx_requisitions_status
  ON requisitions(requisition_status)
  WHERE requisition_status = 'Pending';

-- Fast lookup by work order number
CREATE INDEX IF NOT EXISTS idx_requisitions_work_order
  ON requisitions(work_order_no);

-- Fast lookup for requester's own records
CREATE INDEX IF NOT EXISTS idx_requisitions_requester
  ON requisitions(requester_user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: auto-update updated_at
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_requisition_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_requisition_updated_at ON requisitions;
CREATE TRIGGER trg_requisition_updated_at
BEFORE UPDATE ON requisitions
FOR EACH ROW EXECUTE FUNCTION set_requisition_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: block hard DELETE (requisitions are permanent records)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_requisition_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of requisitions is permanently prohibited. Use status transitions instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_requisition_hard_delete ON requisitions;
CREATE TRIGGER trg_prevent_requisition_hard_delete
BEFORE DELETE ON requisitions
FOR EACH ROW EXECUTE FUNCTION prevent_requisition_hard_delete();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Trigger: audit log on status change
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_requisition_status_change()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_requisition_status ON requisitions;
CREATE TRIGGER trg_audit_requisition_status
AFTER UPDATE ON requisitions
FOR EACH ROW EXECUTE FUNCTION audit_requisition_status_change();
```

### Supabase Storage Buckets to Create (Manual Step in Dashboard)

| Bucket Name | Access | Notes |
|---|---|---|
| `requisition-pdfs` | **Private** | Stores requisition PDF files |
| `gst-bills` | **Private** | Stores GST bill PDF files |

> [!IMPORTANT]
> Both buckets MUST be set to **private** in Supabase Dashboard. Signed URLs (TTL: 1 hour) will be generated via the backend for every PDF preview request. Do NOT make these public.

### Acceptance Criteria
```
✓ requisitions table exists with all columns
✓ requisition_status_enum has exactly 4 values: Pending, Approved, Hold, Cancelled
✓ gst_bill_enum has exactly 2 values: Yes, No
✓ 3 performance indexes created
✓ trg_requisition_updated_at fires on UPDATE (updated_at changes)
✓ trg_prevent_requisition_hard_delete raises exception on DELETE
✓ trg_audit_requisition_status inserts into audit_log on status change
✓ requisition_no unique constraint prevents duplicate request numbers
✓ CONSTRAINT chk_balance_amount enforced
✓ CONSTRAINT chk_gst_bill_pdf enforced
✓ Both Supabase Storage buckets created and set to private
```

### Test Cases

**Test 1:** Insert a requisition row with `requisition_status = 'Pending'` and all required fields.  
Expected: row inserted successfully.

**Test 2:** Insert a second requisition with the same `requisition_no`.  
Expected: unique constraint violation on `requisition_no`.

**Test 3:** Attempt `DELETE FROM requisitions WHERE requisition_id = <any>`.  
Expected: exception — "Hard deletion of requisitions is permanently prohibited."

**Test 4:** Update `requisition_status`; check `audit_log`.  
Expected: new row in `audit_log` with `module_name = 'Requisition'`, `action = 'STATUS_CHANGE'`.

**Test 5:** Update any non-status field (e.g., `expen_head_remarks`); check `updated_at`.  
Expected: `updated_at` automatically updated.

**Test 6:** Insert a requisition with `gst_bill = 'Yes'` but `gst_bill_pdf_url = NULL`.  
Expected: CHECK constraint violation (`chk_gst_bill_pdf`).

**Test 7:** Insert a requisition with `requisition_status = 'Approved'` but `approved_balance_amount ≠ requisition_amount − approved_amount`.  
Expected: CHECK constraint violation (`chk_balance_amount`).

### Exit Criteria
```
✓ All 7 test cases pass
✓ No migration errors in Supabase dashboard
✓ Schema inspector confirms table, enums, indexes, triggers, constraints
✓ Storage buckets created and private
✓ Ready to begin M2
```

---

## M2 — Requisitions API: Core CRUD

### Objective
Implement `createRequisition`, `getRequisitions`, and `getRequisitionById`. These establish the base read/write layer. No workflow transitions or file uploads yet.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/controllers/requisitions.controller.js` | **NEW** (partial — CRUD functions) |
| `backend/src/routes/requisitions.routes.js` | **NEW** |
| `backend/src/app.js` | **MODIFY** — add route mount |

### Backend Work

**Controller file skeleton:**

```javascript
'use strict';

const { supabase } = require('../db/supabase');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const VALID_STATUSES    = ['Pending', 'Approved', 'Hold', 'Cancelled'];
// Only JE can create requisitions
const REQUESTER_ROLES   = ['je'];
// Only ZO and HO can approve/hold requisitions
const APPROVER_ROLES    = ['zo', 'ho'];
const VALID_GST_VALUES  = ['Yes', 'No'];

// Sanitize requisition_no for use as a Storage filename
// Allows: letters, digits, hyphens, underscores, dots
function sanitizeRequisitionNo(str) {
  return /^[A-Za-z0-9_\-.]+$/.test(str);
}
```

**`createRequisition(req, res)`** — Full implementation spec:

```
1. Destructure from req.body:
   { work_order_no, requisition_no, material_main_head, requisition_pdf_url,
     requisition_amount, gst_bill, gst_bill_pdf_url, bank_details, expen_head_remarks }

   Role guard (enforced at route level via requireRole(['je'])):
   → Only JE can call this endpoint. ZO, HO, admin, staff → 403.

2. Input validation (all → 400):
   a. work_order_no: required, non-blank string after .trim()
      Error: "work_order_no is required."
   b. requisition_no: required, non-blank string after .trim()
      Error: "requisition_no (Requisition Number) is required."
   c. sanitizeRequisitionNo(requisition_no.trim()) must be true
      Error: "requisition_no contains invalid characters. Only letters, digits, hyphens, underscores, and dots are allowed."
   d. material_main_head: required, non-blank
      Error: "material_main_head is required."
   e. requisition_pdf_url: required, non-blank string
      Error: "requisition_pdf_url is required. Upload the PDF first."
   f. requisition_amount: required, Number(requisition_amount) > 0 and finite
      Error: "requisition_amount must be a positive number greater than zero."
   g. gst_bill: must be 'Yes' or 'No'
      Error: "gst_bill must be 'Yes' or 'No'."
   h. if gst_bill === 'Yes': gst_bill_pdf_url required, non-blank
      Error: "gst_bill_pdf_url is required when GST Bill is 'Yes'."
   i. bank_details: required, non-blank string after .trim()
      Error: "bank_details is required."

3. Unique requisition_no check:
   SELECT COUNT(*) FROM requisitions WHERE requisition_no = $1
   → 409 if count > 0: "A requisition with number {requisition_no} already exists."

4. Validate work_order_no exists:
   SELECT estimate_no, state, district, zone, department, site_details
   FROM projects_master
   WHERE work_order_no = $1
   → 404 if not found: "Work order not found."

5. Auto-fetch estimate_amount (snapshot at creation time):
   SELECT MAX(estimate_amount)
   FROM project_cost_estimates
   WHERE work_order_no = $1 AND estimate_status = 'Final Approved'
   → NULL if no final approved estimate (allowed — stored as null)

   NOTE: If estimate_amount is NULL, the Remaining Amount check (step 6) is skipped.

6. *** Remaining Estimate Amount Validation ***
   If estimate_amount IS NOT NULL:

   a. Compute total already-committed amount for this work order:
      SELECT COALESCE(SUM(requisition_amount), 0) AS committed
      FROM requisitions
      WHERE work_order_no = $1
        AND requisition_status NOT IN ('Cancelled')

   b. remainingAmount = estimate_amount - committed

   c. Validate: Number(requisition_amount) <= remainingAmount
      → 422 if exceeds:
         "Requisition amount exceeds the remaining estimate balance.
         Estimate Amount: ₹{estimate_amount}.
         Already Committed: ₹{committed}.
         Remaining: ₹{remainingAmount}.
         Your Request: ₹{requisition_amount}."

   IMPORTANT: This check MUST be performed AFTER uniqueness check (step 3) and BEFORE insert.
   The check is advisory, not atomic — in a very-high-concurrency scenario two simultaneous
   requests could both pass. This is acceptable given the low concurrency of an internal ERP.
   For a future hardening, this can be enforced via a DB-level trigger or serializable
   transaction.

7. Build insert payload:
   {
     requester_user_id: req.user.mobile_number,
     work_order_no:     work_order_no.trim(),
     estimate_no:       project.estimate_no,
     estimate_amount:   estimateAmount || null,
     state:             project.state,
     district:          project.district,
     area_code:         project.zone,       // maps to 'zone' column in projects_master
     department:        project.department,
     site_details:      project.site_details,
     requisition_no:    requisition_no.trim(),
     material_main_head: material_main_head.trim(),
     requisition_pdf_url: requisition_pdf_url.trim(),
     requisition_amount:  Number(requisition_amount),
     gst_bill:            gst_bill,
     gst_bill_pdf_url:    gst_bill === 'Yes' ? gst_bill_pdf_url.trim() : null,
     bank_details:        bank_details.trim(),
     expen_head_remarks:  expen_head_remarks?.trim() || null,
     requisition_status:  'Pending',
     created_by:          req.user.mobile_number
   }

8. On insert error code '23505': return 409 (duplicate unique constraint on requisition_no)

9. Return 201 with created requisition and computed remainingAmount for display:
   { success: true, requisition: {...}, remainingAmountAfter: remainingAmount - Number(requisition_amount) }
```

**`getRequisitions(req, res)`** — Role-filtered list with pagination:

```
Query params: page, limit (cap 100), status (optional)

Filtering by role:
  'je':    requisitions WHERE requester_user_id = req.user.mobile_number (own records only)
  'zo':    all requisitions (approver — sees all)
  'ho':    all requisitions (approver — sees all)
  'admin': all requisitions (read-only oversight)
  'staff': 403 Forbidden (no access to requisition module)

Apply optional status filter if provided and valid (must be in VALID_STATUSES).
Order: created_at DESC.
Paginate: RANGE(offset, offset+limit-1) with count: 'exact'.

Additionally, for 'je' role: compute and return remainingEstimateAmount for each requisition
(estimate_amount minus SUM of non-cancelled requisitions for the same work_order_no) so the
frontend can display how much budget is left per work order.

Resolve display names for requester_user_id and approved_user_id by fetching authorised_users.

Return: { success, requisitions, pagination }
```

**`getRequisitionById(req, res)`** — Single record with visibility:

```
1. Validate requisition_id UUID → 400 if invalid.
2. Fetch requisition → 404 if not found.
3. Visibility gate:
   'je':    requester_user_id must = req.user.mobile_number → else 404 (no ID leakage)
   'zo':    always visible (approver role)
   'ho':    always visible (approver role)
   'admin': always visible (oversight)
   'staff': 403 Forbidden
4. Resolve display names for requester_user_id and approved_user_id.
5. Generate a fresh signed URL for requisition_pdf_url (60-minute TTL) if url is a storage path.
6. Generate a fresh signed URL for gst_bill_pdf_url (60-minute TTL) if present.
7. Compute and include remainingEstimateAmount for context:
   remainingEstimateAmount = estimate_amount - SUM(requisition_amount WHERE work_order_no = X AND status != 'Cancelled')
8. Return enriched requisition object.
```

**`app.js` modification:**

```javascript
const requisitionsRoutes = require('./routes/requisitions.routes');
// ... after existing mounts:
app.use('/api/v1/auth/requisitions', requisitionsRoutes);
```

### Acceptance Criteria
```
✓ POST /requisitions by 'je' with valid parameters → 201, status = 'Pending'
✓ POST /requisitions by 'zo' user → 403 (JE-only creation)
✓ POST /requisitions by 'ho' user → 403 (JE-only creation)
✓ POST /requisitions by 'admin' user → 403 (JE-only creation)
✓ POST /requisitions with duplicate requisition_no → 409
✓ POST /requisitions with requisition_amount = 0 → 400
✓ POST /requisitions with requisition_amount = -100 → 400
✓ POST /requisitions with requisition_amount > remaining estimate amount → 422
✓ POST /requisitions with blank requisition_no → 400
✓ POST /requisitions with gst_bill = 'Yes' and missing gst_bill_pdf_url → 400
✓ POST /requisitions with invalid work_order_no → 404
✓ POST /requisitions with special chars in requisition_no (e.g., '../etc') → 400
✓ GET /requisitions as 'je': only own requests returned
✓ GET /requisitions as 'zo': all requisitions returned (approver view)
✓ GET /requisitions as 'ho': all requisitions returned (approver view)
✓ GET /requisitions as 'admin': all requests returned
✓ GET /requisitions as 'staff' → 403
✓ GET /requisitions/:id by je non-owner → 404 (not 403 — no ID leakage)
✓ Pagination: page, limit, total, totalPages present in response
✓ Auto-filled fields (state, district, area_code, department, site_details, estimate_no) correctly populated
✓ remainingEstimateAmount returned in response for je list view
```

### Test Cases

**Test 1:** `POST /requisitions` as `je` user with all valid fields, `gst_bill = 'No'`, `requisition_amount` within remaining balance.  
Expected: 201, `{ requisition_status: 'Pending', requester_user_id: <mobile> }`. All geo-fields auto-populated from projects_master.

**Test 1b:** `POST /requisitions` as `zo` user.  
Expected: 403 — JE-only creation.

**Test 1c:** `POST /requisitions` as `admin` user.  
Expected: 403 — JE-only creation.

**Test 2:** `POST /requisitions` with the same `requisition_no`.  
Expected: 409 — "A requisition with number already exists."

**Test 3:** `POST /requisitions` with blank `requisition_no`.  
Expected: 400 — "requisition_no (Requisition Number) is required."

**Test 4:** `POST /requisitions` with `requisition_amount = 0`.  
Expected: 400 — amount validation.

**Test 5:** `POST /requisitions` with `gst_bill = 'Yes'` and no `gst_bill_pdf_url`.  
Expected: 400 — "gst_bill_pdf_url is required when GST Bill is 'Yes'."

**Test 6:** `POST /requisitions` with `work_order_no = 'NONEXISTENT_WO'`.  
Expected: 404 — "Work order not found."

**Test 7:** `POST /requisitions` with `requisition_no = '../../../etc/passwd'`.  
Expected: 400 — "requisition_no contains invalid characters."

**Test 7b: Remaining Estimate Amount — at limit.**  
Setup: Estimate Amount = ₹10,000. One existing Pending requisition for ₹5,000.  
Action: JE submits a new requisition for exactly ₹5,000.  
Expected: 201 — ₹5,000 ≤ remaining ₹5,000, so it's valid.

**Test 7c: Remaining Estimate Amount — exceeds limit.**  
Setup: Estimate Amount = ₹10,000. One existing Pending requisition for ₹5,000.  
Action: JE submits a new requisition for ₹5,001.  
Expected: 422 — Exceeds remaining balance of ₹5,000. Error message includes Estimate Amount, Committed, Remaining, and Requested amounts.

**Test 7d: Remaining Estimate Amount — cancelled requisitions excluded.**  
Setup: Estimate Amount = ₹10,000. One Cancelled requisition for ₹8,000.  
Action: JE submits a new requisition for ₹9,000.  
Expected: 201 — Cancelled requisitions are excluded from committed total. Remaining = ₹10,000. ₹9,000 ≤ ₹10,000.

**Test 7e: Remaining Estimate Amount — no Final Approved estimate.**  
Setup: Work order has no Final Approved estimate (estimate_amount = NULL).  
Action: JE submits a requisition for any amount.  
Expected: 201 — Remaining amount check skipped when estimate_amount is NULL.

**Test 8:** `GET /requisitions` as `je` user — only own requests visible.  
Expected: 200, all items have `requester_user_id = req.user.mobile_number`.

**Test 9:** `GET /requisitions/:id` where request belongs to a different je user.  
Expected: 404 (no ID leakage).

**Test 9b:** `GET /requisitions/:id` as `zo` user — any requisition.  
Expected: 200 (approver sees all).

**Test 9c:** `GET /requisitions` as `staff` user.  
Expected: 403 Forbidden.

**Test 10:** `GET /requisitions?page=1&limit=5`.  
Expected: 200, `pagination.limit = 5`, `pagination.total` ≥ 0.

**Test 11:** `GET /requisitions` as `ho` user.  
Expected: 200, all requisitions visible (HO is approver).

**Test 12:** Verify `estimate_amount` is `null` when no Final Approved estimate exists for the work order.  
Expected: 201 with `estimate_amount: null`.

### Exit Criteria
```
✓ All 12 test cases pass
✓ No P1 defects
✓ Route registered in app.js and server starts without error
✓ Ready to begin M3
```

---

## M3 — Requisitions API: Workflow (Act + Cancel)

### Objective
Implement the two state-transition endpoints: `actOnRequisition` (ZO/HO Approve or Hold) and `cancelRequisition` (JE Cancel). These are the core workflow actions shown in the process flow diagram Step 2.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/controllers/requisitions.controller.js` | **MODIFY** — add `actOnRequisition`, `cancelRequisition` |
| `backend/src/routes/requisitions.routes.js` | **MODIFY** — add action + cancel routes |

### Backend Work

**`actOnRequisition(req, res)`** — Full implementation:

```javascript
async function actOnRequisition(req, res) {
  const { id } = req.params;
  const { action, approved_amount, remarks_approved_authority } = req.body;

  // 1. UUID validation
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid requisition ID.' });
  }

  // 2. Action validation
  if (!['Approve', 'Hold'].includes(action)) {
    return res.status(400).json({ success: false, message: "action must be 'Approve' or 'Hold'." });
  }

  try {
    // 3. Fetch requisition
    const { data: req_record, error: fetchError } = await supabase
      .from('requisitions')
      .select('*')
      .eq('requisition_id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!req_record) return res.status(404).json({ success: false, message: 'Requisition not found.' });

    // 4. Status guard: must be Pending
    if (req_record.requisition_status !== 'Pending') {
      return res.status(403).json({
        success: false,
        message: `Action can only be taken on Pending requisitions. Current status: ${req_record.requisition_status}`
      });
    }

    let updatePayload = {
      approved_user_id: req.user.mobile_number,
      payment_date:     new Date().toISOString(),
      approve_type:     action
    };

    // 5a. Hold path
    if (action === 'Hold') {
      updatePayload.requisition_status          = 'Hold';
      // approved_amount, approved_balance_amount, remarks_approved_authority remain NULL
    }

    // 5b. Approve path
    if (action === 'Approve') {
      const hoAmount = Number(approved_amount);
      if (!approved_amount || isNaN(hoAmount) || hoAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'approved_amount is required for approval and must be greater than zero.'
        });
      }

      const remarksStr = (remarks_approved_authority || '').trim();
      if (!remarksStr) {
        return res.status(400).json({
          success: false,
          message: 'remarks_approved_authority is required for approval.'
        });
      }

      const balanceAmount = Number(req_record.requisition_amount) - hoAmount;

      updatePayload.requisition_status          = 'Approved';
      updatePayload.approved_amount             = hoAmount;
      updatePayload.approved_balance_amount     = balanceAmount;
      updatePayload.remarks_approved_authority  = remarksStr;
    }

    // 6. Perform update with optimistic lock
    const { data: updated, error: updateError } = await supabase
      .from('requisitions')
      .update(updatePayload)
      .eq('requisition_id', id)
      .eq('requisition_status', 'Pending')  // Optimistic lock — prevents race conditions
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: The requisition status was already changed by another action.'
      });
    }

    return res.status(200).json({
      success: true,
      requisition: updated,
      message: `Requisition has been ${action === 'Approve' ? 'approved' : 'placed on hold'}.`
    });

  } catch (error) {
    console.error(`actOnRequisition failed: ${error.message}`, error.stack);
    return res.status(500).json({ success: false, message: 'Failed to process requisition action.' });
  }
}
```

**`cancelRequisition(req, res)`** — Full implementation:

```javascript
async function cancelRequisition(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid requisition ID.' });
  }

  try {
    const { data: req_record, error: fetchError } = await supabase
      .from('requisitions')
      .select('*')
      .eq('requisition_id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!req_record) return res.status(404).json({ success: false, message: 'Requisition not found.' });

    // Ownership check — only the JE who created the requisition can cancel it.
    // There is no admin bypass for cancellation in the Requisition module.
    if (req_record.requester_user_id !== req.user.mobile_number) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the JE who created this requisition can cancel it.'
      });
    }

    // Status guard
    if (req_record.requisition_status !== 'Pending') {
      return res.status(403).json({
        success: false,
        message: `Only Pending requisitions can be cancelled. Current status: ${req_record.requisition_status}`
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('requisitions')
      .update({
        requisition_status: 'Cancelled',
        cancelled_by:       req.user.mobile_number,
        cancelled_at:       new Date().toISOString()
      })
      .eq('requisition_id', id)
      .eq('requisition_status', 'Pending')  // Optimistic lock
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: The requisition was already acted upon.'
      });
    }

    return res.status(200).json({
      success: true,
      requisition: updated,
      message: 'Requisition cancelled successfully.'
    });

  } catch (error) {
    console.error(`cancelRequisition failed: ${error.message}`, error.stack);
    return res.status(500).json({ success: false, message: 'Failed to cancel requisition.' });
  }
}
```

### Acceptance Criteria
```
✓ PATCH /:id/action with action='Hold' on Pending → 200, status = 'Hold', approved_amount = NULL
✓ PATCH /:id/action with action='Approve', valid amount, valid remarks → 200, status = 'Approved'
✓ PATCH /:id/action with action='Approve', missing approved_amount → 400
✓ PATCH /:id/action with action='Approve', approved_amount = 0 → 400
✓ PATCH /:id/action with action='Approve', missing remarks → 400
✓ PATCH /:id/action on non-Pending → 403
✓ PATCH /:id/action by 'je' user → 403 (requireRole(['zo','ho']) blocks it)
✓ PATCH /:id/action by 'admin' user → 403 (admin is not an approver in this module)
✓ PATCH /:id/action with action='Maybe' → 400
✓ approved_balance_amount = requisition_amount - approved_amount (e.g., 10000 - 8000 = 2000)
✓ PATCH /:id/cancel by 'je' on own Pending → 200, status = 'Cancelled'
✓ PATCH /:id/cancel by 'zo' on a requisition → 403 (ZO cannot cancel)
✓ PATCH /:id/cancel on another user's → 403
✓ PATCH /:id/cancel on Approved → 403
✓ Concurrent PATCH /:id/action calls → optimistic lock returns 409 for the second
```

### Test Cases

**Test 1:** ZO calls `PATCH /:id/action` with `action='Approve'`, valid amount 8000, valid remarks.  
Expected: 200, `requisition_status = 'Approved'`, `approved_amount = 8000`, `approved_balance_amount = requisition_amount - 8000`, `payment_date` and `approved_user_id` set.

**Test 2:** HO calls `PATCH /:id/action` with `action='Hold'`.  
Expected: 200, `requisition_status = 'Hold'`, `approved_amount` is NULL, `approved_balance_amount` is NULL, `remarks_approved_authority` is NULL.

**Test 3:** ZO calls `PATCH /:id/action` with `action='Approve'`, `approved_amount = 0`.  
Expected: 400 — amount must be greater than zero.

**Test 4:** HO calls `PATCH /:id/action` with `action='Approve'`, missing `remarks_approved_authority`.  
Expected: 400 — remarks required.

**Test 5:** ZO calls `PATCH /:id/action` on an already-Approved requisition.  
Expected: 403 — not Pending.

**Test 6:** JE calls `PATCH /:id/action`.  
Expected: 403 — role guard at route level (requireRole(['zo', 'ho'])).

**Test 6b:** Admin calls `PATCH /:id/action`.  
Expected: 403 — admin is not an approver in this module.

**Test 7:** JE calls `PATCH /:id/cancel` on own Pending requisition.  
Expected: 200, `requisition_status = 'Cancelled'`, `cancelled_by` set.

**Test 8:** JE calls `PATCH /:id/cancel` on Approved requisition.  
Expected: 403 — not Pending.

**Test 9:** JE1 calls `PATCH /:id/cancel` on JE2's requisition.  
Expected: 403 — ownership check.

**Test 10:** ZO calls `PATCH /:id/cancel` on any requisition.  
Expected: 403 — only JE can cancel their own requisitions.

**Test 11:** Simulate concurrent `action=Hold` (ZO) and `action=Approve` (HO) on same requisition.  
Expected: One succeeds (200); the other gets 409 (optimistic lock).

**Test 12:** Verify DB CHECK constraint: Approved record with wrong balance amount is rejected by DB.  
Expected: Supabase error (constraint violation).

### Exit Criteria
```
✓ All 12 test cases pass
✓ Optimistic locking confirmed
✓ DB CHECK constraint for balance_amount verified
✓ No P1 defects
✓ Ready to begin M4
```

---

## M4 — File Upload API (PDF Storage)

### Objective
Add secure file upload endpoints for Requisition PDF and GST Bill PDF. All files are stored in private Supabase Storage buckets. Signed URLs are returned for secure browser preview.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/controllers/requisitions.uploads.controller.js` | **NEW** |
| `backend/src/routes/requisitions.routes.js` | **MODIFY** — add upload routes + multer |
| `backend/package.json` | **MODIFY** — add `multer` dependency |

### Backend Work

**Install dependency:**
```bash
cd backend && npm install multer
```

**`requisitions.uploads.controller.js`** — Full implementation:

```javascript
'use strict';

const { supabase } = require('../db/supabase');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME  = 'application/pdf';

// Sanitize filename: only allow [A-Za-z0-9_\-.]
function sanitizeFilename(str) {
  return str.replace(/[^A-Za-z0-9_\-.]/g, '_');
}

/**
 * POST /api/v1/auth/requisitions/upload/requisition-pdf
 * Uploads a Requisition PDF to Supabase Storage.
 * Body (multipart/form-data): file, requisition_no
 *
 * Security:
 *  - MIME type validated: must be application/pdf
 *  - File size capped at 5MB (also enforced by multer limits)
 *  - Filename sanitized before storage path construction
 *  - Returns signed URL (1-hour TTL) — NOT a public URL
 */
async function uploadRequisitionPdf(req, res) {
  const file = req.file;
  const { requisition_no } = req.body;

  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  if (file.mimetype !== ALLOWED_MIME) {
    return res.status(400).json({ success: false, message: 'Only PDF files are accepted.' });
  }

  if (file.size > MAX_FILE_SIZE) {
    return res.status(400).json({ success: false, message: 'File size must not exceed 5MB.' });
  }

  if (!requisition_no || String(requisition_no).trim() === '') {
    return res.status(400).json({ success: false, message: 'requisition_no is required for naming the uploaded file.' });
  }

  const safeRequisitionNo = sanitizeFilename(String(requisition_no).trim());
  const storagePath = `${safeRequisitionNo}.pdf`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('requisition-pdfs')
      .upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: false  // reject duplicate — requisition_no must be unique
      });

    if (uploadError) {
      // Duplicate file (same requisition_no already uploaded)
      if (uploadError.statusCode === '409' || uploadError.message?.includes('already exists')) {
        return res.status(409).json({
          success: false,
          message: `A PDF for requisition number '${requisition_no}' already exists.`
        });
      }
      throw uploadError;
    }

    // Generate signed URL (1-hour TTL) for immediate preview
    const { data: signedData, error: signError } = await supabase.storage
      .from('requisition-pdfs')
      .createSignedUrl(storagePath, 3600);

    if (signError) throw signError;

    return res.status(201).json({
      success: true,
      storagePath,
      signedUrl: signedData.signedUrl,
      message: 'Requisition PDF uploaded successfully.'
    });

  } catch (error) {
    console.error(`uploadRequisitionPdf failed: ${error.message}`, error.stack);
    return res.status(500).json({ success: false, message: 'Failed to upload requisition PDF.' });
  }
}

/**
 * POST /api/v1/auth/requisitions/upload/gst-bill
 * Uploads a GST Bill PDF to Supabase Storage.
 * Body (multipart/form-data): file, requisition_no
 */
async function uploadGstBillPdf(req, res) {
  const file = req.file;
  const { requisition_no } = req.body;

  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  if (file.mimetype !== ALLOWED_MIME) {
    return res.status(400).json({ success: false, message: 'Only PDF files are accepted.' });
  }

  if (file.size > MAX_FILE_SIZE) {
    return res.status(400).json({ success: false, message: 'File size must not exceed 5MB.' });
  }

  if (!requisition_no || String(requisition_no).trim() === '') {
    return res.status(400).json({ success: false, message: 'requisition_no is required for naming the uploaded GST bill.' });
  }

  const safeRequisitionNo = sanitizeFilename(String(requisition_no).trim());
  const storagePath = `${safeRequisitionNo}_gst.pdf`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('gst-bills')
      .upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: true  // allow re-upload if GST bill changes before final save
      });

    if (uploadError) throw uploadError;

    const { data: signedData, error: signError } = await supabase.storage
      .from('gst-bills')
      .createSignedUrl(storagePath, 3600);

    if (signError) throw signError;

    return res.status(201).json({
      success: true,
      storagePath,
      signedUrl: signedData.signedUrl,
      message: 'GST Bill PDF uploaded successfully.'
    });

  } catch (error) {
    console.error(`uploadGstBillPdf failed: ${error.message}`, error.stack);
    return res.status(500).json({ success: false, message: 'Failed to upload GST bill PDF.' });
  }
}

module.exports = {
  uploadRequisitionPdf,
  uploadGstBillPdf
};
```

**Signed URL regeneration in `getRequisitionById`:**

When fetching a single requisition, the controller must refresh the signed URL so the frontend can show the PDF. The `requisition_pdf_url` stored in DB is the storage path (e.g., `BP-01-15062026.pdf`), not the signed URL:

```javascript
// After fetching requisition from DB, before returning:
if (requisition.requisition_pdf_url) {
  const { data: pdfSign } = await supabase.storage
    .from('requisition-pdfs')
    .createSignedUrl(requisition.requisition_pdf_url, 3600);
  requisition.requisition_pdf_signed_url = pdfSign?.signedUrl || null;
}

if (requisition.gst_bill_pdf_url) {
  const { data: gstSign } = await supabase.storage
    .from('gst-bills')
    .createSignedUrl(requisition.gst_bill_pdf_url, 3600);
  requisition.gst_bill_pdf_signed_url = gstSign?.signedUrl || null;
}
```

> [!IMPORTANT]
> Store only the storage **path** (e.g., `BP-01-15062026.pdf`) in the `requisition_pdf_url` DB column — NOT the full signed URL (which expires). The controller generates a fresh signed URL on every read request.

### Acceptance Criteria
```
✓ POST /upload/requisition-pdf with valid PDF → 201, storagePath and signedUrl returned
✓ POST /upload/requisition-pdf with non-PDF file (e.g. .jpg) → 400
✓ POST /upload/requisition-pdf with file > 5MB → 400 (multer rejects before controller)
✓ POST /upload/requisition-pdf without requisition_no → 400
✓ POST /upload/requisition-pdf with path-traversal in requisition_no → sanitized (no error)
✓ POST /upload/gst-bill with valid PDF → 201
✓ GET /:id after upload → signed URLs included in response
✓ File exists in Supabase Storage bucket after upload
✓ Signed URL has 1-hour expiry (verify in token decode)
```

### Test Cases

**Test 1:** Upload valid PDF as JE user with a valid `requisition_no`.  
Expected: 201, `{ storagePath: 'BP-01-15062026.pdf', signedUrl: 'https://...' }`.

**Test 2:** Upload a `.jpg` file to requisition-pdf endpoint.  
Expected: 400 — "Only PDF files are accepted."

**Test 3:** Upload valid PDF without `requisition_no` in body.  
Expected: 400 — "requisition_no is required."

**Test 4:** Upload with `requisition_no = '../../../etc/passwd'`.  
Expected: 201 — filename sanitized to `______etc_passwd.pdf` (no traversal; also should 409 if allowed).

**Test 5:** Upload GST bill PDF with valid `requisition_no`.  
Expected: 201, file in `gst-bills` bucket.

**Test 6:** `GET /requisitions/:id` for a requisition with PDF.  
Expected: 200 with `requisition_pdf_signed_url` present and valid URL.

### Exit Criteria
```
✓ All 6 test cases pass
✓ Private bucket access confirmed (direct public URL 403s)
✓ No P1 defects
✓ Ready to begin M5
```

---

## M5 — Code Quality & Security Hardening

### Objective
Fix ALL 17 carry-over issues from the Phase 3 plan (none were fixed in Phase 3 execution) PLUS 5 new Phase 4 security items. This milestone must complete before frontend work begins, as hardening changes may affect API behavior that the frontend relies on.

### Files Modified
| File | Issues Fixed |
|---|---|
| `backend/src/controllers/estimates.core.controller.js` | CQ-1, CQ-6 |
| `backend/src/controllers/auth.controller.js` | CQ-2 |
| `backend/src/services/session.service.js` | CQ-3, SEC-3 |
| `backend/src/middleware/verifyJwt.js` | CQ-4, SEC-4 |
| `backend/src/controllers/reports.controller.js` | CQ-5 |
| `backend/src/controllers/admin.controller.js` | CQ-7, SEC-5 |
| `backend/src/middleware/rateLimiter.js` | CQ-8 |
| `backend/src/services/otp.service.js` | CQ-9 |
| `backend/src/services/telegram.service.js` | CQ-10 |
| `backend/src/app.js` | SEC-1 |

---

### Fix-by-Fix Implementation

#### CQ-1 — Hardcoded Mobile Numbers in Production Code
**File:** `estimates.core.controller.js` lines 113–126

**Problem:** A hardcoded array of production phone numbers (`legitMobiles`) is used to filter test data. This leaks PII into source code, will break when new legitimate users are added, and is a major code smell.

**Fix:**
```javascript
// BEFORE (lines 113–126):
const legitMobiles = [
  '+918276071523',
  '+917980526576',
  ...
];
if (legitMobiles.includes(req.user.mobile_number)) {
  dbQuery = dbQuery
    .not('work_order_no', 'like', 'TEST_%')
    .not('estimate_no', 'like', 'EST_%');
}

// AFTER:
// Filter test data records (work_order_no prefixed 'TEST_') when explicitly enabled
// via env var. Set IDBP_FILTER_TEST_DATA=true in production .env to hide seed/test records.
// This replaces the previous PII-leaking hardcoded mobile number whitelist.
if (process.env.IDBP_FILTER_TEST_DATA === 'true') {
  dbQuery = dbQuery
    .not('work_order_no', 'like', 'TEST_%')
    .not('estimate_no', 'like', 'EST_%');
}
```

Also add to `.env.example`:
```
# Set to 'true' in production to hide test/seed data records from all users
IDBP_FILTER_TEST_DATA=false
```

---

#### CQ-2 — IP Address Extraction Bug
**File:** `auth.controller.js` line 171

**Problem:** `req.ip || req.headers['x-forwarded-for']` — the fallback order is wrong. When behind a proxy, `req.ip` is already correct (trust proxy is set). The `x-forwarded-for` header may contain a comma-separated list; only the first IP is the real client.

**Fix:**
```javascript
// BEFORE (line 171):
const ipAddress = req.ip || req.headers['x-forwarded-for'];

// AFTER:
// req.ip is already correctly resolved by Express when 'trust proxy' is set (see app.js L50).
// The x-forwarded-for header may contain "client, proxy1, proxy2" — extract only the first.
const rawForwardedFor = req.headers['x-forwarded-for'];
const ipAddress = rawForwardedFor
  ? rawForwardedFor.split(',')[0].trim()
  : req.ip;
```

---

#### CQ-3 — JWT_SECRET Fallback in Session Service Has No Production Guard
**File:** `session.service.js` line 6

**Problem:** `JWT_SECRET` falls back to a plaintext dev string at the module level. The production guard exists only in `app.js`, but `session.service.js` resolves its own copy. If somehow loaded in isolation (e.g., tests that bypass app.js), the fallback can silently provide a weak secret.

**Fix:**
```javascript
// BEFORE (line 6):
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit';

// AFTER:
// In production, JWT_SECRET MUST be set (enforced by app.js on startup).
// This module provides a development-only fallback. The fallback is intentionally
// documented here so that any future refactor doesn't silently remove it.
// Ref: app.js production sanity checks at startup.
const JWT_SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('FATAL: JWT_SECRET must be set in production.'); })()
    : 'fallback_development_jwt_secret_key_minimum_256_bit');
```

---

#### CQ-4 — JWT Error Message Leaks Library Internals
**File:** `verifyJwt.js` lines 70–80

**Problem:** The generic catch block returns `error.message` verbatim. JWT library error messages (e.g., "invalid signature", "jwt malformed") can aid an attacker in crafting exploits.

**Fix:**
```javascript
// BEFORE (lines 70–80):
} catch (error) {
  console.error(`JWT Validation Error: ${error.message}`);
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      code: 'ACCESS_TOKEN_EXPIRED',
      message: 'Authentication failed. Access token expired.'
    });
  }
  return res.status(401).json({ success: false, message: 'Authentication failed. Invalid or expired token.' });
}

// AFTER:
} catch (error) {
  // Log internal error for debugging — do NOT expose error.message to client
  console.error(`JWT Validation Error: ${error.name} — ${error.message}`);

  if (error.name === 'TokenExpiredError') {
    // SEC-4: Clear expired cookie so client doesn't retry with a dead token
    res.clearCookie('accessToken', cookieOptions);
    return res.status(401).json({
      success: false,
      code: 'ACCESS_TOKEN_EXPIRED',
      message: 'Authentication failed. Access token expired.'
    });
  }

  // Generic message — do not leak JWT library error details to client
  return res.status(401).json({
    success: false,
    code: 'INVALID_TOKEN',
    message: 'Authentication failed. Token is invalid.'
  });
}
```

---

#### CQ-5 — Amount Not Validated for Numeric Type in Reports
**File:** `reports.controller.js` — `createReport` (line 215) and `updateReport` (line 271)

**Problem:** `if (!work_order_no || amount === undefined)` — the string `"abc"` passes this check and is silently stored or causes a DB error.

**Fix (createReport):**
```javascript
// BEFORE (line 215):
if (!work_order_no || amount === undefined) {
  return res.status(400).json({ success: false, message: 'work_order_no and amount are required.' });
}

// AFTER:
if (!work_order_no || amount === undefined || amount === null) {
  return res.status(400).json({ success: false, message: 'work_order_no and amount are required.' });
}
// Validate numeric type
if (isNaN(Number(amount)) || Number(amount) < 0) {
  return res.status(400).json({ success: false, message: 'amount must be a valid non-negative number.' });
}
```

**Fix (updateReport):**
```javascript
// BEFORE (line 271):
if (amount === undefined) {
  return res.status(400).json({ success: false, message: 'amount is required.' });
}

// AFTER:
if (amount === undefined || amount === null) {
  return res.status(400).json({ success: false, message: 'amount is required.' });
}
if (isNaN(Number(amount)) || Number(amount) < 0) {
  return res.status(400).json({ success: false, message: 'amount must be a valid non-negative number.' });
}
```

---

#### CQ-6 — JE Role Bypass via global=true Query Parameter
**File:** `estimates.core.controller.js` line 128

**Problem:** `if (effectiveRole === 'je' && query.global !== 'true')` — a JE user can pass `?global=true` to see ALL estimates across all JE users.

**Fix:**
```javascript
// BEFORE (line 128):
if (effectiveRole === 'je' && query.global !== 'true') {
  dbQuery = dbQuery.eq('created_by', req.user.mobile_number);
}

// AFTER:
// JE users are always filtered to their own records.
// global=true is reserved for admin role only.
if (effectiveRole === 'je') {
  dbQuery = dbQuery.eq('created_by', req.user.mobile_number);
} else if (effectiveRole === 'admin' && query.global === 'true') {
  // Admin can see all records with global=true — no additional filter
}
```

---

#### CQ-7 — updateUser Accepts Any Role String Without Validation
**File:** `admin.controller.js` line 80

**Problem:** `if (role !== undefined) updateFields.role = role;` — any string (e.g., `'superuser'`, `'root'`) is accepted and written to the DB.

**Fix:**
```javascript
// BEFORE (line 80):
if (role !== undefined) updateFields.role = role;

// AFTER:
const VALID_ROLES = ['staff', 'je', 'zo', 'ho', 'admin'];
if (role !== undefined) {
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}.`
    });
  }
  updateFields.role = role;
}
```

---

#### CQ-8 — Global Rate Limiter Comment
**File:** `rateLimiter.js` lines 83–89

**Problem:** The 1000 req/min limit is intentionally permissive for an internal ERP (users may generate many requests during bulk operations). No code change needed — but add a comment documenting the rationale.

**Fix:**
```javascript
/**
 * Global general-purpose rate limiter:
 * 1,000 requests per 1-minute window.
 *
 * INTENTIONALLY PERMISSIVE: This is an internal ERP application used by a small
 * set of known users. The limit is set high to avoid blocking legitimate bulk
 * operations (e.g., saving many estimate items). The per-role and per-endpoint
 * limiters (otpRequestLimiter, adminLimiter) provide tighter controls where needed.
 *
 * If exposed to the public internet, tighten to ~200 req/min.
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  // ...
```

---

#### CQ-9 — Non-Atomic OTP Attempt Increment
**File:** `otp.service.js` lines 87–92

**Problem:** The OTP attempt increment is a non-atomic read-modify-write:
1. Read `otpRequest.attempts` (value = 2)
2. Calculate `attempts + 1` = 3
3. Write back `attempts = 3`

Under concurrent requests (two simultaneous wrong OTP attempts), both reads get value 2, both write 3, and one of the three attempts is silently lost — the user gets an extra attempt to brute-force.

**Fix:** Use a DB-side increment expression to make it atomic:
```javascript
// BEFORE (lines 87–92):
if (!isValid) {
  await supabase
    .from('otp_requests')
    .update({ attempts: otpRequest.attempts + 1 })
    .eq('id', otpRequest.id);

// AFTER:
if (!isValid) {
  // Use DB-side RPC or raw SQL increment to make the attempt increment atomic.
  // Supabase does not support direct SQL expressions in .update(), so we use
  // a database function (rpc) or the alternative: fetch-then-update with
  // an optimistic lock on 'attempts' column value.
  //
  // Atomic approach using Supabase .update() with conditional optimistic lock:
  const { data: incrementResult } = await supabase
    .from('otp_requests')
    .update({ attempts: otpRequest.attempts + 1 })
    .eq('id', otpRequest.id)
    .eq('attempts', otpRequest.attempts)  // Optimistic lock — only update if not already changed
    .select();

  // If incrementResult is empty, a concurrent request already incremented it — that's fine.
  // The next check for attempts >= 3 will catch it correctly.
```

---

#### CQ-10 — OTP URL Encoding Confirmation
**File:** `telegram.service.js` line 33

**Problem:** Needs confirming that `encodeURIComponent` is used correctly on all URL parameters.

**Fix (comment only):**
```javascript
// encodeURIComponent is correctly applied to both telegramChatId and messageText.
// This prevents injection if either contains special URL characters (+, &, =, etc.).
// Verified: no raw string concatenation without encoding in this URL construction.
const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(telegramChatId)}&text=${encodeURIComponent(messageText)}`;
```

---

#### CQ-12 — console.error Logs Only error.message (Stack Trace Lost)

**Problem:** All controller catch blocks log only `error.message`. The full stack trace is lost in development and production. Diagnosis of async errors is significantly harder.

**Fix:** Update all `console.error` calls in catch blocks across all controllers:

```javascript
// BEFORE (pattern across all controllers):
} catch (error) {
  console.error(`createEstimate failed: ${error.message}`);
  return res.status(500).json(...);
}

// AFTER:
} catch (error) {
  // Log full stack in development; message only in production to reduce log noise
  if (process.env.NODE_ENV !== 'production') {
    console.error(`createEstimate failed:`, error);
  } else {
    console.error(`createEstimate failed: ${error.message}`);
  }
  return res.status(500).json(...);
}
```

**Files to update:** All catch blocks in:
- `estimates.core.controller.js`
- `estimates.workflow.controller.js`
- `estimates.items.controller.js`
- `auth.controller.js`
- `reports.controller.js`
- `admin.controller.js`
- `materials.controller.js`
- `projects.controller.js`
- `purchaseData.controller.js`
- `requisitions.controller.js` (already correct — use `error.stack`)

---

#### SEC-1 — CRITICAL: Materials Route Publicly Accessible
**File:** `app.js` lines 57–58

**Problem:**
```javascript
app.use('/api/materials', materialsRoutes);         // Line 57 — NO AUTH
app.use('/api/v1/auth/materials', materialsRoutes); // Line 58 — Has JWT guard
```

The `/api/materials` mount has NO `verifyJwt` applied. The `materials.routes.js` itself applies `router.use(verifyJwt)` inside — so it IS protected. However, the dual-mount is ambiguous and should be documented or cleaned up.

**Investigation result:** `materials.routes.js` applies `router.use(verifyJwt)` at line 1 — ALL routes inside ARE protected. The `/api/materials` prefix simply bypasses the `/api/v1/auth/` path naming convention, not the auth guard.

**Fix:**
```javascript
// In app.js, add a clear comment to prevent future confusion:

// NOTE: /api/materials (non-versioned) is a legacy alias for the same authenticated
// materials routes. The router itself applies verifyJwt internally (see materials.routes.js L1).
// This is NOT a public endpoint — auth IS enforced at the router level.
// DO NOT add any unauthenticated routes to materials.routes.js.
app.use('/api/materials', materialsRoutes);
app.use('/api/v1/auth/materials', materialsRoutes);
```

> [!CAUTION]
> If any future developer removes the `router.use(verifyJwt)` from `materials.routes.js` and relies on the path prefix for auth semantics, `/api/materials` becomes unauthenticated. The comment above must be treated as a security anchor. Consider removing the legacy mount entirely if no client uses it.

---

#### SEC-3 — Unsanitized User-Agent Stored in Sessions
**File:** `session.service.js` line 50

**Problem:** `user_agent: userAgent || null` — the raw `User-Agent` string is stored without length truncation. A crafted 100KB User-Agent could bloat the sessions table.

**Fix:**
```javascript
// BEFORE (line 50):
user_agent: userAgent || null,

// AFTER:
// Truncate to 500 characters max before storing.
// User-Agent strings are typically < 200 chars; legitimate browsers never exceed 500.
user_agent: userAgent ? String(userAgent).substring(0, 500) : null,
```

---

#### SEC-4 — TokenExpiredError Does Not Clear Cookie (Integrated in CQ-4)
Already addressed in the CQ-4 fix above — `res.clearCookie('accessToken', cookieOptions)` is added to the `TokenExpiredError` handler path.

---

#### SEC-5 — removeUser Hard-Deletes Without FK Pre-Check
**File:** `admin.controller.js` `removeUser` function (lines 116–140)

**Problem:** Hard DELETE on `authorised_users` — if the user has active requisitions, fund_requests, or estimates as `created_by` or `requester_user_id`, the FK constraint will either cascade (data loss) or fail with an opaque DB error.

**Fix:** Add a pre-check before deletion:
```javascript
async function removeUser(req, res) {
  const { id } = req.params;

  try {
    // 0. Fetch user to get mobile_number (FK references use mobile_number, not UUID)
    const { data: user, error: fetchError } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // 1. Pre-check: active fund requests as ZO user
    const { count: frCount } = await supabase
      .from('fund_requests')
      .select('fund_request_id', { count: 'exact', head: true })
      .eq('zo_user_id', user.mobile_number)
      .in('request_status', ['Pending']);

    if (frCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot remove user '${user.display_name}'. They have ${frCount} active fund request(s) in Pending status. Resolve these first.`
      });
    }

    // 2. Pre-check: active requisitions as requester
    const { count: reqCount } = await supabase
      .from('requisitions')
      .select('requisition_id', { count: 'exact', head: true })
      .eq('requester_user_id', user.mobile_number)
      .in('requisition_status', ['Pending']);

    if (reqCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot remove user '${user.display_name}'. They have ${reqCount} active requisition(s) in Pending status. Resolve these first.`
      });
    }

    // 3. Pre-check: active cost estimates as JE
    const { count: estCount } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id', { count: 'exact', head: true })
      .eq('created_by', user.mobile_number)
      .not('estimate_status', 'in', '("Final Approved","Rejected by ZO","Rejected by HO","Cancelled")');

    if (estCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot remove user '${user.display_name}'. They have ${estCount} active estimate(s) in progress. Resolve these first.`
      });
    }

    // 4. Invalidate active sessions first
    await supabase
      .from('sessions')
      .update({ is_active: false, logout_at: new Date().toISOString() })
      .eq('user_id', id)
      .eq('is_active', true);

    // 5. Perform delete
    const { error } = await supabase
      .from('authorised_users')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'User removed from whitelist and sessions invalidated.' });
  } catch (error) {
    console.error(`Admin removeUser failed: ${error.message}`, error.stack);
    return res.status(500).json({ success: false, message: 'Failed to remove user.' });
  }
}
```

---

### Phase 4 New Security Items

#### SEC-P4-1 — Supabase Storage Buckets Must Be Private
**Action:** Verify in Supabase Dashboard that both `requisition-pdfs` and `gst-bills` buckets are set to **private** (no public read policy). Generate signed URLs only via backend.  
**Verification:** Attempt to access a file via its public URL — must return 400/403.

#### SEC-P4-2 — File Upload MIME Type Enforcement
Already implemented in `uploadRequisitionPdf` and `uploadGstBillPdf` via `file.mimetype !== 'application/pdf'` check.

#### SEC-P4-3 — Filename/Path Injection Prevention
Already implemented via `sanitizeFilename()` function in uploads controller. The function strips all characters not in `[A-Za-z0-9_\-.]`.

#### SEC-P4-4 — Balance Amount DB Integrity
Already implemented via `CONSTRAINT chk_balance_amount` in migration `20_create_requisitions.sql`.

#### SEC-P4-5 — GST Bill Mandatory Enforcement
Already implemented: both DB-level (`CONSTRAINT chk_gst_bill_pdf`) and controller-level validation.

### Acceptance Criteria
```
✓ CQ-1: No hardcoded mobile numbers in codebase. IDBP_FILTER_TEST_DATA env var works.
✓ CQ-2: IP address correctly extracted (first value from x-forwarded-for chain).
✓ CQ-3: JWT_SECRET throws in production if not set (session.service.js).
✓ CQ-4: JWT error response standardized; no library internals leaked.
✓ CQ-5: amount field validated for numeric type in reports controller.
✓ CQ-6: JE cannot use global=true — always filtered to own records.
✓ CQ-7: updateUser rejects invalid role strings.
✓ CQ-8: globalLimiter comment documents rationale.
✓ CQ-9: OTP attempt increment uses optimistic lock for atomicity.
✓ CQ-10: encodeURIComponent confirmed and commented in telegram service.
✓ CQ-12: Stack traces logged in development; message-only in production.
✓ SEC-1: /api/materials dual-mount documented with security comment.
✓ SEC-3: User-Agent truncated to 500 chars before storage.
✓ SEC-4: accessToken cookie cleared on TokenExpiredError.
✓ SEC-5: removeUser pre-checks FK references before delete.
✓ SEC-P4-1: Storage buckets confirmed private.
✓ SEC-P4-2: MIME type enforced in upload controller.
✓ SEC-P4-3: Filename sanitized for storage path construction.
✓ SEC-P4-4: Balance amount CHECK constraint in DB.
✓ SEC-P4-5: GST bill URL enforced at both controller and DB level.
```

### Exit Criteria
```
✓ All acceptance criteria verified
✓ No P1 security defects open
✓ Server restarts cleanly after all changes
✓ Ready to begin M6a
```

---

## M6a — Frontend: Requisition Entry Form

### Objective
Build the `Requisitions.jsx` page with the full form following the flow diagram. The requester workflow (Step 1 from the diagram) is the focus here.

### Files Created or Modified
| File | Action |
|---|---|
| `frontend/src/pages/Requisitions.jsx` | **NEW** |
| `frontend/src/api/requisitionsApi.js` | **NEW** |

### API Client — `requisitionsApi.js`

```javascript
import authApi from './authApi';

// Base URL → /api/v1/auth/requisitions

/** Fetch all requisitions (role-filtered on server) */
export const getRequisitions = (params = {}) =>
  authApi.get('/requisitions', { params });

/** Fetch a single requisition by ID */
export const getRequisitionById = (id) =>
  authApi.get(`/requisitions/${id}`);

/** Create a new requisition */
export const createRequisition = (data) =>
  authApi.post('/requisitions', data);

/** Approve or Hold a requisition (ZO or HO only)
 * @param {string} id
 * @param {{ action: 'Approve'|'Hold', approved_amount?: number, remarks_approved_authority?: string }} data
 */
export const actOnRequisition = (id, data) =>
  authApi.patch(`/requisitions/${id}/action`, data);

/** Cancel a Pending requisition */
export const cancelRequisition = (id) =>
  authApi.patch(`/requisitions/${id}/cancel`);

/** Upload Requisition PDF
 * @param {File} file
 * @param {string} requisitionNo
 */
export const uploadRequisitionPdf = (file, requisitionNo) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('requisition_no', requisitionNo);
  return authApi.post('/requisitions/upload/requisition-pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

/** Upload GST Bill PDF
 * @param {File} file
 * @param {string} requisitionNo
 */
export const uploadGstBillPdf = (file, requisitionNo) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('requisition_no', requisitionNo);
  return authApi.post('/requisitions/upload/gst-bill', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
```

### Frontend Page — `Requisitions.jsx`

**Architecture:** A single-file page component following the existing pattern from `FundReports.jsx` (glassmorphism, dark theme, Tailwind classes, sidebar layout).

**Key sub-components to build inline:**
1. `RequisitionFormModal` — Multi-step entry form (Steps 1→2→3 as per flow diagram)
2. `ActionModal` — Approver action panel (Step 2 of flow diagram)
3. `StatusBadge` — Colored status indicator (Pending/Approved/Hold/Cancelled)
4. `ConfirmModal` — Cancellation confirmation dialog

**Requester Form — Detailed Field Spec:**

```
Section A: Auto-Populated (Read-Only)
  Login_Date    → Displayed as current date (from system)
  user_id       → req.user.display_name or mobile_number

Section B: Master Data Selection
  Work_Order_No → <select> dropdown populated from GET /projects
                  On change: auto-fetch estimate_no, state, district, 
                             area_code, department, site_details, estimate_amount

  Estimate_No        → Read-only text, auto-populated from selected work order
  Estimate_Amount    → Read-only numeric, auto-populated
  State, District, Area_Code, Department, Site_Details
                     → All read-only, auto-populated from master data
                     → Display in an indigo auto-fill panel (matching FundReports.jsx pattern)

Section C: Requester Input
  Requisition_NO     → <input type="text" required>
                     → Validate: non-blank, sanitized chars only
                     → Hint: "File name must be the Requisition No."

  Material_Main_Head → <select> populated from distinct Material_Main_Head values
                     → Fetched from GET /master-data/catalog → categories[].name

  PDF Upload:
    "Upload Requisition PDF" → <input type="file" accept=".pdf">
    Validation (on frontend):
      - File name must equal requisition_no + '.pdf'
        Error: "File name must match Requisition No. exactly: {requisition_no}.pdf"
      - File type must be PDF
      - File size ≤ 5MB
    On file select → call uploadRequisitionPdf() immediately
    Show: upload progress, then "✓ PDF Uploaded" + "Preview" button (opens signed URL)
    PDF Preview → opens signedUrl in new tab

  Requisition_Amount →
    <input type="number" required min="0.01" step="0.01">

    IMPORTANT — Remaining Estimate Amount indicator:
    Display live below the amount input:
    ┌──────────────────────────────────────────────────────────────┐
    │ Estimate Amount:         ₹10,000.00                          │
    │ Already Committed:       ₹5,000.00  (non-cancelled total)    │
    │ Remaining Balance:       ₹5,000.00  (highlighted in amber)   │
    │ ⚠ Max you can request:  ₹5,000.00                           │
    └──────────────────────────────────────────────────────────────┘
    Frontend pre-validation: if(amount > remainingBalance) disable submit + show error.
    Server-side validation returns 422 with detailed breakdown if frontend is bypassed.

  GST_Bill:
    <select> options: "No", "Yes"
    If "Yes" selected:
      Show GST Bill PDF upload field (mandatory)
      Same validation pattern as Requisition PDF

  Bank_Details → <textarea required>
  Expen_Head_Remarks → <textarea optional>

Submit Button: "Save Requisition"
  → Validates all fields
  → Calls createRequisition() with {
      work_order_no, requisition_no, material_main_head,
      requisition_pdf_url: storagePath_from_upload,
      requisition_amount, gst_bill,
      gst_bill_pdf_url: storagePath_from_gst_upload || null,
      bank_details, expen_head_remarks
    }
  → On 201: show success toast, close modal, refresh list
```

**Requester List View:**

```
Header:
  - Title: "Requisitions"
  - Subtitle: "Manage your payment requisition requests."
  - "New Requisition" button (visible only to 'je' role — hidden for zo/ho/admin)

Stat Cards (4 cards):
  - Total Requisitions
  - Pending (amber)
  - Approved (emerald)
  - Hold/Cancelled (red/grey)

Table Columns:
  Req. No. | Work Order | Material Head | Amount | Status | Date | Actions

Actions per row:
  - View/Preview button (opens detail modal with PDF preview)
  - Cancel button (visible only if: role = 'je' AND status = 'Pending' AND own record)
    ZO/HO/Admin: no cancel button shown — they are read-only or approval-only actors
```

### Acceptance Criteria
```
✓ Auto-fill populates all master data fields on Work_Order_No selection
✓ estimate_amount auto-populates from the linked project's Final Approved estimate
✓ Remaining Estimate Amount indicator shown below requisition_amount input
✓ Frontend prevents submission if requisition_amount > remaining balance
✓ Server-side 422 error displayed with detailed balance breakdown if bypassed
✓ Requisition PDF filename validation enforced on frontend
✓ PDF upload succeeds and preview link works
✓ GST Bill field appears ONLY when gst_bill = 'Yes'
✓ Form submits correctly → 201 → list refreshes
✓ Duplicate requisition_no → shows 409 error message from server
✓ Cancel confirmation modal visible ONLY to JE (own Pending records)
✓ ZO/HO do not see 'New Requisition' or 'Cancel' buttons
✓ Status badges render correctly for all 4 states
✓ Staff users see 403 / empty state — not a Requisitions module user
```

### Exit Criteria
```
✓ All acceptance criteria verified
✓ All form validations work (both client and server-side errors shown)
✓ PDF upload and preview functional end-to-end
✓ Ready to begin M6b
```

---

## M6b — Frontend: Approver Dashboard

### Objective
Build the ZO/HO Approver view of the Requisitions page — the Step 2 approval flow from the process diagram.

### Files Modified
| File | Action |
|---|---|
| `frontend/src/pages/Requisitions.jsx` | **MODIFY** — add approver view and ActionModal |

### Approver View — Detailed Spec

**Tab structure:** "Pending" | "All Requisitions"

**Pending Tab:**
```
List of all Pending requisitions (ZO and HO see all pending)

Each card/row shows:
  - Requester Name (display_name)
  - Requisition No.
  - Work Order No.
  - Requisition Amount (₹ formatted)
  - Material Main Head
  - Submitted Date

"Take Action" button → opens ActionModal
```

**ActionModal (Step 2 from flow diagram):**
```
Read-Only Auto-Populated:
  Approved & Payment_User_id  → current admin user's name/ID
  Approved & Payment_Date     → current date (displayed only; server stamps on save)

Approve_type dropdown: "Approve" | "Hold"

If Approve_type = 'Approve':
  SHOW ADDITIONAL FIELDS (as per diagram):
    Approved_Amount          → <input type="number" required min="0.01">
    Approved_Balance_Amount  → Read-only, computed live: Requisition_Amount − Approved_Amount
    Remarks_Approved_Authority → <textarea required>

If Approve_type = 'Hold':
  DO NOT SHOW (as per diagram):
    Approved_Amount, Approved_Balance_Amount, Remarks_Approved_Authority
    (these fields are hidden/disabled — not just greyed)

Submit Button:
  If Approve: "Save Approval (Approved)"
  If Hold:    "Save Approval (Hold)"

On submit → calls actOnRequisition(id, { action, approved_amount?, remarks? })
On success → show toast → close modal → refresh list → move record to All tab
```

**All Requisitions Tab:**
```
Full list with filter by status
Columns: Req. No. | Work Order | Amount | Status | Requester | Approved By | Date
No action buttons (read-only history view)
```

### Acceptance Criteria
```
✓ Approve flow: approved_amount + remarks required → 200 → status = 'Approved'
✓ Hold flow: no extra fields needed → 200 → status = 'Hold'
✓ Approved_Balance_Amount computed live in UI (e.g., ₹10,000 − ₹8,000 = ₹2,000)
✓ Non-admin users cannot see Take Action button
✓ Already-Approved requisitions do not show action button
✓ Approver ID and date auto-stamped by server (not editable by frontend)
✓ Ready to begin M6c
```

---

## M6c — Frontend: Dashboard Integration & Navigation

### Objective
Wire the Requisitions module into the main application routing and the Dashboard navigation card.

### Files Modified
| File | Action |
|---|---|
| `frontend/src/App.jsx` | **MODIFY** — add `/requisitions` route |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add Requisitions module card |

### App.jsx Modification

```jsx
import Requisitions from './pages/Requisitions';

// Inside the ProtectedRoute for ['je', 'zo', 'ho', 'admin'] (staff excluded):
<Route path="/requisitions" element={<Requisitions />} />
```

### Dashboard.jsx Modification

Add a new glassmorphism module card in the `grid grid-cols-1 md:grid-cols-2` section (after the existing Project Management card):

```jsx
{/* Requisitions Module Card — visible to JE (creator), ZO/HO (approvers), Admin (oversight) */}
{['je', 'zo', 'ho', 'admin'].includes(user?.role) && (
  <div className="glass-panel glass-card-hover p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between min-h-[220px] glow-border-active shadow-[0_8px_32px_rgba(245,158,11,0.04)]">
    <div className="absolute top-0 right-0 p-5 opacity-[0.14]">
      {/* Receipt / document SVG icon */}
      <svg className="w-24 h-24 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </div>
    <div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Finance · Procurement</span>
      <h3 className="text-lg font-extrabold mt-1 text-slate-200">Requisition Management</h3>
      <p className="text-xs text-slate-400 font-normal mt-4 leading-relaxed">
        Raise and manage payment requisitions against work orders. Upload PDF documentation, declare GST status, and track approval by authority.
      </p>
    </div>
    <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-4">
      <span className="text-[9px] uppercase tracking-widest font-extrabold text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 px-2 py-0.5 rounded-lg">Active System</span>
      <Link
        to="/requisitions"
        className="px-4 py-2 rounded-xl text-xs font-bold uppercase bg-white text-slate-950 hover:bg-slate-100 hover:shadow-lg transition-all duration-300 flex items-center gap-1.5"
      >
        Open Requisitions &rarr;
      </Link>
    </div>
  </div>
)}
```

### Acceptance Criteria
```
✓ /requisitions route accessible to je, zo, ho, admin roles
✓ /requisitions route NOT accessible to staff role (403)
✓ Dashboard card visible to je, zo, ho, admin
✓ Dashboard card hidden from staff
✓ Navigation from Dashboard card to Requisitions page works
✓ JE lands on the creation/list view; ZO/HO land on the approver/pending view by default
```

---

## M7 — Test Suite — Phase 4

### Objective
Create comprehensive automated tests for all milestones following the pattern established in Phase 2 (`test_milestone5.js`) and Phase 3.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/tests/milestones/test_milestone_p4_m1.js` | **NEW** — DB schema |
| `backend/tests/milestones/test_milestone_p4_m2.js` | **NEW** — Core CRUD API |
| `backend/tests/milestones/test_milestone_p4_m3.js` | **NEW** — Workflow API |
| `backend/tests/milestones/test_milestone_p4_m4.js` | **NEW** — File upload (non-binary, path validation) |
| `backend/tests/milestones/test_milestone_p4_m5.js` | **NEW** — Security & CQ hardening verification |
| `backend/package.json` | **MODIFY** — add test scripts |

### `test_milestone_p4_m1.js` — DB Schema Verification

```javascript
// Tests:
// T1: requisitions table exists with all columns
// T2: requisition_status_enum has exactly 4 values
// T3: gst_bill_enum has exactly 2 values
// T4: Unique constraint on requisition_no
// T5: DELETE raises exception (prevent_hard_delete trigger)
// T6: audit_log entry created on status change (audit trigger)
// T7: updated_at auto-updated on UPDATE (trg_requisition_updated_at)
// T8: chk_gst_bill_pdf — gst_bill = 'Yes' requires gst_bill_pdf_url
// T9: chk_balance_amount — Approved record enforces balance integrity
// T10: FK constraint — invalid work_order_no rejected
// T11: FK constraint — invalid requester_user_id rejected
```

### `test_milestone_p4_m2.js` — Core CRUD API

```javascript
// All tests use mockRes() pattern from existing test files

// T1:  POST /requisitions — valid request, gst_bill = 'No' → 201, Pending
// T2:  POST /requisitions — duplicate requisition_no → 409
// T3:  POST /requisitions — blank requisition_no → 400
// T4:  POST /requisitions — requisition_amount = 0 → 400
// T5:  POST /requisitions — requisition_amount = -50 → 400
// T6:  POST /requisitions — gst_bill = 'Yes', no gst_bill_pdf_url → 400
// T7:  POST /requisitions — invalid work_order_no → 404
// T8:  POST /requisitions — path traversal in requisition_no → 400
// T9:  POST /requisitions — auto-fill fields match projects_master snapshot → verify all 6 fields
// T10: POST /requisitions — estimate_amount is null when no Final Approved estimate
// T11: GET /requisitions as 'je' — only own records returned
// T12: GET /requisitions as 'admin' — all records returned
// T13: GET /requisitions as 'ho' → 403
// T14: GET /requisitions/:id — non-owner → 404 (no ID leakage)
// T15: GET /requisitions/:id — admin → 200 regardless of owner
// T16: GET /requisitions?page=1&limit=3 — pagination structure correct
// T17: GET /requisitions?status=Pending — filter applied correctly
```

### `test_milestone_p4_m3.js` — Workflow API

```javascript
// T1:  Admin: action='Approve', approved_amount=8000, remarks='OK' → 200, Approved
//      Verify: approved_balance_amount = requisition_amount - 8000
//      Verify: approved_user_id and payment_date stamped
// T2:  Admin: action='Hold' → 200, Hold, NULL amount/balance/remarks
// T3:  Admin: action='Approve', approved_amount=0 → 400
// T4:  Admin: action='Approve', missing remarks → 400
// T5:  Admin: action on non-Pending → 403
// T6:  JE calling action endpoint → 403 (role guard)
// T7:  JE cancels own Pending → 200, Cancelled
// T8:  JE cancels own Approved → 403 (not Pending)
// T9:  JE cancels other JE's Pending → 403 (ownership)
// T10: Admin cancels any Pending (not own) → 200 (admin bypass)
// T11: Concurrent approve + hold on same requisition → 200 + 409
// T12: Verify DB CHECK: direct DB insert with wrong approved_balance_amount → constraint violation
```

### `test_milestone_p4_m4.js` — File Upload Validation

```javascript
// Note: Full binary upload testing is limited in the direct controller test approach.
// These tests verify filename sanitization, MIME type validation logic, and path construction.

// T1: sanitizeFilename('BP-01-15062026') → 'BP-01-15062026' (no change)
// T2: sanitizeFilename('../../../etc/passwd') → '______etc_passwd' (sanitized)
// T3: sanitizeFilename('test file (1).pdf') → 'test_file__1_.pdf'
// T4: Mock upload call with non-PDF MIME → 400
// T5: Mock upload call without requisition_no → 400
// T6: Mock upload call with valid PDF and requisition_no → 201 (if bucket accessible)
// T7: Verify signedUrl has expiry within 1 hour (decode JWT in URL)
```

### `test_milestone_p4_m5.js` — Security & CQ Verification

```javascript
// CQ-1: IDBP_FILTER_TEST_DATA env var present, no hardcoded mobiles in estimates.core.controller.js
//   → grep for 'legitMobiles' → assert not found
// CQ-2: IP extraction correctly uses x-forwarded-for split
//   → Verify auth.controller.js line logic (inspection test)
// CQ-5: createReport with amount='abc' → 400
//   → Mock createReport with amount='abc', assert statusCode 400
// CQ-6: JE with global=true → still only sees own records
//   → Call getEstimates with je role and global=true → assert all records belong to je
// CQ-7: updateUser with role='superuser' → 400
//   → Mock updateUser with role='superuser', assert statusCode 400
// CQ-9: OTP attempt increment uses optimistic lock
//   → Inspect otp.service.js for .eq('attempts', otpRequest.attempts) pattern
// SEC-4: TokenExpiredError → accessToken cookie cleared
//   → Inspect verifyJwt.js for clearCookie call in TokenExpiredError path
// SEC-5: removeUser with active Pending requisition → 409
//   → Create test user with Pending requisition → call removeUser → assert 409
// SEC-P4-1: Storage buckets are private
//   → Attempt fetch of known bucket path via public URL → assert 400/403
// SEC-P4-2: Non-PDF MIME blocked in upload controller
//   → Mock req.file with mimetype='image/jpeg' → assert 400
// SEC-P4-3: Path traversal sanitized
//   → sanitizeFilename('../../../etc') → assert no slashes or dots before letters
```

### package.json Additions

```json
{
  "scripts": {
    "test:p4:m1": "node tests/milestones/test_milestone_p4_m1.js",
    "test:p4:m2": "node tests/milestones/test_milestone_p4_m2.js",
    "test:p4:m3": "node tests/milestones/test_milestone_p4_m3.js",
    "test:p4:m4": "node tests/milestones/test_milestone_p4_m4.js",
    "test:p4:m5": "node tests/milestones/test_milestone_p4_m5.js",
    "test:p4:all": "node tests/milestones/test_milestone_p4_m1.js && node tests/milestones/test_milestone_p4_m2.js && node tests/milestones/test_milestone_p4_m3.js && node tests/milestones/test_milestone_p4_m4.js && node tests/milestones/test_milestone_p4_m5.js"
  }
}
```

### Exit Criteria
```
✓ All test files runnable: npm run test:p4:all exits 0
✓ Every test prints [PASS]
✓ Zero [FAIL] entries across all 5 test files
✓ Ready to begin M8
```

---

## M8 — UAT & Release Gate

### Objective
End-to-end manual verification by a real user (requester) and admin (approver) in the deployed staging environment. No code changes at this stage.

### UAT Scenarios

**Scenario 1 — JE creates a requisition within budget (with GST):**
1. JE logs in → navigates to Requisitions → clicks "New Requisition"
2. Selects Work Order No. from dropdown
3. Verifies: Estimate No., Estimate Amount, State, District, Area Code, Department, Site Details auto-populate
4. Verifies: Remaining Estimate Amount indicator shows (e.g., Estimate: ₹1,00,000 / Committed: ₹15,000 / Remaining: ₹85,000)
5. Enters unique Requisition NO: `BP-01-15062026`
6. Selects Material Main Head from dropdown
7. Uploads Requisition PDF — filename must be `BP-01-15062026.pdf`; confirms PDF preview opens
8. Enters Requisition Amount: ₹40,000 (within the ₹85,000 remaining balance)
9. Selects GST Bill = Yes → GST Bill upload field appears → uploads GST bill PDF
10. Enters bank details and remarks → saves
11. Verifies: requisition appears in list with status "Pending"

**Scenario 1b — JE exceeds remaining estimate amount:**
1. Same setup as Scenario 1, but enters Requisition Amount: ₹90,000 (exceeds the ₹85,000 remaining)
2. Frontend shows error immediately below the amount input: "Cannot exceed remaining balance of ₹85,000"
3. Submit button is disabled
4. If JE somehow bypasses frontend and submits → server returns 422 with full breakdown message

**Scenario 2 — ZO approves:**
1. ZO logs in → Requisitions → "Pending" tab
2. Sees JE's requisition → clicks "Take Action"
3. Selects `Approve_type = Approve`
4. Enters Approved Amount: ₹35,000
5. Verifies: Approved Balance Amount auto-displays ₹5,000 (Requisition ₹40,000 − ₹35,000)
6. Enters remarks → clicks "Save Approval (Approved)"
7. Verifies: requisition status changes to "Approved", moves to All tab

**Scenario 3 — HO holds:**
1. Create another Pending requisition as JE
2. HO logs in → Requisitions → Pending tab
3. HO clicks "Take Action" → selects `Hold`
4. Verifies: Approved Amount and Remarks fields are HIDDEN (not just greyed)
5. Clicks "Save Approval (Hold)"
6. Verifies: status = "Hold"

**Scenario 4 — JE cancels own Pending:**
1. Create another Pending requisition as JE
2. JE clicks Cancel on their own record → confirmation dialog appears → confirms
3. Verifies: status = "Cancelled"
4. Cancellation button no longer visible
5. That cancelled requisition's amount is EXCLUDED from the Remaining Balance calculation

**Scenario 5 — Duplicate requisition NO rejected:**
1. Attempt to create a second requisition with same Requisition NO
2. Server returns 409 error message displayed in form

**Scenario 6 — PDF file name mismatch:**
1. Enter Requisition NO: `BP-01-TEST`
2. Attempt to upload PDF named `BP-02-WRONG.pdf`
3. Frontend validation triggers: "File name must match Requisition No. exactly: BP-01-TEST.pdf"

**Scenario 7 — Role boundaries enforcement:**
1. ZO logs in → clicks "New Requisition" button: Expected — button is hidden/absent for ZO
2. JE logs in → sees a Pending requisition → "Take Action" button: Expected — button is hidden/absent for JE
3. ZO logs in → tries to cancel a Pending requisition: Expected — no cancel button; direct API call returns 403
4. Staff user logs in → navigates to `/requisitions` directly: Expected — 403 error page or redirect

### Release Checklist
```
✓ All 7 UAT scenarios (including 1b) pass
✓ No P1 or P2 defects open
✓ Migration 20 applied to production DB
✓ Supabase Storage buckets created and private in production
✓ IDBP_FILTER_TEST_DATA=true set in production .env
✓ All hardening fixes from M5 deployed
✓ Server starts cleanly: npm start logs no errors
✓ Frontend builds cleanly: npm run build exits 0
✓ Phase 4 sign-off obtained from stakeholder
```

---

## Migration Sequence

All migrations are idempotent and must be run in order:

| Step | File | Notes |
|---|---|---|
| 20 | `20_create_requisitions.sql` | New table, enums, indexes, triggers, CHECK constraints |

**Pre-flight check before applying migration:**
```sql
-- Verify migration 19 was applied
SELECT table_name FROM information_schema.tables WHERE table_name = 'fund_requests';
-- Expected: 1 row

-- Check existing enum types to avoid conflicts
SELECT typname FROM pg_type WHERE typname IN ('requisition_status_enum', 'gst_bill_enum');
-- Expected: 0 rows (not yet created)
```

---

## File Inventory (Complete)

| File | Action | Component |
|---|---|---|
| `backend/src/db/migrations/20_create_requisitions.sql` | **NEW** | M1 — DB |
| `backend/src/controllers/requisitions.controller.js` | **NEW** | M2, M3 — API |
| `backend/src/controllers/requisitions.uploads.controller.js` | **NEW** | M4 — Uploads |
| `backend/src/routes/requisitions.routes.js` | **NEW** | M2, M3, M4 — Routes |
| `backend/src/app.js` | **MODIFY** — add mount + SEC-1 comment | M2, M5 |
| `backend/src/controllers/estimates.core.controller.js` | **MODIFY** — CQ-1, CQ-6 | M5 — Hardening |
| `backend/src/controllers/auth.controller.js` | **MODIFY** — CQ-2 | M5 — Hardening |
| `backend/src/services/session.service.js` | **MODIFY** — CQ-3, SEC-3 | M5 — Hardening |
| `backend/src/middleware/verifyJwt.js` | **MODIFY** — CQ-4, SEC-4 | M5 — Hardening |
| `backend/src/controllers/reports.controller.js` | **MODIFY** — CQ-5 | M5 — Hardening |
| `backend/src/controllers/admin.controller.js` | **MODIFY** — CQ-7, SEC-5 | M5 — Hardening |
| `backend/src/middleware/rateLimiter.js` | **MODIFY** — CQ-8 comment | M5 — Hardening |
| `backend/src/services/otp.service.js` | **MODIFY** — CQ-9 | M5 — Hardening |
| `backend/src/services/telegram.service.js` | **MODIFY** — CQ-10 comment | M5 — Hardening |
| All controller catch blocks | **MODIFY** — CQ-12 stack traces | M5 — Hardening |
| `.env.example` | **MODIFY** — add IDBP_FILTER_TEST_DATA | M5 — Hardening |
| `frontend/src/pages/Requisitions.jsx` | **NEW** | M6a, M6b |
| `frontend/src/api/requisitionsApi.js` | **NEW** | M6a |
| `frontend/src/App.jsx` | **MODIFY** — add route | M6c |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add nav card | M6c |
| `backend/tests/milestones/test_milestone_p4_m1.js` | **NEW** | M7 — Tests |
| `backend/tests/milestones/test_milestone_p4_m2.js` | **NEW** | M7 — Tests |
| `backend/tests/milestones/test_milestone_p4_m3.js` | **NEW** | M7 — Tests |
| `backend/tests/milestones/test_milestone_p4_m4.js` | **NEW** | M7 — Tests |
| `backend/tests/milestones/test_milestone_p4_m5.js` | **NEW** | M7 — Tests |
| `backend/package.json` | **MODIFY** — test scripts + multer dep | M4, M7 |

---

## Dependency Graph

```
M1 (DB)
 └─► M2 (Core CRUD API)
      └─► M3 (Workflow API)
           └─► M4 (File Upload API)
                └─► M6a (Frontend Entry Form)
                     └─► M6b (Frontend Approver View)
                          └─► M6c (Dashboard Integration)

M5 (Hardening) — Independent, can run alongside M2/M3/M4

All of M1-M6c → M7 (Tests) → M8 (UAT)
```
