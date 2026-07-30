# Analytics Component Library

> **CRITICAL RULE: No barrel `index.js` in this directory.**

`HoDashboard` (`/analytics/ho`) and `ZoDashboard` (`/analytics/zo`) are separately `React.lazy()`-loaded route chunks (see `App.jsx`).

A barrel re-export file (`index.js`) in `components/analytics/` would cause Vite/Webpack to merge those route chunks together, leaking HO-only chart code into the ZO bundle (or vice versa).

### Directory Structure & Import Rules
- `ui/` — Generic shell UI primitives (e.g. `ChartModal`, `ChartInfoTooltip`, `ZoomCard`)
- `charts/` — Reusable SVG chart components (e.g. `BubbleRiskMatrixChart`, `SCurveChart`, `DonutChart`)
- `utils/` — Shared chart color tokens and SVG math helpers (e.g. `chartColors`, `formatters`, `donutGeometry`)

**Rule:** Every import targeting this directory must specify a concrete file path:
```javascript
// ✅ CORRECT
import { useChartColors } from '../components/analytics/utils/chartColors';
import { ChartModal } from '../components/analytics/ui/ChartModal';

// ❌ INCORRECT (Do NOT use barrel re-exports)
import { useChartColors, ChartModal } from '../components/analytics';
```
