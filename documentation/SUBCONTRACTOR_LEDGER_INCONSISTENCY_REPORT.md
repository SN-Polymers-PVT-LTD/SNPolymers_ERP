# Subcontractor Ledger Audit & Inconsistency Verification Report

**Document Version:** 2.0.0 (Post-Verification & Codebase Audit)  
**Date:** September 6, 2026  
**Auditors:** Engineering & QA Review Pair  
**Subsystem:** Subcontractor Ledger, Cost Estimates, Requisitions, and Reporting (`047_subcontractor_ledger.sql`)  
**Scope:** Database Schema, RPC Functions, Backend Controllers, State Machine Guards, Frontend Views, Excel Export Utilities  

---

## Executive Summary & Audit Overview

Following a line-by-line verification against the actual backend controllers, database stored procedures, and state-machine guards, the initial findings have been qualified and calibrated. Rather than an unqualified list of "10 confirmed critical vulnerabilities", this verified report separates:
1. **P0 Genuine Blockers & Invariant Failures** that threaten ledger correctness in production.
2. **P1 Accounting & Workflow Invariants** requiring architectural alignment before relying on the ledger for financial reporting.
3. **P2 Operational & Presentation Improvements** for UI clarity and reconciliation tooling.
4. **Retracted / Disproven Claims** (specifically regarding requisition cancellation) that do not apply under the existing codebase guards.

---

## Verified Audit & Triage Matrix

| ID | Finding | Classification | Layer | Verified Production Status |
|:---|:---|:---:|:---:|:---|
| **GAP-01** | Historical Data Blindspot (Zero Accumulation for Pre-Migration Estimates) | 🔴 **P0 (Critical Blocker)** | DB / Migration | **Confirmed Real Blocker.** Migration 047 lacks backfill. Active projects fail with `BUD03`. |
| **GAP-02** | Line-Item Credit vs Terminal Header Rejection Decoupling | 🟠 **P1 (Design Invariant)** | DB / RPC Workflow | **Confirmed.** Line-item credit is by design for top-ups, BUT `submit_ho_review` rejection leaves orphaned ledger credits. |
| **GAP-03** | Direct RPC Out-of-Order Approval Permanently Skipping Credit | 🔴 **P0 (DB Invariant)** | Database / RPC | **Confirmed at RPC Level.** Express API guards order, but `submit_row_approvals` RPC lacks status guards, allowing out-of-order approval to permanently skip credit. |
| **GAP-04** | Reopen Lifecycle Capacity Model Alignment (Main Head vs Subcontractor) | 🟠 **P1 (Workflow Invariant)** | Service / Lifecycle | **Confirmed Design Divergence.** `computeMainHeadCapacity` requires `Final Approved` (drops to 0 on reopen), while subcontractor balance persists. Requires Model A vs Model B decision. |
| **GAP-05** | String Whitespace & Casing Collisions (Silent Subcontractor Forking) | 🟠 **P1 (Data Integrity)** | DB / Boundary | **Confirmed.** Postgres composite PKEY distinguishes casing and spaces. Canonical normalization needed at boundary. |
| **GAP-06** | Approved Requisition Cancellation Refund | ❌ **RETRACTED / INVALID** | Backend Guard | **Disproven.** Backend explicitly forbids cancelling `Approved` requisitions (`403 Forbidden`). `Pending`/`Hold` items never debited the ledger. |
| **GAP-07** | UI Group Summary Cards Summing Cancelled Requisitions | 🟡 **P2 (Presentation Bug)** | Frontend | **Confirmed.** Group card headers compute `reduce()` over raw rows without status filtering. Balance is safe, but presentation is misleading. |
| **GAP-08** | Absence of Administrative Reconciliation / Adjustment RPC | 🟡 **P2 (Operational Tooling)** | Architecture | **Confirmed Gap.** Not an active bug, but a necessary operational capability for edge-case repair. |
| **GAP-09** | Defense-in-Depth Accounting Invariant (`available = estimated - paid`) | 🟠 **P1 (Hardening)** | DB Schema | **Confirmed Hardening.** Sensible database-level check constraint; does not replace transaction locking. |
| **GAP-10A** | Export Date Range: UTC vs. IST Timezone Boundary Clipping | 🟠 **P1 (Data Skew)** | Backend / Query | **Confirmed.** Un-offset ISO dates in Postgres evaluate to UTC `00:00:00`, clipping 12:00 AM–5:30 AM IST on start dates and leaking records on end dates. |
| **GAP-10B** | Export Date Range: Creation Date vs Approval Date Ambiguity | 🟠 **P1 (Semantics)** | Query / API | **Confirmed.** Date filters query `created_at` (draft submission) instead of `payment_date` (ledger debit timestamp). |
| **GAP-10C** | Search Filter Asymmetry Between Tabs | 🟠 **P1 (UX / Query)** | Backend Controller | **Confirmed.** Balances tab searches `work_order_no`, while Requisitions tab (and export) excludes it. Searching a WO number produces an empty export. |
| **GAP-10D** | Excel Export: Cancelled Rows Segregation & Column Sums | 🟡 **P2 (Presentation)** | Export Utility | **Confirmed.** Raw export includes cancelled items with full amount. Excel `=SUM()` formulas include cancelled requests unless filtered. |
| **GAP-10E** | Missing Balance Context & Metadata; No Balances Tab Export | 🟡 **P2 (Feature Gap)** | Frontend / Export | **Confirmed.** Export omits running balance columns, drops filter metadata, and has no export button on the Balances tab. |

---

## Detailed Technical Verification

---

### GAP-01: Historical Data Blindspot (Zero Accumulation for Pre-Migration Estimates)
* **Status:** 🔴 **Confirmed P0 Blocker**
* **Location:** [`backend/src/db/migrations/047_subcontractor_ledger.sql`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql)

#### Code Verification
Migration `047` creates `subcontractor_balances` and `subcontractor_ledger` and attaches triggers to `submit_row_approvals` and `approve_requisition_transact`. 
However, **it contains no DML/backfill queries**.
In [`create_requisition_secure`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L355-L359):
```sql
SELECT available_balance INTO v_sc_available
FROM subcontractor_balances
WHERE work_order_no = p_work_order_no
  AND material_main_head = 'Sub Contractor'
  AND material_sub_head = p_material_sub_head
  AND material_details = p_material_details;

IF NOT FOUND THEN
  RAISE EXCEPTION 'BUD03: No Subcontractor Ledger balance found for Work Order %, Sub Head %, Subcontractor %.',
    p_work_order_no, p_material_sub_head, p_material_details;
END IF;
```
#### Impact
Any project approved prior to migration `047` has zero rows in `subcontractor_balances`. When JEs attempt to raise a requisition against an existing approved subcontractor, the procedure raises `BUD03`. This is an immediate operational blocker on existing databases.

#### Remediation
Execute an idempotent backfill migration aggregating historical `Final Approved` cost estimate items with `material_main_head = 'Sub Contractor'`, populating `subcontractor_balances`, deducting historical approved requisitions, and inserting baseline rows into `subcontractor_ledger`.

---

### GAP-02: Approval-State Coupling Invariant (Line-Item Credit vs Terminal Header Rejection)
* **Status:** 🟠 **P1 (Design Invariant)**
* **Location:** [`047_subcontractor_ledger.sql:submit_row_approvals`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L189-L209) & [`00_full_schema_dump.sql:submit_ho_review`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/00_full_schema_dump.sql#L1809-L1823)

#### Code Verification & Architectural Reframing
The migration design explicitly intended line-item credits to land during `submit_row_approvals(p_stage => 'HO')` so that estimate reopening top-ups work naturally without custom top-up logic:
> *"HO approval permanently locks the row... and gating here — rather than on the parent estimate reaching Final Approved — is what makes reopen top-ups work for free"* (`047_subcontractor_ledger.sql:L89-L93`).

However, testing the actual state machine reveals a **reachable decoupling bug**:
1. In `submit_row_approvals`, HO approves Row 1 (Subcontractor A, ₹1,00,000). The ledger is immediately credited.
2. In `submit_row_approvals`, HO rejects Row 2 (`ho_office_approve = 'Not Approve'`).
3. HO calls `submit_ho_review`. Because an item was rejected:
   ```sql
   SELECT COUNT(*) INTO v_rejected_count
   FROM project_cost_estimate_items
   WHERE estimate_id = p_estimate_id AND ho_office_approve = 'Not Approve';

   IF v_rejected_count > 0 THEN
     v_target_status := 'Rejected by HO'::estimate_status_enum;
   ```
4. `Rejected by HO` is a **terminal rejected status**. The estimate header is rejected and can never be approved.
5. **The bug:** Row 1's credit of ₹1,00,000 remains permanently committed in `subcontractor_balances`. If the project initiates a new estimate and re-approves Subcontractor A, the balance accumulates twice.

#### Remediation
Establish an explicit invariant:
- If an estimate transitions to `Rejected by HO`, `submit_ho_review` must execute compensating debit transactions in `subcontractor_ledger` for any items that were credited during that review cycle; **or**
- Defer ledger crediting to `submit_ho_review` only when transitioning to `Final Approved`.

---

### GAP-03: Approval Sequence Anomaly (Direct RPC Out-of-Order Execution)
* **Status:** 🔴 **P0 (Database-Level Invariant)**
* **Location:** [`047_subcontractor_ledger.sql:submit_row_approvals`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L122-L198)

#### Code Verification
In the Express API controller ([`estimates.items.controller.js:L311-L323`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/estimates.items.controller.js#L311-L323)), the HTTP layer enforces stage order based on `estimate_status`:
- `Under ZO Review` -> `p_stage = 'ZO'`
- `Under HO Review` -> `p_stage = 'HO'`

However, **the database stored procedure itself contains no such check**:
In `submit_row_approvals`:
```sql
IF p_stage = 'HO' AND v_approve_status = 'Approve' AND v_prev_ho_approve IS DISTINCT FROM 'Approve'::row_approval_enum THEN
  SELECT * INTO v_item FROM project_cost_estimate_items WHERE item_id = v_item_id;

  IF v_item.material_main_head = 'Sub Contractor' AND v_item.zo_office_approve = 'Approve' THEN
    -- Crediting logic here
  END IF;
END IF;
```
If `submit_row_approvals` is invoked with `p_stage = 'HO'` while `zo_office_approve` is still `Pending`/`NULL` (via RPC script, admin console, migration, or integration):
1. `ho_office_approve` is updated to `'Approve'`.
2. Because `v_item.zo_office_approve = 'Approve'` is false, **no credit is posted**.
3. Later, when `p_stage = 'ZO'` runs, `zo_office_approve` becomes `'Approve'`. **There is no credit hook under the ZO stage**.
4. Future calls with `p_stage = 'HO'` skip the credit block because `v_prev_ho_approve` is already `'Approve'`.
5. The row ends up dual-approved, yet `subcontractor_balances` has **permanently lost the credit**.

#### Remediation
Enforce the invariant inside the SQL function itself:
```sql
IF p_stage = 'HO' AND v_status <> 'Under HO Review'::estimate_status_enum THEN
  RAISE EXCEPTION 'HO row approvals can only be submitted when estimate is Under HO Review. Current status: %', v_status;
END IF;
```

---

### GAP-04: Reopen Lifecycle Capacity Model Alignment (Main Head vs Subcontractor)
* **Status:** 🟠 **P1 (Workflow Invariant & UX Alignment)**
* **Location:** [`backend/src/services/mainHeadCapacity.service.js:L13-L20`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/services/mainHeadCapacity.service.js#L13-L20) & [`estimates.workflow.controller.js:reopenEstimate`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/estimates.workflow.controller.js#L827-L845)

#### Code Verification
In `mainHeadCapacity.service.js`:
```javascript
const { data: estimateData } = await supabase
  .from('project_cost_estimates')
  .select('estimate_id')
  .eq('work_order_no', trimmedWo)
  .eq('estimate_status', 'Final Approved')
  .order('estimate_revision', { ascending: false })
  .limit(1)
  .maybeSingle();
```
When an estimate is reopened:
1. `reopenEstimate` transitions `estimate_status` from `'Final Approved'` to `'Estimate Reopened'`.
2. As a result, `computeMainHeadCapacity` finds **no estimate** matching `estimate_status = 'Final Approved'`.
3. `mainHeadEstimate` evaluates to `0`, and `remainingCapacity` evaluates to `<= 0`.
4. However, `subcontractor_balances` preserves its allocated capacity (e.g. `available_balance = ₹5,00,000`).

#### Design Choice Required
The system must explicitly choose between two architectural models:
* **Model A (Strict Freeze during Reopen):** While an estimate is reopened, all requisitions on that work order are frozen. Subcontractor capacity advisory cards should reflect that the project is currently in revision and temporarily locked.
* **Model B (Continuous Operation on Committed Baseline):** `computeMainHeadCapacity` should read the `last_approved_amount` or the latest approved snapshot, allowing existing approved allocations to be drawn down while revision items are being drafted.

---

### GAP-05: String Whitespace & Casing Collisions (Silent Subcontractor Forking)
* **Status:** 🟠 **P1 (Data Integrity)**
* **Location:** [`047_subcontractor_ledger.sql:subcontractor_balances`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L40-L53)

#### Code Verification
The primary key of `subcontractor_balances` is:
```sql
CONSTRAINT "subcontractor_balances_pkey" 
PRIMARY KEY (work_order_no, material_main_head, material_sub_head, material_details)
```
In PostgreSQL, string comparisons distinguish casing and trailing spaces (`'ABC ' <> 'ABC'`).
Neither `submit_row_approvals` nor `create_requisition_secure` normalizes `material_details` or `material_sub_head`.
If an estimate entry contains a trailing space, it creates an isolated balance row. A subsequent requisition with clean input fails with `BUD03: No Subcontractor Ledger balance found`.

#### Remediation
Establish a canonical normalization rule at the boundary:
- Enforce `TRIM()` and clean whitespace in API validation schemas (Zod).
- Wrap `TRIM()` around parameters in all stored procedures before query execution.

---

### GAP-06: [RETRACTED / DISPROVEN] Approved Requisition Cancellation Refund
* **Status:** ❌ **RETRACTED (Codebase Guard Verified)**
* **Location:** [`backend/src/controllers/requisitions.controller.js:L658-L663`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/requisitions.controller.js#L658-L663)

#### Code Verification
The initial hypothesis was that cancelling an approved requisition would fail to refund `paid_total` and `available_balance`.
However, inspecting `cancelRequisition` in `requisitions.controller.js` proves this failure mode **is not reachable**:
```javascript
// Status guard
if (reqRecord.requisition_status !== 'Pending' && reqRecord.requisition_status !== 'Hold') {
  return res.status(403).json({
    success: false,
    message: `Only Pending or Hold requisitions can be cancelled. Current status: ${reqRecord.requisition_status}`
  });
}
```
Furthermore, `approve_requisition_transact` only debits `subcontractor_balances` upon transitioning to `Approved`. Requisitions in `Pending` or `Hold` have **never debited the ledger**.
Because approved requisitions cannot be cancelled, no refund transaction is required or missing. 

> [!NOTE]
> This item is formally retracted as a vulnerability. The state machine guard functions as designed.

---

### GAP-07: UI Group Summary Cards Summing Cancelled Requisitions
* **Status:** 🟡 **P2 (Presentation Bug)**
* **Location:** [`frontend/src/pages/SubcontractorLedger.jsx:L258-L259`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/SubcontractorLedger.jsx#L258-L259)

#### Code Verification
In `SubcontractorLedger.jsx`:
```javascript
const totalRequisitioned = group.rows.reduce((sum, r) => sum + Number(r.requisition_amount || 0), 0);
const totalApproved = group.rows.reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);
```
The calculation performs a simple reduction over `group.rows` without checking `r.requisition_status`. If a subcontractor has 1 approved requisition of ₹50,000 and 2 cancelled requisitions of ₹50,000 each, the card header displays `Requisitioned: ₹ 1,50,000`.
The underlying ledger balances are not affected, but the presentation is misleading.

#### Remediation
Filter active rows before reducing:
```javascript
const activeRows = group.rows.filter(r => r.requisition_status !== 'Cancelled' && r.requisition_status !== 'Rejected');
const totalRequisitioned = activeRows.reduce((sum, r) => sum + Number(r.requisition_amount || 0), 0);
```

---

### GAP-08: Administrative Balance Adjustment & Reconciliation Capability
* **Status:** 🟡 **P2 (Operational Capability)**
* **Location:** Architecture / Stored Procedures

#### Analysis
Migration `044` introduced `adjust_credit_ledger_balance_transact` for the Credit Ledger (`credit_ledger`), providing HO/Admin with a controlled, audited mechanism to resolve discrepancies and bank reconciliation adjustments.
The Subcontractor Ledger currently lacks an equivalent adjustment RPC. If edge-case drift occurs, administrators have no native tool to re-synchronize the ledger without executing ad-hoc SQL updates.

#### Remediation
Implement `adjust_subcontractor_balance_transact(p_work_order_no, p_sub_head, p_details, p_new_balance, p_reason, p_modified_by)` that logs an `ADMIN_ADJUSTMENT` audit entry into `subcontractor_ledger`.

---

### GAP-09: Defense-in-Depth Accounting Invariant
* **Status:** 🟠 **P1 (Hardening)**
* **Location:** [`047_subcontractor_ledger.sql:subcontractor_balances`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L51-L52)

#### Code Verification
`subcontractor_balances` currently enforces:
```sql
CONSTRAINT "chk_scb_available_nonneg" CHECK (available_balance >= 0),
CONSTRAINT "chk_scb_paid_nonneg" CHECK (paid_total >= 0)
```
While row locking and transactional RPCs prevent race conditions, adding a database-level CHECK constraint provides defense-in-depth against invalid manual edits or procedural errors:
```sql
ALTER TABLE subcontractor_balances
ADD CONSTRAINT "chk_scb_accounting_identity"
CHECK (available_balance = estimated_total - paid_total);
```

---

### GAP-10: Excel Export Inconsistencies Under Filtered Views

---

#### GAP-10A: Export Date Range: UTC vs. IST Timezone Boundary Clipping
* **Status:** 🟠 **P1 (Data Skew)**
* **Location:** [`backend/src/controllers/requisitions.controller.js:L893-L898`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/requisitions.controller.js#L893-L898)
* **Verification:**
  ```javascript
  if (query.date_from) dbQuery = dbQuery.gte('created_at', query.date_from);
  if (query.date_to) dbQuery = dbQuery.lte('created_at', `${query.date_to}T23:59:59.999`);
  ```
  In PostgreSQL, querying a `timestamptz` column with an un-offset string treats the value as UTC. In IST (UTC+05:30), UTC `00:00:00` corresponds to `05:30:00 AM IST`.
  - Requisitions created between **12:00 AM and 05:30 AM IST** on the start date have UTC timestamps on the previous day and are **omitted from the export**.
  - Requisitions created early in the morning of the day following `date_to` are **mistakenly included**.
* **Remediation:** Append explicit IST offset (`+05:30`) to boundary parameters:
  `${query.date_from}T00:00:00+05:30` and `${query.date_to}T23:59:59.999+05:30`.

#### GAP-10B: Export Date Range: Creation Date vs Approval Date Ambiguity
* **Status:** 🟠 **P1 (Semantics)**
* **Location:** [`exportHelpers.js:L304-L305`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/utils/exportHelpers.js#L304-L305) & [`requisitions.controller.js:L893-L898`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/requisitions.controller.js#L893-L898)
* **Verification:**
  The export outputs both `"Created"` (`created_at`) and `"Approved On"` (`payment_date`). However, the date filters exclusively query `created_at`. When accounts teams filter for a monthly disbursement period, requisitions drafted in the prior month but approved in the filtered month are omitted.
* **Remediation:** Provide an explicit filter toggle: "Filter by Requisition Date" vs "Filter by Approval Date".

#### GAP-10C: Search Filter Asymmetry Between Tabs
* **Status:** 🟠 **P1 (Query / UX)**
* **Location:** [`requisitions.controller.js:L808-L815`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/requisitions.controller.js#L808-L815) vs [`requisitions.controller.js:L906-L912`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/requisitions.controller.js#L906-L912)
* **Verification:**
  - On the **Balances** tab, `search` matches `material_sub_head`, `material_details`, and `work_order_no`.
  - On the **Requisitions** tab (which feeds the export), `search` matches only `material_sub_head` and `material_details`.
  If a user types a work order number into the search box, the Balances tab displays results, but switching to the Requisitions tab to export yields 0 results.
* **Remediation:** Add `r.work_order_no` and `r.requisition_no` matching to `getSubcontractorRequisitions`.

#### GAP-10D: Excel Export: Cancelled Rows Segregation & Column Sums
* **Status:** 🟡 **P2 (Presentation)**
* **Location:** [`exportHelpers.js:L299-L301`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/utils/exportHelpers.js#L299-L301)
* **Verification:**
  The raw export writes all rows without status segregation. An accountant using `=SUM(F:F)` in Excel inadvertently sums cancelled and rejected amounts into total liabilities. While the status column is present, raw exports should make accounting semantics clearer.
* **Remediation:** Add status filtering options in the UI, or export cancelled items with 0 effective liability in summary calculations.

#### GAP-10E: Missing Balance Context & Metadata; No Balances Tab Export
* **Status:** 🟡 **P2 (Feature Gap)**
* **Location:** [`SubcontractorLedger.jsx:L188-L192`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/SubcontractorLedger.jsx#L188-L192) & [`exportHelpers.js`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/utils/exportHelpers.js)
* **Verification:**
  The export button only exists on the "Requisitions by Subcontractor" tab. The primary "Balances" tab has no export function. Furthermore, the requisition export omits the subcontractor's current `available_balance` and includes no filter metadata header.
* **Remediation:** Add an "Export Balances to Excel" button on the Balances tab, and include filter metadata in exported workbooks.

---

## Actionable Remediation Roadmap

### 🔴 Phase 1: P0 Critical Blockers (Immediate Deployment)
1. **Historical Backfill Migration:** Aggregate pre-migration `Final Approved` cost estimate items with `material_main_head = 'Sub Contractor'` and populate `subcontractor_balances`.
2. **RPC Stage Guard:** Add strict estimate status assertion inside `submit_row_approvals` to prevent out-of-order execution that permanently skips credit.

### 🟠 Phase 2: P1 Accounting & Invariant Hardening (Near-Term)
1. **Estimate Rejection Decoupling:** In `submit_ho_review`, reverse line-item credits if the estimate transitions to `Rejected by HO`.
2. **String Boundary Normalization:** Apply canonical `TRIM()` normalization at the schema validation and RPC entry points.
3. **Reopen Lifecycle Model Decision:** Align `computeMainHeadCapacity` with estimate reopen lifecycle states (Model A vs Model B).
4. **Timezone Offset Enforcement:** Enforce IST timezone boundaries (`+05:30`) in backend date query filters.
5. **Search Field Alignment:** Add `work_order_no` and `requisition_no` to `getSubcontractorRequisitions` search filter.
6. **Accounting Identity Constraint:** Add `CHECK (available_balance = estimated_total - paid_total)` on `subcontractor_balances`.

### 🟡 Phase 3: P2 Operational & Presentation Polish (Next Release)
1. **UI Card Totals:** Exclude `Cancelled` and `Rejected` statuses from group header sums in `SubcontractorLedger.jsx`.
2. **Balances Tab Export:** Implement `exportSubcontractorBalancesToExcel` on the Balances view.
3. **Admin Adjustment RPC:** Create `adjust_subcontractor_balance_transact` for audited ledger corrections.
