# Subcontractor Ledger Accumulation Logic & Export Inconsistency Report

**Document Version:** 1.0.0  
**Date:** September 6, 2026  
**Auditor:** Antigravity Engineering & QA Pair  
**Subsystem:** Subcontractor Ledger, Cost Estimates, Requisitions, and Reporting (`047_subcontractor_ledger.sql`)  
**Scope:** Database Schema, RPC Functions, Backend Controllers, Frontend Views, Excel Export Utilities  

---

## Executive Summary

The Subcontractor Ledger subsystem was introduced to provide project-level tracking of work assigned to external sub-contractors. The system is designed around a dual-table architecture:
1. `subcontractor_balances`: A state table persisting the running balance per `(work_order_no, material_main_head, material_sub_head, material_details)` tuple, tracking `estimated_total`, `paid_total`, and `available_balance`.
2. `subcontractor_ledger`: An append-only audit trail logging signed transactions (`ESTIMATE_ITEM_APPROVAL` credits and `REQUISITION_APPROVAL` debits).

An end-to-end technical investigation across the database schema, stored procedures, API controllers, frontend state management, and export helpers revealed **10 distinct data inconsistency gaps and structural vulnerabilities**. These issues lead to silent balance drift, locked projects, premature credits on rejected estimates, missing historical records, and severe data skew during Excel exports under filtered views.

---

## Vulnerability & Inconsistency Matrix

| ID | Finding | Severity | Layer | Impact |
|:---|:---|:---:|:---:|:---|
| **GAP-01** | Historical Data Blindspot (Zero Accumulation for Pre-Migration Estimates) | **CRITICAL** | Database / Migration | Historical projects have 0 balance; Requisitions immediately fail with `BUD03` |
| **GAP-02** | Premature Credit Accumulation on Rejected/Abandoned Estimates | **HIGH** | Database / RPC | Line-item approval credits balance before overall estimate is approved; credit persists on rejection |
| **GAP-03** | Approval Sequence Anomaly (Direct HO Approval Bypasses Ledger Credit) | **HIGH** | Database / RPC | Out-of-order approval (HO before ZO) permanently skips ledger credit hook |
| **GAP-04** | Reopen Estimate Budget Divergence (Main Head vs Subcontractor Balance) | **HIGH** | Backend / Workflow | Reopening deducts main head budget to 0 but leaves subcontractor balances intact; conflicting states |
| **GAP-05** | Case-Sensitivity & Whitespace Collisions (Silent Subcontractor Forking) | **MEDIUM** | DB / PKEY | Trailing spaces or casing variations create split balance rows and false `BUD03` errors |
| **GAP-06** | Cancelled Requisitions Leave `paid_total` and `available_balance` Debited | **HIGH** | Backend / RPC | Cancelling an approved requisition fails to refund capacity back to `available_balance` |
| **GAP-07** | UI Summary Cards Accumulate Cancelled Requisitions | **MEDIUM** | Frontend | Requisition total on UI group headers sums cancelled requisitions, displaying inflated figures |
| **GAP-08** | Absence of Manual Adjustment / Re-Alignment RPC | **MEDIUM** | Architecture | No administrative correction mechanism exists to resolve unavoidable drift or discrepancies |
| **GAP-09** | Missing Core Accounting Invariant Constraint | **MEDIUM** | Database Schema | Table checks non-negativity but lacks `CHECK (available_balance = estimated_total - paid_total)` |
| **GAP-10** | Excel Export Inconsistencies Under Filtered Views | **HIGH** | Frontend / Backend / Export | Timezone boundary shifts, date semantics mismatch, search asymmetry, and inflated sums |

---

## Detailed Findings & Failure Modes

---

### GAP-01: Historical Data Blindspot (Zero Accumulation for Pre-Migration Estimates)

* **Location:** [`backend/src/db/migrations/047_subcontractor_ledger.sql`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql)
* **Severity:** **CRITICAL**

#### Root Cause Analysis
Migration `047` creates `subcontractor_balances` and `subcontractor_ledger` along with triggers on `submit_row_approvals` and `approve_requisition_transact`. However, **the migration contains no backfill script** for existing estimates and requisitions.

#### Failure Mode
For any work order whose Cost Estimate achieved `Final Approved` status prior to migration `047`:
1. `subcontractor_balances` contains 0 rows for that work order.
2. When a JE attempts to raise a requisition against this subcontractor, [`create_requisition_secure`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L355-L359) executes:
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
3. The JE receives an unrecoverable `BUD03` exception, completely blocking project operations.
4. On the Subcontractor Ledger browse screen, active projects show no balances.

#### Remediation
Deploy a one-time idempotent backfill migration that aggregates all existing `Final Approved` cost estimate items with `material_main_head = 'Sub Contractor'`, credits `subcontractor_balances`, subtracts any historically approved requisitions, and writes the initial baseline into `subcontractor_ledger`.

---

### GAP-02: Premature Credit Accumulation on Rejected or Abandoned Estimates

* **Location:** [`047_subcontractor_ledger.sql:submit_row_approvals`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L85-L168)
* **Severity:** **HIGH**

#### Root Cause Analysis
In `submit_row_approvals`, credits to `subcontractor_balances` happen immediately at the individual line-item level when HO marks an item as `Approve`:
```sql
IF p_stage = 'HO' AND v_approve_status = 'Approve' AND v_item.zo_office_approve = 'Approve'
   AND (v_prev_ho_approve IS NULL OR v_prev_ho_approve <> 'Approve') THEN
  -- Credits subcontractor_balances and inserts into subcontractor_ledger
END IF;
```
This credit lands **before** the overall estimate header transitions to `Final Approved`.

#### Failure Mode
1. HO approves line items 1 and 2 for Subcontractor "ABC Plumbing", immediately crediting ₹1,00,000 into `subcontractor_balances`.
2. HO subsequently rejects the overall estimate, or ZO marks the estimate as rejected/cancelled, or the estimate is abandoned.
3. The credit remains permanently committed in `subcontractor_balances`.
4. A JE can now raise and pass a Requisition against this unapproved, rejected estimate line item because `subcontractor_balances` reports an available balance.

#### Remediation
Either:
- Defer the ledger credit hook until the estimate header transitions to `Final Approved` (recommended), or
- Implement a compensating reversal transaction in `subcontractor_ledger` whenever an estimate transitions to `Rejected`.

---

### GAP-03: Approval Sequence Anomaly (Direct HO Approval Bypasses Ledger Credit)

* **Location:** [`047_subcontractor_ledger.sql:submit_row_approvals`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L125-L165)
* **Severity:** **HIGH**

#### Root Cause Analysis
The credit condition in `submit_row_approvals` requires both `p_stage = 'HO'` AND `v_item.zo_office_approve = 'Approve'`:
```sql
IF p_stage = 'HO' AND v_approve_status = 'Approve' AND v_item.zo_office_approve = 'Approve' THEN ...
```
If an HO user approves a row before the ZO has approved it (or while ZO is `Pending`), the condition evaluates to `FALSE`, so no balance row is credited. 
Crucially, when the ZO user subsequently approves that row via `submit_row_approvals(p_stage => 'ZO')`, **there is no ledger credit block under the `ZO` stage**.

#### Failure Mode
1. Row approval lands out of order: HO marks `Approve`, ZO later marks `Approve`.
2. The row has `ho_office_approve = 'Approve'` and `zo_office_approve = 'Approve'`, yet `subcontractor_balances` received **zero credit**.
3. When the estimate is finalized, the subcontractor's balance remains 0. Requisitions fail with `BUD03` or insufficient balance.

#### Remediation
1. Enforce strict sequential approval: Disallow HO approval in `submit_row_approvals` if `zo_office_approve <> 'Approve'`.
2. Add a dual check in `submit_row_approvals`: If `p_stage = 'ZO'` and `v_item.ho_office_approve = 'Approve'`, execute the credit hook.

---

### GAP-04: Reopen Estimate Budget Divergence (Main Head vs Subcontractor Balance)

* **Location:** [`backend/src/controllers/estimates.workflow.controller.js:reopenEstimate`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/estimates.workflow.controller.js) & [`computeMainHeadCapacity`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/requisitions.controller.js)
* **Severity:** **HIGH**

#### Root Cause Analysis
When an estimate is reopened to add items or adjust figures:
1. `reopenEstimate` resets `projects_master.main_head_budgets['Sub Contractor']` by deducting the previous estimate's approved amount down to zero or base delta.
2. However, `subcontractor_balances` preserves its existing balance (because line items are not deleted upon reopen).

#### Failure Mode
1. A project has an approved Subcontractor line item of ₹5,00,000.
2. The project estimate is reopened for revision.
3. A JE creates a requisition against the subcontractor. The subcontractor balance card reports: `Available: ₹5,00,000`.
4. The JE submits the requisition. The backend throws an error: `BUD01: Exceeds Main Head Capacity for Sub Contractor`.
5. The UI is in direct contradiction: the Subcontractor capacity card indicates sufficient funds, while the submission fails on the parent category capacity.

#### Remediation
Maintain consistent capacity definitions: if `reopenEstimate` deducts allocated main head budgets, it must either lock requisition creation across the entire work order during reopen, or maintain existing capacity snapshots until new revisions are submitted.

---

### GAP-05: Case-Sensitivity & Whitespace Collisions (Silent Subcontractor Forking)

* **Location:** [`047_subcontractor_ledger.sql:subcontractor_balances`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L49)
* **Severity:** **MEDIUM**

#### Root Cause Analysis
The primary key of `subcontractor_balances` is:
```sql
CONSTRAINT "subcontractor_balances_pkey" 
PRIMARY KEY (work_order_no, material_main_head, material_sub_head, material_details)
```
PostgreSQL string comparisons on `character varying` are case-sensitive and whitespace-sensitive. Neither `submit_row_approvals` nor `create_requisition_secure` enforces string normalization (e.g., `TRIM()`).

#### Failure Mode
1. Estimate item is entered with a trailing space: `"ABC Enterprises "`.
2. `subcontractor_balances` creates a row for `("WO-101", "Sub Contractor", "Plumbing", "ABC Enterprises ")`.
3. The JE enters a requisition selecting `"ABC Enterprises"` (trimmed).
4. `create_requisition_secure` looks for `("WO-101", "Sub Contractor", "Plumbing", "ABC Enterprises")` and fails with `BUD03: No Subcontractor Ledger balance found`.
5. If the casing varies (`"abc enterprises"` vs `"ABC Enterprises"`), two separate balance rows are created for the same contractor on the same work order.

#### Remediation
Add `TRIM()` normalization across all RPC functions (`submit_row_approvals`, `create_requisition_secure`, `approve_requisition_transact`) and backend controllers.

---

### GAP-06: Cancelled Requisitions Leave `paid_total` and `available_balance` Debited

* **Location:** [`backend/src/controllers/requisitions.controller.js:cancelRequisition`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/requisitions.controller.js) & [`047_subcontractor_ledger.sql`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql)
* **Severity:** **HIGH**

#### Root Cause Analysis
When an approved or submitted requisition is cancelled via `cancelRequisition` or `cancel_requisition_transact`, there is no hook to restore the subcontractor's balance.

#### Failure Mode
1. Requisition for ₹50,000 against Subcontractor "XYZ" is approved.
2. `subcontractor_balances.paid_total` increments by ₹50,000 and `available_balance` decrements by ₹50,000.
3. Due to administrative reasons or vendor change, the requisition is cancelled.
4. `requisitions.requisition_status` is updated to `'Cancelled'`.
5. No refund transaction is posted to `subcontractor_ledger`, and `subcontractor_balances.available_balance` remains permanently reduced by ₹50,000.
6. The funds are permanently leaked and unavailable for future requisitions.

#### Remediation
Implement a cancellation credit hook in `cancel_requisition_transact`:
```sql
UPDATE subcontractor_balances
SET paid_total = paid_total - v_req.approved_amount,
    available_balance = available_balance + v_req.approved_amount,
    updated_at = now()
WHERE work_order_no = v_req.work_order_no
  AND material_sub_head = v_req.material_sub_head
  AND material_details = v_req.material_details;

INSERT INTO subcontractor_ledger (
  work_order_no, material_sub_head, material_details,
  transaction_type, reference_type, reference_id, amount, created_by
) VALUES (
  v_req.work_order_no, v_req.material_sub_head, v_req.material_details,
  'REQUISITION_CANCELLATION', 'REQUISITION', v_req.requisition_id, v_req.approved_amount, p_cancelled_by
);
```

---

### GAP-07: UI Summary Cards Accumulate Cancelled Requisitions

* **Location:** [`frontend/src/pages/SubcontractorLedger.jsx:L258-L259`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/SubcontractorLedger.jsx#L258-L259)
* **Severity:** **MEDIUM**

#### Root Cause Analysis
In `SubcontractorLedger.jsx`, the summary totals displayed in each subcontractor card header are computed as:
```javascript
const totalRequisitioned = group.rows.reduce((sum, r) => sum + Number(r.requisition_amount || 0), 0);
const totalApproved = group.rows.reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);
```
There is no condition checking `r.requisition_status`.

#### Failure Mode
1. A subcontractor had 3 requisitions of ₹1,00,000 each: 1 Approved, 2 Cancelled.
2. The UI header card displays: `Requisitioned: ₹ 3,00,000 | Approved: ₹ 1,00,000`.
3. Reviewers and accountants are misled into believing ₹3,00,000 of work has been requested, when in reality ₹2,00,000 was cancelled.

#### Remediation
Filter out cancelled and rejected items:
```javascript
const activeRows = group.rows.filter(r => r.requisition_status !== 'Cancelled' && r.requisition_status !== 'Rejected');
const totalRequisitioned = activeRows.reduce((sum, r) => sum + Number(r.requisition_amount || 0), 0);
const totalApproved = activeRows.reduce((sum, r) => sum + Number(r.approved_amount || 0), 0);
```

---

### GAP-08: Absence of Manual Adjustment / Re-Alignment RPC

* **Location:** Database Schema / Architecture
* **Severity:** **MEDIUM**

#### Root Cause Analysis
In contrast to the Credit Ledger (`credit_ledger`), which includes `adjust_credit_ledger_balance_transact` (Migration `044`) and an "Adjust Balance" modal for HO/Admin to resolve bank reconciliation or rounding errors, the Subcontractor Ledger has no administrative adjustment mechanism.

#### Failure Mode
If drift occurs due to historical data omissions, cancelled orders, or manual database corrections, there is no mechanism to re-synchronize `subcontractor_balances` with reality. Any manual SQL edit risks breaking the audit trail.

#### Remediation
Create an RPC function `adjust_subcontractor_balance_transact` accepting `(p_work_order_no, p_sub_head, p_details, p_new_balance, p_reason, p_modified_by)` that logs an `ADMIN_ADJUSTMENT` audit entry and updates `subcontractor_balances`.

---

### GAP-09: Missing Core Accounting Invariant Constraint

* **Location:** [`047_subcontractor_ledger.sql:subcontractor_balances`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/db/migrations/047_subcontractor_ledger.sql#L51-L52)
* **Severity:** **MEDIUM**

#### Root Cause Analysis
The table checks:
```sql
CONSTRAINT "chk_scb_available_nonneg" CHECK (available_balance >= 0),
CONSTRAINT "chk_scb_paid_nonneg" CHECK (paid_total >= 0)
```
However, it does NOT enforce the core accounting invariant:
```sql
CONSTRAINT "chk_scb_balance_identity" CHECK (available_balance = estimated_total - paid_total)
```

#### Failure Mode
Because `estimated_total` is modified by `submit_row_approvals` and `paid_total` is modified by `approve_requisition_transact`, any missed row lock, concurrency glitch, or direct table modification can cause `available_balance` to diverge from `estimated_total - paid_total` without the database raising an error.

#### Remediation
Add the check constraint to `subcontractor_balances`:
```sql
ALTER TABLE subcontractor_balances 
ADD CONSTRAINT chk_scb_balance_identity 
CHECK (available_balance = estimated_total - paid_total);
```

---

### GAP-10: Excel Export Inconsistencies Under Filtered Views

* **Locations:**
  * Frontend UI: [`frontend/src/pages/SubcontractorLedger.jsx:L40-L98`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/pages/SubcontractorLedger.jsx#L40-L98)
  * Export Utility: [`frontend/src/utils/exportHelpers.js:L285-L313`](file:///home/zenoguy/Desktop/projects/SNPolymers/frontend/src/utils/exportHelpers.js#L285-L313)
  * Backend Controller: [`backend/src/controllers/requisitions.controller.js:L881-L921`](file:///home/zenoguy/Desktop/projects/SNPolymers/backend/src/controllers/requisitions.controller.js#L881-L921)
* **Severity:** **HIGH**

#### Detailed Gaps & Failure Modes:

#### A. Timezone Boundary Clipping on Date Range Filters
* **Mechanism:**
  In `SubcontractorLedger.jsx`, the `<input type="date">` elements emit bare dates (`YYYY-MM-DD`). In `requisitions.controller.js`:
  ```javascript
  if (query.date_from) {
    dbQuery = dbQuery.gte('created_at', query.date_from);
  }
  if (query.date_to) {
    dbQuery = dbQuery.lte('created_at', `${query.date_to}T23:59:59.999`);
  }
  ```
  In PostgreSQL, querying a `timestamptz` column with an un-offset string treats the value as UTC (`00:00:00+00`).
* **Failure Mode:**
  - In India (UTC+05:30), `00:00:00 UTC` is `05:30:00 AM IST`.
  - Requisitions created between **12:00 AM and 05:30 AM IST on the start date** have UTC timestamps on the preceding day and are **omitted** from the export.
  - On the end date, `${query.date_to}T23:59:59.999` in UTC translates to `05:29:59.999 AM IST` the **following day**. Requisitions created early next morning are **mistakenly included**.
  - In the exported Excel spreadsheet, the `"Created"` column displays dates outside the filtered range (e.g. shows `02/09/2026` when `date_to` was `2026-09-01`).

#### B. Filter Semantic Mismatch (Creation Date vs Approval Date)
* **Mechanism:**
  The export file includes two date columns:
  - `"Created"` (`r.created_at`)
  - `"Approved On"` (`r.payment_date`)
  However, the UI date inputs only filter `created_at`.
* **Failure Mode:**
  When accounts teams generate an Excel report for a financial period (e.g. Month of August) to audit subcontractor disbursements, the filter selects when the requisition was first typed rather than when it was approved. Requisitions drafted in July but approved in August are missing, while unapproved drafts created in August are included.

#### C. Search Filter Discrepancy Between Tabs
* **Mechanism:**
  - On the **Balances** tab, `getSubcontractorLedger` checks:
    ```javascript
    b.material_sub_head?.toLowerCase().includes(term) ||
    b.material_details?.toLowerCase().includes(term) ||
    b.work_order_no?.toLowerCase().includes(term)
    ```
  - On the **Requisitions** tab (which feeds the Excel export), `getSubcontractorRequisitions` checks only:
    ```javascript
    r.material_sub_head?.toLowerCase().includes(term) ||
    r.material_details?.toLowerCase().includes(term)
    ```
* **Failure Mode:**
  If a user types a work order number into the search box:
  1. The user sees matching balances on the Balances tab.
  2. The user switches to the Requisitions tab to export the data.
  3. The list drops to 0 rows, and the export produces an empty spreadsheet or is disabled.

#### D. Cancelled Requisitions Distorting Sums in Export
* **Mechanism:**
  `exportSubcontractorRequisitionsToExcel` writes all requisitions directly into the sheet:
  ```javascript
  "Requisition Amount (INR)": r.requisition_amount || 0,
  "Approved Amount (INR)": r.approved_amount || 0,
  "Status": r.requisition_status || '',
  ```
* **Failure Mode:**
  Unlike the web UI where rows have visual badges (`emerald`, `red`, `amber`), Excel is an unformatted data sheet. When an accountant applies `=SUM(F:F)` to calculate total requisitioned liabilities, cancelled and rejected amounts are added together with active amounts, producing an inflated, incorrect financial total.

#### E. Absence of Ledger Balances & Filter Audit Metadata
* **Mechanism:**
  The export outputs a flat list of requisitions without:
  - The actual running balances (`estimated_total`, `paid_total`, `available_balance`).
  - Active filter parameters (Work Order No., Search Term, Date Range).
  - An export option on the primary **Balances** tab.
* **Failure Mode:**
  Anyone reviewing the exported spreadsheet cannot verify what filter constraints produced the dataset, nor can they see the remaining balance capacity for the subcontractor on that work order.

---

## Actionable Remediation Plan

### Phase 1: Database Migration (P0 - Immediate)
1. **Historical Backfill Script:** Aggregate approved estimate items and requisitions to populate `subcontractor_balances` and baseline `subcontractor_ledger` entries.
2. **String Trimming:** Wrap `TRIM()` around all `material_sub_head` and `material_details` inputs in `submit_row_approvals`, `create_requisition_secure`, and `approve_requisition_transact`.
3. **Requisition Cancellation Hook:** Add reversal logic in `cancel_requisition_transact` to refund `available_balance` and decrement `paid_total`.
4. **Accounting Invariant:** Apply `CHECK (available_balance = estimated_total - paid_total)`.

### Phase 2: Backend API Refinements (P1 - Near-Term)
1. **Timezone Standardization:** Adjust `date_from` and `date_to` parsing in `getSubcontractorRequisitions` to enforce IST bounds:
   ```javascript
   if (query.date_from) {
     dbQuery = dbQuery.gte('created_at', `${query.date_from}T00:00:00+05:30`);
   }
   if (query.date_to) {
     dbQuery = dbQuery.lte('created_at', `${query.date_to}T23:59:59.999+05:30`);
   }
   ```
2. **Align Search Fields:** Add `r.work_order_no` and `r.requisition_no` to the search term filtering in `getSubcontractorRequisitions`.
3. **Approval Status Filter:** Support `?status=` query parameter on `getSubcontractorRequisitions`.

### Phase 3: Frontend & Export Enhancement (P1 - Near-Term)
1. **Export Balances Option:** Add an "Export to Excel" button on the **Balances** tab using a new `exportSubcontractorBalancesToExcel` helper.
2. **Filter Out Cancelled Requisitions in UI:** Update header card totals in `SubcontractorLedger.jsx` to exclude `Cancelled` items.
3. **Metadata & Status Separation in Export:** Include an audit summary header in the exported Excel workbook displaying the active filters, and separate or flag cancelled requisitions.
