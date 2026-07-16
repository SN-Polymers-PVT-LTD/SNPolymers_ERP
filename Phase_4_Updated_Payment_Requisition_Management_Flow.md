# PHASE 4 — UPDATED PAYMENT REQUISITION MANAGEMENT FLOW

## Core Financial Rule

For each:

**Work Order + Cost Estimate + Material Main Head**

the system maintains a logical remaining payment capacity:

```text
Remaining Main Head Capacity
=
Main Head Cost Estimate Amount
-
Cumulative ZO-Approved Payment Requisition Amount
```

Only amounts actually approved by the ZO consume this capacity.

- Pending Payment Requisitions → Do not consume capacity
- Hold Payment Requisitions → Do not consume capacity
- Approved Payment Requisitions → Approved amount consumes capacity

However, when creating a new Payment Requisition:

```text
JE Requested Amount <= Current Remaining Main Head Capacity
```

At ZO approval:

```text
Previous Cumulative ZO-Approved Amount
+
Current Approved Amount
<=
Main Head Cost Estimate Amount
```

---

# STEP 1 — JE LOGIN

```text
┌─────────────────────────────────────────────┐
│                  JE LOGIN                   │
│                                             │
│ System auto-captures:                       │
│ • Login Date                                │
│ • JE User ID                                │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
             ◇ ACTIVE JE-ZO MAPPING? ◇
                      │
               ┌──────┴──────┐
               │             │
              NO            YES
               │             │
               ▼             ▼
      ┌────────────────┐   CONTINUE
      │ BLOCK PAYMENT  │      │
      │ REQUISITION    │      │
      │ CREATION       │      │
      └────────────────┘      │
                              ▼
┌─────────────────────────────────────────────┐
│             IDENTIFY CURRENT ZO             │
│                                             │
│ From active JE → ZO User Mapping            │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
                    STEP 2
```

---

# STEP 2 — SELECT WORK ORDER

```text
┌─────────────────────────────────────────────┐
│         FETCH ELIGIBLE WORK ORDERS          │
│                                             │
│ Show ONLY Work Orders where:                │
│                                             │
│ ✓ JE has active Work Order Mapping          │
│ ✓ WO belongs to JE's current mapped ZO      │
│ ✓ WO Status = Running                       │
│   OR                                        │
│   Complete Under Maintenance                │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│            SELECT WORK_ORDER_NO             │
│                                             │
│ JE sees only their mapped eligible WOs      │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
              ◇ BACKEND VALIDATION ◇
                      │
               ┌──────┴──────┐
               │             │
            INVALID        VALID
               │             │
               ▼             ▼
             BLOCK         STEP 3
```

Backend validates:

- Active JE-ZO mapping
- Active JE-WO mapping
- WO belongs to JE's mapped ZO
- WO status is `Running` or `Complete Under Maintenance`

**Closed Work Orders are blocked.**

---

# STEP 3 — SELECT COST ESTIMATE

```text
┌─────────────────────────────────────────────┐
│        FETCH ELIGIBLE COST ESTIMATES        │
│                                             │
│ Fetch applicable Approved / Final           │
│ Cost Estimate for selected Work Order       │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│             SELECT ESTIMATE_NO              │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│          AUTO-FETCH ESTIMATE DATA           │
│                                             │
│ • Total Estimate Amount                     │
│ • State                                     │
│ • District                                  │
│ • Area Code                                 │
│ • Department                                │
│ • Site Details                              │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
                    STEP 4
```

The Estimate must belong to the selected Work Order.

---

# STEP 4 — ENTER REQUISITION NUMBER

```text
┌─────────────────────────────────────────────┐
│            ENTER REQUISITION_NO             │
│                                             │
│ Must be Unique                              │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
                    STEP 5
```

---

# STEP 5 — SELECT MATERIAL MAIN HEAD

```text
┌─────────────────────────────────────────────┐
│          SELECT MATERIAL_MAIN_HEAD          │
│                                             │
│ Dropdown shows Main Heads from the          │
│ selected Cost Estimate                      │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│       FETCH MAIN HEAD ESTIMATE AMOUNT       │
│                                             │
│ Based on:                                   │
│ • Work Order                                │
│ • Cost Estimate                             │
│ • Material Main Head                        │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
                    STEP 6
```

---

# STEP 6 — CALCULATE MAIN HEAD REMAINING CAPACITY

```text
┌─────────────────────────────────────────────┐
│          FETCH PREVIOUS ZO-APPROVED         │
│             PAYMENT REQUISITIONS            │
│                                             │
│ For same:                                   │
│ • Work Order                                │
│ • Cost Estimate                             │
│ • Material Main Head                        │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│        CALCULATE CUMULATIVE APPROVED        │
│                                             │
│ Sum ONLY ZO-Approved Amounts                │
│                                             │
│ Pending  → Excluded                         │
│ Hold     → Excluded                         │
│ Approved → Included                         │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│         CALCULATE REMAINING CAPACITY        │
│                                             │
│ Remaining Main Head Capacity                │
│ =                                           │
│ Main Head Cost Estimate Amount                │
│ -                                           │
│ Cumulative ZO-Approved Amount     for that main head          │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│                DISPLAY TO JE                │
│                                             │
│ • Main Head Estimated Amount                │
│ • Total ZO-Approved Amount                  │
│ • Remaining Main Head Capacity              │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
                    STEP 7
```

### Example

```text
Material Main Head: Cement
Cost Estimate Amount = ₹5,00,000
Previously ZO Approved = ₹3,50,000
Remaining Capacity = ₹1,50,000
```

---

# STEP 7 — UPLOAD REQUISITION PDF

```text
┌─────────────────────────────────────────────┐
│          UPLOAD REQUISITION PDF             │
│                                             │
│ File name must follow existing              │
│ Requisition Number rules                    │
└─────────────────────┬───────────────────────┘
                      │
                      ├──────────────► PDF PREVIEW
                      │
                      ▼
                    STEP 8
```

---

# STEP 8 — ENTER REQUISITION AMOUNT

```text
┌─────────────────────────────────────────────┐
│          ENTER REQUISITION_AMOUNT           │
│                                             │
│ Total amount as per uploaded PDF            │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
       ◇ REQUEST AMOUNT <= CURRENT REMAINING  ◇
       ◇       MAIN HEAD CAPACITY?            ◇
                      │
               ┌──────┴──────┐
               │             │
              NO            YES
               │             │
               ▼             ▼
┌────────────────────────┐  CONTINUE
│   BLOCK REQUISITION    │      │
│                        │      │
│ Payment Requisition    │      │
│ exceeds available      │      │
│ Cost Estimate amount   │      │
│ for this Material      │      │
│ Main Head.             │      │
│                        │      │
│ Please update/revise   │      │
│ the Cost Estimate for  │      │
│ this Material Main     │      │
│ Head first.            │      │
└────────────────────────┘      │
                                ▼
                              STEP 9
```

Creation validation:

```text
JE Requested Amount <= Current Remaining Main Head Capacity
```

---

# STEP 9 — GST BILL

```text
                    GST BILL?
                       │
                ┌──────┴──────┐
                │             │
               YES            NO
                │             │
                ▼             ▼
┌───────────────────────┐  ┌───────────────────────┐
│  UPLOAD GST BILL PDF  │  │ NO GST BILL UPLOAD    │
│                       │  │ REQUIRED               │
│ Mandatory             │  │                       │
└───────────┬───────────┘  └───────────┬───────────┘
            │                          │
            └────────────┬─────────────┘
                         │
                         ▼
                       STEP 10
```

---

# STEP 10 — BANK DETAILS & REMARKS

```text
┌─────────────────────────────────────────────┐
│             ENTER BANK DETAILS              │
│                                             │
│ Details of Requester                        │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│          ENTER EXPENSE HEAD REMARKS         │
│                                             │
│ If any                                      │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
                    STEP 11
```

---

# STEP 11 — FINAL SUBMISSION VALIDATION

```text
┌─────────────────────────────────────────────┐
│          FINAL BACKEND REVALIDATION         │
│                                             │
│ ✓ Active JE-ZO Mapping                      │
│ ✓ Active JE-WO Mapping                      │
│ ✓ WO belongs to mapped ZO                   │
│ ✓ WO status eligible                        │
│ ✓ Estimate belongs to WO                    │
│ ✓ Main Head belongs to Estimate             │
│ ✓ Required documents valid                  │
│                                             │
│ Recalculate:                                │
│                                             │
│ Main Head Estimate                          │
│ - Cumulative ZO-Approved Amount             │
│ = Current Remaining Capacity                │
│                                             │
│ Verify:                                     │
│ Requisition Amount <= Remaining Capacity    │
└─────────────────────┬───────────────────────┘
                      │
               ┌──────┴──────┐
               │             │
            INVALID        VALID
               │             │
               ▼             ▼
             BLOCK       FREEZE ZO ID
                              │
                              ▼
                       SAVE REQUISITION
                              │
                              ▼
                      STATUS = PENDING
                              │
                              ▼
                   WAITING FOR ZO APPROVAL
```

At creation, permanently store:

- JE
- ZO
- Work Order
- Cost Estimate
- Material Main Head

The ZO association is **frozen for historical ownership**.

---

# STEP 12 — ZO LOGIN & REVIEW

```text
┌─────────────────────────────────────────────┐
│                  ZO LOGIN                   │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│        FETCH PAYMENT REQUISITIONS           │
│                                             │
│ Show only Requisitions where:               │
│                                             │
│ Stored Requisition ZO                       │
│ = Logged-in ZO                              │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│             REVIEW REQUISITION              │
│                                             │
│ Display:                                    │
│ • JE                                        │
│ • Work Order                                │
│ • Cost Estimate                             │
│ • Material Main Head                        │
│ • Main Head Estimate Amount                 │
│ • Cumulative ZO-Approved Amount             │
│ • Current Main Head Remaining Capacity      │
│ • Requisition Amount                        │
│ • Requisition PDF                           │
│ • GST Details / PDF                         │
│ • Bank Details                              │
│ • Remarks                                   │
│ • Current Global ZO Available Balance       │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│           SYSTEM AUTO-CAPTURES              │
│                                             │
│ • Approved & Payment User ID                │
│ • Approved & Payment Date                   │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
                    STEP 13
```

---

# STEP 13 — APPROVE TYPE

```text
                  APPROVE TYPE
                 APPROVE / HOLD
                       │
                       ▼
                ◇ APPROVE TYPE? ◇
                  /           \
                 /             \
              HOLD           APPROVE
               │                │
               ▼                ▼
           STEP 13A         STEP 13B
```

## STEP 13A — HOLD

```text
                 HOLD SELECTED
                       │
                       ▼
                 STATUS = HOLD
                       │
                       ▼
          NO GLOBAL ZO BALANCE DEDUCTION
                       │
                       ▼
                NO LEDGER ENTRY
                       │
                       ▼
                      END
```

**Hold does not consume Main Head capacity.**

## STEP 13B — APPROVE

```text
                APPROVE SELECTED
                       │
                       ▼
             ENTER APPROVED AMOUNT
                       │
                       ▼
            Approved Balance Amount
                       =
              Requisition Amount
                       -
                Approved Amount
                       │
                       ▼
            ENTER APPROVAL REMARKS
                       │
                       ▼
                    VALIDATE
                       │
              Approved Amount > 0
                      AND
              Approved Amount
              <= Requisition Amount
                       │
                       ▼
          BEGIN DATABASE TRANSACTION
```

---

# STEP 14 — TRANSACTION-SAFE FINAL APPROVAL

```text
┌─────────────────────────────────────────────┐
│          BEGIN DATABASE TRANSACTION         │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│         REVALIDATE REQUISITION              │
│                                             │
│ ✓ Request still actionable                  │
│ ✓ Logged-in ZO = Frozen Requisition ZO      │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│          DUPLICATE LEDGER CHECK             │
│                                             │
│ Ensure no previous financial posting        │
│ exists for this Requisition                 │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│       RECALCULATE MAIN HEAD CAPACITY        │
│                                             │
│ Main Head Estimate Amount                   │
│ MINUS                                       │
│ Cumulative Previous ZO-Approved Amount      │
│ =                                           │
│ Current Remaining Main Head Capacity        │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
      ◇ CURRENT APPROVED AMOUNT <=            ◇
      ◇ REMAINING MAIN HEAD CAPACITY?         ◇
                      │
               ┌──────┴──────┐
               │             │
              NO            YES
               │             │
               ▼             ▼
      ┌───────────────┐    CONTINUE
      │ BLOCK APPROVAL│       │
      │ + ROLLBACK    │       │
      │               │       │
      │ Cost Estimate │       │
      │ Main Head     │       │
      │ Limit Exceeded│       │
      └───────────────┘       │
                              ▼
┌─────────────────────────────────────────────┐
│              LOCK ZO BALANCE                │
│                                             │
│ SELECT ... FOR UPDATE                       │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│       READ LATEST GLOBAL ZO BALANCE         │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
          ◇ GLOBAL ZO BALANCE >=              ◇
          ◇ APPROVED AMOUNT?                  ◇
                      │
               ┌──────┴──────┐
               │             │
              NO            YES
               │             │
               ▼             ▼
      ┌───────────────┐    CONTINUE
      │ BLOCK APPROVAL│       │
      │ + ROLLBACK    │       │
      │               │       │
      │ Insufficient  │       │
      │ ZO Balance    │       │
      └───────────────┘       │
                              ▼
                            STEP 15
```

---

# STEP 15 — APPROVE PAYMENT REQUISITION

```text
┌─────────────────────────────────────────────┐
│         DEDUCT GLOBAL ZO BALANCE            │
│                                             │
│ New Global Balance                          │
│ =                                           │
│ Current Global Balance                      │
│ - Approved Amount                           │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│          CREATE FUND LEDGER ENTRY           │
│                                             │
│ Type          = REQUISITION_APPROVAL        │
│ Reference     = Requisition ID              │
│ ZO            = Frozen ZO                   │
│ Work Order    = Work Order                  │
│ Estimate      = Cost Estimate               │
│ Material Head = Material Main Head          │
│ Amount        = - Approved Amount            │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│       UPDATE PAYMENT REQUISITION            │
│                                             │
│ Status = APPROVED                           │
│                                             │
│ Store:                                      │
│ • Approved Amount                           │
│ • Approved Balance Amount                   │
│ • Approved By                               │
│ • Approval Date                             │
│ • Approval Remarks                          │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│                   COMMIT                    │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
                   NOTIFY JE
                      │
                      ▼
                     END
```

---

# FINAL COMPLETE FLOW

```text
JE LOGIN
   │
   ▼
ACTIVE JE-ZO MAPPING?
   │
   ├── NO ──► BLOCK
   │
   ▼
IDENTIFY CURRENT ZO
   │
   ▼
FETCH ONLY JE'S ACTIVE MAPPED
ELIGIBLE WORK ORDERS
   │
   ▼
SELECT WORK ORDER
   │
   ▼
SELECT APPROVED / FINAL COST ESTIMATE
   │
   ▼
AUTO-FETCH ESTIMATE DATA
   │
   ▼
ENTER UNIQUE REQUISITION NUMBER
   │
   ▼
SELECT MATERIAL MAIN HEAD
   │
   ▼
FETCH MAIN HEAD ESTIMATE AMOUNT
   │
   ▼
FETCH CUMULATIVE PREVIOUS
ZO-APPROVED PAYMENT AMOUNT
   │
   ▼
CALCULATE:
Remaining Main Head Capacity
=
Main Head Estimate
-
Cumulative ZO-Approved Amount
   │
   ▼
UPLOAD REQUISITION PDF
   │
   ▼
ENTER REQUISITION AMOUNT
   │
   ▼
REQUEST AMOUNT <=
REMAINING MAIN HEAD CAPACITY?
   │
   ├── NO
   │    │
   │    ▼
   │   BLOCK
   │    │
   │    ▼
   │   ASK JE TO UPDATE / REVISE
   │   COST ESTIMATE MATERIAL MAIN HEAD
   │
   └── YES
        │
        ▼
      GST BILL?
        │
        ├── YES → UPLOAD GST PDF
        │
        └── NO  → CONTINUE
        │
        ▼
   ENTER BANK DETAILS
        │
        ▼
      REMARKS
        │
        ▼
FINAL BACKEND VALIDATION
        │
        ▼
    FREEZE ZO ID
        │
        ▼
 STATUS = PENDING
        │
        ▼
    ZO REVIEW
        │
        ▼
  APPROVE / HOLD?
    │         │
  HOLD      APPROVE
    │         │
    ▼         ▼
STATUS=HOLD  ENTER APPROVED AMOUNT
    │         │
    ▼         ▼
NO BALANCE   BEGIN TRANSACTION
CHANGE        │
    │         ▼
    │    DUPLICATE LEDGER CHECK
    │         │
    │         ▼
    │    RECALCULATE MAIN HEAD
    │    REMAINING CAPACITY
    │         │
    │         ▼
    │    APPROVED AMOUNT WITHIN
    │    REMAINING CAPACITY?
    │       │       │
    │      NO      YES
    │       │       │
    │       ▼       ▼
    │   ROLLBACK   LOCK GLOBAL
    │              ZO BALANCE
    │                 │
    │                 ▼
    │           BALANCE SUFFICIENT?
    │              │       │
    │             NO      YES
    │              │       │
    │              ▼       ▼
    │          ROLLBACK   DEDUCT
    │                     BALANCE
    │                       │
    │                       ▼
    │                  CREATE LEDGER
    │                       │
    │                       ▼
    │                STATUS = APPROVED
    │                       │
    │                       ▼
    │                     COMMIT
    │                       │
    │                       ▼
    │                   NOTIFY JE
    │                       │
    ▼                       ▼
   END                     END
```

---

# FINAL FINANCIAL CONTROL RULES

## A. JE Payment Requisition Creation

```text
JE Requested Amount
<=
Main Head Estimate
-
Cumulative ZO-Approved Amount
```

## B. ZO Payment Approval

```text
Current ZO Approved Amount
<=
Main Head Estimate
-
Previous Cumulative ZO-Approved Amount
```

## C. ZO Global Balance

```text
Current ZO Approved Amount
<=
Global ZO Available Balance
```

## D. Main Head Capacity Consumption

Only:

```text
ZO-Approved Payment Amounts
```

consume Material Main Head Cost Estimate capacity.

Pending and Hold Payment Requisitions do not consume capacity.

## E. Successful Approval

A successful ZO approval simultaneously:

```text
Deducts Approved Amount from Global ZO Balance
+
Creates REQUISITION_APPROVAL Ledger Entry
+
Adds Approved Amount to cumulative consumption
of the Cost Estimate Material Main Head
+
Marks Payment Requisition as APPROVED
```

All operations must succeed or fail together in one atomic transaction.

---

# IMPORTANT SEPARATION OF FINANCIAL VALUES

The system must treat these as four completely separate concepts:

| Value | Purpose |
|---|---|
| `Approved_Balance_Amount` | Unapproved remainder of an individual Payment Requisition |
| `Main Head Remaining Capacity` | Remaining Cost Estimate capacity for a Material Main Head |
| `WO Remaining Funding Capacity` | Remaining HO funding that can be approved against a Work Order |
| `Global ZO Available Balance` | Actual funds currently available for the ZO to approve payments |

**These values must never be used interchangeably.**
