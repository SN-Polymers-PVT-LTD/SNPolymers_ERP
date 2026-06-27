# Phase 6 — RA / Final Bill Entry Module
# Milestone-Driven Execution Plan

> **Status:** Implementation Plan approved and frozen. This document converts it into a sequential,
> dependency-ordered execution plan for AI-assisted development.
>
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Assumed existing:** Phase 1 (auth, fund reports) + Phase 2 (estimates) + Phase 3 (fund requests) + Phase 4 (requisitions) + Phase 5 (daily progress)
> **Process flow source:** RA / Final Bill Entry Process Flow Diagram + Type-of-Payment Dropdown image (RA Bill 1–N, Final Bill)

---

## Role Authorization Matrix

| Role | Create Bill Entry | View All Bills | Upload Bill Copy | Access Module |
|---|---|---|---|---|
| **HO** | Yes | Yes | Yes | Yes |
| **ZO** | Yes | Yes | Yes | Yes |
| **Admin** | Yes | Yes | Yes | Yes |
| **JE** | **No** | **No** | **No** | **No** |
| **Staff** | **No** | **No** | **No** | **No** |

> [!IMPORTANT]
> **Role boundaries are firm:**
> - Only `ho`, `zo`, `admin` can create bill entries and upload bill copies.
> - JE and Staff receive 403 on every endpoint, including the upload endpoint.
> - Bill records are permanently immutable once saved — no PATCH endpoint, no DELETE (blocked by DB trigger).
> - Bills cannot be entered for a Closed work order (403 returned).

---

## Known Design Decisions & Constraints

1. **Dynamic RA Bill Numbering:** The "Type of Payment" dropdown is generated at runtime from the `/summary/:work_order_no` API. It returns the next sequential RA bill number and whether a Final Bill already exists. This means the same UI works for RA Bill 10, RA Bill 15, or any N.

2. **Sequential Enforcement:** The server enforces that RA Bill N-1 must exist before RA Bill N is accepted. This prevents gaps in the bill sequence (e.g., entering RA Bill 3 without RA Bill 2).

3. **File Upload Orphaning:** If a user uploads a bill copy but then navigates away without saving, the file will remain in Supabase Storage. For an internal ERP with ~30 users, the volume of orphaned files is negligible. A periodic cleanup script can be run if needed.

4. **Geo-Metadata Snapshot Rule:** Geographic fields (`state`, `district`, `area_code`, `department`, `site_details`) are copied from `projects_master` as a frozen snapshot at creation time. They must NEVER be re-read from master later — they protect historical records if project data is updated in the future.

5. **Summary Panel:** All 5 summary values (Total Work Order Value, Previous Bill Amount, Current Bill Amount, Total Billed Till Date, Balance Amount) are derived live on the frontend using data from the summary API. No server-side computation is stored.

---

## Milestone Overview

| # | Milestone | Primary Layer | Depends On |
|---|---|---|---|
| M1 | Database Foundation | DB | Phase 5 migrations complete (migration 22 applied) |
| M2 | RA/Final Bill API — Core CRUD + Summary | Backend | M1 |
| M3 | Bill Copy Upload API (File Storage) | Backend | M2 |
| M4 | Frontend — RA/Final Bill Entry Page | Frontend | M2, M3 |
| M5 | Frontend — Dashboard Integration & Navigation | Frontend | M4 |
| M6 | Test Suite — Phase 6 | All | M1–M5 |
| M7 | UAT & Release Gate | All | M6 |

---

A milestone is complete only if:

✓ Code implemented  
✓ Acceptance criteria pass  
✓ All milestone test cases pass  
✓ No failing lint checks  
✓ No open P1 (Critical/High) security defects  

---

## M1 — Database Foundation

> [!IMPORTANT]
> **Geo-Metadata Snapshot Rule**: Geographic fields (`state`, `district`, `area_code`, `department`, `site_details`) are explicitly copied from `projects_master` as a frozen snapshot at the exact moment of bill creation. The column `area_code` maps from `projects_master.zone`. These frozen values must NEVER be re-read from the master table later — they protect historical financial records if project data is updated in the future.

### Objective
Establish all schema objects required by Phase 6: the `ra_final_bills` table, 3 performance indexes, and 3 triggers with constraints. Migration number is `23` (following `22_create_increment_otp_attempts_rpc.sql`). Additionally, the Supabase Storage bucket `ra-bill-copies` must be created manually in the Dashboard as a **private** bucket.

### Scope
- Apply migration `23_create_ra_final_bills.sql` to the Supabase project.
- Create the `ra-bill-copies` Storage bucket as **private** in the Supabase Dashboard.
- Verify all objects are created correctly before any backend work begins.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/db/migrations/23_create_ra_final_bills.sql` | **NEW** — apply to DB |

### Database Work

**`23_create_ra_final_bills.sql`** creates:
- Table `ra_final_bills` with all columns (linked to `projects_master` and `authorised_users`)
- `UNIQUE (work_order_no, payment_type)` — prevents duplicate bill type per work order
- Performance indexes on `work_order_no`, `created_by`, and `bill_date`
- 3 triggers: `trg_ra_final_bills_updated_at`, `trg_prevent_ra_final_bills_hard_delete`, `trg_audit_ra_final_bill_insert`
- DB-level CHECK constraints for amount positivity, payment_type format, and non-negative deposits

### SQL to Create

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

  -- Creator identity (auto-populated from session — never from request body)
  created_by                   VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  login_date                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Work Order linkage (geo-metadata snapshot stored at creation time)
  work_order_no                VARCHAR NOT NULL REFERENCES projects_master(work_order_no) ON DELETE RESTRICT,

  -- Frozen geographic metadata (snapshot from projects_master at creation time)
  -- NOTE: area_code maps from projects_master.zone — NOT from a column called area_code
  state                        VARCHAR NOT NULL,
  district                     VARCHAR NOT NULL,
  area_code                    VARCHAR NOT NULL,
  department                   VARCHAR NOT NULL,
  site_details                 TEXT NOT NULL,

  -- Bill classification — must match "RA Bill N" (N >= 1) or "Final Bill"
  payment_type                 VARCHAR NOT NULL,

  -- User-entered bill fields
  bill_date                    DATE NOT NULL,
  bill_no                      VARCHAR NOT NULL,
  bill_amount_with_gst         NUMERIC(18,2) NOT NULL,
  earnest_money_deposit        NUMERIC(18,2) NOT NULL DEFAULT 0,
  security_deposit_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,

  -- Bill copy storage (relative path in 'ra-bill-copies' private bucket)
  bill_copy_url                TEXT NOT NULL,
  original_bill_filename       VARCHAR,    -- Original user-supplied filename (for UI display only)

  -- Optional remarks
  remarks                      TEXT,

  -- Constraints
  CONSTRAINT uq_bill_per_payment_type
    UNIQUE (work_order_no, payment_type),

  CONSTRAINT chk_bill_amount_positive
    CHECK (bill_amount_with_gst > 0),

  CONSTRAINT chk_emd_non_negative
    CHECK (earnest_money_deposit >= 0),

  CONSTRAINT chk_sd_non_negative
    CHECK (security_deposit_amount >= 0),

  -- Enforces valid payment_type format at DB level (defence in depth)
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
-- 4. Trigger: block hard DELETE (records are permanent financial documents)
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

### Supabase Storage Bucket to Create (Manual Step in Dashboard)

| Bucket Name | Access | Notes |
|---|---|---|
| `ra-bill-copies` | **Private** | Stores bill copies uploaded by HO/ZO/Admin |

> [!IMPORTANT]
> The bucket MUST be set to **private** in the Supabase Dashboard. Signed URLs (TTL: 1 hour) will be generated via the backend for every bill copy view request. Do NOT make this bucket public under any circumstances.

### Acceptance Criteria
```
✓ ra_final_bills table exists with all columns and correct types
✓ UNIQUE constraint uq_bill_per_payment_type enforced on (work_order_no, payment_type)
✓ CHECK chk_bill_amount_positive enforced (> 0)
✓ CHECK chk_emd_non_negative enforced (>= 0)
✓ CHECK chk_sd_non_negative enforced (>= 0)
✓ CHECK chk_payment_type_format enforced (regex: "RA Bill N" or "Final Bill")
✓ 3 performance indexes created
✓ trg_ra_final_bills_updated_at fires on UPDATE (updated_at changes)
✓ trg_prevent_ra_final_bills_hard_delete raises exception on any DELETE attempt
✓ trg_audit_ra_final_bill_insert inserts into audit_log on INSERT
✓ Supabase Storage bucket 'ra-bill-copies' created and confirmed private
```

### Test Cases

**Test 1:** Insert a bill row with all required fields and valid `work_order_no` and `created_by`.
Expected: row inserted successfully; `audit_log` has a new row with `module_name = 'RAFinalBill'`, `action = 'CREATE'`.

**Test 2:** Attempt `DELETE FROM ra_final_bills WHERE bill_id = <any>`.
Expected: exception — "Hard deletion of RA/Final bill records is permanently prohibited."

**Test 3:** Update any field (e.g., `remarks`); check `updated_at`.
Expected: `updated_at` automatically updated to `now()`.

**Test 4:** Insert with `bill_amount_with_gst = 0`.
Expected: CHECK constraint violation (`chk_bill_amount_positive`).

**Test 5:** Insert with `bill_amount_with_gst = -500`.
Expected: CHECK constraint violation (`chk_bill_amount_positive`).

**Test 6:** Insert with `earnest_money_deposit = -1`.
Expected: CHECK constraint violation (`chk_emd_non_negative`).

**Test 7:** Insert with `payment_type = 'RA Bill 0'`.
Expected: CHECK constraint violation (`chk_payment_type_format`).

**Test 8:** Insert with `payment_type = 'ra bill 1'` (lowercase).
Expected: CHECK constraint violation (`chk_payment_type_format` — case-sensitive regex).

**Test 9:** Insert with `payment_type = 'Random String'`.
Expected: CHECK constraint violation (`chk_payment_type_format`).

**Test 10:** Insert same `(work_order_no, payment_type)` pair twice.
Expected: UNIQUE constraint violation (`uq_bill_per_payment_type`).

### Exit Criteria
```
✓ All 10 test cases pass
✓ No migration errors in Supabase dashboard
✓ Schema inspector confirms table, indexes, triggers, and constraints
✓ Storage bucket created and confirmed private
✓ Ready to begin M2
```

---

## M2 — RA/Final Bill API: Core CRUD + Summary

### Objective
Implement `createBill`, `getBills`, `getBillById`, and `getBillSummaryByWorkOrder`. These establish the complete API surface for the module. The summary endpoint is the key driver for the dynamic dropdown in the frontend.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/validation/raFinalBill.schema.js` | **NEW** — Zod schemas |
| `backend/src/controllers/raFinalBill.controller.js` | **NEW** — all 4 controller functions |
| `backend/src/routes/raFinalBill.routes.js` | **NEW** — route wiring |
| `backend/src/app.js` | **MODIFY** — add route mount |

### Backend Work

**Zod Schema Spec (`raFinalBill.schema.js`):**

```javascript
'use strict';

const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid bill ID.');

// Matches "RA Bill N" (N = 1, 2, ...) or "Final Bill"
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

**Controller file (`raFinalBill.controller.js`):**

```javascript
'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createBillSchema, getBillByIdSchema } = require('../validation/raFinalBill.schema');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const paymentTypeRegex = /^(RA Bill [1-9][0-9]*|Final Bill)$/;

// Batch display name resolver — single query for all mobile numbers
async function resolveDisplayNames(mobiles) {
  const uniqueMobiles = Array.from(new Set(mobiles.filter(Boolean)));
  const userMap = {};
  if (uniqueMobiles.length > 0) {
    const { data: users, error } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .in('mobile_number', uniqueMobiles);
    if (!error && users) {
      users.forEach(u => { userMap[u.mobile_number] = u.display_name; });
    }
  }
  return userMap;
}
```

**`createBill(req, res)`** — Full implementation spec:

```
1. Input validation: handled at route level by validate(req, res, createBillSchema).

2. Validate work_order_no exists in projects_master AND fetch geo-snapshot:
   SELECT work_order_value, status, state, district, zone, department, site_details
   FROM projects_master WHERE work_order_no = $1
   → 404 if not found: "Work order not found."
   → 403 if status = 'Closed': "Bills cannot be entered for Closed work orders."

3. Duplicate pre-check (before DB insert to give a clean error):
   SELECT COUNT(*) FROM ra_final_bills
   WHERE work_order_no = $1 AND payment_type = $2
   → 409 if count > 0: "A '{payment_type}' entry already exists for this work order."

4. Sequential RA Bill enforcement (server-side business rule):
   If payment_type is "RA Bill N" where N > 1:
     Extract N = parseInt(payment_type.split(' ')[2])
     Check if "RA Bill {N-1}" exists for this work_order_no
     → 422 if not: "RA Bill {N-1} must be entered before RA Bill {N} can be accepted."
   If payment_type is "RA Bill 1" or "Final Bill": skip this check.

5. Build insert payload (geo-fields frozen from fetched project row):
   {
     created_by:              req.user.mobile_number,   // from session — NEVER from body
     work_order_no:           work_order_no.trim(),
     state:                   project.state,            // frozen snapshot
     district:                project.district,         // frozen snapshot
     area_code:               project.zone,             // maps zone → area_code
     department:              project.department,       // frozen snapshot
     site_details:            project.site_details,     // frozen snapshot
     payment_type:            payment_type.trim(),
     bill_date:               bill_date,
     bill_no:                 bill_no.trim(),
     bill_amount_with_gst:    Number(bill_amount_with_gst),
     earnest_money_deposit:   Number(earnest_money_deposit || 0),
     security_deposit_amount: Number(security_deposit_amount || 0),
     bill_copy_url:           bill_copy_url.trim(),
     original_bill_filename:  original_bill_filename || null,
     remarks:                 remarks?.trim() || null
   }
   NOTE: login_date, created_at, updated_at use DB defaults (now()).

6. INSERT into ra_final_bills (.insert([...]).select().single()).
   → On DB UNIQUE violation (code '23505'): 409 (belt-and-suspenders)

7. Return 201:
   { success: true, bill: { ...created_row } }
```

**`getBills(req, res)`** — Paginated list with filters:

```
Query params:
  page           (default 1)
  limit          (default 50, max 100)
  work_order_no  (optional exact match)
  date_from      (optional ISO date filter on bill_date)
  date_to        (optional ISO date filter on bill_date)
  payment_type   (optional exact match — e.g. "Final Bill", "RA Bill 3")

All three authorised roles (ho, zo, admin) see ALL bills — no role-based record filtering.

Apply optional filters (validate date format with /^\d{4}-\d{2}-\d{2}$/ before applying):
  - work_order_no: exact match (.eq)
  - date_from:     bill_date >= date_from (.gte)
  - date_to:       bill_date <= date_to (.lte)
  - payment_type:  exact match (.eq)

Order: bill_date DESC, then created_at DESC.
Paginate: .range(offset, offset + limit - 1) with count: 'exact'.

Enrich: batch-resolve display_name for created_by.

NOTE: bill_copy_url in the list view is the raw storage path — NO signed URL in the list.
Signed URLs are generated only in getBillById.

Return: { success, bills, pagination: { page, limit, total, totalPages } }
```

**`getBillById(req, res)`** — Single record with signed URL:

```
1. Validate bill_id is a valid UUID → 400 if not.
2. Fetch bill from ra_final_bills → 404 if not found.
3. Resolve created_by display_name.
4. Generate fresh signed URL for bill_copy_url:
   supabase.storage.from('ra-bill-copies').createSignedUrl(path, 3600)
   → Include as bill_copy_signed_url in the response object.
   → If URL generation fails, return bill_copy_signed_url: null (do NOT block the response).
5. Return enriched bill: { ...bill, created_by_name, bill_copy_signed_url }.
```

**`getBillSummaryByWorkOrder(req, res)`** — Key driver for dynamic frontend dropdown:

```
1. Validate work_order_no (non-empty string from params).
2. Fetch from projects_master:
   SELECT work_order_value, status FROM projects_master WHERE work_order_no = $1
   → 404 if not found.

3. Fetch all existing bills for this work_order_no:
   SELECT payment_type, bill_amount_with_gst FROM ra_final_bills
   WHERE work_order_no = $1
   ORDER BY created_at ASC

4. Compute:
   existing_payment_types = bills.map(b => b.payment_type)
   previous_bill_amount   = bills.reduce((sum, b) => sum + Number(b.bill_amount_with_gst), 0)
   final_bill_exists      = existing_payment_types.includes('Final Bill')

   // Find the highest RA bill number already entered
   ra_bill_numbers = existing_payment_types
     .filter(t => t.startsWith('RA Bill '))
     .map(t => parseInt(t.split(' ')[2]))
   max_ra_bill_number = ra_bill_numbers.length > 0 ? Math.max(...ra_bill_numbers) : 0
   next_ra_bill_number = max_ra_bill_number + 1

5. Build dropdown_options array:
   options = []
   if (!final_bill_exists) {
     options.push({ value: `RA Bill ${next_ra_bill_number}`, label: `RA Bill ${next_ra_bill_number}`, available: true })
     options.push({ value: 'Final Bill', label: 'Final Bill', available: true })
   } else {
     // Final Bill exists — only additional RA Bills can be entered (should be rare)
     options.push({ value: `RA Bill ${next_ra_bill_number}`, label: `RA Bill ${next_ra_bill_number}`, available: true })
     options.push({ value: 'Final Bill', label: 'Final Bill (Already Entered)', available: false })
   }

6. Return:
   {
     success: true,
     work_order_value: project.work_order_value || 0,
     work_order_status: project.status,
     previous_bill_amount,
     existing_payment_types,
     next_ra_bill_number,
     final_bill_exists,
     dropdown_options
   }
```

**Route file (`raFinalBill.routes.js`):**

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
const validate    = require('../validation/validate');
const { createBillSchema, getBillByIdSchema } = require('../validation/raFinalBill.schema');
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }  // 5MB hard limit at multer layer
});

router.use(verifyJwt);

const authorisedRoles = ['ho', 'zo', 'admin'];

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: /upload/bill-copy and /summary/:work_order_no MUST be registered
// BEFORE /:id to prevent Express from matching "upload" or "summary" as a UUID.
// ─────────────────────────────────────────────────────────────────────────────

// File upload
router.post('/upload/bill-copy',
  requireRole(authorisedRoles),
  upload.single('file'),
  uploadBillCopy);

// Summary endpoint (dynamic dropdown driver)
router.get('/summary/:work_order_no',
  requireRole(authorisedRoles),
  getBillSummaryByWorkOrder);

// Core CRUD
router.post('/',
  requireRole(authorisedRoles),
  (req, res, next) => { if (!validate(req, res, createBillSchema)) return; next(); },
  createBill);

router.get('/',
  requireRole(authorisedRoles),
  getBills);

router.get('/:id',
  requireRole(authorisedRoles),
  (req, res, next) => { if (!validate(req, res, getBillByIdSchema)) return; next(); },
  getBillById);

module.exports = router;
```

> [!IMPORTANT]
> The `/upload/bill-copy` and `/summary/:work_order_no` routes MUST be registered **before** `/:id`. If registered after, Express will match the literal strings "upload" and "summary" as UUID parameters for the `/:id` route.

**`app.js` modification:**

```javascript
const raFinalBillRoutes = require('./routes/raFinalBill.routes');
// After the existing dailyProgressRoutes mount:
app.use('/api/v1/auth/ra-final-bills', raFinalBillRoutes);
```

### Acceptance Criteria
```
✓ POST /ra-final-bills as 'ho' with all valid fields → 201, geo-fields auto-populated from projects_master
✓ POST /ra-final-bills as 'je' → 403
✓ POST /ra-final-bills as 'staff' → 403
✓ POST /ra-final-bills with missing bill_copy_url → 400
✓ POST /ra-final-bills with bill_amount_with_gst = 0 → 400
✓ POST /ra-final-bills with bill_amount_with_gst = -100 → 400
✓ POST /ra-final-bills for a Closed work order → 403
✓ POST /ra-final-bills with invalid work_order_no → 404
✓ POST /ra-final-bills with duplicate (work_order_no, payment_type) → 409
✓ POST /ra-final-bills "RA Bill 3" without "RA Bill 2" → 422
✓ POST /ra-final-bills "RA Bill 2" after "RA Bill 1" exists → 201 (sequential enforcement passes)
✓ POST /ra-final-bills with payment_type = 'RA Bill 0' → 400 (Zod rejects)
✓ GET /ra-final-bills as 'ho' → 200, paginated list
✓ GET /ra-final-bills?work_order_no=X → filtered results
✓ GET /ra-final-bills/:id as 'zo' → 200, bill_copy_signed_url present
✓ GET /ra-final-bills/:id with invalid UUID → 400
✓ GET /ra-final-bills/summary/:work_order_no → work_order_value, previous_bill_amount, dropdown_options
✓ Pagination: page, limit, total, totalPages present in all list responses
✓ Frozen geo-fields correctly populated from projects_master snapshot
```

### Test Cases

**Test 1:** `POST /ra-final-bills` as `ho` with all valid fields (non-Closed work order).
Expected: 201, `area_code` = `project.zone`, all geo-fields match projects_master.

**Test 2:** `POST /ra-final-bills` as `je`.
Expected: 403 — unauthorized role.

**Test 3:** `POST /ra-final-bills` as `staff`.
Expected: 403 — unauthorized role.

**Test 4:** `POST /ra-final-bills` with missing `bill_copy_url`.
Expected: 400 — "bill_copy_url is required."

**Test 5:** `POST /ra-final-bills` with `bill_amount_with_gst = 0`.
Expected: 400 — positive amount required.

**Test 6:** `POST /ra-final-bills` for a Closed work order.
Expected: 403 — "Bills cannot be entered for Closed work orders."

**Test 7:** `POST /ra-final-bills` with `work_order_no = 'NONEXISTENT'`.
Expected: 404 — "Work order not found."

**Test 8:** `POST /ra-final-bills` "RA Bill 1" for work order. Then POST "RA Bill 1" again.
Expected: 409 — "A 'RA Bill 1' entry already exists for this work order."

**Test 9:** `POST /ra-final-bills` "RA Bill 3" without "RA Bill 2" existing.
Expected: 422 — "RA Bill 2 must be entered before RA Bill 3 can be accepted."

**Test 10:** `POST /ra-final-bills` "RA Bill 2" after "RA Bill 1" exists.
Expected: 201 — sequential enforcement passes.

**Test 11:** `GET /ra-final-bills` as `ho`.
Expected: 200, paginated response with correct `pagination` object.

**Test 12:** `GET /ra-final-bills?work_order_no=X&date_from=YYYY-MM-DD`.
Expected: 200, filtered results matching all criteria.

**Test 13:** `GET /ra-final-bills/:id` as `zo`.
Expected: 200, `bill_copy_signed_url` present and starts with `https://`.

**Test 14:** `GET /ra-final-bills/summary/:work_order_no` fresh WO (no bills).
Expected: `next_ra_bill_number = 1`, `previous_bill_amount = 0`, `final_bill_exists = false`.

**Test 15:** `GET /ra-final-bills/summary/:work_order_no` after 3 RA Bills.
Expected: `next_ra_bill_number = 4`, `previous_bill_amount` = sum of 3 bills, `final_bill_exists = false`.

**Test 16:** `GET /ra-final-bills/summary/:work_order_no` after Final Bill entered.
Expected: `final_bill_exists = true`, dropdown_options shows Final Bill as unavailable.

### Exit Criteria
```
✓ All 16 test cases pass
✓ No P1 defects
✓ Route registered in app.js and server starts without error
✓ Ready to begin M3
```

---

## M3 — Bill Copy Upload API (File Storage)

### Objective
Add a secure bill copy upload endpoint for HO/ZO/Admin. All bill copies are stored in the private `ra-bill-copies` Supabase Storage bucket. Storage paths are UUID-based (server-generated) — never derived from user-supplied filenames. Accepted formats: PDF, JPG, JPEG, PNG. Max size: 5MB.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/controllers/raFinalBill.uploads.controller.js` | **NEW** |
| `backend/src/routes/raFinalBill.routes.js` | Already wired in M2 — no change needed |

### Backend Work

**`raFinalBill.uploads.controller.js`** — Full implementation:

```javascript
'use strict';

const { supabase } = require('../db/supabase');
const { v4: uuidv4 } = require('uuid');

const MAX_FILE_SIZE = 5 * 1024 * 1024;  // 5MB

// SEC-P6-2: MIME type whitelist — includes both PDF and image types
const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png'
];

// Maps MIME type to file extension for UUID-based storage path
const MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'image/jpeg':      'jpg',
  'image/png':       'png'
};

/**
 * POST /api/v1/auth/ra-final-bills/upload/bill-copy
 * Uploads a bill copy (PDF/JPG/JPEG/PNG) to Supabase Storage.
 * Body (multipart/form-data): file (field name: 'file')
 *
 * Security Controls:
 *   SEC-P6-2: MIME type validated server-side — never trust file extension
 *   SEC-P6-3: File size capped at 5MB (also enforced by multer limits)
 *   SEC-P6-9: Storage path is UUID-based — user-supplied filename never reaches storage path
 */
async function uploadBillCopy(req, res) {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  // SEC-P6-2: MIME type validation — reject anything not in the whitelist
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: 'Only PDF, JPG, JPEG, or PNG files are accepted.'
    });
  }

  // SEC-P6-3: Re-validate size in controller (belt-and-suspenders after multer)
  if (file.size > MAX_FILE_SIZE) {
    return res.status(400).json({
      success: false,
      message: 'File size must not exceed 5MB.'
    });
  }

  // SEC-P6-9: Generate UUID-based path — user-supplied filename is NEVER used in storage path
  const ext = MIME_TO_EXT[file.mimetype];
  const storagePath = `${uuidv4()}.${ext}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('ra-bill-copies')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false  // Each bill copy gets a unique UUID path — no overwrites
      });

    if (uploadError) throw uploadError;

    return res.status(200).json({
      success: true,
      bill_copy_url: storagePath,             // Relative storage path (stored in DB)
      original_filename: file.originalname,   // User's original filename (stored separately)
      message: 'Bill copy uploaded successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('uploadBillCopy failed:', error);
    } else {
      console.error(`uploadBillCopy failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to upload bill copy.' });
  }
}

module.exports = { uploadBillCopy };
```

**Signed URL regeneration in `getBillById`:**

```javascript
// After fetching bill from DB, before returning:
let bill_copy_signed_url = null;
if (bill.bill_copy_url) {
  const { data: signData } = await supabase.storage
    .from('ra-bill-copies')
    .createSignedUrl(bill.bill_copy_url, 3600);
  bill_copy_signed_url = signData?.signedUrl || null;
  // If generation fails, return null — do NOT block the entire response
}
```

> [!IMPORTANT]
> Store only the storage **path** (e.g., `3e9f1c2a-....pdf`) in the `bill_copy_url` DB column — NOT the full signed URL (which expires after 1 hour). The controller generates a fresh signed URL on every `getBillById` call.

### Acceptance Criteria
```
✓ POST /upload/bill-copy by 'ho' with valid PDF ≤ 5MB → 200, bill_copy_url (UUID-based path) returned
✓ POST /upload/bill-copy by 'zo' with valid JPEG ≤ 5MB → 200
✓ POST /upload/bill-copy by 'admin' with valid PNG ≤ 5MB → 200
✓ POST /upload/bill-copy with a text file (.txt) → 400 — "Only PDF, JPG, JPEG, or PNG files are accepted."
✓ POST /upload/bill-copy with file > 5MB → 400 — "File size must not exceed 5MB."
✓ POST /upload/bill-copy with .jpg extension but text/plain MIME → 400 (MIME check catches disguise)
✓ POST /upload/bill-copy by 'je' → 403 (requireRole blocks)
✓ POST /upload/bill-copy by 'staff' → 403 (requireRole blocks)
✓ bill_copy_url in response is UUID-based, NOT the original filename
✓ original_filename in response matches the user's actual file name
✓ GET /ra-final-bills/:id after upload → bill_copy_signed_url present and starts with 'https://'
✓ Direct public URL access to bucket → 400 or 403 (bucket confirmed private)
```

### Test Cases

**Test 1:** Upload valid PDF ≤ 5MB as `ho`.
Expected: 200, `bill_copy_url` is UUID string — NOT the original filename.

**Test 2:** Upload valid JPEG ≤ 5MB as `zo`.
Expected: 200, `bill_copy_url` returned.

**Test 3:** Upload valid PNG ≤ 5MB as `admin`.
Expected: 200, `bill_copy_url` returned.

**Test 4:** Upload a text file with `.txt` MIME type.
Expected: 400 — "Only PDF, JPG, JPEG, or PNG files are accepted."

**Test 5:** Upload any file > 5MB as `ho`.
Expected: 400 — "File size must not exceed 5MB."

**Test 6:** Upload file with `.jpg` extension but `text/plain` MIME type.
Expected: 400 — MIME check catches the disguised file.

**Test 7:** Upload as `je`.
Expected: 403 — unauthorized role.

**Test 8:** Upload as `staff`.
Expected: 403 — unauthorized role.

**Test 9:** Verify bucket is private.
Expected: Direct GET to public object URL returns 400 or 403.

**Test 10:** `GET /ra-final-bills/:id` after valid upload.
Expected: 200, `bill_copy_signed_url` present and starts with `https://`.
Cleanup (finally): `supabase.storage.from('ra-bill-copies').remove([uploadedPath])`

### Exit Criteria
```
✓ All 10 test cases pass
✓ Private bucket access confirmed
✓ UUID path pattern confirmed in response
✓ No P1 defects
✓ Ready to begin M4
```

---

## M4 — Frontend: RA / Final Bill Entry Page

### Objective
Build the `RAFinalBill.jsx` page for HO/ZO/Admin roles. This is the primary user-facing module for Phase 6. The page must match the design from the shared screen mockup: Project Details auto-fetch section, Bill Details section, Summary auto-calculated panel, and action buttons (SAVE DRAFT, RESET, CANCEL).

### Files Created or Modified
| File | Action |
|---|---|
| `frontend/src/pages/RAFinalBill.jsx` | **NEW** |
| `frontend/src/api/raFinalBillApi.js` | **NEW** |

### API Client — `raFinalBillApi.js`

```javascript
import authApi from './authApi';

export const getBills           = (params = {})      => authApi.get('/ra-final-bills', { params });
export const getBillById        = (id)               => authApi.get(`/ra-final-bills/${id}`);
export const createBill         = (data)             => authApi.post('/ra-final-bills', data);
export const getBillSummary     = (work_order_no)    =>
  authApi.get(`/ra-final-bills/summary/${encodeURIComponent(work_order_no)}`);

export const uploadBillCopy = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return authApi.post('/ra-final-bills/upload/bill-copy', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
```

### Frontend Page — `RAFinalBill.jsx`

**Architecture:** Single-file page component following the existing glassmorphism dark pattern from `Requisitions.jsx` and `DailyProgress.jsx`. Uses Sidebar layout, dark background, glass-panel sections, stat cards, paginated table list, and slide-in create form panel.

**Page Sections:**

**A. List View (default state)**

```
Header Bar:
  - Title: "RA / Final Bill Entry" (with document icon)
  - Access badge: "HO / ZO / ADMIN ONLY"
  - "New Bill Entry" button (green, top-right)

Stat Cards (auto-fetched):
  - Total Bills Entered
  - Total Amount Billed (sum of all bill_amount_with_gst)
  - Final Bills Entered

Filter Bar:
  - Work Order No. (text input)
  - Payment Type (dropdown: All, RA Bill, Final Bill)
  - Date From / Date To (date pickers)
  - Apply / Clear buttons

Bills Table:
  Columns: Work Order No | Type of Payment | Bill Date | Bill No | Bill Amount (GST) | Uploaded By | Created At | Action
  Each row: click → open Detail View panel
  Bill Amount: formatted as ₹ X,XX,XXX.XX (Indian locale)
  Payment Type: badge — "RA Bill N" in amber, "Final Bill" in emerald

Pagination: page controls at bottom
```

**B. Create Form Panel (slides in from right)**

```
Panel Header: "RA / Final Bill Entry" | X close button

─── SECTION 1: PROJECT DETAILS (Auto Fetch from Work Order) ───
  Row 1: [Work Order No. *] dropdown (searchable, all projects)
           ↓ on change: call getBillSummary(work_order_no)
           ↓ auto-populate below AND update dropdown + summary panel
  Row 2: [State] read-only     |  [District] read-only
  Row 3: [Area Code] read-only |  [Department] read-only
  Row 4: [Site Details] read-only textarea (full width)

  Visual: light blue auto-fill background (matching requisitions pattern)
  Note: "Auto Fetch from Work Order" subtitle in blue

─── SECTION 2: BILL DETAILS ───
  Row 1: [Type of Payment *] dropdown    |  [Bill Date *] date picker (DD/MM/YYYY)
         Options from getBillSummary:              (stored as YYYY-MM-DD)
           "RA Bill {next}" — available
           "Final Bill" — available or disabled if exists
         If no WO selected: show "-- Select Work Order First --"

  Row 2: [Bill No *] text input          |  [Bill Amount With GST *] ₹ numeric
  Row 3: [Earnest Money Deposit] ₹ opt  |  [Security Deposit Amount] ₹ opt
  Row 4: [Upload Bill Copy *] file input |  [Remarks] textarea optional
         Accepts: PDF/JPG/JPEG/PNG, max 5MB
         Two-step: upload file first (show spinner) → get bill_copy_url
         Show after upload: filename + file type icon + "✓ Uploaded"
         Client-side validation BEFORE upload:
           - Reject if file.type not in ['application/pdf','image/jpeg','image/png']
           - Reject if file.size > 5 * 1024 * 1024

─── SECTION 3: SUMMARY (Auto Calculated) ───
  [Total Work Order Value] | [Previous Bill Amount] | [Current Bill Amount]
  [Total Billed Till Date]                          | [Balance Amount]

  Computation (live, reactive):
    Previous Bill Amount    = summaryData.previous_bill_amount (from API)
    Current Bill Amount     = formState.bill_amount_with_gst (live mirror of input)
    Total Billed Till Date  = Previous + Current
    Balance Amount          = Total Work Order Value − Total Billed Till Date
                              (shown in RED if negative = over-billed)

  All values formatted as ₹ X,XX,XXX.XX

─── ACTION BUTTONS ───
  [💾 SAVE DRAFT] (green)   → validate all required fields → createBill() → 201 → success toast → close panel → refresh list
  [🔄 RESET] (orange)       → reset all bill detail fields (keep WO selected, re-fetch summary)
  [✕ CANCEL] (red)          → close panel without saving

  Footer: "Created By: {user.display_name || mobile_number}   Created Date: {current datetime}"
```

**C. Detail View (read-only slide-in panel on row click)**

```
Fetches getBillById(bill.bill_id) → shows full bill data + signed URL
  All Section 1 (geo) fields: read-only
  All Section 2 (bill) fields: read-only
  Bill Copy: download/view link using bill_copy_signed_url
             → PDF opens in new tab; images display as preview
             → "Bill Copy Unavailable" if signed URL is null
  Section 3: Summary displayed using stored values
  Footer: Created By name + Created At datetime
```

**State Management:**

```javascript
// Form state
const [formState, setFormState] = useState({
  work_order_no: '', payment_type: '', bill_date: '',
  bill_no: '', bill_amount_with_gst: '', earnest_money_deposit: '',
  security_deposit_amount: '', bill_copy_url: '', original_bill_filename: '',
  remarks: ''
});

// Auto-filled project data (read-only)
const [projectData, setProjectData] = useState(null);

// Summary data (from /summary/:work_order_no)
const [summaryData, setSummaryData] = useState(null);

// Upload state
const [uploadState, setUploadState] = useState({ uploading: false, uploaded: false, filename: '' });

// UI state
const [showCreatePanel, setShowCreatePanel] = useState(false);
const [selectedBill, setSelectedBill] = useState(null);  // for detail view
const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState(null);
```

**Work Order Selection Handler:**

```javascript
const handleWorkOrderSelect = async (work_order_no) => {
  setFormState(prev => ({ ...prev, work_order_no, payment_type: '' }));
  setSummaryData(null);
  setProjectData(null);

  if (!work_order_no) return;

  // Fetch project details for geo-snapshot display
  const projectRes = await getProjects();  // or getProjectByWorkOrder
  const project = projectRes.data.projects.find(p => p.work_order_no === work_order_no);
  if (project) setProjectData(project);

  // Fetch summary for dropdown options and previous bill amount
  try {
    const summaryRes = await getBillSummary(work_order_no);
    if (summaryRes.data.success) setSummaryData(summaryRes.data);
  } catch (err) {
    setError('Failed to load bill summary for this work order.');
  }
};
```

**Type of Payment Dropdown:**

```jsx
<select
  value={formState.payment_type}
  onChange={e => setFormState(prev => ({ ...prev, payment_type: e.target.value }))}
  disabled={!formState.work_order_no || !summaryData}
>
  <option value="">
    {!formState.work_order_no ? '-- Select Work Order First --' : '-- Select Type of Payment --'}
  </option>
  {summaryData?.dropdown_options?.map(opt => (
    <option key={opt.value} value={opt.value} disabled={!opt.available}>
      {opt.label}
    </option>
  ))}
</select>
```

**File Upload Handler (Two-Step):**

```javascript
const handleFileUpload = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Client-side validation BEFORE upload
  const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!ALLOWED.includes(file.type)) {
    setError('Only PDF, JPG, JPEG, or PNG files are accepted.');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    setError('File size must not exceed 5MB.');
    return;
  }

  setUploadState({ uploading: true, uploaded: false, filename: file.name });
  try {
    const res = await uploadBillCopy(file);
    if (res.data.success) {
      setFormState(prev => ({
        ...prev,
        bill_copy_url: res.data.bill_copy_url,
        original_bill_filename: res.data.original_filename
      }));
      setUploadState({ uploading: false, uploaded: true, filename: file.name });
    }
  } catch (err) {
    setError('File upload failed. Please try again.');
    setUploadState({ uploading: false, uploaded: false, filename: '' });
  }
};
```

**Save/Submit Handler:**

```javascript
const handleSubmit = async () => {
  // Required field validation
  const required = ['work_order_no', 'payment_type', 'bill_date', 'bill_no',
                    'bill_amount_with_gst', 'bill_copy_url'];
  for (const field of required) {
    if (!formState[field]) {
      setError(`${field.replace(/_/g, ' ')} is required.`);
      return;
    }
  }

  setSubmitting(true);
  try {
    const payload = {
      work_order_no: formState.work_order_no,
      payment_type:  formState.payment_type,
      bill_date:     formState.bill_date,  // YYYY-MM-DD
      bill_no:       formState.bill_no,
      bill_amount_with_gst:    Number(formState.bill_amount_with_gst),
      earnest_money_deposit:   Number(formState.earnest_money_deposit || 0),
      security_deposit_amount: Number(formState.security_deposit_amount || 0),
      bill_copy_url:           formState.bill_copy_url,
      original_bill_filename:  formState.original_bill_filename || null,
      remarks:                 formState.remarks || null
    };
    const res = await createBill(payload);
    if (res.data.success) {
      // Success toast + close panel + refresh list
      setShowCreatePanel(false);
      fetchBills();  // refresh list
    }
  } catch (err) {
    const msg = err.response?.data?.message || 'Failed to save bill entry.';
    setError(msg);
  } finally {
    setSubmitting(false);
  }
};
```

### Acceptance Criteria
```
✓ Work Order dropdown populates from /projects
✓ Geo-fields auto-populate on WO selection and are non-editable
✓ getBillSummary called on WO selection; dropdown options populated correctly
✓ "Type of Payment" shows "Select Work Order First" if no WO selected
✓ "Final Bill" option disabled in dropdown if final_bill_exists = true
✓ Previous Bill Amount, Total Work Order Value auto-fill from summary API
✓ Current Bill Amount live mirrors the bill_amount_with_gst input
✓ Total Billed Till Date and Balance Amount computed live
✓ Balance Amount shown in red if negative (over-billed scenario)
✓ File upload: PDF/JPG/PNG succeeds; client rejects > 5MB before upload
✓ Client-side rejects non-PDF/image MIME types before upload
✓ Two-step upload: file uploaded first → URL stored → included in form submit
✓ Save button validates all required fields before submitting
✓ 201 success: panel closes, list refreshes, success notification shown
✓ 403 (Closed WO): error message displayed clearly
✓ 409 (duplicate): error message "already exists" shown
✓ 422 (sequential violation): error message shown
✓ Detail view: bill_copy_signed_url used for PDF/image download link
✓ RESET button clears bill fields (keeps WO, re-fetches summary)
✓ CANCEL closes panel without saving
```

### Exit Criteria
```
✓ All acceptance criteria verified
✓ Bill copy upload and preview work end-to-end
✓ Dynamic dropdown correctly reflects current bill state for each WO
✓ Summary panel live computation verified
✓ Ready to begin M5
```

---

## M5 — Frontend: Dashboard Integration & Navigation

### Objective
Wire the RA/Final Bill Entry module into `App.jsx` routing and add a navigation card on `Dashboard.jsx` for HO, ZO, and Admin roles.

### Files Modified
| File | Action |
|---|---|
| `frontend/src/App.jsx` | **MODIFY** — add `/ra-final-bills` route under `['zo', 'ho', 'admin']` protection |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add RA/Final Bill module card |

### App.jsx Modification

Add inside the existing `['zo', 'staff', 'ho', 'admin']` protected route group, or create a new group for `['zo', 'ho', 'admin']` (staff excluded):

```jsx
import RAFinalBill from './pages/RAFinalBill';

// Add inside ProtectedRoute for ['zo', 'ho', 'admin']:
<Route element={<ProtectedRoute allowedRoles={['zo', 'ho', 'admin']} />}>
  <Route path="/ra-final-bills" element={<RAFinalBill />} />
</Route>
```

### Dashboard.jsx Modification

Add a new glassmorphism module card after the Daily Work Progress card, visible only to `ho`, `zo`, `admin`. Use an indigo/blue color accent to differentiate from existing amber/emerald modules:

```jsx
{['zo', 'ho', 'admin'].includes(user?.role) && (
  <div className="glass-panel glass-card-hover p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between min-h-[220px] glow-border-active shadow-[0_8px_32px_rgba(99,102,241,0.04)]">
    <div className="absolute top-0 right-0 p-5 opacity-[0.14]">
      <svg className="w-24 h-24 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </div>
    <div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Finance · Billing</span>
      <h3 className="text-lg font-extrabold mt-1 text-slate-200">RA / Final Bill Entry</h3>
      <p className="text-xs text-slate-400 font-normal mt-4 leading-relaxed">
        Enter and track Running Account (RA) bills and Final Bill submissions against work orders.
        Upload bill copies and monitor billing progress with auto-calculated summaries.
      </p>
    </div>
    <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-4">
      <span className="text-[9px] uppercase tracking-widest font-extrabold text-indigo-400 bg-indigo-950/20 border border-indigo-900/30 px-2 py-0.5 rounded-lg">Active System</span>
      <Link
        to="/ra-final-bills"
        className="px-4 py-2 rounded-xl text-xs font-bold uppercase bg-white text-slate-950 hover:bg-slate-100 hover:shadow-lg transition-all duration-300 flex items-center gap-1.5"
      >
        Open Bills &rarr;
      </Link>
    </div>
  </div>
)}
```

### Acceptance Criteria
```
✓ /ra-final-bills route accessible to zo, ho, admin
✓ /ra-final-bills redirects/blocks je and staff roles
✓ Dashboard card visible to zo, ho, admin — hidden from je and staff
✓ Navigation from Dashboard card to RA/Final Bill page works
✓ Page loads correctly with bill list on landing
```

---

## M6 — Test Suite — Phase 6

### Objective
Create comprehensive automated tests for all milestones following the established pattern from Phase 4/5: `mockRes()` helper, pass/fail counters, `try/catch/finally` with cleanup, `process.exit(0/1)`.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/tests/milestones/test_milestone_p6_m1.js` | **NEW** — DB schema verification |
| `backend/tests/milestones/test_milestone_p6_m2.js` | **NEW** — Core CRUD API + Summary |
| `backend/tests/milestones/test_milestone_p6_m3.js` | **NEW** — Business Rules (duplicate, sequential, Closed WO) |
| `backend/tests/milestones/test_milestone_p6_m4.js` | **NEW** — File upload & storage |
| `backend/package.json` | **MODIFY** — add test scripts |

### `test_milestone_p6_m1.js` — DB Schema Verification

```javascript
// Direct Supabase client calls (no HTTP)
// T1:  Insert bill with all required fields → row inserted + audit_log CREATE entry
// T2:  Attempt DELETE → exception "Hard deletion...prohibited"
// T3:  Update any field → updated_at auto-updated by trigger
// T4:  Insert with bill_amount_with_gst = 0 → CHECK chk_bill_amount_positive violation
// T5:  Insert with bill_amount_with_gst = -500 → CHECK violation
// T6:  Insert with earnest_money_deposit = -1 → CHECK chk_emd_non_negative violation
// T7:  Insert with payment_type = 'RA Bill 0' → CHECK chk_payment_type_format violation
// T8:  Insert with payment_type = 'ra bill 1' (lowercase) → CHECK violation
// T9:  Insert with payment_type = 'RandomString' → CHECK violation
// T10: Insert same (work_order_no, payment_type) twice → UNIQUE constraint violation
```

### `test_milestone_p6_m2.js` — Core CRUD API + Summary

```javascript
// T1:  POST /ra-final-bills as 'ho' — valid payload → 201, geo-fields correct
// T2:  POST /ra-final-bills as 'je' → 403
// T3:  POST /ra-final-bills as 'staff' → 403
// T4:  POST /ra-final-bills missing bill_copy_url → 400
// T5:  POST /ra-final-bills with bill_amount_with_gst = 0 → 400
// T6:  POST /ra-final-bills for Closed WO → 403
// T7:  POST /ra-final-bills with invalid work_order_no → 404
// T8:  GET /ra-final-bills as 'ho' → 200, paginated list with pagination object
// T9:  GET /ra-final-bills?work_order_no=X → filtered results
// T10: GET /ra-final-bills/:id as 'zo' → 200, bill_copy_signed_url present
// T11: GET /ra-final-bills/:id with invalid UUID → 400
// T12: GET /ra-final-bills/summary/:wo — fresh WO → next_ra_bill_number=1, previous_bill_amount=0
// T13: GET /ra-final-bills/summary/:wo — after 3 RA Bills → next_ra_bill_number=4, correct sum
// T14: GET /ra-final-bills/summary/:wo — after Final Bill → final_bill_exists=true
// T15: GET /ra-final-bills?page=1&limit=5 → pagination.limit=5
```

### `test_milestone_p6_m3.js` — Business Rule Tests

```javascript
// T1:  Create "RA Bill 1". Create "RA Bill 1" again → 409 Conflict
// T2:  Create "RA Bill 3" without "RA Bill 2" → 422 Unprocessable
// T3:  Create "RA Bill 1" → Create "RA Bill 2" → 201 (sequential passes)
// T4:  Create "Final Bill" for Closed work order → 403
// T5:  Create "Final Bill" → Create "Final Bill" again → 409 Conflict
// T6:  Create "RA Bill 1", "RA Bill 2", "RA Bill 3" → all 201; summary shows next=4
// T7:  payment_type = 'RA Bill 0' via API → 400 (Zod rejects before controller)
// T8:  payment_type = 'InvalidType' via API → 400 (Zod rejects)
```

### `test_milestone_p6_m4.js` — File Upload & Storage

```javascript
// T1:  Upload valid PDF ≤ 5MB as 'ho' → 200, bill_copy_url is UUID string
// T2:  Upload valid JPEG ≤ 5MB as 'zo' → 200
// T3:  Upload valid PNG ≤ 5MB as 'admin' → 200
// T4:  Upload text/plain MIME file → 400 "Only PDF, JPG, JPEG, or PNG..."
// T5:  Upload file > 5MB as 'ho' → 400 "File size must not exceed 5MB."
// T6:  Upload file with .jpg extension but text/plain MIME → 400
// T7:  Upload as 'je' → 403
// T8:  Upload as 'staff' → 403
// T9:  Verify bucket is private: direct GET to public object URL → 400 or 403
// T10: GET /ra-final-bills/:id after upload → bill_copy_signed_url starts with 'https://'
// Cleanup (finally): supabase.storage.from('ra-bill-copies').remove([uploadedPath])
```

### `package.json` Additions

```json
{
  "scripts": {
    "test:p6:m1":  "node tests/milestones/test_milestone_p6_m1.js",
    "test:p6:m2":  "node tests/milestones/test_milestone_p6_m2.js",
    "test:p6:m3":  "node tests/milestones/test_milestone_p6_m3.js",
    "test:p6:m4":  "node tests/milestones/test_milestone_p6_m4.js",
    "test:p6:all": "node tests/milestones/test_milestone_p6_m1.js && node tests/milestones/test_milestone_p6_m2.js && node tests/milestones/test_milestone_p6_m3.js && node tests/milestones/test_milestone_p6_m4.js"
  }
}
```

### Exit Criteria
```
✓ All test files runnable: npm run test:p6:all exits 0
✓ Every test prints [PASS]
✓ Zero [FAIL] entries across all 4 test files
✓ Ready to begin M7
```

---

## M7 — UAT & Release Gate

### Objective
End-to-end manual verification by a real HO/ZO/Admin user in the deployed staging environment. No code changes at this stage.

### UAT Scenarios

**Scenario 1 — HO enters RA Bill 1 for a fresh work order:**
1. HO logs in → navigates to "RA / Final Bill Entry" from Dashboard card
2. Clicks "New Bill Entry"
3. Selects Work Order No. from dropdown
4. Verifies: State, District, Area Code, Department, Site Details auto-populate and are read-only
5. Type of Payment shows "RA Bill 1" — user selects it
6. Summary panel shows: Total Work Order Value = project value, Previous Bill Amount = ₹0.00
7. Enters Bill Date, Bill No, Bill Amount With GST (e.g., ₹5,00,000)
8. Summary updates live: Current Bill Amount = ₹5,00,000; Total Billed = ₹5,00,000; Balance = WO Value − ₹5,00,000
9. Optionally enters Earnest Money Deposit and Security Deposit
10. Uploads a PDF bill copy — upload spinner → "✓ Uploaded" confirmation
11. Clicks "SAVE DRAFT" → success notification → returns to list
12. Verifies: "RA Bill 1" row appears in list with correct amount

**Scenario 1b — HO enters RA Bill 2 for same work order:**
1. HO clicks "New Bill Entry" → selects same Work Order
2. Type of Payment now shows "RA Bill 2" (RA Bill 1 already entered)
3. Previous Bill Amount = ₹5,00,000 (RA Bill 1 amount)
4. Enters new bill details → saves → 201 ✓

**Scenario 1c — HO enters RA Bill 10 (after 9 RA Bills):**
1. Type of Payment shows "RA Bill 10" + "Final Bill"
2. User selects "RA Bill 10" → saves → 201 ✓

**Scenario 2 — HO tries to re-enter existing RA Bill:**
1. Selects WO where "RA Bill 1" already exists
2. Type of Payment dropdown does NOT show "RA Bill 1" as available (or it's disabled)
3. If user somehow forces submission: server returns 409 "A 'RA Bill 1' entry already exists"

**Scenario 3 — HO enters Final Bill:**
1. After all RA Bills entered → selects WO → Type of Payment shows "Final Bill" as available
2. Selects "Final Bill" → saves → 201 ✓
3. On next visit to same WO: "Final Bill" shows as "(Already Entered)" and is disabled

**Scenario 4 — Bill copy upload validation:**
1. HO selects a non-PDF/image file (.xlsx) → client shows "Only PDF, JPG, JPEG, or PNG files are accepted." — file NOT uploaded
2. HO selects a file > 5MB → client shows "File size must not exceed 5MB." — file NOT uploaded
3. HO selects valid PDF ≤ 5MB → uploads successfully → filename shown

**Scenario 5 — Closed work order guard:**
1. HO selects a Closed work order
2. On submission: "Bills cannot be entered for Closed work orders." (403)

**Scenario 6 — JE access blocked:**
1. JE tries to navigate to `/ra-final-bills` → redirected (ProtectedRoute blocks)
2. Dashboard card not visible to JE
3. Direct API call from JE token → 403

**Scenario 7 — Detail view and bill copy download:**
1. HO clicks a bill row in list → Detail panel opens
2. Bill Copy link present → clicks → PDF opens in new tab / image displays
3. All fields shown correctly; read-only

**Scenario 8 — Balance Amount goes negative (over-billed):**
1. HO enters bill where Total Billed Till Date > Total Work Order Value
2. Balance Amount shown in red in Summary panel
3. System still saves (no hard block on over-billing — just visual warning)

**Scenario 9 — Signed URL expiry:**
1. Open a bill detail; note the signed URL
2. Wait 1+ hour; access the same URL → 400/403 (expired)
3. Reload bill detail → fresh signed URL → bill copy loads again

### Release Checklist
```
✓ All 9 UAT scenarios pass
✓ No P1 or P2 defects open
✓ Migration 23 applied to production DB
✓ Supabase Storage bucket 'ra-bill-copies' created and private in production
✓ Server starts cleanly: npm start logs no errors
✓ Frontend builds cleanly: npm run build exits 0
✓ Phase 6 sign-off obtained from stakeholder
```

---

## Security Summary (Phase 6)

| ID | Concern | Severity | Control |
|---|---|---|---|
| SEC-P6-1 | **Role enforcement** — JE and Staff completely blocked | **HIGH** | `requireRole(['ho', 'zo', 'admin'])` on every route including upload. 403 returned. |
| SEC-P6-2 | **MIME type enforcement** — PDF/image only | **HIGH** | Server-side `mimetype` whitelist check — file extension never inspected for type determination |
| SEC-P6-3 | **File size limit** — 5MB max at two layers | **HIGH** | Multer `limits.fileSize` + re-validation in controller |
| SEC-P6-4 | **Private bucket** — `ra-bill-copies` never publicly readable | **HIGH** | Private bucket; `createSignedUrl(path, 3600)` at read time only |
| SEC-P6-5 | **Duplicate bill prevention** | **HIGH** | DB `UNIQUE (work_order_no, payment_type)` + 409 pre-check in controller |
| SEC-P6-6 | **payment_type regex enforcement** | **MEDIUM** | Zod schema regex + DB CHECK constraint (defence in depth) |
| SEC-P6-7 | **Sequential RA Bill enforcement** | **MEDIUM** | Server-side check in createBill: "RA Bill N-1" must exist before "RA Bill N" |
| SEC-P6-8 | **Closed WO guard** | **MEDIUM** | Controller checks `projects_master.status` before insert. 403 if Closed. |
| SEC-P6-9 | **Storage path traversal prevention** | **MEDIUM** | Path = `{uuidv4()}.{ext}` (server-generated); user-supplied filename in `original_bill_filename` only |
| SEC-P6-10 | **Bill immutability** | **MEDIUM** | No PATCH endpoint. `trg_prevent_ra_final_bills_hard_delete` raises exception on any DELETE. |
| SEC-P6-11 | **Numeric overflow** | **LOW** | `NUMERIC(18,2)` column type enforces precision. Zod validates type before insertion. |

---

## Migration Sequence

| Step | File | Notes |
|---|---|---|
| 23 | `23_create_ra_final_bills.sql` | New table, indexes, triggers, CHECK constraints, UNIQUE constraint |

**Pre-flight check before applying migration:**
```sql
-- Verify migration 22 was applied
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'increment_otp_attempts';
-- Expected: 1 row

-- Check table doesn't already exist
SELECT table_name FROM information_schema.tables WHERE table_name = 'ra_final_bills';
-- Expected: 0 rows (not yet created)
```

---

## File Inventory (Complete)

| File | Action | Milestone |
|---|---|---|
| `backend/src/db/migrations/23_create_ra_final_bills.sql` | **NEW** | M1 — DB |
| `backend/src/validation/raFinalBill.schema.js` | **NEW** | M2 — Zod Schemas |
| `backend/src/controllers/raFinalBill.controller.js` | **NEW** | M2 — API |
| `backend/src/controllers/raFinalBill.uploads.controller.js` | **NEW** | M3 — Uploads |
| `backend/src/routes/raFinalBill.routes.js` | **NEW** | M2, M3 — Routes |
| `backend/src/app.js` | **MODIFY** — add route mount | M2 |
| `frontend/src/api/raFinalBillApi.js` | **NEW** | M4 — API Client |
| `frontend/src/pages/RAFinalBill.jsx` | **NEW** | M4 — Frontend Page |
| `frontend/src/App.jsx` | **MODIFY** — add route for `['zo', 'ho', 'admin']` | M5 |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add nav card for HO/ZO/Admin | M5 |
| `backend/tests/milestones/test_milestone_p6_m1.js` | **NEW** | M6 — DB Schema Tests |
| `backend/tests/milestones/test_milestone_p6_m2.js` | **NEW** | M6 — CRUD Tests |
| `backend/tests/milestones/test_milestone_p6_m3.js` | **NEW** | M6 — Business Rule Tests |
| `backend/tests/milestones/test_milestone_p6_m4.js` | **NEW** | M6 — Upload Tests |
| `backend/package.json` | **MODIFY** — add test:p6 scripts | M6 |

---

## Dependency Graph

```
M1 (DB Foundation)
 └─► M2 (Core CRUD API + Summary)
      └─► M3 (Bill Copy Upload API)
           └─► M4 (Frontend Page)
                └─► M5 (Dashboard Integration)

All of M1–M5 → M6 (Test Suite) → M7 (UAT & Release Gate)
```
