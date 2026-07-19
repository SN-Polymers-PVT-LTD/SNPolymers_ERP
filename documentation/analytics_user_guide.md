# SN Polymers ERP Analytics: Risk Scoring & Anomaly Detection Guide

This document provides a detailed breakdown of the calculations, scoring logic, and anomaly detection algorithms utilized in the SN Polymers ERP Analytics & Dashboard engine.

---

## 1. Project Health Score Calculation
The project health score is a precomputed metric compiled inside the `project_health_mv` database view. The score ranges from **0 to 100** and determines the overall **Health Status** of a project:
* 🟢 **Healthy**: Health Score $\ge$ 80
* 🟡 **Warning**: Health Score $\ge$ 50 and < 80
* 🔴 **Critical**: Health Score < 50

The overall Health Score is computed as the sum of five distinct components:

$$\text{Health Score} = \text{Budget Score} + \text{Progress Score} + \text{Approval Score} + \text{Reporting Score} + \text{Material Score}$$

### Component-wise Scoring Weights:

| Component | Maximum Weight | Focus Area |
| :--- | :---: | :--- |
| **Budget Score** | 40 points | Requisition spending relative to the Work Order value. |
| **Progress Score** | 20 points | Physical progress velocity vs baseline timeline. |
| **Approval Score** | 15 points | Speed of review processes and pending items count. |
| **Reporting Score** | 15 points | Recency of Daily Progress Reports (DPR). |
| **Material Score** | 10 points | Deviation from estimated bill of materials. |

---

### Component Formulas & Logical Rules:

#### A. Budget Score (Max: 40 points)
Calculated by comparing the total approved requisitions amount against the baseline Work Order value:
* **Ratio $\le$ 80%**: Full **40 points** (Spending is within safe thresholds).
* **Ratio between 80% and 100%**: Linear deduction from **40 down to 20 points**.
* **Ratio between 100% and 120%**: Linear deduction from **20 down to 0 points**.
* **Ratio > 120%**: **0 points** (Significant budget overrun).

#### B. Progress Score (Max: 20 points)
Calculates if physical progress is keeping pace with calendar time elapsed:
* First, the calendar elapsed percentage is calculated: 
  $$\text{Calendar Elapsed \%} = \frac{\text{Current Date} - \text{Project Start Date}}{\text{Project End Date} - \text{Project Start Date}} \times 100$$
* The **Progress Score** is then calculated by subtracting the delay (Calendar Elapsed % - Physical Progress %) from the maximum weight:
  $$\text{Progress Score} = \max\left(0, \min\left(20, 20 - \frac{\max(0, \text{Calendar Elapsed \%} - \text{Physical Progress \%})}{100} \times 20\right)\right)$$
* If the project is ahead of or matches schedule, it receives the full **20 points**.

#### C. Approval Score (Max: 15 points)
Penalizes projects with bottlenecked approvals (pending estimates or requisitions):
* Computes the count of all unresolved entities:
  * Requisitions in `'Pending'` status.
  * Cost Estimates in `'Submitted'`, `'Under ZO Review'`, or `'Under HO Review'` status.
* **SLA Deduction**: Loses **3 points** for every pending item, down to a minimum of **0 points**.

#### D. Reporting Score (Max: 15 points)
Measures the frequency and reliability of JEs filing site updates:
* **$\le$ 1 day** since last Daily Progress Report (DPR): **15 points**.
* **$\le$ 3 days**: **10 points**.
* **$\le$ 7 days**: **5 points**.
* **> 7 days**: **0 points** (Stalled reporting).

#### E. Material Score (Max: 10 points)
Determines if material requisitions match the estimated heads:
* Compares the approved requisitions per material head against final estimate items to find the average variance percentage:
  * Average Variance **$\le$ 5%**: **10 points** (Highly accurate).
  * Average Variance **$\le$ 15%**: **5 points** (Moderate variance).
  * Average Variance **> 15%**: **0 points** (High variance).

---

## 2. Budget Leakage & Anomaly Detection
Anomalies are detected using the `budget_leakage_mv` materialized view, which aggregates four structural risk factors to compute an **Anomaly Score** ranging from **0 to 8**:

$$\text{Anomaly Score} = \text{Overrun Weight} + \text{Request Weight} + \text{Revision Weight} + \text{Stall Weight}$$

### Anomaly Indicators & Weights:

| Indicator | Condition | Anomaly Weight | Description |
| :--- | :--- | :---: | :--- |
| **Budget Overrun** | Approved Requisitions > Work Order Value | **3 points** | Project is spending more than its allocated budget. |
| **Repeated Fund Requests** | Mapped Fund Requests > 3 | **2 points** | Site demands recurrent cash injections. |
| **Excessive Revisions** | Total Cost Estimate Revisions > 3 | **1 point** | Frequent scope changes or estimate re-submissions. |
| **Stalled Progress** | No DPR for > 7 days & Physical Progress < 100% | **2 points** | Reporting has halted while project is incomplete. |

### Severity Categorization:
* 🔴 **Critical Anomaly** (Score $\ge$ 4): Flagged for immediate executive audit.
* 🟡 **Warning Anomaly** (Score $\ge$ 1 and < 4): Monitored for potential issues.
* ⚪ **No Anomalies** (Score = 0): Safe status.

---

## 3. Zonal Performance & SLA Benchmarking
The system ranks regional zones using performance aggregations within the `zone_performance_mv` view:
* **Budget Utilization**: Compares total spent against total budget.
* **Delayed Projects**: Count of active running projects past their baseline end date where physical progress is less than 100%.
* **SLA Breach Tracking** (`approval_sla_mv`): Measures execution durations against standardized hours:
  * **JE submission to ZO approval of Estimates**: SLA Limit = **48 hours**.
  * **ZO approval to HO approval of Estimates**: SLA Limit = **72 hours**.
  * **Requisition creation to Payment Date**: SLA Limit = **48 hours**.
  * **Fund Request submission to HO approval**: SLA Limit = **72 hours**.

---

## 4. Resource Productivity Streaks
The system tracks the reporting discipline of JEs within the `resource_utilization_mv` view:
* **Daily Streaks**: Tracks consecutive days on which the JE submits progress updates. If a day is missed, the streak resets to `0`.
* **Workload Load Factor**: Compares the assigned projects count for each JE to identify resource over-allocation or bottlenecks.
