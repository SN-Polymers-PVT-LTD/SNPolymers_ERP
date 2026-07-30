# HO/ZO Analytics Dashboard Refactor — Implementation Plan

> **Status:** Draft — Pending approval.
> **Stack:** React 19 / Vite frontend, TanStack Query, `useTheme`/`useAuth` context providers.
> **Scope:** `frontend/src/pages/HoDashboard.jsx` (3,208 lines) and `frontend/src/pages/ZoDashboard.jsx` (2,822 lines), routed at `/analytics/ho` and `/analytics/zo` (`App.jsx`, lazy-loaded).
> **Explicitly out of scope:** `pages/dashboard/HoDashboardView.jsx` and `ZoDashboardView.jsx` — these are a separate, smaller pair of components rendered inside `pages/Dashboard.jsx` and are not touched by this plan. Also out of scope: the query-count/staleTime and ZO data-scoping issues raised earlier — those are tracked as a **separate, parallel workstream** (see "Explicitly deferred" at the end) so they can be reviewed and rolled back independently of this UI dedup.

---

## Why phased, not big-bang

A full-file diff of both dashboards shows the duplication is **not uniform**. Some components are byte-for-byte identical modulo formatting; others share a name and general shape but have diverged in prop signatures, geometry constants, and even in which theme states they handle. Collapsing all of it in one PR risks silently changing chart math with no automated test coverage to catch it — there is currently **no frontend test framework in this repo** (only `backend/tests/vitest`), so every milestone below has a manual verification step that has to be actually done, not skipped.

Milestones are ordered **strictly by risk**, lowest first, so we bank confidence (and reviewer trust) before touching anything with real behavioral divergence.

---

## Milestone 0 — Scaffolding (no logic moved)

**Goal:** Create the target structure with nothing in it yet. Zero behavior change, zero review risk.

- Create `frontend/src/components/analytics/` with subfolders: `ui/`, `charts/`, `utils/`.
- Do **not** create a barrel `index.js`. Both dashboards are separately `React.lazy()`-loaded route chunks (`App.jsx` lines 39–40, 141, 147) — a barrel re-export risks merging those chunks and leaking HO-only chart code into the ZO bundle (or vice versa). Every future import goes to a concrete file path, e.g. `components/analytics/ui/ChartModal.jsx`.
- Add a short `README.md` inside `components/analytics/` documenting this no-barrel rule so it doesn't get "fixed" by a well-meaning cleanup later.

**Verification:** Nothing to verify — no imports change yet.

---

## Milestone 1 — Pure utils (verified byte-identical)

**Goal:** Extract the formatting/color helpers that are confirmed identical.

| Item | HO location | ZO location | Verified diff |
|---|---|---|---|
| `formatINR` | lines 18–25 | lines 20–24 | Whitespace only |
| `fmtCr` | lines 27–32 | lines 25–29 | Identical |
| `useChartColors` | lines 35–63 | lines 33–53 | Identical values; ZO is missing the `labelFaint` token (dead code in HO, or a gap in ZO — flag for design confirmation, don't guess) |

**Action:**
- `components/analytics/utils/formatters.js` → `formatINR`, `fmtCr`.
- `components/analytics/utils/chartColors.js` → `useChartColors` hook, keeping the full token set (including `labelFaint`).
- Update both dashboard files to import from these, delete the local copies.

**Verification:** Visual pass on both dashboards in light and dark mode — all currency figures and chart colors should look pixel-identical to before. This is a mechanical extraction; if anything looks different, the extraction was done wrong, not the source.

---

## Milestone 2 — Pure UI shell components (near-identical, low risk)

**Goal:** Extract components with no data-shape dependency — pure presentation.

| Component | HO location | ZO location | Verified diff |
|---|---|---|---|
| `ChartModal` | lines 66–144 | lines 270–342 | Formatting/whitespace only (`React.useEffect` vs `useEffect` import style, same otherwise) |
| `ZoomCard` | lines 147–159 | lines 343–357 | Identical |
| `ChartInfoTooltip` | line 1354 (HO) | lines 63–140 (ZO) | Identical — **note:** an earlier pass mis-cited both instances as being at "63–140," which is only true for the ZO file; confirm exact line numbers again at implementation time since these will shift as milestones land |

**Action:** Move as-is into `components/analytics/ui/`. `ChartModal` takes `isDark` as an explicit prop already (falls back to `useTheme()` internally) — no prop changes needed on either dashboard's call sites.

**Verification:** Open every zoomable chart on both dashboards, confirm the modal opens/closes (including Escape key), confirm the info tooltip portal renders without clipping near screen edges.

---

## Milestone 3 — `KpiDetailsModal` (needs light reconciliation)

**Goal:** Same component, genuinely different prop contracts — this is the first milestone requiring an actual decision, not just a copy-paste.

- HO signature: `({ title, colorClass, projects, onClose, navigate })` — navigate passed in from parent (lines 162–286).
- ZO signature: `({ title, colorClass, projects, getZoDisplayName, onClose })` — calls `useNavigate()` internally, and adds a `getZoDisplayName` prop HO doesn't have (lines 359–457).

**Action:** Standardize on the ZO pattern — call `useNavigate()` inside the shared component rather than threading it through as a prop (one less thing callers have to remember to pass). Make `getZoDisplayName` an optional prop (`= null`) so HO's call site doesn't need to supply it.

**Verification:** Click through KPI tiles on both dashboards, confirm the drill-down modal lists the right projects and that "view project" navigation still works from both HO and ZO contexts.

---

## Milestone 4 — `InvestmentRecoveryPlot` (identical signature, diverged body — highest LOC payoff)

**Goal:** This is the single biggest line-count win in the whole refactor (~480 lines duplicated) and it already has a matching signature on both sides: `({ projects, agencyPaymentAmount = 0, isModal = false })`.

**What a full-body diff actually found**, so this isn't done blind:
- The ZO version renders an **extra KPI card** ("Bill Recovery %") that HO's version doesn't have.
- Several class strings in the ZO version are **hardcoded to dark-mode** (e.g. `bg-white/5 border-white/5`, `text-slate-300`, `text-amber-400`) where HO's equivalent correctly branches on `isDark`. This means **ZO's light mode is currently subtly broken** in this chart's breakdown list — extracting the HO version as the base and porting over the extra "Bill Recovery %" card fixes this ZO bug as a side effect of the dedup, rather than as separate work.
- Everything else (the `useMemo` metric calculations, the waterfall bars, the pagination) is functionally identical, differing only in `React.useMemo` vs `useMemo` import style.

**Action:** Base the shared component on HO's theme-aware version, add ZO's extra KPI card as an optional section (behind a prop like `showRecoveryPct = true`, defaulting on for both unless HO explicitly doesn't want it — confirm with whoever owns this screen before deciding to show it on both or gate it).

**Verification:** This one needs the most care since it touches financial figures. Compare rendered numbers (not just visuals) against the pre-refactor version for a handful of known projects on both dashboards, in both themes.

---

## Milestone 5 — Chart primitives with divergent geometry (highest risk — do these last, one at a time)

**Goal:** These share a component name and general purpose but have **real, verified behavioral differences** — not just formatting. Do not batch these into one PR; each gets its own PR and its own before/after screenshot comparison (there's no visual regression tooling here, so this has to be done by hand).

| Component | Divergence found |
|---|---|
| `BubbleRiskMatrix` | HO: `({ data })`, percent-based `toX`/`toY`, canvas `400×600` at `PAD 60`. ZO: `({ projects, bubbleMatrixData = [] })`, value-based `toX`/`toY` with hard clamps at 140/100, canvas `380×600` at `PAD 58`, and derives `bubbles` from raw project fields when `bubbleMatrixData` is empty — HO has no such fallback. |
| `SCurveProgress` | HO: `({ data })`, single `PAD` constant, `H=300`. ZO: `({ projects, sCurveData = [] })`, split `PAD_TOP`/`PAD_BOT`/`PAD_SIDE`, `H=330`. |
| `FundFlowWaterfall` | HO: `({ data })`. ZO: `({ data, projects })` — takes an extra prop. |
| `DepartmentWiseEstimate` | HO: `({ data })`. ZO: `({ projects })` — different key entirely, not just a rename; confirm the two data shapes are actually equivalent before assuming this is a drop-in prop rename. |
| `ExecutiveKpiStrip` | HO: `({ data })` with an inline `formatCr` helper. ZO: `({ projects, summaryKpis })` — takes two inputs where HO takes one. |
| `WorkOrderTelemetryTable` | HO: `({ data, selectedZone, onSelectZone })` — single-zone selector. ZO: `({ data, availableZos, selectedZo, onSelectZo, getZoDisplayName })` — multi-zone selector, a materially different feature, not a naming difference. |

**Confirmed: the geometry differences are drift, not intent** (no version history exists in this repo to date it precisely, but this has been confirmed directly rather than assumed). This simplifies the plan — no design sign-off step needed, just pick one canonical set of constants per component and treat the other as the bug.

**Action, per component:**
1. Pick the canonical constants by rendering both current versions side by side and checking for clipping, overflow, or visibly cramped labels — whichever actually looks correct at real data volumes wins, not whichever file happens to be HO's. Don't default to "HO is the reference" as a rule; check each component independently, since drift can go either direction (e.g. ZO's `BubbleRiskMatrix` clamping bubbles at 140/100 while HO's doesn't could equally mean HO is missing a fix ZO already has, not the other way around).
2. Design the shared component around a **normalized data shape**, and write a small adapter/mapper at each call site (in `HoDashboard.jsx` / `ZoDashboard.jsx`) that shapes local data into that normalized form before passing it down. This keeps the chart component itself simple and pushes the "which fields does this page have" logic to the page, which is where it belongs.
3. One PR per component. Ship, verify, merge, then move to the next — do not open all six at once. Each PR description should note which side's constants were kept and why, so it's a traceable decision, not a silent pick.

**Verification per component:** Screenshot both dashboards before touching the component, screenshot again after, diff manually. For `BubbleRiskMatrix` specifically, also manually test hover/tooltip behavior on both dashboards since the underlying coordinate math changes.

**Suggested order within this milestone** (lowest to highest divergence): `FundFlowWaterfall` → `DepartmentWiseEstimate` → `ExecutiveKpiStrip` → `SCurveProgress` → `BubbleRiskMatrix` → `WorkOrderTelemetryTable` (last, because the multi-zone selector is a real feature difference, not just styling, and deserves the most attention).

---

## Milestone 6 — Cleanup

- Delete now-unused local component definitions from both dashboard files.
- Re-run `wc -l` on both files and record the before/after line counts in this doc (or the PR description) so the win is documented, not just claimed.
- Update `docs/frontend.md` if it references the old monolithic structure.
- Final pass: confirm both `/analytics/ho` and `/analytics/zo` route chunks still lazy-load independently (check the network tab for separate JS chunks, not one merged bundle) — this is the concrete check for the "no barrel" rule from Milestone 0 actually holding.

---

## Explicitly deferred (not part of this refactor)

Raised in earlier discussion, intentionally **not** bundled into this plan so each can be reviewed and rolled back on its own:

1. **`staleTime` on dashboard `useQuery` calls** — cheap, high-value, unrelated to component structure. Should probably ship *before* this plan even starts, independently.
2. **Whether `getProjectsHealth()` / `getRequisitions()` support server-side zone scoping for ZO users** — this is a data-exposure question, not a refactor question. Needs a backend review of the actual endpoint handlers before any conclusion is drawn, and should be treated as higher priority than anything in this document if it turns out scoping doesn't exist server-side.
3. **Debounced/ref-based tooltip state in `BubbleRiskMatrix`** — can ride along with Milestone 5's `BubbleRiskMatrix` PR since that component is already being touched, but is a perf fix, not a dedup, and should be called out as a separate commit within that PR for a clean revert path. Isolate mouse coordinate tracking (using DOM refs or CSS variables) so cursor movements over chart items don't trigger parent SVG re-renders on every pixel shift.
4. **Adding a frontend test framework / Smoke Test Safety Net** — set up a minimal smoke test suite (e.g. Vitest + React Testing Library) to verify `<DonutChart />` and geometric primitives render cleanly with mock data before starting Milestone 5, eliminating the risk of undetected rendering crashes.
5. **Standardized Responsive SVG Viewports** — during Milestone 5 geometry reconciliation, ensure all extracted SVG charts use standard `viewBox` coordinates paired with `preserveAspectRatio="xMidYMid meet"` and container-relative width/height to guarantee clean responsive rendering across high-DPI laptop screens and ultra-wide displays.

