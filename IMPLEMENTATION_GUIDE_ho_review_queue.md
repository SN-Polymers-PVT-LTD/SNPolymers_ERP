# Implementation Guide — HO "Close Review" & Pending-Item Rollover

**Feature:** Let HO close out a requisition sheet's review before every line item has a decision. Items still sitting at `Pending HO Review` when that happens join the existing On Hold/Rejected rollover queue as a new, distinct terminal status (`Pending Review`), so Accounts can pull them into a fresh sheet later — same mechanism, no copy/export files, no new tables.

**Audience:** an SDE (or an LLM coding agent) picking this up cold. Every file path, function name, and constraint referenced below is exact, taken from a full read of the current codebase — not paraphrased.

**Repo:** SNPolymers_ERP. Backend: Node/Express + Supabase (Postgres, business logic lives in Postgres RPC functions, not the JS layer). Frontend: React + `@tanstack/react-query`. Migrations are plain numbered `.sql` files in `backend/src/db/migrations/`, applied in order — highest existing is `040_mapping_snapshots_and_transact_fns.sql`, so this work is `041_...`.

---

## 1. Design decision (read this before writing any code)

The existing Hold/Reject rollover (migration `034_add_line_item_import.sql`, tightened by `036`/`037`) works by giving `acct_requisition_line_items.requisition_status` a **terminal** value (`On Hold`, `Rejected`) that:
- is excluded from every "still needs a decision" count,
- is picked up by a dedicated "importable" query (`getImportEligibleItems`),
- can be copied into a new sheet via `import_acct_line_item_transact`, which stamps `imported_to_sheet_id` on the source row (append-only, source row never mutated again after that).

The natural extension is: give a swept-aside "still fully undecided" item its **own** terminal status, not reuse `Pending HO Review` (that value means "actively awaiting decision on its current sheet" and every guard clause in the codebase keys off it — reusing it here would silently make old and new items indistinguishable) and not reuse `On Hold` (the client explicitly wants to tell them apart via a Status filter).

**New status value: `'Pending Review'`.**
(Deliberately distinct from `'Pending HO Review'` — different enough in code to `grep`, matches the wording already used in the client-facing spec doc.)

State machine addition:

```
Pending HO Review  --[HO clicks "Close Review" while sheet is Submitted]-->  Pending Review (terminal)
```

`Pending Review` behaves exactly like `On Hold`/`Rejected` from here on: shows in the import-eligible queue, importable into a new sheet, dismissible, append-only, never re-decided in place.

**Why this doesn't touch `Returned for Correction`:** that status already has its own same-sheet loop (`resubmit_acct_line_item_transact`, unchanged) and is excluded from the sweep by construction — the RPC below only ever touches rows currently at `Pending HO Review`.

**Why the sheet-status trigger doesn't need to change:** `sync_acct_sheet_review_status` (`028`, tightened by `037`) already flips a sheet from `Submitted` to `Reviewed` the moment zero rows on it remain at `Pending HO Review`, and it doesn't care *why* a row left that status. Bulk-updating the remaining rows to `Pending Review` makes the count hit zero and the trigger fires normally. The new RPC still sets `sheet_status` explicitly too (defense in depth — see §3.1, it matters for the zero-remaining-rows edge case).

---

## 2. Scope checklist

- [ ] DB: new migration `041_close_review_pending_rollover.sql`
- [ ] DB: widen `chk_arli_status` to allow `'Pending Review'`
- [ ] DB: new RPC `close_acct_sheet_review_transact`
- [ ] DB: widen `import_acct_line_item_transact`'s status guard
- [ ] DB: widen `idx_arli_importable` partial index
- [ ] DB: extend `audit_acct_line_item_events` CASE with a `'Pending Review'` branch
- [ ] DB: add a trigram index on `particulars` (new filter, see §5)
- [ ] Backend: `closeSheetReview` controller + route (HO-only)
- [ ] Backend: extend `getImportEligibleItems` — include `Pending Review`, add `particulars` + `status` filters
- [ ] Frontend: `closeSheetReview` API call
- [ ] Frontend: "Close Review" button + confirm dialog on `AcctHoSheetView.jsx`
- [ ] Frontend: status badge color/copy for `Pending Review` (2 files)
- [ ] Frontend: Particulars + Status filters on the import list (2 files)
- [ ] Tests: new regression file + one updated existing test
- [ ] Manual QA pass (§8)

---

## 3. Database changes

### 3.1 New migration file

`backend/src/db/migrations/041_close_review_pending_rollover.sql`

```sql
-- Migration 041: HO can close a sheet's review early; leftover undecided
-- items join the existing Hold/Reject rollover queue as a new terminal
-- status, 'Pending Review', instead of blocking the sheet forever.
--
-- Mirrors 034/036/037's Hold/Reject rollover exactly: no copy-on-close, no
-- new table. A 'Pending HO Review' item just gets a new terminal status
-- value once HO explicitly ends the review session, and from that point on
-- it's handled by the same importable-queue machinery that already exists.
--
-- 'Returned for Correction' items are untouched by this — they keep their
-- own same-sheet resubmit loop (resubmit_acct_line_item_transact), and the
-- sheet-status trigger (028/037) already reopens a Reviewed sheet back to
-- Submitted the moment one of those gets resubmitted. That behavior is not
-- modified here.

-- ----------------------------------------------------------------------------
-- 1. Widen the status CHECK constraint.
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."acct_requisition_line_items" DROP CONSTRAINT "chk_arli_status";
ALTER TABLE "public"."acct_requisition_line_items" ADD CONSTRAINT "chk_arli_status"
    CHECK (requisition_status IS NULL OR requisition_status IN (
        'Pending HO Review', 'Approved', 'Partially Approved',
        'On Hold', 'Returned for Correction', 'Rejected', 'Pending Review'
    ));

-- ----------------------------------------------------------------------------
-- 2. RPC: close_acct_sheet_review_transact
--    HO-only. Sweeps every remaining 'Pending HO Review' item on the sheet
--    into 'Pending Review', then marks the sheet 'Reviewed' directly (not
--    relying solely on the trigger cascade — if the sheet already has zero
--    Pending HO Review items when this is called, the bulk UPDATE below
--    touches 0 rows and the trigger never fires, so this RPC still has to
--    set sheet_status itself as the real source of truth).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."close_acct_sheet_review_transact"(
    p_sheet_id    uuid,
    p_closed_by   varchar
) RETURNS acct_requisition_sheets LANGUAGE plpgsql AS $$
DECLARE
    v_sheet       acct_requisition_sheets;
    v_swept_count integer;
BEGIN
    SELECT * INTO v_sheet FROM acct_requisition_sheets WHERE id = p_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found.'; END IF;

    IF v_sheet.sheet_status <> 'Submitted' THEN
        RAISE EXCEPTION 'Only a Submitted sheet can have its review closed. Current: %',
            v_sheet.sheet_status USING ERRCODE = 'STA08';
    END IF;

    UPDATE acct_requisition_line_items
    SET requisition_status = 'Pending Review',
        updated_at = now()
    WHERE sheet_id = p_sheet_id
      AND requisition_status = 'Pending HO Review';
    GET DIAGNOSTICS v_swept_count = ROW_COUNT;

    -- Explicit, not just relying on sync_acct_sheet_review_status's own
    -- UPDATE — covers the 0-rows-swept case (sheet already fully decided,
    -- HO clicks Close Review anyway) where the trigger above never fires.
    UPDATE acct_requisition_sheets
    SET sheet_status = 'Reviewed', updated_at = now()
    WHERE id = p_sheet_id AND sheet_status = 'Submitted'
    RETURNING * INTO v_sheet;

    -- v_sheet may be stale (not re-selected) if the trigger already flipped
    -- it to Reviewed and this UPDATE's WHERE no longer matched — re-fetch
    -- to guarantee the return value is accurate either way.
    IF v_sheet IS NULL THEN
        SELECT * INTO v_sheet FROM acct_requisition_sheets WHERE id = p_sheet_id;
    END IF;

    RETURN v_sheet;
END; $$;

-- ----------------------------------------------------------------------------
-- 3. import_acct_line_item_transact: widen the importable-status guard.
--    Full function body reproduced from 034 with just the one IN-list and
--    its error message changed — keep everything else identical.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."import_acct_line_item_transact"(
    p_source_item_id  uuid,
    p_target_sheet_id uuid,
    p_imported_by     varchar
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_source       acct_requisition_line_items;
    v_sheet_status varchar;
    v_new_item     acct_requisition_line_items;
BEGIN
    SELECT sheet_status INTO v_sheet_status
    FROM acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.'; END IF;
    IF v_sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05';
    END IF;

    SELECT * INTO v_source
    FROM acct_requisition_line_items WHERE id = p_source_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source line item not found.'; END IF;

    IF v_source.requisition_status NOT IN ('On Hold', 'Rejected', 'Pending Review') THEN
        RAISE EXCEPTION 'Only On Hold, Rejected, or Pending Review line items can be imported.' USING ERRCODE = 'VAL05';
    END IF;
    IF v_source.imported_to_sheet_id IS NOT NULL THEN
        RAISE EXCEPTION 'This line item has already been imported.' USING ERRCODE = 'STA06';
    END IF;
    IF v_source.import_dismissed THEN
        RAISE EXCEPTION 'This line item has been dismissed and cannot be imported.' USING ERRCODE = 'STA07';
    END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by, imported_from_item_id,
        account_sub_title_id, account_sub_title_text, particulars, particulars_id,
        beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name,
        debit_bank_ac_type, req_amount, payment_mode, cheque_no, cheque_date
    ) VALUES (
        p_target_sheet_id, p_imported_by, v_source.id,
        v_source.account_sub_title_id, v_source.account_sub_title_text,
        v_source.particulars, v_source.particulars_id,
        v_source.beneficiary_ac_no, v_source.beneficiary_name,
        v_source.beneficiary_ifsc, v_source.beneficiary_bank_name,
        v_source.debit_bank_ac_type, v_source.req_amount, v_source.payment_mode,
        v_source.cheque_no, v_source.cheque_date
    ) RETURNING * INTO v_new_item;

    UPDATE acct_requisition_line_items
    SET imported_to_sheet_id = p_target_sheet_id,
        imported_at = now(),
        imported_by = p_imported_by,
        updated_at = now()
    WHERE id = p_source_item_id;

    RETURN v_new_item;
END; $$;

-- ----------------------------------------------------------------------------
-- 4. Widen the importable-items partial index to cover the new status.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS "idx_arli_importable";
CREATE INDEX "idx_arli_importable"
    ON acct_requisition_line_items (created_at DESC)
    WHERE requisition_status IN ('On Hold', 'Rejected', 'Pending Review')
      AND imported_to_sheet_id IS NULL
      AND import_dismissed = false;

-- ----------------------------------------------------------------------------
-- 5. Audit trail: give 'Pending Review' its own action label instead of
--    falling through to the generic 'STATUS_CHANGE' ELSE branch.
--    Full function body reproduced from 021 (as last modified by 037) with
--    one new WHEN branch added — everything else identical.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."audit_acct_line_item_events"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_action VARCHAR;
  v_user   VARCHAR;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'LINE_ITEM_ADDED', 'Acct Requisition Line Item', NEW.id::VARCHAR, NULL,
            jsonb_build_object('sheet_id', NEW.sheet_id, 'req_amount', NEW.req_amount,
                               'payment_mode', NEW.payment_mode));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN

    CASE NEW.requisition_status

      WHEN 'Pending HO Review' THEN
        IF OLD.requisition_status IS NULL THEN
          v_action := 'PENDING_HO_REVIEW_FIRST_SUBMIT';
          v_user   := NEW.created_by;
        ELSIF NEW.reopened_at IS DISTINCT FROM OLD.reopened_at THEN
          v_action := 'REOPEN';
          v_user   := NEW.reopened_by;
        ELSIF NEW.revision_number > OLD.revision_number THEN
          v_action := 'RESUBMIT_AFTER_CORRECTION';
          v_user   := NEW.created_by;
        ELSE
          v_action := 'PENDING_HO_REVIEW_ENTER';
          v_user   := NEW.created_by;
        END IF;

      WHEN 'Approved', 'Partially Approved' THEN
        v_action := 'HO_APPROVED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'On Hold' THEN
        v_action := 'HO_HELD';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Returned for Correction' THEN
        v_action := 'HO_RETURNED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Rejected' THEN
        v_action := 'HO_REJECTED';
        v_user   := NEW.ho_actioned_by;
      -- NEW: swept aside by close_acct_sheet_review_transact. There's no
      -- per-item HO actor for this transition (it's a sheet-level action,
      -- not a per-item decision) — fall back to created_by, same convention
      -- RESUBMIT_AFTER_CORRECTION already uses for a non-HO-actioned event.
      WHEN 'Pending Review' THEN
        v_action := 'HO_CLOSED_REVIEW_UNDECIDED';
        v_user   := NEW.created_by;
      ELSE
        v_action := 'STATUS_CHANGE';
        v_user   := COALESCE(NEW.ho_actioned_by, NEW.created_by);
    END CASE;

    IF OLD.requisition_status = 'On Hold' AND NEW.requisition_status <> 'On Hold' THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
      VALUES (NEW.ho_actioned_by, 'HO_HOLD_RELEASED', 'Acct Requisition Line Item', NEW.id::VARCHAR,
              jsonb_build_object('requisition_status', OLD.requisition_status, 'ho_remarks', OLD.ho_remarks),
              jsonb_build_object('requisition_status', NEW.requisition_status),
              clock_timestamp());
    END IF;

    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
    VALUES (v_user, v_action, 'Acct Requisition Line Item', NEW.id::VARCHAR,
            jsonb_build_object('requisition_status', OLD.requisition_status,
                               'ho_process', OLD.ho_process,
                               'ho_actioned_by', OLD.ho_actioned_by,
                               'revision_number', OLD.revision_number),
            jsonb_build_object('requisition_status', NEW.requisition_status,
                               'ho_process', NEW.ho_process,
                               'ho_pass_amount', NEW.ho_pass_amount,
                               'ho_actioned_by', NEW.ho_actioned_by,
                               'bank_balance_master_id', NEW.bank_balance_master_id,
                               'revision_number', NEW.revision_number,
                               'is_reopened', NEW.is_reopened),
            clock_timestamp());
  END IF;
  RETURN NEW;
END; $$;

-- ----------------------------------------------------------------------------
-- 6. New filter: Particulars free-text search on the import-eligible list
--    (client asked for Particulars alongside the existing sub-title/date
--    filters). Same trigram-index pattern as 031's sub-title/beneficiary
--    indexes — pg_trgm is already enabled by that migration.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_arli_particulars_trgm"
    ON acct_requisition_line_items USING gin (particulars extensions.gin_trgm_ops);
```

**Error code note:** `mapAcctRpcError` in `acctRequisition.controller.js` maps `STA05/STA06/STA07` (and `STA01/STA03`) to HTTP 409. Add `'STA08'` to that same `case` block (§4.1) — it's the new code this RPC raises for "sheet isn't Submitted."

---

## 4. Backend changes

### 4.1 `backend/src/controllers/acctRequisition.controller.js`

**a) Add `'STA08'` to `mapAcctRpcError`:**

```js
function mapAcctRpcError(rpcErr) {
  switch (rpcErr.code) {
    case 'STA01':
    case 'STA03':
    case 'STA05':
    case 'STA06':
    case 'STA07':
    case 'STA08':                 // <-- add this line
      return { status: 409, message: rpcErr.message };
    ...
```

**b) New controller function**, placed near `submitSheet` (same section, "Line items — Accounts side" or a new "HO side" grouping — put it next to `actOnLineItemsBatch` since it's an HO action):

```js
/**
 * POST /acct-requisitions/sheets/:sheetId/close-review
 * HO ends a review session before every line item has a decision. Every
 * item still at 'Pending HO Review' on this sheet becomes 'Pending Review'
 * — a new terminal status that joins the existing On Hold/Rejected
 * rollover queue (close_acct_sheet_review_transact, 041). Sheet moves to
 * 'Reviewed' regardless of how many items were actually decided.
 */
async function closeSheetReview(req, res) {
  const { sheetId } = req.params;
  if (!uuidRegex.test(sheetId)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const { data, error: rpcErr } = await supabase.rpc('close_acct_sheet_review_transact', {
      p_sheet_id: sheetId,
      p_closed_by: req.user.mobile_number
    });

    if (rpcErr) {
      const mapped = mapAcctRpcError(rpcErr);
      if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });
      throw rpcErr;
    }

    return res.status(200).json({ success: true, sheet: data, message: 'Review closed. Remaining items moved to the pending queue.' });
  } catch (error) {
    console.error(`closeSheetReview failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to close sheet review.' });
  }
}
```

Add `closeSheetReview` to the `module.exports` block at the bottom of the file.

**c) Extend `getImportEligibleItems`** — widen the status filter, add `particulars` and `status` query params:

```js
async function getImportEligibleItems(req, res) {
  try {
    const query = req.query || {};
    const isExport = query.export === 'true' || query.export === true;

    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 20;
    if (limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    const ALL_ELIGIBLE_STATUSES = ['On Hold', 'Rejected', 'Pending Review'];

    let dbQuery = supabase
      .from('acct_requisition_line_items')
      .select('*', { count: 'exact' })
      .in('requisition_status', ALL_ELIGIBLE_STATUSES)
      .is('imported_to_sheet_id', null)
      .eq('import_dismissed', false);

    // NEW: narrow to one specific status, still within the eligible set —
    // an out-of-set value (e.g. 'Approved') would otherwise silently widen
    // nothing since .in() above already constrains the base set.
    if (query.status && ALL_ELIGIBLE_STATUSES.includes(query.status)) {
      dbQuery = dbQuery.eq('requisition_status', query.status);
    }

    // NEW: Particulars free-text filter (idx_arli_particulars_trgm, 041).
    if (query.particulars) {
      dbQuery = dbQuery.ilike('particulars', `%${query.particulars}%`);
    }

    if (query.account_sub_title) {
      dbQuery = dbQuery.ilike('account_sub_title_text', `%${query.account_sub_title}%`);
    }

    if (query.beneficiary_ac_no) {
      dbQuery = dbQuery.ilike('beneficiary_ac_no', `%${query.beneficiary_ac_no}%`);
    }

    if (query.debit_bank_ac_type) {
      dbQuery = dbQuery.eq('debit_bank_ac_type', query.debit_bank_ac_type);
    }

    if (query.date_from) {
      dbQuery = dbQuery.gte('created_at', query.date_from);
    }

    if (query.date_to) {
      dbQuery = dbQuery.lte('created_at', `${query.date_to}T23:59:59.999`);
    }

    dbQuery = dbQuery.order('created_at', { ascending: false });
    dbQuery = isExport ? dbQuery.limit(5000) : dbQuery.range(offset, offset + limit - 1);

    // ... rest of the function (sheet enrichment, response shaping) is UNCHANGED.
```

Everything after the query-building block (the sheet-number/status enrichment join, the `isExport` branch, pagination response) stays exactly as-is — only the query construction above changes.

### 4.2 `backend/src/routes/acctRequisition.routes.js`

Add the import and the route (HO-only, same `hoRoles` gate as `actOnLineItem`/`actOnLineItemsBatch`):

```js
const {
  createSheet, getSheets, getSheetById, getLineItems, deleteSheetIfEmpty, addLineItem, updateLineItem,
  deleteLineItem, submitSheet, actOnLineItem, actOnLineItemsBatch, resubmitLineItem,
  closeSheetReview,                                    // <-- add
  getImportEligibleItems, importLineItem, dismissImportEligibleItem,
  ...
} = require('../controllers/acctRequisition.controller');
```

```js
router.post('/sheets/:sheetId/close-review', requireRole(hoRoles), closeSheetReview);
```

Place it right after the existing `router.post('/sheets/:sheetId/items/batch-action', ...)` line — same section, same role gate.

No new Zod schema needed — the endpoint takes no body, just a URL param already covered by the existing `uuidRegex.test(sheetId)` check inside the controller (same pattern `deleteSheetIfEmpty`/`submitSheet` already use, no `validateRequest` wrapper).

---

## 5. Frontend changes

### 5.1 `frontend/src/api/acctRequisitionsApi.js`

Find wherever `submitSheet`/`actOnLineItemsBatch` are defined and add:

```js
export const closeSheetReview = (sheetId) =>
  api.post(`/acct-requisitions/sheets/${sheetId}/close-review`);
```

(Match whatever the existing `api.post(...)` call signature looks like in this file — check `submitSheet`'s exact implementation and mirror it precisely, including any base URL prefix already applied by the shared `api` instance.)

Also extend the `getImportEligibleItems` API function's params passthrough if it currently whitelists specific keys (check the file — if it just spreads a params object through, no change needed there; if it destructures specific named params, add `particulars` and `status`).

### 5.2 `frontend/src/pages/AcctHoSheetView.jsx`

This is the actual HO decision screen — `Submit Decisions` is currently `disabled={!allDecided}` (line ~338), meaning HO is *blocked* from finishing review until every row has a staged decision. Add a **separate, always-available "Close Review" action** next to it, not a change to `Submit Decisions`'s own gating.

**a) Import the API call and add local state for a confirm dialog:**

```jsx
import { getSheetById, actOnLineItemsBatch, closeSheetReview, getBankBalances, getIndianBanks, getParticulars } from '../api/acctRequisitionsApi';
```

```jsx
const [showCloseConfirm, setShowCloseConfirm] = useState(false);
const [closingReview, setClosingReview] = useState(false);
```

**b) Handler**, alongside `handleSubmitDecisions`:

```jsx
const handleCloseReview = async () => {
  setError('');
  setSuccess('');
  setClosingReview(true);
  try {
    // Persist any staged-but-unsubmitted decisions first, same reasoning as
    // handleSubmitDecisions — a decision only staged in local state and
    // never sent would otherwise get silently swept into "Pending Review"
    // by the RPC below, since the RPC only sees DB state.
    if (stagedCount > 0) {
      await handleSubmitDecisions(false);
    }
    await closeSheetReview(id);
    setShowCloseConfirm(false);
    setPremiumSuccess({
      title: 'Review Closed',
      message: 'Remaining undecided items have moved to the pending queue for a future sheet.',
      details: [
        { label: 'Req. No.', value: sheetDetail.sheet_number },
        { label: 'New Status', value: 'Reviewed', pill: true }
      ]
    });
    invalidateSheet();
  } catch (err) {
    setError(err.response?.data?.message || 'Failed to close review.');
  } finally {
    setClosingReview(false);
  }
};
```

**c) Button**, in the header action row next to the existing `Submit Decisions` button (around line 329-344):

```jsx
{actionableItems.length > 0 && (
  <>
    <Button variant="glass" size="sm" onClick={() => handleSubmitDecisions(false)} loading={submittingDecisions} disabled={stagedCount === 0}>
      Save Draft{stagedCount > 0 ? ` (${stagedCount})` : ''}
    </Button>
    <Button
      variant="amber"
      onClick={() => handleSubmitDecisions(true)}
      loading={submittingDecisions}
      disabled={!allDecided}
      title={!allDecided ? 'Stage a decision for every row before finishing review' : undefined}
    >
      Submit Decisions
    </Button>
    {/* NEW */}
    <Button
      variant="glass"
      size="sm"
      onClick={() => setShowCloseConfirm(true)}
      title="Close this review now — any undecided items move to the pending queue"
    >
      Close Review
    </Button>
  </>
)}
```

**d) Confirm dialog** — this matters. The client's own worry earlier in this project was "what if HO closes the sheet by accident" — put a real confirmation in front of it, not a bare click. Check what confirm-dialog primitive this codebase already uses (grep for `ConfirmDialog` or similar in `frontend/src/components/ui`); if one exists, reuse it. If not, a minimal inline pattern using the existing `Modal` (already imported elsewhere, e.g. `ImportEligibleItemsModal.jsx`) works:

```jsx
<Modal isOpen={showCloseConfirm} onClose={() => setShowCloseConfirm(false)} size="md" title="Close Review?">
  <p className="text-sm text-slate-300 mb-2">
    {actionableItems.length - stagedCount} item(s) will still be undecided. They'll move to the
    pending queue — Accounts can bring them into a new sheet later, but they can no longer be
    decided on this one.
  </p>
  <div className="flex justify-end gap-3 mt-6">
    <Button variant="glass" size="sm" onClick={() => setShowCloseConfirm(false)}>Cancel</Button>
    <Button variant="amber" size="sm" onClick={handleCloseReview} loading={closingReview}>
      Close Review
    </Button>
  </div>
</Modal>
```

Adjust the undecided-count math (`actionableItems.length - stagedCount`) if `stagedCount` counts differently than expected — verify against how `stagedCount` is actually computed a few lines up (`Object.values(decisions).filter((d) => d?.action).length`).

**Do not** gate the "Close Review" button's visibility on `allDecided` — it exists specifically for the *not*-all-decided case. It's fine for it to also work when everything is already decided (in that case the RPC just moves the sheet to Reviewed, which would already have happened via the batch action's own trigger cascade — a harmless no-op).

### 5.3 Status badge — two files

`STATUS_VARIANTS` currently maps `{ 'On Hold': 'orange', Rejected: 'red' }` in both:
- `frontend/src/components/acctRequisition/ImportEligibleItemsModal.jsx` (line 6)
- `frontend/src/pages/AcctImportEligibleItems.jsx` (line 8)

Add `'Pending Review'` to both. `Badge.jsx` already supports `slate | amber | emerald | red | blue | indigo | orange` — use `indigo` (not `blue`, which already means "Submitted" sheet-status elsewhere in this same UI; reusing it here would visually conflate two different things):

```js
const STATUS_VARIANTS = { 'On Hold': 'orange', Rejected: 'red', 'Pending Review': 'indigo' };
```

### 5.4 Import list filters — Particulars + Status

**`AcctImportEligibleItems.jsx`** (the standalone "Held / Rejected Items" page) currently has no filter UI at all — it just calls `getImportEligibleItems({ limit: 100 })`. Add:
- a Particulars text input,
- a Status `<select>` with options `All / On Hold / Rejected / Pending Review`,

wired into the `useQuery`'s `queryKey` and `queryFn` params, same pattern as `AcctHoQueue.jsx`'s existing filter sidebar (search/date/status — copy that structural pattern rather than inventing a new one). Update the page's header copy too — it currently says *"Every On Hold or Rejected line item across all sheets..."*; change to *"Every On Hold, Rejected, or Pending Review line item across all sheets..."*, and the page title from "Held / Rejected Items" to "Held / Rejected / Pending Review Items" (or similar — confirm final wording with whoever owns copy).

**`ImportEligibleItemsModal.jsx`** (the in-sheet import modal, opened via "Import Held / Rejected" button in `AcctRequisitionSheetView.jsx`) — same filter additions are optional here since it's a smaller, focused picker (currently no filters at all, just a flat list capped at 100). At minimum, update its empty-state copy (line 82-84) and modal title (line 72, `"Import Held / Rejected Items"` → `"Import Held / Rejected / Pending Review Items"`) and the "Import Held / Rejected" trigger button label in `AcctRequisitionSheetView.jsx` (line 585) for consistency. Adding the same Particulars/Status filters here is a nice-to-have, not required for correctness — prioritize the standalone page (§ above) if time-boxing this.

---

## 6. What NOT to touch

- `actOnLineItem` / `actOnLineItemsBatch` / `approve_acct_line_item_transact` / `act_acct_line_item_non_approve_transact` — all still correctly guard on `requisition_status = 'Pending HO Review'` exactly, unchanged. Once an item becomes `Pending Review` it's just as unreachable from these as `On Hold`/`Rejected` already are.
- `resubmit_acct_line_item_transact` and the `Returned for Correction` same-sheet loop — completely unrelated status value, not swept by `close_acct_sheet_review_transact`'s `WHERE requisition_status = 'Pending HO Review'` clause.
- `sync_acct_sheet_review_status` trigger — unchanged, still only keys off `Pending HO Review` count. Confirmed compatible in §1.
- `deleteSheetIfEmpty` / `delete_empty_acct_sheet_transact` (039) — irrelevant, only applies to `Open` sheets with zero items; a sheet that's had `Close Review` called on it is `Reviewed`, out of scope for that path entirely.

---

## 7. Tests

Existing regression coverage to extend/add (backend, `backend/tests/vitest/regression/`):

**New file `acctSheetCloseReview.test.js`** (mirror the fixture setup in `acctRequisitionImport.test.js`, which already exercises the Hold/Reject import path end to end — reuse `acctRequisitionFixture.js`):

1. **Guard:** calling `close_acct_sheet_review_transact` on an `Open` sheet raises `STA08`.
2. **Guard:** calling it on an already-`Reviewed` sheet raises `STA08`.
3. **Core sweep:** sheet with 3 items — 1 Approved, 1 On Hold, 1 still `Pending HO Review`. After close: sheet is `Reviewed`; the untouched item is now `Pending Review`; the other two are unchanged.
4. **Zero-remaining edge case:** sheet where every item is already decided (no `Pending HO Review` rows left) — calling close-review still succeeds and (redundantly but correctly) leaves the sheet `Reviewed`.
5. **Queue inclusion:** after (3), `getImportEligibleItems` (or the underlying query/RPC) returns the swept item with `requisition_status = 'Pending Review'`.
6. **Import still works:** the swept item can be imported into a new Open sheet via `import_acct_line_item_transact` — assert the new copy's fields match the source, and the source's `imported_to_sheet_id` is stamped, exactly like the existing Hold/Reject import test asserts.
7. **`Returned for Correction` isolation (the exact scenario the client asked about):** sheet with one item `Returned for Correction` and one still `Pending HO Review`. Call close-review. Assert: the `Pending HO Review` item becomes `Pending Review`; the `Returned for Correction` item is untouched; sheet is `Reviewed`. Then call `resubmit_acct_line_item_transact` on the returned item and assert the sheet flips back to `Submitted` (existing trigger behavior, 028/037) — this is the regression check that Close Review didn't break the auto-reopen path.
8. **Status filter:** `getImportEligibleItems({ status: 'Pending Review' })` returns only `Pending Review` rows, not `On Hold`/`Rejected` ones also sitting in the queue.
9. **Particulars filter:** `getImportEligibleItems({ particulars: '<substring>' })` matches case-insensitively via the new trigram index — same shape as the existing `account_sub_title` filter test in `acctRequisitionLineItemsFilter.test.js`, copy that test's structure.

**Existing file to check, not necessarily change:** `acctSheetReviewedStatusSync.test.js` — read it before writing new tests; if it already parametrizes "what statuses keep a sheet at Submitted," add `Pending Review` as a case confirming it does **not** count as pending (i.e., a sheet full of `Pending Review` + decided items is correctly `Reviewed`, same as `On Hold` already proves).

**Frontend:** no existing frontend test file for `AcctHoSheetView.jsx` was found in this pass — if one doesn't exist, a full test suite isn't required for this change; at minimum, manually verify the confirm-dialog flow (§8) since it's the one place a mis-click has real consequences (a batch of live requisitions no longer decidable on that sheet).

---

## 8. Manual QA checklist (run after implementation, before calling this done)

1. Create a sheet with 5 line items, submit it, log in as HO.
2. Decide on 2 of the 5 (mix of Approve/Hold), leave 3 untouched.
3. Click **Close Review** → confirm dialog appears, shows the correct undecided count (3).
4. Cancel → nothing changes, sheet still `Submitted`.
5. Click **Close Review** again → Confirm → sheet becomes `Reviewed`.
6. Go to the Held/Rejected/Pending Review queue (both the standalone page and the in-sheet modal from a *different* Open sheet) → the 3 swept items appear with a `Pending Review` badge (indigo), alongside any real Hold/Reject items already there.
7. Filter the queue by Status = `Pending Review` → only those 3 show. Filter by Particulars text matching one of them → only that one shows.
8. Import one of the 3 into a new Open sheet → succeeds, new line item appears prefilled; the swept item disappears from the queue (now `imported_to_sheet_id` is set).
9. Dismiss another of the 3 → disappears from the queue, no error.
10. Repeat steps 1-3 but this time also put one item at `Returned for Correction` before closing. Close Review. Confirm the Returned item is *not* swept and *not* shown in the pending queue. As Accounts, resubmit that Returned item → confirm the sheet flips back from `Reviewed` to `Submitted` and the item reappears in HO's actionable queue for that same sheet.
11. Click Close Review on a sheet where HO has already decided on every item (no Pending HO Review items left) → should succeed as a no-op (sheet was already `Reviewed`), no error, nothing extra swept.
12. Try calling the close-review endpoint directly (e.g. via curl/Postman) on a sheet that's still `Open` → expect HTTP 409 with the `STA08` message.
