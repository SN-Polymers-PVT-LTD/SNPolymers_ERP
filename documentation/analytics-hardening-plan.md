# Analytics Hardening Plan

> Repository: `SN-Polymers-PVT-LTD/SNPolymers_ERP`  
> Companion specification: `docs/financial-analytics-semantics.md`  
> Goal: align every analytics calculation, API response, chart, table, and export with the real finance/accounting lifecycle.

---

# 1. Objective

The analytics layer currently re-derives financial meaning from raw workflow tables and status fields.

That approach is now unsafe because the ERP has separate concepts for:

- contract value;
- sanctioned estimate;
- fund-request submission;
- HO allocation;
- ZO cash;
- requisition authorization;
- financial commitment;
- payment execution;
- partial payment;
- payment rejection;
- excess-fund return;
- gross billing;
- net agency amount;
- official physical progress;
- reporting freshness.

The hardening work should not be implemented as isolated chart patches.

Target architecture:

```text
Operational finance tables
          |
          v
Canonical financial fact views
          |
          v
Analytics materialized views / read models
          |
          v
Analytics API
          |
          v
Dashboard / charts / exports
```

Primary implementation principle:

> **Move financial interpretation downward into canonical SQL facts. Keep controllers and charts declarative.**

---

# 2. Scope

The work covers:

## Database

- canonical finance read models;
- analytics materialized views;
- ZO running-balance model;
- refresh ordering;
- indexes required by the new read paths.

## Backend

- `backend/src/controllers/analytics.controller.js`;
- analytics endpoints;
- date-filter behavior;
- removal of duplicated aggregation/business rules.

## Frontend

- `frontend/src/pages/HoDashboard.jsx`;
- `frontend/src/pages/ProjectDigitalTwin.jsx`;
- `frontend/src/components/analytics/ui/ExecutiveKpiStrip.jsx`;
- `frontend/src/components/analytics/charts/FundFlowWaterfallChart.jsx`;
- `frontend/src/components/analytics/charts/BubbleRiskMatrixChart.jsx`;
- `frontend/src/components/analytics/charts/InvestmentRecoveryPlot.jsx`;
- `frontend/src/components/analytics/charts/WorkOrderTelemetryTable.jsx`;
- related analytics adapters/types.

## Validation

- accounting invariants;
- lifecycle fixtures;
- date semantics;
- export parity;
- partial payment/rejection behavior;
- historical ledger balance correctness.

---

# 3. Do not start with frontend patches

The following changes would look easy but should not be the implementation strategy:

- replacing one field name in a chart;
- changing `approved_amount` to `paid_amount` everywhere;
- adding more fallback property names;
- changing a tooltip while retaining the wrong aggregation;
- filtering raw tables differently inside `analytics.controller.js`;
- calculating canonical commitment independently in several endpoints.

Those approaches preserve semantic duplication.

Instead, build a canonical fact layer first.

---

# 4. Phase 1 — Canonical DB fact layer

Recommended migration:

`076_analytics_semantic_alignment.sql`

If the migration becomes too large, split it into ordered migrations, but preserve the dependency sequence described later.

## 4.1 Create `latest_approved_estimate_v`

Purpose:

Return exactly one current sanctioned estimate per work order.

Required behavior:

- select the current/latest `Final Approved` estimate;
- expose canonical sanctioned amount;
- expose estimate revision information;
- provide deterministic ordering/tie-breaking.

Suggested output:

```text
work_order_no
estimate_id
estimate_revision
sanctioned_budget
approved_at
```

If main-head facts are needed frequently, add a companion normalized view for estimate items rather than embedding JSON interpretation in analytics controllers.

Acceptance criteria:

- one row per work order;
- old Final Approved revisions cannot accidentally double count;
- requisition capacity and analytics budget use the same sanctioned estimate.

## 4.2 Create `requisition_financial_facts_v`

Purpose:

Centralize requisition lifecycle interpretation.

Required input concepts:

- requisition status;
- approved amount;
- payment destination;
- payment status;
- paid amount;
- ZO action timestamp;
- payment timestamp.

Required output:

```text
requisition_id
work_order_no

requested_amount
authorized_amount
effective_commitment
paid_amount
outstanding_amount

created_at
authorized_at
paid_at

authorization_status
payment_status
payment_destination

is_authorized
is_financially_active
is_paid
```

The SQL projection must reproduce the business behavior currently represented by `getRequisitionFinancialState`.

Required lifecycle cases:

### Pending/unprocessed requisition

No authorized, committed, or paid financial exposure.

### ZO rejected

Zero financial exposure.

### ZO approved and awaiting payment execution

```text
authorized_amount = approved amount
effective_commitment = approved amount
paid_amount = 0
outstanding_amount = approved amount
```

### Direct ZO paid

```text
effective_commitment = paid amount
paid_amount = paid amount
outstanding_amount = 0
```

### Accounts paid

Use the actual paid amount.

### Accounts partially paid

Released remainder must not remain in commitment.

### Accounts rejected

Commitment and paid become zero.

### Cancelled

Financial exposure must be zero according to the canonical lifecycle rules.

Acceptance criteria:

One SQL source returns the same financial state as the application lifecycle for every status/payment-state combination.

## 4.3 Create `fund_request_financial_facts_v`

Purpose:

Separate draft creation, submission, and allocation.

Suggested fields:

```text
fund_request_id
work_order_no

requested_amount
allocated_amount

draft_created_at
submitted_at
allocated_at

request_status

is_draft
is_submitted
is_allocated
```

Rules:

- Draft is not submitted.
- Submission date is `submitted_at`.
- Allocation date is `approve_ho_date`.
- Allocated value is `approve_ho_amount`.

Acceptance criteria:

Draft requests never appear in submitted or allocated totals.

## 4.4 Create `project_financial_facts_v`

Purpose:

Provide one stable project-level interface for dashboard consumption.

Recommended columns:

```text
work_order_no

work_order_value
sanctioned_budget

funds_submitted
funds_allocated
funds_returned
zo_available_cash

requisition_requested
requisition_authorized
requisition_committed
requisition_paid
requisition_outstanding

gross_bills_certified
net_agency_amount

official_physical_progress
latest_submitted_dpr_at
reporting_staleness_days
```

Where possible this view should aggregate already-canonical fact views instead of reading operational tables directly.

## 4.5 Create ZO ledger running-balance read model

Possible implementation:

- normal SQL view;
- parameterized RPC;
- dedicated analytics query function.

Required behavior:

1. start from full ZO ledger history;
2. calculate cumulative signed balance;
3. expose event-level running balance;
4. allow outer date filtering;
5. expose true opening balance for selected periods.

Fields:

```text
zo_user_id
work_order_no
transaction_type
transaction_at
signed_amount
running_balance
reference_id
```

Acceptance criteria:

Selecting the last three months produces the same balance values those dates would have had when calculating from the entire ledger.

---

# 5. Phase 2 — Rebuild analytics materialized views

Six existing MVs require semantic alignment.

## 5.1 `project_health_mv`

Current issues:

- approved requisitions are treated as current expenditure/exposure;
- budget score uses Work Order Value;
- DPR selection favors maximum progress instead of latest report;
- submitted and approved progress facts are mixed.

Required redesign:

Expose:

```text
work_order_value
sanctioned_budget

requisition_authorized_amount
requisition_committed_amount
requisition_paid_amount
requisition_outstanding_amount

commitment_utilization_pct
paid_utilization_pct

latest_approved_physical_progress
latest_approved_dpr_at
latest_submitted_dpr_at
reporting_staleness_days
```

Budget utilization:

```text
effective commitment / sanctioned budget
```

Project-health scoring should use:

- current commitment exposure;
- official physical progress;
- reporting freshness;
- well-defined approval/backlog measures.

Do not infer current project state from the largest historical progress value.

## 5.2 `material_variance_mv`

Current issue:

Approved requisition amount is used as if it were the final financial consumption against a main head.

Required output by material/main head:

```text
estimated_amount
authorized_amount
effective_committed_amount
paid_amount

authorized_variance
commitment_variance
paid_variance

commitment_utilization_pct
paid_utilization_pct
```

Recommended product/UI name:

`Material Budget Utilization`

until actual material quantity consumption is modeled.

## 5.3 `approval_sla_mv`

Required datasets:

### Requisition Authorization SLA

```text
created_at -> zo_actioned_at
```

### Requisition Payment Execution SLA

```text
zo_actioned_at -> payment_date
```

Segment payment execution by:

```text
payment_destination
```

### Fund Request Approval SLA

```text
submitted_at -> approve_ho_date
```

For historical records without `submitted_at`, use an explicitly documented fallback only.

### Estimate approval SLA

Short-term:

retain the current header-level metric only if it is clearly named as gross lifecycle wall-clock time.

Longer-term:

use revision/stage logs to measure actual reviewer handling time per cycle.

## 5.4 `budget_leakage_mv`

Fix four concepts.

### Fund request count

Count submitted Fund Requests, not all non-cancelled rows.

Drafts must not inflate repeated-request risk.

### Estimate revision count

Do not use:

```sql
COUNT(*)
FROM project_cost_estimates
```

as the revision count.

Use either:

- current `estimate_revision`;
- revision-log cycle count;

depending on the intended risk metric.

### Budget cap

Use canonical sanctioned budget.

### Financial exposure

Use effective commitment, not raw authorized amount.

Recommended risk indicators:

- commitment > sanctioned budget;
- unusually frequent submitted Fund Requests;
- repeated estimate revision cycles;
- high commitment relative to physical progress.

## 5.5 `zone_performance_mv`

Required separation:

```text
commitment_utilization_pct
paid_utilization_pct
current_zo_cash
funds_allocated
funds_returned
official_physical_progress
authorization_sla
payment_execution_sla
reporting_staleness
```

Do not expose a single ambiguous "budget utilization" if it mixes commitments and cash settlement.

Future enhancement:

Distinguish:

- current portfolio ownership;
- historical event-time ZO attribution.

## 5.6 `executive_kpi_mv`

Remove semantic equation:

```text
approved requisition amount = total spent
```

Add explicit measures:

```text
total_work_order_value
total_sanctioned_budget
total_funds_allocated
total_committed
total_paid
total_outstanding
total_zo_cash
total_gross_billed
total_net_agency_amount
total_funds_returned

commitment_utilization_pct
paid_utilization_pct
```

---

# 6. Materialized-view dependency and migration order

`project_health_mv` is upstream of several analytics views.

A safe migration should explicitly handle dependencies.

Recommended order:

```text
1. Create canonical normal views
2. Drop/recreate downstream MVs as required by PostgreSQL dependencies
3. Rebuild project_health_mv
4. Rebuild approval_sla_mv
5. Rebuild material_variance_mv
6. Rebuild budget_leakage_mv
7. Rebuild zone_performance_mv
8. Rebuild executive_kpi_mv
9. Update refresh_analytics_views()
10. Recreate/revalidate indexes
```

Current refresh layering can remain conceptually:

Layer 1:

- `project_health_mv`
- `approval_sla_mv`
- `estimate_accuracy_mv`
- `material_variance_mv`
- `resource_utilization_mv`

Layer 2:

- `zone_performance_mv`
- `budget_leakage_mv`
- `executive_kpi_mv`

Canonical normal views do not require refresh.

---

# 7. Phase 3 — Refactor `analytics.controller.js`

Primary target:

`backend/src/controllers/analytics.controller.js`

Goal:

Stop rebuilding finance semantics in JavaScript.

The controller should mainly:

- validate query parameters;
- choose project/ZO/activity-period scopes;
- query canonical views/MVs;
- shape transport responses;
- preserve typed, explicit metric names.

## 7.1 Remove raw financial fallback chains

Avoid patterns equivalent to:

```text
approved_requisitions_amount
|| requisition_amount
|| some_other_amount
```

or:

```text
approved_ho_amount
|| ho_allocated_amount
|| approve_ho_amount
|| approved_amount
```

These values may describe different business events.

Preferred behavior:

- normalize once at the DB/API boundary;
- return explicit fields;
- if required data is absent, return null/zero according to a documented rule;
- optionally include a data-quality flag.

## 7.2 Redesign date filtering

Do not apply one generic date filter to unrelated row creation timestamps.

Introduce an explicit concept such as:

`activity_start_date` / `activity_end_date`

Apply it only to flow datasets using their business event date.

Mapping:

```text
Fund Request submitted -> submitted_at
HO allocation          -> approve_ho_date
Requisition authorized -> zo_actioned_at
Requisition paid       -> payment_date
Excess return          -> completed_at
RA/Final bill          -> bill_date
DPR                     -> site_visit_date
```

Current stock values should remain current.

If an actual historical "as-of" mode is introduced later, implement historical snapshots/event reconstruction rather than pretending a creation-date filter is an as-of snapshot.

## 7.3 Correct ZO cash/runway endpoint

Current business requirements:

- sum raw signed ledger amounts;
- do not negate already-negative requisition payment entries;
- calculate running balance over full history;
- separate operational payment burn from treasury returns;
- exclude Accounts-routed settlement from ZO cash burn unless a real ZO cash ledger event exists.

Return a typed response such as:

```text
opening_balance
closing_balance
allocations
operational_payments
returns
net_movement
average_operational_burn
runway_days
series[]
```

---

# 8. Phase 4 — Frontend visualization hardening

Every graph should receive data whose semantic meaning is already decided before it reaches React.

## 8.1 Executive KPI Strip

File:

`frontend/src/components/analytics/ui/ExecutiveKpiStrip.jsx`

Recommended cards:

```text
Work Order Value
Sanctioned Estimate
Funds Allocated
Current Commitment
Paid
ZO Available Cash
Gross Bills Certified
Net Agency Amount
Funds Returned
```

Depending on viewport, not all need to be visible at once. Prioritize and group them rather than changing their meaning.

Remove labels such as:

`Total Spent`

when the underlying data is authorization/commitment.

---

# 9. Graph-by-graph contract

This section is the frontend implementation checklist.

## 9.1 Fund Flow Waterfall -> Financial Position Ladder

File:

`frontend/src/components/analytics/charts/FundFlowWaterfallChart.jsx`

### What the current chart should stop implying

It should not imply:

```text
Sanctioned estimate
minus allocation
minus requisition
minus bill
minus agency amount
```

as one strict accounting waterfall.

### New purpose

Show related financial positions side by side/in sequence without inventing false subtraction relationships.

### Inputs

```text
sanctioned_budget
funds_allocated
funds_returned
zo_available_cash
requisition_committed
requisition_paid
gross_bills_certified
net_agency_amount
```

### Suggested visual structure

Treasury side:

```text
Sanctioned Budget
      |
      v
Funds Allocated
      |
      +---- Funds Returned
      |
      v
Current ZO Cash
```

Execution side:

```text
Current Commitment
      |
      v
Paid
```

Billing side:

```text
Gross Bills Certified
      |
      v
Net Agency Amount
```

These sections may share one chart but should not imply that every step mathematically subtracts from the previous one.

### What the graph answers

> How far has the project moved from sanction to funding, commitment, payment, and billing?

## 9.2 Bubble Risk Matrix

File:

`frontend/src/components/analytics/charts/BubbleRiskMatrixChart.jsx`

### Inputs

```text
x = commitment_utilization_pct
y = latest_approved_physical_progress
radius = reporting_staleness_days
```

Optional:

color = project health/risk category.

### What the graph answers

> Which projects have financially committed too much relative to actual physical progress, and which projects have stale reporting?

### Risk interpretation examples

High X, low Y:

Financial exposure ahead of execution.

Large bubble:

Data/reporting freshness concern.

High X, high Y:

Mature execution; inspect remaining budget.

Low X, low Y:

Early-stage project or stalled project; use reporting freshness/status to distinguish.

## 9.3 InvestmentRecoveryPlot -> Financial Execution & Billing

File:

`frontend/src/components/analytics/charts/InvestmentRecoveryPlot.jsx`

### Remove

```text
pendingRecovery = approved requisition amount - agency_payment
```

### Reason

`agency_payment` is not a proven client receipt.

### Replace with comparison series

Possible series:

```text
sanctioned_budget
effective_commitment
paid_amount
gross_bills_certified
net_agency_amount
physical_progress_pct
```

If mixed units make a single plot unclear, split physical progress onto a secondary visual/axis or remove it.

### Suggested rename

`FinancialExecutionBillingChart`

or retain the component filename temporarily while changing the visible title to:

**Financial Execution & Billing**

### What the graph answers

> How much budget is sanctioned, how much is financially committed/paid, and how much work has been certified through billing?

## 9.4 ZO Cash Runway / Fund Movement graph

Backend source:

ZO ledger running-balance read model.

### Inputs

```text
opening_balance
signed ledger events
running_balance
allocations
operational_payments
returns
average_operational_burn
```

### Display

Prefer:

- running cash-balance line;
- event markers or stacked flow bars for allocations/payments/returns;
- current balance;
- burn/runway summary if the time window is meaningful.

### What the graph answers

> What happened to ZO liquidity over time and, based on actual ZO-cash payment burn, how long could the current cash last?

### Do not

- treat a negative ledger payment as positive by negating it again;
- start a historical balance chart from zero at the selected period boundary;
- count Accounts settlement as ZO cash usage without a ledger cash event;
- combine returns with operational burn.

## 9.5 Material Budget Utilization graph

Backend:

`material_variance_mv`

### Inputs per material/main head

```text
estimated_amount
authorized_amount
effective_committed_amount
paid_amount
```

### Display

Recommended grouped bars or utilization bars:

```text
Sanctioned
Committed
Paid
```

Authorized can appear in tooltip/detail if four bars become visually noisy.

### What the graph answers

> Which sanctioned material/main-head budgets are already heavily committed or paid?

Do not call this true material-consumption variance until quantity/usage data exists.

## 9.6 Approval SLA graph

Backend:

`approval_sla_mv`

### Series

```text
Estimate approval
Fund Request HO approval
Requisition ZO authorization
Payment execution - ZO Balance
Payment execution - Accounts
```

### What the graph answers

> At which workflow stage is approval/payment latency accumulating?

Do not combine authorization and payment into one requisition SLA.

## 9.7 Zone Performance graph

Backend:

`zone_performance_mv`

### Recommended comparable metrics

```text
commitment_utilization_pct
paid_utilization_pct
official_physical_progress_pct
authorization_sla
payment_execution_sla
reporting_staleness
current_zo_cash
funds_returned
```

### What it answers

> Which ZOs are converting sanctioned budget into actual execution efficiently without excessive financial exposure, payment delay, or stale reporting?

Avoid one opaque composite score unless every input is documented.

---

# 10. Project Digital Twin hardening

File:

`frontend/src/pages/ProjectDigitalTwin.jsx`

Replace generic/ambiguous budget fields with:

```text
work_order_value
sanctioned_budget
authorized_amount
effective_commitment
paid_amount
outstanding_amount
funds_allocated
zo_available_cash
gross_bills_certified
net_agency_amount
official_physical_progress
reporting_staleness_days
```

Overrun calculations:

```text
overrun_amount =
max(0, effective_commitment - sanctioned_budget)

overrun_pct =
max(0, effective_commitment / sanctioned_budget * 100 - 100)
```

Both must use the same canonical budget denominator.

If management also wants contract-value comparison, display it separately and call it contract-value comparison rather than budget overrun.

---

# 11. Work Order Telemetry and export

File:

`frontend/src/components/analytics/charts/WorkOrderTelemetryTable.jsx`

The export must exactly match the same canonical facts displayed on screen.

Required properties should be explicit and typed.

Do not allow adapter logic such as:

```text
approved_amount || requisition_amount
```

because CSV/Excel exports become financially misleading even if the UI appears plausible.

Recommended columns:

```text
Work Order
Work Order Value
Sanctioned Budget
Funds Allocated
Funds Returned
ZO Available Cash
Authorized
Committed
Paid
Outstanding
Gross Bills Certified
Net Agency Amount
Physical Progress
Latest DPR
Reporting Staleness
Health/Risk
```

---

# 12. API contract

Introduce a stable DTO vocabulary.

Example project payload:

```json
{
  "work_order_no": "...",
  "contract": {
    "work_order_value": 0
  },
  "budget": {
    "sanctioned": 0,
    "commitment_utilization_pct": 0,
    "paid_utilization_pct": 0
  },
  "funding": {
    "submitted": 0,
    "allocated": 0,
    "returned": 0,
    "zo_available_cash": 0
  },
  "requisitions": {
    "authorized": 0,
    "committed": 0,
    "paid": 0,
    "outstanding": 0
  },
  "billing": {
    "gross_certified": 0,
    "net_agency_amount": 0
  },
  "progress": {
    "official_pct": 0,
    "latest_approved_at": null,
    "latest_submitted_at": null,
    "reporting_staleness_days": null
  }
}
```

The exact JSON nesting can differ, but the vocabulary should remain explicit.

---

# 13. Testing plan

The analytics changes are not complete without business-invariant tests.

## 13.1 Requisition lifecycle fixtures

Create fixtures covering:

1. pending requisition;
2. ZO rejected;
3. ZO approved/unpaid;
4. direct ZO paid;
5. Accounts paid fully;
6. Accounts partially paid;
7. Accounts rejected;
8. cancelled after authorization where allowed by lifecycle.

For every case assert:

```text
authorized
effective_commitment
paid
outstanding
ZO cash impact
```

## 13.2 Fund Request fixtures

Cases:

1. Draft;
2. submitted Pending;
3. Approved/allocated;
4. Cancelled;
5. historical row without `submitted_at` if legacy support is required.

Assert:

```text
submitted count
submitted amount
allocated amount
approval SLA start/end
```

## 13.3 ZO ledger tests

Cases:

- multiple allocations;
- direct payments;
- returns;
- events before selected reporting period;
- events inside selected reporting period.

Assert:

- signs remain correct;
- opening balance is correct;
- running balance does not reset at date-range boundary;
- return is not counted as operational burn.

## 13.4 Estimate tests

Cases:

- multiple revision cycles on one estimate row;
- multiple historical approved estimates if legacy data permits them;
- one current Final Approved estimate.

Assert:

- exactly one sanctioned budget is selected;
- revision metric reflects actual revision cycles.

## 13.5 DPR tests

Cases:

- newer Pending report with lower/higher progress;
- older Approved report;
- latest Approved report;
- multiple reports with same date.

Assert:

- latest submitted drives freshness;
- latest Approved drives official progress;
- maximum historical progress is not selected merely because it is numerically largest.

## 13.6 RA/final bill tests

Assert:

- `gross_bill` totals the configured breakdown;
- `agency_payment` remains a bill component;
- no API/chart exposes it as client recovery.

## 13.7 Date-filter tests

For an Activity Period:

Assert that:

- submitted Fund Requests use `submitted_at`;
- allocations use `approve_ho_date`;
- authorization uses `zo_actioned_at`;
- settlement uses `payment_date`;
- returns use `completed_at`;
- bills use `bill_date`;
- DPR flow uses `site_visit_date`;
- current stock metrics remain current.

---

# 14. Data quality and backward compatibility

Legacy records may not have every modern lifecycle timestamp.

Do not hide this through broad fallback chains.

Instead:

- define narrow historical fallbacks in SQL;
- expose a `data_quality` or `is_legacy_inferred` marker where useful;
- document each fallback;
- avoid applying legacy inference to newly-created data.

Example:

Fund Request approval SLA may temporarily use:

```text
COALESCE(submitted_at, legacy_submission_proxy)
```

but the view/API should make clear that this is historical compatibility, not the canonical event model.

---

# 15. Performance considerations

Canonical views should be designed around common dimensions:

- `work_order_no`
- project/zone ownership
- event timestamps
- status fields used by lifecycle projections

Review indexes after implementing queries rather than guessing.

Materialized views should remain appropriate for dashboard-wide aggregation, while normal canonical fact views provide consistency without requiring refresh.

Avoid duplicating large `UNION`/aggregation logic across multiple MVs if it can be centralized in one fact view.

---

# 16. Rollout plan

Recommended rollout sequence:

## Step 1

Add canonical fact views and SQL tests.

No frontend behavior changes yet.

## Step 2

Rebuild six MVs against the canonical facts.

Compare old vs new analytics on known work orders.

## Step 3

Refactor analytics backend endpoints to consume the views/MVs.

Keep response compatibility temporarily where practical, but introduce explicit new fields.

## Step 4

Update Executive KPI strip and Digital Twin.

These expose the most important semantic naming fixes.

## Step 5

Redesign graphs:

1. Fund Flow -> Financial Position Ladder
2. Bubble Risk Matrix
3. Investment/Recovery -> Financial Execution & Billing
4. Cash Runway
5. Material Budget Utilization
6. SLA visualizations
7. Zone Performance

## Step 6

Update Work Order Telemetry exports.

## Step 7

Remove deprecated ambiguous API fields after the frontend no longer consumes them.

---

# 17. Acceptance criteria

The hardening work is complete when all of the following are true.

1. No analytics path equates `Approved` requisition with `Paid`.
2. No dashboard uses Work Order Value as the sanctioned execution budget unless explicitly labeled as contract-value comparison.
3. Draft Fund Requests do not count as submitted funding requests.
4. HO allocations are dated by the actual HO allocation event.
5. ZO authorization and payment execution have separate SLAs.
6. Partial/rejected Accounts payment outcomes correctly alter effective commitment.
7. ZO cash charts use the signed ledger without double-negation.
8. Historical running balances are computed from full ledger history.
9. Accounts-routed payments do not falsely consume ZO cash.
10. Excess-fund returns are sourced from normalized ledger events.
11. Gross Bills and Net Agency Amount are not described as client recovery.
12. Official progress uses latest Approved DPR.
13. Reporting freshness uses latest submitted DPR.
14. ₹ overrun and % overrun use the same sanctioned-budget denominator.
15. Charts and exports consume the same canonical fields.
16. Frontend analytics contains no cross-semantic fallback chains.
17. Business-lifecycle tests cover draft/submitted/allocated, authorized/paid/partial/rejected, ledger balance, revisions, and DPR timing.

---

# 18. Definition of done for future analytics changes

A new analytics metric is ready only when it has:

- a documented business definition;
- one authoritative source;
- a stock/flow classification;
- an event timestamp if it is a flow;
- a canonical API name;
- a defined graph/table meaning;
- test coverage for lifecycle edge cases.

If any of those are missing, the metric should not be merged into analytics.
