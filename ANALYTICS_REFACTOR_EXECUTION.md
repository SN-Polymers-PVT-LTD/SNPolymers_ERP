# Analytics Dashboard Refactor — Senior Dev Execution Guide

> **Based on:** `executive_analytics_REFACTOR_plan.md`
> **Codebase verified:** 2026-07-30 — `HoDashboard.jsx` (3,208 lines) · `ZoDashboard.jsx` (2,823 lines)
> **Total duplicated surface:** ~4,100 lines across both files
> **Author note:** Every line number, prop signature, and divergence call-out in this doc was verified against the live source — not lifted from the plan blind.

---

## Pre-work — Read This First

Two things the refactor plan flags as "deferred" should actually ship **before you touch a single component file**, since they are isolated, high-value, and take under an hour combined:

### Pre-work A: Add `staleTime` to All Dashboard Queries

Currently every `useQuery` in both dashboards has `staleTime: 0` (TanStack default), meaning data is considered stale immediately on mount and will silently refetch on every window focus event — hammering the analytics views on the DB unnecessarily.

**HoDashboard.jsx** — queries missing `staleTime` (lines 2535, 2544, 2563, 2605, 2614, 2623):
```js
// All six useQuery() calls in HoDashboard should add:
staleTime: 5 * 60 * 1000,  // 5 minutes — analytics views don't change per-second
```

**ZoDashboard.jsx** — queries missing `staleTime` (lines 2241, 2246, 2260, 2268):
```js
staleTime: 5 * 60 * 1000,
// Note: zoBalancesList (line 2276) and eligibleZosList (line 2282) already have staleTime set — these are fine.
```

### Pre-work B: Confirm Server-Side ZO Scoping

`ZoDashboard.jsx` (line 2268–2271) calls `getProjectsHealth()` with no zone parameter. This fetches **all enterprise projects**, then filters client-side in a `useMemo`. Before the refactor, verify whether the backend endpoint at `/api/analytics/projects-health` supports a `?zone=` query param server-side. If it does, pass `zone: selectedZo || myZoId` to the query. This is a security review, not a refactor task, but it should be confirmed before shipping anything.

---

## Milestone 0 — Scaffolding

**Goal:** Create the folder structure. Zero imports change. Zero behavior change.

```
frontend/src/components/analytics/
├── ui/
│   ├── .gitkeep
├── charts/
│   ├── .gitkeep
└── utils/
    ├── .gitkeep
```

Add a `README.md` inside `components/analytics/` with this rule:

> **No barrel `index.js` in this directory.**
> `HoDashboard` and `ZoDashboard` are separately `React.lazy()`-loaded chunks (see `App.jsx` lines 39–40, 141, 147). A barrel re-export would merge those chunks. All imports must go to a concrete file path — e.g. `../components/analytics/ui/ChartModal`.

**Verification:** Nothing to verify. No code runs.

---

## Milestone 1 — Pure Formatters & Color Hook

**Goal:** Extract byte-identical utility code into shared files.

### Verified line-by-line diff:

| Item | HO line | ZO line | Diff result |
|---|---|---|---|
| `formatINR` | 18–25 | 20–24 | Whitespace only — identical logic |
| `fmtCr` | 27–32 | 25–30 | Identical |
| `useChartColors` | 35–63 | 33–53 | ZO is **missing `labelFaint` token** (present in HO line 44). Keep the full HO token set — see note below. |

#### Note on `labelFaint`
HO's `useChartColors` (line 44) defines `labelFaint: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)'`. ZO's version does not have this token. Grep both files for `labelFaint` usage before extracting — if it is only referenced internally in HO and never consumed in ZO, include it in the shared hook anyway (dead code in ZO is harmless; a missing token in HO is a runtime `undefined` read on a dark SVG text element).

### Create: `frontend/src/components/analytics/utils/formatters.js`
```js
// Shared currency formatters for HO and ZO analytics dashboards.
// Do NOT add INR-locale fallback here — both dashboards rely on Intl.NumberFormat('en-IN').

export const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

export const fmtCr = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹ ${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000)   return `₹ ${(v / 100000).toFixed(2)} L`;
  return `₹ ${v.toLocaleString('en-IN')}`;
};
```

### Create: `frontend/src/components/analytics/utils/chartColors.js`
```js
// Theme-aware SVG color token hook — shared across HO and ZO chart primitives.
// useTheme() is imported from the global ThemeContext; this file does not re-export it.
import { useTheme } from '../../ThemeContext';

export const useChartColors = () => {
  const { isDark } = useTheme();
  return {
    gridLine:         isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)',
    gridLineDash:     isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    axisLine:         isDark ? 'rgba(255,255,255,0.1)'  : 'rgba(0,0,0,0.15)',
    labelMuted:       isDark ? 'rgba(255,255,255,0.2)'  : 'rgba(0,0,0,0.35)',
    labelFaint:       isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',   // HO-only token; safe to carry over
    labelNormal:      isDark ? 'rgba(255,255,255,0.4)'  : 'rgba(0,0,0,0.55)',
    labelStrong:      isDark ? 'rgba(255,255,255,0.7)'  : 'rgba(0,0,0,0.8)',
    todayLine:        isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',
    todayText:        isDark ? 'rgba(255,255,255,0.4)'  : 'rgba(0,0,0,0.5)',
    quadrantNormal:   isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)',
    quadrantCritical: isDark ? 'rgba(239,68,68,0.4)'   : 'rgba(185,28,28,0.5)',
    cellBorder:       isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)',
    highChurnLabel:   isDark ? '#ef4444' : '#b91c1c',
    normalLabel:      isDark ? 'rgba(255,255,255,0.4)'  : 'rgba(0,0,0,0.55)',
    dropOffConnector: isDark ? 'rgba(239,68,68,0.25)'  : 'rgba(185,28,28,0.3)',
    isDark,
  };
};
```

### Update both dashboard files:
- Remove the local `formatINR`, `fmtCr`, and `useChartColors` definitions.
- Add at top of each file:
```js
import { formatINR, fmtCr } from '../components/analytics/utils/formatters';
import { useChartColors } from '../components/analytics/utils/chartColors';
```

**Verification:** Light + dark mode visual pass on both dashboards. All INR currency figures, axis label colors, and quadrant text must look pixel-identical to before. Run a quick browser console check for any `undefined` reads on chart color tokens.

---

## Milestone 2 — Pure UI Shell Components

**Goal:** Extract components with zero data-shape dependency.

### `ChartInfoTooltip`

| File | Line | Notes |
|---|---|---|
| `HoDashboard.jsx` | 1354–1430 | Secondary definition; exists at bottom of file |
| `ZoDashboard.jsx` | 63–139 | Primary definition; appears near top |

Both implementations are **byte-for-byte identical** in logic. The only difference is `ZoDashboard` uses the imported `useEffect` (already imported at line 1) while `HoDashboard` uses `React.useEffect` inline. Standardize on the imported form.

**Create:** `frontend/src/components/analytics/ui/ChartInfoTooltip.jsx`
- Copy from `ZoDashboard.jsx` lines 63–139 verbatim.
- Change `useEffect` import to come from `react` (already consistent in ZO version).
- The `ReactDOM.createPortal` already targets `document.body` — this is correct; keep it.

**Important:** `HoDashboard.jsx` defines `ChartInfoTooltip` at **line 1354**, far below its first usage (line 301 in `BubbleRiskMatrix`). This works in JS because function-scope hoisting covers arrow functions defined with `const` — wait, no: `const` arrow functions are **NOT** hoisted. Verify that `BubbleRiskMatrix` (line 288) doesn't actually call `ChartInfoTooltip` before line 1354 at runtime. It does — this means the component renders after the parent file finishes parsing, which works at runtime since both are in the same module scope. After extraction to a shared import, this ordering issue disappears entirely.

---

### `ChartModal`

| File | Line | Prop signature |
|---|---|---|
| `HoDashboard.jsx` | 66–144 | `({ title, description, formula, isDark, width, height, maxWidth, maxHeight, onClose, children })` |
| `ZoDashboard.jsx` | 270–340 | Identical signature |

Differences: `HoDashboard` uses `React.useEffect` (line 71); `ZoDashboard` uses `useEffect` from import (line 274). Standardize on import form.

**Create:** `frontend/src/components/analytics/ui/ChartModal.jsx`
- Copy from either file; prefer ZoDashboard version since it uses the cleaner import form.
- Keep the internal `isDark` fallback: `const dark = isDark !== undefined ? isDark : themeDark;`
- Keep the `document.body` portal target.

---

### `ZoomCard`

| File | Line | Notes |
|---|---|---|
| `HoDashboard.jsx` | 147–159 | Identical |
| `ZoDashboard.jsx` | 343–356 | Identical |

**Create:** `frontend/src/components/analytics/ui/ZoomCard.jsx` — direct copy, no changes needed.

**Verification (M2):** Open every zoomable chart panel on both `/analytics/ho` and `/analytics/zo`. Confirm:
1. Zoom button appears on hover.
2. Modal opens, content renders, background scroll locks.
3. Escape key closes.
4. Info tooltip portal renders without clipping near viewport edges (test bottom-right corner specifically — the position logic is viewport-aware).

---

## Milestone 3 — `KpiDetailsModal` (Prop Contract Reconciliation)

**Goal:** Single shared component from two divergent prop signatures.

### Verified signatures:

**HoDashboard.jsx (line 162):**
```js
const KpiDetailsModal = ({ title, colorClass, projects, onClose, navigate }) => {
  // `navigate` is passed in from the parent HoDashboard component
  // Column header: "Zone" (not "ZO Name")
```

**ZoDashboard.jsx (line 359):**
```js
const KpiDetailsModal = ({ title, colorClass, projects, getZoDisplayName, onClose }) => {
  const navigate = useNavigate(); // called internally
  // Column header: "ZO Name" with getZoDisplayName() applied to zo_name field
```

### Reconciliation decision:
Standardize on **ZO's pattern** — `useNavigate()` called internally, not prop-drilled. Make `getZoDisplayName` optional with a `null` default. When `null`, the "ZO Name" column falls back to rendering `p.zo_name || p.zo_user_id || p.zone || 'N/A'` directly.

### Unified signature:
```js
// frontend/src/components/analytics/ui/KpiDetailsModal.jsx
const KpiDetailsModal = ({ title, colorClass, projects, onClose, getZoDisplayName = null }) => {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  // ...
  const displayZo = (p) => getZoDisplayName
    ? getZoDisplayName(p.zo_name || p.zo_user_id || p.zone)
    : (p.zone || p.zo_name || p.zo_user_id || 'N/A');
```

**HoDashboard call site update:** Remove `navigate` prop from `<KpiDetailsModal>` renders.

**Verification:** Click through every KPI tile that opens a modal on both dashboards. Confirm the project count badge is correct, the WO number links navigate correctly, and the zone name column renders without `undefined`.

---

## Milestone 4 — `InvestmentRecoveryPlot` (Highest Single-Component Line-Count Win)

### Verified signatures:

**HoDashboard.jsx (line 879):**
```js
const InvestmentRecoveryPlot = ({ projects, agencyPaymentAmount = 0, isModal = false }) => {
  // metrics computed via React.useMemo (lines 887–975)
  // viewMode: 'summary' | 'work_order' toggle (lines 882, 1006–1021)
  // Data fields read: work_order_value, approved_requisitions_amount, gross_billed, agency_payment/agency_paid
```

**ZoDashboard.jsx (line 1136):**
```js
const InvestmentRecoveryPlot = ({ projects, agencyPaymentAmount = 0, isModal = false }) => {
  // Identical signature — safe starting point
```

### Verified divergences:
1. **ZO has an extra "Bill Recovery %" KPI card** not present in HO's `InvestmentRecoveryPlot`. This is a genuine ZO-specific metric.
2. **ZO has hardcoded dark-mode Tailwind classes** in the breakdown list rows (e.g. `bg-white/5`, `text-slate-300`, `text-amber-400` without `isDark` branching). **ZO's light mode is currently broken** in this section. The HO version correctly branches on `isDark`.
3. `metrics` `useMemo` uses `React.useMemo` in HO vs bare `useMemo` in ZO — standardize on bare import form.

### Action:
1. Base the shared component on HO's theme-aware version.
2. Add the ZO-only "Bill Recovery %" KPI card behind a prop: `showBillRecoveryKpi = false`.
3. Default `showBillRecoveryKpi` to `true` for ZO's call site, `false` for HO (or `true` for both — confirm with whoever manages this screen).
4. Replace all `React.useMemo` with bare `useMemo` throughout.

**Create:** `frontend/src/components/analytics/charts/InvestmentRecoveryPlot.jsx`

**Verification:** This touches financial numbers. For 3–5 representative projects in both dashboards, compare:
- "Total Investment %" value
- "Payment Disbursement %" value
- "Pending Recovery" vs "Surplus Realized" display
- Progress band distribution bars

Do this in both light and dark mode. The ZO light-mode fix will visibly change the UI (colors now respond to theme) — this is the expected and correct outcome.

---

## Milestone 5 — Chart Primitives with Divergent Geometry

**Rule: one PR per component. Do not batch.**

Ship each component, do a side-by-side visual check, merge, then start the next. This milestone has no automated safety net — that is a known risk.

---

### 5-A: `FundFlowWaterfall` (Lowest divergence — start here)

**HO (line 401):** `({ data })` — renders `data` array directly.

**ZO (line 843):** `({ data, projects })` — when `data` is empty, derives pipeline stages from raw `projects` fields via a `useMemo` fallback (lines 848–869).

**STAGE_METADATA_MAP** is identical in both files (HO line 390, ZO line 832).

**Canonical geometry:** Both use `W=800, H=400, PAD_LEFT=190, PAD_RIGHT=220, PAD_Y=35, barH=22, gap=20`. This is identical — no geometry conflict.

**Normalized data shape:**
```js
// Adapter type — both sides produce this before passing to the chart
// [{ stage: string, amount: number, isRefund?: boolean }]
```

**Create:** `frontend/src/components/analytics/charts/FundFlowWaterfallChart.jsx`
- Base on ZO's version (it has the `projects` fallback that HO lacks; adding the fallback to HO is an improvement, not a regression).
- Move `STAGE_METADATA_MAP` into this file.
- Props: `({ data = [], projects = [] })` — keep both, ZO-style.

---

### 5-B: `DepartmentWiseEstimate` (Data shape key difference)

**HO (line 1433):** `({ data })` — receives pre-aggregated array `[{ department, amount, percentage, color? }]` from `chartRes`.

**ZO (line 626):** `({ projects })` — receives raw project records and aggregates `department → amount` client-side via `useMemo`.

**SVG donut geometry:** Both use `viewBox="0 0 200 200"`, `outerRadius=85`, `innerRadius=55`. However:
- HO uses its own inline donut arc math (lines 1452–1499) with `React.useMemo`.
- ZO uses the standalone `buildDonutSlices` helper function (lines 460–490) with bare `useMemo`.

**Decision:** Use ZO's `buildDonutSlices` as the canonical implementation (cleaner, testable, reusable). Move it to `utils/donutGeometry.js`. Reconcile HO's inline arc math into the same function — they produce identical paths from the same inputs.

**Normalized prop:** `({ items })` where `items: [{ department, amount, count, percentage, color }]`
Each call site provides its own adapter to produce this shape.

**HO adapter** (in `HoDashboard.jsx`):
```js
// data from chartRes.departmentBreakdown is already pre-aggregated — pass directly
<DepartmentWiseEstimateChart items={chartRes.departmentBreakdown} />
```

**ZO adapter** (in `ZoDashboard.jsx`):
```js
const deptItems = useMemo(() => {
  const map = {}, countMap = {};
  (filteredProjects || []).forEach(p => {
    const d = p.department || 'General';
    map[d] = (map[d] || 0) + Number(p.work_order_value || 0);
    countMap[d] = (countMap[d] || 0) + 1;
  });
  const total = Object.values(map).reduce((a, v) => a + v, 0) || 1;
  return Object.entries(map).map(([dept, amount], i) => ({
    department: dept, amount, count: countMap[dept],
    percentage: +((amount / total) * 100).toFixed(1),
    color: DEFAULT_COLORS[i % DEFAULT_COLORS.length]
  }));
}, [filteredProjects]);
<DepartmentWiseEstimateChart items={deptItems} />
```

---

### 5-C: `ExecutiveKpiStrip` (Two different data contracts)

**HO (line 2104):** `({ data })` — receives a pre-computed KPI object from `chartRes.kpis`. Has an **inline `formatCr` helper** (lines 2107–2113) distinct from the top-level `fmtCr` — this is redundant after M1; delete the inline copy and use the shared import.

**ZO (line 1734):** `({ projects, summaryKpis })` — computes all KPI values client-side from raw project list, with `summaryKpis` as an override source if the API provides it.

**Key difference:** HO's `data` object is already shaped exactly as the KPI strip needs. ZO drives the strip from raw projects as a compute-heavy `useMemo`. The ZO approach has more flexibility but more client CPU cost.

**Normalized prop:** `({ kpis })` where `kpis: [{ id, title, description, formula, color, glow, value, subtext, titleColor? }]`

Each call site adapts its data source into this array before rendering the strip. The strip itself becomes a pure presentational component.

**HO adapter:** Map `data` fields into the `kpis` array format (mirroring lines 2115–2220 of the current HO strip).

**ZO adapter:** Keep the existing `useMemo` derivation (lines 1738–1763), but shape the output into the same `kpis` array format before passing.

---

### 5-D: `SCurveProgress` (Geometry constants differ)

**HO (line 748):** `({ data })` · `W=600, H=300, PAD=50` (single PAD constant)

**ZO (line 1025):** `({ projects, sCurveData = [] })` · `W=600, H=330, PAD_TOP=40, PAD_BOT=60, PAD_SIDE=50` (split PAD constants)

**ZO's split PAD is the correct approach** — it allows independent control of top/bottom whitespace for axis labels, and `H=330` gives more vertical resolution for the sigmoidal curve. Adopt ZO's geometry constants as canonical.

**Normalized prop:** `({ sCurveData = [], projects = [] })`
- `sCurveData`: array of `{ work_order_no, actuals: [{ date, progress }] }` — primary data source.
- `projects`: fallback for computing average progress when `sCurveData` is empty.

**HO adapter:** Pass `chartRes.sCurveData` as `sCurveData`, and `filteredProjects` as `projects`.

---

### 5-E: `BubbleRiskMatrix` (Most divergent — do second-to-last)

**HO (line 288):** `({ data })` · `W=600, H=400, PAD=60`
- `toX = (pct) => PAD + ((pct / 100) * (W - 2*PAD))` — percent-based, no clamp
- No fallback: requires pre-computed `data` array from API

**ZO (line 926):** `({ projects, bubbleMatrixData = [] })` · `W=600, H=380, PAD=58`
- `toX = (v) => PAD + (Math.min(v, 140) / 140 * (W - 2*PAD))` — value-clamped at 140
- Has fallback: derives bubbles from raw `projects` when `bubbleMatrixData` is empty (lines 944–958)

**Which geometry is canonical?** ZO's H=380 with PAD=58 provides less dead space at canvas borders with real data. However, HO's percent-based `toX/toY` is mathematically cleaner for budget-utilization-as-percent data. The two `toX` functions produce **different pixel positions for the same data point** — this is the highest-risk divergence in the entire refactor.

**Decision:** Adopt HO's percent-based coordinate math. Apply ZO's H/PAD constants (H=380, PAD=58). Adopt ZO's `projects` fallback so HO gains resilience.

**Tooltip optimization (from pre-work):** Instead of `onMouseMove => setTooltip(...)` triggering a React re-render on every pixel:
```js
const tooltipRef = useRef(null);
const svgRef = useRef(null);
// Update tooltip DOM position via ref, not setState, on mousemove.
// Only call setState on mouseenter/mouseleave to trigger show/hide.
```

**Normalized prop:** `({ bubbleMatrixData = [], projects = [] })`

---

### 5-F: `WorkOrderTelemetryTable` (Last — feature-level difference, not drift)

**HO (line 2286):** `({ data, selectedZone, onSelectZone })`
- Single zone filter: a string value representing the currently-selected zone
- No `PaginatedZoSelector` component — uses the `ZonalPerformanceHeatmap` row click to set zone

**ZO (line 1791):** `({ data, availableZos, selectedZo, onSelectZo, getZoDisplayName })`
- Multi-ZO filter via `PaginatedZoSelector` component (ZO-exclusive, line 142)
- `getZoDisplayName` for formatted zone name resolution
- Has department filter (`deptFilter` state, line 1794) and Excel export (`handleExport`, line 1827)

**This is a genuine feature difference, not geometry drift.** The table renders different columns, has different filter UI, and the Excel export exists only in ZO.

**Strategy:** Create a shared base with role-specific extension props:
```js
// frontend/src/components/analytics/charts/WorkOrderTelemetryTable.jsx
const WorkOrderTelemetryTable = ({
  data,
  // Common
  onRowNavigate,
  // HO-mode (simple zone string filter)
  selectedZone = null,
  onSelectZone = null,
  // ZO-mode (paginated ZO picker)
  availableZos = null,
  selectedZo = null,
  onSelectZo = null,
  getZoDisplayName = null,
  showDeptFilter = false,
  showExcelExport = false,
}) => { ... }
```

The `PaginatedZoSelector` (ZO-only, line 142 in `ZoDashboard.jsx`) stays inside the ZO-mode branch of the shared table. It is not reusable for HO since HO's zone selection comes from the heatmap row click, not a dropdown.

---

## Milestone 6 — Cleanup & Verification

### After all components extracted:

1. **Delete** local component definitions from both dashboard files. Run `wc -l` before and after:
   ```bash
   wc -l frontend/src/pages/HoDashboard.jsx frontend/src/pages/ZoDashboard.jsx
   ```
   Expected result: both files drop to ~600–800 lines each (from 3,208 and 2,823).

2. **Verify lazy chunk isolation** — open Network tab in Chrome DevTools, load `/analytics/ho` from a cold cache, check that ZO-specific chart code is **not** in the downloaded JS chunk. Then load `/analytics/zo` and verify HO-specific code is absent.

3. **Check `App.jsx` routes** (lines 141, 147) still resolve correctly after the file restructuring.

4. Update `docs/frontend.md` if it references the old monolithic structure.

---

## Component Extraction Checklist (Execution Order)

```
Pre-work A  [ ] staleTime on all useQuery calls in HoDashboard.jsx and ZoDashboard.jsx
Pre-work B  [ ] Confirm server-side ZO scoping on getProjectsHealth() endpoint

M0          [ ] Create components/analytics/ folder with ui/, charts/, utils/ subfolders
            [ ] Add README.md no-barrel rule

M1          [ ] Create formatters.js (formatINR, fmtCr)
            [ ] Create chartColors.js (useChartColors with full token set)
            [ ] Update HoDashboard.jsx imports, delete local copies
            [ ] Update ZoDashboard.jsx imports, delete local copies
            [ ] Visual pass: currency + chart colors in both themes on both dashboards

M2          [ ] Create ui/ChartInfoTooltip.jsx (from ZO version, lines 63–139)
            [ ] Create ui/ChartModal.jsx (from ZO version, lines 270–340)
            [ ] Create ui/ZoomCard.jsx (from either version, identical)
            [ ] Update HoDashboard.jsx: replace 3 local definitions with imports
            [ ] Update ZoDashboard.jsx: replace 3 local definitions with imports
            [ ] Test: all zoomable chart modals open/close correctly, tooltips no-clip

M3          [ ] Create ui/KpiDetailsModal.jsx (unified signature with getZoDisplayName=null)
            [ ] Update HoDashboard.jsx: remove navigate prop from call sites
            [ ] Update ZoDashboard.jsx: remove local definition, import shared
            [ ] Test: KPI drill-down modals on both dashboards, project navigation links

M4          [ ] Create utils/donutGeometry.js (move buildDonutSlices from ZO)
            [ ] Create charts/InvestmentRecoveryPlot.jsx
            [ ] Fix ZO light-mode hardcoded dark classes as part of extraction
            [ ] Add showBillRecoveryKpi prop (confirm default with screen owner)
            [ ] Test: financial KPI values in summary + work-order views, both themes

M5-A        [ ] Create charts/FundFlowWaterfallChart.jsx (ZO base + projects fallback)
            [ ] Move STAGE_METADATA_MAP into chart file
            [ ] Update both dashboards
            [ ] Test: waterfall renders, stage labels correct, connector lines visible

M5-B        [ ] Create charts/DepartmentWiseEstimateChart.jsx (normalized items prop)
            [ ] Add HO call-site adapter in HoDashboard.jsx
            [ ] Add ZO call-site adapter (useMemo) in ZoDashboard.jsx
            [ ] Test: donut slices, hover popovers, center total value

M5-C        [ ] Create charts/ExecutiveKpiStrip.jsx (normalized kpis prop)
            [ ] Add HO adapter mapping data → kpis array
            [ ] Add ZO adapter mapping project useMemo → kpis array
            [ ] Delete HO's inline formatCr (now covered by shared fmtCr)
            [ ] Test: all 10 KPI cards visible, subtext labels correct on both dashboards

M5-D        [ ] Create charts/SCurveChart.jsx (ZO geometry H=330/split PAD)
            [ ] Add adapters for sCurveData + projects props on both sides
            [ ] Test: planned vs actual polylines render, WO selector works

M5-E        [ ] Create charts/BubbleRiskMatrixChart.jsx (HO percent-based toX/toY, ZO H/PAD)
            [ ] Implement ref-based tooltip tracking (not setState on mousemove)
            [ ] Add projects fallback from ZO version
            [ ] Test: bubble positions, hover tooltip coordinates, quadrant labels

M5-F        [ ] Create charts/WorkOrderTelemetryTable.jsx (shared base, HO/ZO mode props)
            [ ] Retain PaginatedZoSelector inside ZO mode branch
            [ ] Test: search, sort, department filter (ZO), zone filter (HO), Excel export (ZO)

M6          [ ] wc -l both dashboard files — record before/after
            [ ] Network tab: confirm separate JS chunks for HO and ZO routes
            [ ] Delete any remaining local component stubs
            [ ] docs/frontend.md update
```

---

## Known Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Donut arc geometry mismatch after `buildDonutSlices` consolidation | Medium | Screenshot HO donut before M5-B, screenshot after, diff the slice angles manually |
| BubbleRiskMatrix bubble positions change when switching from ZO clamp to HO percent-based | High | Side-by-side render with same dataset before shipping M5-E |
| Lazy chunk bundle merge from accidental barrel import | Low (if README enforced) | Confirm with Network tab in M6 |
| ZO light-mode regressions from `InvestmentRecoveryPlot` theme fix | Low | Regression is actually fixing a bug — expected visual change; document in PR |
| `ChartInfoTooltip` ordering issue in HoDashboard disappears post-extraction | Resolved automatically | No action needed; import-based references fix module load order |

---

## Compliance Audit — `frontend_guidelines.md` & `design.md`

> Verified against `frontend/frontend_guidelines.md` and `frontend/design.md`.
> These are **mandatory project standards** — violations must be corrected as part of this refactor, not deferred.

---

### ❌ Violation 1 — Custom Pagination Rebuilds (Guidelines §3.2)

**Rule:** All paginated tables must use `<Pagination />` from `src/components/ui/`. Manual `Prev / Next` button pairs with inline `useState(page)` are **prohibited**.

**Where it exists in the current codebase:**

| Component | File | Lines | Pattern |
|---|---|---|---|
| `ZonalPerformanceHeatmap` | `HoDashboard.jsx` | 603–621 | Manual `<button>Prev</button>` / `<button>Next</button>` with local `page` state |
| `WorkOrderTelemetryTable` (HO) | `HoDashboard.jsx` | ~2370–2420 | Same manual pattern |
| `WorkOrderTelemetryTable` (ZO) | `ZoDashboard.jsx` | ~1815–1940 | Same manual pattern |
| `PaginatedZoSelector` dropdown | `ZoDashboard.jsx` | 240–262 | Manual page Prev/Next inside ZO selector dropdown |
| `InvestmentRecoveryPlot` WO table | `ZoDashboard.jsx` | ~1300–1380 | Manual page state + buttons |

**Correction during refactor:** When creating shared components in Milestone 4 and 5-F, replace all manual pagination blocks with:
```jsx
import { Pagination } from '../ui';  // from src/components/ui/index.js

<Pagination
  currentPage={page}
  totalPages={totalPages}
  onPageChange={setPage}
  showLabel={true}
  totalRecords={rows.length}
/>
```

> **Note:** `PaginatedZoSelector`'s internal dropdown pagination is a special case — it is embedded inside a floating dropdown popover, not a table. The shared `<Pagination />` component may not fit that context visually. Acceptable to keep manual Prev/Next **only inside** `PaginatedZoSelector`'s dropdown body, but document this exception in the component file.

---

### ❌ Violation 2 — Inline Custom Modal Backdropss (Guidelines §1.1)

**Rule:** Raw modal backdrop overlays (`fixed inset-0 z-[500] flex items-center justify-center ... backdrop-blur-md`) in page files must be replaced with the centralized `<Modal />` from `src/components/ui/Modal.jsx`.

**Where it exists:**

| Component | File | Issue |
|---|---|---|
| `KpiDetailsModal` | `HoDashboard.jsx` lines 162–286 | Hand-rolled `fixed inset-0` backdrop with manual Escape key listener |
| `KpiDetailsModal` | `ZoDashboard.jsx` lines 359–457 | Same |
| `ChartModal` (fullscreen) | Both files | Hand-rolled portal backdrop — this one has a **legitimate exception** (see below) |

**`KpiDetailsModal` correction during Milestone 3:**
Wrap the shared `KpiDetailsModal` using `<Modal />` from the ui library instead of a raw `fixed inset-0` div:
```jsx
import { Modal } from '../ui';

// The existing table body content becomes children of <Modal>
<Modal isOpen={true} onClose={onClose} title={title} size="xl">
  {/* existing project table content */}
</Modal>
```
The `<Modal />` component already handles: body scroll lock, Escape key listener, `ModalContext` dock suppression, and backdrop click-to-close. All of this is currently duplicated manually in both `KpiDetailsModal` implementations.

**`ChartModal` exception (valid):**
`ChartModal` targets `96vw × 92vh` with custom dynamic sizing not supportable by the `size="sm|md|lg|xl|2xl"` enum in `ui/Modal.jsx`. It also bypasses `ModalContext` intentionally (it's a chart zoom overlay, not a form modal). Keep `ChartModal` as a custom component in `analytics/ui/` — but add a comment explaining why it doesn't extend `<Modal />`.

---

### ❌ Violation 3 — Skeleton Loading Not Used (Guidelines §3.3)

**Rule:** Raw `animate-spin` spinners and bare `null` returns during loading states are prohibited. Use `<SkeletonTable />`, `<SkeletonCard />`, or `<SkeletonPage />`.

**Current state:** Both `HoDashboard.jsx` and `ZoDashboard.jsx` destructure query results without any loading state guard:
```js
const { data: chartRes } = useQuery({ ... });
// chartRes is undefined on first render — charts render empty/broken until data arrives
```

No skeleton or loading state is rendered while queries are in-flight. Charts appear blank or flash empty states.

**Correction — add to both dashboard root renders:**
```jsx
import { SkeletonCard, SkeletonTable } from '../components/ui';

// While chartRes is loading:
if (!chartRes) return (
  <div className="space-y-6">
    <div className="grid grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
    </div>
    <SkeletonTable rows={5} cols={6} />
  </div>
);
```

Add this as a **checklist item in Milestone 6** (cleanup pass) since it affects both dashboards uniformly and doesn't interfere with component extraction.

---

### ❌ Violation 4 — Inline `style={{}}` on Non-Dynamic Values (Guidelines §5.1)

**Rule:** `style={{ ... }}` is only permitted for **dynamically calculated values** (chart dimensions, progress widths). Static design values must use Tailwind classes.

**Examples found in the current codebase (to correct during extraction):**

| Location | Inline style | Violation reason |
|---|---|---|
| `ExecutiveKpiStrip` KPI cards (HO line ~2243) | `style={{ minHeight: '135px' }}` | Static value — use `min-h-[135px]` |
| `ExecutiveKpiStrip` KPI cards (ZO line ~1771) | `style={{ minHeight: '130px' }}` | Static value — also an inconsistency: HO=135px, ZO=130px. Standardize to `min-h-[135px]` |
| `DepartmentWiseEstimate` donut title (HO line ~1542) | `style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}` | Dynamic theme-conditional — **permitted exception** |
| `InvestmentRecoveryPlot` chart title (HO line 997) | `style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}` | Dynamic — **permitted exception** |

When creating shared chart components, replace static `style={{ ... }}` values with Tailwind equivalents.

---

### ❌ Violation 5 — Import Path Inconsistency (Guidelines §3.1)

**Rule:** UI primitives must be imported as named imports from `src/components/ui` (the barrel `index.js`). Direct path imports (`from '../components/ui/Button'`) are explicitly prohibited.

**The refactor's own `analytics/` directory** must follow the same rule — **but in reverse**: because `analytics/` components must NOT use `src/components/ui/index.js` barrel (to avoid chunk merging), all `analytics/` internal imports go to concrete paths. These two rules coexist; they apply to different directory levels:

| Import context | Rule |
|---|---|
| Page files importing ui primitives | Use barrel: `import { Modal, Pagination } from '../components/ui'` |
| `analytics/` components importing each other | Use concrete path: `import ChartInfoTooltip from './ChartInfoTooltip'` |
| `analytics/` components importing ui primitives | Use barrel: `import { Pagination } from '../../ui'` — the barrel is fine here since the ui lib is shared globally |

---

### ✅ What IS Compliant

| Area | Status |
|---|---|
| TanStack Query for all server state | ✅ Both dashboards use `useQuery` / `useMutation` / `queryClient.invalidateQueries` correctly |
| `queryKey` descriptive arrays | ✅ Keys like `['hoKpis']`, `['zoChartData', activeView, selectedZo, ...]` follow the convention |
| `ThemeContext` / `useTheme()` for dark mode | ✅ Consistently used throughout (with the ZO `InvestmentRecoveryPlot` light-mode bug as the one known deviation) |
| Amber brand accent (`#f59e0b`) | ✅ Consistently used as primary interactive color, CTA buttons, active state indicators |
| `font-mono` for currency & WO numbers | ✅ Both dashboards use `font-mono` on financial figures and work order IDs |
| `glass-panel` CSS class on container sections | ✅ Used on telemetry table containers and dashboard section wrappers |
| `glass-card-hover` hover elevation | ✅ KPI strip cards use `hover:-translate-y-0.5` matching design spec |
| Semantic status color tokens | ✅ Emerald = approved/healthy, Rose = critical/danger, Amber = pending/warning — consistently applied |

---

### Compliance Correction Checklist (additions to Milestone 6)

```
Compliance [ ] Replace manual Prev/Next pagination in ZonalPerformanceHeatmap → <Pagination />
           [ ] Replace manual Prev/Next pagination in WorkOrderTelemetryTable (both) → <Pagination />
           [ ] Replace manual Prev/Next in InvestmentRecoveryPlot WO table → <Pagination />
           [ ] Replace KpiDetailsModal raw backdrop with <Modal size="xl"> from ui lib
           [ ] Add skeleton loading guards to both dashboard root renders (<SkeletonCard />, <SkeletonTable />)
           [ ] Remove static style={{ minHeight }} from ExecutiveKpiStrip — use Tailwind min-h-[135px]
           [ ] Standardize KPI card minHeight across HO (135px) and ZO (130px) — pick one
           [ ] Dual theme verification pass (dark + light) on all extracted components before M6 close
           [ ] npm run build inside frontend/ — zero compilation errors
```
