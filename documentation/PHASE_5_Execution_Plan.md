# Phase 5 — Daily Work Progress Module
# Milestone-Driven Execution Plan

> **Status:** Implementation Plan approved and frozen. This document converts it into a sequential,
> dependency-ordered execution plan for AI-assisted development.
>
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Assumed existing:** Phase 1 (auth, fund reports) + Phase 2 (estimates) + Phase 3 (fund requests) + Phase 4 (requisitions)
> **Process flow source:** Phase 5 Daily Work Progress Workflow Diagram + Daily Work Progress Screen-4(1).xlsx (Entry_Screen_4 sheet)

---

## Role Authorization Matrix

| Role | Submit Report | Add Authority Remarks | View Own Reports | View All Reports |
|---|---|---|---|---|
| **JE** | Yes | No | Yes | No |
| **ZO** | No | Yes (if WO is Active) | — | Yes |
| **HO** | No | Yes (if WO is Active) | — | Yes |
| **Admin** | No | Yes (if WO is Active) | — | Yes |
| **Staff** | No | No | No | No |

> [!IMPORTANT]
> **Role boundaries are firm:**
> - Only `je` can submit (create) a daily progress report.
> - Only `zo`, `ho`, and `admin` can write authority remarks.
> - No role can delete or edit a submitted report's JE-entered fields.
> - JE-submitted fields become immutable immediately after creation. Only Authority Remarks may be modified by authorized users. — a DB trigger blocks all hard DELETEs.

---

## Known Design Decisions & Constraints

1. **Photo Upload Orphaning**: If a JE uploads a site photo but their browser crashes or they fail to submit the daily progress report, the file will remain in Supabase Storage. Since this is an internal ERP for ~30 users, the volume of orphaned files is negligible. A periodic batch cleanup script can be run if storage volume ever becomes a concern.

---

## Milestone Overview

| # | Milestone | Primary Layer | Depends On |
|---|---|---|---|
| M1 | Database Foundation | DB | Phase 4 migrations complete (migration 20 applied) |
| M2 | Daily Progress API — Core CRUD | Backend | M1 |
| M3 | Daily Progress API — Authority Remarks | Backend | M2 |
| M4 | Photo Upload API (Image Storage) | Backend | M2 |
| M5 | Frontend — Daily Progress Entry (JE View) | Frontend | M2, M4 |
| M6 | Frontend — Authority View & Remarks | Frontend | M3, M5 |
| M7 | Frontend — Dashboard Integration & Navigation | Frontend | M6 |
| M8 | Test Suite — Phase 5 | All | M1–M7 |
| M9 | UAT & Release Gate | All | M8 |

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
> **Geo-Metadata Snapshot Rule**: Geographic fields (`state`, `district`, `area_code`, `department`, `site_details`) are explicitly copied from `projects_master` as a frozen snapshot at the exact moment of report creation. The column `area_code` maps from `projects_master.zone`. These frozen values must NEVER be re-read from the master table later — they protect historical records if project data is updated in the future.

### Objective
Establish all schema objects required by Phase 5: the `daily_progress_reports` table, 3 performance indexes, and 3 triggers. The migration number is `21` (following migration `20_create_requisitions.sql` from Phase 4). Additionally, the Supabase Storage bucket `daily-progress-photos` must be created manually in the Dashboard as a **private** bucket.

### Scope
- Apply migration `21_create_daily_progress_reports.sql` to the Supabase project.
- Create the `daily-progress-photos` Storage bucket as **private** in the Supabase Dashboard.
- Verify all objects are created correctly before any backend work begins.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/db/migrations/21_create_daily_progress_reports.sql` | **NEW** — apply to DB |

### Database Work

**`21_create_daily_progress_reports.sql`** creates:
- Table `daily_progress_reports` with all columns (linked to `projects_master` and `authorised_users`)
- Performance indexes on `work_order_no`, `created_by`, and `site_visit_date`
- 3 triggers: `trg_daily_progress_updated_at`, `trg_prevent_daily_progress_hard_delete`, `trg_audit_daily_progress_insert`
- DB-level CHECK constraints for `physical_work_progress` bounds (0–100) and authority remarks consistency

### SQL to Create

```sql
-- ===========================================================================
-- Migration 21: Phase 5 — Daily Work Progress Reports
-- PREREQUISITE: Migrations 01–20 must have been applied.
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. daily_progress_reports table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_progress_reports (
  report_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- JE identity (auto-populated from session)
  created_by                   VARCHAR NOT NULL REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  login_date                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Work Order linkage (geo-metadata snapshot stored at creation time)
  work_order_no                VARCHAR NOT NULL REFERENCES projects_master(work_order_no) ON DELETE RESTRICT,

  -- Frozen geographic metadata (snapshot from projects_master at creation time)
  state                        VARCHAR NOT NULL,
  district                     VARCHAR NOT NULL,
  area_code                    VARCHAR NOT NULL,         -- maps to projects_master.zone
  department                   VARCHAR NOT NULL,
  site_details                 TEXT NOT NULL,

  -- JE user-entered fields
  site_visit_date              DATE NOT NULL,
  work_progress_details        TEXT NOT NULL,
  physical_work_progress       NUMERIC(5,2) NOT NULL,
  daily_site_photo_url         TEXT NOT NULL,            -- Storage path (daily-progress-photos/{uuid}.ext)
  original_photo_filename      VARCHAR,                  -- Original filename for UI display only
  remarks_after_site_visit     TEXT,                     -- Optional JE remarks

  -- Authority remark fields (post-creation, written by ZO/HO/Admin only)
  -- Note: approved_user_id, approval_date, and remarks_approved_authority must always be updated together. Never allow partial population.
  remarks_approved_authority   TEXT,
  approved_user_id             VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  approval_date                TIMESTAMPTZ,

  -- Integrity: physical progress must be between 0 and 100
  CONSTRAINT chk_physical_work_progress
    CHECK (physical_work_progress >= 0 AND physical_work_progress <= 100),

  -- Integrity: either all authority fields are NULL or all are NOT NULL
  CONSTRAINT chk_authority_remarks_consistency
    CHECK (
      (approved_user_id IS NULL AND approval_date IS NULL AND remarks_approved_authority IS NULL)
      OR
      (approved_user_id IS NOT NULL AND approval_date IS NOT NULL AND remarks_approved_authority IS NOT NULL)
    ),

  -- Integrity: enforce one daily progress report per work order per day
  CONSTRAINT uq_daily_progress_work_order_date UNIQUE (work_order_no, site_visit_date),

  -- Audit fields
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Indexes for performance
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_daily_progress_work_order
  ON daily_progress_reports(work_order_no);

CREATE INDEX IF NOT EXISTS idx_daily_progress_created_by
  ON daily_progress_reports(created_by);

CREATE INDEX IF NOT EXISTS idx_daily_progress_site_visit_date
  ON daily_progress_reports(site_visit_date DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: auto-update updated_at
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_daily_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_progress_updated_at ON daily_progress_reports;
CREATE TRIGGER trg_daily_progress_updated_at
BEFORE UPDATE ON daily_progress_reports
FOR EACH ROW EXECUTE FUNCTION set_daily_progress_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: block hard DELETE (reports are permanent, immutable records)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_daily_progress_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion of daily progress reports is permanently prohibited. Records are immutable.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_daily_progress_hard_delete ON daily_progress_reports;
CREATE TRIGGER trg_prevent_daily_progress_hard_delete
BEFORE DELETE ON daily_progress_reports
FOR EACH ROW EXECUTE FUNCTION prevent_daily_progress_hard_delete();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: audit log on INSERT
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_daily_progress_insert()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_daily_progress_insert ON daily_progress_reports;
CREATE TRIGGER trg_audit_daily_progress_insert
AFTER INSERT ON daily_progress_reports
FOR EACH ROW EXECUTE FUNCTION audit_daily_progress_insert();
```

### Supabase Storage Bucket to Create (Manual Step in Dashboard)

| Bucket Name | Access | Notes |
|---|---|---|
| `daily-progress-photos` | **Private** | Stores site photos uploaded by JEs |

> [!IMPORTANT]
> The bucket MUST be set to **private** in the Supabase Dashboard. Signed URLs (TTL: 1 hour) will be generated via the backend for every photo view request. Do NOT make this bucket public under any circumstances.

### Acceptance Criteria
```
✓ daily_progress_reports table exists with all columns and correct types
✓ CONSTRAINT chk_physical_work_progress enforced (0–100)
✓ CONSTRAINT chk_authority_remarks_consistency enforced
✓ 3 performance indexes created
✓ trg_daily_progress_updated_at fires on UPDATE
✓ trg_prevent_daily_progress_hard_delete raises exception on DELETE attempt
✓ trg_audit_daily_progress_insert inserts into audit_log on INSERT
✓ Supabase Storage bucket 'daily-progress-photos' created and set to private
```

### Test Cases

**Test 1:** Insert a report row with all required fields and a valid `work_order_no` and `created_by`.
Expected: row inserted successfully; `audit_log` has a new row with `module_name = 'DailyProgress'`, `action = 'CREATE'`.

**Test 2:** Attempt `DELETE FROM daily_progress_reports WHERE report_id = <any>`.
Expected: exception — "Hard deletion of daily progress reports is permanently prohibited."

**Test 3:** Update any field (e.g., `remarks_after_site_visit`); check `updated_at`.
Expected: `updated_at` automatically updated to `now()`.

**Test 4:** Insert a row with `physical_work_progress = 101`.
Expected: CHECK constraint violation (`chk_physical_work_progress`).

**Test 5:** Insert a row with `physical_work_progress = -1`.
Expected: CHECK constraint violation (`chk_physical_work_progress`).

**Test 6:** Insert a row with partial authority fields (e.g., approved_user_id set, but remarks_approved_authority or approval_date NULL).
Expected: CHECK constraint violation (`chk_authority_remarks_consistency`).

**Test 7:** Insert a row with the same `work_order_no` and `site_visit_date` as an existing row.
Expected: UNIQUE constraint violation (`uq_daily_progress_work_order_date`).

### Exit Criteria
```
✓ All 7 test cases pass
✓ No migration errors in Supabase dashboard
✓ Schema inspector confirms table, indexes, triggers, and constraints
✓ Storage bucket created and confirmed private
✓ Ready to begin M2
```

---

## M2 — Daily Progress API: Core CRUD

### Objective
Implement `createProgressReport`, `getProgressReports`, and `getProgressReportById`. These establish the base read/write layer. No authority remarks or file upload yet.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/validation/dailyProgress.schema.js` | **NEW** — Zod schemas |
| `backend/src/controllers/dailyProgress.controller.js` | **NEW** (partial — CRUD functions) |
| `backend/src/routes/dailyProgress.routes.js` | **NEW** |
| `backend/src/app.js` | **MODIFY** — add route mount |

### Backend Work

**Zod Schema Spec (`dailyProgress.schema.js`):**

```javascript
'use strict';

const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid report ID.');

const createProgressReportSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' })
      .trim().min(1, 'work_order_no is required.'),

    site_visit_date: z.string({ required_error: 'site_visit_date is required.' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'site_visit_date must be a valid date in YYYY-MM-DD format.')
      .refine(val => {
        const inputDate = new Date(val);
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        return inputDate <= today;
      }, 'site_visit_date cannot be in the future.'),

    work_progress_details: z.string({ required_error: 'work_progress_details is required.' })
      .trim().min(1, 'work_progress_details is required.'),

    physical_work_progress: z.union([z.number(), z.string()], {
      required_error: 'physical_work_progress must be a number between 0 and 100.'
    })
      .transform(val => Number(val))
      .refine(val => !isNaN(val) && val >= 0 && val <= 100 && isFinite(val),
        'physical_work_progress must be a number between 0 and 100.')
      .transform(val => Math.round(val * 100) / 100),

    daily_site_photo_url: z.string({ required_error: 'daily_site_photo_url is required. Upload the photo first.' })
      .trim().min(1, 'daily_site_photo_url is required. Upload the photo first.'),

    original_photo_filename: z.string().optional().nullable(),
    remarks_after_site_visit: z.string().optional().nullable()
  })
};

const addRemarksSchema = {
  params: z.object({ id: uuidSchema }),
  body: z.object({
    remarks_approved_authority: z.string({ required_error: 'remarks_approved_authority is required.' })
      .trim().min(1, 'remarks_approved_authority cannot be blank.')
  })
};

const getReportByIdSchema = {
  params: z.object({ id: uuidSchema })
};

module.exports = {
  createProgressReportSchema,
  addRemarksSchema,
  getReportByIdSchema
};
```

**Controller file skeleton:**

```javascript
'use strict';

const { supabase } = require('../db/supabase');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Display name resolver helper — batches all mobile lookups in a single query
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

**`createProgressReport(req, res)`** — Full implementation spec:

```
1. Input validation: handled at route level by validateRequest(createProgressReportSchema).

   → 409 Conflict if status is not 'Active' (e.g. 'Closed', 'Complete Under Maintenance'): "Daily progress reports can only be created for Active projects."
   Verify the project status is Active before allowing report creation. Reject Closed and Complete Under Maintenance with HTTP 409.

3. Build insert payload (geo-fields frozen from fetched project row):
   {
     created_by:               req.user.mobile_number,    // from session — NOT from body
     work_order_no:            work_order_no.trim(),
     state:                    project.state,             // frozen snapshot
     district:                 project.district,          // frozen snapshot
     area_code:                project.zone,              // maps zone → area_code
     department:               project.department,        // frozen snapshot
     site_details:             project.site_details,      // frozen snapshot
     site_visit_date:          site_visit_date,
     work_progress_details:    work_progress_details.trim(),
     physical_work_progress:   Number(physical_work_progress),
     daily_site_photo_url:     daily_site_photo_url.trim(),
     original_photo_filename:  original_photo_filename || null,
     remarks_after_site_visit: remarks_after_site_visit?.trim() || null
   }
   NOTE: login_date, created_at, updated_at use DB defaults (now()).

4. INSERT into daily_progress_reports (.insert([...]).select().single()).

5. Return 201:
   { success: true, report: { ...created_row } }
```

**`getProgressReports(req, res)`** — Role-filtered list with pagination:

```
Query params: page (default 1), limit (default 50, max 100),
              work_order_no (optional exact match),
              date_from (optional, ISO date on site_visit_date),
              date_to (optional, ISO date on site_visit_date),
              created_by (optional — ZO/HO/Admin only; silently ignored for JE)

Role-based record visibility:
  'je':    WHERE created_by = req.user.mobile_number   (own records only — always enforced)
  'zo':    all records
  'ho':    all records
  'admin': all records

Apply optional filters (validate date format with regex before applying):
  - work_order_no: exact match (.eq)
  - date_from:     site_visit_date >= date_from (.gte)
  - date_to:       site_visit_date <= date_to (.lte)
  - created_by:    exact match (.eq) — blocked for 'je' role; silently ignored if provided

Order: site_visit_date DESC, then created_at DESC.
Paginate: .range(offset, offset + limit - 1) with count: 'exact'.

Enrich: batch-resolve display_name for created_by and approved_user_id.

NOTE: Photo URLs in the list view are NOT signed — only the relative storage path
is returned for performance. Signed URLs are generated only in getProgressReportById.

Return: { success, reports, pagination: { page, limit, total, totalPages } }
```

**`getProgressReportById(req, res)`** — Single record with visibility and signed photo URL:

```
1. Validate report_id UUID → 400 if invalid.
2. Fetch report from daily_progress_reports → 404 if not found.
3. Visibility gate:
   'je':    created_by must = req.user.mobile_number → else 404 (NOT 403 — prevents ID enumeration)
   'zo':    always visible
   'ho':    always visible
   'admin': always visible
4. Resolve display_name for created_by and approved_user_id (batch call).
5. Generate a fresh signed URL for daily_site_photo_url:
   supabase.storage.from('daily-progress-photos').createSignedUrl(path, 3600)
   → Include as photo_signed_url in the response object.
   → If URL generation fails, return photo_signed_url: null (do NOT block the entire response).
6. Return enriched report: { ...report, created_by_name, approved_by_name, photo_signed_url }.
```

**`app.js` modification:**

```javascript
const dailyProgressRoutes = require('./routes/dailyProgress.routes');
// ... after the existing requisitionsRoutes mount:
app.use('/api/v1/auth/daily-progress', dailyProgressRoutes);
```

**Route file skeleton (`dailyProgress.routes.js`):**

```javascript
'use strict';

const express = require('express');
const {
  createProgressReport,
  getProgressReports,
  getProgressReportById,
  addAuthorityRemarks
} = require('../controllers/dailyProgress.controller');
const { uploadSitePhoto } = require('../controllers/dailyProgress.uploads.controller');
const verifyJwt    = require('../middleware/verifyJwt');
const requireRole  = require('../middleware/requireRole');
const validateRequest = require('../middleware/validateRequest');
const {
  createProgressReportSchema,
  addRemarksSchema,
  getReportByIdSchema
} = require('../validation/dailyProgress.schema');
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }  // 10MB hard limit at multer layer
});

router.use(verifyJwt);

const creatorRoles = ['je'];
const viewerRoles  = ['je', 'zo', 'ho', 'admin'];
const remarksRoles = ['zo', 'ho', 'admin'];

// Photo upload — JE only
router.post('/upload/photo', requireRole(creatorRoles), upload.single('file'), uploadSitePhoto);

// Core CRUD
router.post('/',     requireRole(creatorRoles), validateRequest(createProgressReportSchema), createProgressReport);
router.get('/',      requireRole(viewerRoles),  getProgressReports);
router.get('/:id',   requireRole(viewerRoles),  validateRequest(getReportByIdSchema),        getProgressReportById);

// Authority remarks
router.patch('/:id/remarks', requireRole(remarksRoles), validateRequest(addRemarksSchema), addAuthorityRemarks);

module.exports = router;
```

### Acceptance Criteria
```
✓ POST /daily-progress for an Active work order → 201
✓ POST /daily-progress for a non-Active work order → 409 Conflict
✓ POST /daily-progress for a Complete Under Maintenance work order → 409 Conflict
✓ POST /daily-progress with invalid work_order_no → 404
✓ POST /daily-progress with missing daily_site_photo_url → 400
✓ POST /daily-progress with physical_work_progress = 150 → 400
✓ POST /daily-progress with physical_work_progress = -5 → 400
✓ GET /daily-progress as 'je': only own reports returned (created_by = je mobile)
✓ GET /daily-progress as 'zo': all reports visible (not filtered by created_by)
✓ GET /daily-progress as 'je' with ?created_by=other_mobile: filter silently ignored
✓ GET /daily-progress/:id as 'je' for another JE's report → 404 (no ID leakage)
✓ GET /daily-progress/:id as 'zo' → 200 with photo_signed_url present
✓ GET /daily-progress/:id with invalid UUID → 400
✓ Pagination: page, limit, total, totalPages present in all list responses
✓ Frozen geo-fields correctly populated from projects_master snapshot
```

### Test Cases

**Test 1:** `POST /daily-progress` as `je` with all valid fields (Active work order).
Expected: 201, all geo-fields auto-populated from `projects_master`.

**Test 2:** `POST /daily-progress` as `zo`.
Expected: 403 — JE-only creation.

**Test 3:** `POST /daily-progress` as `je` with a non-Active work order.
Expected: 409 — Conflict.

**Test 3b:** `POST /daily-progress` as `je` with a Complete Under Maintenance work order.
Expected: 409 — Conflict.

**Test 4:** `POST /daily-progress` with missing `daily_site_photo_url`.
Expected: 400.

**Test 5:** `POST /daily-progress` with `physical_work_progress = 150`.
Expected: 400 — out of range.

**Test 6:** `POST /daily-progress` with `physical_work_progress = -5`.
Expected: 400 — out of range.

**Test 7:** `POST /daily-progress` with `work_order_no = 'NONEXISTENT_WO'`.
Expected: 404 — "Work order not found."

**Test 8:** `GET /daily-progress` as `je`.
Expected: 200, all items have `created_by = je_mobile`.

**Test 9:** `GET /daily-progress` as `zo`.
Expected: 200, reports from multiple JEs visible.

**Test 10:** `GET /daily-progress/:id` as `je` for another JE's report.
Expected: 404 (no ID leakage — not 403).

**Test 11:** `GET /daily-progress/:id` as `zo`.
Expected: 200, `photo_signed_url` present and starts with `https://`.

**Test 12:** `GET /daily-progress?work_order_no=X&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`.
Expected: 200, filtered results matching all applied criteria.

**Test 13:** `GET /daily-progress?page=1&limit=5`.
Expected: 200, `pagination.limit = 5`, `pagination.total >= 0`.

### Exit Criteria
```
✓ All 13 test cases pass
✓ No P1 defects
✓ Route registered in app.js and server starts without error
✓ Ready to begin M3
```

---

## M3 — Daily Progress API: Authority Remarks

### Objective
Implement the `addAuthorityRemarks` endpoint (`PATCH /:id/remarks`). Only `zo`, `ho`, and `admin` roles can use this. Remarks are blocked if the parent work order's status in `projects_master` is not `'Active'`.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/controllers/dailyProgress.controller.js` | **MODIFY** — add `addAuthorityRemarks` |
| `backend/src/routes/dailyProgress.routes.js` | Already wired in M2 — no change needed |

### Backend Work

**`addAuthorityRemarks(req, res)`** — Full implementation:

```javascript
async function addAuthorityRemarks(req, res) {
  const { id } = req.params;
  const { remarks_approved_authority } = req.body;

  // UUID validation is performed at route level via validateRequest(addRemarksSchema)

  try {
    // 1. Fetch report → 404 if not found
    const { data: report, error: fetchError } = await supabase
      .from('daily_progress_reports')
      .select('report_id, work_order_no')
      .eq('report_id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    // 2. Fetch work order status from projects_master
    const { data: project, error: projectErr } = await supabase
      .from('projects_master')
      .select('status')
      .eq('work_order_no', report.work_order_no)
      .maybeSingle();

    if (projectErr) throw projectErr;

    // 3. Work order status guard — Only 'Active' projects allow remarks.
    const ALLOWED_PROJECT_STATUSES = ['Active'];
    if (project && !ALLOWED_PROJECT_STATUSES.includes(project.status)) {
      return res.status(409).json({
        success: false,
        message: `Authority remarks cannot be added or modified for projects in ${project.status} status.`
      });
    }

    // 4. Build update payload — any zo/ho/admin can overwrite previous remarks (by design)
    const updatePayload = {
      remarks_approved_authority: remarks_approved_authority.trim(),
      approved_user_id:           req.user.mobile_number,
      approval_date:              new Date().toISOString()
    };

    // 5. Perform update
    const { data: updated, error: updateError } = await supabase
      .from('daily_progress_reports')
      .update(updatePayload)
      .eq('report_id', id)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    return res.status(200).json({
      success: true,
      report: updated,
      message: 'Authority remarks saved successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('addAuthorityRemarks failed:', error);
    } else {
      console.error(`addAuthorityRemarks failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to save authority remarks.' });
  }
}
```

> [!IMPORTANT]
> The `addAuthorityRemarks` function intentionally allows any `zo`, `ho`, or `admin` to overwrite each other's remarks. This is by design — the `approved_user_id` and `approval_date` fields always reflect the most recent writer.

### Acceptance Criteria
```
✓ PATCH /:id/remarks as 'zo' → 200, remarks saved, approved_user_id = zo_mobile, approval_date set
✓ PATCH /:id/remarks as 'ho' → 200
✓ PATCH /:id/remarks as 'admin' → 200
✓ PATCH /:id/remarks as 'je' → 403 (requireRole blocks)
✓ PATCH /:id/remarks as 'staff' → 403 (requireRole blocks)
✓ PATCH /:id/remarks for report on a non-Active work order → 409 Conflict
✓ PATCH /:id/remarks with blank remarks → 400
✓ PATCH /:id/remarks on non-existent report UUID → 404
✓ Second PATCH overwrites first remarks; approved_user_id and approval_date updated
```

### Test Cases

**Test 1:** `PATCH /:id/remarks` as `zo` with valid remarks.
Expected: 200, `approved_user_id = zo_mobile`, `approval_date` set.

**Test 2:** `PATCH /:id/remarks` as `je`.
Expected: 403.

**Test 3:** `PATCH /:id/remarks` as `ho` for a non-Active WO report.
Expected: 409 — Conflict.

**Test 4:** `PATCH /:id/remarks` with blank `remarks_approved_authority`.
Expected: 400 — "remarks_approved_authority cannot be blank."

**Test 5:** `PATCH /:id/remarks` on a non-existent report UUID.
Expected: 404 — "Report not found."

**Test 6:** Second `PATCH` by `admin` overwrites first `zo` remarks.
Expected: 200, `approved_user_id` updated to admin's mobile.

### Exit Criteria
```
✓ All 6 test cases pass
✓ Non-Active WO guard confirmed working
✓ Overwrite behaviour confirmed
✓ No P1 defects
✓ Ready to begin M4
```

---

## M4 — Photo Upload API (Image Storage)

### Objective
Add a secure site photo upload endpoint for JEs. All photos are stored in the private `daily-progress-photos` Supabase Storage bucket. Storage paths are UUID-based (server-generated) — never derived from user-supplied filenames.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/src/controllers/dailyProgress.uploads.controller.js` | **NEW** |
| `backend/src/routes/dailyProgress.routes.js` | Already wired in M2 — no change needed |

### Backend Work

**`dailyProgress.uploads.controller.js`** — Full implementation:

```javascript
'use strict';

const { supabase } = require('../db/supabase');
const { v4: uuidv4 } = require('uuid');

const MAX_FILE_SIZE  = 10 * 1024 * 1024;   // 10MB
const ALLOWED_MIMES  = ['image/jpeg', 'image/png'];
const MIME_TO_EXT    = { 'image/jpeg': 'jpg', 'image/png': 'png' };

/**
 * POST /api/v1/auth/daily-progress/upload/photo
 * Uploads a site photo to Supabase Storage.
 * Body (multipart/form-data): file (field name: 'file')
 *
 * Security Controls:
 *   SEC-P5-1: MIME type validated server-side — never trust file extension
 *   SEC-P5-2: File size capped at 10MB (also enforced by multer limits)
 *   SEC-P5-8: Storage path is UUID-based — user-supplied filename never reaches storage path
 */
async function uploadSitePhoto(req, res) {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  // SEC-P5-1: MIME type validation — reject anything that is not a real image
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: 'Only image files are accepted (JPEG, JPG, PNG).'
    });
  }

  // SEC-P5-2: Re-validate size in controller (belt-and-suspenders after multer)
  if (file.size > MAX_FILE_SIZE) {
    return res.status(400).json({
      success: false,
      message: 'File size must not exceed 10MB.'
    });
  }

  // SEC-P5-8: Generate UUID-based path — user-supplied filename is NEVER used in storage path
  const ext = MIME_TO_EXT[file.mimetype];
  const storagePath = `${uuidv4()}.${ext}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('daily-progress-photos')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false   // Each report gets a unique UUID path — no overwrites
      });

    if (uploadError) throw uploadError;

    return res.status(200).json({
      success: true,
      photo_url: storagePath,                  // Relative storage path (stored in DB)
      original_filename: file.originalname,    // User's original filename (stored separately)
      message: 'Site photo uploaded successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('uploadSitePhoto failed:', error);
    } else {
      console.error(`uploadSitePhoto failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to upload site photo.' });
  }
}

module.exports = { uploadSitePhoto };
```

**Signed URL regeneration in `getProgressReportById`:**

```javascript
// After fetching report from DB, before returning:
let photo_signed_url = null;
if (report.daily_site_photo_url) {
  const { data: signData } = await supabase.storage
    .from('daily-progress-photos')
    .createSignedUrl(report.daily_site_photo_url, 3600);
  photo_signed_url = signData?.signedUrl || null;
  // If generation fails, return null — do NOT block the entire response
}
```

> [!IMPORTANT]
> Store only the storage **path** (e.g., `3e9f1c2a-...jpg`) in the `daily_site_photo_url` DB column — NOT the full signed URL (which expires after 1 hour). The controller generates a fresh signed URL on every `getProgressReportById` call.

### Acceptance Criteria
```
✓ POST /upload/photo by 'je' with valid JPEG → 200, photo_url (UUID-based path) returned
✓ POST /upload/photo by 'je' with valid PNG → 200
✓ POST /upload/photo by 'je' with PDF → 400 — "Only image files are accepted (JPEG, JPG, PNG)."
✓ POST /upload/photo with file > 10MB → 400 — "File size must not exceed 10MB."
✓ POST /upload/photo with .jpg extension but application/pdf MIME → 400 (MIME check catches disguise)
✓ POST /upload/photo by 'zo' → 403 (JE-only)
✓ photo_url in response is UUID-based, NOT the original filename
✓ original_filename in response matches the user's actual file name
✓ GET /daily-progress/:id after upload → photo_signed_url present and starts with 'https://'
✓ Direct public URL access to bucket → 400 or 403 (bucket confirmed private)
```

### Test Cases

**Test 1:** Upload valid JPEG ≤ 10MB as `je`.
Expected: 200, `photo_url` is UUID string — NOT the original filename.

**Test 2:** Upload PDF as `je`.
Expected: 400 — "Only image files are accepted (JPEG, JPG, PNG)."

**Test 3:** Upload image > 10MB as `je`.
Expected: 400 — "File size must not exceed 10MB."

**Test 4:** Upload file with `.jpg` extension but `application/pdf` MIME type.
Expected: 400 — MIME check catches the disguised file.

**Test 5:** Upload as `zo`.
Expected: 403 — JE-only upload endpoint.

**Test 6:** Verify storage bucket is private.
Expected: Direct GET to public object URL returns 400 or 403.

**Test 7:** `GET /daily-progress/:id` after valid upload.
Expected: 200, `photo_signed_url` present and starts with `https://`.

### Exit Criteria
```
✓ All 7 test cases pass
✓ Private bucket access confirmed
✓ UUID path pattern confirmed in response
✓ No P1 defects
✓ Ready to begin M5
```

---

## M5 — Frontend: Daily Progress Entry (JE View)

### Objective
Build the `DailyProgress.jsx` page for the JE role — the report creation form and the JE's own report list.

### Files Created or Modified
| File | Action |
|---|---|
| `frontend/src/pages/DailyProgress.jsx` | **NEW** |
| `frontend/src/api/dailyProgressApi.js` | **NEW** |

### API Client — `dailyProgressApi.js`

```javascript
import authApi from './authApi';

export const getProgressReports    = (params = {}) => authApi.get('/daily-progress', { params });
export const getProgressReportById = (id)          => authApi.get(`/daily-progress/${id}`);
export const createProgressReport  = (data)        => authApi.post('/daily-progress', data);
export const addAuthorityRemarks   = (id, data)    => authApi.patch(`/daily-progress/${id}/remarks`, data);

export const uploadSitePhoto = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return authApi.post('/daily-progress/upload/photo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
```

### Frontend Page — `DailyProgress.jsx` (JE View)

**Architecture:** Single-file page component following the existing glassmorphism dark pattern from `FundRequests.jsx` and `Requisitions.jsx` — Sidebar layout, Tailwind classes, stat cards, table list, slide-in form panel.

**JE Form — Detailed Field Spec:**

```
Section A: Auto-Populated Read-Only (top of form)
  Login Date   → current date/time from client clock
  User ID      → req.user.display_name or mobile_number (from useAuth context)

Section B: Work Order Selection
  Work Order No. → <select> dropdown from GET /api/v1/auth/projects
                   On change → auto-populate read-only fields:
  State           → read-only text
  District        → read-only text
  Area Code       → read-only text (projects_master.zone)
  Department      → read-only text
  Site Details    → read-only text
  (displayed in indigo auto-fill panel matching existing form design)

Section C: JE-Entered Fields
  Site Visit Date        → <input type="date" required> (max = today; no future dates)
  Work Progress Details  → <textarea required placeholder="Describe all work done at the site today">
  Physical Work Progress (%) → <input type="number" required min="0" max="100" step="0.01">

  Daily Site Photo       → <input type="file" accept="image/jpeg,image/png" required>
    Client-side validation before upload:
      - Must be JPEG or PNG (check file.type)
      - Must be <= 10MB (check file.size)
    On file select → call uploadSitePhoto(file) immediately
    Show: upload spinner → on success, thumbnail preview + original filename + "Photo Uploaded ✓"
    Store returned photo_url (storage path) and original_filename.

  Remarks After Site Visit → <textarea optional>

Submit Button: "Save Report"
  → Validates all required fields
  → Calls createProgressReport({
      work_order_no, site_visit_date, work_progress_details,
      physical_work_progress, daily_site_photo_url: photo_url_from_upload,
      original_photo_filename, remarks_after_site_visit
    })
  → On 201: success toast, close panel, refresh list
  → On 409 Conflict (non-Active WO): show error — "Daily progress reports can only be created for Active projects."
```

**JE List View:**

```
Header: "Daily Progress Reports" | "New Daily Report" button (JE only)
Stat Cards: Total Reports | Reports This Month | With Authority Remarks
Filter Controls: Work Order No. | Date From | Date To
Table: Work Order | Site Visit Date | Progress % | Work Details (truncated) | Photo | Remarks
Row click → Detail Drawer: full data + full-res photo (from signed URL) + read-only geo-fields
```

### Acceptance Criteria
```
✓ Work Order dropdown populates from /projects
✓ Geo-fields auto-populate on WO selection and are non-editable
✓ Photo upload triggers on file select; thumbnail preview shown
✓ Client-side validation rejects files > 10MB before upload
✓ Client-side validation rejects non-JPEG/PNG files
✓ Form submits → 201 → list refreshes
✓ 409 Conflict (non-Active WO) error displayed clearly
✓ Detail drawer shows full-size photo from signed URL
✓ JE can only see their own reports
✓ "New Daily Report" button hidden for ZO/HO/Admin
```

### Exit Criteria
```
✓ All acceptance criteria verified
✓ Photo upload and preview work end-to-end
✓ Ready to begin M6
```

---

## M6 — Frontend: Authority View & Remarks

### Objective
Build the ZO/HO/Admin view of `DailyProgress.jsx` — full list of all reports with filtering, and the authority remarks panel.

### Files Modified
| File | Action |
|---|---|
| `frontend/src/pages/DailyProgress.jsx` | **MODIFY** — add authority view and remarks panel |

### Authority View — Detailed Spec

```
Filter Bar (ZO/HO/Admin only):
  Work Order No. | Date From | Date To | JE (created_by)
  "Apply Filters" + "Clear" buttons

Table: JE Name | Work Order | Site Visit Date | Progress % | Remarks (Yes/No badge) | Submitted At

Row click → Detail Panel:
  Full report data + frozen geo-fields
  Photo Preview:
    → GET /daily-progress/:id → use photo_signed_url
    → Spinner while loading; "Photo unavailable" if null
  Authority Remarks Section:
    → <textarea> pre-filled with existing remarks_approved_authority
    → Placeholder: "Enter your authority remarks here..."
    Non-Active WO guard:
    → textarea disabled + lock icon + tooltip if work order is not Active
    → On 409 Conflict (non-Active): show error
    → Save Remarks button → addAuthorityRemarks(id, { remarks_approved_authority })
    → On 200: success toast, remarks badge updated
    → Disabled if WO is not Active or textarea is empty
```

### Acceptance Criteria
```
✓ ZO/HO/Admin see all reports (not filtered to own)
✓ All filters work correctly
✓ Photo loads from signed URL in detail panel
✓ "New Daily Report" button completely hidden for ZO/HO/Admin
✓ Remarks textarea pre-filled with existing remarks if already set
✓ Save Remarks → PATCH /:id/remarks → 200 → remarks updated
✓ Non-Active WO → textarea disabled, visual indicator shown, API returns 409 on any attempt
✓ Second authority can overwrite first authority's remarks
```

### Exit Criteria
```
✓ All acceptance criteria verified
✓ Signed photo URL loads correctly in detail panel
✓ Remarks flow works end-to-end for all authority roles
✓ Ready to begin M7
```

---

## M7 — Frontend: Dashboard Integration & Navigation

### Objective
Wire the Daily Progress module into `App.jsx` routing and add a navigation card on `Dashboard.jsx`.

### Files Modified
| File | Action |
|---|---|
| `frontend/src/App.jsx` | **MODIFY** — add `/daily-progress` route |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add Daily Progress module card |

### App.jsx Modification

```jsx
import DailyProgress from './pages/DailyProgress';

// Add inside a new ProtectedRoute group (staff excluded):
<Route element={<ProtectedRoute allowedRoles={['je', 'zo', 'ho', 'admin']} />}>
  <Route path="/daily-progress" element={<DailyProgress />} />
</Route>
```

### Dashboard.jsx Modification

Add a new glassmorphism module card after the Requisition Management card, visible only to `je`, `zo`, `ho`, `admin`:

```jsx
{['je', 'zo', 'ho', 'admin'].includes(user?.role) && (
  <div className="glass-panel glass-card-hover p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between min-h-[220px] glow-border-active shadow-[0_8px_32px_rgba(34,197,94,0.04)]">
    <div className="absolute top-0 right-0 p-5 opacity-[0.14]">
      <svg className="w-24 h-24 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    </div>
    <div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Field · Site Visits</span>
      <h3 className="text-lg font-extrabold mt-1 text-slate-200">Daily Work Progress</h3>
      <p className="text-xs text-slate-400 font-normal mt-4 leading-relaxed">
        Log daily site visit progress reports against work orders. Upload site photos, track cumulative physical progress, and enable authority review with remarks.
      </p>
    </div>
    <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-4">
      <span className="text-[9px] uppercase tracking-widest font-extrabold text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 px-2 py-0.5 rounded-lg">Active System</span>
      <Link
        to="/daily-progress"
        className="px-4 py-2 rounded-xl text-xs font-bold uppercase bg-white text-slate-950 hover:bg-slate-100 hover:shadow-lg transition-all duration-300 flex items-center gap-1.5"
      >
        Open Reports &rarr;
      </Link>
    </div>
  </div>
)}
```

### Acceptance Criteria
```
✓ /daily-progress route accessible to je, zo, ho, admin
✓ /daily-progress redirects/blocks staff role
✓ Dashboard card visible to je, zo, ho, admin — hidden from staff
✓ Navigation from Dashboard card to Daily Progress page works
✓ JE lands on own report list with "New Daily Report" button
✓ ZO/HO/Admin land on full all-reports view with filters
```

---

## M8 — Test Suite — Phase 5

### Objective
Create comprehensive automated tests for all milestones following the Phase 4 pattern: `mockRes()` helper, pass/fail counters, `try/catch/finally` with cleanup, `process.exit(0/1)`.

### Files Created or Modified
| File | Action |
|---|---|
| `backend/tests/milestones/test_milestone_p5_m1.js` | **NEW** — DB schema verification |
| `backend/tests/milestones/test_milestone_p5_m2.js` | **NEW** — Core CRUD API |
| `backend/tests/milestones/test_milestone_p5_m3.js` | **NEW** — Authority remarks |
| `backend/tests/milestones/test_milestone_p5_m4.js` | **NEW** — Photo upload & storage |
| `backend/package.json` | **MODIFY** — add test scripts |

### `test_milestone_p5_m1.js` — DB Schema Verification

```javascript
// Direct Supabase client calls (no HTTP)
// T1: Insert report with all required fields → row inserted + audit_log CREATE entry
// T2: Attempt DELETE → exception raised ("Hard deletion...prohibited")
// T3: Update any field → updated_at auto-updated by trigger
// T4: Insert with physical_work_progress = 101 → CHECK constraint violation
// T5: Insert with physical_work_progress = -1 → CHECK constraint violation
// T6: Insert with approved_user_id set but remarks_approved_authority = NULL → CHECK constraint violation
```

### `test_milestone_p5_m2.js` — Core CRUD API

```javascript
// All tests use mockRes() pattern, call controller functions directly
// T1:  POST — valid payload as 'je' (Active project) → 201, geo-fields match projects_master
// T2:  POST — as 'zo' → 403
// T3:  POST — as 'je' for Closed work order → 409 Conflict
// T3b: POST — as 'je' for Complete Under Maintenance work order → 409 Conflict
// T4:  POST — missing daily_site_photo_url → 400
// T5:  POST — physical_work_progress = 150 → 400
// T6:  POST — physical_work_progress = -5 → 400
// T7:  POST — work_order_no = 'NONEXISTENT' → 404
// T8:  GET / as 'je' → all results have created_by = je_mobile
// T9:  GET / as 'zo' → results not filtered by JE
// T10: GET /:id as 'je' for another JE's report → 404 (no ID leakage)
// T11: GET /:id as 'zo' → 200 + photo_signed_url starts with 'https://'
// T12: GET /?work_order_no=X&date_from=Y&date_to=Z → filtered results
// T13: GET /?page=1&limit=5 → pagination.limit = 5
```

### `test_milestone_p5_m3.js` — Authority Remarks

```javascript
// T1:  PATCH /:id/remarks as 'zo' → 200, approved_user_id = zo_mobile, approval_date set
// T2:  PATCH /:id/remarks as 'je' → 403
// T3:  PATCH /:id/remarks as 'ho' for Closed WO → 409 Conflict
// T4:  PATCH /:id/remarks with blank remarks → 400
// T5:  PATCH /:id/remarks on non-existent UUID → 404
// T6:  Second PATCH by 'admin' overwrites first 'zo' remarks → new approved_user_id
```

### `test_milestone_p5_m4.js` — Photo Upload & Storage

```javascript
// T1:  Upload valid JPEG <= 10MB as 'je' → 200, photo_url is UUID string
// T2:  Upload PDF as 'je' → 400 "Only image files are accepted (JPEG, JPG, PNG)."
// T3:  Upload image > 10MB as 'je' → 400 "File size must not exceed 10MB."
// T4:  Upload .jpg extension with application/pdf MIME → 400
// T5:  Upload as 'zo' → 403
// T6:  Verify bucket is private: direct GET on public object URL → 400 or 403
// T7:  GET /daily-progress/:id after upload → photo_signed_url present
// Cleanup (finally): supabase.storage.from('daily-progress-photos').remove([uploadedPath])
```

### package.json Additions

```json
{
  "scripts": {
    "test:p5:m1": "node tests/milestones/test_milestone_p5_m1.js",
    "test:p5:m2": "node tests/milestones/test_milestone_p5_m2.js",
    "test:p5:m3": "node tests/milestones/test_milestone_p5_m3.js",
    "test:p5:m4": "node tests/milestones/test_milestone_p5_m4.js",
    "test:p5:all": "node tests/milestones/test_milestone_p5_m1.js && node tests/milestones/test_milestone_p5_m2.js && node tests/milestones/test_milestone_p5_m3.js && node tests/milestones/test_milestone_p5_m4.js"
  }
}
```

### Exit Criteria
```
✓ All test files runnable: npm run test:p5:all exits 0
✓ Every test prints [PASS]
✓ Zero [FAIL] entries across all 4 test files
✓ Ready to begin M9
```

---

## M9 — UAT & Release Gate

### Objective
End-to-end manual verification by a real JE (reporter) and ZO/Admin (authority) in the deployed staging environment. No code changes at this stage.

### UAT Scenarios

**Scenario 1 — JE submits a daily report:**
1. JE logs in → navigates to "Daily Work Progress" from Dashboard card
2. Clicks "New Daily Report"
3. Selects Work Order No. from dropdown
4. Verifies: State, District, Area Code, Department, Site Details auto-populate and are read-only
5. Enters Site Visit Date (today or past — no future date)
6. Enters Work Progress Details (free text)
7. Enters Physical Work Progress: 45.00 (%)
8. Uploads a JPEG site photo (≤ 10MB) → thumbnail preview appears
9. Enters optional remarks → saves
10. Verifies: report appears in list with correct date and progress %

**Scenario 1b — JE uploads non-image file:**
1. JE selects a PDF in the photo upload field
2. Client shows error: "Only image files are accepted (JPEG, JPG, PNG)."
3. File not uploaded; form cannot be submitted

**Scenario 1c — JE submits for a non-Active work order:**
1. JE selects a non-Active work order
2. On submission, server returns 409 Conflict: "Daily progress reports can only be created for Active projects."

**Scenario 2 — JE views their own past report:**
1. JE clicks a row in their report list
2. Detail drawer opens; full-size photo loads from signed URL
3. No edit controls — report is read-only

**Scenario 3 — JE cannot see another JE's report:**
1. JE accesses `/daily-progress/:id` belonging to another JE
2. Returns 404 — no data visible

**Scenario 4 — ZO views all reports and adds remarks:**
1. ZO navigates to Daily Work Progress → sees all reports
2. Applies filter by Work Order → list narrows
3. Opens a report → photo loads in detail panel
4. Enters remarks → Save Remarks → 200 → badge shows "Yes"
5. Opens report again → textarea pre-filled with saved remarks

**Scenario 5 — Authority remarks blocked on non-Active WO:**
1. Authority opens a report on a non-Active WO
2. Remarks textarea is disabled; lock icon and tooltip visible
3. Direct API call → 409 Conflict

**Scenario 6 — Second authority overwrites first authority's remarks:**
1. ZO adds remarks → saved
2. HO opens same report → ZO's remarks pre-filled → HO saves new text
3. `approved_user_id` = HO mobile; `approval_date` updated

**Scenario 7 — Role boundaries enforcement:**
1. JE: "New Daily Report" button visible; no "Save Remarks" in any detail view
2. ZO: "New Daily Report" button hidden; no authority over creation
3. Staff: No access to `/daily-progress` — redirected

**Scenario 8 — Signed URL expiry:**
1. Open a report with a photo; note the signed URL
2. Wait 1+ hour; access the same URL → 400/403 (expired)
3. Reload report detail → fresh signed URL → photo loads again

### Release Checklist
```
✓ All 8 UAT scenarios (including 1b, 1c) pass
✓ Verify report creation succeeds for Active projects
✓ Verify report creation is blocked with 409 for Closed projects
✓ Verify report creation is blocked with 409 for Complete Under Maintenance projects
✓ No P1 or P2 defects open
✓ Migration 21 applied to production DB
✓ Supabase Storage bucket 'daily-progress-photos' created and private in production
✓ Server starts cleanly: npm start logs no errors
✓ Frontend builds cleanly: npm run build exits 0
✓ Phase 5 sign-off obtained from stakeholder
```

---

## Security Summary (Phase 5)

| ID | Concern | Severity | Control |
|---|---|---|---|
| SEC-P5-1 | MIME type enforcement — JPEG/PNG only | **HIGH** | Server-side `mimetype` check — file extension never inspected |
| SEC-P5-2 | File size enforcement ≤ 10MB | **HIGH** | Multer `limits.fileSize` + re-validation in controller |
| SEC-P5-3 | Private bucket + signed URLs | **HIGH** | Bucket = private; `createSignedUrl(path, 3600)` at read time only |
| SEC-P5-4 | JE record isolation | **HIGH** | Visibility gate returns `404` (not `403`) — prevents ID enumeration |
| SEC-P5-5 | Remarks gated on WO status | **MEDIUM** | `addAuthorityRemarks` fetches `projects_master.status` before every write |
| SEC-P5-6 | DB-level progress bounds | **MEDIUM** | `CONSTRAINT chk_physical_work_progress CHECK (>= 0 AND <= 100)` |
| SEC-P5-7 | Report immutability | **MEDIUM** | No PATCH/DELETE route for `je`; DB trigger blocks all DELETEs |
| SEC-P5-8 | Storage path traversal prevention | **MEDIUM** | Path = `{uuidv4()}.{ext}` (server-generated); user filename in `original_photo_filename` only |

---

## Migration Sequence

All migrations are idempotent and must be run in order:

| Step | File | Notes |
|---|---|---|
| 21 | `21_create_daily_progress_reports.sql` | New table, indexes, triggers, CHECK constraints |

**Pre-flight check before applying migration:**
```sql
-- Verify migration 20 was applied
SELECT table_name FROM information_schema.tables WHERE table_name = 'requisitions';
-- Expected: 1 row

-- Check table doesn't already exist
SELECT table_name FROM information_schema.tables WHERE table_name = 'daily_progress_reports';
-- Expected: 0 rows (not yet created)
```

---

## File Inventory (Complete)

| File | Action | Component |
|---|---|---|
| `backend/src/db/migrations/21_create_daily_progress_reports.sql` | **NEW** | M1 — DB |
| `backend/src/validation/dailyProgress.schema.js` | **NEW** | M2 — Zod Schemas |
| `backend/src/controllers/dailyProgress.controller.js` | **NEW** | M2, M3 — API |
| `backend/src/controllers/dailyProgress.uploads.controller.js` | **NEW** | M4 — Uploads |
| `backend/src/routes/dailyProgress.routes.js` | **NEW** | M2, M3, M4 — Routes |
| `backend/src/app.js` | **MODIFY** — add route mount | M2 |
| `frontend/src/pages/DailyProgress.jsx` | **NEW** | M5, M6 — Frontend |
| `frontend/src/api/dailyProgressApi.js` | **NEW** | M5 — API Client |
| `frontend/src/App.jsx` | **MODIFY** — add route | M7 |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add nav card | M7 |
| `backend/tests/milestones/test_milestone_p5_m1.js` | **NEW** | M8 — DB Tests |
| `backend/tests/milestones/test_milestone_p5_m2.js` | **NEW** | M8 — CRUD Tests |
| `backend/tests/milestones/test_milestone_p5_m3.js` | **NEW** | M8 — Remarks Tests |
| `backend/tests/milestones/test_milestone_p5_m4.js` | **NEW** | M8 — Upload Tests |
| `backend/package.json` | **MODIFY** — add test scripts | M8 |

---

## Dependency Graph

```
M1 (DB Foundation)
 └─► M2 (Core CRUD API)
      └─► M3 (Authority Remarks API)
      │    └─► M6 (Frontend Authority View)
      │         └─► M7 (Dashboard Integration)
      │
      └─► M4 (Photo Upload API)
           └─► M5 (Frontend JE View)
                └─► M6 (Frontend Authority View)

All of M1–M7 → M8 (Test Suite) → M9 (UAT & Release Gate)
```
