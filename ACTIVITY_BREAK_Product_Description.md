# Work Order Activity Break — Product Description

## 1. Problem

Work orders regularly need to pause for reasons outside the JE's or the project's
control — monsoon season, festive shutdowns, or other planned site-inactivity
windows lasting roughly 20–30 days. Today the platform has no concept of a
"paused" work order: daily progress reporting is expected every day, inactivity
alerts fire, Telegram notifications keep going out, and the work order's health
scoring keeps penalizing it for a gap it isn't responsible for. This feature adds
a formal **Activity Break** workflow so a pause is a recorded, approved decision
rather than a data gap the system misreads as a problem.

## 2. Actors

| Role | Capability in this feature |
| :--- | :--- |
| **JE** | Raises a break request for a work order they're mapped to. Cannot act during an Active break (submissions blocked). |
| **ZO** | Accepts or Rejects a JE's break request. Later, initiates the Reopen request once ready to resume. |
| **HO** | Approve-only at two points: finalizing an accepted break, and finalizing a reopen. No reject action at HO stage in either flow. |
| **Admin** | Can act at any stage of the flow, consistent with Admin's existing full-access pattern elsewhere in the platform. |

## 3. Flow A — Requesting a Break

1. JE selects a work order they are actively mapped to (must be status `Running`,
   and must not already have a non-terminal break request in flight).
2. JE enters a **start date**, **end date**, and **remarks** (reason for the
   break — e.g. "Monsoon season, site inaccessible").
3. Request submitted → status **Pending ZO Review**.
4. ZO (mapped to that JE's zone) reviews:
   - **Accept** → status **Pending HO Review**, with optional ZO remarks.
   - **Reject** → status **Rejected by ZO** (terminal). The JE may submit a new
     request afterward.
5. HO reviews the ZO-accepted request. HO has **approve-only** capability here —
   there is no HO rejection step. If HO isn't satisfied, the request simply
   remains pending until resolved outside the system (e.g. a conversation with
   the ZO), or the ZO can be asked to have the JE withdraw and resubmit.
   - **Approve** → status **Active**. The break is now in effect for the
     work order, for the given date range.

## 4. Flow B — While a Break Is Active

- **Daily progress submissions are blocked entirely** for that work order. A JE
  attempting to submit a report gets a clear rejection referencing the active
  break's date range. This was a deliberate choice over "allow but ignore" —
  the site is being treated as genuinely paused.
- **No inactivity/staleness alerts** fire for that JE or that work order — this
  covers both the in-app dashboard warnings (JE's "sites needing attention" and
  the Authority "stale sites" list) and the scheduled 10 AM Telegram inactivity
  check.
- **No other Telegram notifications** fire for that work order for the duration
  of the break.
- **Analytics** — handled in two different ways depending on what's being
  protected:
  - The **"stalled/critical" flags** driven by days-since-last-report (surfaced
    in HO's actionable insights and stale-project lists) are filtered out or
    relabeled "On Break" for any work order with an Active break, rather than
    showing as a false-positive problem.
  - The **schedule/progress penalty** (the part of health scoring that compares
    elapsed time against expected progress) is **frozen at the database level**
    for the duration of the break, so the work order doesn't silently
    accumulate an unrecoverable "behind schedule" penalty for time it was
    legitimately paused. This is a materialized-view change, not just a
    frontend filter, and it correctly flows through to the zone- and
    portfolio-level rollups that are built on top of it.
  - **`project_end_date` is explicitly not touched.** That date is a deliberate
    management decision that's already set with known seasonal windows in
    mind. If it ever needs to change, that's a Master Data action taken
    directly by management — never something break-approval logic mutates
    automatically.

## 5. Flow C — Reopening

1. Once a break is Active, the **ZO** raises a **Request Reopen** action
   (with optional remarks) → status **Reopen Requested**.
2. **HO** reviews and, again, has **approve-only** capability:
   - **Approve** → status **Ended**. The break record becomes historical.
3. Once Ended:
   - Daily progress submissions resume normally for the work order.
   - Inactivity monitoring and Telegram notifications resume normally.
   - Analytics scoring resumes normal (unfrozen) calculation going forward.

## 6. State Machine

```
Pending ZO Review
   ├── Reject ──────────────────► Rejected by ZO        [terminal]
   └── Accept ─────────────────► Pending HO Review
                                       └── Approve ─────► Active
                                                              └── ZO requests reopen ─► Reopen Requested
                                                                                              └── HO Approve ─► Ended [terminal]
```

## 7. Business Rules

- Only **one non-terminal break request per work order** at a time — a JE
  cannot raise a second request while one is already Pending ZO Review,
  Pending HO Review, Active, or Reopen Requested.
- `end_date` must not be before `start_date`.
- A reason (`je_remarks`) is required to create a request.
- ZO rejection requires remarks explaining why; ZO acceptance remarks are
  optional.
- A break can only be requested for a work order in `Running` status, by a JE
  who is actively mapped to that work order.
- ZO and HO actions are gated the same way as the rest of the platform — a ZO
  can only act on requests from JEs mapped to their zone; Admin bypasses all
  gating.

## 8. Explicitly Out of Scope / Rejected

- **Shifting `project_end_date`** to compensate for the break duration —
  rejected. That date already reflects management's planning for seasonal
  windows, and it should only ever be changed manually via Master Data.
- **Fully hiding** on-break work orders from analytics — rejected in favor of
  relabeling/freezing, so real signals that have nothing to do with reporting
  gaps (budget variance, material variance) stay visible to HO.
- **Retroactively excluding** break days from historical calculations after
  the fact — not needed, since freezing starts the moment a break goes Active
  and doesn't need to look backward.

## 9. Rollout Plan

- The database change touches a new `work_order_activity_breaks` table plus a
  rewrite of the `project_health_mv` materialized view (which cascades into
  three dependent views built on top of it).
- Applied through the existing tracked migration pipeline, so it's recorded
  and idempotent rather than a one-off manual change.
- A **~1 hour maintenance window** will be announced for the deploy, even
  though the actual schema change is expected to complete in seconds — the
  window covers deployment, verification against the mock data, and a
  rollback buffer if something looks wrong.

## 10. Next Step

A technical design document will follow this one, covering the exact schema,
the materialized-view SQL rewrite, the full list of backend/frontend files
touched, and the API surface — before any code is written.
