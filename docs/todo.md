# TODO

## Requisition attachment sweep (Phase 3 — deferred)

Context: `docs/` companion to the requisition PDF attachment redesign (migrations `055`,
`056` — fold `zo_user_id` into `create_requisition_secure`, and UUID-keyed storage paths
tracked in a new `requisition_attachments` table with `pending`/`committed` status).
Phases 1 and 2 are implemented, tested (full backend suite + a live HTTP smoke test), and
sitting in the working tree ready for a coordinated deploy. Phase 3 below is the one
remaining piece, deliberately deferred.

### What it closes

The one gap nothing client-side can reach: a browser tab closed or crashed mid-upload,
or any other case where a `pending` attachment row never gets claimed or explicitly
deleted. Everything else (remove-attachment button, GST toggle-off, cancel/close,
component-unmount safety net) already cleans up correctly — this is a last-resort net for
what's structurally unreachable from JS.

### Design (from the original plan)

- **Threshold:** 1 hour (matches the existing signed-URL TTL used elsewhere in this
  codebase).
- **Mechanism:** Supabase `pg_cron` (runs inside Postgres, independent of whether the
  Render backend dyno is awake) marks stale `pending` rows; a lightweight Node-side
  reconciler does the actual Supabase Storage object deletion (storage deletion needs the
  Storage HTTP API, which SQL can't call directly), triggered opportunistically on a small
  random fraction of upload requests rather than its own schedule.

### Blocking checkpoint — needs a human decision before this is implemented

**Confirm `pg_cron` is actually enabled on the Supabase project's plan/tier** (Supabase
dashboard → Database → Extensions, or a support request depending on plan). It is not on
by default on all tiers. If it turns out to be unavailable, fall back to the alternative
discussed and rejected only for infra-simplicity reasons: a GitHub Actions scheduled
workflow hitting a new authenticated internal endpoint (simpler mental model, no Supabase
plan dependency, but pays Render cold-start latency on every run and adds a new
authenticated endpoint as attack surface).

### Implementation sketch (once unblocked)

- `backend/src/db/migrations/057_pending_attachment_sweep.sql`:
  - `CREATE EXTENSION IF NOT EXISTS pg_cron;`
  - Add `is_expired boolean NOT NULL DEFAULT false` to `requisition_attachments` (a plain
    boolean, not an enum value — sidesteps Postgres's restriction on using a newly-added
    enum value in the same transaction it's added in).
  - `mark_stale_pending_attachments()` plpgsql function: `UPDATE requisition_attachments
    SET is_expired = true WHERE status = 'pending' AND created_at < now() - interval '1
    hour'`.
  - `SELECT cron.schedule('mark-stale-attachments', '*/15 * * * *', 'SELECT
    public.mark_stale_pending_attachments();')`.
- `backend/src/services/attachmentSweep.service.js` (new): `reconcileExpiredAttachments()`
  — selects `is_expired = true` rows, groups by bucket, calls
  `supabase.storage.from(bucket).remove(paths)`, deletes the DB rows on success. On
  partial storage failure, leave the row for retry rather than losing track of it.
- `requisitions.uploads.controller.js`: fire-and-forget, non-blocking call to
  `reconcileExpiredAttachments()` on a small random fraction of upload requests (same
  "don't block the response, log-only on failure" pattern already used for the Telegram
  notify calls).
- Tests: `mark_stale_pending_attachments()` (backdated pending row → expired; fresh row →
  untouched) and `reconcileExpiredAttachments()` (expired row with a real uploaded object
  → object and row both gone after the call). Purely additive — no existing tests
  affected.

**Rollback/safety:** fully independent of everything already shipped. Phase 2 is correct
without this — it just accumulates orphaned storage objects/rows more slowly than before
the whole redesign, which is still strictly better than the pre-redesign baseline.
