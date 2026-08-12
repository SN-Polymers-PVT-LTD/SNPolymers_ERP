# Work Order Activity Break — Technical Design Document

> **Status:** Pre-implementation draft — open questions resolved 2026-08-13.  
> **Follows:** `ACTIVITY_BREAK_Product_Description.md`  
> **Codebase branch:** `daily-progress-activity-break`

---

## 1. Overview

This document translates the product requirements into a precise, file-by-file technical plan. Every design decision is anchored to a pattern already established in the codebase. Nothing is invented from scratch unless the feature strictly requires it.

---

## 2. State Machine (Canonical Status Values)

The `work_order_activity_breaks` table will use a `VARCHAR` status column constrained by a `CHECK` to the following six terminal and non-terminal states:

| Status string | Terminal? |
|---|---|
| `Pending ZO Review` | No |
| `Pending HO Review` | No |
| `Active` | No |
| `Reopen Requested` | No |
| `Rejected by ZO` | Yes |
| `Ended` | Yes |

This follows the existing pattern of `VARCHAR` + `CHECK` constraint used on `excess_fund_returns.status` (see [`00_full_schema_dump.sql` L153](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql)), rather than creating a new Postgres ENUM. Reason: ENUM additions require a separate `ALTER TYPE` DDL that can't be done inside a transaction, making the migration harder to roll back.

---

## 3. Database Layer

### 3.1 New Table — `work_order_activity_breaks`

```sql
CREATE TABLE IF NOT EXISTS "public"."work_order_activity_breaks" (
    "id"                UUID          DEFAULT gen_random_uuid() NOT NULL,
    "work_order_no"     VARCHAR       NOT NULL,
    "status"            VARCHAR       NOT NULL,

    -- Break period
    "start_date"        DATE          NOT NULL,
    "end_date"          DATE          NOT NULL,

    -- JE submission
    "je_user_id"        VARCHAR       NOT NULL,
    "je_remarks"        TEXT          NOT NULL,   -- required by product spec §7

    -- ZO action
    "zo_user_id"        VARCHAR,                  -- populated on ZO action
    "zo_remarks"        TEXT,                     -- required only on ZO Reject
    "zo_actioned_at"    TIMESTAMPTZ,

    -- HO action (approve-only, no rejection)
    "ho_user_id"        VARCHAR,
    "ho_actioned_at"    TIMESTAMPTZ,

    -- Reopen
    "reopen_requested_by"   VARCHAR,              -- ZO who requested reopen
    "reopen_remarks"        TEXT,
    "reopen_requested_at"   TIMESTAMPTZ,
    "reopen_ho_user_id"     VARCHAR,
    "reopen_ho_actioned_at" TIMESTAMPTZ,

    "created_at"        TIMESTAMPTZ   DEFAULT now() NOT NULL,
    "updated_at"        TIMESTAMPTZ   DEFAULT now() NOT NULL,

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
            'Ended'
        )),
    CONSTRAINT "work_order_activity_breaks_date_order_check"
        CHECK (end_date >= start_date)
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
    WHERE status NOT IN ('Rejected by ZO', 'Ended');
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
        b.start_date   AS break_start,
        b.end_date     AS break_end,
        TRUE           AS is_on_break
    FROM "public"."work_order_activity_breaks" b
    WHERE b.status = 'Active'
      AND CURRENT_DATE BETWEEN b.start_date AND b.end_date
)
```

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
COALESCE(ab.is_on_break, FALSE)  AS is_on_break,
ab.break_start,
ab.break_end
```

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

**Filename:** `021_work_order_activity_breaks.sql`

Follows the naming convention enforced by [`apply-migrations.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/scripts/apply-migrations.js): leading numeric prefix, idempotent DDL. The next available number after `020_create_estimate_quotations.sql` is `021`.

**Migration file contents, in order:**
1. `CREATE TABLE IF NOT EXISTS work_order_activity_breaks` with all constraints.
2. `CREATE INDEX IF NOT EXISTS idx_activity_breaks_wo_status`
3. `CREATE INDEX IF NOT EXISTS idx_activity_breaks_active`
4. `CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_breaks_one_active_per_wo`
5. Audit trigger function (`CREATE OR REPLACE FUNCTION`) + trigger (`CREATE OR REPLACE TRIGGER`).
6. `GRANT ALL ON TABLE public.work_order_activity_breaks TO anon, authenticated, service_role`.
7. Full `DROP MATERIALIZED VIEW project_health_mv CASCADE` + `CREATE MATERIALIZED VIEW project_health_mv` rewrite.
8. Re-create all CASCADE'd dependent views: `budget_leakage_mv`, `executive_kpi_mv`, `zone_performance_mv` — exact definitions preserved from the current schema, because CASCADE drops them.
9. Re-apply their grants.
10. `SELECT public.refresh_analytics_views();` at the end to populate views immediately.

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
3. Verify no non-terminal break exists for this WO — the unique partial index will reject the INSERT at DB level too, but we give a clear 409 before the insert attempt.
4. Validate `end_date >= start_date` (also enforced by DB CHECK).
5. Validate `je_remarks` is non-empty.
6. Insert with `status = 'Pending ZO Review'`.
7. Fire background `refresh_analytics_views()` (consistent with [`dailyProgress.controller.js` L208–215](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/dailyProgress.controller.js)).

#### `actOnBreakRequest` logic — all transitions via one endpoint

| Actor | Current status required | `action` param | New status |
|---|---|---|---|
| ZO | `Pending ZO Review` | `Accept` | `Pending HO Review` |
| ZO | `Pending ZO Review` | `Reject` | `Rejected by ZO` |
| HO | `Pending HO Review` | `Approve` | `Active` |
| ZO | `Active` | `RequestReopen` | `Reopen Requested` |
| HO | `Reopen Requested` | `ApproveReopen` | `Ended` |

Authorization gates follow the existing pattern in [`dailyProgress.controller.js` L443–448](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/dailyProgress.controller.js):
- ZO can only act on breaks for WOs where `projects_master.zo_user_id = req.user.mobile_number`.
- Admin bypasses all gating.
- ZO `Reject` action requires non-empty `remarks`.

After every state change: fire `refresh_analytics_views()` in background.

---

### 4.2 New Validation Schema — `activityBreaks.schema.js`

**Location:** `backend/src/validation/activityBreaks.schema.js`

Pattern follows [`fundRequest.schema.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/validation/fundRequest.schema.js) — Zod schemas exported as named constants.

```js
// createBreakRequestSchema
{
  work_order_no: z.string().trim().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  je_remarks: z.string().trim().min(1, 'Reason is required')
}

// actOnBreakRequestSchema
{
  action: z.enum(['Accept', 'Reject', 'Approve', 'RequestReopen', 'ApproveReopen']),
  remarks: z.string().trim().optional()
}
```

---

### 4.3 New Route File — `activityBreaks.routes.js`

**Location:** `backend/src/routes/activityBreaks.routes.js`

Pattern follows [`dailyProgress.routes.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/routes/dailyProgress.routes.js):

```js
router.use(verifyJwt);
router.post('/',            requireRole(['je']),                    validateRequest(createBreakRequestSchema), createBreakRequest);
router.get('/',             requireRole(['je','zo','ho','admin']),  getBreakRequests);
router.get('/:id',          requireRole(['je','zo','ho','admin']),  getBreakRequestById);
router.patch('/:id/action', requireRole(['zo','ho','admin']),       validateRequest(actOnBreakRequestSchema), actOnBreakRequest);
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
// Block submissions during an active break
const { data: activeBreak, error: breakErr } = await supabase
  .from('work_order_activity_breaks')
  .select('id, start_date, end_date')
  .eq('work_order_no', work_order_no.trim())
  .eq('status', 'Active')
  .maybeSingle();

if (breakErr) throw breakErr;
if (activeBreak) {
  return res.status(409).json({
    success: false,
    message: `Daily progress submissions are blocked. This work order is on an approved activity break from ${activeBreak.start_date} to ${activeBreak.end_date}.`
  });
}
```

This is a point lookup that uses the `idx_activity_breaks_active` partial index — negligible overhead.

---

### 4.6 Modify `siteVisitInactivity.service.js` — Inactivity Suppression

**File:** [`backend/src/services/siteVisitInactivity.service.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/services/siteVisitInactivity.service.js)

Inside `checkSiteVisitInactivity()`, after the `workOrderNos` set is built (line 137), fetch on-break WOs and exclude them from the check:

```js
const { data: onBreakWOs } = await supabase
  .from('work_order_activity_breaks')
  .select('work_order_no')
  .eq('status', 'Active')
  .lte('start_date', todayISTStr)
  .gte('end_date', todayISTStr);

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

The `getProjectsHealth` endpoint already does `select('*')` from `project_health_mv`, so the new `is_on_break`, `break_start`, `break_end` columns are included automatically.

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

### 5.2 New Page — `ActivityBreaks.jsx`

**Location:** `frontend/src/pages/ActivityBreaks.jsx`

Top-level page structured the same as [`FundRequests.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/FundRequests.jsx) — dashboard metrics tiles at top, list view with a quick-filters sidebar, and a slide-in detail/action panel for the selected request. React Query (`useQuery`, `useQueryClient`) for data fetching and cache invalidation.

---

### 5.3 New Components — `frontend/src/components/activityBreaks/`

| File | Pattern reference | Purpose |
|---|---|---|
| `ActivityBreakStatusBadge.jsx` | `FundRequestStatusBadge.jsx` | Pill badge for 6 status values |
| `NewBreakRequestModal.jsx` | `NewFundRequestModal.jsx` | JE form: WO selector (Running + mapped), date pickers, remarks |
| `BreakRequestTable.jsx` | `FundRequestTable.jsx` | Role-filtered list table |
| `BreakActionModal.jsx` | [`HOActionModal.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/components/fundRequests/HOActionModal.jsx) | ZO Accept/Reject and HO Approve modal |
| `ReopenActionModal.jsx` | `HOActionModal.jsx` | ZO reopen request + HO reopen approval |
| `BreakRequestDetailPanel.jsx` | `RequestDetailPanel.jsx` | Full status timeline of a break request |

---

### 5.4 Modify `Sidebar.jsx` — Navigation Entry

**File:** [`frontend/src/components/Sidebar.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/components/Sidebar.jsx)

Add "Activity Breaks" nav entry (calendar-pause icon) visible to all authenticated roles, linking to `/activity-breaks`.

---

### 5.5 Modify `App.jsx` — Route

**File:** [`frontend/src/App.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/App.jsx)

```jsx
import ActivityBreaks from './pages/ActivityBreaks';
// ...
<Route path="/activity-breaks" element={<ProtectedRoute><ActivityBreaks /></ProtectedRoute>} />
```

---

### 5.6 Modify `DailyProgress.jsx` — On-Break Warning Banner

**File:** [`frontend/src/pages/DailyProgress.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/DailyProgress.jsx)

When the JE selects a work order, check if an active break exists (via the API or React Query cache). If yes, render a non-dismissable banner before the submission form:

> ⚠️ **This work order is on an approved Activity Break (YYYY-MM-DD → YYYY-MM-DD). Submissions are blocked until the break is closed by the Zonal Officer.**

---

### 5.7 Modify `HoDashboard.jsx` and `ZoDashboard.jsx` — On-Break Relabeling

**Files:**
- [`frontend/src/pages/HoDashboard.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/HoDashboard.jsx)
- [`frontend/src/pages/ZoDashboard.jsx`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/ZoDashboard.jsx)

Wherever `health_status` or a stalled/critical badge is rendered, add a branch for `is_on_break === true`:

- Render an **"On Break"** badge (amber/muted palette) instead of `Critical` or `Warning`.
- The stalled-projects list from `getHoActionableInsights` will already be empty for on-break WOs (MV handles it), so no additional JS filtering is needed.

---

## 6. Complete API Surface

| Method | Path | Auth | Body / Params | Response |
|---|---|---|---|---|
| `POST` | `/api/v1/auth/activity-breaks` | JE | `{ work_order_no, start_date, end_date, je_remarks }` | `201 { success, break }` |
| `GET` | `/api/v1/auth/activity-breaks` | all | `?work_order_no=&status=&page=&limit=` | `200 { success, breaks, pagination }` |
| `GET` | `/api/v1/auth/activity-breaks/:id` | all | — | `200 { success, break }` |
| `PATCH` | `/api/v1/auth/activity-breaks/:id/action` | ZO/HO/Admin | `{ action, remarks? }` | `200 { success, break }` |

### Error contract

| HTTP | Condition |
|---|---|
| `404` | Break not found, or not visible to caller's role |
| `403` | ZO acting on a WO not in their zone |
| `409` | Duplicate non-terminal break for same WO |
| `409` | Invalid state transition for current status |
| `409` | Progress submission blocked by active break |
| `400` | `end_date < start_date`, `je_remarks` empty, or ZO reject without `remarks` |

---

## 7. Files Changed — Complete List

### New files

| File | Purpose |
|---|---|
| `backend/src/db/migrations/021_work_order_activity_breaks.sql` | DB migration |
| `backend/src/controllers/activityBreaks.controller.js` | Business logic |
| `backend/src/routes/activityBreaks.routes.js` | Express router |
| `backend/src/validation/activityBreaks.schema.js` | Zod schemas |
| `frontend/src/api/activityBreaksApi.js` | API client |
| `frontend/src/pages/ActivityBreaks.jsx` | Page |
| `frontend/src/components/activityBreaks/ActivityBreakStatusBadge.jsx` | Status badge |
| `frontend/src/components/activityBreaks/NewBreakRequestModal.jsx` | JE creation form |
| `frontend/src/components/activityBreaks/BreakRequestTable.jsx` | List table |
| `frontend/src/components/activityBreaks/BreakActionModal.jsx` | ZO/HO action modal |
| `frontend/src/components/activityBreaks/ReopenActionModal.jsx` | Reopen modal |
| `frontend/src/components/activityBreaks/BreakRequestDetailPanel.jsx` | Detail view |

### Modified files

| File | Change summary |
|---|---|
| `backend/src/app.js` | Import + mount `activityBreaksRoutes` |
| `backend/src/controllers/dailyProgress.controller.js` | Add active-break guard in `createProgressReport` (after line 95) |
| `backend/src/services/siteVisitInactivity.service.js` | Filter on-break WOs before inactivity group-build (after line 137) |
| `backend/src/services/telegram.service.js` | Add `notifyBreakStatusChanged` helper |
| `frontend/src/App.jsx` | Add route `/activity-breaks` |
| `frontend/src/components/Sidebar.jsx` | Add nav entry |
| `frontend/src/pages/DailyProgress.jsx` | Add on-break warning banner |
| `frontend/src/pages/HoDashboard.jsx` | Render "On Break" badge for `is_on_break` rows |
| `frontend/src/pages/ZoDashboard.jsx` | Render "On Break" badge for `is_on_break` rows |

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
# 3. Deploy new frontend (page, sidebar, warning banner, On Break badge)
# 4. Smoke-test: create a break request → approve through ZO → approve through HO
| 1 | `reopen_remarks` required? | **Optional** — `TEXT NULL` in schema, no backend enforcement |
| 2 | JE can cancel `Pending ZO Review`? | **Yes** — follows the `CancelFundRequestModal` pattern |
| 3 | JE sees full ZO/HO action timestamps? | **No** — JE sees current status + break dates only; no actor detail needed |
| 4 | New break allowed after `Ended`? | **Yes** — unique partial index excludes terminal states, sequential breaks are permitted |

These decisions are already reflected in the schema and controller design above.

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
  // Progress report rows — use site_visit_date as sort key
  const progressRows = (reports || []).map(r => ({
    ...r,
    _rowType: 'progress',
    _sortDate: r.site_visit_date
  }));

  // Break rows — use start_date as sort key; show regardless of status
  const breakRows = (breakRecords || []).map(b => ({
    ...b,
    _rowType: 'break',
    _sortDate: b.start_date
  }));

  return [...progressRows, ...breakRows]
    .sort((a, b) => a._sortDate.localeCompare(b._sortDate));
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
      {/* Date range instead of single date */}
      <span className="font-semibold text-amber-300">
        {item.start_date} → {item.end_date}
      </span>
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
| JE | `Pending ZO Review` | `Cancel` | `Rejected by ZO` |

> [!NOTE]
> We re-use the `Rejected by ZO` terminal state for JE cancellation rather than adding a new `Cancelled` state. The distinction is tracked by checking who performed the action: if `je_user_id === actioned_by`, it was a cancellation. The frontend can render this as "Cancelled" while the DB stores it as `Rejected by ZO`. Alternatively, a dedicated `Cancelled by JE` status string can be added to the CHECK constraint — **decision deferred to implementation, but the schema CHECK allows adding it without a migration risk**.

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
    const end = new Date(b.end_date);
    return sum + Math.round((end - start) / (1000*60*60*24)) + 1;
  }, 0);
const activeBreakStatus = breakRecords.find(b => b.status === 'Active') || null;
```

These feed two new summary metric tiles: **"Break Days (Approved)"** and **"Break Status"** (active/none).

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
