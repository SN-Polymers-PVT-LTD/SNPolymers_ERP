# Phase 4: Requisition Management Module — Implementation Plan

> **Status:** Approved — Ready for execution.
> **Stack:** Supabase/PostgreSQL · Node.js/Express backend · React/Vite frontend
> **Builds on:** Phase 1 (auth, fund reports) + Phase 2 (estimates, review workflow) + Phase 3 (fund requests)
> **Reference:** Requisition Management Flow diagram + Excel data spec sheet

---

## Background & Scope

Phase 4 introduces the **Requisition Module** — a formal purchase requisition system for JE users to submit payment requests against a work order estimate, which then flow through a ZO/HO authority approval gate. This is a **two-step workflow**:

1. **Step 1 — Requisition Creation (by JE):** The JE logs in; the system auto-captures the login date and user ID. They select Work Order No. and the linked Estimate No. auto-populates along with geographic metadata and the Estimate Amount. The JE enters a unique Requisition Number, selects Material Main Head (dropdown from `material_master`), uploads the requisition PDF (file name must match the Requisition No.), enters the Requisition Amount (which must be **> 0 and ≤ Remaining Estimate Amount**), declares GST status (and optionally uploads a GST bill), provides bank details and expenditure head remarks, then saves.

2. **Step 2 — Approval by Authority (ZO or HO):** The authority (ZO or HO) reviews pending requisitions. The system auto-captures Approver User ID and Payment Date. The authority selects `Approve_type` (Approve / Hold). On **Approve**: enters `Approved_Amount`, the `Approved_Balance_Amount` is auto-computed as `Requisition_Amount − Approved_Amount`, and enters `Remarks_Approved_Authority`. On **Hold**: all those fields are hidden and not required.

### What Phase 4 delivers

| Actor | Action |
|---|---|
| **JE (Requester)** | Creates a new requisition linked to a Work Order + Estimate. Requisition Amount must be > 0 and ≤ Remaining Estimate Amount. Uploads Requisition PDF and optional GST Bill PDF. Enters bank details and expenditure head remarks. |
| **ZO or HO (Approver)** | Reviews pending requisitions. Approves (with approved amount and remarks) or Holds. System auto-stamps approver ID and payment date. |
| **System** | Auto-fetches Estimate_Amount and geo-metadata from master data. Computes Remaining Estimate Amount = Estimate_Amount − sum of all non-cancelled requisition amounts for that work order. Computes Approved_Balance_Amount = Requisition_Amount − Approved_Amount. |

### What Phase 4 does NOT change
- The fund reports module (Phase 1) is not touched.
- The estimates workflow (Phase 2) is frozen — no modifications.
- The fund requests module (Phase 3) is independent and not linked.
- Auth, sessions, OTP, and user management are unchanged.

---

## Role Architecture

| Role | Phase 4 Responsibility |
|---|---|
| `je` | **Creates** requisitions. Views own records only. |
| `zo` | **Approves or Holds** pending requisitions. Views all requisitions. |
| `ho` | **Approves or Holds** pending requisitions. Views all requisitions. |
| `admin` | Full read access. Does **not** create or approve requisitions — admin access is for operational oversight only. |
| `staff` | No access to the Requisition Module. |

> [!IMPORTANT]
> **Role boundaries are firm:**
> - Only `je` can submit (create) a requisition.
> - Only `zo` and `ho` can act on (approve/hold) a requisition.
> - `admin` has visibility but no workflow action rights in this module.
> - `staff` and `ho` cannot create requisitions.

---

## Resolved Design Questions

> [!NOTE]
> **Q1 — Is requisition linked to Work Order and Estimate?**
> **Resolution:** YES. Unlike Phase 3 fund requests, requisitions ARE linked to `work_order_no` and `estimate_no`. These are selected from master data dropdowns and the `estimate_amount` is auto-fetched.
>
> **Q2 — Requisition No. format and uniqueness?**
> **Resolution:** Free-text, user-entered, required, non-blank. A UNIQUE constraint is enforced at the DB level. The PDF upload file name MUST match the Requisition No. (enforced on frontend validation).
>
> **Q3 — Material_Main_Head source?**
> **Resolution:** Dropdown populated from distinct `Material_Main_Head` values in `material_master` table (existing Phase 2 table). No new table needed.
>
> **Q4 — PDF file storage?**
> **Resolution:** PDFs are stored in Supabase Storage bucket. The backend returns a signed URL or public URL for preview. Requisition PDF bucket key pattern: `requisitions/{requisition_no}.pdf`. GST Bill bucket key pattern: `gst-bills/{requisition_no}_gst.pdf`.
>
> **Q5 — GST Bill conditional?**
> **Resolution:** If `gst_bill = 'Yes'`, GST Bill PDF upload is mandatory. If `gst_bill = 'No'`, the upload field is hidden and no file is required.
>
> **Q6 — Approved_Balance_Amount computation?**
> **Resolution:** Auto-computed on frontend as `Requisition_Amount − Approved_Amount`. Stored in DB. The DB CHECK constraint ensures: `approved_balance_amount = requisition_amount − approved_amount` on Approved records.
>
> **Q7 — Cancellation by requester?**
> **Resolution:** YES — The JE (requester) can cancel their own Pending requisition. Once ZO/HO has acted (Approved or Hold), cancellation is blocked.
>
> **Q8 — Requisition_Amount upper bound?**
> **Resolution:** `requisition_amount` must be > 0 **AND** ≤ **Remaining Estimate Amount**.
>
> **Remaining Estimate Amount** is computed at request time as:
> `Remaining = Estimate_Amount − SUM(requisition_amount WHERE work_order_no = X AND requisition_status NOT IN ('Cancelled'))`
>
> **Example:**
> - Estimate Amount: ₹10,000
> - JE already raised a non-cancelled request for ₹5,000
> - Remaining = ₹10,000 − ₹5,000 = ₹5,000
> - The next request cannot exceed ₹5,000
>
> This is validated **at the backend** (server-side) at creation time. The frontend also displays the live remaining amount for user guidance.
>
> **Q9 — Approved_Amount constraint (Approver)?**
> **Resolution:** Must be > 0. No upper-bound restriction on approved amount (authority may approve any amount up to or beyond requisition amount — final discretion of ZO/HO).

---

## Proposed Changes

---

### Component 1 — Database Migration

#### [NEW] `backend/src/db/migrations/20_create_requisitions.sql`

Creates the `requisitions` table with all columns, enums, indexes, and triggers.

**Enums created:**
- `requisition_status_enum`: `'Pending'`, `'Approved'`, `'Hold'`, `'Cancelled'`
- `gst_bill_enum`: `'Yes'`, `'No'`

**Table `requisitions`:**

| Column | Type | Notes |
|---|---|---|
| `requisition_id` | UUID PK | Auto-generated |
| `requester_user_id` | VARCHAR FK→authorised_users | Auto from session |
| `login_date` | TIMESTAMPTZ | Auto from server |
| `work_order_no` | VARCHAR FK→projects_master | Required |
| `estimate_no` | VARCHAR | Auto-fetched from master |
| `estimate_amount` | NUMERIC(18,2) | Auto-fetched from project cost estimates |
| `state` | VARCHAR | Auto-fetched from projects_master |
| `district` | VARCHAR | Auto-fetched from projects_master |
| `area_code` | VARCHAR | Auto-fetched (zone) from projects_master |
| `department` | VARCHAR | Auto-fetched from projects_master |
| `site_details` | TEXT | Auto-fetched from projects_master |
| `requisition_no` | VARCHAR UNIQUE | User-entered, required |
| `material_main_head` | VARCHAR | Dropdown from material_master |
| `requisition_pdf_url` | TEXT | Supabase Storage URL |
| `requisition_amount` | NUMERIC(18,2) | Required, > 0 |
| `gst_bill` | gst_bill_enum | 'Yes' / 'No' |
| `gst_bill_pdf_url` | TEXT | Required only if gst_bill = 'Yes' |
| `bank_details` | TEXT | Required |
| `expen_head_remarks` | TEXT | Optional |
| `requisition_status` | requisition_status_enum | DEFAULT 'Pending' |
| `approved_user_id` | VARCHAR FK→authorised_users | Auto-stamped on approval |
| `payment_date` | TIMESTAMPTZ | Auto-stamped on approval |
| `approve_type` | VARCHAR | 'Approve' or 'Hold' |
| `approved_amount` | NUMERIC(18,2) | Required on Approve only |
| `approved_balance_amount` | NUMERIC(18,2) | Auto: requisition_amount − approved_amount |
| `remarks_approved_authority` | TEXT | Required on Approve, NULL on Hold |
| `cancelled_by` | VARCHAR FK→authorised_users | Populated on Cancel |
| `cancelled_at` | TIMESTAMPTZ | Populated on Cancel |
| `created_by` | VARCHAR FK→authorised_users | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated by trigger |

**Indexes:**
- `idx_requisitions_status` — partial index on `requisition_status = 'Pending'`
- `idx_requisitions_work_order` — on `work_order_no`
- `idx_requisitions_requester` — on `requester_user_id`

**Triggers:**
- `trg_requisition_updated_at` — Auto-updates `updated_at` on any UPDATE
- `trg_prevent_requisition_hard_delete` — Raises EXCEPTION on hard DELETE
- `trg_audit_requisition_status` — Inserts into `audit_log` on `requisition_status` change

---

### Component 2 — Backend: Requisitions API

#### [NEW] `backend/src/controllers/requisitions.controller.js`

Five controller functions:

| Function | Method | Path | Access | Description |
|---|---|---|---|---|
| `createRequisition` | POST | `/` | je, staff, zo, admin | Create a new requisition |
| `getRequisitions` | GET | `/` | all authenticated (role-filtered) | List requisitions |
| `getRequisitionById` | GET | `/:id` | all authenticated (visibility-gated) | Single requisition detail |
| `actOnRequisition` | PATCH | `/:id/action` | admin | Approve or Hold a pending requisition |
| `cancelRequisition` | PATCH | `/:id/cancel` | je, staff, zo, admin | Cancel a Pending requisition |

##### `createRequisition(req, res)` — `POST /api/v1/auth/requisitions`

**Access:** `['je', 'staff', 'zo', 'admin']`

```
Body: {
  work_order_no,           // required
  requisition_no,          // required, unique
  material_main_head,      // required, must exist in material_master
  requisition_pdf_url,     // required (uploaded to Supabase Storage first)
  requisition_amount,      // required, > 0
  gst_bill,                // required, 'Yes' or 'No'
  gst_bill_pdf_url?,       // required only if gst_bill = 'Yes'
  bank_details,            // required
  expen_head_remarks?      // optional
}

Validation (all → 400):
  1. work_order_no: required, non-blank string
  2. requisition_no: required, non-blank string after .trim()
  3. material_main_head: required
  4. requisition_pdf_url: required
  5. requisition_amount: required, Number > 0 and finite
  6. gst_bill: must be 'Yes' or 'No'
  7. gst_bill_pdf_url: required if gst_bill = 'Yes'
  8. bank_details: required, non-blank

Business Rules:
  9. Unique requisition_no check: SELECT COUNT(*) ... WHERE requisition_no = $1
     → 409 if exists: "A requisition with number {requisition_no} already exists."
  10. Validate work_order_no exists in projects_master → 404 if not found
  11. Auto-fetch from projects_master:
       estimate_no, state, district, area_code (zone), department, site_details
  12. Auto-fetch estimate_amount:
       SELECT MAX(estimate_amount) FROM project_cost_estimates
       WHERE work_order_no = $1 AND estimate_status = 'Final Approved'
       → NULL if no final approved estimate exists (allowed)

Build insert:
  - requester_user_id ← req.user.mobile_number
  - login_date        ← now() (DB default)
  - requisition_status ← 'Pending'
  - created_by        ← req.user.mobile_number

Return: 201 with created requisition.
```

##### `getRequisitions(req, res)` — `GET /api/v1/auth/requisitions`

**Access:** All authenticated roles

```
Query params: page, limit (1–100, default 50), status (optional filter)

Role-based filtering:
  'je'/'staff': own requisitions (requester_user_id = req.user.mobile_number)
  'zo': own requisitions (same as je/staff — zo acts as requester)
  'admin': all requisitions
  'ho': 403 Forbidden (HO does not manage requisitions)

Order: created_at DESC
Return: { success, requisitions, pagination }
```

##### `getRequisitionById(req, res)` — `GET /api/v1/auth/requisitions/:id`

**Access:** All authenticated roles (visibility-gated)

```
1. Validate UUID format → 400 if invalid
2. Fetch requisition → 404 if not found
3. Visibility gate:
   'je'/'staff'/'zo': only if requester_user_id = req.user.mobile_number → else 404
   'admin': all visible
   'ho': 403 Forbidden
4. Resolve display names for requester_user_id and approved_user_id
5. Return full requisition object
```

##### `actOnRequisition(req, res)` — `PATCH /api/v1/auth/requisitions/:id/action`

**Access:** `['admin']`

```
Body: { action, approved_amount?, remarks_approved_authority? }
      action must be 'Approve' or 'Hold'

1. Validate requisition_id as valid UUID.
2. Fetch requisition → 404 if not found.
3. Status guard: requisition_status must be 'Pending'
   → 403: "Action can only be taken on Pending requisitions."

4. If action = 'Hold':
   - No additional fields required.
   - Update:
     SET requisition_status   = 'Hold'
         approved_user_id     = req.user.mobile_number
         payment_date         = now()
         approve_type         = 'Hold'
   - Return 200.

5. If action = 'Approve':
   - Validate approved_amount:
     a. Required, must be a positive number > 0
        → 400: "approved_amount is required for approval."
   - Validate remarks_approved_authority:
     a. Required, non-blank
        → 400: "remarks_approved_authority is required for approval."
   - Compute approved_balance_amount = requisition_amount − approved_amount
   - Update:
     SET requisition_status         = 'Approved'
         approved_user_id           = req.user.mobile_number
         payment_date               = now()
         approve_type               = 'Approve'
         approved_amount            = validated value
         approved_balance_amount    = computed value
         remarks_approved_authority = trimmed string
   - Return 200.

6. Optimistic lock on Pending status during UPDATE to prevent race conditions.
7. If action is neither 'Approve' nor 'Hold' → 400.
```

##### `cancelRequisition(req, res)` — `PATCH /api/v1/auth/requisitions/:id/cancel`

**Access:** `['je', 'staff', 'zo', 'admin']`

```
1. Validate UUID.
2. Fetch requisition → 404 if not found.
3. Ownership check: requester_user_id = req.user.mobile_number OR admin.
   → 403: "Access denied. You can only cancel your own requisitions."
4. Status guard: requisition_status must be 'Pending'
   → 403: "Only Pending requisitions can be cancelled. Current status: {status}"
5. Update:
   SET requisition_status = 'Cancelled'
       cancelled_by       = req.user.mobile_number
       cancelled_at       = now()
6. Return 200 with updated record.
```

---

#### [NEW] `backend/src/controllers/requisitions.uploads.controller.js`

Handles Supabase Storage PDF upload endpoints.

| Function | Method | Path | Access | Description |
|---|---|---|---|---|
| `uploadRequisitionPdf` | POST | `/upload/requisition-pdf` | je, staff, zo, admin | Upload requisition PDF |
| `uploadGstBillPdf` | POST | `/upload/gst-bill` | je, staff, zo, admin | Upload GST bill PDF |

```
Both functions:
  1. Expect multipart/form-data with a single PDF file field named 'file'.
  2. Validate MIME type: must be 'application/pdf'
     → 400: "Only PDF files are accepted."
  3. Validate file size: must be ≤ 5MB (5 * 1024 * 1024 bytes)
     → 400: "File size must not exceed 5MB."
  4. Validate filename (for requisition PDF): must match requisition_no exactly
     → Done on frontend; backend re-validates against body param 'requisition_no'
  5. Upload to Supabase Storage bucket:
     - Requisition PDFs: bucket 'requisition-pdfs', path: {requisition_no}.pdf
     - GST Bills: bucket 'gst-bills', path: {requisition_no}_gst.pdf
  6. Return signed/public URL on success.
```

---

#### [NEW] `backend/src/routes/requisitions.routes.js`

```javascript
const express = require('express');
const {
  createRequisition,
  getRequisitions,
  getRequisitionById,
  actOnRequisition,
  cancelRequisition
} = require('../controllers/requisitions.controller');
const {
  uploadRequisitionPdf,
  uploadGstBillPdf
} = require('../controllers/requisitions.uploads.controller');
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(verifyJwt);

// Role constants (mirrored from controller — defined here for clarity)
const creatorRoles  = ['je'];                         // Only JE submits requisitions
const approverRoles = ['zo', 'ho'];                   // ZO and HO approve/hold
const readRoles     = ['je', 'zo', 'ho', 'admin'];   // Readers (staff excluded)
const uploadRoles   = ['je'];                         // Only JE uploads PDFs

// Requisition CRUD — read access for JE/ZO/HO/admin; staff excluded
router.get('/',    requireRole(readRoles), getRequisitions);
router.post('/',   requireRole(creatorRoles), createRequisition);    // JE only
router.get('/:id', requireRole(readRoles), getRequisitionById);

// Workflow actions
router.patch('/:id/action', requireRole(approverRoles), actOnRequisition);  // ZO/HO only
router.patch('/:id/cancel', requireRole(creatorRoles), cancelRequisition);  // JE only (own)

// File uploads — JE only (only JE creates requisitions)
router.post('/upload/requisition-pdf', requireRole(uploadRoles), upload.single('file'), uploadRequisitionPdf);
router.post('/upload/gst-bill',        requireRole(uploadRoles), upload.single('file'), uploadGstBillPdf);

module.exports = router;
```

#### [MODIFY] `backend/src/app.js`

Add the new route mount after the `master-data` mount:

```javascript
const requisitionsRoutes = require('./routes/requisitions.routes');
// ...
app.use('/api/v1/auth/requisitions', requisitionsRoutes);
```

---

### Component 3 — Frontend

#### [NEW] `frontend/src/pages/Requisitions.jsx`

A full-featured Requisition management page with role-based views.

**Requester View (je/staff/zo/admin):**
- List of own requisitions with status badges:
  - Pending → amber
  - Approved → emerald green
  - Hold → red/orange
  - Cancelled → grey
- "New Requisition" button → opens a step-based form modal/panel.
- **Form Fields (following the flow diagram exactly):**
  - Step 1 (Auto-populated, read-only):
    - `Login_Date` — system date, displayed as read-only
    - `user_id` — logged-in user's mobile_number/display_name
  - Step 2 (Master Data):
    - `Work_Order_No` — dropdown from `projects_master`
    - `Estimate_No` — auto-populated after Work_Order_No selected
    - `Estimate_Amount` — auto-populated (total estimate against selected Work Order + Estimate)
    - `State, District, Area_Code, Department, Site_Details` — all auto-populated from master data
  - Step 3 (User Input):
    - `Requisition_NO` — text input, required, unique
    - `Material_Main_Head` — dropdown from distinct Material_Main_Head values in material_master
    - PDF Upload section:
      - Requisition PDF upload (file name must equal Requisition_NO — validated on frontend)
      - PDF preview button (shows uploaded PDF)
    - `Requisition_Amount` — numeric input, required, > 0
    - `GST_Bill` — Yes/No dropdown
    - If GST_Bill = 'Yes': GST Bill PDF upload (mandatory)
    - `Bank_Details` — text area, required
    - `Expen_Head_Remarks` — text area, optional
  - Save button → submits to API
- Cancel button on Pending requisitions (with confirmation dialog).

**Approver/Admin View:**
- Tabbed interface: "Pending" | "All Requisitions" (history)
- Each pending card shows: Requester name, Requisition No, Work Order, Requisition Amount, date, Material Head.
- "Take Action" button opens action panel:
  - `Approve_type` dropdown: **Approve** / **Hold**
  - If **Approve** selected: enables `Approved_Amount` (numeric), `Remarks_Approved_Authority` (textarea, required).
  - `Approved_Balance_Amount` shown as read-only = Requisition_Amount − Approved_Amount (live-computed in UI).
  - If **Hold** selected: additional fields hidden/disabled.
  - Auto-displayed read-only: Approver User ID (logged-in user), Payment Date (today).
  - Submit button: "Save Approval".

---

#### [NEW] `frontend/src/api/requisitionsApi.js`

API client module with Axios calls for all seven endpoints (5 CRUD + 2 upload).

---

#### [MODIFY] `frontend/src/App.jsx`

Add the `Requisitions` page route:
```jsx
import Requisitions from './pages/Requisitions';
// ...
<Route path="/requisitions" element={<Requisitions />} />
```
Placed inside the ProtectedRoute for roles `['je', 'staff', 'zo', 'admin']`.

---

#### [MODIFY] `frontend/src/pages/Dashboard.jsx`

Add a navigation card/link to the Requisitions module visible to `je`, `staff`, `zo`, and `admin` roles. Match the existing glassmorphism module card design pattern.

---

### Component 4 — Code Quality & Security Hardening (Carry-Over from Phase 3)

> [!IMPORTANT]
> The Phase 3 implementation plan identified 17 issues. Per codebase audit at Phase 4 time, **none of these have been fixed yet** — they are all still present. Phase 4 MUST resolve them as part of M5. They are listed verbatim below with verified file/line references as of the current codebase.

| # | File | Issue | Severity | Verified Location |
|---|---|---|---|---|
| CQ-1 | `estimates.core.controller.js` | Hardcoded mobile numbers whitelist `legitMobiles` — PII in source code | **HIGH** | L113–126 (confirmed) |
| CQ-2 | `auth.controller.js` | `req.ip \|\| req.headers['x-forwarded-for']` — picks up full proxy chain, not just client IP | **MEDIUM** | L171 (confirmed) |
| CQ-3 | `session.service.js` | `JWT_SECRET` fallback to plaintext dev string at module level — no prod guard here | **MEDIUM** | L6 (confirmed) |
| CQ-4 | `verifyJwt.js` | Generic error catch emits `error.message` which can leak JWT library internals (L79) | **LOW** | L70–80 (confirmed) |
| CQ-5 | `reports.controller.js` | `amount` validated only for `undefined` — non-numeric strings pass | **HIGH** | L215 (`if (!work_order_no \|\| amount === undefined)`) |
| CQ-6 | `estimates.core.controller.js` | `je` with `global=true` query param bypasses own-record filter | **MEDIUM** | L128 (`if (effectiveRole === 'je' && query.global !== 'true')`) |
| CQ-7 | `admin.controller.js` | `updateUser` persists any `role` string without enum validation | **HIGH** | L80 (`updateFields.role = role`) |
| CQ-8 | `rateLimiter.js` | `globalLimiter` 1000 req/min — permissive for internal ERP (intentional, needs comment) | **LOW** | L83–89 (confirmed) |
| CQ-9 | `otp.service.js` | `attempts + 1` is a non-atomic read-modify-write — concurrent OTP attempts can bypass 3-attempt limit | **MEDIUM** | L91 (confirmed) |
| CQ-10 | `telegram.service.js` | OTP URL uses `encodeURIComponent` — correct. Needs confirming comment | **INFO** | L33 (confirmed) |
| CQ-11 | `purchaseData.controller.js` | `getPurchaseOptions` — no URL param in this route, no UUID validation needed (existing note confirms) | **INFO** | Already handled at route level |
| CQ-12 | All controllers | `console.error` logs only `error.message` — stack trace lost in all catch blocks | **LOW** | Multiple files |
| SEC-1 | `app.js` | `materialsRoutes` mounted on **both** `/api/materials` (no auth) and `/api/v1/auth/materials` | **CRITICAL** | L57–58 (confirmed) |
| SEC-2 | `auth.routes.js` | `linkTelegram` uses `otpRequestLimiter` (applied at L10) — already rate-limited but with mobile-keyed limiter | **MEDIUM** | L10 (already has limiter, verify adequacy) |
| SEC-3 | `session.service.js` | `user_agent` stored as-is — no length truncation | **LOW** | L50 `user_agent: userAgent \|\| null` |
| SEC-4 | `verifyJwt.js` | `TokenExpiredError` path does NOT clear the expired `accessToken` cookie | **MEDIUM** | L72–77 (confirmed — no clearCookie call) |
| SEC-5 | `admin.controller.js` | `removeUser` hard-deletes without checking FK references from requisitions, estimates, or fund_requests | **MEDIUM** | L127–133 (confirmed) |

---

### Component 5 — New Phase 4 Specific Security Considerations

New issues surfaced during Phase 4 design that did not exist in Phase 3:

| # | Concern | Severity | Resolution |
|---|---|---|---|
| SEC-P4-1 | **Supabase Storage bucket access control** — PDF buckets (`requisition-pdfs`, `gst-bills`) must not be publicly readable without authentication. Signed URLs with short TTL (60 min) should be generated for every preview. | **HIGH** | Configure bucket as private. Generate signed URLs via `supabase.storage.from(...).createSignedUrl()` with `expiresIn: 3600`. |
| SEC-P4-2 | **File upload MIME type enforcement** — Multer's `fileFilter` must validate `mimetype === 'application/pdf'` on the backend, not just rely on file extension. | **HIGH** | Implement `fileFilter` in multer config. |
| SEC-P4-3 | **Filename injection** — The `requisition_no` is user-supplied and used to construct the Storage path. Must sanitize to prevent path traversal (`../`, null bytes, special chars). | **HIGH** | Sanitize: only allow `[A-Za-z0-9_\-.]` characters in requisition_no before using as filename. |
| SEC-P4-4 | **Approved_Balance_Amount DB integrity** — Must be enforced at DB level with a CHECK constraint, not only computed on frontend. | **MEDIUM** | Add `CONSTRAINT chk_balance_amount CHECK (requisition_status != 'Approved' OR approved_balance_amount = requisition_amount - approved_amount)` |
| SEC-P4-5 | **GST Bill mandatory enforcement** — Backend must re-validate that `gst_bill_pdf_url` is present when `gst_bill = 'Yes'`, not only frontend. | **MEDIUM** | Validated in `createRequisition` controller logic. |

---

## Verification Plan

### Automated Tests

All tests live in `backend/tests/milestones/` following the Phase 2/3 pattern.

**New milestone test files:**
- `tests/milestones/test_milestone_p4_m1.js` — DB schema verification (table, enums, triggers)
- `tests/milestones/test_milestone_p4_m2.js` — API CRUD tests (create, list, get by ID)
- `tests/milestones/test_milestone_p4_m3.js` — Workflow tests (approve/hold/cancel)
- `tests/milestones/test_milestone_p4_m4.js` — File upload validation tests
- `tests/milestones/test_milestone_p4_m5.js` — Security & code quality fix verification

**package.json additions:**
```json
"test:p4:m1": "node tests/milestones/test_milestone_p4_m1.js",
"test:p4:m2": "node tests/milestones/test_milestone_p4_m2.js",
"test:p4:m3": "node tests/milestones/test_milestone_p4_m3.js",
"test:p4:m4": "node tests/milestones/test_milestone_p4_m4.js",
"test:p4:m5": "node tests/milestones/test_milestone_p4_m5.js",
"test:p4:all": "node tests/milestones/test_milestone_p4_m1.js && node tests/milestones/test_milestone_p4_m2.js && node tests/milestones/test_milestone_p4_m3.js && node tests/milestones/test_milestone_p4_m4.js && node tests/milestones/test_milestone_p4_m5.js"
```

### Manual Verification
- Requester logs in → selects Work Order → Estimate + Amount + geo-metadata auto-populate
- Requester enters Requisition NO → uploads PDF (filename = Requisition NO) → PDF preview shows
- Requester selects GST Bill = Yes → GST upload becomes required
- Requester enters bank details + remarks → saves → status = Pending
- Admin logs in → sees Pending requisition → selects Approve → enters approved amount + remarks → submits
- Approved_Balance_Amount auto-computed correctly: Requisition_Amount − Approved_Amount
- Admin selects Hold → additional fields hidden → submits → status = Hold
- Requester cancels own Pending requisition → status = Cancelled
- Admin cannot approve a non-Pending requisition → 403
- PDF signed URL preview works (opens PDF in browser)

---

## Migration Sequence

All migrations must be run in order:

| Step | File | Notes |
|---|---|---|
| 20 | `20_create_requisitions.sql` | New table, enums, indexes, triggers |

---

## File Inventory

| File | Action | Component |
|---|---|---|
| `backend/src/db/migrations/20_create_requisitions.sql` | **NEW** | 1 — DB |
| `backend/src/controllers/requisitions.controller.js` | **NEW** | 2 — API |
| `backend/src/controllers/requisitions.uploads.controller.js` | **NEW** | 2 — API (File Uploads) |
| `backend/src/routes/requisitions.routes.js` | **NEW** | 2 — API |
| `backend/src/app.js` | **MODIFY** — add mount | 2 — API |
| `frontend/src/pages/Requisitions.jsx` | **NEW** | 3 — Frontend |
| `frontend/src/api/requisitionsApi.js` | **NEW** | 3 — Frontend |
| `frontend/src/App.jsx` | **MODIFY** — add route | 3 — Frontend |
| `frontend/src/pages/Dashboard.jsx` | **MODIFY** — add nav card | 3 — Frontend |
| `backend/src/controllers/estimates.core.controller.js` | **MODIFY** — CQ-1, CQ-6 | 4 — Hardening |
| `backend/src/controllers/auth.controller.js` | **MODIFY** — CQ-2 | 4 — Hardening |
| `backend/src/services/session.service.js` | **MODIFY** — CQ-3, SEC-3 | 4 — Hardening |
| `backend/src/controllers/reports.controller.js` | **MODIFY** — CQ-5 | 4 — Hardening |
| `backend/src/controllers/admin.controller.js` | **MODIFY** — CQ-7, SEC-5 | 4 — Hardening |
| `backend/src/services/otp.service.js` | **MODIFY** — CQ-9 | 4 — Hardening |
| `backend/src/middleware/verifyJwt.js` | **MODIFY** — CQ-4, SEC-4 | 4 — Hardening |
| `backend/src/app.js` | **VERIFY/MODIFY** — SEC-1 | 4 — Hardening |
| `backend/src/rateLimiter.js` | **MODIFY** — CQ-8 comment | 4 — Hardening |
| `backend/tests/milestones/test_milestone_p4_m1.js` | **NEW** | Tests |
| `backend/tests/milestones/test_milestone_p4_m2.js` | **NEW** | Tests |
| `backend/tests/milestones/test_milestone_p4_m3.js` | **NEW** | Tests |
| `backend/tests/milestones/test_milestone_p4_m4.js` | **NEW** | Tests |
| `backend/tests/milestones/test_milestone_p4_m5.js` | **NEW** | Tests |
| `backend/package.json` | **MODIFY** — add test scripts | Tests |
