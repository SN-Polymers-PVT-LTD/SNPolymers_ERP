# Subcontractor Estimate — Business Rules & Data Semantics

**Project:** SN Polymers ERP  
**Module Owner:** Projects Division  
**Downstream Consumer:** Finance Division  
**Status:** Implementation Baseline  
**Purpose:** Lock the business rules and data semantics before schema, API, UI, and Finance integration work begins.

---

## 1. Objective

The ERP will introduce a dedicated **Subcontractor Estimate** workflow under the **Projects Division**.

The Subcontractor Estimate will define, for a specific Work Order:

- which subcontractor has been approved to perform a subcontract work item,
- the approved quantity,
- the approved rate,
- and the resulting approved monetary value.

The approved subcontractor estimate will feed two downstream systems:

1. the **Project Cost Estimate**, where subcontract work is shown as a consolidated work-level line item, and
2. the existing **Finance-side Payment Requisition / Subcontractor Ledger** flow, where contractor-specific monetary capacity is enforced.

The new design replaces the current practice of treating subcontractors as pseudo-material entries inside the generic Material Master.

---

## 2. Core Business Meaning

### 2.1 Final Approved Subcontractor Estimate

A **Final Approved Subcontractor Estimate** means that the subcontract work has been formally approved for the selected subcontractor.

It is therefore an **approved work assignment / approved subcontract work**, not merely a planning placeholder.

Example:

```text
Work Order: PUR01

Subcontractor: Contractor C
Work: DI Pipe Line Work → 700 mm Pipe Laying
Qty: 400 Mtr
Rate: ₹100 / Mtr
Amount: ₹40,000
Status: Final Approved
```

This means Contractor C has approved authority to perform that work within the approved monetary value.

---

## 3. Ownership by ERP Division

### Projects Division owns

- Subcontractor Master
- Subcontract Work Master
- Work Order-specific Subcontractor Estimates
- Subcontractor Estimate approval workflow
- Subcontractor Estimate revisions
- Subcontractor Estimate reopening
- Aggregation of approved subcontract work into Cost Estimate
- Subcontractor beneficiary details used as the default source for payment

### Finance Division owns

- Payment Requisitions
- Main Head budget enforcement
- Contractor-specific monetary capacity enforcement
- Payment routing
- Accounts processing
- Payment settlement
- Subcontractor Ledger
- Outstanding / paid / available balance reporting

The Projects module defines **what is approved**.

The Finance module controls **how the approved monetary obligation is requisitioned and paid**.

---

## 4. Master Data Model

Two new global masters are required. They are shared across all Work Orders.

### 4.1 Subcontract Work Master

The **Subcontract Work Master** is the canonical catalogue of subcontract work.

It is not Work Order-specific and not contractor-specific.

Example:

```text
DI Pipe Line Work
├── 700 mm Pipe Laying       Mtr
├── 700 mm Valve Fitting     Job
├── 700 mm Valve Chamber     Job
├── 600 mm Pipe Laying       Mtr
└── 600 mm Valve Fitting     Job

Bore Well
├── ODEX                     Mtr
├── DTH                      Mtr
└── Direct                   Mtr
```

Recommended logical fields:

```text
subcontract_work_master

id
sub_head
material_details
unit
is_active
created_by
created_at
updated_by
updated_at
```

`id` is the canonical identity of a subcontract work item. Names are display values and must not be used as relational identity.

### 4.2 Subcontractor Master

The **Subcontractor Master** is the canonical Projects-side contractor directory.

Recommended logical fields:

```text
subcontractor_master

id
code
name
contact_person
mobile
email
address

pan
gst_no
other compliance fields

beneficiary_name
beneficiary_account_no
beneficiary_ifsc
beneficiary_bank_id
beneficiary_bank_name

is_active

created_by
created_at
updated_by
updated_at
```

#### Beneficiary rule

Beneficiary details are maintained on the Projects-side Subcontractor Master.

When a JE selects a subcontractor during Payment Requisition creation:

```text
Subcontractor selected
        ↓
beneficiary details auto-filled
```

The Finance workflow may retain a snapshot of those beneficiary details on the requisition/payment record for audit purposes.

The Projects-side subcontractor identity and Finance-side payment record remain separate concepts even though beneficiary details originate from the Subcontractor Master.

---

## 5. Work Order-specific Subcontractor Estimate

A Subcontractor Estimate belongs to one Work Order.

The JE creates the Subcontractor Estimate before the corresponding subcontract work is available inside the Cost Estimate.

Recommended model:

```text
project_subcontract_estimates

id
work_order_no
revision
status

je_remarks
zo_remarks
ho_remarks

created_by
created_at
updated_at

submitted_at
zo_actioned_at
zo_actioned_by
ho_actioned_at
ho_actioned_by

reopened_at
reopened_by
active_revision_deadline
```

Lines:

```text
project_subcontract_estimate_lines

id
subcontract_estimate_id

subcontractor_id
subcontract_work_id

qty
rate
amount

rate_reference
remarks

created_at
created_by
```

Amount rule:

```text
amount = qty × rate
```

This must be validated server-side / database-side and must not rely only on the frontend.

---

## 6. Subcontractor Estimate Workflow

The Subcontractor Estimate follows the **same status model, approval flow, revision process, and reopen behavior as the existing Cost Estimate workflow**.

This includes:

```text
JE creates estimate
        ↓
Draft
        ↓
Submit
        ↓
ZO Review
        ↓
HO Review
        ↓
Final Approved
```

Revision states and revision requests follow the same Cost Estimate conventions.

Reopening after Final Approval is also supported.

The implementation should reuse the existing Cost Estimate workflow rules wherever practical instead of creating an unrelated second approval engine.

---

## 7. Revision and Reopen Semantics

Approved historical contributions must not be destructively edited.

After Final Approval, reopening is allowed.

However:

> Existing approved subcontract estimate lines are not directly overwritten or deleted.

Only:

- adjustment entries, and
- additional entries

may be introduced during a later revision.

Example:

### Revision 1

```text
Contractor C
700 mm Pipe Laying
400 Mtr @ ₹100
₹40,000
```

### Later revision

Instead of modifying the approved line:

```text
400 → 500
```

the new revision records a new contribution:

```text
Contractor C
700 mm Pipe Laying
+100 Mtr @ ₹105
₹10,500
```

Historical approvals therefore remain traceable.

---

## 8. Repeated Contractor + Work Entries

The same subcontractor may receive the same subcontract work more than once.

These entries remain **separate source lines inside the Subcontractor Estimate**.

Example:

```text
Contractor C
700 mm Pipe Laying
200 Mtr @ ₹100

Contractor C
700 mm Pipe Laying
150 Mtr @ ₹105
```

The source rows remain individually auditable.

They must not be merged in the Subcontractor Estimate storage model.

---

## 9. Cost Estimate Integration

A subcontract work item must not appear in the Cost Estimate until the relevant Subcontractor Estimate contribution is **Final Approved**.

Therefore:

```text
Subcontractor Estimate
        ↓
Final Approved
        ↓
Eligible for Cost Estimate
```

A Draft / Under Review / Revision Requested subcontract estimate must not contribute to the Cost Estimate.

### Automatic import into the Cost Estimate

All eligible Final Approved subcontractor estimate contributions are automatically imported into the Work Order's Cost Estimate.

- If the Work Order has a Cost Estimate in `Draft` or `Estimate Reopened` status, eligible contributions are automatically appended to that estimate.
- If no editable Cost Estimate exists, eligible contributions remain pending for Cost Estimate import.
- When a Cost Estimate for that Work Order becomes `Draft` or `Estimate Reopened`, all pending eligible contributions are automatically appended.
- A Cost Estimate in `ZO Revision Requested` or `HO Revision Requested` does not receive new subcontract work rows.
- The import is append-only at the contribution level and must be idempotent; the same Subcontractor Estimate line must never be imported more than once.
- A contribution that has already been imported must not be re-imported merely because the Cost Estimate is reopened.

---

## 10. Cost Estimate Aggregation Identity

The Cost Estimate aggregates subcontract work by canonical:

```text
subcontract_work_id
```

Contractor identity is intentionally removed from the Cost Estimate presentation.

Example Subcontractor Estimate:

| Subcontractor | Work | Qty | Rate | Amount |
|---|---|---:|---:|---:|
| C | 700 mm Pipe Laying | 400 | ₹100 | ₹40,000 |
| D | 700 mm Pipe Laying | 300 | ₹105 | ₹31,500 |
| B | 700 mm Pipe Laying | 300 | ₹98 | ₹29,400 |

Cost Estimate:

```text
Main Head        = Sub Contractor
Sub Head         = DI Pipe Line Work
Material Details = 700 mm Pipe Laying
Unit             = Mtr
Qty              = 1000
Rate             = ₹100.90
Amount           = ₹100,900
```

Only one logical Cost Estimate row exists for that `subcontract_work_id`.

---

## 11. Weighted Average Rate Rule

Where multiple approved subcontract estimate lines for the same subcontract work item have different rates, the Cost Estimate uses a **weighted average rate**.

Formula:

```text
Weighted Average Rate
=
Total Approved Amount
÷
Total Approved Quantity
```

Equivalent formula:

```text
Σ(qty × rate)
─────────────
   Σ(qty)
```

Example:

```text
400 × 100 = 40,000
300 × 105 = 31,500
300 ×  98 = 29,400

Total Qty    = 1000
Total Amount = ₹100,900

Weighted Rate
= 100,900 / 1000
= ₹100.90 / Mtr
```

A simple arithmetic average of contractor rates must not be used.

---

## 12. Cost Estimate Reopen / Append Rule

For subcontract-derived Cost Estimate rows, reopening does not create duplicate visible work rows for the same `subcontract_work_id`.

Instead:

```text
Existing Qty
+ Newly Approved Qty

Existing Amount
+ Newly Approved Amount

New Weighted Rate
=
New Total Amount / New Total Qty
```

Example:

### Existing Cost Estimate logical row

```text
700 mm Pipe Laying
1000 Mtr
₹100.90
₹100,900
```

### Later approved subcontract contribution

```text
Contractor X
200 Mtr @ ₹110
₹22,000
```

### Updated Cost Estimate logical row

```text
Qty    = 1200 Mtr
Amount = ₹122,900
Rate   = ₹102.4167 / Mtr
```

The visible Cost Estimate row is updated as one logical row.

However, the underlying database must preserve the separate historical source contributions.

Subcontractor contributions are appended automatically only while the Cost Estimate is in `Draft` or `Estimate Reopened` status. Once the Cost Estimate reaches `Final Approved`, later eligible subcontractor contributions remain pending until the Cost Estimate is reopened and enters `Estimate Reopened`.

---

## 13. Immutable-row Rule — Revised Definition

The existing immutable approved-row principle is retained, but redefined for subcontract-derived rows.

### Normal approved Cost Estimate rows

Remain immutable according to the existing Cost Estimate rules.

### Subcontract-derived Cost Estimate rows

The logical displayed row may accumulate later Final Approved subcontract contributions.

The rule becomes:

> Approved source contributions are immutable. Additional approved subcontract contributions may be appended to the same logical Cost Estimate work row.

This preserves both:

- clean Cost Estimate presentation, and
- complete revision provenance.

---

## 14. Recommended Cost Estimate Provenance

A subcontract-derived Cost Estimate row should carry explicit source metadata.

Recommended concept:

```text
project_cost_estimate_items

...
source_type = 'SUBCONTRACT_ESTIMATE'
subcontract_work_id
...
```

A contribution/link table is preferred where multiple subcontract estimate lines contribute to one Cost Estimate line:

```text
cost_estimate_subcontract_contributions

id
cost_estimate_item_id
subcontract_estimate_line_id
qty_contribution
amount_contribution
```

This allows the system to reconstruct:

```text
Cost Estimate logical row
        │
        ├── approved contribution A
        ├── approved contribution B
        ├── approved contribution C
        └── later revision contribution D
```

without overwriting history.

---

## 15. Payment Requisition Capacity Rule

Physical work execution quantity is **not** introduced as a new payment gate.

The existing monetary-capacity logic remains.

For subcontractor payments, a requisition must remain within the monetary amount approved for that contractor/work combination.

Example:

```text
Contractor C
Approved subcontract value = ₹40,000

Already consumed / paid = ₹15,000

Remaining monetary capacity = ₹25,000
```

A new Payment Requisition for Contractor C against that approved work cannot exceed ₹25,000.

No separate measurement or executed-quantity cap is required by this design.

Payment Requisitions identify the Work Order + Subcontractor + Subcontract Work scope. They draw from the pooled cumulative capacity and do not claim one source line as an exact allocation.

The cumulative remaining monetary capacity is calculated across all Final Approved contributions for the corresponding:

```text
Work Order
+ Subcontractor
+ Subcontract Work
```

less the monetary amounts already consumed or paid for that same combination.

A future exact-allocation requirement must use a many-to-many requisition allocation table rather than a single source-line FK.

---

## 16. Dual Budget Control

The new design has two financial limits.

### Level 1 — Cost Estimate Main Head limit

The Final Approved Cost Estimate continues to define the overall approved:

```text
Main Head = Sub Contractor
```

budget for the Work Order.

### Level 2 — Contractor-specific approved value

The Final Approved Subcontractor Estimate defines the narrower capacity for:

```text
Work Order
+ Subcontractor
+ Subcontract Work
```

A Payment Requisition must comply with both.

Conceptually:

```text
Payment Requisition Amount
        <=
Remaining Contractor-specific Subcontract Capacity

AND

Payment Requisition Amount
        <=
Remaining Sub Contractor Main Head Capacity
```

---

## 17. Finance Ledger Identity

The new architecture must use stable relational IDs.

The Finance-side subcontractor identity must move away from using only:

```text
work_order_no
material_sub_head
material_details
```

as the logical contractor identity.

New records should use:

```text
work_order_no
subcontractor_id
subcontract_work_id
```

Human-readable fields may still be stored as audit/display snapshots.

---

## 18. Subcontractor Balance Source

Contractor-specific financial capacity originates from the **Final Approved Subcontractor Estimate**.

Conceptually:

```text
Final Approved Subcontract Estimate Line
        ↓
Contractor-specific financial capacity
        ↓
Payment Requisition reservation
        ↓
Payment settlement / release
        ↓
Subcontractor Ledger
```

The Cost Estimate continues to provide the overall Main Head ceiling.

An eligible subcontractor contribution does not increase usable Sub Contractor Main Head capacity immediately upon Subcontractor Estimate approval. It contributes to Main Head capacity only after the related Cost Estimate has itself reached `Final Approved`.

The contractor-level credit must not be inferred only from the aggregated Cost Estimate row because the Cost Estimate intentionally removes contractor identity.

---

## 19. Beneficiary Autofill

When a Payment Requisition is created for a subcontractor:

```text
Select Work Order
        ↓
Select approved subcontractor/work
        ↓
Subcontractor Master resolved
        ↓
Beneficiary details auto-filled
```

Fields may include:

```text
Beneficiary Name
Account Number
IFSC
Bank
```

The JE should not need to repeatedly type banking information already present in the approved Subcontractor Master.

Finance records should still retain the values used at the time of payment as snapshots for auditability.

The existing `projects_beneficiary_master` table remains the beneficiary storage used behind the Projects-side `subcontractor_master`. The Subcontractor Master references the beneficiary record; payment requisitions snapshot the beneficiary values used at creation/payment time.

---

## 20. Production Migration Strategy

There is no requirement to preserve the current production subcontractor data model.

Production will be reset before the new architecture is deployed.

Therefore the implementation may:

- replace the existing pseudo-subcontractor Material Master model,
- use canonical IDs throughout,
- remove compatibility-only write paths,
- seed the new master structures cleanly,
- and migrate the application directly to the normalized model.

Legacy compatibility logic is not required as a design constraint.

The existing pseudo-subcontractor rows in the generic Material Master are legacy data for this architecture and will be purged during the production reset. The new implementation does not need to preserve pseudo-subcontractor write paths.

Even with a production reset, database migrations must remain deterministic and safe for development/test environments.

---

## 21. Required Invariants

The following invariants are mandatory.

### Identity

```text
subcontractor_id
```

is the canonical contractor identity.

```text
subcontract_work_id
```

is the canonical subcontract work identity.

Names are never used as primary relational identity.

### Approval

Only **Final Approved** subcontract estimate contributions feed the Cost Estimate or contractor financial capacity.

### Arithmetic

```text
line_amount = qty × rate
```

### Aggregation

```text
Cost Estimate row identity = subcontract_work_id
```

### Weighted rate

```text
Cost Estimate rate
=
Total Approved Subcontract Amount
/
Total Approved Subcontract Qty
```

### History

Approved source contributions are never destructively rewritten.

### Revisions

Adjustments and additions create new append-only contribution records. `BASE` and `ADDITION` rows use positive values. `ADJUSTMENT` rows are signed deltas against a previously Final Approved source line; approved rows are never mutated or deleted.

Effective quantity and amount are the signed sums of approved BASE, ADDITION, and ADJUSTMENT contributions. Effective totals must remain non-negative, and a negative adjustment must not reduce capacity below active Finance reservations or settled payments.

### Finance

Payment capacity is monetary.

No physical execution/measurement gate is introduced.

Payment Requisitions identify the pooled Work Order + Subcontractor + Subcontract Work scope; exact source allocation, if later required, uses a many-to-many allocation table.

### Budget enforcement

Subcontractor Payment Requisition must satisfy both:

```text
contractor-specific remaining capacity
```

and:

```text
Sub Contractor Main Head remaining capacity
```

---

## 22. End-to-End Business Flow

```text
GLOBAL SUBCONTRACT WORK MASTER
            +
GLOBAL SUBCONTRACTOR MASTER
            │
            ▼
JE selects Work Order
            │
            ▼
Creates Subcontractor Estimate
            │
            ├── Subcontractor
            ├── Work Item
            ├── Qty
            ├── Rate
            └── Amount
            │
            ▼
Save Draft
            │
            ▼
Submit
            │
            ▼
ZO Review
            │
            ▼
HO Review
            │
            ▼
FINAL APPROVED
            │
            ├─────────────────────────────┐
            │                             │
            ▼                             ▼
Contractor-specific               Aggregate by
financial capacity                subcontract_work_id
            │                             │
            │                             ▼
            │                       COST ESTIMATE
            │
            │                    Main Head:
            │                    Sub Contractor
            │
            │                    Qty = total qty
            │                    Rate = weighted avg
            │                    Amount = total amount
            │
            │                             │
            │                             ▼
            │                   Cost Estimate approval
            │
            └──────────────┬──────────────┘
                           ▼
                  PAYMENT REQUISITION
                           │
                beneficiary auto-filled
                           │
             dual financial capacity check
                           │
                           ▼
                    FINANCE / ACCOUNTS
                           │
                           ▼
                         PAYMENT
                           │
                           ▼
                 SUBCONTRACTOR LEDGER
```

### Deferred and cumulative contribution behavior

Subcontractor capacity is cumulative across all Final Approved contributions for:

```text
Work Order
+ Subcontractor
+ Subcontract Work
```

Each Payment Requisition identifies the Work Order + Subcontractor + Subcontract Work scope. It draws from the pooled cumulative contractor-specific balance; it does not claim one source line as an exact allocation. If exact source allocation is later required, use a many-to-many requisition allocation table.

If a Final Approved subcontractor contribution is created while the Cost Estimate is not in `Draft` or `Estimate Reopened`, it remains eligible but pending. If the Cost Estimate is already `Final Approved`, it must be reopened; reopening enters `Estimate Reopened`, where pending contributions may be imported. Main Head capacity becomes usable only after the updated Cost Estimate is subsequently Final Approved.

---

## 23. Implementation Boundary

This document intentionally defines **business rules and data semantics only**.

The next implementation phase should translate these rules into:

1. normalized database schema,
2. constraints and indexes,
3. approval/revision state transitions,
4. APIs,
5. Projects-side pages,
6. Cost Estimate aggregation logic,
7. Finance capacity integration,
8. Payment Requisition integration,
9. Ledger/reporting changes,
10. regression and invariant tests.

No UI implementation should be treated as authoritative if it conflicts with the rules defined in this document.

## 23A. Clarifications and Locked Decisions

The following decisions are part of this implementation baseline:

1. Eligible Final Approved subcontractor contributions are automatically appended to a Work Order Cost Estimate whenever that Cost Estimate is in `Draft` or `Estimate Reopened` status.
2. If no editable Cost Estimate exists, contributions remain eligible and pending until one exists.
3. `ZO Revision Requested` and `HO Revision Requested` Cost Estimates do not receive new subcontract work rows.
4. Revisions use immutable BASE, ADDITION, and signed ADJUSTMENT contribution records; approved history is never overwritten.
5. Contractor-specific capacity is cumulative across all Final Approved contributions for the Work Order + Subcontractor + Subcontract Work combination.
6. Payment Requisitions identify the pooled contractor/work scope; exact source allocation, if later required, uses a many-to-many allocation table.
7. Negative adjustments must not reduce effective capacity below active Finance reservations or settled payments.
8. Subcontractor approval alone does not increase usable Main Head capacity; the related Cost Estimate must be Final Approved first.
9. `projects_beneficiary_master` remains the beneficiary table behind `subcontractor_master`.
10. Existing pseudo-subcontractor Material Master rows are legacy and will be purged; compatibility write paths are not required.

---

## 24. Decision Summary

The agreed architecture is:

```text
Subcontract Work Master
        +
Subcontractor Master
        ↓
WO-specific Subcontractor Estimate
        ↓
same approval/revision/reopen lifecycle as Cost Estimate
        ↓
Final Approved
        ↓
┌──────────────────────────────┐
│                              │
▼                              ▼
Cost Estimate aggregation      Contractor monetary capacity
by subcontract_work_id         for Finance
│                              │
▼                              ▼
weighted average rate          Payment Requisition
│                              │
└──────────────┬───────────────┘
               ▼
       Finance / Ledger
```

This is the implementation baseline for the new subcontractor architecture.
