# Estimate Quotation Upload — Implementation Plan (Milestone-wise)

**Feature:** JE uploads dealer quotation PDFs against a Cost Estimate, at the end of item entry. ZO can view/download all (incl. soft-deleted history); HO sees only the active set. Permanently locked once the estimate reaches `Final Approved`, mirroring existing line-item lock semantics. ZO/HO can flag a quotation for replacement (boolean, no text thread). Vendor label is a plain optional field. No mandatory-upload validation.

## Decisions Confirmed
- **Lock RPC failure** during Final Approval is non-fatal/logged, does not roll back the approval (matches existing `last_approved_amount` update behavior in the same code block).
- **Mandatory quotation upload** is deferred/optional — not enforced anywhere in this plan.
- **Signed URLs** generated per-row dynamically via `createSignedUrl`, mirroring `raFinalBill.controller.js`'s `getBillById` pattern exactly. Active rows get a URL; soft-deleted rows get `null`.
- **Storage/DB consistency**: if the metadata insert fails after the Storage upload succeeds, the orphaned storage object is deleted in the same request's `catch` block.
- **`updated_at`**: no DB trigger exists in this repo for auto-maintaining this column (confirmed via grep) — every UPDATE in the controller sets `updated_at = new Date().toISOString()` explicitly, matching how `project_cost_estimates` and other tables already do it.
- **Upload is immediate, not staged**: unlike line items (client-staged, persisted only on `PUT /:id/items`), a quotation POST creates the DB row + storage object right away. No separate "save" step. Accidental upload is recovered by immediate delete, not by "not saving."
- **`flagged_for_replacement`** persists across reopen — no special handling, stays set until someone clears it.
- **`is_locked` semantics**: blocks mutation/deletion of the row and its file only. Does not affect `flagged_for_replacement`, which stays togglable regardless of lock state.
- **Reopen never touches quotations directly** — confirmed by reading `reopenEstimate()`: it only updates `project_cost_estimates` header fields, never `estimate_quotations`. Previously-locked rows stay locked forever; this is inherited for free, not something the new code has to enforce.

**Repo conventions reused (verified by reading the code, not assumed):**
- Upload pattern → `raFinalBill.uploads.controller.js` (multer memory storage, UUID storage path, MIME whitelist, private Supabase bucket).
- Bucket provisioning → `00B_create_storage_buckets.sql` (private, `file_size_limit`, `allowed_mime_types`).
- Row-level permanent lock → `estimates.items.controller.js` (`ho_office_approve === 'Approve'` freezes a row forever; reopening never resets it).
- `EDITABLE_STATUSES` → `estimate-rules.js` (Draft, ZO/HO Revision Requested, Estimate Reopened) — reused as-is for quotation upload/delete windows.
- Soft delete + audit → `is_deleted/deleted_by/deleted_at` + a per-table trigger writing to `audit_log`, shaped like `audit_fund_reports_changes()`.
- Final-approval hook point → `submitReview()` in `estimates.workflow.controller.js`, the `if (updatedEstimate.estimate_status === ESTIMATE_STATUS.FINAL_APPROVED)` block (~line 413).
- Signed URL pattern → `raFinalBill.controller.js` `getBillById`, `createSignedUrl(path, 3600)`.
- Test taxonomy → `unit/`, `contracts/`, `regression/` are active; `milestones/` is frozen, no new tests there.

---

## Milestone 1 — Database Layer

**Goal:** New table + private storage bucket + a row-level freeze mechanism, with zero new "batch/version" concepts — quotations freeze the same way line items already do.

**File:** `backend/src/db/migrations/020_create_estimate_quotations.sql` (new)

```sql
CREATE TABLE public.estimate_quotations (
  quotation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id    uuid NOT NULL REFERENCES project_cost_estimates(estimate_id),
  storage_path   text NOT NULL,
  original_filename varchar NOT NULL,
  vendor_label   varchar(100),                       -- optional, editable only while unlocked
  flagged_for_replacement boolean NOT NULL DEFAULT false,  -- ZO/HO toggle, no text/history
  file_size      bigint NOT NULL,
  uploaded_by    varchar NOT NULL,                    -- req.user.mobile_number
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  is_locked      boolean NOT NULL DEFAULT false,       -- permanent freeze flag
  locked_at      timestamptz,
  is_deleted     boolean NOT NULL DEFAULT false,       -- soft delete
  deleted_by     varchar,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()    -- set explicitly by controller on every UPDATE, no DB trigger
);

CREATE INDEX idx_estimate_quotations_estimate_id ON estimate_quotations(estimate_id);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('estimate-quotations', 'estimate-quotations', false, 15728640, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Freeze RPC, called once from submitReview() at the Final Approved transition
CREATE OR REPLACE FUNCTION public.lock_estimate_quotations(p_estimate_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE estimate_quotations
  SET is_locked = true, locked_at = now()
  WHERE estimate_id = p_estimate_id
    AND is_deleted = false
    AND is_locked = false;
END;
$$;

-- Audit trigger, shaped like audit_fund_reports_changes()
-- Covers: CREATE (insert), SOFT_DELETE (is_deleted false->true), LOCK (is_locked false->true)
-- FLAG TOGGLE (flagged_for_replacement change): intentionally NOT audited.
-- Flag is reversible workflow chatter (ZO/HO marking for attention), not a lifecycle
-- state transition. Decided: no FLAG_TOGGLE branch needed.
CREATE OR REPLACE FUNCTION public.audit_estimate_quotations_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_user_id VARCHAR;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      NEW.uploaded_by, 'CREATE', 'Estimate Quotation', NEW.quotation_id::VARCHAR,
      NULL,
      jsonb_build_object('estimate_id', NEW.estimate_id, 'original_filename', NEW.original_filename,
                          'vendor_label', NEW.vendor_label, 'file_size', NEW.file_size)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted AND NEW.is_deleted = TRUE THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (NEW.deleted_by, 'SOFT_DELETE', 'Estimate Quotation', NEW.quotation_id::VARCHAR,
              jsonb_build_object('is_deleted', OLD.is_deleted),
              jsonb_build_object('is_deleted', NEW.is_deleted, 'deleted_by', NEW.deleted_by, 'deleted_at', NEW.deleted_at));
    ELSIF NEW.is_locked IS DISTINCT FROM OLD.is_locked AND NEW.is_locked = TRUE THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
      VALUES (NULL, 'LOCK', 'Estimate Quotation', NEW.quotation_id::VARCHAR,
              jsonb_build_object('is_locked', OLD.is_locked),
              jsonb_build_object('is_locked', NEW.is_locked, 'locked_at', NEW.locked_at));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_estimate_quotations_changes
AFTER INSERT OR UPDATE ON public.estimate_quotations
FOR EACH ROW EXECUTE FUNCTION public.audit_estimate_quotations_changes();
```

**Why no `batch_id`/`estimate_version` column:** items freeze via a plain row-level boolean (`ho_office_approve = 'Approve'`), not a version join, and reopening never resets it. `is_locked` replicates that exact guarantee for quotations, which have no per-row approve/reject concept to piggyback on.

**Test cases:**
- `schemaContract.test.js` — add `estimate_quotations` to the expected table/column list.
- `rpcSignature.test.js` — add `lock_estimate_quotations(p_estimate_id uuid)`.
- New `backend/tests/vitest/regression/estimateQuotationLock.test.js`:
  - Insert 2 rows → call `lock_estimate_quotations` → both `is_locked = true`, `locked_at` set.
  - Insert a 3rd row after locking → call again → only the 3rd gets locked this time (idempotency).
  - Soft-deleted row before lock call → lock skips it.

**Acceptance criteria:**
- [ ] Migration runs cleanly on a fresh local Supabase instance.
- [ ] `estimate-quotations` bucket exists, private, 15MB cap, PDF-only.
- [ ] `lock_estimate_quotations()` is idempotent, never re-locks already-locked or soft-deleted rows.
- [ ] Audit log gets a row for CREATE, SOFT_DELETE, LOCK. Flag toggle produces no audit row (intentional — decided, not an oversight).

---

## Milestone 2 — Backend: Upload / List / Delete / Flag

**Goal:** JE-only upload/delete; ZO/HO-only flag toggle (exempt from lock); role-scoped list visibility.

**Files:**
- `backend/src/controllers/estimates.quotations.controller.js` (new)
- `backend/src/routes/estimates.routes.js` (4 new routes)
- `backend/src/workflow/rbacMatrix.js` (new matrix rows)

**Pseudocode:**

```js
const ALLOWED_MIMES = ['application/pdf'];
const MAX_FILE_SIZE = 15 * 1024 * 1024;

// POST /:id/quotations (multipart, field 'file', optional 'vendor_label') — JE/admin only
async function uploadQuotation(req, res) {
  // 1. validate req.file: mimetype === 'application/pdf', size <= MAX_FILE_SIZE
  // 2. estimate = getEstimateById(id); 404 if missing
  // 3. isOwnerOrAdmin(estimate, req.user) check
  // 4. if (!isAdmin && !EDITABLE_STATUSES.includes(estimate.estimate_status)) -> 403
  // 5. storagePath = `${uuidv4()}.pdf`; upload to 'estimate-quotations' bucket
  // 6. try: insert row (estimate_id, storage_path, original_filename,
  //         vendor_label: req.body.vendor_label?.slice(0,100) || null,
  //         file_size, uploaded_by: req.user.mobile_number)
  //    catch: delete the just-uploaded storage object (orphan cleanup), then rethrow/500
  // 7. return 201 with the new row
  // NOTE: persists immediately — no client-side staging, no separate "save" step
}

// GET /:id/quotations — JE (own, active-only) / ZO (all incl. soft-deleted) / HO (active-only) / admin (all)
async function listQuotations(req, res) {
  // 1. estimate = getEstimateById(id); access check via isOwnerOrAdmin / canViewEstimate per role
  // 2. effectiveRole = getEffectiveRole(req.user.role)
  // 3. query = supabase.from('estimate_quotations').select('*').eq('estimate_id', id)
  //    if (effectiveRole !== 'zo' && effectiveRole !== 'admin') query = query.eq('is_deleted', false)
  // 4. for each row: if (!row.is_deleted) generate quotation_signed_url via
  //      supabase.storage.from('estimate-quotations').createSignedUrl(row.storage_path, 3600)
  //    else quotation_signed_url = null
  //    (signed URL generation happens ONLY after the access check above passes — never before)
  // 5. order by uploaded_at asc; return rows
}

// DELETE /:id/quotations/:quotationId — JE/admin only, soft delete
async function deleteQuotation(req, res) {
  // 1. estimate = getEstimateById(id); isOwnerOrAdmin check
  // 2. row = fetch by quotation_id; 404 if missing OR row.estimate_id !== req.params.id (explicit ownership check)
  // 3. if (row.is_locked) -> 403 'Final approved quotations are locked and cannot be deleted.'
  // 4. if (!isAdmin && !EDITABLE_STATUSES.includes(estimate.estimate_status)) -> 403
  // 5. UPDATE SET is_deleted=true, deleted_by=req.user.mobile_number, deleted_at=now(),
  //     updated_at=now()  WHERE quotation_id = :quotationId
  //    (storage object is NOT deleted — soft delete only, matches repo convention)
  // 6. return 200
}

// PATCH /:id/quotations/:quotationId/flag — ZO/HO/admin only
async function toggleQuotationFlag(req, res) {
  // 1. estimate = getEstimateById(id); role check (zo/ho/admin), canViewEstimate for ZO zone scoping
  // 2. row = fetch by quotation_id; 404 if missing OR row.estimate_id !== req.params.id
  // 3. NO lock/edit-window guard — flagging works even if row.is_locked === true
  //    (HO may want to flag something post-approval ahead of the next reopen cycle)
  // 4. UPDATE SET flagged_for_replacement = req.body.flagged, updated_at = now()
  //     WHERE quotation_id = :quotationId
  // 5. return 200 with updated row
}

module.exports = { uploadQuotation, listQuotations, deleteQuotation, toggleQuotationFlag };
```

**Routes (estimates.routes.js additions):**
```js
const multer = require('multer');
const quotationUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/:id/quotations', requireRole(jeRoles), quotationUpload.single('file'), uploadQuotation);
router.get('/:id/quotations', requireRole(['je','zo','ho','admin']), listQuotations);
router.delete('/:id/quotations/:quotationId', requireRole(jeRoles), deleteQuotation);
router.patch('/:id/quotations/:quotationId/flag', requireRole(reviewRoles), toggleQuotationFlag);
```

**rbacMatrix.js additions:**
- Deny `zo`/`ho` on `POST /:id/quotations` and `DELETE /:id/quotations/:quotationId`; allow `je`/`admin`.
- Deny `je` on `PATCH /:id/quotations/:quotationId/flag`; allow `zo`/`ho`/`admin`.

**Test cases** — `backend/tests/vitest/regression/estimateQuotationUpload.test.js`:
- JE uploads valid PDF in Draft → 201, `is_locked = false`.
- Non-PDF upload (e.g. renamed .png) → 400, no DB row, no storage object written.
- Upload while `Under ZO Review` → 403 (`EDITABLE_STATUSES` gate).
- ZO attempts upload → 403 (role gate).
- JE deletes own quotation in Draft → soft-deleted, storage object untouched.
- JE deletes an `is_locked = true` row → 403, row unchanged.
- **Upload then immediate delete** (same session, before any submission) → soft-deleted, no error — this is the intended "wrong file" recovery path.
- **Storage→DB orphan cleanup**: force a metadata-insert failure after storage upload succeeds → assert the orphaned storage object is removed.
- **Cross-role list visibility**: same estimate, 3 rows (1 soft-deleted) → ZO's list includes all 3; HO's and JE's exclude the soft-deleted one.
- ZO toggles flag → 200, field flips; JE attempts same → 403.
- HO toggles flag on an `is_locked = true` row → 200 (flagging is exempt from lock).
- Ownership check: request `DELETE`/`PATCH .../flag` with a `quotationId` belonging to a *different* estimate than `:id` → 404.

**Acceptance criteria:**
- [ ] Only JE/admin can upload/delete; ZO/HO get 403 on both.
- [ ] Non-PDF uploads rejected server-side by MIME, not filename.
- [ ] Upload/delete blocked outside `EDITABLE_STATUSES`; flag toggle is not.
- [ ] Locked rows can never be deleted by anyone, including admin (consistent with items: "locked and cannot be modified by anyone").
- [ ] ZO list includes soft-deleted rows with `signed_url: null`; HO/JE lists exclude them entirely.
- [ ] A quotation ID that doesn't belong to the `:id` in the URL is rejected (404), never silently acted on.
- [ ] Failed metadata insert never leaves an orphaned file in Storage.

---

## Milestone 3 — Freeze Hook on Final Approval

**Goal:** Wire `lock_estimate_quotations()` into the existing Final Approved transition — no new status logic.

**File:** `backend/src/controllers/estimates.workflow.controller.js` (one addition inside `submitReview()`)

```js
if (updatedEstimate.estimate_status === ESTIMATE_STATUS.FINAL_APPROVED) {
  await supabase.from('project_cost_estimates')
    .update({ last_approved_amount: updatedEstimate.estimate_amount })
    .eq('estimate_id', id);

  // NEW: freeze any currently-active quotation rows for this estimate
  const { error: lockError } = await supabase.rpc('lock_estimate_quotations', { p_estimate_id: id });
  if (lockError) console.error(`lock_estimate_quotations failed for ${id}: ${lockError.message}`);
  // Non-fatal by design (confirmed decision, see top of doc) — logged, does not block approval.

  const { notifyAllEstimateFinalApproved } = require('../services/telegram.service');
  ...
}
```

**Test cases** — `backend/tests/vitest/regression/estimateQuotationLock.test.js` (extends Milestone 1's file):
- Full workflow: create estimate → JE uploads → submit → ZO approve → HO approve (Final Approved) → assert `is_locked = true`.
- HO reopens → assert the same row is STILL `is_locked = true` → JE uploads a 2nd quotation → assert 2nd row `is_locked = false`.
- Re-approve to Final Approved again → assert 2nd row now also `is_locked = true`, 1st unchanged.

**Acceptance criteria:**
- [ ] Quotations lock automatically only at the Final Approved transition.
- [ ] Reopen never un-freezes previously-locked quotations (the single most important behavior in this feature).
- [ ] A lock RPC failure is logged but never blocks HO's approval action.

---

## Milestone 4 — Frontend

**Goal:** Upload UI at the end of estimate entry (per approved mockup); read-only list + flag toggle for ZO/HO review.

**Files:**
- `frontend/src/api/estimatesApi.js` (4 new functions)
- `frontend/src/components/estimates/QuotationUpload.jsx` (new dir — only `estimatedBill/` exists today)
- `frontend/src/components/estimates/QuotationList.jsx` (new, read-only + flag toggle)
- `frontend/src/pages/EstimateForm.jsx` (mount `QuotationUpload` after the item table)
- `frontend/src/pages/EstimateView.jsx` (mount `QuotationList` in ZO/HO review view)

**API additions:**
```js
export const uploadQuotation = (id, file, vendorLabel) => {
  const formData = new FormData();
  formData.append('file', file);
  if (vendorLabel) formData.append('vendor_label', vendorLabel);
  return authApi.post(`/estimates/${id}/quotations`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};
export const getQuotations = (id) => authApi.get(`/estimates/${id}/quotations`);
export const deleteQuotation = (id, quotationId) => authApi.delete(`/estimates/${id}/quotations/${quotationId}`);
export const toggleQuotationFlag = (id, quotationId, flagged) =>
  authApi.patch(`/estimates/${id}/quotations/${quotationId}/flag`, { flagged });
```

**QuotationUpload.jsx (JE, editable):**
- `<input type="file" accept="application/pdf" multiple>` + optional "Vendor / Dealer name (optional)" text input (one per select-batch, not per-file).
- Client-side PDF-type pre-check (UX only, server re-validates).
- Sequential upload per file (avoid parallel multipart races), each persists immediately on success — no page-level "save" gates this.
- Each row shows an **immediate "Uploaded" confirmation badge with the delete control right there** — one-click undo for a wrong-file mistake, not a pending/staged state.
- Delete button hidden (not disabled) once `is_locked === true` or the estimate leaves `EDITABLE_STATUSES` — reuse `EstimateForm`'s existing editability boolean, don't recompute it.
- No fixed max file count — scrollable list past ~6 items.

**QuotationList.jsx (ZO/HO, read-only + flag):**
- ZO view: shows all rows including soft-deleted (visually distinguished, e.g. greyed/strikethrough).
- HO view: active rows only.
- "Flag for replacement" toggle per row, calling `toggleQuotationFlag` — stays clickable even on locked rows.
- Flagged rows get a visible badge/outline so JE notices without a separate remarks channel.

**Acceptance criteria:**
- [ ] Upload control appears only after the item table, matching the approved mockup.
- [ ] Multiple files uploadable in one action, no artificial cap.
- [ ] Non-PDF rejected client-side with a clear message before hitting the network.
- [ ] Delete control disappears once locked or out of an editable status — no dead clickable UI.
- [ ] ZO sees full history incl. soft-deleted; HO sees active-only.
- [ ] Flag toggle visible and functional for ZO/HO, including on locked rows.
- [ ] Upload confirmation is immediate — no UI copy implies a "pending until saved" state.

**Frontend tests:** new `frontend/src/utils/estimateQuotationPermissions.js` (pure functions: `canUploadQuotation(estimate, user)`, `canDeleteQuotation(quotation, estimate, user)`, `canFlagQuotation(quotation, estimate, user)` — same shape as `estimatedBillPermissions.js`: pure boolean, no side effects, mirrors the backend RBAC rules above so button visibility can't silently drift from authorization) + colocated `.test.js`.

---

## Cross-cutting: Out of Scope

- ❌ Full per-quotation remark/comment threads (free text + authorship + history) — `flagged_for_replacement` boolean covers "ZO/HO wants this changed" without a new table or thread UI.
- ❌ Mandatory-quotation validation blocking submission.
- ❌ Storage object deletion on soft delete (kept for audit/recovery, matches repo convention elsewhere).

## Open item to settle before Milestone 1 ships
- Whether a `flagged_for_replacement` toggle should produce its own audit_log entry (currently it does not — see NOTE in the Milestone 1 SQL). Cheap either way, just needs a yes/no before the migration is final.

## Suggested build order
1. **Milestone 1** (schema, bucket, lock RPC, audit trigger) — ~45-60 min
2. **Milestone 2** (backend CRUD + flag endpoint + RBAC matrix) — ~2-2.5 hrs, CRUD is a direct copy-adapt of `raFinalBill.uploads.controller.js`
3. **Milestone 3** (freeze hook) — ~15-20 min, 5-line addition to an existing function
4. **Milestone 4** (frontend, incl. vendor label + flag toggle UI) — ~2-2.5 hrs
5. Tests fold into each milestone as you go, not batched at the end (per the repo's own test policy doc)

**Total: a realistic full day**, not half — the lock/reopen semantics and role-scoped visibility are what take the time, even though each individual piece is small.
