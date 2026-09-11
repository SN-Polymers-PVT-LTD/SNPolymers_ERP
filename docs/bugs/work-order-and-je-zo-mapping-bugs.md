# Work Order Mappings & JE-ZO Mappings — Bug Report

**Date:** 2026-08-29
**Scope:** `Work Order Mappings` screen (JE ↔ Work Order assignment) and `JE-to-ZO User Mappings` screen (JE ↔ Zonal Office assignment), backend and frontend.
**Trigger:** Tester reported that inactive/deactivated Work Order Mappings appear to show "historical data instead of real-time", and that the UX feels complicated. Investigation confirmed the underlying defect and was extended to the sibling JE-ZO Mappings module.

**Overall health score: 5.5 / 10**
- Work Order Mappings: **6/10** — core flow works, role-gating and a DB-level zonal-consistency trigger back it up, but the audit trail isn't a true point-in-time snapshot and a related query in `zoBalances.controller.js` is broken.
- JE-ZO Mappings: **5/10** — same audit-trail weakness, plus a non-transactional transfer operation that can orphan a Junior Engineer (no active ZO, no active work orders) under a failure or a race.

Neither controller has dedicated automated tests — both are only touched incidentally inside unrelated milestone test files (`backend/tests/vitest/milestones/milestone_p7_m2.test.js`, `milestone_p7_m3.test.js`).

---

## Bug Index

| # | Module | Bug | Severity |
|---|--------|-----|----------|
| 1 | Work Order Mappings | Deactivation audit trail is resolved live, not snapshotted | Critical |
| 2 | Work Order Mappings (cross-module) | `zoBalances.controller.js` queries a column that doesn't exist on `work_order_mappings` | High |
| 3 | Work Order Mappings | Active/Inactive/All is a cosmetic filter, no real history view | Medium |
| 4 | Work Order Mappings | List sorted only by `assigned_at`, never by `deactivated_at` | Low |
| 5 | Work Order Mappings | No pagination/limit on the backend list query | Low |
| 6 | JE-ZO Mappings | Multi-step transfer is not transactional — can orphan a JE | Critical |
| 7 | JE-ZO Mappings | Unique-constraint race on transfer surfaces as opaque 500, not 409 | High |
| 8 | JE-ZO Mappings | TOCTOU on the pending/hold requisition guard | Medium |
| 9 | JE-ZO Mappings | Work-order deallocation scope can miss mappings whose project changed ZO | Medium |
| 10 | JE-ZO Mappings | Deactivation audit trail is resolved live, not snapshotted | Critical |
| 11 | JE-ZO Mappings | No explicit "unmap" action, only implicit deactivation via transfer | Low |
| 12 | JE-ZO Mappings | ZO name fallback can display a raw mobile number | Low |

---

## Bug 1 — Work Order Mapping "Deactivation Info" is not a real audit snapshot

**Severity:** Critical
**Location:** `backend/src/controllers/workOrderMappings.controller.js:230-266` (`getWorkOrderMappings`, `resolveDisplayNames`)

**Summary:** `zo_name`, `je_name`, `assigned_by_name`, and `deactivated_by_name` are computed on every read via a live join to `projects_master.zo_user_id` and a fresh lookup against `authorised_users.display_name`. Nothing about the JE/ZO identity or name is stored on the `work_order_mappings` row itself. So a deactivated mapping's displayed "Deactivation Info" reflects **today's** state of related entities, not the state that was true when it was assigned or deactivated.

**How to reproduce:**
1. Assign JE `A` to Work Order `WO-1` (owned by ZO `Z1`).
2. Deactivate that mapping (reason: "Removed").
3. Reassign `WO-1`'s project to a different Zonal Office `Z2` in `projects_master` (or rename `Z1`'s `display_name`).
4. Reload the Work Order Mappings screen, filter to "Inactive".
5. Observe the deactivated `WO-1`/JE `A` row now shows ZO `Z2` (or the renamed `Z1`) as the "Zonal Officer" — not the ZO that was actually in effect when the mapping was live.

**Fix plan:**
- Add `zo_user_id`, `zo_name`, `je_name`, `assigned_by_name` (and `deactivated_by_name` at deactivation time) as denormalized columns on `work_order_mappings`, populated at `INSERT`/`UPDATE` time in the controller (or via a DB trigger mirroring `fn_audit_zonal_modules`).
- Change `getWorkOrderMappings` to read the stored snapshot fields directly instead of re-joining/re-resolving on every request. Live joins can remain only for the *active* mappings view if "always current" is actually desired there — but historical/inactive rows must read from the snapshot.

**How to solidify:**
- Add an integration test (new file `backend/tests/vitest/workOrderMappings.test.js`, following the request/response assertion style used in `milestone_p7_m2.test.js`) that: creates a mapping, deactivates it, mutates the related project's ZO, re-fetches, and asserts the returned `zo_name`/`je_name` on the inactive row are unchanged from assignment time.
- Add a `NOT NULL` constraint on the new snapshot columns for rows where `is_active = false`, so a deactivation write path that forgets to populate them fails loudly instead of silently falling back to a live join.

---

## Bug 2 — `zoBalances.controller.js` selects a non-existent column on `work_order_mappings`

**Severity:** High
**Location:** `backend/src/controllers/zoBalances.controller.js:90`

**Summary:** `supabase.from('work_order_mappings').select('zo_user_id')` — but per the schema (`backend/src/db/migrations/00_full_schema_dump.sql:2823-2836`), `work_order_mappings` has no `zo_user_id` column; it only exists via join to `projects_master`. The query errors, and because only `data` is destructured from the `Promise.all` result (not `error`), the failure is silently swallowed — `mappedWos` ends up `null`/empty on every call.

**How to reproduce:**
1. As `admin` or `ho`, call `GET /api/v1/auth/zo-balances`.
2. Ensure a ZO's only signal of being "mapped" is an active `work_order_mappings` row (no matching `projects_master`, `je_zo_mappings`, `zo_fund_ledger`, `requisitions`, or `fund_requests` row referencing them directly).
3. Observe that ZO is missing from the returned `balances` list, even though they have an active work order assignment.

**Fix plan:**
- Replace the query with a join through `projects_master`, e.g. `supabase.from('work_order_mappings').select('work_order_no, projects_master!inner(zo_user_id)').eq('is_active', true)`, then map `w.projects_master.zo_user_id` into `mappedZoIds` — mirroring the pattern already used in `workOrderMappings.controller.js:230-232`.
- While fixing, destructure and check `error` on every entry in the `Promise.all` array (or use `Promise.all` with explicit `.throwOnError()` per Supabase client version) so a broken query fails the request instead of silently omitting data.

**How to solidify:**
- Add a test asserting a ZO with *only* an active work order mapping (no other mapped source) appears in `GET /api/v1/auth/zo-balances`.
- Add a lightweight lint/CI check (or a one-time script) that validates every `.select(...)` column list against the schema dump for Supabase queries — this exact class of bug (querying a column that doesn't exist) won't be caught by JS type checking.

---

## Bug 3 — Active/Inactive/All is a cosmetic filter, not a real history view

**Severity:** Medium
**Location:** `frontend/src/pages/WorkOrderMappings.jsx:39, 208-220`

**Summary:** The "Active / Inactive / All" toggle is a client-side `.filter()` over one fully-fetched list, all rows using the same table layout and only a colored badge distinguishing status. There's no dedicated audit/history view, which is very likely what the tester meant by "the UX might be complicated."

**How to reproduce:**
1. Open the Work Order Mappings screen with a mix of active and inactive mappings.
2. Toggle between "Active", "Inactive", "All" — note it's an instant client-side re-filter of already-loaded data, with identical column layout for both states (the "Deactivation Info" column is just blank for active rows).
3. Compare to the mental model of an audit log: there's no separate "History" tab, no distinct visual treatment, no indication that inactive rows represent past-tense events rather than current state.

**Fix plan:**
- Split into two tabs: "Active Assignments" (the default, actionable, with a Deactivate button) and "History" (read-only, all past mappings with deactivation metadata prominently shown, sorted by `deactivated_at` — see Bug 4).
- Consider fetching each tab's data via a status-scoped query param instead of fetching everything and filtering client-side, once Bug 5's pagination is addressed.

**How to solidify:**
- No test needed for a pure UX change; validate manually per project convention (`/run` skill) before shipping — check both tabs render correctly for `admin`/`ho`/`zo` roles.

---

## Bug 4 — Inactive list sorted only by `assigned_at`, never by `deactivated_at`

**Severity:** Low
**Location:** `backend/src/controllers/workOrderMappings.controller.js:238`

**Summary:** `getWorkOrderMappings` always orders by `assigned_at DESC`. When viewing the "Inactive" filter, this means the most recently *deactivated* mapping isn't necessarily at the top — a mapping assigned long ago but deactivated yesterday can appear below one assigned recently but deactivated months ago.

**How to reproduce:**
1. Create mapping `A` (assigned January), deactivate it in August.
2. Create mapping `B` (assigned July), deactivate it in July.
3. Filter to "Inactive" — `B` appears above `A` despite `A` being the more recently deactivated record.

**Fix plan:**
- When `statusFilter === 'inactive'`, sort by `deactivated_at DESC` instead of `assigned_at DESC` (either via a query param passed to the backend, or client-side re-sort of the already-fetched inactive rows).

**How to solidify:**
- No dedicated test required; covered by manual verification alongside Bug 3's tab split.

---

## Bug 5 — No pagination/limit on the backend list query

**Severity:** Low
**Location:** `backend/src/controllers/workOrderMappings.controller.js:230-238`

**Summary:** `getWorkOrderMappings` fetches the entire `work_order_mappings` table (scoped only by role) on every page load, with no `LIMIT`/range. Fine today; will degrade as history accumulates, especially once every deactivated mapping is retained forever for audit purposes (which Bug 1's fix makes more valuable to keep).

**Fix plan:**
- Add server-side pagination (`.range()`) driven by the existing frontend `page`/`pageSize` state, replacing the current fetch-all-then-slice-client-side approach in `WorkOrderMappings.jsx:352`.

**How to solidify:**
- Add a test with a seeded large mapping count asserting the endpoint respects `limit`/`offset` params and returns a total count for the frontend's `Pagination` component.

---

## Bug 6 — JE-ZO transfer is not transactional — can orphan a Junior Engineer

**Severity:** Critical
**Location:** `backend/src/controllers/userMappings.controller.js:87-140` (`createOrUpdateUserMapping`)

**Summary:** Transferring a JE to a new ZO executes three sequential, independent Supabase writes: (1) deactivate the JE's active work-order mappings under the old ZO, (2) deactivate the old `je_zo_mappings` row, (3) insert the new `je_zo_mappings` row. There is no database transaction wrapping these. If step 3 fails for any reason (e.g. the partial unique index `idx_je_zo_mappings_active_unique` on `(je_user_id) WHERE is_active = true` rejects a concurrent insert — see Bug 7), the JE is left with **no active ZO mapping and no active work orders**, and the two prior deactivations already committed.

**How to reproduce:**
1. Fire two concurrent `POST /api/v1/auth/user-mappings` requests transferring the same JE to two different ZOs (simulate with `Promise.all` of two axios calls, or two browser tabs submitting near-simultaneously).
2. Both requests pass the "existing mapping" read (step 3 in the code) before either writes.
3. Both proceed to deactivate old work orders and the old mapping; both attempt to insert a new active `je_zo_mappings` row.
4. The DB's partial unique index allows only one insert to succeed; the other throws (unhandled `23505`, see Bug 7) after its own deactivation writes already committed.
5. Result: the JE has old work orders and old mapping deactivated, and no active mapping from either request — orphaned.

**Fix plan:**
- Wrap steps 1-4 in a single Postgres transaction, ideally via a Supabase RPC / stored procedure (`fn_transfer_je_to_zo(je, zo, actor)`) that performs the deactivate-old-work-orders, deactivate-old-mapping, and insert-new-mapping atomically, rolling back entirely on any failure (including a unique-constraint violation).
- Until an RPC is built, at minimum re-order operations to insert the new mapping *first* (relying on the unique index to reject if another active mapping already exists) and only deactivate the old mapping/work orders *after* the insert succeeds — reduces (does not eliminate) the orphan window, but a real fix needs a transaction.

**How to solidify:**
- Add an integration test that runs two concurrent transfer requests for the same JE and asserts: exactly one succeeds, the JE ends up with exactly one active `je_zo_mappings` row, and — critically — that the losing request's side effects (work order/mapping deactivation) either didn't happen or were rolled back.
- Add a scheduled/CI consistency check (or a one-off audit script) that flags any JE with `active_zo_user_id = null` who has a deactivated `je_zo_mappings` row with `reason`-equivalent "Transferred" but no newer active row — this is exactly the orphan signature Bug 6 produces, and reason-checking will catch existing orphans caused before the fix ships.

---

## Bug 7 — Unique-constraint race on transfer surfaces as opaque 500

**Severity:** High
**Location:** `backend/src/controllers/userMappings.controller.js:140`

**Summary:** `createWorkOrderMapping` (the sibling controller) explicitly catches Postgres error code `23505` and returns a clean `409` (`workOrderMappings.controller.js:137-144`). `createOrUpdateUserMapping`'s insert has no equivalent handling — `if (insertErr) throw insertErr;` — so the same class of race (two concurrent transfers for one JE hitting `idx_je_zo_mappings_active_unique`) surfaces as a generic `500 Failed to create user mapping`, on top of the orphaned state from Bug 6.

**How to reproduce:** Same as Bug 6, step 4 — inspect the HTTP response of the losing request; it's a `500` with a generic message rather than an actionable `409`.

**Fix plan:**
- Mirror the `insertErr.code === '23505'` handling from `workOrderMappings.controller.js:138-143` in `createOrUpdateUserMapping`, returning a `409` with a message like "Junior Engineer was just mapped to a Zonal Office by another request. Please refresh and retry."
- This is a smaller, immediately-shippable fix independent of Bug 6's full transactional rewrite, but does not by itself resolve the orphaning — pair with Bug 6.

**How to solidify:**
- Extend the Bug 6 concurrency test to assert the losing request specifically receives a `409` with the conflict message, not a `500`.

---

## Bug 8 — TOCTOU on the pending/hold requisition guard

**Severity:** Medium
**Location:** `backend/src/controllers/userMappings.controller.js:60-74`

**Summary:** Before transferring a JE, the code checks for `requisitions` in `Pending`/`Hold` status tied to that JE and blocks the transfer if any exist. This check happens well before the actual transfer writes (steps 3-4, ~15-60 lines later with no lock in between). A requisition created in that gap isn't caught.

**How to reproduce:**
1. Start a transfer request for JE `A` (currently has zero pending/hold requisitions) — pause it after the guard check (e.g. via a debugger breakpoint, or simply race it against step 2 below in practice).
2. Concurrently, submit a new requisition for JE `A` with status `Pending`.
3. Let the transfer request continue — it proceeds and transfers JE `A` despite the now-existing pending requisition.

**Fix plan:**
- Re-check the requisition guard inside the same transaction/RPC used to fix Bug 6, immediately before the writes (ideally with a `SELECT ... FOR UPDATE` or equivalent row lock on the JE's requisitions, or simply re-querying right before the insert within the same transaction).

**How to solidify:**
- Add a test that creates a pending requisition for a JE mid-transfer (simulated via two sequential calls close together) and asserts the transfer is rejected, not just the pre-check.

---

## Bug 9 — Work-order deallocation scope can miss mappings whose project changed ZO

**Severity:** Medium
**Location:** `backend/src/controllers/userMappings.controller.js:91-113`

**Summary:** When deactivating a JE's old work orders during a transfer, the code looks up `projects_master` rows where `zo_user_id = oldMapping.zo_user_id` (the ZO being transferred *away from*), then deactivates the JE's active `work_order_mappings` for those work order numbers. But `projects_master.zo_user_id` is mutable — if a project was reassigned to a *different* ZO sometime after the JE was mapped to it, that work order won't appear in `oldProjectWos`, and the JE's active mapping to it is never deactivated.

**How to reproduce:**
1. JE `A` is mapped to ZO `Z1`; JE `A` is assigned Work Order `WO-1` (owned by `Z1` at the time).
2. Reassign `WO-1`'s project to ZO `Z2` in `projects_master` (without touching the work order mapping).
3. Transfer JE `A` from `Z1` to `Z3` via the UI/API.
4. Inspect `work_order_mappings` for `WO-1`/JE `A` — it's still `is_active = true`, even though JE `A` no longer belongs to `Z1` or `Z2`.

**Fix plan:**
- Change the deallocation query to deactivate by the JE's actual active `work_order_mappings` rows directly (`.eq('je_user_id', je_mobile_number).eq('is_active', true)`), rather than deriving the work-order set from the old ZO's current project list. This is simpler and correct regardless of whether a project's ZO ownership drifted after assignment.

**How to solidify:**
- Add a test reproducing the exact scenario above (project ZO reassigned after work-order mapping created, then JE transferred) and assert the stale work-order mapping is deactivated.

---

## Bug 10 — JE-ZO Mapping "Deactivation Info" is not a real audit snapshot

**Severity:** Critical
**Location:** `backend/src/controllers/userMappings.controller.js:174-194` (`getUserMappings`)

**Summary:** Same defect as Bug 1, in the sibling module: `je_name`, `zo_name`, `assigned_by_name`, `deactivated_by_name` are resolved via a fresh `authorised_users` lookup on every read rather than stored on the `je_zo_mappings` row.

**How to reproduce:** Same pattern as Bug 1 — map JE `A` to ZO `Z1`, deactivate/transfer, rename `Z1`'s `display_name` in `authorised_users`, reload the JE-ZO Mappings screen filtered to "Inactive", observe the old row shows the new name.

**Fix plan:**
- Same approach as Bug 1: snapshot `je_name`, `zo_name`, `assigned_by_name` at insert time and `deactivated_by_name` at deactivation time onto `je_zo_mappings`, and read from those columns instead of re-resolving live.

**How to solidify:**
- Same as Bug 1: integration test asserting a renamed user doesn't retroactively change a deactivated mapping's displayed name; `NOT NULL` constraint on snapshot columns for inactive rows.

---

## Bug 11 — No explicit "unmap" action for JE-ZO mappings

**Severity:** Low
**Location:** `backend/src/routes/userMappings.routes.js` (route list), `frontend/src/pages/UserMappings.jsx:324-329`

**Summary:** The only way to deactivate a `je_zo_mappings` row through this API is implicitly, by transferring the JE to a *new* ZO (`createOrUpdateUserMapping`). There's no endpoint to simply unmap a JE without assigning a replacement. The UI already anticipates a mapping being deactivated with no `deactivated_by` (`UserMappings.jsx:324-329` renders "Auto (Project Inactive)" as a fallback), implying some other process elsewhere deactivates these rows automatically — but nothing in this controller does it, so that fallback's actual source needs to be located and confirmed still functioning correctly.

**Fix plan:**
- Add a `PATCH /api/v1/auth/user-mappings/:id/deactivate` endpoint mirroring `deactivateWorkOrderMapping`, for admin/ho to unmap a JE without forcing an immediate reassignment.
- Separately (not this bug, but a follow-up investigation): locate the automated process implied by the "Auto (Project Inactive)" UI text and confirm it still runs and sets `deactivated_at` correctly even when it can't set `deactivated_by`.

**How to solidify:**
- Add a test for the new deactivate endpoint mirroring the existing `deactivateWorkOrderMapping` tests once those exist (see Bug 1's test recommendation).

---

## Bug 12 — ZO name fallback can display a raw mobile number

**Severity:** Low
**Location:** `frontend/src/pages/UserMappings.jsx:590-598` (`mappingMapToZoName`)

**Summary:** In the Assign/Transfer modal, resolving a JE's current ZO name checks `eligibleZOs` (active ZO *user accounts* only) first, then falls back to searching already-fetched `mappings` for an active mapping to that ZO. If the ZO user account has since been deactivated (`authorised_users.is_active = false`), neither source may resolve a `display_name`, and the raw mobile number is shown instead of a name.

**How to reproduce:**
1. JE `A` is actively mapped to ZO `Z1`.
2. Deactivate `Z1`'s user account (`authorised_users.is_active = false`) without deactivating the `je_zo_mappings` row.
3. Open the Assign/Transfer modal, search for JE `A` — the "Current: ..." badge shows `Z1`'s raw mobile number instead of their display name.

**Fix plan:**
- Have `mappingMapToZoName` fall back to a direct `authorised_users` lookup by mobile number (ignoring `is_active`) rather than only searching the two already-active-scoped lists, since a deactivated user can still legitimately have historical/active mapping context to display.

**How to solidify:**
- No backend test needed; add to manual QA checklist for the transfer modal.

---

## Appendix: What's already solid

These aren't bugs, but they explain why some of the races above produce *orphaned* state rather than *duplicated* state, and give confidence the modules aren't as fragile as the bug count alone suggests:

- **Role enforcement is correct server-side.** Every route (`workOrderMappings.routes.js`, `userMappings.routes.js`) applies `verifyJwt` + `requireRole([...])` matching what the frontend hides via `isReadOnly` — there's no way to bypass the UI restriction by calling the API directly.
- **Partial unique indexes back the "one active mapping" invariant** at the DB level: `idx_je_zo_mappings_active_unique` on `(je_user_id) WHERE is_active = true` and `idx_work_order_mappings_active_unique` on `(work_order_no, je_user_id) WHERE is_active = true` (`00_full_schema_dump.sql:3178, 3254`). This is exactly why Bug 6/7's race produces an orphan instead of a silent duplicate — the DB rejects the second write, the application code just doesn't handle that rejection gracefully yet.
- **DB-level validation triggers** exist independent of application code: `fn_validate_work_order_mapping_zonal_consistency` and `fn_validate_je_zo_mapping_roles` (`00_full_schema_dump.sql:3394, 3398`) act as a backstop against zonal-mismatch or wrong-role assignments even if application-layer checks are ever bypassed or buggy.
- **Foreign keys with `ON DELETE RESTRICT`** on every user/project reference prevent a referenced user or project from being deleted out from under a mapping.
- **An audit trigger already exists** (`fn_audit_zonal_modules`, `00_full_schema_dump.sql:3302, 3326`) firing on insert/update to both tables — worth checking whether this can be leveraged or extended as part of the Bug 1/10 snapshot fix, rather than building snapshot logic purely in the controllers.
- **`createWorkOrderMapping` already gets unique-constraint handling right** (`workOrderMappings.controller.js:137-144`) — Bug 7 is really "bring `createOrUpdateUserMapping` up to the same standard," not a novel pattern to invent.
