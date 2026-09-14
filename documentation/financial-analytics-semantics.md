# Financial Analytics Semantics

> Repository: `SN-Polymers-PVT-LTD/SNPolymers_ERP`  
> Purpose: permanent business and analytics contract for finance-related reporting.  
> Status: source-of-truth specification for analytics work.  
> Scope: estimates, fund requests, HO allocation, ZO balances, requisitions, payment execution, excess-fund returns, RA/final bills, DPR progress, project health, and analytics visualizations.

---

## 1. Why this document exists

The ERP now models multiple financial stages that were previously treated as if they were the same thing.

Examples of distinctions that must remain explicit:

- Work Order Value is not the same as the sanctioned execution budget.
- A Draft Fund Request is not yet a request to HO.
- A submitted Fund Request is not yet an HO allocation.
- An approved requisition is not automatically paid.
- An authorized requisition may later be partially paid or rejected by Accounts.
- A payment routed through Accounts is not necessarily a reduction in ZO cash.
- Gross bill value is not the same as net agency payment.
- `agency_payment` is not a verified client recovery/receipt.
- The latest submitted DPR and the latest approved DPR answer different questions.

The permanent rule for analytics is:

> **Analytics must consume canonical financial facts. It must not infer accounting meaning directly from workflow status labels.**

---

# 2. Core financial model

## 2.1 Work Order Value

Source:

`projects_master.work_order_value`

Meaning:

The contractual/work-order value of the project.

Use for:

- contract-size reporting;
- portfolio value;
- commercial context;
- comparisons against contract value where explicitly intended.

Do not automatically use it as:

- execution budget;
- requisition capacity;
- budget-utilization denominator;
- budget-overrun denominator.

---

## 2.2 Sanctioned Execution Budget

Source:

The latest `Final Approved` record in `project_cost_estimates`, ordered by the estimate revision/lifecycle used by the ERP.

Meaning:

The currently sanctioned execution budget against which operational expenditure and requisition capacity should normally be evaluated.

Canonical analytical name:

`sanctioned_budget`

Preferred read model:

`latest_approved_estimate_v`

If no sanctioned estimate exists, analytics must not silently pretend that Work Order Value means the same thing. Any fallback must be deliberate, documented, and surfaced to the API/UI as a fallback state.

---

# 3. Estimate lifecycle

The estimate workflow establishes the sanctioned execution budget.

Simplified lifecycle:

```text
Estimate prepared
      |
      v
Review / revision cycles
      |
      v
Final Approved
      |
      v
Current sanctioned execution budget
```

Important rules:

1. The latest `Final Approved` estimate is the operational budget.
2. Requisition capacity is governed against this estimate and its main-head allocations.
3. `estimate_revision` is incremented on the estimate lifecycle; revision history is also represented in `estimate_revision_log`.
4. Counting rows in `project_cost_estimates` is not a reliable count of revision cycles.

For analytics:

- budget cap = latest Final Approved estimate;
- estimate revision count must come from `estimate_revision` or the revision log according to the metric being reported;
- older approved estimates are historical, not current budget caps.

---

# 4. Fund Request lifecycle

A Fund Request contains three financially distinct stages.

```text
Draft
  |
  v
Submitted / Pending
  |
  v
HO Approved / Allocated
  |
  v
ZO Balance credited
```

## 4.1 Draft

Relevant time:

`created_at`

Meaning:

The user has prepared a request but has not yet submitted it into the approval workflow.

Analytics rules:

- must not count as "funds requested";
- must not count as repeated HO requests;
- may be shown in operational backlog if desired, but separately from submitted requests.

## 4.2 Submitted Fund Request

Relevant time:

`submitted_at`

Meaning:

The request has entered the real approval workflow.

Canonical analytical measures:

- submitted request count;
- submitted request amount;
- Fund Request approval SLA starting point.

Historical records created before `submitted_at` existed may require a documented fallback such as `zo_date`, but new analytics must prefer `submitted_at`.

## 4.3 HO Allocation

Relevant fields:

- `approve_ho_amount`
- `approve_ho_date`
- `request_status = 'Approved'`

Meaning:

HO has approved the request and the amount has been allocated.

The allocation should also appear as a positive movement in the ZO fund ledger.

Canonical analytical name:

`funds_allocated`

Do not use Fund Request `created_at` as the allocation date.

---

# 5. Requisition and payment lifecycle

Requisition authorization and payment execution are separate business processes.

```text
Requisition Created
        |
        v
ZO Authorization Decision
        |
        +------ Rejected
        |
        v
Approved / Authorized
        |
        v
Payment destination selected
        |
        +---------------------+
        |                     |
        v                     v
ZO Balance                Accounts
        |                     |
        v                     v
Direct settlement       Paid / Partial / Rejected
```

Key fields introduced by the current lifecycle include:

- `payment_destination`
- `payment_status`
- `paid_amount`
- `zo_actioned_at`
- `payment_date`

---

# 6. Canonical requisition amounts

Analytics must keep the following values distinct.

## 6.1 Requested Amount

Meaning:

What the requisition originally asked for.

Canonical name:

`requested_amount`

## 6.2 Authorized Amount

Meaning:

What ZO approved/authorized.

Canonical name:

`authorized_amount`

This is an authorization fact, not proof of settlement.

## 6.3 Effective Commitment

Meaning:

The current surviving financial liability created by the requisition after downstream payment execution outcomes are considered.

Canonical name:

`effective_commitment`

Examples:

### ZO authorizes ₹100,000; no payment yet

```text
Authorized           100,000
Effective commitment 100,000
Paid                       0
Outstanding          100,000
```

### Accounts later pays ₹60,000 and releases the remaining ₹40,000

```text
Authorized           100,000
Effective commitment  60,000
Paid                  60,000
Outstanding                0
```

### Accounts rejects the payment

```text
Authorized           100,000
Effective commitment       0
Paid                       0
Outstanding                0
```

The canonical implementation must match the same business rules used by `getRequisitionFinancialState`.

## 6.4 Paid Amount

Meaning:

Amount actually settled.

Canonical name:

`paid_amount`

This is the appropriate value for cash-settlement reporting, but not necessarily for budget commitment reporting.

## 6.5 Outstanding Amount

Meaning:

Financial commitment that still remains unpaid.

Canonical name:

`outstanding_amount`

Typical relationship:

```text
outstanding_amount = effective_commitment - paid_amount
```

subject to the canonical lifecycle projection.

---

# 7. Canonical requisition dates

These timestamps are not interchangeable.

| Event | Canonical timestamp | Meaning |
|---|---|---|
| Requisition created | `created_at` | Request entered |
| ZO authorization decision | `zo_actioned_at` | Authorization workflow completed |
| Settlement | `payment_date` | Actual payment completed |

Therefore:

### ZO Authorization SLA

```text
created_at -> zo_actioned_at
```

### Payment Execution SLA

```text
zo_actioned_at -> payment_date
```

Payment SLA should be segmentable by `payment_destination` because Accounts-routed and ZO-balance payments are operationally different.

---

# 8. ZO cash ledger

The ZO fund ledger should be treated as the source of truth for ZO cash movement.

Signed accounting semantics:

```text
ALLOCATION                   + amount
REQUISITION_APPROVAL/payment - amount
RETURN                       - amount
```

The sign already carries the accounting direction.

## 8.1 Current ZO cash

Meaning:

Current liquid funds still held by the ZO.

This is a stock metric.

It is not the same as:

- funds allocated;
- current commitment;
- amount paid;
- remaining estimate budget.

## 8.2 Historical ZO running balance

Correct calculation:

```text
full ledger history
      |
      v
cumulative signed balance
      |
      v
filter the requested display period
```

Incorrect calculation:

```text
filter to last N months
      |
      v
start at zero
      |
      v
cumulative movement
```

The second method displays movement since the selected window began, not the true balance at each historical point.

## 8.3 ZO cash burn

For ZO liquidity/runway, operational cash burn should come from negative operational ZO ledger payment events.

Accounts-routed payments do not automatically reduce ZO liquid cash.

Excess-fund returns should normally be shown separately from operational burn because a return is a treasury movement, not project consumption.

---

# 9. Excess-fund returns

Accepted excess-fund returns already create normalized, per-work-order negative `RETURN` ledger entries.

Analytics should use the normalized ledger entries rather than re-expanding the JSON breakdown stored on the request.

Canonical analytical measures:

- total funds returned;
- returns by ZO;
- returns by work order;
- completed-return date;
- effect on ZO cash.

Preferred event date:

`completed_at` where applicable, with the corresponding ledger timestamp as accounting support.

---

# 10. RA / Final Bill semantics

`ra_final_bills.gross_bill`

Meaning:

Gross certified bill amount.

`agency_payment`

Meaning:

One component of the bill breakdown.

The application enforces a relationship broadly of the form:

```text
gross_bill
≈ agency_payment
+ security deposits
+ special security
+ other retention
+ income-tax TDS
+ SGST
+ CGST
+ SD
```

Therefore:

> `agency_payment` must not be interpreted as a verified cash recovery from the client.

Unless a separate client receipt/recovery ledger exists, analytics must not label:

```text
requisition amount - agency_payment
```

as "pending recovery".

Preferred terminology:

- Gross Bills Certified
- Net Agency Amount

If the business later wants true recovery analytics, add a dedicated client receipt/recovery source.

---

# 11. DPR / physical-progress semantics

New DPR submissions enter as:

`approval_status = 'Pending'`

Therefore two separate analytical facts are required.

## 11.1 Latest submitted DPR

Use for:

- reporting freshness;
- stale-reporting alerts;
- latest field activity.

Preferred ordering:

actual reporting/business date such as `site_visit_date`, then stable timestamp/tie-breaker.

## 11.2 Latest approved DPR

Use for:

- official physical progress;
- project-health scoring;
- management reporting.

Do not select the highest historical physical progress and call it "latest".

---

# 12. Stock metrics vs flow metrics

A global date range must not be applied indiscriminately.

## 12.1 Stock metrics

These describe current state.

Examples:

- current sanctioned estimate;
- current effective commitment;
- current outstanding commitment;
- current ZO balance;
- current project health;
- current official physical progress.

A date range should not make these disappear because the underlying record was created earlier.

## 12.2 Flow metrics

These describe events during a period.

Correct event timestamps include:

| Flow | Event date |
|---|---|
| Fund Request submitted | `submitted_at` |
| HO allocation | `approve_ho_date` |
| Requisition authorization | `zo_actioned_at` |
| Requisition payment | `payment_date` |
| Excess-fund return | `completed_at` |
| Bill certification | `bill_date` |
| DPR reporting | `site_visit_date` |

If the UI offers a date filter, label it clearly as an **Activity Period** unless true historical "as of" snapshots have been implemented.

---

# 13. Canonical analytics fact layer

Analytics should consume a small number of canonical DB read models instead of re-implementing business logic in controllers and charts.

Recommended views:

## 13.1 `latest_approved_estimate_v`

One current Final Approved estimate per work order.

Suggested fields:

- `work_order_no`
- `estimate_id`
- `estimate_revision`
- `sanctioned_budget`
- current main-head allocations
- approval timestamps

## 13.2 `requisition_financial_facts_v`

Suggested fields:

- `requisition_id`
- `work_order_no`
- `requested_amount`
- `authorized_amount`
- `effective_commitment`
- `paid_amount`
- `outstanding_amount`
- `created_at`
- `authorized_at`
- `paid_at`
- `authorization_status`
- `payment_status`
- `payment_destination`
- `is_authorized`
- `is_financially_active`
- `is_paid`

Business rules must match the canonical requisition lifecycle used by the application.

## 13.3 `fund_request_financial_facts_v`

Suggested fields:

- `fund_request_id`
- `work_order_no`
- `draft_created_at`
- `submitted_at`
- `allocated_at`
- `requested_amount`
- `allocated_amount`
- `request_status`
- `is_draft`
- `is_submitted`
- `is_allocated`

## 13.4 `project_financial_facts_v`

Suggested project-level fields:

- Work Order Value
- sanctioned budget
- authorized requisitions
- effective commitment
- paid requisitions
- outstanding commitment
- funds allocated
- funds returned
- current ZO cash
- gross bills certified
- net agency amount
- official physical progress
- reporting freshness

## 13.5 ZO ledger running-balance read model

Must provide:

- signed ledger event;
- running balance calculated over full history;
- opening balance for selected periods;
- transaction type;
- work-order attribution;
- ZO attribution.

---

# 14. Analytics visualization contract

This section defines exactly what each graph/component is supposed to communicate.

## 14.1 Executive KPI Strip

Current component:

`frontend/src/components/analytics/ui/ExecutiveKpiStrip.jsx`

Purpose:

Give management a compact financial and execution snapshot.

Recommended measures:

- Total Work Order Value
- Current Sanctioned Estimate
- Funds Allocated to ZOs
- Current Requisition Commitment
- Requisition Paid
- ZO Available Cash
- Gross Bills Certified
- Net Agency Amount
- Excess Funds Returned

Rules:

- do not label approved requisition amount as "spent";
- commitment and paid must be separate;
- `agency_payment` must be labeled Net Agency Amount, not recovery;
- avoid fallback chains that substitute semantically different amounts.

## 14.2 Fund Flow Waterfall / Financial Position chart

Current component:

`frontend/src/components/analytics/charts/FundFlowWaterfallChart.jsx`

Current problem:

The existing waterfall visually implies that estimate, allocation, requisitions, bills, and agency amount are one strictly subtractive funnel.

They are not.

Recommended purpose:

Show the project's **financial position across related but distinct stages**.

Recommended displayed stages:

```text
Sanctioned Estimate
Funds Allocated to ZOs
Funds Returned
Current ZO Cash
Current Requisition Commitment
Requisition Paid
Gross Bills Certified
Net Agency Amount
```

Presentation:

Prefer a comparative "Financial Position Ladder" or clearly separated stages rather than deriving fake "remaining" values between unrelated concepts.

What it should answer:

> Where is the project financially across budget sanction, treasury funding, commitments, cash settlement, and certified billing?

## 14.3 Bubble Risk Matrix

Current component:

`frontend/src/components/analytics/charts/BubbleRiskMatrixChart.jsx`

Purpose:

Identify projects whose financial exposure is ahead of physical execution or whose reporting is stale.

Recommended axes:

```text
X = Commitment Utilization %
    effective_commitment / sanctioned_budget

Y = Official Physical Progress %
    latest Approved DPR

Bubble size = Reporting staleness
              days since latest submitted DPR
```

Optional color/risk band:

Derived project-health classification.

What it should answer:

> Which projects are financially committed faster than work is physically progressing, and which ones have stale reporting?

Example risk:

85% commitment utilization with 35% official physical progress should stand out immediately.

## 14.4 Investment / Recovery plot

Current component:

`frontend/src/components/analytics/charts/InvestmentRecoveryPlot.jsx`

Current semantics are invalid if they use:

```text
approved requisition amount - agency_payment = pending recovery
```

Reason:

`agency_payment` is not a verified client receipt.

Recommended replacement purpose:

Show **execution spend and billing position**, not recovery.

Recommended measures:

- sanctioned budget;
- current commitment;
- requisition paid;
- gross bills certified;
- net agency amount;
- physical progress.

Possible new names:

- Financial Execution vs Billing
- Commitment & Billing Position
- Project Spend / Billing Position

Only restore the word "Recovery" after a real client receipt/recovery ledger is introduced.

## 14.5 Project Digital Twin

Current page:

`frontend/src/pages/ProjectDigitalTwin.jsx`

Purpose:

Provide detailed per-project operational and financial telemetry.

Required financial semantics:

- display canonical `sanctioned_budget`;
- display current commitment;
- display paid amount separately;
- display outstanding amount;
- calculate ₹ overrun and % overrun against the same budget cap;
- display official physical progress;
- display reporting freshness.

Do not calculate:

- amount overrun against Work Order Value while percentage overrun uses sanctioned estimate;
- "Total Spent" from approved requisitions.

What it should answer:

> What is the current contract, budget, commitment, cash-settlement, billing, and physical-progress state of this project?

## 14.6 Work Order Telemetry table / export

Current component:

`frontend/src/components/analytics/charts/WorkOrderTelemetryTable.jsx`

Purpose:

Provide auditable project-by-project analytical data.

Recommended columns:

- Work Order
- Work Order Value
- Sanctioned Budget
- Funds Allocated
- Current ZO Cash
- Authorized Requisitions
- Effective Commitment
- Paid
- Outstanding
- Gross Bills
- Net Agency Amount
- Official Physical Progress
- Latest Submitted DPR
- Reporting Staleness
- Risk / health classification

Rules:

The table and export must use the same canonical API fields as the charts. Do not use fallback property chains across different business concepts.

## 14.7 Approval SLA chart / dataset

Backend source:

`approval_sla_mv`

Purpose:

Measure workflow processing time.

Must separate:

### Estimate approval SLA

Defined according to the chosen estimate-cycle policy.

### Fund Request approval SLA

```text
submitted_at -> approve_ho_date
```

with a documented historical fallback only for old records.

### Requisition authorization SLA

```text
created_at -> zo_actioned_at
```

### Payment execution SLA

```text
zo_actioned_at -> payment_date
```

Prefer breaking payment execution down by:

- `ZO_BALANCE`
- `ACCOUNTS`

What it should answer:

> Where is process latency occurring: authorization, HO allocation, or actual payment execution?

## 14.8 Material Budget Utilization / Variance chart

Backend source:

`material_variance_mv`

Recommended business name:

**Material Budget Utilization**

unless true quantity-consumption variance is later implemented.

Purpose:

Compare approved estimate head allocations against current financial exposure.

Per main head show:

- estimated amount;
- authorized amount;
- effective commitment;
- paid amount;
- commitment variance;
- paid variance.

What it should answer:

> Which material/main-head budgets are most heavily committed or already paid against the sanctioned estimate?

## 14.9 ZO Cash Runway / Fund Movement chart

Backend source:

ZO ledger read model and `getHoChartData`-type endpoint.

Purpose:

Show actual ZO liquidity and cash movement.

Required logic:

- use raw signed ledger amounts;
- calculate running balance over full history before date filtering;
- distinguish allocations, operational payments, and returns;
- derive operational burn only from actual ZO-cash payment events;
- do not treat Accounts-routed payments as ZO cash burn.

What it should answer:

> How much liquid cash does the ZO have, how did it move, and how quickly is operational cash being consumed?

## 14.10 Budget Leakage / Project Risk indicators

Backend source:

`budget_leakage_mv`

Purpose:

Identify structural budget-risk signals.

Valid signals may include:

- commitment beyond sanctioned budget;
- unusually frequent submitted Fund Requests;
- repeated estimate revision cycles;
- low physical progress relative to commitment;
- abnormal return/allocation patterns.

Rules:

- Draft Fund Requests do not count as repeated funding requests;
- estimate revision count must not use `COUNT(*)` on estimate rows;
- financial overrun uses effective commitment against sanctioned budget.

## 14.11 Zone Performance chart / summary

Backend source:

`zone_performance_mv`

Purpose:

Compare ZOs without mixing treasury, commitment, and payment concepts.

Recommended measures:

- sanctioned budget under current portfolio;
- allocation;
- current ZO cash;
- commitment utilization;
- paid utilization;
- physical progress;
- authorization SLA;
- payment SLA;
- reporting freshness;
- excess returns.

Historical performance attribution may eventually require event-time ZO ownership instead of only current project assignment.

---

# 15. Materialized-view semantic contract

The following existing analytics materialized views require alignment with the canonical facts.

## `project_health_mv`

Must expose:

- sanctioned budget;
- authorized amount;
- effective commitment;
- paid amount;
- outstanding amount;
- commitment utilization;
- latest approved progress;
- latest submitted DPR freshness.

Do not select DPR by maximum physical progress.

## `material_variance_mv`

Must use:

- sanctioned main-head amount;
- authorized amount;
- effective commitment;
- paid amount.

## `approval_sla_mv`

Must use actual event timestamps.

Do not use:

- requisition `payment_date` as ZO approval completion;
- Fund Request creation date as submission date.

## `budget_leakage_mv`

Must:

- exclude Draft Fund Requests from submitted-request counts;
- use valid estimate revision-cycle counting;
- calculate overrun against sanctioned budget;
- use effective commitment, not raw approved amount.

## `zone_performance_mv`

Must expose distinct commitment and paid utilization.

## `executive_kpi_mv`

Must not define:

```text
SUM(approved_requisition_amount) = total_spent
```

Recommended measures include:

- `total_authorized`
- `total_committed`
- `total_paid`
- `commitment_utilization_pct`
- `paid_utilization_pct`

---

# 16. Naming rules

Preferred terms:

| Use | Avoid when inaccurate |
|---|---|
| Work Order Value | Budget |
| Sanctioned Budget | Work Order Value as execution cap |
| Funds Submitted | Draft-created amount |
| Funds Allocated | Requested funds |
| Authorized Requisition | Spent |
| Current Commitment | Approved spend |
| Paid | Approved |
| Outstanding Commitment | Pending spend without definition |
| Gross Bills Certified | Revenue unless that is truly the business meaning |
| Net Agency Amount | Recovery |
| ZO Available Cash | Unspent Budget |
| Reporting Freshness | Physical progress |

---

# 17. Analytics invariants

These should be enforced by tests.

1. A Draft Fund Request does not increase submitted-fund totals.
2. A submitted but unapproved Fund Request does not increase allocated funds.
3. An HO-approved allocation produces the appropriate positive ZO ledger movement.
4. An authorized unpaid requisition increases commitment but not paid.
5. A partially paid Accounts requisition only retains the surviving paid/committed amount according to the canonical lifecycle.
6. An Accounts-rejected payment leaves no surviving financial commitment.
7. A direct ZO payment reduces ZO cash once.
8. An Accounts-routed payment does not automatically reduce ZO cash.
9. An accepted excess return decreases ZO cash once.
10. Running ZO balance is calculated from complete history before report-period filtering.
11. Current budget utilization uses sanctioned budget.
12. ₹ overrun and % overrun use the same denominator.
13. Latest official physical progress comes from the latest Approved DPR.
14. Reporting freshness comes from the latest submitted DPR.
15. `agency_payment` is never presented as a client recovery unless a real recovery source is introduced.
16. A global activity-period filter never erases current stock metrics merely because their source rows were created outside the range.

---

# 18. Rule for future development

Before adding or changing an analytics field, answer all four questions:

1. **What exact business event or state does this field represent?**
2. **What is its authoritative source?**
3. **Is it a stock or a flow?**
4. **Which timestamp defines it?**

If those four answers are not clear, the metric is not ready to be added to analytics.
