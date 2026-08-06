# Milestone dedup map

Canonical record of milestone tests removed because the active suite provides equal or stronger coverage.

**Rule:** No milestone test is deleted without a row in this table. PRs must paste relevant rows under a **Milestone dedup** section.

## Dedup criteria (all must pass)

1. Same behavior
2. Equal or stronger assertions
3. Same authorization context (role, middleware vs controller, auth preconditions)
4. Same business constraints (not interchangeable 403s)

---

## Wave 1 (Phase 8)

| Removed | Replacement | Criteria |
|---------|-------------|----------|
| `milestones/milestone2.test.js` → `blocks unauthorized roles` | `regression/rbacMatrix.test.js` → `core.requireRole.deny` | 1–4 |
| `milestones/milestone2.test.js` → `allows authorized roles` | `regression/rbacMatrix.test.js` → `core.requireRole.allow` | 1–4 |
| `milestones/milestone_p3_m2.test.js` → `Test 6: Blocks JE role from listing fund requests with 403` | `regression/rbacMatrix.test.js` → `fund_requests.list.controller_je_denied` | 1–4 |
| `milestones/hoDashboardInsights.test.js` → `M3.4: RBAC — JE role receives HTTP 403 on chart-data` | `regression/rbacMatrix.test.js` → `analytics.ho_chart_data.je_denied` | 1–4 |
| `milestones/hoDashboardInsights.test.js` → `M3.1: Chart data returns all 6 dataset keys as arrays` | `contracts/analyticsContract.test.js` → `chart.empty_db_keys` | 1–4 |
| `milestones/hoDashboardInsights.test.js` → `M3.2: Waterfall stages are in correct order and amounts are non-negative numbers` | `contracts/analyticsContract.test.js` → `chart.waterfall_nonneg` | 1–4 (amount non-negative; stage order remains in milestone until contract extended) |
| `milestones/hoDashboardInsights.test.js` → `M2.1: Runway data returns correct structure and handles zero-burn ZOs` | `contracts/analyticsContract.test.js` → `insights.empty_arrays` | 1–4 (array presence; runway field structure remains covered by M2.2+ in milestones) |

### Deferred (no qualifying replacement yet)

| Milestone test | Blocker |
|----------------|---------|
| `hoDashboardInsights.test.js` → `M2.3: RBAC — JE 403 actionable-insights` | No `rbacMatrix` row for `GET /ho/actionable-insights` + JE. Add `analytics.actionable_insights.je_denied` in Phase 8.0b, then dedup. |

---

## PR template snippet

```markdown
## Milestone dedup

| Removed | Replacement |
|---------|-------------|
| milestone2.test.js → `blocks unauthorized roles` | rbacMatrix.test.js → `core.requireRole.deny` |
| ... | ... |
```
