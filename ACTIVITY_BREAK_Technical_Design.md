# Work Order Activity Break — Technical Design Document

> **Status:** Senior engineering review complete — approved with changes 2026-08-13.  
> **Follows:** `ACTIVITY_BREAK_Product_Description.md`  
> **Codebase branch:** `daily-progress-activity-break`

---

## 1. Overview

This document translates the product requirements into a precise, file-by-file technical plan. Every design decision is anchored to a pattern already established in the codebase. Nothing is invented from scratch unless the feature strictly requires it.

---

## 2. State Machine (Canonical Status Values)

The `work_order_activity_breaks` table will use a `VARCHAR` status column constrained by a `CHECK` to the following **seven** terminal and non-terminal states:

| Status string | Terminal? | Set by |
|---|---|---|
| `Pending ZO Review` | No | JE (on create) |
| `Pending HO Review` | No | ZO Accept |
| `Active` | No | HO Approve |
| `Reopen Requested` | No | ZO RequestReopen |
| `Rejected by ZO` | Yes | ZO Reject |
| `Cancelled by JE` | Yes | JE Cancel |
| `Ended` | Yes | HO ApproveReopen |

`Cancelled by JE` is a dedicated terminal state (**review resolution §3.1**) — not an alias of `Rejected by ZO`. This avoids a false ZO attribution in the audit log and removes the actor-inference logic from the frontend.

This follows the existing pattern of `VARCHAR` + `CHECK` constraint used on `excess_fund_returns.status` (see [`00_full_schema_dump.sql` L153](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql)), rather than creating a new Postgres ENUM. Reason: ENUM additions require a separate `ALTER TYPE` DDL that can't be done inside a transaction, making the migration harder to roll back.

---

## 3. Database Layer

### 3.1 New Table — `work_order_activity_breaks`

```sql
CREATE TABLE IF NOT EXISTS "public"."work_order_activity_breaks" (
    "id"                    UUID          DEFAULT gen_random_uuid() NOT NULL,
    "work_order_no"         VARCHAR       NOT NULL,
    "status"                VARCHAR       NOT NULL,

    -- Break period (expected_end_date is the JE's estimate — review §2)
    "start_date"            DATE          NOT NULL,
    "expected_end_date"     DATE          NOT NULL,

    -- JE submission
    "je_user_id"            VARCHAR       NOT NULL,
    "je_remarks"            TEXT          NOT NULL,   -- required by product spec §7

    -- ZO action
    "zo_user_id"            VARCHAR,                  -- populated on ZO action
    "zo_remarks"            TEXT,                     -- required only on ZO Reject
    "zo_actioned_at"        TIMESTAMPTZ,

    -- HO action (approve-only, no rejection)
    "ho_user_id"            VARCHAR,
    "ho_actioned_at"        TIMESTAMPTZ,

    -- Reopen
    "reopen_requested_by"   VARCHAR,              -- ZO who requested reopen
    "reopen_remarks"        TEXT,                 -- optional (review §9 decision 1)
    "reopen_requested_at"   TIMESTAMPTZ,
    "reopen_ho_user_id"     VARCHAR,
    "reopen_ho_actioned_at" TIMESTAMPTZ,

    "created_at"            TIMESTAMPTZ   DEFAULT now() NOT NULL,
    "updated_at"            TIMESTAMPTZ   DEFAULT now() NOT NULL,

    CONSTRAINT "work_order_activity_breaks_pkey"
        PRIMARY KEY ("id"),
    CONSTRAINT "work_order_activity_breaks_wo_fkey"
        FOREIGN KEY ("work_order_no")
        REFERENCES "public"."projects_master"("work_order_no") ON DELETE RESTRICT,
    CONSTRAINT "work_order_activity_breaks_je_fkey"
        FOREIGN KEY ("je_user_id")
        REFERENCES "public"."authorised_users"("mobile_number") ON DELETE RESTRICT,
    CONSTRAINT "work_order_activity_breaks_status_check"
        CHECK (status IN (
            'Pending ZO Review',
            'Pending HO Review',
            'Active',
            'Reopen Requested',
            'Rejected by ZO',
            'Cancelled by JE',
            'Ended'
        )),
    CONSTRAINT "work_order_activity_breaks_date_order_check"
        CHECK (expected_end_date >= start_date)  -- input sanity only; never used for enforcement
);
```

#### Key indexes

```sql
-- Fast lookup: "does this WO have a non-terminal break right now?"
CREATE INDEX IF NOT EXISTS "idx_activity_breaks_wo_status"
    ON "public"."work_order_activity_breaks" ("work_order_no", "status");

-- Fast lookup used in inactivity service and progress submission guard
CREATE INDEX IF NOT EXISTS "idx_activity_breaks_active"
    ON "public"."work_order_activity_breaks" ("work_order_no")
    WHERE status = 'Active';
```

#### One non-terminal break constraint (business rule §7)

Enforced via a **unique partial index** — the most idiomatic Postgres approach, zero-overhead at query time:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "idx_activity_breaks_one_active_per_wo"
    ON "public"."work_order_activity_breaks" ("work_order_no")
    WHERE status NOT IN ('Rejected by ZO', 'Cancelled by JE', 'Ended');
```

This index makes it impossible to INSERT a second row for the same `work_order_no` unless all existing rows are in a terminal state.

#### Audit trigger

Follows the exact pattern of `trg_audit_fund_request_status_change` ([`00_full_schema_dump.sql` L674](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql)):

```sql
CREATE OR REPLACE FUNCTION "public"."audit_activity_break_status_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
        VALUES (
            COALESCE(NEW.ho_user_id, NEW.zo_user_id, NEW.je_user_id),
            'STATUS_CHANGE',
            'Activity Break',
            NEW.id::VARCHAR,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status)
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER "trg_audit_activity_break_status_change"
AFTER UPDATE ON "public"."work_order_activity_breaks"
FOR EACH ROW EXECUTE FUNCTION "public"."audit_activity_break_status_change"();
```

---

### 3.2 Materialized View Rewrite — `project_health_mv`

**Why a rewrite is needed:** The current view's `progress_score` and `reporting_score` sub-expressions (lines [2431–2450](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql)) use `now()` directly against `lp.login_date` and against `project_start_date` / `project_end_date`. When a work order has an `Active` break, those expressions silently accumulate penalty. The fix is to introduce a new CTE that looks up any active break and, when one is found, substitutes "frozen" reference points into those expressions.

#### New CTE to add inside `project_health_mv`

```sql
, "active_breaks" AS (
    SELECT
        b.work_order_no,
        b.start_date            AS break_start,
        b.expected_end_date     AS break_expected_end,
        TRUE                    AS is_on_break
    FROM "public"."work_order_activity_breaks" b
    WHERE b.status = 'Active'   -- status-only gate; NO date predicate (review §1.1 / §2)
)
```

> [!IMPORTANT]
> **The `CURRENT_DATE BETWEEN start_date AND expected_end_date` predicate that appeared in the original draft has been removed.** This was the blocking bug identified in the senior engineering review: gating the freeze on the date window meant the freeze would silently lift once `expected_end_date` passed, while the break was still `Active` — reintroducing exactly the false positives this feature exists to eliminate. The status column is the single source of truth for all enforcement.

#### Modified `scores_calculated` CTE — key changes

Two columns change. All other columns and logic remain untouched.

**`days_since_last_report` / `days_since_last_progress_report`:**  
When `ab.is_on_break IS TRUE`, return `0` instead of the live `(now()::date - lp.login_date::date)`. This prevents the stalled-project filter in [`getHoActionableInsights`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/analytics.controller.js) (which fires when `days_since_last_progress_report > 7`, line 639) from flagging on-break work orders.

```sql
CASE
    WHEN ab.is_on_break IS TRUE                THEN 0
    WHEN lp.login_date IS NULL                 THEN 999
    ELSE (now()::date - lp.login_date::date)
END AS days_since_last_report,
```

(Same expression replicated for `days_since_last_progress_report`.)

**`progress_score`:**  
When `ab.is_on_break IS TRUE`, freeze the elapsed-time calculation at `break_start` so the schedule-penalty does not accumulate during the break. The physical progress used is still the real `lp.physical_work_progress` — only the elapsed-time numerator is frozen.

```sql
CASE
    WHEN pm.project_start_date IS NULL
      OR pm.project_end_date   IS NULL        THEN 20::NUMERIC
    WHEN pm.project_end_date = pm.project_start_date THEN 20::NUMERIC
    ELSE
        GREATEST(0::NUMERIC, LEAST(20::NUMERIC,
            20::NUMERIC - (
                GREATEST(0::NUMERIC,
                    (
                        GREATEST(0::NUMERIC,
                            LEAST(1::NUMERIC,
                                (
                                    -- Freeze elapsed time at break_start when on break
                                    (COALESCE(ab.break_start, now()::date)
                                     - pm.project_start_date)::NUMERIC
                                    / NULLIF(pm.project_end_date
                                             - pm.project_start_date, 0)::NUMERIC
                                ) * 100::NUMERIC
                            )
                        )
                        - COALESCE(lp.physical_work_progress, 0::NUMERIC)
                    ) / 100.0
                ) * 20.0
            )
        ))
END AS progress_score,
```

**`reporting_score` / `reporting_health_score`:**  
Same freeze pattern — use `15` on-break so the reporting sub-score doesn't degrade:

```sql
CASE
    WHEN ab.is_on_break IS TRUE                THEN 15
    WHEN lp.login_date IS NULL                 THEN 0
    WHEN (now()::date - lp.login_date::date) <= 1 THEN 15
    WHEN (now()::date - lp.login_date::date) <= 3 THEN 10
    WHEN (now()::date - lp.login_date::date) <= 7 THEN 5
    ELSE 0
END AS reporting_score,
```

**New columns exposed in final SELECT:**

```sql
COALESCE(ab.is_on_break, FALSE)      AS is_on_break,
ab.break_start,
ab.break_expected_end,
-- Derived: TRUE when break is Active but expected_end_date has already passed
(ab.is_on_break IS TRUE AND CURRENT_DATE > ab.break_expected_end)  AS break_overrun
```

`break_overrun` feeds the "running long" visual badge on HO/ZO dashboards (§5.7).

The LEFT JOIN to add to the existing chain in `scores_calculated`:

```sql
LEFT JOIN "active_breaks" ab
    ON pm.work_order_no::text = ab.work_order_no::text
```

#### Dependent views that pick up the change automatically

The following views select from `project_health_mv` and will benefit from the freeze without any additional code change:

| View | Columns consumed | Impact |
|---|---|---|
| `executive_kpi_mv` | `health_score`, `health_status` | Aggregates won't count on-break WOs as Critical |
| `zone_performance_mv` | `health_score`, `delayed_projects` | Zone averages won't be dragged down |
| `budget_leakage_mv` | `days_since_last_progress_report`, `physical_progress` | Anomaly score won't flag on-break WOs as stalled |

> [!IMPORTANT]
> `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index on the view. The existing `idx_project_health_mv_wo` ([schema line 3210](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql)) satisfies this. No new index is needed on the view itself.

---

### 3.3 Migration File

**Filename:** `023_work_order_activity_breaks.sql`

Follows the naming convention enforced by [`apply-migrations.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/scripts/apply-migrations.js): leading numeric prefix, idempotent DDL. The next available number after `020_create_estimate_quotations.sql` is `021`.

**Migration file contents, in order:**
1. `CREATE TABLE IF NOT EXISTS work_order_activity_breaks` with all constraints.
2. `CREATE INDEX IF NOT EXISTS idx_activity_breaks_wo_status`
3. `CREATE INDEX IF NOT EXISTS idx_activity_breaks_active`
4. `CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_breaks_one_active_per_wo`
5. Audit trigger function (`CREATE OR REPLACE FUNCTION`) + trigger (`CREATE OR REPLACE TRIGGER`).
6. `GRANT ALL ON TABLE public.work_order_activity_breaks TO anon, authenticated, service_role`.
7. **`ALTER TABLE "public"."work_order_activity_breaks" ENABLE ROW LEVEL SECURITY;`** ← **review blocker §1.2 — matches every other business table in the schema.**
8. Full `DROP MATERIALIZED VIEW project_health_mv CASCADE` + `CREATE MATERIALIZED VIEW project_health_mv` rewrite.
9. Re-create all CASCADE'd dependent views: `budget_leakage_mv`, `executive_kpi_mv`, `zone_performance_mv` — sourced via `pg_dump` from Supabase (not hand-transcribed) to eliminate drift risk.
10. Re-apply their grants.
11. `SELECT public.refresh_analytics_views();` at the end to populate views immediately.

> [!WARNING]
> `DROP MATERIALIZED VIEW project_health_mv CASCADE` will cascade-drop `budget_leakage_mv`, `executive_kpi_mv`, and `zone_performance_mv`. All three must be explicitly re-defined in the same migration file, in dependency order, **after** `project_health_mv` is re-created. Steps 8–9 handle this.

---

## 4. Backend Layer

### 4.1 New Controller — `activityBreaks.controller.js`

**Location:** `backend/src/controllers/activityBreaks.controller.js`

Pattern follows [`dailyProgress.controller.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/dailyProgress.controller.js): `'use strict'`, Supabase client, Zod validation at the route layer, no raw SQL, `supabase.rpc('refresh_analytics_views')` fired in the background after any state change.

#### Functions and their endpoints

| Function | HTTP Method | Path | Allowed Roles |
|---|---|---|---|
| `createBreakRequest` | `POST` | `/api/v1/auth/activity-breaks` | `je` |
| `getBreakRequests` | `GET` | `/api/v1/auth/activity-breaks` | `je`, `zo`, `ho`, `admin` |
| `getBreakRequestById` | `GET` | `/api/v1/auth/activity-breaks/:id` | `je`, `zo`, `ho`, `admin` |
| `actOnBreakRequest` | `PATCH` | `/api/v1/auth/activity-breaks/:id/action` | `zo`, `ho`, `admin` |

#### `createBreakRequest` logic (JE only)

1. Verify `work_order_no` exists and has `status = 'Running'` in `projects_master`.
2. Verify the JE has an active `work_order_mappings` row for that WO (`je_user_id = req.user.mobile_number`, `is_active = true`).
3. Verify no non-terminal break exists for this WO — app-level 409 first, then the unique partial index is the guaranteed backstop.
4. Validate `expected_end_date >= start_date` (handled by Zod `.refine()` at validation layer; DB `CHECK` constraint acts as backstop).
5. Validate `je_remarks` is non-empty.
6. Insert with `status = 'Pending ZO Review'`.
7. On Postgres `23505` unique-violation error → return explicit `409` with the same message as step 3 (**review §3.2** — race-condition guard).
8. Fire background `refresh_analytics_views()` (consistent with [`dailyProgress.controller.js` L208–215](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/dailyProgress.controller.js)).

#### `actOnBreakRequest` logic — all transitions via one endpoint

| Actor | Current status required | `action` param | New status | Notes |
|---|---|---|---|---|
| JE | `Pending ZO Review` | `Cancel` | `Cancelled by JE` | JE cancels own request (**review §3.1**) |
| ZO | `Pending ZO Review` | `Accept` | `Pending HO Review` | |
| ZO | `Pending ZO Review` | `Reject` | `Rejected by ZO` | `remarks` required |
| HO | `Pending HO Review` | `Approve` | `Active` | |
| ZO | `Active` | `RequestReopen` | `Reopen Requested` | |
| HO | `Reopen Requested` | `ApproveReopen` | `Ended` | |

Authorization gates:
- **Action-to-Role Mapping**: Since `PATCH /:id/action` is exposed to `['je','zo','ho','admin']` at the route layer (to allow JE cancellation), the controller must explicitly check the requested `action` against an allowed roles map (e.g. `Cancel` is `je`; `Accept`/`Reject`/`RequestReopen` is `zo`; `Approve`/`ApproveReopen` is `ho`/`admin`). This prevents role-bypass attempts, rather than relying on status constraints.
- **JE** can only `Cancel` breaks they themselves created (`je_user_id = req.user.mobile_number`).
- **ZO** can only `Accept`/`Reject`/`RequestReopen` breaks for WOs where `projects_master.zo_user_id = req.user.mobile_number`.
- **Admin** bypasses all gating.
- ZO `Reject` action requires non-empty `remarks`.

After every state change: fire `refresh_analytics_views()` in background.

---

### 4.2 New Validation Schema — `activityBreaks.schema.js`

**Location:** `backend/src/validation/activityBreaks.schema.js`

Pattern follows [`fundRequest.schema.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/validation/fundRequest.schema.js) — Zod schemas exported as named constants.

```js
// createBreakRequestSchema — with .refine() for cross-field date validation (review §3.3)
z.object({
  work_order_no:     z.string().trim().min(1),
  start_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  je_remarks:        z.string().trim().min(1, 'Reason is required')
}).refine(
  (d) => d.expected_end_date >= d.start_date,
  { message: 'Expected end date must be on or after start date.', path: ['expected_end_date'] }
);

// actOnBreakRequestSchema — Cancel added (review §3.1)
z.object({
  action:  z.enum(['Cancel', 'Accept', 'Reject', 'Approve', 'RequestReopen', 'ApproveReopen']),
  remarks: z.string().trim().optional()
});
```

---

### 4.3 New Route File — `activityBreaks.routes.js`

**Location:** `backend/src/routes/activityBreaks.routes.js`

Pattern follows [`dailyProgress.routes.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/routes/dailyProgress.routes.js):

```js
router.use(verifyJwt);
router.post('/',            requireRole(['je']),                         validateRequest(createBreakRequestSchema), createBreakRequest);
router.get('/',             requireRole(['je','zo','ho','admin']),        getBreakRequests);
router.get('/:id',          requireRole(['je','zo','ho','admin']),        getBreakRequestById);
// Cancel is a JE action — route is open to all roles; controller enforces actor match
router.patch('/:id/action', requireRole(['je','zo','ho','admin']),        validateRequest(actOnBreakRequestSchema), actOnBreakRequest);
```

---

### 4.4 Register Route in `app.js`

**File:** [`backend/src/app.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/app.js)

Two lines to add alongside the existing route registrations (import block ~L20–38, mount block ~L92):

```js
// import
const activityBreaksRoutes = require('./routes/activityBreaks.routes');

// mount
app.use('/api/v1/auth/activity-breaks', activityBreaksRoutes);
```

---

### 4.5 Modify `dailyProgress.controller.js` — Submission Guard

**File:** [`backend/src/controllers/dailyProgress.controller.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/dailyProgress.controller.js)

Inside `createProgressReport`, after the existing `ALLOWED_PROJECT_STATUSES` check (line 89), insert:

```js
// Block submissions during an active break — status-only, no date-window (review §1.1 / §2)
const { data: activeBreak, error: breakErr } = await supabase
  .from('work_order_activity_breaks')
  .select('id, start_date, expected_end_date')
  .eq('work_order_no', work_order_no.trim())
  .eq('status', 'Active')
  .maybeSingle();

if (breakErr) throw breakErr;
if (activeBreak) {
  return res.status(409).json({
    success: false,
    message: `Daily progress submissions are blocked. This work order is on an approved activity break (started ${activeBreak.start_date}, expected end ${activeBreak.expected_end_date}). Submissions resume once the break is formally reopened.`
  });
}
```

This is a point lookup that uses the `idx_activity_breaks_active` partial index — negligible overhead.

---

### 4.6 Modify `siteVisitInactivity.service.js` — Inactivity Suppression

**File:** [`backend/src/services/siteVisitInactivity.service.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/services/siteVisitInactivity.service.js)

Inside `checkSiteVisitInactivity()`, after the `workOrderNos` set is built (line 137), fetch on-break WOs and exclude them from the check:

```js
// status = 'Active' is the only predicate — NO date window (review §1.1 / §2)
// A break that has overrun its expected_end_date but is still Active continues to suppress alerts.
const { data: onBreakWOs } = await supabase
  .from('work_order_activity_breaks')
  .select('work_order_no')
  .eq('status', 'Active');

const onBreakSet = new Set((onBreakWOs || []).map(b => b.work_order_no));

// Filter mappings before calling groupInactiveWorkOrders
const activeMappings = (mappings || []).filter(m => !onBreakSet.has(m.work_order_no));
```

Then pass `activeMappings` instead of `mappings` to `groupInactiveWorkOrders`. No changes to the existing helper functions or their exports.

---

### 4.7 `telegram.service.js` — Notification Suppression

**File:** [`backend/src/services/telegram.service.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/services/telegram.service.js)

All existing per-WO Telegram notifications (e.g., `notifyZoAndHoBackdatedProgressSubmitted`, `notifyJeProgressActed`) are already unreachable during a break because the submission is blocked at the controller layer (§4.5). No change needed for those.

The scheduled inactivity Telegram blast is suppressed via the `siteVisitInactivity.service.js` guard (§4.6). No changes needed there either.

**New addition:** A helper `notifyBreakStatusChanged(breakRecord, newStatus)` to send an optional Telegram message to the JE when their break transitions to `Active` or `Ended`. Added following the existing notification helper pattern in the file.

---

### 4.8 `analytics.controller.js` — No Code Change Needed

**File:** [`backend/src/controllers/analytics.controller.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/analytics.controller.js)

The stalled-projects query in `getHoActionableInsights` (line 635) already reads from `project_health_mv`:

```js
.gt('days_since_last_progress_report', 7)
```

Because the MV rewrite freezes `days_since_last_progress_report` to `0` for on-break WOs, they will automatically pass through this filter without flagging. **No code change required.**

The `getProjectsHealth` endpoint already does `select('*')` from `project_health_mv`, so the new `is_on_break`, `break_start`, `break_expected_end`, and `break_overrun` columns are included automatically.

---

## 5. Frontend Layer

### 5.1 New API Client — `activityBreaksApi.js`

**Location:** `frontend/src/api/activityBreaksApi.js`

```js
import api from './index';

export const getActivityBreaks    = (params) => api.get('/activity-breaks', { params });
export const getActivityBreakById = (id)     => api.get(`/activity-breaks/${id}`);
export const createActivityBreak  = (data)   => api.post('/activity-breaks', data);
export const actOnActivityBreak   = (id, data) => api.patch(`/activity-breaks/${id}/action`, data);
```

---

### 5.2 Page Layout — Ledger Integration

No standalone page is created. All activity break interactions (listing, requesting, cancelling, and reviewing) are integrated directly into the existing `DailyProgress.jsx` page drill-down layout (under the selected project's daily ledger spreadsheet view) as described in §10.

---

### 5.3 New Components — `frontend/src/components/activityBreaks/`

| File | Pattern reference | Purpose |
|---|---|---|
| `ActivityBreakStatusBadge.jsx` | `FundRequestStatusBadge.jsx` | Pill badge for 7 status values |
| `NewBreakRequestModal.jsx` | `NewFundRequestModal.jsx` | JE form: date pickers (start_date, expected_end_date), remarks |
| `BreakActionModal.jsx` | [`HOActionModal.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/components/fundRequests/HOActionModal.jsx) | ZO Accept/Reject and HO Approve modal |
| `ReopenActionModal.jsx` | `HOActionModal.jsx` | ZO reopen request + HO reopen approval |

---

### 5.4 Modify `Sidebar.jsx` — Navigation Entry

**File:** [`frontend/src/components/Sidebar.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/components/Sidebar.jsx)

Add "Activity Breaks" nav entry (calendar-pause icon) visible to all authenticated roles, linking to `/daily-progress` (directing users to the main daily tracking console where they can open individual projects' ledger).

---

### 5.5 Modify App Routes

No new routes are added to `App.jsx` since the feature is integrated into the existing `/daily-progress` layout.

---

### 5.6 Modify `DailyProgress.jsx` — On-Break Warning Banner

**File:** [`frontend/src/pages/DailyProgress.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/DailyProgress.jsx)

When the JE selects a work order, check if an active break exists (via the API or React Query cache). If yes, render a non-dismissable banner before the submission form:

> ⚠️ **This work order is on an approved Activity Break (YYYY-MM-DD → YYYY-MM-DD). Submissions are blocked until the break is formally reopened.**

---

### 5.7 Modify `HoDashboard.jsx` and `ZoDashboard.jsx` — On-Break Relabeling

**Files:**
- [`frontend/src/pages/HoDashboard.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/HoDashboard.jsx)
- [`frontend/src/pages/ZoDashboard.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/ZoDashboard.jsx)

Wherever `health_status` or a stalled/critical badge is rendered, add two branches for `is_on_break === true` (**review §2 — overrun signal addition**):

| Condition | Badge | Palette |
|---|---|---|
| `is_on_break && !break_overrun` | **"On Break"** | Amber/muted |
| `is_on_break && break_overrun` | **"Break Overdue — Reopen Pending"** | Orange/warning |
| `!is_on_break` | Existing `health_status` badge unchanged | — |

- The `break_overrun` column (computed in the MV as `is_on_break AND CURRENT_DATE > break_expected_end`) is available in every `project_health_mv` row automatically — no extra API call needed.
- The overrun badge prompts ZOs to initiate the reopen flow. The stalled-projects list from `getHoActionableInsights` will already be empty for on-break WOs (MV handles it), so no additional JS filtering is needed.

---

## 6. Complete API Surface

| Method | Path | Auth | Body / Params | Response |
|---|---|---|---|---|
| `POST` | `/api/v1/auth/activity-breaks` | JE | `{ work_order_no, start_date, expected_end_date, je_remarks }` | `201 { success, break }` |
| `GET` | `/api/v1/auth/activity-breaks` | all | `?work_order_no=&status=&page=&limit=` | `200 { success, breaks, pagination }` |
| `GET` | `/api/v1/auth/activity-breaks/:id` | all | — | `200 { success, break }` |
| `PATCH` | `/api/v1/auth/activity-breaks/:id/action` | JE/ZO/HO/Admin | `{ action, remarks? }` | `200 { success, break }` |

### Error contract

| HTTP | Condition |
|---|---|
| `404` | Break not found, or not visible to caller's role |
| `403` | ZO acting on a WO not in their zone; JE cancelling another JE's break |
| `409` | Duplicate non-terminal break for same WO (app-level or Postgres `23505` — both return same message) |
| `409` | Invalid state transition for current status |
| `409` | Progress submission blocked by active break |
| `400` | `expected_end_date < start_date` (Zod `.refine()`), `je_remarks` empty, or ZO reject without `remarks` |

---

## 7. Files Changed — Complete List

> [!NOTE]
> §10.10 (ledger integration decision) removed `ActivityBreaks.jsx` and `BreakRequestTable.jsx` from scope. The route change to `['je','zo','ho','admin']` on the PATCH endpoint (**review §3.1**) is reflected in the routes file below.

### New files

| File | Purpose |
|---|---|
| `backend/src/db/migrations/023_work_order_activity_breaks.sql` | DB migration (includes RLS, `Cancelled by JE`, status-only CTE, `expected_end_date`) |
| `backend/src/controllers/activityBreaks.controller.js` | Business logic (Cancel→`Cancelled by JE`, 23505 handler) |
| `backend/src/routes/activityBreaks.routes.js` | Express router (PATCH open to `je` for Cancel) |
| `backend/src/validation/activityBreaks.schema.js` | Zod schemas (`.refine()`, `expected_end_date`, `Cancel` in enum) |
| `frontend/src/api/activityBreaksApi.js` | API client |
| `frontend/src/components/activityBreaks/ActivityBreakStatusBadge.jsx` | Status badge (7 states) |
| `frontend/src/components/activityBreaks/NewBreakRequestModal.jsx` | JE creation form (date `min`/`max` binding) |
| `frontend/src/components/activityBreaks/BreakActionModal.jsx` | ZO Accept/Reject, HO Approve modal |
| `frontend/src/components/activityBreaks/ReopenActionModal.jsx` | Reopen modal |
| `backend/tests/vitest/regression/activityBreakMvFreeze.test.js` | Behavioral regression test (§11) |

### Modified files

| File | Change summary |
|---|---|
| `backend/src/app.js` | Import + mount `activityBreaksRoutes` |
| `backend/src/controllers/dailyProgress.controller.js` | Active-break guard: status-only, `expected_end_date` in error message |
| `backend/src/services/siteVisitInactivity.service.js` | On-break filter: status-only, no date predicate |
| `backend/src/services/telegram.service.js` | Add `notifyBreakStatusChanged` helper |
| `frontend/src/components/Sidebar.jsx` | Add nav entry linking to `/daily-progress` |
| `frontend/src/pages/DailyProgress.jsx` | Second query, merged ledger (with tiebreaker), break rows, break request button, action modals, pagination, summary metrics |
| `frontend/src/pages/HoDashboard.jsx` | On-Break badge + Overdue badge (`break_overrun`) |
| `frontend/src/pages/ZoDashboard.jsx` | On-Break badge + Overdue badge (`break_overrun`) |
| `backend/tests/manifests/manifestScope.json` | Add `work_order_activity_breaks` to tables list |
| `backend/tests/manifests/indexAllowlist.json` | Add 3 new index names |

---

## 8. Migration Pipeline & Deployment

The existing [`apply-migrations.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/scripts/apply-migrations.js) script handles everything automatically:
- Tracks applied files in `public._migration_log`.
- Sorts by leading numeric prefix → `021_…` runs after `020_…`.
- Wraps each file in `BEGIN … COMMIT` with `ROLLBACK` on failure.
- Idempotent DDL means the migration can be replayed safely.

**Deploy sequence for the maintenance window:**

```bash
# 1. Apply migration to production DB
SUPABASE_TEST_DB_URI=<prod-uri> node backend/scripts/apply-migrations.js

# 2. Deploy new backend (controller, route, daily-progress guard, inactivity filter)
# 3. Deploy new frontend (ledger integration, sidebar entry, On Break / Overdue badges)
# 4. Run behavioral regression tests
#    SUPABASE_TEST_DB_URI=<prod-uri> npx vitest run tests/vitest/regression/activityBreakMvFreeze.test.js
# 5. Smoke-test: create a break request → approve ZO → approve HO
#    Verify: progress submission blocked, inactivity alert suppressed, MV shows is_on_break=true
#    Set expected_end_date to yesterday → confirm break_overrun=true + Overdue badge appears
# 6. Rollback plan: revert deployment; run manual DROP TABLE + DROP INDEX if needed
```

> [!CAUTION]
> The `DROP MATERIALIZED VIEW … CASCADE` in the migration briefly takes down the analytics views while they are being re-created. This is the primary reason for the maintenance window. The views are repopulated by `refresh_analytics_views()` at the end of the migration, typically completing in seconds on the current dataset.

---

## 9. Resolved Design Decisions

| # | Question | Decision |
|---|---|---|
| 1 | `reopen_remarks` required? | **Optional** — `TEXT NULL`, no backend enforcement |
| 2 | JE can cancel `Pending ZO Review`? | **Yes** — `Cancel` action → `Cancelled by JE` (**not** reused `Rejected by ZO`) |
| 3 | JE sees full ZO/HO action timestamps? | **No** — status + dates only |
| 4 | New break allowed after `Ended`? | **Yes** — unique partial index excludes all three terminal states |

---

## 10. Ledger Integration — Activity Break Rows in the Daily Progress Sheet

This is the key UX decision from the product owner: **Activity Break records must appear inline in the existing "Daily Log History Ledger"** ([`DailyProgress.jsx` L586–810](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/DailyProgress.jsx)), interleaved chronologically with progress report rows. There is **no separate Activity Breaks page**; the feature lives entirely inside the Daily Progress drill-down view.

### 10.1 Data Fetching — New Query in `DailyProgress.jsx`

When a work order is selected (`activeWO` is set), a second React Query is added alongside the existing `progressReports` query:

```js
const { data: breakRecordsData } = useQuery({
  queryKey: ['activityBreaks', 'project', activeWO?.work_order_no],
  queryFn: async () => {
    const res = await getActivityBreaks({ work_order_no: activeWO.work_order_no });
    return res.data?.breaks ?? [];
  },
  enabled: !!activeWO,
  staleTime: 30 * 1000
});
const breakRecords = breakRecordsData || [];
```

### 10.2 Merged & Sorted Timeline

Before rendering the table, both datasets are merged into a single chronologically-sorted list. Each entry is tagged with a `_rowType` discriminator:

```js
const mergedLedger = useMemo(() => {
  const progressRows = (reports || []).map(r => ({
    ...r,
    _rowType: 'progress',
    _sortDate: r.site_visit_date
  }));

  const breakRows = (breakRecords || []).map(b => ({
    ...b,
    _rowType: 'break',
    _sortDate: b.start_date
  }));

  return [...progressRows, ...breakRows].sort((a, b) => {
    // Primary: chronological by date string (ISO format — localeCompare is safe)
    const dateDiff = a._sortDate.localeCompare(b._sortDate);
    if (dateDiff !== 0) return dateDiff;
    // Tiebreaker (review §3.4): on same day, break rows sort before progress rows
    // A break starting that day logically explains why no progress row follows
    if (a._rowType === 'break' && b._rowType === 'progress') return -1;
    if (a._rowType === 'progress' && b._rowType === 'break') return 1;
    return 0;
  });
}, [reports, breakRecords]);
```

Pagination (`pageFeed`, `feedPageSize`) is applied to `mergedLedger`, not to `reports` alone. The serial number (Sl No.) column reflects the merged list index.

### 10.3 Break Row Rendering in the Table

Inside the `mergedLedger.map(...)` loop, a conditional renders either a normal progress row or a styled Break row:

```jsx
{item._rowType === 'break' ? (
  <TableRow key={item.id} hover={false}
    className="bg-amber-500/[0.04] border-l-2 border-amber-500/40">
    <TableCell align="center" className="font-mono font-semibold border-r border-white/5 text-slate-500" size="sm">
      {idx + 1}
    </TableCell>
    <TableCell className="border-r border-white/5" size="sm">
      {/* Date range: start → expected_end_date */}
      <span className="font-semibold text-amber-300">
        {item.start_date} → {item.expected_end_date}
      </span>
      {item.break_overrun && (
        <span className="block text-[8px] font-bold text-orange-400 uppercase mt-0.5">Overdue</span>
      )}
    </TableCell>
    <TableCell className="border-r border-white/5" size="sm" colSpan={2}>
      {/* Reason / remarks in place of work details */}
      <span className="text-amber-200/80 italic text-[10px]">
        🔶 Activity Break — {item.je_remarks}
      </span>
    </TableCell>
    <TableCell align="center" className="border-r border-white/5" size="sm">
      {/* No photo */}
      <span className="text-slate-600 text-[9px] italic">N/A</span>
    </TableCell>
    <TableCell className="border-r border-white/5" size="sm">
      <span className="text-slate-500 text-[9px]">{item.zo_remarks || '—'}</span>
    </TableCell>
    <TableCell size="sm">
      {/* Status badge + JE cancel button if eligible */}
      <div className="flex items-center justify-between gap-2">
        <ActivityBreakStatusBadge status={item.status} />
        {isJE && item.status === 'Pending ZO Review' && (
          <button
            onClick={() => handleCancelBreak(item.id)}
            className="text-[8px] text-red-400 hover:text-red-300 font-bold uppercase tracking-wider transition"
          >
            Cancel
          </button>
        )}
        {(isAuthority || user?.role === 'zo') && item.status === 'Pending ZO Review' && (
          <button onClick={() => setBreakActionTarget(item)}
            className="text-[8px] text-emerald-400 hover:text-emerald-300 font-bold uppercase transition">
            Review
          </button>
        )}
        {(isAuthority || user?.role === 'zo') && item.status === 'Active' && (
          <button onClick={() => setReopenTarget(item)}
            className="text-[8px] text-amber-400 hover:text-amber-300 font-bold uppercase transition">
            Reopen
          </button>
        )}
        {user?.role === 'ho' || user?.role === 'admin' ? (
          item.status === 'Pending HO Review' && (
            <button onClick={() => setBreakActionTarget(item)}
              className="text-[8px] text-emerald-400 hover:text-emerald-300 font-bold uppercase transition">
              Approve
            </button>
          )
        ) : null}
      </div>
    </TableCell>
  </TableRow>
) : (
  /* existing progress row JSX unchanged */
)}
```

### 10.4 JE Break Request Form — Inside the Ledger

The **"Append Daily Entry Row"** button (line 590 of `DailyProgress.jsx`) already controls `showCreateFlow`. A second button is added to the same header bar:

```jsx
{isJE && activeWO.status === 'Running' && !activeBreakForThisWO && (
  <button
    onClick={() => setShowBreakRequestFlow(true)}
    className="... amber styling ..."
  >
    🔶 Request Activity Break
  </button>
)}
```

`activeBreakForThisWO` is computed from `breakRecords` — true when any break has a non-terminal status.

When `showBreakRequestFlow` is true, a new inline form row appears **above** the data rows (like `showCreateFlow` does), or more practically, as a compact modal using the existing `Modal` component from `../components/ui` — keeping the ledger table clean.

### 10.5 ZO Action Flow — Inside the Ledger

Instead of a separate `ActivityBreaks.jsx` page, ZO actions happen in modals triggered directly from the Break row's action buttons:

- **`BreakActionModal`** — shown when `breakActionTarget !== null`. ZO Accept/Reject or HO Approve. On submit, calls `actOnActivityBreak(id, { action, remarks })` → invalidates `['activityBreaks', 'project', work_order_no]`.
- **`ReopenActionModal`** — shown when `reopenTarget !== null`. ZO RequestReopen. On HO side, same `BreakActionModal` reused with `ApproveReopen` action.

### 10.6 New Backend Endpoint Required

The existing `GET /api/v1/auth/activity-breaks` endpoint gains a `work_order_no` query filter so the ledger can fetch just the breaks for the open WO:

```
GET /api/v1/auth/activity-breaks?work_order_no=WO-2024-001
```

Role visibility rules in `getBreakRequests`:
- **JE**: only sees breaks for WOs they are mapped to.
- **ZO**: only sees breaks for WOs in their zone (`projects_master.zo_user_id = req.user.mobile_number`).
- **HO / Admin**: sees all.

### 10.7 JE Cancel Flow

```js
const handleCancelBreak = async (breakId) => {
  if (!window.confirm('Cancel this activity break request?')) return;
  try {
    await actOnActivityBreak(breakId, { action: 'Cancel' });
    setSuccess('Break request cancelled.');
    queryClient.invalidateQueries({ queryKey: ['activityBreaks', 'project', activeWO.work_order_no] });
  } catch (err) {
    setError(err.response?.data?.message || 'Failed to cancel break request.');
  }
};
```

This requires a **`Cancel` action** added to both the Zod schema (`actOnBreakRequestSchema`) and the controller transition table:

| Actor | Current status | `action` param | New status |
|---|---|---|---|
| JE | `Pending ZO Review` | `Cancel` | `Cancelled by JE` |

`Cancelled by JE` is a first-class status value in the CHECK constraint (**review §3.1** — not deferred, not inferred). The audit log records the JE's `mobile_number` as `user_id` directly, with no attribution ambiguity.

### 10.8 Ledger Pagination

The existing `pageFeed` / `feedPageSize` state in `DailyProgress.jsx` (lines 131–132) is applied to `mergedLedger` instead of `reports`:

```js
const paginatedLedger = useMemo(() => {
  const start = (pageFeed - 1) * feedPageSize;
  return mergedLedger.slice(start, start + feedPageSize);
}, [mergedLedger, pageFeed, feedPageSize]);
```

The `<Pagination>` component (already imported in `DailyProgress.jsx`) is added below the table.

### 10.9 Summary Metrics Update

The `getSummaryMetrics()` function (line 411) adds two new metrics derived from `breakRecords`:

```js
const totalBreakDays = breakRecords
  .filter(b => ['Active', 'Ended'].includes(b.status))
  .reduce((sum, b) => {
    const start = new Date(b.start_date);
    const end = new Date(b.expected_end_date);  // display-only estimate
    return sum + Math.round((end - start) / (1000*60*60*24)) + 1;
  }, 0);
const activeBreak = breakRecords.find(b => b.status === 'Active') || null;
```

These feed two new summary metric tiles: **"Break Days (Planned)"** and **"Break Status"** (Active / Overdue / none).

---

## 11. Test Plan

### 11.1 Manifest additions (shape coverage)

After the migration is applied locally, add to manifests and regenerate:

**`backend/tests/manifests/manifestScope.json`** — add to `tables`:
```json
"work_order_activity_breaks"
```

**`backend/tests/manifests/indexAllowlist.json`** — add:
```json
"idx_activity_breaks_wo_status",
"idx_activity_breaks_active",
"idx_activity_breaks_one_active_per_wo"
```

Run `backend/scripts/generate-manifests-local.sh` to regenerate `schemaManifest.generated.js` and `indexManifest.generated.js`, then commit the diffs alongside the migration. No RPC allowlist change needed — `refresh_analytics_views` is already covered by `migrationSmoke.test.js`.

### 11.2 Behavioral regression test — `activityBreakMvFreeze.test.js`

**File:** `backend/tests/vitest/regression/activityBreakMvFreeze.test.js`

This is the test that directly guards against re-introduction of the §1.1 blocker. Seed/cleanup helpers follow the pattern in `tests/helpers/seedDashboardProject.js` and `tests/helpers/financialFixture.js`.

```js
describe('activityBreakMvFreeze — project_health_mv freeze behavior', () => {
  // Test 1: days_since_last_report is NOT frozen with no active break
  //   → expect days_since_last_report > 7 for a seeded stale project

  // Test 2: freezes to 0 once status = 'Active', even when expected_end_date is in the past
  //   → seed break with expected_end_date = daysAgo(2), status = 'Active'
  //   → refresh MV
  //   → expect is_on_break = true, days_since_last_report = 0
  //   THIS IS THE REGRESSION CASE: date-window predicate would fail this test

  // Test 3: unfreezes once status = 'Ended'
  //   → UPDATE status → 'Ended', refresh MV
  //   → expect is_on_break = false, days_since_last_report > 7

  // Test 4: cascaded views remain queryable
  //   → SELECT count(*) FROM budget_leakage_mv, executive_kpi_mv, zone_performance_mv
  //   → all resolve without error
});
```

### 11.3 Migration tracking coverage (already handled)

`migrationSmoke.test.js`'s first test (`all SQL migration files are recorded in _migration_log`) is filesystem-driven and will automatically cover `023_work_order_activity_breaks.sql` once it lands — no change needed.

### 10.10 Updated File Change List for Ledger Integration

**Removed from plan** (no longer needed):
- `frontend/src/pages/ActivityBreaks.jsx` — feature lives in the Daily Progress ledger
- `frontend/src/components/activityBreaks/BreakRequestTable.jsx` — no standalone table page

**Still needed**:
- `frontend/src/components/activityBreaks/ActivityBreakStatusBadge.jsx`
- `frontend/src/components/activityBreaks/BreakActionModal.jsx` (triggered from ledger row)
- `frontend/src/components/activityBreaks/ReopenActionModal.jsx` (triggered from ledger row)
- `frontend/src/components/activityBreaks/NewBreakRequestModal.jsx` (triggered from ledger header button)

**Modified** (updated scope):
- [`frontend/src/pages/DailyProgress.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/DailyProgress.jsx) — add second query, merge ledger, render break rows inline, add break request button, add action modals, add pagination, update summary metrics
- `frontend/src/api/activityBreaksApi.js` — unchanged API surface, same file

**Sidebar / App.jsx changes** — still needed, but the sidebar link now navigates to `/daily-progress` (existing page) rather than a new route. Alternatively, the link can deep-link to `/daily-progress` with the expectation that the user selects a WO to see break activity.
