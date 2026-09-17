# Phase 6 --- Canonical Subcontract Finance & Capacity Cutover

## 1. Objective

Phase 6 completes the financial side of the Subcontractor Ledger
architecture.

Phases 4 and 5 established the authoritative subcontract scope and its
projection into the Project Cost Estimate. Phase 6 makes that approved
scope the canonical basis for subcontractor Payment Requisitions,
financial capacity checks, reservations, payments, and
remaining-capacity calculations.

The primary goal is to replace legacy display-string and
Cost-Estimate-row-derived subcontractor capacity logic with canonical
UUID-based financial authorization.

## 2. Phase 6 Boundary

### Inputs already established

Phase 6 builds on the frozen behavior from earlier phases:

-   `subcontractor_master.id` is the canonical contractor identity.
-   `subcontract_work_master.id` is the canonical subcontract work
    identity.
-   Final Approved Subcontract Estimate lines define approved
    contractor/work scope.
-   Historical approved subcontract contributions are immutable.
-   Additions and signed adjustments change effective approved scope.
-   Phase 4 financial-consumption guards prevent approved scope from
    being reduced below already-consumed capacity.
-   Phase 5 projects Final Approved subcontract scope into Cost Estimate
    generated rows.
-   Cost Estimate generated rows are grouped by canonical subcontract
    work, not contractor.
-   Generated Cost Estimate rows are system-owned and reviewable but not
    manually editable.
-   Phase 5 prevents generated rows from creating legacy
    `ESTIMATE_ITEM_APPROVAL` subcontractor credits.
-   `subcontractor_master.primary_beneficiary_id` links to
    `projects_beneficiary_master`.

### Phase 6 owns

Phase 6 owns canonical subcontract Finance capacity; subcontract Payment
Requisition identity and validation; contractor/work capacity
reservation; Cost Estimate capacity enforcement; beneficiary defaults
for subcontract Payment Requisitions; canonical subcontract financial
consumption; Finance-side concurrency enforcement; and cutover from the
legacy subcontractor balance/credit path for the new workflow.

### Explicitly out of scope

Phase 6 does not include Combined Fund Request + Payment Requisition
Excel export, broad Accounts-module redesign, unrelated Fund Request
changes, general reporting/dashboard redesign, subcontract analytics,
redesign of non-subcontract Payment Requisitions, unrelated Finance
ledger cleanup, or Phase 5 Cost Estimate architecture changes.

## 3. Canonical Financial Scope

The canonical financial scope is:

``` text
work_order_no
+ subcontractor_id
+ subcontract_work_id
```

Display values such as contractor name, work description, Material Main
Head, Material Sub Head, or Material Details must never be used as
financial identity.

For a canonical scope:

``` text
Approved Contractor Capacity
    = effective Final Approved subcontract amount
```

The effective amount includes all Final Approved BASE, ADDITION and
signed ADJUSTMENT entries.

The authoritative value must come from canonical approved Subcontract
Estimate scope, not display fields or legacy subcontractor balances.

## 4. Financial Consumption

Phase 6 must establish one canonical definition:

``` text
Consumed Capacity
    = active reserved amount
    + paid/settled amount
```

An amount must be counted exactly once across lifecycle transitions.
Moving a Payment Requisition from reserved to paid must transition the
same consumption rather than count both the reservation and payment.

``` text
Available Contractor Capacity
    = Approved Contractor Capacity
    - Consumed Capacity
```

The canonical Finance read path must expose approved capacity, reserved
amount, paid/settled amount, consumed amount, and available amount.
Backend validation and frontend displays must derive from the same
rules.

## 5. Dual-Capacity Rule

A subcontract Payment Requisition is constrained by two independent
authorizations:

``` text
amount_to_reserve
    <= remaining contractor/work capacity

AND

amount_to_reserve
    <= remaining Final Approved Cost Estimate capacity
```

Both constraints are mandatory. Passing one must never bypass the other.

## 6. Cost Estimate Financial Gate

The presence of Phase 5 generated Cost Estimate rows does not itself
authorize Finance consumption.

Finance capacity derived from the Cost Estimate becomes usable only when
the applicable Project Cost Estimate is **Final Approved**.

``` text
Final Approved Subcontract Estimate
        ↓
defines contractor/work scope

Final Approved Project Cost Estimate
        ↓
authorizes Finance use of that scope
```

A generated row existing in Draft, Submitted, ZO/HO review, or Estimate
Reopened must not authorize spending.

## 7. Payment Requisition Canonical Identity

Subcontract Payment Requisitions must carry canonical identity:

``` text
work_order_no
subcontractor_id
subcontract_work_id
beneficiary_id
```

`subcontractor_id` must reference `subcontractor_master.id`.
`subcontract_work_id` must reference `subcontract_work_master.id`. The
work must belong to approved scope for the selected contractor and Work
Order.

Display strings may be stored for presentation but must not determine
authorization. The backend must reject attempts to spoof contractor/work
identity through display fields.

## 8. Beneficiary Resolution

The default beneficiary is:

``` text
subcontractor_master.primary_beneficiary_id
        ↓
projects_beneficiary_master
```

When a JE creates a subcontract Payment Requisition, contractor and work
are selected by canonical IDs and the beneficiary defaults from the
contractor master.

Contractor identity and beneficiary identity remain separate concepts.
Any beneficiary override allowed by existing business rules must be
explicit and server-validated.

## 9. Canonical Capacity Read Path

Phase 6 should provide one authoritative backend primitive for
subcontract capacity, conceptually:

``` text
get_subcontract_finance_capacity(
    work_order_no,
    subcontractor_id,
    subcontract_work_id
)
```

Expected information:

``` text
approved_capacity
reserved_amount
paid_or_settled_amount
consumed_amount
available_contractor_capacity
available_cost_estimate_capacity
effective_available_capacity
```

where:

``` text
effective_available_capacity
    = MIN(
        available_contractor_capacity,
        available_cost_estimate_capacity
      )
```

The exact API/RPC shape should follow existing codebase conventions. The
frontend and Finance approval transaction must not implement separate
capacity formulas.

## 10. Reservation and Approval

A JE-side pre-check is not sufficient. Capacity must be revalidated at
the transaction that actually reserves/approves money.

The authoritative approval transaction must:

1.  identify the canonical contractor/work scope;
2.  lock the relevant financial scope;
3.  read current Final Approved subcontract authorization;
4.  read current financial consumption;
5.  read applicable Final Approved Cost Estimate capacity;
6.  verify both remaining capacities;
7.  create/update the reservation;
8.  write required ledger/audit records;
9.  commit atomically.

If capacity is insufficient, no partial reservation or ledger mutation
may survive.

## 11. Concurrency

Phase 6 must preserve the concurrency guarantees established during
Phase 4.

Two simultaneous Finance approvals against the same canonical scope must
not both consume the same remaining capacity.

The lock identity must be based on:

``` text
work_order_no
+ subcontractor_id
+ subcontract_work_id
```

The Finance consumption transaction and Phase 4 negative-adjustment
Final Approval guard must serialize consistently for the same scope.

Required invariant:

``` text
consumed_capacity <= approved_capacity
```

must hold under concurrent Payment Requisition approvals, reservation
changes, settlement/payment transitions, and negative subcontract
adjustments.

## 12. Cost Estimate Capacity

Finance-side Cost Estimate capacity must use Final Approved Cost
Estimate authorization and authoritative item `amount` values.

For Phase 5 generated subcontract rows:

-   `amount` is authoritative;
-   rounded display `rate × qty` must not replace stored amount;
-   zero-scope tombstone rows contribute zero capacity.

Finance must not infer contractor identity from a generated Cost
Estimate row because Phase 5 intentionally aggregates multiple
contractors into one work-level row.

Contractor authorization comes from Subcontract Estimate scope. Cost
Estimate authorization is the second independent ceiling.

## 13. Legacy Finance Cutover

The legacy subcontract Finance path must not remain an alternative
authorization mechanism for the new workflow.

Phase 6 must audit and appropriately retire/bypass new-flow dependence
on:

-   `subcontractor_balances`;
-   `ESTIMATE_ITEM_APPROVAL` credits;
-   contractor identity inferred from Material Main/Sub Head or Material
    Details;
-   Cost Estimate row approval as the source of contractor-specific
    authorization.

Phase 5 already prevents generated subcontract Cost Estimate rows from
creating legacy approval credits. Phase 6 completes the cutover so
canonical subcontract Payment Requisitions do not require those legacy
credits.

Legacy behavior required by unrelated historical/noncanonical flows
should be preserved rather than broadly deleted unless the audit proves
it is unused.

## 14. Ledger Semantics

The financial ledger must make canonical consumption determinable
without double counting.

Each subcontract financial transaction should be attributable to:

``` text
work_order_no
subcontractor_id
subcontract_work_id
payment_requisition_id / source reference
transaction/lifecycle type
amount
```

The existing ledger should be reused if it can safely represent these
semantics. Do not create a second ledger merely because Phase 6
introduces canonical identity.

## 15. Requisition Lifecycle Rules

Capacity behavior must be explicit for every relevant existing Payment
Requisition transition.

-   **Draft / unapproved:** does not consume capacity unless the current
    Finance design explicitly reserves earlier.
-   **Approved / reserved:** consumes capacity as a reservation.
-   **Paid / settled:** consumes capacity as paid/settled money and
    replaces the corresponding reservation contribution.
-   **Rejected / cancelled:** releases any live reservation.
-   **Edited / reduced / superseded:** capacity reflects the
    authoritative current obligation without stale reservations.

The implementation must follow the actual existing requisition statuses
found during the Phase 6 audit. Do not invent new lifecycle states
unless required.

## 16. Reopen and Adjustment Interaction

A newly Final Approved ADDITION increases contractor/work authorization,
subject to applicable Final Approved Cost Estimate authorization.

A negative ADJUSTMENT may reduce authorization only when:

``` text
new approved contractor/work capacity
    >= already consumed capacity
```

The Phase 4 guard and Phase 6 Finance runtime must use the same
definition of consumed capacity.

## 17. Security and Authorization

Requirements:

-   client-supplied capacity values are never trusted;
-   display strings are never authorization identity;
-   RPCs/functions enforce appropriate roles;
-   SECURITY DEFINER functions use a fixed safe `search_path`;
-   execute grants are restricted appropriately;
-   JE cannot approve/reserve Finance capacity;
-   Finance/HO/Admin permissions follow existing ERP role rules;
-   Admin privileges do not bypass accounting invariants.

## 18. Backend / Frontend Responsibilities

### Backend

Backend owns canonical identity validation, capacity calculation, Final
Approved CE gating, reservation enforcement, concurrency control,
beneficiary validation/default resolution, ledger mutation, and
lifecycle transitions.

### Frontend

Frontend may display contractor, subcontract work, beneficiary, approved
capacity, consumed amount, remaining contractor capacity, remaining CE
capacity, and effective available amount.

Frontend validation is advisory only. Backend validation remains
authoritative.

## 19. Expected User Flow

``` text
JE opens Payment Requisition
        ↓
selects Work Order
        ↓
selects approved Subcontractor
        ↓
selects approved Subcontract Work
        ↓
beneficiary defaults from contractor master
        ↓
UI displays canonical available capacity
        ↓
JE enters requisition amount
        ↓
submits requisition
        ↓
HO/Finance approval transaction
        ↓
rechecks both capacities under lock
        ↓
reservation created
        ↓
Accounts payment/settlement
        ↓
reservation transitions to paid consumption
        ↓
remaining capacity updates
```

## 20. Required Audit Before Implementation

Before writing Phase 6 code, map the current Finance implementation:

1.  Payment Requisition schema and canonical fields currently available.
2.  JE creation controller/routes/UI.
3.  HO approval controller/RPC.
4.  Accounts/payment/settlement lifecycle.
5.  Current reservation semantics.
6.  `subcontractor_balances` writers/readers.
7.  `subcontractor_ledger` writers/readers.
8.  `ESTIMATE_ITEM_APPROVAL` writers/reversal paths.
9.  Main Head capacity calculation.
10. `approve_requisition_transact` and any `_unlocked` internal.
11. `create_subcontract_requisition_secure`.
12. `mainHeadCapacity.service.js`.
13. beneficiary master integration.
14. cancellation/rejection/reversal paths.
15. all places contractor identity is inferred from strings.
16. existing financial locks/advisory lock keys.
17. current definition of paid/settled consumption.
18. historical compatibility requirements.

The audit should produce an implementation map, not a redesign.

## 21. Implementation Constraints

Use the streamlined process:

``` text
AUDIT
  ↓
FROZEN CONTRACT
  ↓
ONE END-TO-END IMPLEMENTATION
  ↓
ADVERSARIAL REVIEW
  ↓
ONE FIX PASS
  ↓
FULL REGRESSION
  ↓
FREEZE
```

Avoid milestone chains, wrapper-on-wrapper RPC architecture, duplicate
capacity services, migration source surgery, broad Finance refactoring,
and speculative abstractions.

If the primary Phase 6 migration has not been shared/applied outside
development, amend it instead of producing a patch migration for every
review finding. Once shared/released, use forward-only migrations.

## 22. Required Adversarial Cases

At minimum verify:

1.  one contractor + one work;
2.  one contractor + multiple works;
3.  multiple contractors on the same work;
4.  contractor capacity below CE capacity;
5.  CE capacity below contractor capacity;
6.  exact-capacity requisition;
7.  requisition exceeding contractor capacity;
8.  requisition exceeding CE capacity;
9.  CE not Final Approved;
10. subcontract scope Final Approved but CE still under review;
11. concurrent approvals competing for the same remaining capacity;
12. two contractors sharing one Phase 5 generated CE work row;
13. reservation followed by payment without double counting;
14. rejection/cancellation releases reservation;
15. positive ADDITION increases authorization;
16. negative ADJUSTMENT above consumed floor succeeds;
17. negative ADJUSTMENT below consumed floor fails;
18. beneficiary defaults correctly;
19. spoofed display fields do not bypass UUID identity;
20. generated CE rows do not create legacy `ESTIMATE_ITEM_APPROVAL`
    credit;
21. canonical requisition does not depend on legacy subcontractor
    balance credit;
22. repeated/retried Finance operations remain idempotent where
    required.

## 23. Definition of Done

Phase 6 is complete when:

-   subcontract Finance uses canonical contractor/work UUID identity;
-   Final Approved Subcontract Estimate scope is the contractor-specific
    authorization source;
-   Final Approved Cost Estimate is independently required for financial
    use;
-   both capacity ceilings are enforced transactionally;
-   one canonical consumption definition is used by Phase 4 and Finance;
-   reservations and payments cannot double count;
-   concurrent approvals cannot overspend capacity;
-   beneficiary defaults come from canonical contractor master linkage;
-   new subcontract Payment Requisitions do not rely on legacy CE
    approval credits;
-   legacy behavior outside the new flow remains stable;
-   frontend capacity display uses the canonical backend read path;
-   focused Phase 6 tests pass;
-   concurrency tests pass;
-   full backend regression passes;
-   DB contract/security tests pass;
-   frontend production build passes;
-   no Phase 7 functionality is introduced.

## 24. Expected Outcome

After Phase 6:

``` text
Subcontractor Master + Work Master
            ↓
Subcontract Estimate
            ↓
Final Approved contractor/work authorization
            ↓
Project Cost Estimate
            ↓
Final Approved project-level authorization
            ↓
Payment Requisition
            ↓
Canonical reservation
            ↓
Accounts payment / settlement
            ↓
Canonical consumed + remaining capacity
```

Projects defines approved subcontract scope. Cost Estimate provides the
project-level financial ceiling. Finance consumes that authorization.
Accounts settles it. All modules refer to the same contractor/work
identities, and accounting invariants are enforced at transaction
boundaries rather than inferred from UI/display fields.

That is the Phase 6 freeze boundary.
