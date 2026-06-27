# Phase 6: RA / Final Bill Entry Module — Implementation Plan

> **Status:** ✅ Approved — Ready for execution.
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Builds on:** Phase 1–5 (auth · projects · estimates · fund requests · requisitions · daily progress)
> **Reference:** RA / Final Bill Entry Process Flow Diagram + Type-of-Payment Dropdown (RA Bill 1–N, Final Bill)

---

## Background & Scope

Phase 6 introduces the **RA / Final Bill Entry Module** — a structured billing data entry system for work orders managed by Head Office (HO), Zonal Office (ZO), and Admin users. Contractors submit RA (Running Account) Bills periodically throughout a work order's lifetime. When all work is complete, a single **Final Bill** is raised.

Key design decisions from the provided diagrams:

1. **Type of Payment is dynamically extensible** — the dropdown must accommodate "RA Bill 1", "RA Bill 2" … "RA Bill N" (no fixed upper limit — the system derives available RA bill numbers automatically by looking at what has already been entered for the work order) **plus** "Final Bill". A work order may have 10, 11, or more RA Bills before the Final Bill.
2. **Access is restricted** — only `ho`, `zo`, and `admin` roles may enter bills. JE and Staff cannot access this screen at all.
3. **No approval workflow** — records are saved directly. No state machine. Data is immediately available for reports.
4. **Bill Copy is mandatory** — PDF, JPG, JPEG, or PNG, max 5MB. Stored in a private Supabase Storage bucket.
5. **Summary is auto-calculated** — Total Work Order Value, Previous Bill Amount, Current Bill Amount, Total Billed Till Date, Balance Amount are all derived server-side or client-side from existing data.

### What Phase 6 delivers

| Actor | Action |
|---|---|
| **HO / ZO / Admin** | Creates RA/Final bill entries against any work order. Uploads mandatory bill copy. Views all bill entries (list + detail). |
| **JE / Staff** | **Cannot access** this screen (403 on all endpoints). |
| **System** | Auto-fetches work order metadata. Calculates Previous Bill Amount from existing entries. Generates signed URLs for bill copy downloads. Audits every INSERT. |

### What Phase 6 does NOT change
- Daily progress module (Phase 5) is untouched.
- Requisitions (Phase 4) are independent.
- Fund requests (Phase 3) are independent.
- Auth, sessions, OTP, and user management are unchanged.

---

## Role Architecture

| Role | Phase 6 Responsibility |
|---|---|
| `ho` | **Full access** — create, view all bill entries |
| `zo` | **Full access** — create, view all bill entries |
| `admin` | **Full access** — create, view all bill entries |
| `je` | **No access** — 403 on all endpoints |
| `staff` | **No access** — 403 on all endpoints |

> [!IMPORTANT]
> **Role boundaries are firm:**
> - Only `ho`, `zo`, `admin` can create or view bill entries.
> - No delete endpoint is exposed. Hard deletes are blocked by DB trigger.
> - Records are permanently immutable once saved (no PATCH endpoint for bill entries).
> - The bill copy upload endpoint is also restricted to `ho`, `zo`, `admin`.

---

## Key Design Decisions

> [!NOTE]
> **Q1 — How does "Type of Payment" dynamic generation work?**
> **Resolution:** When a user selects a Work Order, the frontend calls a dedicated endpoint that returns:
> (a) All existing bill entries for that work order (to know which RA Bill numbers are already used), and
> (b) Whether a Final Bill already exists (to prevent duplicate Final Bill).
> The dropdown is then built as: "RA Bill {max_existing + 1}" (the next available number) + all previously used numbers (greyed-out / for reference) + "Final Bill" (disabled if one already exists).
> **This means:** if RA Bills 1–9 exist, the dropdown offers "RA Bill 10" as the next entry. The user cannot re-enter an already-entered RA Bill number.

> [!NOTE]
> **Q2 — How is "Previous Bill Amount" computed?**
> **Resolution:** On the frontend (and validated server-side), Previous Bill Amount = sum of all `bill_amount_with_gst` for the same `work_order_no` already stored in `ra_final_bills`. This is fetched from the API when the Work Order is selected.

> [!NOTE]
> **Q3 — What is "Total Work Order Value"?**
> **Resolution:** Fetched from `projects_master.work_order_value` (already stored in the table from Phase 2). Auto-filled read-only on WO selection.

> [!NOTE]
> **Q4 — Can a Final Bill be entered if no RA Bills exist?**
> **Resolution:** YES — a Final Bill can be entered directly without any prior RA Bills (e.g., single-bill projects). No constraint enforcing prior RA Bills.

> [!NOTE]
> **Q5 — What is the Supabase Storage bucket name?**
> **Resolution:** `ra-bill-copies` — private bucket. Signed URLs (TTL: 1 hour) generated at read time.

> [!NOTE]
> **Q6 — File types accepted for bill copy?**
> **Resolution:** PDF, JPG, JPEG, PNG — max 5MB. Same pattern as requisitions PDF upload. MIME type validated server-side (not just extension).

> [!NOTE]
> **Q7 — Can there be duplicate bill entries (same WO + same bill type)?**
> **Resolution:** NO — a `UNIQUE` constraint on `(work_order_no, payment_type)` prevents duplicate entries for the same bill type on the same work order. This is enforced at DB level and caught in the controller.

---

## Proposed Changes

---

### Component 1 — Database Migration

#### [NEW] `backend/src/db/migrations/23_create_ra_final_bills.sql`

Migration number `23` follows `22_create_increment_otp_attempts_rpc.sql`.

**Table `ra_final_bills`:**

| Column | Type | Notes |
|---|---|---|
| `bill_id` | UUID PK | Auto-generated |
| `created_by` | VARCHAR FK → authorised_users | Auto from session (mobile_number) |
| `login_date` | TIMESTAMPTZ | Auto — server timestamp at creation |
| `work_order_no` | VARCHAR FK → projects_master | Required — selected by user |
| `state` | VARCHAR | Frozen snapshot from projects_master |
| `district` | VARCHAR | Frozen snapshot from projects_master |
| `area_code` | VARCHAR | Frozen snapshot (maps to `zone` column) |
| `department` | VARCHAR | Frozen snapshot from projects_master |
| `site_details` | TEXT | Frozen snapshot from projects_master |
| `payment_type` | VARCHAR | e.g. "RA Bill 1", "RA Bill 9", "Final Bill" |
| `bill_date` | DATE | Required — user-entered |
| `bill_no` | VARCHAR | Required — user-entered bill reference number |
| `bill_amount_with_gst` | NUMERIC(18,2) | Required — positive |
| `earnest_money_deposit` | NUMERIC(18,2) | Optional — defaults to 0 |
| `security_deposit_amount` | NUMERIC(18,2) | Optional — defaults to 0 |
| `bill_copy_url` | TEXT | Required — storage path in private bucket |
| `original_bill_filename` | VARCHAR | Optional — original filename for display |
| `remarks` | TEXT | Optional |
| `created_at` | TIMESTAMPTZ | Auto |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

**Constraints:**
- `UNIQUE (work_order_no, payment_type)` — one entry per payment type per work order.
- `CHECK (bill_amount_with_gst > 0)` — positive amount required.
- `CHECK (earnest_money_deposit >= 0)` — non-negative.
- `CHECK (security_deposit_amount >= 0)` — non-negative.
- `CHECK (payment_type ~ '^(RA Bill [1-9][0-9]*|Final Bill)$')` — enforces valid format at DB level.

**Indexes:**
- `idx_ra_final_bills_work_order` — on `work_order_no` (primary lookup)
- `idx_ra_final_bills_created_by` — on `created_by` (user's own records)
- `idx_ra_final_bills_bill_date` — on `bill_date DESC` (date range filtering)

**Triggers:**
- `trg_ra_final_bills_updated_at` — auto-updates `updated_at` on any UPDATE
- `trg_prevent_ra_final_bills_hard_delete` — RAISE EXCEPTION on hard DELETE
- `trg_audit_ra_final_bills_insert` — logs every INSERT to `audit_log` with `action = 'CREATE'`, `module_name = 'RAFinalBill'`

**Full SQL:**

```sql
-- ===========================================================================
-- Migration 23: Phase 6 — RA / Final Bill Entry
-- PREREQUISITE: Migrations 01–22 must have been applied.
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ra_final_bills table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ra_final_bills (
  bill_id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Creator identity (auto-populated from session)
  created_by                   VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  login_date                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Work Order linkage (geo-metadata snapshot stored at creation time)
  work_order_no                VARCHAR NOT NULL REFERENCES projects_master(work_order_no) ON DELETE RESTRICT,

  -- Frozen geographic metadata (snapshot from projects_master at creation time)
  state                        VARCHAR NOT NULL,
  district                     VARCHAR NOT NULL,
  area_code                    VARCHAR NOT NULL,        -- maps to projects_master.zone
  department                   VARCHAR NOT NULL,
  site_details                 TEXT NOT NULL,

  -- Bill classification
  payment_type                 VARCHAR NOT NULL,       -- "RA Bill 1", "RA Bill 9", "Final Bill"

  -- User-entered bill fields
  bill_date                    DATE NOT NULL,
  bill_no                      VARCHAR NOT NULL,
  bill_amount_with_gst         NUMERIC(18,2) NOT NULL,
  earnest_money_deposit        NUMERIC(18,2) NOT NULL DEFAULT 0,
  security_deposit_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,

  -- Bill copy storage
  bill_copy_url                TEXT NOT NULL,          -- Storage path in 'ra-bill-copies' bucket
  original_bill_filename       VARCHAR,                -- Original filename for UI display

  -- Optional remarks
  remarks                      TEXT,

  -- Constraints
  CONSTRAINT uq_bill_per_payment_type     UNIQUE (work_order_no, payment_type),
  CONSTRAINT chk_bill_amount_positive     CHECK (bill_amount_with_gst > 0),
  CONSTRAINT chk_emd_non_negative         CHECK (earnest_money_deposit >= 0),
  CONSTRAINT chk_sd_non_negative          CHECK (security_deposit_amount >= 0),
  CONSTRAINT chk_payment_type_format
    CHECK (payment_type ~ '^(RA Bill [1-9][0-9]*|Final Bill)$'),

  -- Audit fields
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes for performance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ra_final_bills_work_order
  ON ra_final_bills(work_order_no);

CREATE INDEX IF NOT EXISTS idx_ra_final_bills_created_by
  ON ra_final_bills(created_by);

CREATE INDEX IF NOT EXISTS idx_ra_final_bills_bill_date
  ON ra_final_bills(bill_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: auto-update updated_at
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_ra_final_bills_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ra_final_bills_updated_at ON ra_final_bills;
CREATE TRIGGER trg_ra_final_bills_updated_at
BEFORE UPDATE ON ra_final_bills
FOR EACH ROW EXECUTE FUNCTION set_ra_final_bills_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: block hard DELETE (records are permanent financial records)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_ra_final_bills_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of RA/Final bill records is permanently prohibited. Records are immutable financial documents.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ra_final_bills_hard_delete ON ra_final_bills;
CREATE TRIGGER trg_prevent_ra_final_bills_hard_delete
BEFORE DELETE ON ra_final_bills
FOR EACH ROW EXECUTE FUNCTION prevent_ra_final_bills_hard_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: audit log on INSERT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_ra_final_bill_insert()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_ra_final_bill_insert ON ra_final_bills;
CREATE TRIGGER trg_audit_ra_final_bill_insert
AFTER INSERT ON ra_final_bills
FOR EACH ROW EXECUTE FUNCTION audit_ra_final_bill_insert();
```

**Supabase Storage Bucket (Manual step in Dashboard):**

| Bucket Name | Access | Notes |
|---|---|---|
| `ra-bill-copies` | **Private** | Stores bill copies uploaded by HO/ZO/Admin |

> [!IMPORTANT]
> The bucket MUST be set to **private** in the Supabase Dashboard. Signed URLs (TTL: 1 hour) generated at read time only. Do NOT make this bucket public.

**Acceptance Criteria:**
```
✓ ra_final_bills table exists with all columns
✓ UNIQUE constraint on (work_order_no, payment_type) enforced
✓ CHECK chk_bill_amount_positive enforced (> 0)
✓ CHECK chk_emd_non_negative enforced (>= 0)
✓ CHECK chk_sd_non_negative enforced (>= 0)
✓ CHECK chk_payment_type_format enforced (regex)
✓ 3 indexes created
✓ trg_ra_final_bills_updated_at fires on UPDATE (updated_at changes)
✓ trg_prevent_ra_final_bills_hard_delete raises exception on DELETE
✓ trg_audit_ra_final_bill_insert inserts into audit_log on INSERT
✓ Supabase Storage bucket 'ra-bill-copies' created and set to private
```

---

### Component 2 — Backend API

#### [NEW] `backend/src/validation/raFinalBill.schema.js`

Zod schemas for all RA/Final Bill endpoints.

```javascript
'use strict';

const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid bill ID.');

// payment_type must be "RA Bill N" (N >= 1) or "Final Bill"
const paymentTypeRegex = /^(RA Bill [1-9][0-9]*|Final Bill)$/;

const createBillSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' })
      .trim().min(1, 'work_order_no is required.'),

    payment_type: z.string({ required_error: 'payment_type is required.' })
      .trim()
      .regex(paymentTypeRegex, "payment_type must be 'RA Bill N' (N ≥ 1) or 'Final Bill'."),

    bill_date: z.string({ required_error: 'bill_date is required.' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'bill_date must be a valid date in YYYY-MM-DD format.'),

    bill_no: z.string({ required_error: 'bill_no is required.' })
      .trim().min(1, 'bill_no is required.'),

    bill_amount_with_gst: z.union([z.number(), z.string()], {
      required_error: 'bill_amount_with_gst must be a positive number.'
    })
      .transform(val => Number(val))
      .refine(val => !isNaN(val) && val > 0 && isFinite(val),
        'bill_amount_with_gst must be a positive number greater than zero.'),

    earnest_money_deposit: z.union([z.number(), z.string()])
      .transform(val => Number(val))
      .refine(val => !isNaN(val) && val >= 0 && isFinite(val),
        'earnest_money_deposit must be zero or a positive number.')
      .optional()
      .default(0),

    security_deposit_amount: z.union([z.number(), z.string()])
      .transform(val => Number(val))
      .refine(val => !isNaN(val) && val >= 0 && isFinite(val),
        'security_deposit_amount must be zero or a positive number.')
      .optional()
      .default(0),

    bill_copy_url: z.string({ required_error: 'bill_copy_url is required. Upload the bill copy first.' })
      .trim().min(1, 'bill_copy_url is required. Upload the bill copy first.'),

    original_bill_filename: z.string().optional().nullable(),

    remarks: z.string().optional().nullable()
  })
};

const getBillByIdSchema = {
  params: z.object({ id: uuidSchema })
};

module.exports = {
  createBillSchema,
  getBillByIdSchema
};
```

---

#### [NEW] `backend/src/controllers/raFinalBill.controller.js`

Three controller functions:

| Function | Method | Path | Access | Description |
|---|---|---|---|---|
| `createBill` | POST | `/` | `ho`, `zo`, `admin` | Create a new RA/Final bill entry |
| `getBills` | GET | `/` | `ho`, `zo`, `admin` | List bills (paginated, filterable) |
| `getBillById` | GET | `/:id` | `ho`, `zo`, `admin` | Single bill detail with signed URL |
| `getBillSummaryByWorkOrder` | GET | `/summary/:work_order_no` | `ho`, `zo`, `admin` | Summary + next available RA bill number |

##### `createBill(req, res)` — `POST /api/v1/auth/ra-final-bills`

**Access:** `['ho', 'zo', 'admin']`

```
1. Input validation: validateRequest(createBillSchema)

2. Validate work_order_no exists in projects_master:
   SELECT work_order_value, status, state, district, zone, department, site_details
   FROM projects_master WHERE work_order_no = $1
   → 404 if not found
   → 403 if status = 'Closed': "Bills cannot be entered for Closed work orders."

3. Check for duplicate: SELECT COUNT(*) FROM ra_final_bills
   WHERE work_order_no = $1 AND payment_type = $2
   → 409 if already exists: "A '{payment_type}' entry already exists for this work order."

4. Validate payment_type sequence (server-side):
   - Fetch all existing payment_types for this work_order_no
   - If payment_type is "RA Bill N" (N > 1):
     → Verify "RA Bill (N-1)" already exists. If not:
     → 422: "RA Bill {N-1} must be entered before RA Bill {N}."
   - This prevents gaps (e.g., jumping from RA Bill 1 to RA Bill 3).

5. Build insert payload with frozen geo-snapshot from projects_master.

6. Insert into ra_final_bills.

7. Return 201: { success: true, bill: { ...created_row } }
```

##### `getBills(req, res)` — `GET /api/v1/auth/ra-final-bills`

**Access:** `['ho', 'zo', 'admin']`

```
Query params:
  page           (default 1)
  limit          (default 50, max 100)
  work_order_no  (optional filter)
  date_from      (optional ISO date filter on bill_date)
  date_to        (optional ISO date filter on bill_date)
  payment_type   (optional — "RA Bill 1", "Final Bill", etc.)

Order: bill_date DESC, created_at DESC
Paginate: RANGE(offset, offset+limit-1) with count: 'exact'
Resolve created_by display names from authorised_users.
Return: { success, bills, pagination }
NOTE: bill_copy_url in list view is raw storage path — no signed URL.
```

##### `getBillById(req, res)` — `GET /api/v1/auth/ra-final-bills/:id`

**Access:** `['ho', 'zo', 'admin']`

```
1. Validate bill_id as valid UUID → 400 if invalid.
2. Fetch bill from ra_final_bills → 404 if not found.
3. Resolve created_by display name.
4. Generate fresh signed URL for bill_copy_url:
   supabase.storage.from('ra-bill-copies').createSignedUrl(path, 3600)
   → Include as bill_copy_signed_url in response.
   → If URL generation fails, return bill_copy_signed_url: null (don't block response).
5. Return enriched bill object.
```

##### `getBillSummaryByWorkOrder(req, res)` — `GET /api/v1/auth/ra-final-bills/summary/:work_order_no`

**Access:** `['ho', 'zo', 'admin']`

```
1. Validate work_order_no exists in projects_master.
2. Fetch projects_master.work_order_value.
3. Fetch all existing ra_final_bills for this work_order_no.
4. Compute:
   - existing_payment_types: array of payment_type strings
   - previous_bill_amount: SUM of bill_amount_with_gst for all existing entries
   - final_bill_exists: boolean
   - next_ra_bill_number: max existing RA Bill number + 1
   - next_payment_type: "RA Bill {next_ra_bill_number}" (or null if Final Bill exists and no more RA allowed)
5. Return:
   {
     success: true,
     work_order_value,
     previous_bill_amount,
     existing_payment_types,
     next_ra_bill_number,
     final_bill_exists,
     dropdown_options: [
       "RA Bill {next_ra_bill_number}",   // only if Final Bill not yet entered
       "Final Bill"                        // disabled if final_bill_exists
     ]
   }
```

---

#### [NEW] `backend/src/controllers/raFinalBill.uploads.controller.js`

Handles Supabase Storage bill copy upload.

| Function | Method | Path | Access | Description |
|---|---|---|---|---|
| `uploadBillCopy` | POST | `/upload/bill-copy` | `ho`, `zo`, `admin` | Upload a bill copy file |

```
uploadBillCopy(req, res):
  1. Expect multipart/form-data with a single file field named 'file'.
  2. Validate MIME type: must be one of:
     image/jpeg, image/jpg (alias), image/png, application/pdf
     → 400: "Only PDF, JPG, JPEG, or PNG files are accepted."
  3. Validate file size: must be ≤ 5MB (5 * 1024 * 1024 bytes)
     → 400: "File size must not exceed 5MB."
  4. Generate storage path: ra-bill-copies/{uuid}.{ext}
     where uuid = uuidv4() and ext is derived from MIME type.
  5. Upload to Supabase Storage:
     supabase.storage.from('ra-bill-copies').upload(path, buffer, { contentType: mimetype, upsert: false })
  6. Return 200: { success: true, bill_copy_url: storagePath, original_filename: originalname }

NOTE: The returned bill_copy_url is the relative storage path, NOT a signed URL.
The signed URL is generated at read time (getBillById).
```

---

#### [NEW] `backend/src/routes/raFinalBill.routes.js`

```javascript
'use strict';

const express = require('express');
const {
  createBill,
  getBills,
  getBillById,
  getBillSummaryByWorkOrder
} = require('../controllers/raFinalBill.controller');
const { uploadBillCopy } = require('../controllers/raFinalBill.uploads.controller');
const verifyJwt   = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const { validateRequest } = require('../middleware/validateRequest');
const {
  createBillSchema,
  getBillByIdSchema
} = require('../validation/raFinalBill.schema');
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }  // 5MB
});

router.use(verifyJwt);

const authorisedRoles = ['ho', 'zo', 'admin'];

// Bill CRUD
router.post('/',
  requireRole(authorisedRoles),
  validateRequest(createBillSchema),
  createBill);

router.get('/',
  requireRole(authorisedRoles),
  getBills);

// Summary endpoint — MUST come before /:id to avoid route shadowing
router.get('/summary/:work_order_no',
  requireRole(authorisedRoles),
  getBillSummaryByWorkOrder);

router.get('/:id',
  requireRole(authorisedRoles),
  validateRequest(getBillByIdSchema),
  getBillById);

// Bill copy upload
router.post('/upload/bill-copy',
  requireRole(authorisedRoles),
  upload.single('file'),
  uploadBillCopy);

module.exports = router;
```

> [!IMPORTANT]
> The `/summary/:work_order_no` route MUST be registered **before** `/:id` in the router to prevent Express from interpreting "summary" as a UUID parameter.

---

#### [MODIFY] `backend/src/app.js`

Add the new route mount after the existing `dailyProgressRoutes` mount:

```javascript
const raFinalBillRoutes = require('./routes/raFinalBill.routes');
// ...
app.use('/api/v1/auth/ra-final-bills', raFinalBillRoutes);
```

---

### Component 3 — Frontend

#### [NEW] `frontend/src/pages/RAFinalBill.jsx`

A full-featured RA/Final Bill Entry page, accessible only to `ho`, `zo`, `admin`.

**Page Structure:**

1. **Header Section** — Page title "RA / Final Bill Entry" with breadcrumb + access badge.
2. **List View** (default) — Table of all RA/Final bills with filters.
3. **Create Form Panel** — Full-width form panel (matching the screen design from the shared image).

**List View:**
- Columns: Work Order No, Type of Payment, Bill Date, Bill No, Bill Amount (with GST), Uploaded By, Created Date, Actions (View).
- Filters: Work Order No, Payment Type dropdown, Date From/To.
- Pagination controls.
- "New Bill Entry" button (green) → opens create form.

**Create Form Fields (exactly matching the process flow diagram):**

Section 1 — PROJECT DETAILS (Auto Fetch from Work Order):
- `Work Order No` — searchable dropdown, fetches all projects. On change → auto-populates below.
- `State` — read-only auto.
- `District` — read-only auto.
- `Area Code` — read-only auto.
- `Department` — read-only auto.
- `Site Details` — read-only auto (textarea).

Section 2 — BILL DETAILS:
- `Type of Payment` — dynamic dropdown (fetched from `/summary/:work_order_no`):
  - Available option: "RA Bill {next_number}" (e.g. "RA Bill 10")
  - "Final Bill" — shown but disabled if `final_bill_exists = true`
  - Both shown as available options, user picks one
  - **Important UX:** If no WO is selected, dropdown shows placeholder "-- Select Work Order First --"
- `Bill Date` — date picker (required, DD/MM/YYYY display, YYYY-MM-DD stored).
- `Bill No` — text input (required).
- `Bill Amount With GST` — numeric input with ₹ prefix (required, > 0).
- `Earnest Money Deposit` — numeric input with ₹ prefix (optional, defaults to 0).
- `Security Deposit Amount` — numeric input with ₹ prefix (optional, defaults to 0).
- `Upload Bill Copy` — file input (PDF/JPG/JPEG/PNG, max 5MB). Shows filename + file type icon after upload. Two-step: first upload the file → get `bill_copy_url`, then include in form submit.
- `Remarks` — textarea (optional).

Section 3 — SUMMARY (Auto Calculated):
- `Total Work Order Value` — ₹ from `projects_master.work_order_value`
- `Previous Bill Amount` — ₹ sum of prior bills for this WO
- `Current Bill Amount` — ₹ live mirror of entered `bill_amount_with_gst`
- `Total Billed Till Date` — ₹ Previous + Current (live computed)
- `Balance Amount` — ₹ Total WO Value − Total Billed Till Date (live computed, shown in red if negative)

**Action Buttons:**
- `SAVE DRAFT` (green) → validates + submits
- `RESET` (orange) → resets form fields (keeping WO selected)
- `CANCEL` (red) → navigates back to list

**Detail View (read-only panel/modal on list row click):**
- All bill fields displayed.
- Bill copy shown as a download/view link using signed URL.
- Created By, Created Date shown at footer.

---

#### [NEW] `frontend/src/api/raFinalBillApi.js`

```javascript
import authApi from './authApi';

// Bill CRUD
export const createBill             = (data)           => authApi.post('/ra-final-bills', data);
export const getBills               = (params)         => authApi.get('/ra-final-bills', { params });
export const getBillById            = (id)             => authApi.get(`/ra-final-bills/${id}`);
export const getBillSummary         = (work_order_no)  => authApi.get(`/ra-final-bills/summary/${encodeURIComponent(work_order_no)}`);

// Bill copy upload
export const uploadBillCopy = (formData) =>
  authApi.post('/ra-final-bills/upload/bill-copy', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
```

---

#### [MODIFY] `frontend/src/App.jsx`

Add the `RAFinalBill` page route inside the existing `['zo', 'ho', 'admin']` protected route group:

```jsx
import RAFinalBill from './pages/RAFinalBill';
// ...
<Route element={<ProtectedRoute allowedRoles={['zo', 'ho', 'admin']} />}>
  <Route path="/ra-final-bills" element={<RAFinalBill />} />
</Route>
```

---

#### [MODIFY] `frontend/src/pages/Dashboard.jsx`

Add a new module card for "RA / Final Bill Entry" — visible to `ho`, `zo`, `admin` only. Use the existing `glass-panel glass-card-hover` pattern with a blue/indigo color accent to differentiate from existing modules.

---

### Component 4 — Security Considerations (Phase 6 Specific)

| # | Concern | Severity | Resolution |
|---|---|---|---|
| SEC-P6-1 | **Role enforcement** — JE and Staff must be completely blocked | **HIGH** | `requireRole(['ho', 'zo', 'admin'])` on every route, including upload. 403 returned for unauthorized roles. |
| SEC-P6-2 | **File MIME type enforcement** — bill copy must be a real PDF/image, not disguised | **HIGH** | Server-side MIME validation in `uploadBillCopy` controller. Extension-only validation is insufficient. |
| SEC-P6-3 | **File size limit** — 5MB max enforced at two layers | **HIGH** | Multer `limits.fileSize` + controller re-validation. |
| SEC-P6-4 | **Private bucket** — `ra-bill-copies` must never be publicly readable | **HIGH** | Private bucket configured in Supabase Dashboard. Signed URLs (TTL 1hr) at read time only. |
| SEC-P6-5 | **Duplicate bill prevention** — `UNIQUE (work_order_no, payment_type)` | **HIGH** | DB constraint + 409 response in controller. Also pre-checked before insert. |
| SEC-P6-6 | **payment_type regex** — prevents malformed strings reaching DB | **MEDIUM** | Zod regex validation + DB CHECK constraint (defence in depth). |
| SEC-P6-7 | **Sequential RA Bill enforcement** — prevents gaps in bill sequence | **MEDIUM** | Server-side check in `createBill`: "RA Bill N-1" must exist before "RA Bill N" is accepted. |
| SEC-P6-8 | **Closed work order guard** — bills must not be entered for Closed WOs | **MEDIUM** | Controller checks `projects_master.status` before insert. 403 if Closed. |
| SEC-P6-9 | **Storage path traversal** — bill copy paths use UUID-based names server-side | **MEDIUM** | Path is `{uuidv4()}.{safe_ext}` — user-supplied filename stored separately as `original_bill_filename` only. |
| SEC-P6-10 | **Bill immutability** — no PATCH exposed; DB trigger blocks DELETE | **MEDIUM** | No PATCH endpoint. `trg_prevent_ra_final_bills_hard_delete` raises exception. |
| SEC-P6-11 | **Numeric overflow** — bill amounts use NUMERIC(18,2) | **LOW** | DB column type enforces precision. Zod validates type before insertion. |

---

## Verification Plan

### Automated Tests

New milestone test files in `backend/tests/milestones/`:

- `test_milestone_p6_m1.js` — DB schema verification (table, indexes, triggers, constraints)
- `test_milestone_p6_m2.js` — API CRUD tests (create bill, list, get by ID, summary endpoint)
- `test_milestone_p6_m3.js` — Business rule tests (duplicate prevention, sequential RA bill enforcement, Closed WO guard)
- `test_milestone_p6_m4.js` — File upload validation tests (MIME, size, path safety, role restriction)

**`package.json` additions:**
```json
"test:p6:m1": "node tests/milestones/test_milestone_p6_m1.js",
"test:p6:m2": "node tests/milestones/test_milestone_p6_m2.js",
"test:p6:m3": "node tests/milestones/test_milestone_p6_m3.js",
"test:p6:m4": "node tests/milestones/test_milestone_p6_m4.js",
"test:p6:all": "node tests/milestones/test_milestone_p6_m1.js && node tests/milestones/test_milestone_p6_m2.js && node tests/milestones/test_milestone_p6_m3.js && node tests/milestones/test_milestone_p6_m4.js"
```

**M1 — DB Schema Tests:**
- Test 1: Insert a bill row with all required fields. Expected: row inserted, `audit_log` has `CREATE` entry.
- Test 2: Attempt `DELETE FROM ra_final_bills WHERE bill_id = <any>`. Expected: exception raised.
- Test 3: Update any field. Expected: `updated_at` automatically updated.
- Test 4: Insert with `bill_amount_with_gst = 0`. Expected: CHECK constraint violation.
- Test 5: Insert with `bill_amount_with_gst = -100`. Expected: CHECK constraint violation.
- Test 6: Insert with `earnest_money_deposit = -1`. Expected: CHECK constraint violation.
- Test 7: Insert with `payment_type = "RA Bill 0"`. Expected: CHECK constraint violation.
- Test 8: Insert with `payment_type = "ra bill 1"`. Expected: CHECK constraint violation (case-sensitive).
- Test 9: Insert same `(work_order_no, payment_type)` twice. Expected: UNIQUE constraint violation.

**M2 — API CRUD Tests:**
- Test 1: `POST /ra-final-bills` as `ho` with all valid fields. Expected: 201, geo-fields auto-populated.
- Test 2: `POST /ra-final-bills` as `je`. Expected: 403 — unauthorized role.
- Test 3: `POST /ra-final-bills` as `staff`. Expected: 403 — unauthorized role.
- Test 4: `POST /ra-final-bills` with missing `bill_copy_url`. Expected: 400.
- Test 5: `POST /ra-final-bills` with `bill_amount_with_gst = 0`. Expected: 400.
- Test 6: `POST /ra-final-bills` with invalid `work_order_no`. Expected: 404.
- Test 7: `GET /ra-final-bills` as `ho`. Expected: 200, paginated list.
- Test 8: `GET /ra-final-bills?work_order_no=X`. Expected: filtered results.
- Test 9: `GET /ra-final-bills/:id` as `zo`. Expected: 200, `bill_copy_signed_url` present.
- Test 10: `GET /ra-final-bills/summary/:work_order_no`. Expected: work_order_value, previous_bill_amount, dropdown_options.
- Test 11: Pagination — `GET /ra-final-bills?page=1&limit=5`. Expected: pagination metadata correct.

**M3 — Business Rule Tests:**
- Test 1: Create "RA Bill 1" for WO. Create "RA Bill 1" again. Expected: 409 — duplicate.
- Test 2: Create "RA Bill 3" without "RA Bill 2" existing. Expected: 422 — sequential enforcement.
- Test 3: Create "Final Bill" for Closed work order. Expected: 403.
- Test 4: Create "RA Bill 1". Then create "RA Bill 2". Expected: 201 — sequential enforcement passes.
- Test 5: Create "Final Bill". Then try to create another "Final Bill". Expected: 409 — duplicate.
- Test 6: `GET /summary/:work_order_no` after 3 RA Bills. Expected: `next_ra_bill_number = 4`, `final_bill_exists = false`.
- Test 7: `GET /summary/:work_order_no` after Final Bill entered. Expected: `final_bill_exists = true`, dropdown_options excludes "Final Bill" (or marks it as taken).

**M4 — File Upload Tests:**
- Test 1: Upload valid PDF ≤ 5MB as `ho`. Expected: 200, `bill_copy_url` returned.
- Test 2: Upload valid JPEG ≤ 5MB as `zo`. Expected: 200.
- Test 3: Upload valid PNG ≤ 5MB as `admin`. Expected: 200.
- Test 4: Upload a file with `.jpg` extension but `application/pdf` MIME type masquerading. Expected: storage accepts (PDF content stored correctly). *(Note: both PDF and image MIME types are valid.)*
- Test 5: Upload a `.exe` file with renamed extension. Expected: 400 — MIME type check catches.
- Test 6: Upload image > 5MB. Expected: 400 — size limit enforced.
- Test 7: Upload as `je`. Expected: 403 — unauthorized role.

### Manual Verification
- HO logs in → navigates to RA/Final Bill Entry → WO selected → geo-data auto-fills → Summary panel shows correct values.
- Type of Payment dropdown shows "RA Bill 1" for a fresh WO (no prior bills). User enters RA Bill 1 → Summary updates → saves.
- After saving RA Bill 1: dropdown now shows "RA Bill 2" as next option; "RA Bill 1" is greyed out.
- After 9 RA Bills: dropdown shows "RA Bill 10" + "Final Bill" as options.
- Final Bill entered → "Final Bill" disabled in dropdown on re-entry attempt.
- JE tries to navigate to `/ra-final-bills` → redirected away (ProtectedRoute enforces role).
- Bill copy upload: PDF, JPG, PNG all succeed. File > 5MB fails with clear error.
- Bill detail view: bill copy signed URL generates and loads correctly.
- Signed URL expires after 1 hour (TTL validation).
- Closed work order: "Bills cannot be entered for Closed work orders" error shows.

---

## Migration Sequence

| Step | File | Notes |
|---|---|---|
| 23 | `23_create_ra_final_bills.sql` | New table, indexes, triggers, constraints |

Apply after confirming Migrations 01–22 are already applied.

---

## File Inventory

| File | Action | Component |
|---|---|---|
| `backend/src/db/migrations/23_create_ra_final_bills.sql` | **NEW** | 1 — DB |
| `backend/src/validation/raFinalBill.schema.js` | **NEW** | 2 — Validation |
| `backend/src/controllers/raFinalBill.controller.js` | **NEW** | 2 — API |
| `backend/src/controllers/raFinalBill.uploads.controller.js` | **NEW** | 2 — API (File Uploads) |
| `backend/src/routes/raFinalBill.routes.js` | **NEW** | 2 — API |
| `backend/src/app.js` | **MODIFY** — add route mount | 2 — API |
| `frontend/src/pages/RAFinalBill.jsx` | **NEW** | 3 — Frontend |
| `frontend/src/api/raFinalBillApi.js` | **NEW** | 3 — Frontend |
| `frontend/src/App.jsx` | **MODIFY** — add route for `['zo', 'ho', 'admin']` | 3 — Frontend |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add nav card for HO/ZO/Admin | 3 — Frontend |
| `backend/tests/milestones/test_milestone_p6_m1.js` | **NEW** | Tests — DB Schema |
| `backend/tests/milestones/test_milestone_p6_m2.js` | **NEW** | Tests — CRUD API |
| `backend/tests/milestones/test_milestone_p6_m3.js` | **NEW** | Tests — Business Rules |
| `backend/tests/milestones/test_milestone_p6_m4.js` | **NEW** | Tests — File Upload |
| `backend/package.json` | **MODIFY** — add test scripts | Tests |
