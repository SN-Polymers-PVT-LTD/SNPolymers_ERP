# IDBP Analytics Module — Bug Fix Implementation Plan

**Prepared for:** S.N. Polymers IDBP — Analytics & Reporting Layer
**Scope:** `analytics.controller.js`, `getHoChartData`, materialized views, and 3 chart components
**Author role:** Senior Developer sign-off plan
**Status:** Ready for implementation

---

## 0. Summary & sequencing

Six issues were found during code review, spanning a real authorization gap, a SQL bug, a
business-logic bug in a chart, a UX/data-honesty problem, and a silent-failure error-handling
pattern. They are independent of each other (no shared blast radius), so they can ship as
**separate, small PRs** rather than one large changeset — this keeps review fast and rollback
cheap if any one fix regresses something.

| # | Issue | Severity | Effort | Depends on |
|---|-------|----------|--------|------------|
| 1 | `runwayTrend` / `getHoActionableInsights` leak cross-zone ZO financial data | **P0 – Security** | S | none |
| 2 | `keyFinancialIndicators.notUtilized` ignores zone filter | **P0 – Security/Data integrity** | XS | none |
| 3 | `estimate_accuracy_mv.accuracy_status` mislabels unreviewed WOs | **P1 – Data correctness** | S | DB migration |
| 4 | Fund Flow Waterfall — forecast stage corrupts downstream delta | **P1 – Data correctness** | S | none |
| 5 | `getHoChartData` returns HTTP 200 on failure (silent failure) | **P1 – Reliability** | XS | none |
| 6 | S-Curve chart plots a synthetic curve, not real DPR history | **P2 – Product decision + UX** | M | Product sign-off |

Recommended order: **1 → 2 → 5 → 3 → 4 → 6**. The two security items go out first (and can
ship together as one hotfix PR since they're both in the auth/scoping layer), then the cheap
reliability fix, then the two data-correctness bugs, then the product-dependent chart rework.

---

## 1. P0 — Cross-zone data leak in `runwayTrend` and `getHoActionableInsights`

### Root cause
`getHoChartData` computes `effectiveZone` correctly (forces it to `req.user.mobile_number` when
`role === 'zo'`), but `filteredLedger` — the source for `runwayTrend` — is only filtered by date
range, never by `effectiveZone`. Separately, `getHoActionableInsights` is reachable by the `zo`
role (route allows `execRoles`) but its `zo_balances` / stalled-project / high-revision queries
have no zone filter applied at all.

**Net effect:** any Zonal Officer viewing their own dashboard's "Cash Runway & Projections" chart,
or opening the actionable-insights panel, sees every other zone's available balance, burn rate,
and runway projection — a real cross-tenant data exposure inside a single-tenant-per-zone app.

### Fix

**File: `backend/src/controllers/analytics.controller.js`**

In `getHoChartData`, scope the ledger fetch the same way `filteredFundReqs` already is:

```js
// BEFORE
let filteredLedger = (ledgerRes.data || []).filter(l => isWithinDateRange(l.created_at));

// AFTER
let filteredLedger = (ledgerRes.data || []).filter(l => {
  const matchZo = !effectiveZone || (l.zo_user_id || '').toLowerCase().trim() === effectiveZone.toLowerCase().trim();
  return matchZo && isWithinDateRange(l.created_at);
});
```

In `getHoActionableInsights`, add explicit zone scoping mirroring the pattern already used in
`getProjectsHealth` / `getZoProductivity`:

```js
async function getHoActionableInsights(req, res) {
  try {
    if (req.user.role !== 'zo' && req.user.role !== 'ho' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Authorized executive and zonal roles only.' });
    }

    const isZo = req.user.role === 'zo';
    const callerZo = req.user.mobile_number;

    // 1. ZO balances — scoped for ZO callers
    let balQuery = supabase.from('zo_balances').select('zo_user_id, available_balance');
    if (isZo) balQuery = balQuery.eq('zo_user_id', callerZo);
    const { data: balances, error: balErr } = await balQuery;
    if (balErr) throw balErr;

    // 2. Requisition burns — scoped for ZO callers
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let burnQuery = supabase
      .from('requisitions')
      .select('zo_user_id, approved_amount')
      .eq('requisition_status', 'Approved')
      .gte('payment_date', thirtyDaysAgo);
    if (isZo) burnQuery = burnQuery.eq('zo_user_id', callerZo);
    const { data: burns, error: burnErr } = await burnQuery;
    if (burnErr) throw burnErr;

    // ... burnMap / runwayData construction unchanged ...

    // 5. Stalled projects — scoped via work_order_mappings/projects_master for ZO callers
    let stalledQuery = supabase
      .from('project_health_mv')
      .select('work_order_no, site_details, days_since_last_progress_report, physical_progress, zo_user_id')
      .lt('physical_progress', 100)
      .gt('days_since_last_progress_report', 7)
      .order('days_since_last_progress_report', { ascending: false });
    if (isZo) stalledQuery = stalledQuery.eq('zo_user_id', callerZo);
    const { data: stalled, error: stalledErr } = await stalledQuery;
    if (stalledErr) throw stalledErr;

    // 6. High-revision projects — scoped for ZO callers
    let estQuery = supabase.from('project_cost_estimates').select('work_order_no, work_order_no');
    if (isZo) {
      // project_cost_estimates has no zo_user_id column directly — join via projects_master
      const { data: myWos } = await supabase
        .from('projects_master')
        .select('work_order_no')
        .eq('zo_user_id', callerZo);
      const myWoSet = new Set((myWos || []).map(w => w.work_order_no));
      const { data: allEstimates, error: estErr } = await supabase
        .from('project_cost_estimates')
        .select('work_order_no');
      if (estErr) throw estErr;
      estimatesForRevision = (allEstimates || []).filter(e => myWoSet.has(e.work_order_no));
    } else {
      const { data: allEstimates, error: estErr } = await supabase
        .from('project_cost_estimates')
        .select('work_order_no');
      if (estErr) throw estErr;
      estimatesForRevision = allEstimates || [];
    }
    // ... revisionCount / highRevisionProjects built from estimatesForRevision ...

    return res.status(200).json({ success: true, runwayData, stalledProjects: stalled || [], highRevisionProjects });
  } catch (error) { /* unchanged */ }
}
```

> Note: `project_health_mv` already exposes `zo_user_id` (confirmed in migration 00), so the
> stalled-projects scoping is a one-line `.eq()`. The estimates query needs the WO-list join shown
> above since `project_cost_estimates` has no `zo_user_id` column.

### Files touched
- `backend/src/controllers/analytics.controller.js` (2 functions)

### Testing
- **Unit/integration:** add a test that logs in as ZO-A, calls `/analytics/ho/chart-data` and
  `/analytics/ho/actionable-insights`, and asserts the response contains **no** `zo_user_id`
  other than ZO-A's own in `runwayTrend`, `runwayData`, `stalledProjects`, or
  `highRevisionProjects` (need a WO-scoped filter, or filter by joining `projects_master`).
- **Manual QA:** seed 2 ZO test accounts with distinct ledger transactions and balances; log in as
  each and screenshot the Cash Runway chart — confirm each ZO only sees one line.
- **Regression:** confirm HO/admin still see all zones (both charts should show N lines for N
  zones when logged in as HO).

### Rollback plan
Pure application-layer filter change, no schema/data migration — revert the commit if needed.

---

## 2. P0 — `keyFinancialIndicators.notUtilized` ignores zone filter

### Root cause
```js
const totalNotUtilized = (zoBalRes.data || []).reduce((acc, b) => acc + Number(b.available_balance || 0), 0);
```
sums the **unfiltered** `zoBalRes.data`, while the sibling `totalZoBalAmt` a few lines later
correctly filters by `effectiveZone`. Since this endpoint is reachable by `zo` role, a ZO sees the
whole organization's unutilized balance labeled as their own KPI.

### Fix
Reuse the already-computed `filteredZoBalances` (currently defined *after* this line — move the
filter up, or duplicate the filter inline):

```js
// BEFORE (line ~1204, computed before filteredZoBalances exists)
const totalNotUtilized = (zoBalRes.data || []).reduce((acc, b) => acc + Number(b.available_balance || 0), 0);

// AFTER — compute filteredZoBalances once, before both usages, and reuse it
const filteredZoBalances = (zoBalRes.data || []).filter(b => {
  if (!effectiveZone) return true;
  return (b.zo_user_id || '').toLowerCase().trim() === effectiveZone.toLowerCase().trim();
});
const totalNotUtilized = filteredZoBalances.reduce((acc, b) => acc + Number(b.available_balance || 0), 0);
// ...
const totalZoBalAmt = sumOf(filteredZoBalances, 'available_balance'); // delete the duplicate filter block further down
```

### Files touched
- `backend/src/controllers/analytics.controller.js` (`getHoChartData`) — move `filteredZoBalances`
  declaration up above `totalNotUtilized`, delete the later duplicate declaration.

### Testing
- Assert `keyFinancialIndicators.notUtilized === executiveSummaryKpis.zoAvailableBalance` for a
  ZO-scoped request (they should now be the same value, since both are zone-filtered).
- For an HO request with no `zone` query param, both should equal the org-wide total (unchanged
  behavior for HO).

### Rollback plan
Single-variable refactor, trivially revertible.

---

## 3. P1 — `estimate_accuracy_mv.accuracy_status` mislabels unreviewed work orders

### Root cause
```sql
CASE
    WHEN (abs(
        CASE
            WHEN (oe.estimate_amount = 0) THEN 0
            ELSE (((COALESCE(fe.estimate_amount, fe.estimate_amount) - oe.estimate_amount) / oe.estimate_amount) * 100)
                                                     -- ^^ bug: coalescing fe with itself, not with oe
        END) <= 5) THEN 'Highly Accurate'
    ...
```
When `fe` (the "Final Approved" estimate row) doesn't exist yet, `fe.estimate_amount` is `NULL`,
so `COALESCE(NULL, NULL)` stays `NULL`, the whole expression is `NULL`, every `<=` comparison is
`NULL` (not true), and it falls through to `'High Variance'` — even though the correctly-computed
`variance_pct` column (a few lines above, using the correct `COALESCE(fe.estimate_amount,
oe.estimate_amount)`) is `0`.

### Fix
New migration that reuses the already-correct `variance_pct` expression instead of
re-deriving a second, buggy copy of it.

**File: `backend/src/db/migrations/004_fix_estimate_accuracy_status.sql`**

```sql
-- ===========================================================================
-- Migration 004: Fix estimate_accuracy_mv.accuracy_status NULL-coalesce bug
-- Root cause: accuracy_status recomputed variance using
--   COALESCE(fe.estimate_amount, fe.estimate_amount) instead of
--   COALESCE(fe.estimate_amount, oe.estimate_amount), producing NULL
--   (and therefore 'High Variance') for any WO without a Final Approved estimate.
-- ===========================================================================

DROP MATERIALIZED VIEW IF EXISTS public.estimate_accuracy_mv;

CREATE MATERIALIZED VIEW public.estimate_accuracy_mv AS
WITH original_estimates AS (
    SELECT DISTINCT ON (work_order_no) work_order_no, estimate_id, estimate_amount, estimate_no, created_at
    FROM public.project_cost_estimates
    WHERE estimate_revision = 0
    ORDER BY work_order_no, created_at
), final_estimates AS (
    SELECT DISTINCT ON (work_order_no) work_order_no, estimate_id, estimate_amount, estimate_revision
    FROM public.project_cost_estimates
    WHERE estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY work_order_no, estimate_revision DESC
)
SELECT
    oe.work_order_no,
    oe.estimate_no,
    oe.estimate_amount AS original_estimate_amount,
    COALESCE(fe.estimate_amount, oe.estimate_amount) AS final_approved_estimate_amount,
    (COALESCE(fe.estimate_amount, oe.estimate_amount) - oe.estimate_amount) AS variance_amount,
    CASE
        WHEN oe.estimate_amount = 0 THEN 0.00
        ELSE ((COALESCE(fe.estimate_amount, oe.estimate_amount) - oe.estimate_amount) / oe.estimate_amount) * 100.00
    END AS variance_pct,
    COALESCE(fe.estimate_revision, 0) AS number_of_revisions,
    -- FIX: derive accuracy_status from the SAME variance_pct expression above,
    -- instead of a second hand-rolled (and buggy) copy of it.
    CASE
        WHEN fe.work_order_no IS NULL THEN 'Highly Accurate'   -- no revision yet => 0% variance by definition
        WHEN ABS(
            CASE WHEN oe.estimate_amount = 0 THEN 0.00
                 ELSE ((fe.estimate_amount - oe.estimate_amount) / oe.estimate_amount) * 100.00
            END
        ) <= 5.00 THEN 'Highly Accurate'
        WHEN ABS(
            CASE WHEN oe.estimate_amount = 0 THEN 0.00
                 ELSE ((fe.estimate_amount - oe.estimate_amount) / oe.estimate_amount) * 100.00
            END
        ) <= 15.00 THEN 'Moderate Variance'
        ELSE 'High Variance'
    END AS accuracy_status,
    now() AS last_refreshed_at
FROM original_estimates oe
LEFT JOIN final_estimates fe ON oe.work_order_no = fe.work_order_no
WITH NO DATA;

ALTER MATERIALIZED VIEW public.estimate_accuracy_mv OWNER TO postgres;
CREATE UNIQUE INDEX idx_estimate_accuracy_mv_wo ON public.estimate_accuracy_mv (work_order_no);

GRANT SELECT ON public.estimate_accuracy_mv TO anon;
GRANT SELECT ON public.estimate_accuracy_mv TO authenticated;
GRANT SELECT ON public.estimate_accuracy_mv TO service_role;

REFRESH MATERIALIZED VIEW public.estimate_accuracy_mv;
```

> Design note: made this explicit — `fe.work_order_no IS NULL` (no Final Approved estimate exists
> yet) now reads as `'Highly Accurate'` rather than an undefined/misleading status, since a
> not-yet-finalized estimate hasn't varied from itself. If product prefers a distinct
> `'Pending Review'` status instead of folding it into `'Highly Accurate'`, that's a one-line
> change to the `CASE` — flag this to the HO analytics stakeholder before merging (see §6 on
> product sign-off for the general pattern).

### Files touched
- New file: `backend/src/db/migrations/004_fix_estimate_accuracy_status.sql`
- No application code changes — `getHoApprovalSla`/estimate-accuracy consumers just read the view.

### Testing
- After running the migration in a staging DB, query:
  ```sql
  SELECT work_order_no, variance_pct, accuracy_status
  FROM estimate_accuracy_mv
  WHERE variance_pct = 0 AND accuracy_status <> 'Highly Accurate';
  ```
  should return **zero rows** (previously would return every not-yet-finalized WO).
- Spot check 2–3 WOs that *do* have a Final Approved estimate with known variance to confirm
  `accuracy_status` still matches `variance_pct` as before (no regression for the reviewed case).

### Rollback plan
Migration file can be reverted by re-running the original view definition from
`00_full_schema_dump.sql`. Since it's `WITH NO DATA` + explicit `REFRESH`, there's no data-loss
risk — it's a pure view redefinition.

---

## 4. P1 — Fund Flow Waterfall: forecast stage corrupts downstream delta

### Root cause
`Estimated Bill Forecast` was inserted between `Gross Billed` and `Agency Paid` in the
`waterfallData` array (both backend `getHoChartData` and the frontend's client-side fallback
builder). The frontend computes each stage's connector label as
`diff = rows[i-1].amount - rows[i].amount`, which assumes strictly sequential, same-scale pipeline
stages. Because the forecast is a projection (not part of the actual committed-funds chain), its
insertion:
1. Breaks the funnel's visual narrowing (forecast width is unrelated to the stage above it).
2. Silently changes the meaning of `Agency Paid`'s connector: it now reads
   `Estimated Bill Forecast − Agency Paid` (labeled *"Pending Settlement"*) instead of the
   intended `Gross Billed − Agency Paid`.

### Fix
Move the forecast stage **out of the sequential chain** — render it as a separate reference
marker/annotation rather than a funnel row, so it can't participate in delta math between real
stages.

**File: `backend/src/controllers/analytics.controller.js`** — stop interleaving it in the array;
return it as a sibling field instead:

```js
// BEFORE
const waterfallData = [
  { stage: 'Final Approved Estimate', amount: sumOf(finalEstimates, 'estimate_amount') },
  { stage: 'HO Allocated (Gross)',    amount: grossHoAllocated },
  { stage: 'Excess Returned to HO',   amount: totalExcessReturned, isRefund: true },
  { stage: 'HO Allocated (Net)',      amount: netHoAllocated },
  { stage: 'Requisitions Approved',   amount: sumOf(approvedReqs,   'approved_amount') },
  { stage: 'Gross Billed',            amount: sumOf(filteredBills,  'gross_bill') },
  { stage: 'Estimated Bill Forecast', amount: sumOf(filteredEstimatedBills, 'estimated_bill_amount'), isForecast: true },
  { stage: 'Agency Paid',             amount: sumOf(filteredBills,  'agency_payment') }
];

// AFTER
const waterfallData = [
  { stage: 'Final Approved Estimate', amount: sumOf(finalEstimates, 'estimate_amount') },
  { stage: 'HO Allocated (Gross)',    amount: grossHoAllocated },
  { stage: 'Excess Returned to HO',   amount: totalExcessReturned, isRefund: true },
  { stage: 'HO Allocated (Net)',      amount: netHoAllocated },
  { stage: 'Requisitions Approved',   amount: sumOf(approvedReqs,   'approved_amount') },
  { stage: 'Gross Billed',            amount: sumOf(filteredBills,  'gross_bill') },
  { stage: 'Agency Paid',             amount: sumOf(filteredBills,  'agency_payment') }
];
const estimatedBillForecast = {
  amount: sumOf(filteredEstimatedBills, 'estimated_bill_amount'),
  varianceVsGrossBilled: sumOf(filteredEstimatedBills, 'estimated_bill_amount') - sumOf(filteredBills, 'gross_bill')
};
```
Add `estimatedBillForecast` to the JSON response object (both success and error-fallback payloads).

**File: `frontend/src/components/analytics/charts/FundFlowWaterfallChart.jsx`** — accept it as a
separate prop and render as a dashed horizontal reference line overlaid on the funnel (near the
"Gross Billed" / "Agency Paid" rows) with its own label, rather than as a `rows[]` entry:

```jsx
export const FundFlowWaterfallChart = ({ data = [], estimatedBillForecast = null, projects = [], isModal = false }) => {
  // ...rows[] no longer contains the forecast stage — delta math is now correct end-to-end...

  // New: render forecast as an annotation, not a funnel bar
  {estimatedBillForecast && (
    <g>
      <line
        x1={PAD_LEFT} x2={W - PAD_RIGHT}
        y1={forecastRefY} y2={forecastRefY}
        stroke="#f59e0b" strokeDasharray="4 3" strokeWidth="1.5"
      />
      <text x={W - PAD_RIGHT} y={forecastRefY - 6} textAnchor="end" fill="#fbbf24" fontSize="8" fontWeight="bold">
        ★ Estimated Bill Forecast: {fmtCr(estimatedBillForecast.amount)}
        {' '}({estimatedBillForecast.varianceVsGrossBilled >= 0 ? '+' : ''}{fmtCr(estimatedBillForecast.varianceVsGrossBilled)} vs. Gross Billed)
      </text>
    </g>
  )}
  ```
Also update the client-side fallback builder (`rows` `useMemo` when `data` prop is empty) to match
— drop the `forecasted` row from the sequential array and compute it the same way as a sibling
value.

### Files touched
- `backend/src/controllers/analytics.controller.js` (`getHoChartData`, both success & catch paths)
- `frontend/src/components/analytics/charts/FundFlowWaterfallChart.jsx`
- `frontend/src/pages/HoDashboard.jsx` / `ZoDashboard.jsx` — pass the new
  `estimatedBillForecast={chartRes?.estimatedBillForecast}` prop at both call sites of
  `FundFlowWaterfallChart` (summary card + modal).

### Testing
- Unit test the waterfall delta math: with `Gross Billed = 100`, `Agency Paid = 80`, assert the
  `Agency Paid` connector diff = `20` (Gross Billed − Agency Paid) regardless of what
  `estimatedBillForecast.amount` is set to.
- Snapshot/visual test: forecast marker renders as a dashed line, not a bar, in both light and dark
  theme.
- Confirm `STAGE_METADATA_MAP` no longer needs the `'estimated bill forecast'` key inside the
  sequential-row lookup (can leave it for backward compat but it's now dead for the row path).

### Rollback plan
If the annotation-line rendering has visual issues under time pressure, a safe interim rollback is
to simply **remove** the forecast stage from `waterfallData` entirely (drop it from both backend
array and frontend `STAGE_METADATA_MAP` usage) until the annotation UI is ready — this restores
correct delta math immediately at the cost of temporarily not showing the forecast on this chart
(it remains visible elsewhere, e.g. the Estimated Bill module table itself).

---

## 5. P1 — `getHoChartData` swallows failures as HTTP 200

### Root cause
```js
} catch (error) {
  console.error('[ANALYTICS] Error in getHoChartData:', error.message || error);
  return res.status(200).json({ success: true, bubbleMatrix: [], waterfallData: [...], ... });
}
```
A genuine backend failure (DB timeout, bad query, Supabase outage) renders as "this organization
has zero projects and zero budget" on the dashboard, with no visible error state, retry affordance,
or distinction from a legitimately empty org.

### Fix
Return a real error status and let the frontend show a retry state instead of a fabricated empty
dashboard.

```js
// AFTER
} catch (error) {
  console.error('[ANALYTICS] Error in getHoChartData:', error.message || error);
  return res.status(500).json({
    success: false,
    message: 'Failed to load analytics chart data. Please try again.'
  });
}
```

**Frontend (`HoDashboard.jsx` / `ZoDashboard.jsx`)** — the React Query hook for `chartRes` needs an
explicit error UI branch instead of silently rendering empty charts:

```jsx
const { data: chartRes, isLoading: isChartLoading, isError: isChartError, refetch: refetchChart } =
  useQuery({ queryKey: [...], queryFn: fetchChartData });

// In render:
{isChartError && (
  <div className="col-span-full p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs font-bold flex items-center justify-between">
    <span>Couldn't load analytics data. This might be temporary.</span>
    <button onClick={() => refetchChart()} className="underline">Retry</button>
  </div>
)}
```

### Files touched
- `backend/src/controllers/analytics.controller.js` (`getHoChartData` catch block)
- `frontend/src/pages/HoDashboard.jsx`, `frontend/src/pages/ZoDashboard.jsx` (add error branch)
- `frontend/src/api/analyticsApi.js` — confirm the chart-data fetch function doesn't already
  swallow non-2xx as `[]`/`{}` on its own (check any `.catch(() => ({}))` pattern and remove it if
  present, or this fix won't surface through to the UI).

### Testing
- Force a DB error in staging (e.g., temporarily rename a column) and confirm the dashboard shows
  the retry banner instead of a blank-but-successful-looking state.
- Confirm normal operation (real empty org, e.g., a fresh HO account with 0 projects) still renders
  the existing "no data" empty states correctly — this fix should only change the *error* path, not
  the legitimate-empty-state path.

### Rollback plan
Trivial revert — status-code and error-branch changes only, no data/schema impact.

---

## 6. P2 — S-Curve chart: synthetic curve presented as historical trend

### Why this is P2, not P1
This isn't a "wrong number" bug like the others — the chart is internally consistent, just not
built from the granular history the backend already computes. Fixing it well requires a product
decision on tradeoffs (see options below), so it shouldn't block the P0/P1 fixes above.

### Root cause recap
Backend correctly assembles `sCurveData[].actuals` = `[{date, progress}, ...]` per work order.
Frontend only extracts month labels from these dates, then re-synthesizes the "Actual" line as
`avgProgress × (monthIndex/6)^1.2`, discarding the real per-report progress values. The "Planned"
line is a hardcoded generic sigmoid, not derived from each project's actual
`project_start_date`/`project_end_date`.

### Recommended fix (needs product sign-off before implementation)
**Option A — plot real history (preferred):** use `sCurveData[].actuals` directly as the "Actual"
line's data points (bucket by month, take the latest reported progress within each month), instead
of interpolating from today's average. For projects/timeframes with sparse DPR submissions (fewer
than ~3 data points), fall back to the existing synthetic line **but visually flag it** (e.g. dotted
line + "Insufficient reporting history — projected trend shown" label) so viewers aren't misled
into thinking sparse-data projects have a smooth real trend.

**Option B — derive the Planned line from real dates:** replace the hardcoded
`[2,12,35,65,88,98]` array with a per-project sigmoid computed from
`project_start_date`/`project_end_date`, so the planned target line actually reflects that
project's contracted duration rather than a generic 6-month window.

**Minimum viable fix if scope needs to shrink:** ship Option A's flagging behavior only — i.e.,
keep the current synthetic "Actual" computation for now, but add the "Projected trend — limited
reporting history" badge whenever `activeData` has fewer than 3 real DPR data points, since
mislabeling synthetic-as-actual is the core UX honesty problem, not the smoothing itself.

### Files touched (once approved)
- `frontend/src/components/analytics/charts/SCurveProgressChart.jsx` (`useMemo` computing
  `months/planned/actual`)
- Possibly `backend/src/controllers/analytics.controller.js` if Option B needs
  `project_start_date`/`project_end_date` added to the `sCurveData` payload (currently not
  included — check `dprByWO`/`allProjects` construction around line 928–950).

### Testing
- For a WO with ≥3 real DPR entries spread across different months, confirm the "Actual" line now
  shows the real reported progress values at each month, not a smooth interpolation.
- For a WO with 0–2 DPR entries, confirm the fallback/flagged state renders and is visually
  distinguishable (not presented as confidently as real data).

### Action needed before implementation
Schedule a 15-minute review with the HO analytics stakeholder to pick Option A, B, both, or the
minimum-viable flagging-only fix — this is a UX/trust call, not a pure engineering one.

---

## 7. Suggested PR breakdown

| PR | Contents | Reviewer focus |
|----|----------|----------------|
| **PR-1 (hotfix)** | §1 + §2 (zone-scoping leak, notUtilized bug) | Security review — verify no other `zoBalRes`/`ledgerRes`-style unfiltered query exists elsewhere in the file |
| **PR-2** | §5 (error handling) | Confirm frontend error branch renders correctly; check `analyticsApi.js` doesn't already mask errors |
| **PR-3** | §3 (estimate_accuracy_mv migration) | DB review — confirm `REFRESH MATERIALIZED VIEW` (non-concurrent, since `WITH NO DATA` was just created) runs cleanly in staging before prod |
| **PR-4** | §4 (waterfall chart) | Design/product review of the new annotation-line treatment for the forecast marker |
| **PR-5** (after sign-off) | §6 (S-curve rework) | Product + design sign-off already captured; engineering review of real-vs-synthetic fallback logic |

### General rollout notes
- PR-1 and PR-2 have no schema changes and can go straight through normal CI → staging → prod.
- PR-3's migration should be run manually against staging first, with a spot-check query (given in
  §3) before promoting to prod; materialized view swaps are cheap but worth verifying since
  `estimate_accuracy_mv` feeds `getHoApprovalSla`-adjacent HO screens.
- After PR-3 ships, trigger `POST /analytics/refresh` (or wait for the 15-minute scheduler) so the
  HO dashboard picks up corrected `accuracy_status` values immediately rather than waiting for the
  next natural refresh cycle.
