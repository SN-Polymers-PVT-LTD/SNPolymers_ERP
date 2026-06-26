# Phase 5: Daily Work Progress Module — Implementation Plan

> **Status:** Draft — Pending approval.
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Builds on:** Phase 1 (auth, sessions) + Phase 2 (projects_master, estimates) + Phase 3 (fund requests) + Phase 4 (requisitions)
> **Reference:** Phase 5 Daily Work Progress Workflow Diagram + Daily Work Progress Screen-4(1).xlsx (Entry_Screen_4 sheet)

---

## Background & Scope

Phase 5 introduces the **Daily Work Progress Module** — a daily site-visit tracking system that allows Junior Engineers (JEs) to submit a structured daily report for each work order they are active on. Unlike Phases 3 and 4, this module has **no approval workflow or state machine**. A submitted report is final and immediately visible to all authorised viewers.

The interaction model is two-sided:

1. **Step 1 — Daily Progress Entry (by JE):** The JE logs in; the system auto-captures login date and user ID. They select a Work Order Number from master data; the system auto-fetches the geographic metadata (State, District, Area Code, Department, Site Details) as a frozen snapshot. The JE then enters the Site Visit Date, Work Progress Details (free text), Physical Work Progress (cumulative %, JE-maintained), uploads a single Site Photo, and optionally enters Remarks After Site Visit. On save, the report is immediately stored and viewable — no further workflow step exists.

2. **Step 2 — View & Remarks by Authority (ZO / HO / Admin):** Authorities access a list of all submitted daily progress reports. They view the full details including the uploaded photo (via signed URL). They may optionally write or overwrite the `Remarks_Approved_Authority` field. This remark is the only field an authority can modify. Remarks remain editable until the parent Work Order's status in `projects_master` becomes `Closed`.

### What Phase 5 delivers

| Actor | Action |
|---|---|
| **JE (Reporter)** | Creates one daily progress report per work order per day. Uploads one Site Photo per report. Views only own reports. Cannot edit submitted reports. |
| **ZO / HO / Admin (Viewer)** | Views all submitted reports. Optionally adds or overwrites authority remarks. Remarks are blocked if the work order is Closed. |
| **System** | Auto-fetches and freezes geo-metadata from `projects_master` at submission time. Generates signed URLs for photo viewing. Audits all inserts. |

### What Phase 5 does NOT change
- The fund reports module (Phase 1) is not touched.
- The estimates workflow (Phase 2) is frozen — no modifications.
- The fund requests module (Phase 3) is independent and not linked.
- The requisitions module (Phase 4) is independent and not linked.
- Auth, sessions, OTP, and user management are unchanged.

---

## Role Architecture

| Role | Phase 5 Responsibility |
|---|---|
| `je` | **Creates** daily progress reports. Views own reports only. Cannot edit after submission. |
| `zo` | **Views** all reports. **Adds/overwrites** authority remarks (if work order is not Closed). |
| `ho` | **Views** all reports. **Adds/overwrites** authority remarks (if work order is not Closed). |
| `admin` | **Views** all reports. **Adds/overwrites** authority remarks (if work order is not Closed). |
| `staff` | No access to the Daily Progress Module. |

> [!IMPORTANT]
> **Role boundaries are firm:**
> - Only `je` can submit (create) a daily progress report.
> - Only `zo`, `ho`, and `admin` can write authority remarks.
> - No role can delete or edit a submitted report's JE-entered fields.
> - Reports are permanently immutable once submitted.

---

## Resolved Design Questions

> [!NOTE]
> **Q1 — Single or multiple photos per report?**
> **Resolution:** One photo per report row. Only the latest uploaded photo is stored (single `TEXT` column — no child table needed). If the JE uploads multiple times before saving, only the final URL is stored.
>
> **Q2 — Can authorities overwrite each other's remarks?**
> **Resolution:** YES — the single `remarks_approved_authority` field is shared. Any `zo`, `ho`, or `admin` can overwrite it at any time, as long as the work order is not Closed. The `approved_user_id` and `approval_date` reflect the most recent writer.
>
> **Q3 — Can JE edit a submitted report?**
> **Resolution:** NO — reports are immutable once saved. The JE cannot modify any previously submitted report. A trigger blocks hard deletes. No PATCH endpoint is exposed to `je`.
>
> **Q4 — Is `physical_work_progress` cumulative or per-day?**
> **Resolution:** Cumulative (overall work progress %). The JE maintains this figure per company policy. The backend simply stores what the JE enters — no computation or cross-row validation is performed.
>
> **Q5 — Supabase Storage bucket name?**
> **Resolution:** `daily-progress-photos` — private bucket, signed URLs generated at read time (TTL: 1 hour).
>
> **Q6 — Filtering on list endpoint?**
> **Resolution:** YES — list endpoint supports `?work_order_no=`, `?date_from=`, `?date_to=`, and `?created_by=` (ZO/HO/Admin only) query params, plus standard `page` and `limit` pagination.

---

## Proposed Changes

---

### Component 1 — Database Migration

#### [NEW] `backend/src/db/migrations/21_create_daily_progress_reports.sql`

Creates the `daily_progress_reports` table with all columns, indexes, and triggers. Migration number `21` follows migration `20_create_requisitions.sql` from Phase 4.

**Table `daily_progress_reports`:**

| Column | Type | Notes |
|---|---|---|
| `report_id` | UUID PK | Auto-generated |
| `created_by` | VARCHAR FK → authorised_users | Auto from session (JE mobile number) |
| `login_date` | TIMESTAMPTZ | Auto — server timestamp at creation |
| `work_order_no` | VARCHAR FK → projects_master | Required — selected by JE |
| `state` | VARCHAR | Frozen snapshot from projects_master |
| `district` | VARCHAR | Frozen snapshot from projects_master |
| `area_code` | VARCHAR | Frozen snapshot (maps to `zone` column) |
| `department` | VARCHAR | Frozen snapshot from projects_master |
| `site_details` | TEXT | Frozen snapshot from projects_master |
| `site_visit_date` | DATE | Required — JE-entered date |
| `work_progress_details` | TEXT | Required — free-text, all work done that day |
| `physical_work_progress` | NUMERIC(5,2) | Required — cumulative %, 0.00–100.00 |
| `daily_site_photo_url` | TEXT | Required — storage path in private bucket |
| `original_photo_filename` | VARCHAR | Optional — original filename for display |
| `remarks_after_site_visit` | TEXT | Optional — JE remarks |
| `remarks_approved_authority` | TEXT | Optional — written by ZO/HO/Admin post-creation |
| `approved_user_id` | VARCHAR FK → authorised_users | Who last wrote authority remarks |
| `approval_date` | TIMESTAMPTZ | When authority remarks were last written |
| `created_at` | TIMESTAMPTZ | Auto |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

**Constraints:**
- `CHECK (physical_work_progress >= 0 AND physical_work_progress <= 100)` — progress bounds enforcement.
- `CHECK (approved_user_id IS NULL OR remarks_approved_authority IS NOT NULL)` — approved_user_id must only be set when remarks exist.

**Indexes:**
- `idx_daily_progress_work_order` — on `work_order_no` (lookup by project)
- `idx_daily_progress_created_by` — on `created_by` (JE's own records)
- `idx_daily_progress_site_visit_date` — on `site_visit_date` (date range filtering)

**Triggers:**
- `trg_daily_progress_updated_at` — Auto-updates `updated_at` on any UPDATE
- `trg_prevent_daily_progress_hard_delete` — Raises EXCEPTION on hard DELETE
- `trg_audit_daily_progress_insert` — Logs every INSERT to `audit_log` with `action = 'CREATE'`, `module_name = 'DailyProgress'`

**Full SQL:**

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
  original_photo_filename      VARCHAR,                  -- Original filename for UI display
  remarks_after_site_visit     TEXT,                     -- Optional JE remarks

  -- Authority remark fields (post-creation, written by ZO/HO/Admin)
  remarks_approved_authority   TEXT,
  approved_user_id             VARCHAR REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT,
  approval_date                TIMESTAMPTZ,

  -- Integrity: progress must be between 0 and 100
  CONSTRAINT chk_physical_work_progress
    CHECK (physical_work_progress >= 0 AND physical_work_progress <= 100),

  -- Integrity: approved_user_id only set when authority remarks exist
  CONSTRAINT chk_authority_remarks_consistency
    CHECK (approved_user_id IS NULL OR remarks_approved_authority IS NOT NULL),

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
-- 4. Trigger: block hard DELETE (reports are permanent records)
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

**Supabase Storage Bucket to Create (Manual Step in Dashboard):**

| Bucket Name | Access | Notes |
|---|---|---|
| `daily-progress-photos` | **Private** | Stores Site Photos uploaded by JEs |

> [!IMPORTANT]
> The bucket MUST be set to **private** in the Supabase Dashboard. Signed URLs (TTL: 1 hour) will be generated via the backend for every photo view request. Do NOT make this bucket public.

**Acceptance Criteria:**
```
✓ daily_progress_reports table exists with all columns
✓ CONSTRAINT chk_physical_work_progress enforced (0–100)
✓ CONSTRAINT chk_authority_remarks_consistency enforced
✓ 3 indexes created
✓ trg_daily_progress_updated_at fires on UPDATE (updated_at changes)
✓ trg_prevent_daily_progress_hard_delete raises exception on DELETE
✓ trg_audit_daily_progress_insert inserts into audit_log on INSERT
✓ Supabase Storage bucket created and set to private
```

---

### Component 2 — Backend: Daily Progress API

#### [NEW] `backend/src/validation/dailyProgress.schema.js`

Zod schema definitions for all endpoints.

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
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'site_visit_date must be a valid date in YYYY-MM-DD format.'),

    work_progress_details: z.string({ required_error: 'work_progress_details is required.' })
      .trim().min(1, 'work_progress_details is required.'),

    physical_work_progress: z.union([z.number(), z.string()], {
      required_error: 'physical_work_progress must be a number between 0 and 100.'
    })
      .transform(val => Number(val))
      .refine(val => !isNaN(val) && val >= 0 && val <= 100 && isFinite(val),
        'physical_work_progress must be a number between 0 and 100.'),

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

---

#### [NEW] `backend/src/controllers/dailyProgress.controller.js`

Four controller functions:

| Function | Method | Path | Access | Description |
|---|---|---|---|---|
| `createProgressReport` | POST | `/` | `je` | Create a new daily progress report |
| `getProgressReports` | GET | `/` | `je`, `zo`, `ho`, `admin` | List reports (role-filtered, paginated, with filters) |
| `getProgressReportById` | GET | `/:id` | `je`, `zo`, `ho`, `admin` | Single report detail (visibility-gated + signed photo URL) |
| `addAuthorityRemarks` | PATCH | `/:id/remarks` | `zo`, `ho`, `admin` | Add or overwrite authority remarks |

---

##### `createProgressReport(req, res)` — `POST /api/v1/auth/daily-progress`

**Access:** `['je']` only

```
1. Input validation: handled at route level by validateRequest(createProgressReportSchema).

2. Validate work_order_no exists in projects_master:
   SELECT status, state, district, zone, department, site_details
   FROM projects_master WHERE work_order_no = $1
   → 404 if not found: "Work order not found."
   → 403 if status = 'Closed': "Daily progress reports cannot be submitted for Closed work orders."

3. Build insert payload:
   {
     created_by:               req.user.mobile_number,
     login_date:               now() (DB default),
     work_order_no:            work_order_no.trim(),
     state:                    project.state,           // frozen snapshot
     district:                 project.district,        // frozen snapshot
     area_code:                project.zone,            // maps zone → area_code
     department:               project.department,      // frozen snapshot
     site_details:             project.site_details,    // frozen snapshot
     site_visit_date:          site_visit_date,
     work_progress_details:    work_progress_details.trim(),
     physical_work_progress:   Number(physical_work_progress),
     daily_site_photo_url:     daily_site_photo_url.trim(),
     original_photo_filename:  original_photo_filename || null,
     remarks_after_site_visit: remarks_after_site_visit?.trim() || null
   }

4. Insert into daily_progress_reports.

5. Return 201:
   { success: true, report: { ...created_row } }
```

---

##### `getProgressReports(req, res)` — `GET /api/v1/auth/daily-progress`

**Access:** `['je', 'zo', 'ho', 'admin']`

```
Query params:
  page           (default 1)
  limit          (default 50, max 100)
  work_order_no  (optional filter — all roles)
  date_from      (optional ISO date filter on site_visit_date — all roles)
  date_to        (optional ISO date filter on site_visit_date — all roles)
  created_by     (optional — ZO/HO/Admin only; JE cannot filter by other users)

Role-based record visibility:
  'je':    WHERE created_by = req.user.mobile_number  (own records only)
  'zo':    all records
  'ho':    all records
  'admin': all records

Apply optional filters (validate date formats and work_order_no before applying):
  - work_order_no: exact match
  - date_from:     site_visit_date >= date_from
  - date_to:       site_visit_date <= date_to
  - created_by:    exact match (blocked for 'je' role — ignored if provided)

Order: site_visit_date DESC, created_at DESC.

Paginate: RANGE(offset, offset+limit-1) with count: 'exact'.

Resolve display names (display_name) for created_by and approved_user_id
by fetching from authorised_users.

Return: { success, reports, pagination: { page, limit, total, totalPages } }

NOTE: Photo URLs in the list view are NOT signed — only the relative storage path
is returned for performance. Signed URLs are generated only on getProgressReportById.
```

---

##### `getProgressReportById(req, res)` — `GET /api/v1/auth/daily-progress/:id`

**Access:** `['je', 'zo', 'ho', 'admin']`

```
1. Validate report_id as valid UUID → 400 if invalid.
2. Fetch report from daily_progress_reports → 404 if not found.
3. Visibility gate:
   'je':    created_by must = req.user.mobile_number → else 404 (no ID leakage)
   'zo':    always visible
   'ho':    always visible
   'admin': always visible
4. Resolve display names for created_by and approved_user_id.
5. Generate a fresh signed URL for daily_site_photo_url:
   supabase.storage.from('daily-progress-photos').createSignedUrl(path, 3600)
   → Include as photo_signed_url in response.
   → If URL generation fails, return photo_signed_url: null (don't block the response).
6. Return enriched report object.
```

---

##### `addAuthorityRemarks(req, res)` — `PATCH /api/v1/auth/daily-progress/:id/remarks`

**Access:** `['zo', 'ho', 'admin']`

```
1. Validate report_id as valid UUID → 400 if invalid.
2. Fetch report → 404 if not found.
3. Fetch work order status from projects_master:
   SELECT status FROM projects_master WHERE work_order_no = $1
4. Work order status guard:
   IF status = 'Closed':
   → 403: "Authority remarks cannot be added or modified for Closed work orders."
5. Build update payload:
   {
     remarks_approved_authority: remarks_approved_authority.trim(),
     approved_user_id:           req.user.mobile_number,
     approval_date:              new Date().toISOString()
   }
6. Update record.
7. Return 200 with updated report.
```

---

#### [NEW] `backend/src/controllers/dailyProgress.uploads.controller.js`

Handles Supabase Storage image upload.

| Function | Method | Path | Access | Description |
|---|---|---|---|---|
| `uploadSitePhoto` | POST | `/upload/photo` | `je` | Upload a Site Photo |

```
uploadSitePhoto(req, res):
  1. Expect multipart/form-data with a single file field named 'file'.
  2. Validate MIME type: must be one of image/jpeg, image/png
     → 400: "Only image files are accepted (JPEG, JPG, PNG)."
  3. Validate file size: must be ≤ 10MB (10 * 1024 * 1024 bytes)
     → 400: "File size must not exceed 10MB."
  4. Generate storage path: daily-progress-photos/{uuid}.{ext}
     where uuid = uuidv4() and ext is derived from MIME type.
  5. Upload to Supabase Storage:
     supabase.storage.from('daily-progress-photos').upload(path, buffer, { contentType: mimetype })
  6. Return 200: { success: true, photo_url: storagePath, original_filename: originalname }

NOTE: The returned photo_url is the relative storage path, NOT a signed URL.
The signed URL is generated at read time (getProgressReportById).
```

---

#### [NEW] `backend/src/routes/dailyProgress.routes.js`

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
const { validateRequest } = require('../middleware/validateRequest');
const {
  createProgressReportSchema,
  addRemarksSchema,
  getReportByIdSchema
} = require('../validation/dailyProgress.schema');
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }  // 10MB
});

router.use(verifyJwt);

const creatorRoles  = ['je'];
const viewerRoles   = ['je', 'zo', 'ho', 'admin'];
const remarksRoles  = ['zo', 'ho', 'admin'];

// Report CRUD
router.post('/',    requireRole(creatorRoles), validateRequest(createProgressReportSchema), createProgressReport);
router.get('/',     requireRole(viewerRoles),  getProgressReports);
router.get('/:id',  requireRole(viewerRoles),  validateRequest(getReportByIdSchema),        getProgressReportById);

// Authority remarks
router.patch('/:id/remarks', requireRole(remarksRoles), validateRequest(addRemarksSchema), addAuthorityRemarks);

// Photo upload — JE only
router.post('/upload/photo', requireRole(creatorRoles), upload.single('file'), uploadSitePhoto);

module.exports = router;
```

---

#### [MODIFY] `backend/src/app.js`

Add the new route mount after the existing requisitions mount:

```javascript
const dailyProgressRoutes = require('./routes/dailyProgress.routes');
// ...
app.use('/api/v1/auth/daily-progress', dailyProgressRoutes);
```

---

### Component 3 — Frontend

#### [NEW] `frontend/src/pages/DailyProgress.jsx`

A full-featured Daily Work Progress management page with role-based views.

**JE View (Requester):**
- List of own daily progress reports ordered by site_visit_date DESC.
- Each row shows: Work Order No, Site Visit Date, Physical Progress %, truncated Work Details, photo thumbnail (or icon), and whether authority remarks exist.
- **"New Daily Report" button** → opens a form panel/modal.
- **Form Fields (matching the flow diagram):**
  - Auto-populated read-only fields (displayed at top):
    - `Login Date` — current date/time
    - `User ID` — logged-in JE's name/mobile
  - `Work Order No` — dropdown fetched from `GET /api/v1/auth/projects`
  - Auto-populated read-only (populated after WO selected):
    - `State`, `District`, `Area Code`, `Department`, `Site Details`
  - `Site Visit Date` — date picker (required)
  - `Work Progress Details` — textarea (required; placeholder: "Describe all work done at the site today")
  - `Physical Work Progress (%)` — numeric input, 0–100 (required)
  - `Daily Site Photo` — image file upload (required; max 10MB; JPEG/JPG/PNG only)
    - Shows file name and preview thumbnail after upload
  - `Remarks After Site Visit` — textarea (optional)
  - **Save button** → submits to API
- **Detail drawer/modal** on row click: shows all fields + full-size photo (signed URL).

**Authority View (ZO / HO / Admin):**
- Full list of all reports with filtering controls:
  - Filter by Work Order No
  - Filter by Date Range (date_from / date_to)
  - Filter by JE (created_by name — ZO/HO/Admin only)
- Each row shows: JE name, Work Order No, Site Visit Date, Physical Progress %, whether authority remarks exist (badge).
- **Detail panel** on row click: shows full report data, photo preview (signed URL), and:
  - `Remarks by Authority` text area (pre-filled if remarks exist).
  - **Save Remarks** button → `PATCH /:id/remarks`
  - Remarks are disabled if work order status is `Closed` (visual indicator + tooltip).

---

#### [NEW] `frontend/src/api/dailyProgressApi.js`

Axios client module for all daily progress endpoints.

```javascript
import authApi from './authApi';

// Report CRUD
export const createProgressReport = (data)        => authApi.post('/daily-progress', data);
export const getProgressReports   = (params)      => authApi.get('/daily-progress', { params });
export const getProgressReportById = (id)         => authApi.get(`/daily-progress/${id}`);

// Authority remarks
export const addAuthorityRemarks  = (id, data)    => authApi.patch(`/daily-progress/${id}/remarks`, data);

// Photo upload
export const uploadSitePhoto = (formData) =>
  authApi.post('/daily-progress/upload/photo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
```

---

#### [MODIFY] `frontend/src/App.jsx`

Add the `DailyProgress` page route inside the existing protected route group for `['je', 'zo', 'ho', 'admin']`:

```jsx
import DailyProgress from './pages/DailyProgress';
// ...
<Route element={<ProtectedRoute allowedRoles={['je', 'zo', 'ho', 'admin']} />}>
  <Route path="/daily-progress" element={<DailyProgress />} />
</Route>
```

---

#### [MODIFY] `frontend/src/pages/Dashboard.jsx`

Add a navigation card for the Daily Progress module, visible to `je`, `zo`, `ho`, and `admin`. Match the existing glassmorphism module card design pattern. Do not show this card to `staff`.

---

### Component 4 — Security Considerations (Phase 5 Specific)

| # | Concern | Severity | Resolution |
|---|---|---|---|
| SEC-P5-1 | **Image MIME type enforcement** — Must validate `mimetype` is a real image type (`image/jpeg`, `image/png`), not just the file extension | **HIGH** | `fileFilter` in multer config + server-side MIME check in controller |
| SEC-P5-2 | **File size limit** — Site photos from mobile devices can exceed 15MB | **HIGH** | Enforce ≤ 10MB via multer `limits.fileSize` AND re-validate in controller |
| SEC-P5-3 | **Private bucket + signed URL** — Photo bucket `daily-progress-photos` must never be publicly readable | **HIGH** | Bucket configured as private in Supabase Dashboard; `createSignedUrl(path, 3600)` at read time only |
| SEC-P5-4 | **JE record isolation** — JE must not be able to read other JEs' report IDs or details | **HIGH** | Visibility gate in `getProgressReportById` returns 404 (not 403) for non-owner JE |
| SEC-P5-5 | **Authority remarks gated on work order status** — Remarks must be blocked if parent work order is `Closed` | **MEDIUM** | `addAuthorityRemarks` fetches `projects_master.status` before write; 403 if Closed |
| SEC-P5-6 | **Physical progress DB bounds** — Must be enforced at DB level, not just application layer | **MEDIUM** | `CONSTRAINT chk_physical_work_progress CHECK (physical_work_progress >= 0 AND physical_work_progress <= 100)` |
| SEC-P5-7 | **JE report immutability** — No PATCH endpoint exposed to `je`; only `addAuthorityRemarks` exists for updates | **MEDIUM** | No PATCH route for `creatorRoles`; DB trigger blocks DELETE |
| SEC-P5-8 | **Storage path traversal** — Photo paths use UUID-based names generated server-side, not user-supplied filenames | **MEDIUM** | Path is `{uuidv4()}.{safe_ext}` — user-supplied filename stored separately as `original_photo_filename` only |

---

## Verification Plan

### Automated Tests

All new milestone test files follow the Phase 3/4 naming convention in `backend/tests/milestones/`.

**New milestone test files:**
- `backend/tests/milestones/test_milestone_p5_m1.js` — DB schema verification (table, indexes, triggers, constraints)
- `backend/tests/milestones/test_milestone_p5_m2.js` — API CRUD tests (create report, list, get by ID)
- `backend/tests/milestones/test_milestone_p5_m3.js` — Authority remarks tests (add, overwrite, Closed WO guard)
- `backend/tests/milestones/test_milestone_p5_m4.js` — Photo upload validation tests (MIME, size, path safety)

**`package.json` additions:**
```json
"test:p5:m1": "node tests/milestones/test_milestone_p5_m1.js",
"test:p5:m2": "node tests/milestones/test_milestone_p5_m2.js",
"test:p5:m3": "node tests/milestones/test_milestone_p5_m3.js",
"test:p5:m4": "node tests/milestones/test_milestone_p5_m4.js",
"test:p5:all": "node tests/milestones/test_milestone_p5_m1.js && node tests/milestones/test_milestone_p5_m2.js && node tests/milestones/test_milestone_p5_m3.js && node tests/milestones/test_milestone_p5_m4.js"
```

**M1 Test Cases:**
- **Test 1:** Insert a report row with all required fields. Expected: row inserted, `audit_log` has a `CREATE` entry.
- **Test 2:** Attempt `DELETE FROM daily_progress_reports WHERE report_id = <any>`. Expected: exception — "Hard deletion of daily progress reports is permanently prohibited."
- **Test 3:** Update any field (e.g., `remarks_after_site_visit`). Expected: `updated_at` automatically updated.
- **Test 4:** Insert a row with `physical_work_progress = 101`. Expected: CHECK constraint violation.
- **Test 5:** Insert a row with `physical_work_progress = -1`. Expected: CHECK constraint violation.
- **Test 6:** Insert a row with `approved_user_id` set but `remarks_approved_authority = NULL`. Expected: CHECK constraint violation.

**M2 Test Cases:**
- **Test 1:** `POST /daily-progress` as `je` with all valid fields. Expected: 201, geo-fields auto-populated from `projects_master`.
- **Test 2:** `POST /daily-progress` as `zo`. Expected: 403 — JE-only creation.
- **Test 3:** `POST /daily-progress` as `je` with a Closed work order. Expected: 403 — "Cannot submit for Closed work orders."
- **Test 4:** `POST /daily-progress` with missing `daily_site_photo_url`. Expected: 400.
- **Test 5:** `POST /daily-progress` with `physical_work_progress = 150`. Expected: 400.
- **Test 6:** `POST /daily-progress` with `physical_work_progress = -5`. Expected: 400.
- **Test 7:** `POST /daily-progress` with invalid `work_order_no`. Expected: 404.
- **Test 8:** `GET /daily-progress` as `je` — only own reports returned. Expected: all items have `created_by = req.user.mobile_number`.
- **Test 9:** `GET /daily-progress` as `zo` — all reports returned (not filtered by JE).
- **Test 10:** `GET /daily-progress/:id` as `je` where the report belongs to a different JE. Expected: 404 (no ID leakage).
- **Test 11:** `GET /daily-progress/:id` as `zo` — any report. Expected: 200, `photo_signed_url` present in response.
- **Test 12:** `GET /daily-progress?work_order_no=X&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`. Expected: filtered results.
- **Test 13:** Pagination — `GET /daily-progress?page=1&limit=5`. Expected: `pagination.limit = 5`, `pagination.total` ≥ 0.

**M3 Test Cases:**
- **Test 1:** `PATCH /daily-progress/:id/remarks` as `zo` with valid remarks. Expected: 200, `remarks_approved_authority` updated, `approved_user_id = zo_mobile`, `approval_date` set.
- **Test 2:** `PATCH /daily-progress/:id/remarks` as `je`. Expected: 403 — JE cannot add authority remarks.
- **Test 3:** `PATCH /daily-progress/:id/remarks` as `ho` for a report whose work order is `Closed`. Expected: 403 — "Authority remarks cannot be added or modified for Closed work orders."
- **Test 4:** `PATCH /daily-progress/:id/remarks` with blank remarks. Expected: 400.
- **Test 5:** `PATCH /daily-progress/:id/remarks` as `admin` on a non-existent report ID. Expected: 404.
- **Test 6:** `PATCH /daily-progress/:id/remarks` — second call overwrites first remarks and updates `approved_user_id` and `approval_date`. Expected: 200, new values stored.

**M4 Test Cases:**
- **Test 1:** Upload a valid JPEG file ≤ 10MB as `je`. Expected: 200, `photo_url` (storage path) returned.
- **Test 2:** Upload a PDF file as `je`. Expected: 400 — "Only image files are accepted."
- **Test 3:** Upload an image > 10MB. Expected: 400 — "File size must not exceed 10MB."
- **Test 4:** Upload a file with `.jpg` extension but `application/pdf` MIME type. Expected: 400 — MIME type check catches disguised file.
- **Test 5:** Upload as `zo`. Expected: 403 — JE-only upload.

### Manual Verification
- JE logs in → selects Work Order → geo-metadata auto-populates.
- JE uploads site photo → thumbnail preview appears → saves report → status immediately visible.
- JE views their own past reports. Cannot see other JEs' reports.
- ZO logs in → sees all reports across all JEs → clicks a report → photo loads via signed URL.
- ZO enters authority remarks → saves → remarks appear on subsequent view.
- ZO tries to add remarks on a Closed work order report → receives error.
- JE tries to access a PATCH endpoint on their own report → 403 (no edit route exists for JE).
- Signed photo URL expires after 1 hour (manual TTL verification).

---

## Migration Sequence

| Step | File | Notes |
|---|---|---|
| 21 | `21_create_daily_progress_reports.sql` | New table, indexes, triggers, constraints |

Apply this migration after confirming Migrations 01–20 are already applied.

---

## File Inventory

| File | Action | Component |
|---|---|---|
| `backend/src/db/migrations/21_create_daily_progress_reports.sql` | **NEW** | 1 — DB |
| `backend/src/validation/dailyProgress.schema.js` | **NEW** | 2 — Validation |
| `backend/src/controllers/dailyProgress.controller.js` | **NEW** | 2 — API |
| `backend/src/controllers/dailyProgress.uploads.controller.js` | **NEW** | 2 — API (File Uploads) |
| `backend/src/routes/dailyProgress.routes.js` | **NEW** | 2 — API |
| `backend/src/app.js` | **MODIFY** — add route mount | 2 — API |
| `frontend/src/pages/DailyProgress.jsx` | **NEW** | 3 — Frontend |
| `frontend/src/api/dailyProgressApi.js` | **NEW** | 3 — Frontend |
| `frontend/src/App.jsx` | **MODIFY** — add route | 3 — Frontend |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add nav card | 3 — Frontend |
| `backend/tests/milestones/test_milestone_p5_m1.js` | **NEW** | Tests — DB Schema |
| `backend/tests/milestones/test_milestone_p5_m2.js` | **NEW** | Tests — CRUD API |
| `backend/tests/milestones/test_milestone_p5_m3.js` | **NEW** | Tests — Authority Remarks |
| `backend/tests/milestones/test_milestone_p5_m4.js` | **NEW** | Tests — Photo Upload |
| `backend/package.json` | **MODIFY** — add test scripts | Tests |
