# Executive Analytics Dashboard — "Hedgefund Vibe"
### Detailed Milestone Execution Plan | Codebase-Verified

---

## System Context

The SNPolymers ERP consists of:
- **Backend**: Node.js + Express + Supabase-JS client (`service_role`)
- **Frontend**: React 19 (Vite) + Tailwind CSS v3.4 + TanStack React Query v5
- **Database**: PostgreSQL (Supabase) + 8 existing materialized views in `36_analytics_dashboard_views.sql`

### What Already Exists (Do Not Rebuild)

| Layer | File | What's Already There |
|---|---|---|
| **DB** | `36_analytics_dashboard_views.sql` | 8 materialized views + 10 indexes + `refresh_analytics_views()` |
| **Backend** | `analytics.controller.js` | 10 handlers: `getHoKpis`, `getHoZoneBenchmarking`, `getHoBudgetLeakage`, `getProjectsHealth`, `getZoProductivity`, `getRecentActivity`, `getAuditLog`, `getProjectDigitalTwin`, `getHoResourceUtilization`, `triggerRefresh` |
| **Backend** | `analytics.routes.js` | All existing routes with `requireRole` guards |
| **Frontend** | `analyticsApi.js` | 11 API helper functions already exported |
| **Frontend** | `HoDashboard.jsx` | Existing KPI cards (4), Zonal Benchmarking table, Budget Leakage panel, Refresh button — **EXTEND, do NOT rebuild** |

### Schema Ground Truth — Verified Column Names

| Table | Key Columns Used in This Plan |
|---|---|
| `projects_master` | `work_order_no`, `work_order_value`, `earnest_money_deposit`, `zone`, `department`, `status`, `zo_user_id` |
| `project_cost_estimates` | `estimate_id`, `estimate_amount`, `estimate_revision`, `estimate_status` (enum: `'Final Approved'`, `'Submitted'`, `'Under ZO Review'`, `'Under HO Review'`) |
| `requisitions` | `requisition_id`, `material_main_head`, `approved_amount`, `requisition_status`, `payment_date`, `work_order_no` |
| `ra_final_bills` | `bill_id`, `work_order_no`, `gross_bill` (NOT `bill_amount_with_gst`), `agency_payment`, `security_deposit_amount`, `bill_date` |
| `fund_requests` | `fund_request_id`, `zo_fr_amount`, `approve_ho_amount`, `request_status` (enum: `'Pending'`, `'Approved'`, `'Hold'`, `'Cancelled'`), `approve_ho_date`, `zo_date`, `work_order_no` |
| `zo_balances` | `zo_user_id`, `available_balance` |
| `zo_fund_ledger` | `ledger_id`, `zo_user_id`, `transaction_type` (`'ALLOCATION'`, `'REQUISITION_APPROVAL'`, `'RETURN'`), `amount`, `work_order_no`, `created_at` |
| `daily_progress_reports` | `report_id`, `work_order_no`, `physical_work_progress`, `login_date` |
| `project_health_mv` | `work_order_no`, `physical_progress`, `health_score`, `health_status`, `approved_requisitions_amount`, `days_since_last_progress_report`, `zo_user_id` |
| `authorised_users` | `mobile_number`, `display_name`, `role`, `is_active` |

> [!IMPORTANT]
> `ra_final_bills` uses `gross_bill` — NOT `bill_amount_with_gst`. The column was renamed in a prior migration. Any query using `bill_amount_with_gst` will cause a 500 error.

> [!NOTE]
> `work_order_value` exists on `projects_master`. The plan's Section 10 note about it "not existing" was incorrect — it is a real column confirmed in migration 04.

---

## Architecture Decisions

### Chart Library
No external chart library. All 6 charts are implemented using **inline SVG + React hooks** (`useMemo` for coordinate calculations). This avoids adding heavyweight dependencies (Recharts, Chart.js, D3) and matches the existing codebase style.

### Data Fetching Strategy
Two new API endpoints deliver chart-ready payloads in a single round-trip each:
1. **`GET /analytics/ho/actionable-insights`** — runway data, stalled projects, high-revision projects.
2. **`GET /analytics/ho/chart-data`** — all 6 chart datasets (bubble matrix, waterfall, zonal heatmap, runway trend, S-curve, revision heatmap).

### Role Authorization
Both new endpoints are restricted to `requireRole(['ho', 'admin'])`. No change to existing ZO/JE routes.

### Zero-Division Safety Rules (Apply Everywhere)
- If `daily_burn = 0`, `runway_days = Infinity` → render as `"∞"` in UI.
- If `work_order_value = 0`, all percentage calculations fall back to `0`.
- Timeline queries default to the last 12 months unless a date range is explicitly passed.

---

## Milestone Overview

| Milestone | Description | Layer | Status |
|---|---|---|---|
| **M1** | New DB Index | Database | ❌ TODO |
| **M2** | `getHoActionableInsights` endpoint | Backend | ❌ TODO |
| **M3** | `getHoChartData` endpoint | Backend | ❌ TODO |
| **M4** | Route & API Client wiring | Backend + Frontend | ❌ TODO |
| **M5** | `HoDashboard.jsx` — View Toggle + Insights Strip | Frontend | ❌ TODO |
| **M6** | Chart 1: Bubble Risk Matrix SVG | Frontend | ❌ TODO |
| **M7** | Chart 2: Fund Flow Waterfall SVG | Frontend | ❌ TODO |
| **M8** | Chart 3: Zonal Performance Heatmap | Frontend | ❌ TODO |
| **M9** | Chart 4: Predictive Runway Lines SVG | Frontend | ❌ TODO |
| **M10** | Chart 5: S-Curve Progress SVG | Frontend | ❌ TODO |
| **M11** | Chart 6: Estimate Revision Heatmap SVG | Frontend | ❌ TODO |
| **M12** | Work Order Telemetry Table | Frontend | ❌ TODO |
| **M13** | Integration Tests | Testing | ❌ TODO |

---

---

## M1 — New Database Index
**Goal**: Add one missing index to speed up monthly burn rate calculations on the `requisitions` table.

### Files
- `[MODIFY]` `backend/src/db/migrations/37_executive_analytics_indexes.sql` *(new migration file)*

### Implementation Instructions

Create a new migration file. Do NOT modify migration 36:
```sql
-- Migration 37: Executive Analytics Performance Index
BEGIN;

-- Speeds up monthly burn rate calculation:
-- SELECT SUM(approved_amount) FROM requisitions WHERE payment_date >= NOW() - INTERVAL '30 days'
CREATE INDEX IF NOT EXISTS idx_requisitions_payment_date
    ON public.requisitions (payment_date);

COMMIT;
```

> [!NOTE]
> The plan originally listed `ra_final_bills(bill_date DESC)` index as needed, but `idx_ra_final_bills_bill_date` already exists in migration 23. Only the `requisitions.payment_date` index is new.

### Acceptance Criteria
- [ ] Migration 37 applies without error on a clean DB run.
- [ ] `EXPLAIN ANALYZE SELECT SUM(approved_amount) FROM requisitions WHERE payment_date >= NOW() - INTERVAL '30 days'` shows an **Index Scan** (not Seq Scan).
- [ ] Running migration 37 twice is idempotent (no error due to `IF NOT EXISTS`).

### Vitest Test Cases
**File**: `backend/tests/vitest/milestones/hoDashboardInsights.test.js` (new file)

```js
// Test M1.1 — Index Exists
test('M1.1: requisitions payment_date index is deployed', async () => {
  const { data, error } = await supabase.rpc('pg_indexes_exist', { idx: 'idx_requisitions_payment_date' });
  // Alternative: Query pg_indexes directly
  const { data: idxData, error: idxErr } = await supabase
    .from('pg_indexes')
    .select('indexname')
    .eq('indexname', 'idx_requisitions_payment_date')
    .maybeSingle();
  expect(idxErr).toBeNull();
  expect(idxData).not.toBeNull();
});
```

---

## M2 — `getHoActionableInsights` Backend Endpoint
**Goal**: Compute and return runway data per ZO, stalled project list, and high-revision project alerts in one response.

### Files
- `[MODIFY]` `backend/src/controllers/analytics.controller.js` — add `getHoActionableInsights` function before `module.exports`

### KPI Definitions (Exact SQL Logic)

**Zonal Runway Days**:
```sql
-- monthly_burn for a ZO: sum of approved requisitions in last 30 days
SELECT zo_user_id, SUM(approved_amount) AS monthly_burn
FROM requisitions
WHERE payment_date >= NOW() - INTERVAL '30 days'
  AND requisition_status = 'Approved'
GROUP BY zo_user_id

-- daily_burn = monthly_burn / 30
-- runway_days = available_balance / daily_burn
-- if daily_burn = 0 then runway_days = null (render as "∞" in UI)
```

**Stalled Projects**:
```sql
-- Projects with physical_progress < 100 and no DPR in the last 7 days
SELECT work_order_no, site_details, days_since_last_progress_report, physical_progress
FROM project_health_mv
WHERE physical_progress < 100
  AND days_since_last_progress_report > 7
ORDER BY days_since_last_progress_report DESC
```

**High-Revision Projects**:
```sql
-- Projects with more than 3 estimate revisions
SELECT work_order_no, COUNT(*) AS revision_count
FROM project_cost_estimates
GROUP BY work_order_no
HAVING COUNT(*) > 3
ORDER BY revision_count DESC
```

### Implementation — Full Function Code

Add the following function to `analytics.controller.js` before `module.exports`:

```js
/**
 * GET /api/v1/auth/analytics/ho/actionable-insights
 * Returns runway data, stalled projects, and high-revision alerts.
 * Restricted to HO and Admin roles.
 */
async function getHoActionableInsights(req, res) {
  try {
    // 1. Fetch all ZO balances
    const { data: balances, error: balErr } = await supabase
      .from('zo_balances')
      .select('zo_user_id, available_balance');
    if (balErr) throw balErr;

    // 2. Fetch last-30-day requisition burns per ZO
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: burns, error: burnErr } = await supabase
      .from('requisitions')
      .select('zo_user_id, approved_amount')
      .eq('requisition_status', 'Approved')
      .gte('payment_date', thirtyDaysAgo);
    if (burnErr) throw burnErr;

    // 3. Aggregate burn per ZO
    const burnMap = {};
    (burns || []).forEach(r => {
      burnMap[r.zo_user_id] = (burnMap[r.zo_user_id] || 0) + Number(r.approved_amount || 0);
    });

    // 4. Build runway data array
    const runwayData = (balances || []).map(b => {
      const monthlyBurn = burnMap[b.zo_user_id] || 0;
      const dailyBurn = monthlyBurn / 30;
      const runwayDays = dailyBurn > 0
        ? Math.floor(Number(b.available_balance) / dailyBurn)
        : null; // null = no burn, infinite runway
      return {
        zo_user_id: b.zo_user_id,
        available_balance: Number(b.available_balance),
        monthly_burn: monthlyBurn,
        daily_burn: parseFloat(dailyBurn.toFixed(2)),
        runway_days: runwayDays
      };
    });

    // 5. Stalled projects from materialized view
    const { data: stalled, error: stalledErr } = await supabase
      .from('project_health_mv')
      .select('work_order_no, site_details, days_since_last_progress_report, physical_progress')
      .lt('physical_progress', 100)
      .gt('days_since_last_progress_report', 7)
      .order('days_since_last_progress_report', { ascending: false });
    if (stalledErr) throw stalledErr;

    // 6. High-revision projects (>3 revisions)
    // Supabase does not support HAVING directly; fetch all and group in JS
    const { data: allEstimates, error: estErr } = await supabase
      .from('project_cost_estimates')
      .select('work_order_no');
    if (estErr) throw estErr;

    const revisionCount = {};
    (allEstimates || []).forEach(e => {
      revisionCount[e.work_order_no] = (revisionCount[e.work_order_no] || 0) + 1;
    });
    const highRevisionProjects = Object.entries(revisionCount)
      .filter(([, count]) => count > 3)
      .map(([work_order_no, revision_count]) => ({ work_order_no, revision_count }))
      .sort((a, b) => b.revision_count - a.revision_count);

    return res.status(200).json({
      success: true,
      runwayData,
      stalledProjects: stalled || [],
      highRevisionProjects
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoActionableInsights:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching actionable insights.' });
  }
}
```

Also **add to `module.exports`**:
```js
module.exports = {
  // ... all existing exports ...
  getHoActionableInsights,   // NEW
  getHoChartData             // NEW (added in M3)
};
```

### Acceptance Criteria
- [ ] `GET /analytics/ho/actionable-insights` as `ho` role returns HTTP 200 with `{ success, runwayData, stalledProjects, highRevisionProjects }`.
- [ ] `GET /analytics/ho/actionable-insights` as `je` or `zo` role returns HTTP 403.
- [ ] When a ZO has no approved requisitions in the last 30 days, `daily_burn = 0` and `runway_days = null`.
- [ ] Stalled projects list only includes projects with `physical_progress < 100` and `days_since_last_progress_report > 7`.
- [ ] High-revision projects list only includes work orders with more than 3 entries in `project_cost_estimates`.

### Vitest Test Cases
**File**: `backend/tests/vitest/milestones/hoDashboardInsights.test.js`

```js
// M2.1 — Runway data structure and zero-burn safety
test('M2.1: Runway data returns correct structure and handles zero-burn ZOs', async () => {
  const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
  const res = mockRes();
  await getHoActionableInsights(req, res);

  expect(res.statusCode).toBe(200);
  expect(res.jsonData.success).toBe(true);
  expect(Array.isArray(res.jsonData.runwayData)).toBe(true);

  // Verify shape of each runway record
  res.jsonData.runwayData.forEach(r => {
    expect(r).toHaveProperty('zo_user_id');
    expect(r).toHaveProperty('available_balance');
    expect(r).toHaveProperty('monthly_burn');
    expect(r).toHaveProperty('daily_burn');
    expect(r).toHaveProperty('runway_days'); // null or integer — both valid
  });

  // A ZO with no burns must have runway_days = null, not NaN or Infinity
  const zeroBurnZO = res.jsonData.runwayData.find(r => r.monthly_burn === 0);
  if (zeroBurnZO) {
    expect(zeroBurnZO.runway_days).toBeNull();
  }
});

// M2.2 — Stalled projects only include stale progress
test('M2.2: Stalled projects list is correctly filtered', async () => {
  const req = { user: { role: 'admin', mobile_number: adminMobile }, query: {} };
  const res = mockRes();
  await getHoActionableInsights(req, res);

  expect(Array.isArray(res.jsonData.stalledProjects)).toBe(true);
  res.jsonData.stalledProjects.forEach(p => {
    expect(Number(p.physical_progress)).toBeLessThan(100);
    expect(Number(p.days_since_last_progress_report)).toBeGreaterThan(7);
  });
});

// M2.3 — RBAC: JE and ZO roles are blocked
test('M2.3: RBAC blocks ZO and JE from actionable insights', async () => {
  const reqZO = { user: { role: 'zo', mobile_number: zoMobile }, query: {} };
  const resZO = mockRes();
  await getHoActionableInsights(reqZO, resZO);
  expect(resZO.statusCode).toBe(403);

  const reqJE = { user: { role: 'je', mobile_number: jeMobile }, query: {} };
  const resJE = mockRes();
  await getHoActionableInsights(reqJE, resJE);
  expect(resJE.statusCode).toBe(403);
});
```

---

## M3 — `getHoChartData` Backend Endpoint
**Goal**: Return all 6 chart datasets in a single request — bubble matrix, waterfall, zonal heatmap, runway trend, S-curve data, and revision heatmap.

### Files
- `[MODIFY]` `backend/src/controllers/analytics.controller.js` — add `getHoChartData` function

### Chart Data Specifications

#### bubbleMatrix (Chart 1 data)
Source: `project_health_mv`
```js
// Return all rows with the 4 fields needed for the scatter chart
const { data: bubbleMatrix } = await supabase
  .from('project_health_mv')
  .select('work_order_no, site_details, physical_progress, approved_requisitions_amount, work_order_value, days_since_last_progress_report, health_score, health_status, zo_user_id');
// Compute budget_utilization_pct in JS: (approved_requisitions_amount / work_order_value) * 100
// anomaly_score is approximated from health_status: Critical=4, Warning=2, Healthy=0
```

#### waterfallData (Chart 2 data)
Source: 4 separate `SUM` queries, combined in JS:
```js
// Stage 1: Final Approved Estimate total
const { data: estimates } = await supabase
  .from('project_cost_estimates')
  .select('estimate_amount')
  .eq('estimate_status', 'Final Approved');

// Stage 2: Total HO Approved Allocations
const { data: fundReqs } = await supabase
  .from('fund_requests')
  .select('approve_ho_amount')
  .eq('request_status', 'Approved');

// Stage 3: Total Approved Requisitions
const { data: reqs } = await supabase
  .from('requisitions')
  .select('approved_amount')
  .eq('requisition_status', 'Approved');

// Stage 4: Total Gross Billed + Agency Paid
const { data: bills } = await supabase
  .from('ra_final_bills')
  .select('gross_bill, agency_payment'); // gross_bill NOT bill_amount_with_gst
```

Build the waterfall array:
```js
const waterfallData = [
  { stage: 'Final Approved Estimate', amount: sumOf(estimates, 'estimate_amount') },
  { stage: 'HO Allocated',           amount: sumOf(fundReqs, 'approve_ho_amount') },
  { stage: 'Requisitions Approved',  amount: sumOf(reqs, 'approved_amount') },
  { stage: 'Gross Billed',           amount: sumOf(bills, 'gross_bill') },
  { stage: 'Agency Paid',            amount: sumOf(bills, 'agency_payment') }
];
```

#### zonalHeatmap (Chart 3 data)
Source: `zone_performance_mv` joined with runway data from M2 logic.

#### runwayTrend (Chart 4 data)
Source: `zo_fund_ledger` — cumulative balance history per ZO:
```js
const { data: ledger } = await supabase
  .from('zo_fund_ledger')
  .select('zo_user_id, transaction_type, amount, created_at')
  .gte('created_at', twelveMonthsAgo)
  .order('created_at', { ascending: true });
// Group by zo_user_id, accumulate running balance to build history[]
// Append projection: current balance decreasing at daily_burn per day for next 60 days
```

#### sCurveData (Chart 5 data)
Source: `daily_progress_reports` + `projects_master`:
```js
// Per WO (if work_order_no param provided) or top 10 most active WOs
const { data: dprHistory } = await supabase
  .from('daily_progress_reports')
  .select('work_order_no, physical_work_progress, login_date')
  .order('login_date', { ascending: true });
// Planned line: linear interpolation from 0% at project_start_date to 100% at project_end_date
```

#### revisionHeatmap (Chart 6 data)
Source: `project_cost_estimates`:
```js
// Group by work_order_no, month of created_at, count revisions
const { data: estimates } = await supabase
  .from('project_cost_estimates')
  .select('work_order_no, estimate_revision, estimate_status, created_at');
// Build: { work_order_no, month: 'YYYY-MM', revision_count, latest_status }
```

### Implementation — Function Skeleton

```js
/**
 * GET /api/v1/auth/analytics/ho/chart-data
 * Returns all 6 chart datasets in a single request.
 * Accepts: ?view=all|zo|wo, ?zone=, ?work_order_no=
 */
async function getHoChartData(req, res) {
  try {
    const { view = 'all', zone, work_order_no } = req.query;
    const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const sumOf = (arr, key) =>
      (arr || []).reduce((acc, r) => acc + Number(r[key] || 0), 0);

    // === Parallel fetch all chart sources ===
    const [healthRes, estimatesRes, fundReqsRes, reqsRes, billsRes, ledgerRes, dprRes, zoneRes] =
      await Promise.all([
        supabase.from('project_health_mv').select(
          'work_order_no, site_details, physical_progress, approved_requisitions_amount, work_order_value, days_since_last_progress_report, health_score, health_status, zo_user_id, zone'
        ),
        supabase.from('project_cost_estimates').select('work_order_no, estimate_amount, estimate_status, estimate_revision, created_at'),
        supabase.from('fund_requests').select('approve_ho_amount, request_status, work_order_no'),
        supabase.from('requisitions').select('approved_amount, requisition_status, work_order_no, zo_user_id, payment_date'),
        supabase.from('ra_final_bills').select('gross_bill, agency_payment, work_order_no'),
        supabase.from('zo_fund_ledger').select('zo_user_id, transaction_type, amount, created_at').gte('created_at', twelveMonthsAgo).order('created_at', { ascending: true }),
        supabase.from('daily_progress_reports').select('work_order_no, physical_work_progress, login_date').order('login_date', { ascending: true }),
        supabase.from('zone_performance_mv').select('*')
      ]);

    // Throw on first error
    for (const r of [healthRes, estimatesRes, fundReqsRes, reqsRes, billsRes, ledgerRes, dprRes, zoneRes]) {
      if (r.error) throw r.error;
    }

    // === Build bubbleMatrix ===
    let bubbleMatrix = (healthRes.data || []).map(p => ({
      work_order_no: p.work_order_no,
      site_details: p.site_details,
      zone: p.zone,
      physical_progress: Number(p.physical_progress || 0),
      budget_utilization_pct: p.work_order_value > 0
        ? parseFloat(((Number(p.approved_requisitions_amount) / Number(p.work_order_value)) * 100).toFixed(1))
        : 0,
      days_since_dpr: Number(p.days_since_last_progress_report || 0),
      health_score: Number(p.health_score || 0),
      health_status: p.health_status,
      anomaly_score: p.health_status === 'Critical' ? 4 : p.health_status === 'Warning' ? 2 : 0
    }));
    if (zone) bubbleMatrix = bubbleMatrix.filter(p => p.zone === zone);
    if (work_order_no) bubbleMatrix = bubbleMatrix.filter(p => p.work_order_no === work_order_no);

    // === Build waterfallData ===
    const finalEstimates = (estimatesRes.data || []).filter(e => e.estimate_status === 'Final Approved');
    const approvedFunds  = (fundReqsRes.data  || []).filter(f => f.request_status === 'Approved');
    const approvedReqs   = (reqsRes.data       || []).filter(r => r.requisition_status === 'Approved');
    const waterfallData = [
      { stage: 'Final Approved Estimate', amount: sumOf(finalEstimates, 'estimate_amount') },
      { stage: 'HO Allocated',           amount: sumOf(approvedFunds,  'approve_ho_amount') },
      { stage: 'Requisitions Approved',  amount: sumOf(approvedReqs,   'approved_amount') },
      { stage: 'Gross Billed',           amount: sumOf(billsRes.data,  'gross_bill') },
      { stage: 'Agency Paid',            amount: sumOf(billsRes.data,  'agency_payment') }
    ];

    // === Build zonalHeatmap ===
    const zonalHeatmap = (zoneRes.data || []).map(z => ({
      zone: z.zone,
      health_score: Number(z.average_health_score || 0),
      budget_util: Number(z.budget_utilization_pct || 0),
      total_projects: Number(z.total_projects || 0),
      delayed_projects: Number(z.delayed_projects || 0),
      projects_at_risk: Number(z.projects_at_risk || 0)
    }));

    // === Build revisionHeatmap ===
    const revisionMap = {};
    (estimatesRes.data || []).forEach(e => {
      const month = e.created_at ? e.created_at.slice(0, 7) : 'unknown';
      const key = `${e.work_order_no}__${month}`;
      if (!revisionMap[key]) revisionMap[key] = { work_order_no: e.work_order_no, month, revision_count: 0 };
      revisionMap[key].revision_count++;
    });
    const revisionHeatmap = Object.values(revisionMap);

    // === Build sCurveData ===
    const dprByWO = {};
    (dprRes.data || []).forEach(d => {
      if (!dprByWO[d.work_order_no]) dprByWO[d.work_order_no] = [];
      dprByWO[d.work_order_no].push({ date: d.login_date, progress: Number(d.physical_work_progress || 0) });
    });
    const sCurveData = Object.entries(dprByWO).map(([wo, actuals]) => ({
      work_order_no: wo,
      actuals
    }));

    // === Build runwayTrend ===
    const ledgerByZO = {};
    (ledgerRes.data || []).forEach(tx => {
      if (!ledgerByZO[tx.zo_user_id]) ledgerByZO[tx.zo_user_id] = [];
      ledgerByZO[tx.zo_user_id].push({
        date: tx.created_at.slice(0, 10),
        amount: tx.transaction_type === 'REQUISITION_APPROVAL'
          ? -Number(tx.amount) : Number(tx.amount)
      });
    });
    const runwayTrend = Object.entries(ledgerByZO).map(([zo_user_id, txs]) => {
      let running = 0;
      const history = txs.map(tx => {
        running += tx.amount;
        return { date: tx.date, balance: running };
      });
      return { zo_user_id, history };
    });

    return res.status(200).json({
      success: true,
      bubbleMatrix,
      waterfallData,
      zonalHeatmap,
      runwayTrend,
      sCurveData,
      revisionHeatmap
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoChartData:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching chart data.' });
  }
}
```

### Acceptance Criteria
- [ ] `GET /analytics/ho/chart-data` returns HTTP 200 with all 6 keys: `bubbleMatrix`, `waterfallData`, `zonalHeatmap`, `runwayTrend`, `sCurveData`, `revisionHeatmap`.
- [ ] `waterfallData` uses `gross_bill` column — no `bill_amount_with_gst` reference.
- [ ] Each `bubbleMatrix` item has `budget_utilization_pct` as a number (not NaN).
- [ ] `?zone=NorthBengal` filter narrows `bubbleMatrix` to that zone only.
- [ ] Empty datasets return empty arrays (`[]`), not `null`.

### Vitest Test Cases
**File**: `backend/tests/vitest/milestones/hoDashboardInsights.test.js`

```js
// M3.1 — All 6 chart keys present in response
test('M3.1: Chart data returns all 6 dataset keys', async () => {
  const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
  const res = mockRes();
  await getHoChartData(req, res);

  expect(res.statusCode).toBe(200);
  const keys = ['bubbleMatrix','waterfallData','zonalHeatmap','runwayTrend','sCurveData','revisionHeatmap'];
  keys.forEach(k => expect(res.jsonData).toHaveProperty(k));
  keys.forEach(k => expect(Array.isArray(res.jsonData[k])).toBe(true));
});

// M3.2 — Waterfall stages are in correct drop-down order
test('M3.2: Waterfall stages are correctly ordered and non-negative', async () => {
  const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
  const res = mockRes();
  await getHoChartData(req, res);

  const waterfall = res.jsonData.waterfallData;
  expect(waterfall).toHaveLength(5);
  expect(waterfall[0].stage).toBe('Final Approved Estimate');
  expect(waterfall[4].stage).toBe('Agency Paid');
  waterfall.forEach(w => expect(Number(w.amount)).toBeGreaterThanOrEqual(0));
});

// M3.3 — bubbleMatrix items have required fields and no NaN
test('M3.3: bubbleMatrix items have valid numeric fields', async () => {
  const req = { user: { role: 'admin', mobile_number: adminMobile }, query: {} };
  const res = mockRes();
  await getHoChartData(req, res);

  res.jsonData.bubbleMatrix.forEach(item => {
    expect(typeof item.work_order_no).toBe('string');
    expect(Number.isFinite(item.physical_progress)).toBe(true);
    expect(Number.isFinite(item.budget_utilization_pct)).toBe(true);
    expect(Number.isFinite(item.days_since_dpr)).toBe(true);
  });
});
```

---

## M4 — Route Registration & Frontend API Client Wiring
**Goal**: Register both new endpoints in `analytics.routes.js` and expose them as typed API helper functions in `analyticsApi.js`.

### Files
- `[MODIFY]` `backend/src/routes/analytics.routes.js`
- `[MODIFY]` `frontend/src/api/analyticsApi.js`

### Implementation Instructions

**`analytics.routes.js`** — Add 2 lines after the existing `hoRoles` routes block:
```js
const {
  // ... all existing imports ...
  getHoActionableInsights,  // ADD
  getHoChartData            // ADD
} = require('../controllers/analytics.controller');

// Add after existing /ho/budget-leakage route:
router.get('/ho/actionable-insights', requireRole(hoRoles), getHoActionableInsights);
router.get('/ho/chart-data',          requireRole(hoRoles), getHoChartData);
```

**`analyticsApi.js`** — Append 2 new exports at the bottom of the file:
```js
// ADD at the bottom of analyticsApi.js:
export const getHoActionableInsights = ()       => authApi.get('/analytics/ho/actionable-insights');
export const getHoChartData          = (params) => authApi.get('/analytics/ho/chart-data', { params });
```

### Acceptance Criteria
- [ ] `curl -X GET /api/v1/auth/analytics/ho/actionable-insights` with valid HO JWT returns 200.
- [ ] `curl -X GET /api/v1/auth/analytics/ho/chart-data` with valid HO JWT returns 200.
- [ ] `curl -X GET /api/v1/auth/analytics/ho/chart-data?view=zo` returns 200.
- [ ] Both routes return HTTP 403 when called with a `zo` or `je` JWT.

---

## M5 — `HoDashboard.jsx` — View Toggle + Actionable Insights Strip
**Goal**: Extend (not rebuild) the existing `HoDashboard.jsx`. Insert the View Toggle pill tabs below the header and add the horizontally-scrolling Actionable Insights alert strip below the existing KPI cards row.

### Files
- `[MODIFY]` `frontend/src/pages/HoDashboard.jsx`

### Implementation Instructions

**Step 1 — Add new state and query hooks** (add after existing `queryClient` and state declarations):
```jsx
const [activeView, setActiveView] = useState('all'); // 'all' | 'zo' | 'je' | 'wo'

const { data: insightsRes } = useQuery({
  queryKey: ['hoInsights'],
  queryFn: async () => {
    const res = await getHoActionableInsights();
    return res.data;
  }
});

const { data: chartRes } = useQuery({
  queryKey: ['hoChartData', activeView],
  queryFn: async () => {
    const res = await getHoChartData({ view: activeView });
    return res.data;
  }
});

const insights = insightsRes || {};
const stalledProjects = insights.stalledProjects || [];
const lowRunwayZones = (insights.runwayData || []).filter(z => z.runway_days !== null && z.runway_days < 21);
```

**Step 2 — Add View Toggle Bar** (insert directly after the `{/* Header Row */}` closing `</div>` at line 163):
```jsx
{/* View Toggle Pill Tabs */}
<div className="flex gap-2 mb-8 flex-wrap">
  {[
    { id: 'all', label: 'ALL — Portfolio' },
    { id: 'zo',  label: 'ZO Wise' },
    { id: 'je',  label: 'JE Wise' },
    { id: 'wo',  label: 'Work Order Wise' }
  ].map(tab => (
    <button
      key={tab.id}
      id={`view-toggle-${tab.id}`}
      onClick={() => setActiveView(tab.id)}
      className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-300 ${
        activeView === tab.id
          ? 'bg-amber-500 border-amber-500 text-black'
          : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'
      }`}
    >
      {tab.label}
    </button>
  ))}
</div>
```

**Step 3 — Add Actionable Insights Strip** (insert after the View Toggle, before the KPI cards):
```jsx
{/* Actionable Insights Strip */}
{(stalledProjects.length > 0 || lowRunwayZones.length > 0) && (
  <div className="mb-8 flex gap-3 overflow-x-auto no-scrollbar pb-2">
    {lowRunwayZones.map((z, idx) => (
      <div key={idx} className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-rose-500/30 bg-rose-950/20 text-rose-400 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
        <span className="animate-pulse">🔴</span>
        {z.zone || z.zo_user_id} — Balance depletes in {z.runway_days} days
      </div>
    ))}
    {stalledProjects.slice(0, 5).map((p, idx) => (
      <div
        key={idx}
        onClick={() => navigate(`/projects/${p.work_order_no}/digital-twin`)}
        className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-amber-500/30 bg-amber-950/20 text-amber-400 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer hover:border-amber-500/50 transition-colors"
      >
        <span>⚠️</span>
        {p.work_order_no} — No DPR for {p.days_since_last_progress_report}d ({p.physical_progress}% done)
      </div>
    ))}
  </div>
)}
```

### Acceptance Criteria
- [ ] All 4 toggle tabs render and clicking each updates `activeView` state.
- [ ] Insights strip does not render when `stalledProjects` and `lowRunwayZones` are both empty.
- [ ] Each stalled project alert in the strip is clickable and navigates to `/projects/:work_order_no/digital-twin`.
- [ ] Low-runway alerts only appear for zones with `runway_days < 21` and `runway_days !== null`.
- [ ] Toggle state persists across the page without causing page reload.

---

## M6 — Chart 1: Bubble Risk Matrix SVG
**Goal**: Render an SVG scatter/bubble chart with 4 quadrants where each bubble = one work order. X = budget utilization %, Y = physical progress %, bubble size = days without DPR.

### Files
- `[MODIFY]` `frontend/src/pages/HoDashboard.jsx` — add Chart 1 section after the Insights strip

### SVG Design Specs
- **Canvas**: 600×400px viewBox, responsive with `preserveAspectRatio`
- **Padding**: 60px on all sides to accommodate axis labels
- **Quadrant lines**: at X=50%, Y=50% — thin dashed white/10
- **Quadrant labels** (top-left, top-right, bottom-left, bottom-right): 9px uppercase text
- **Bubbles**: `r = 6 + (days_since_dpr / 5)` capped at `r = 20`
- **Bubble fill**: `health_status === 'Critical'` → `#f43f5e`, `'Warning'` → `#f59e0b`, `'Healthy'` → `#10b981`
- **Hover state**: Show tooltip with WO number, site details, all 4 metrics
- **Click**: `navigate(`/projects/${d.work_order_no}/digital-twin`)`

### Implementation Skeleton
```jsx
const BubbleRiskMatrix = ({ data }) => {
  const [tooltip, setTooltip] = useState(null);
  const navigate = useNavigate();
  const W = 600, H = 400, PAD = 60;

  const toX = (pct) => PAD + ((pct / 100) * (W - 2 * PAD));
  const toY = (pct) => (H - PAD) - ((pct / 100) * (H - 2 * PAD));

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Axis lines */}
        {/* Quadrant divider at 50% X */}
        <line x1={toX(50)} y1={PAD} x2={toX(50)} y2={H - PAD} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
        {/* Quadrant divider at 50% Y */}
        <line x1={PAD} y1={toY(50)} x2={W - PAD} y2={toY(50)} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
        {/* Quadrant labels */}
        <text x={PAD + 8} y={PAD + 16} className="text-[9px]" fill="rgba(255,255,255,0.2)" fontSize="9">Efficient</text>
        <text x={toX(75)} y={PAD + 16} fill="rgba(255,255,255,0.2)" fontSize="9">On Track</text>
        <text x={PAD + 8} y={H - PAD - 8} fill="rgba(255,255,255,0.2)" fontSize="9">Dormant</text>
        <text x={toX(62)} y={H - PAD - 8} fill="rgba(244,63,94,0.6)" fontSize="9" fontWeight="bold">CRITICAL</text>
        {/* Data bubbles */}
        {(data || []).map((d, i) => {
          const r = Math.min(20, 6 + d.days_since_dpr / 5);
          const fill = d.health_status === 'Critical' ? '#f43f5e' : d.health_status === 'Warning' ? '#f59e0b' : '#10b981';
          return (
            <circle
              key={i}
              cx={toX(d.budget_utilization_pct)}
              cy={toY(d.physical_progress)}
              r={r}
              fill={fill}
              fillOpacity={0.7}
              stroke={fill}
              strokeWidth={1}
              strokeOpacity={0.9}
              className="cursor-pointer transition-all duration-200 hover:fill-opacity-100"
              onMouseEnter={() => setTooltip(d)}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => navigate(`/projects/${d.work_order_no}/digital-twin`)}
            />
          );
        })}
        {/* X Axis label */}
        <text x={W / 2} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">Budget Utilization %</text>
        {/* Y Axis label */}
        <text x={14} y={H / 2} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9" transform={`rotate(-90, 14, ${H / 2})`}>Physical Progress %</text>
      </svg>
      {/* Tooltip */}
      {tooltip && (
        <div className="absolute top-4 left-4 glass-panel p-3 rounded-xl text-[10px] pointer-events-none z-50 max-w-[200px]">
          <p className="font-black text-slate-200 truncate">{tooltip.site_details}</p>
          <p className="text-slate-400 font-mono mt-0.5">{tooltip.work_order_no}</p>
          <p className="text-slate-400 mt-1">Budget: <span className="text-amber-400 font-bold">{tooltip.budget_utilization_pct?.toFixed(1)}%</span></p>
          <p className="text-slate-400">Progress: <span className="text-emerald-400 font-bold">{tooltip.physical_progress}%</span></p>
          <p className="text-slate-400">DPR Gap: <span className={tooltip.days_since_dpr > 7 ? 'text-rose-400 font-bold' : 'text-slate-300'}>{tooltip.days_since_dpr}d</span></p>
        </div>
      )}
    </div>
  );
};
```

### Acceptance Criteria
- [ ] Chart renders without crashing on empty data (`data = []`).
- [ ] Bubbles are color-coded: red for Critical, amber for Warning, green for Healthy.
- [ ] Bubble radius visually increases as `days_since_dpr` increases, capped at `r=20`.
- [ ] Hovering a bubble shows a tooltip with all 4 values.
- [ ] Clicking a bubble navigates to the correct Digital Twin URL.
- [ ] Chart is responsive and does not overflow its container.

---

## M7 — Chart 2: Fund Flow Waterfall SVG
**Goal**: Horizontal step-down bar chart showing 5 financial stages with amount drop-offs labeled.

### Files
- `[MODIFY]` `frontend/src/pages/HoDashboard.jsx`

### SVG Design Specs
- **Orientation**: Horizontal bars, sorted from largest (top) to smallest (bottom)
- **Bar height**: 36px with 12px gap
- **Bar color**: Emerald for positive flow stages, rose if the stage amount is lower than the previous
- **Label**: Show `formatINR(amount)` at the right end of each bar
- **Stage name**: Left side axis label
- **Drop-off segment**: A thin translucent connector showing the delta between consecutive stages

### Acceptance Criteria
- [ ] All 5 stages render in order: Final Approved Estimate → HO Allocated → Requisitions → Gross Billed → Agency Paid.
- [ ] Each bar width is proportional to its amount relative to the largest stage.
- [ ] Bar amounts use `formatINR()` formatting (same helper already in `HoDashboard.jsx`).
- [ ] If any stage has `amount = 0`, it renders a minimal 2px bar, not invisible.

---

## M8 — Chart 3: Zonal Performance Heatmap
**Goal**: Color-coded grid table where rows = zones, columns = 5 performance metrics, cells gradient from emerald (excellent) to crimson (critical).

### Files
- `[MODIFY]` `frontend/src/pages/HoDashboard.jsx`

### Grid Column Definitions

| Column | Source Field | Thresholds |
|---|---|---|
| Portfolio Health Score | `health_score` | ≥80 = emerald, ≥60 = amber, <60 = rose |
| Budget Utilization % | `budget_util` | ≤80 = emerald, ≤100 = amber, >100 = rose |
| Total Projects | `total_projects` | Informational only (no color coding) |
| Delayed Projects | `delayed_projects` | 0 = emerald, 1-2 = amber, 3+ = rose |
| Projects at Risk | `projects_at_risk` | 0 = emerald, 1 = amber, 2+ = rose |

### Click Interaction
Clicking a row emits a `setActiveZoneFilter(zone)` state update that filters the WO Telemetry Table (M12).

### Acceptance Criteria
- [ ] Each cell has a background color derived from the metric's threshold band.
- [ ] Clicking a zone row updates the WO Telemetry Table's zone filter.
- [ ] Empty zone list shows a `No zone data available` placeholder.

---

## M9 — Chart 4: Predictive Runway Lines SVG
**Goal**: Multi-line SVG chart showing historical ZO balance trend with dashed projected depletion lines.

### Files
- `[MODIFY]` `frontend/src/pages/HoDashboard.jsx`

### SVG Design Specs
- **X-Axis**: Last 60 days historical + next 60 days projected (120-day window)
- **Y-Axis**: INR balance (0 to max balance across all ZOs)
- **Solid line**: Historical balance from `runwayTrend[i].history`
- **Dashed line**: Projection decreasing at `daily_burn` per day
- **Red dot**: Projected zero-balance date if within 60 days
- **Legend**: Each ZO color-coded with a 10px circle + zone name

### Acceptance Criteria
- [ ] Solid lines end at today's date.
- [ ] Dashed projection lines start at today's balance and trend downward.
- [ ] A ZO with `runway_days = null` (no burn) shows a flat dashed line, not a declining one.
- [ ] Zero-balance date marker only appears if `runway_days < 60`.

---

## M10 — Chart 5: S-Curve Progress SVG
**Goal**: Dual-area chart showing planned vs. actual physical progress % over time per project or portfolio average.

### Files
- `[MODIFY]` `frontend/src/pages/HoDashboard.jsx`

### SVG Design Specs
- **X-Axis**: Timeline from `project_start_date` to today
- **Y-Axis**: Physical progress % (0 to 100)
- **Line 1 (Planned — dashed)**: Linear from 0% at `project_start_date` to 100% at `project_end_date`
- **Line 2 (Actual — solid)**: Chronological `physical_work_progress` values from `sCurveData`
- **Gap Fill**: Area between the two lines — emerald if actual > planned, amber if behind
- **WO Selector**: If `activeView === 'wo'`, a small dropdown allows selecting which WO to display

### Acceptance Criteria
- [ ] Planned line is always a straight diagonal from 0 to 100%.
- [ ] Actual line follows the DPR history data points.
- [ ] The gap fill switches color correctly based on actual vs. planned comparison.
- [ ] In portfolio `all` view, renders average progress across all active projects.

---

## M11 — Chart 6: Estimate Revision Heatmap
**Goal**: Gantt-style timeline showing estimate revision activity per work order per calendar month, flagging high-churn projects.

### Files
- `[MODIFY]` `frontend/src/pages/HoDashboard.jsx`

### Grid Design
- **X-Axis**: Calendar months (last 12 months)
- **Y-Axis**: Work Order numbers
- **Cell color**: Revision count — 0 = transparent, 1 = amber/10%, 2 = amber/30%, 3+ = rose/60%
- **Hover tooltip**: Shows `revision_count` for that WO + month
- **Alert flag**: WOs with total revisions > 3 get a `HIGH CHURN` badge on the Y-axis label

### Acceptance Criteria
- [ ] Grid renders all 12 months as columns.
- [ ] Cells with 0 revisions are transparent (no color), not empty white boxes.
- [ ] WOs with total revisions > 3 display a visual badge on their row label.
- [ ] Hovering a cell shows the revision count for that month.

---

## M12 — Work Order Telemetry Table
**Goal**: High-density paginated, sortable, searchable, filterable data grid showing 13 columns of project-level financial and operational telemetry.

### Files
- `[MODIFY]` `frontend/src/pages/HoDashboard.jsx` — add as the final section in the main content area

### Data Source
Uses `project_health_mv` joined with data from `getHoChartData().bubbleMatrix`. Supplemented by a direct `getProjectsHealth()` call which already exists in `analyticsApi.js`.

### Column Definitions

| # | Column | Source | Notes |
|---|---|---|---|
| 1 | Work Order No | `project_health_mv.work_order_no` | Clickable link → Digital Twin |
| 2 | Zone & Dept | `project_health_mv.zone` + `projects_master.department` | |
| 3 | EMD Amount | `projects_master.earnest_money_deposit` | `formatINR()` |
| 4 | Baseline Budget (WO Value) | `project_health_mv.work_order_value` | `formatINR()` |
| 5 | Approved Estimate Amount | `project_health_mv.approved_estimate_amount` | `formatINR()` |
| 6 | Approved Requisitions (Spent) | `project_health_mv.approved_requisitions_amount` | `formatINR()` |
| 7 | Physical Progress % | `project_health_mv.physical_progress` | Progress pill |
| 8 | Days Since Last DPR | `project_health_mv.days_since_last_progress_report` | Color-coded: >7d = amber, >14d = rose |
| 9 | Pending Approvals | `project_health_mv.pending_approvals_count` | Badge |
| 10 | Material Variance % | `project_health_mv.material_variance_pct` | Color-coded |
| 11 | Health Score | `project_health_mv.health_score` | SVG mini-gauge or badge |
| 12 | Health Status | `project_health_mv.health_status` | Color badge: Healthy/Warning/Critical |
| 13 | Anomaly Score | Derived from `health_status` | 0–8 range |

### Features
- **Global Search**: Text input filters `work_order_no` and `site_details` client-side.
- **Zone Filter**: Dropdown populated from unique zones in data. Links to Chart 3 zone click.
- **Department Filter**: Dropdown populated from unique departments.
- **Sort**: Click column headers to toggle ascending/descending sort.
- **Pagination**: 20 rows per page with Prev/Next buttons.
- **Export**: Button calls `exportProjectsToExcel()` (already exists in `exportHelpers.js`).

### Acceptance Criteria
- [ ] All 13 columns render with correct data.
- [ ] Text search correctly filters by `work_order_no` substring.
- [ ] Zone filter dropdown is populated from actual data (not hardcoded).
- [ ] Sorting by Health Score orders rows from lowest to highest (and toggled).
- [ ] Pagination shows `Page X of Y (Z total records)`.
- [ ] Export button downloads an `.xlsx` file using the existing `exportProjectsToExcel()` helper.
- [ ] Clicking a Work Order No cell navigates to `/projects/:work_order_no/digital-twin`.

---

## M13 — Integration Tests
**Goal**: Write Vitest tests verifying the two new backend endpoints aggregate data correctly and enforce role isolation.

### Files
- `[NEW]` `backend/tests/vitest/milestones/hoDashboardInsights.test.js`

### Full Test Suite

```js
import { describe, beforeAll, afterAll, test, expect } from 'vitest';
import { supabase } from '../../../src/db/supabase';
import {
  getHoActionableInsights,
  getHoChartData
} from '../../../src/controllers/analytics.controller';

// Shared test state
let workOrderNo, hoMobile, zoMobile, jeMobile, adminMobile;
const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.jsonData = data; return res; };
  return res;
};

describe('HO Executive Analytics — Actionable Insights & Chart Data', () => {
  beforeAll(async () => {
    // Read existing test user mobiles from env or test fixtures
    hoMobile    = process.env.TEST_HO_MOBILE;
    zoMobile    = process.env.TEST_ZO_MOBILE;
    jeMobile    = process.env.TEST_JE_MOBILE;
    adminMobile = process.env.TEST_ADMIN_MOBILE;

    // Retrieve any real work order for chart data assertions
    const { data } = await supabase.from('projects_master').select('work_order_no').limit(1).maybeSingle();
    workOrderNo = data?.work_order_no;
  });

  // ── M2 Tests ──────────────────────────────────────────────────────────────

  test('M2.1: Runway data returns correct structure and handles zero-burn ZOs', async () => {
    const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
    const res = mockRes();
    await getHoActionableInsights(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(Array.isArray(res.jsonData.runwayData)).toBe(true);
    expect(Array.isArray(res.jsonData.stalledProjects)).toBe(true);
    expect(Array.isArray(res.jsonData.highRevisionProjects)).toBe(true);

    res.jsonData.runwayData.forEach(r => {
      expect(r).toHaveProperty('zo_user_id');
      expect(r).toHaveProperty('available_balance');
      expect(r).toHaveProperty('monthly_burn');
      expect(r).toHaveProperty('daily_burn');
      expect(r).toHaveProperty('runway_days'); // null or integer — both valid
    });

    const zeroBurnZO = res.jsonData.runwayData.find(r => r.monthly_burn === 0);
    if (zeroBurnZO) {
      expect(zeroBurnZO.runway_days).toBeNull();
    }
  });

  test('M2.2: Stalled projects only contain projects with progress < 100% and DPR gap > 7 days', async () => {
    const req = { user: { role: 'admin', mobile_number: adminMobile }, query: {} };
    const res = mockRes();
    await getHoActionableInsights(req, res);

    expect(res.statusCode).toBe(200);
    res.jsonData.stalledProjects.forEach(p => {
      expect(Number(p.physical_progress)).toBeLessThan(100);
      expect(Number(p.days_since_last_progress_report)).toBeGreaterThan(7);
    });
  });

  test('M2.3: RBAC — ZO and JE roles receive HTTP 403 on actionable-insights', async () => {
    const roles = [
      { role: 'zo', mobile_number: zoMobile },
      { role: 'je', mobile_number: jeMobile }
    ];
    for (const user of roles) {
      const req = { user, query: {} };
      const res = mockRes();
      await getHoActionableInsights(req, res);
      expect(res.statusCode).toBe(403);
    }
  });

  // ── M3 Tests ──────────────────────────────────────────────────────────────

  test('M3.1: Chart data returns all 6 dataset keys as arrays', async () => {
    const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    const keys = ['bubbleMatrix', 'waterfallData', 'zonalHeatmap', 'runwayTrend', 'sCurveData', 'revisionHeatmap'];
    keys.forEach(k => expect(Array.isArray(res.jsonData[k])).toBe(true));
  });

  test('M3.2: Waterfall stages are in correct order and amounts are non-negative numbers', async () => {
    const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    const wf = res.jsonData.waterfallData;
    expect(wf).toHaveLength(5);
    expect(wf[0].stage).toBe('Final Approved Estimate');
    expect(wf[1].stage).toBe('HO Allocated');
    expect(wf[2].stage).toBe('Requisitions Approved');
    expect(wf[3].stage).toBe('Gross Billed');
    expect(wf[4].stage).toBe('Agency Paid');
    wf.forEach(w => expect(Number(w.amount)).toBeGreaterThanOrEqual(0));
  });

  test('M3.3: bubbleMatrix items have finite numeric fields and no NaN values', async () => {
    const req = { user: { role: 'admin', mobile_number: adminMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    res.jsonData.bubbleMatrix.forEach(item => {
      expect(typeof item.work_order_no).toBe('string');
      expect(Number.isFinite(item.physical_progress)).toBe(true);
      expect(Number.isFinite(item.budget_utilization_pct)).toBe(true);
      expect(Number.isFinite(item.days_since_dpr)).toBe(true);
      expect(Number.isFinite(item.health_score)).toBe(true);
    });
  });

  test('M3.4: RBAC — ZO and JE roles receive HTTP 403 on chart-data', async () => {
    const roles = [
      { role: 'zo', mobile_number: zoMobile },
      { role: 'je', mobile_number: jeMobile }
    ];
    for (const user of roles) {
      const req = { user, query: {} };
      const res = mockRes();
      await getHoChartData(req, res);
      expect(res.statusCode).toBe(403);
    }
  });

  test('M3.5: Zone filter narrows bubbleMatrix to matching zone only', async () => {
    // Get a real zone from the data
    const { data: zoneData } = await supabase
      .from('project_health_mv').select('zone').limit(1).maybeSingle();
    if (!zoneData?.zone) return; // Skip if no data

    const req = { user: { role: 'admin', mobile_number: adminMobile }, query: { zone: zoneData.zone } };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    res.jsonData.bubbleMatrix.forEach(item => {
      expect(item.zone).toBe(zoneData.zone);
    });
  });
});
```

### Acceptance Criteria
- [ ] All 5 test cases in `hoDashboardInsights.test.js` pass.
- [ ] No existing tests in `milestone_p8_m1.test.js`, `milestone_p8_m2.test.js`, or `digitalTwin.test.js` regress.

---

## Final Implementation Order

Execute milestones in this exact sequence to avoid dependency issues:

```
M1  → DB index (run migration 37)
M2  → getHoActionableInsights controller function
M3  → getHoChartData controller function
M4  → Route registration + API client exports
M5  → HoDashboard: state, toggle tabs, insights strip
M6  → Chart 1: Bubble Risk Matrix
M7  → Chart 2: Fund Flow Waterfall
M8  → Chart 3: Zonal Heatmap
M9  → Chart 4: Runway Lines
M10 → Chart 5: S-Curve
M11 → Chart 6: Revision Heatmap
M12 → Work Order Telemetry Table
M13 → Write & run integration tests
```

## Verification Commands
```bash
# Run new integration tests
cd backend
npx vitest run tests/vitest/milestones/hoDashboardInsights.test.js

# Run all Phase 8 tests to check for regressions
npx vitest run tests/vitest/milestones/milestone_p8_m1.test.js \
              tests/vitest/milestones/milestone_p8_m2.test.js \
              tests/vitest/milestones/digitalTwin.test.js \
              tests/vitest/milestones/hoDashboardInsights.test.js
```
