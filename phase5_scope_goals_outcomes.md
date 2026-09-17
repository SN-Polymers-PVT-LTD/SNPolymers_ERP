# Phase 5 — Cost Estimate Integration

## 1. Objective

Phase 5 integrates **Final Approved Subcontract Estimate contributions** into the existing **Project Cost Estimate** workflow.

The purpose of this phase is to project approved subcontract scope into the Cost Estimate without duplicating contractor-level detail or changing Finance behavior. The Cost Estimate should show the approved subcontract work at the **canonical work level**, while the Subcontract Estimate remains the source of truth for contractor allocation, revisions, and approval history.

Phase 5 must build on the frozen Phase 4 runtime and must not reopen or redesign Phase 4 workflow, authoring, or Finance logic.

---

## 2. Core Business Rule

Only **Final Approved** subcontract contributions are eligible to affect the Cost Estimate.

The Cost Estimate representation is grouped by:

```text
work_order_no + subcontract_work_id
```

not by subcontractor.

For each canonical subcontract work:

- all eligible approved contributions across subcontractors are aggregated;
- only **one generated Cost Estimate row** exists for that work;
- contractor identity remains exclusively in the Subcontract Estimate;
- the Cost Estimate row is system-generated and read-only.

Example:

```text
Subcontract Estimate

Contractor A — Brick Work — 40 qty × ₹100 = ₹4,000
Contractor B — Brick Work — 60 qty × ₹120 = ₹7,200

Cost Estimate

Brick Work
Qty    = 100
Amount = ₹11,200
Rate   = ₹112.00
```

The Cost Estimate row represents the approved work scope, not individual subcontractors.

---

## 3. Aggregation Semantics

For each `subcontract_work_id`:

```text
effective_qty
= SUM(qty of all Final Approved BASE / ADDITION / ADJUSTMENT contributions)

effective_amount
= SUM(amount of all Final Approved BASE / ADDITION / ADJUSTMENT contributions)
```

The authoritative Cost Estimate amount is:

```text
effective_amount
```

The displayed weighted rate is:

```text
weighted_rate = effective_amount / effective_qty
```

where `effective_qty > 0`.

The displayed rate may be rounded for presentation. Therefore:

```text
displayed_rate × qty
```

does not need to exactly reproduce the authoritative amount.

If the effective scope becomes:

```text
qty = 0
amount = 0
```

the work is considered fully cancelled and should not remain as an active generated Cost Estimate line.

---

## 4. Generated Cost Estimate Rows

Phase 5 must use the existing normalized Cost Estimate source fields:

```text
source_type = SUBCONTRACT_ESTIMATE
subcontract_work_id = <canonical work id>
```

Generated rows must:

- be created only by the system;
- be read-only to JE/ZO/HO/Admin through normal Cost Estimate editing;
- use `subcontract_work_master` for Sub Head, Work Details, and Unit;
- bypass Material Master validation;
- preserve the aggregated amount as authoritative;
- not use generic `amount = qty × rate` recalculation;
- maintain at most one generated row per Cost Estimate + `subcontract_work_id`.

Manual Cost Estimate rows continue to follow the existing Material Master workflow.

---

## 5. Provenance

Every generated Cost Estimate row must retain source-level provenance through:

```text
cost_estimate_subcontract_contributions
```

The provenance layer must identify exactly which Final Approved subcontract lines contributed to the generated Cost Estimate row.

This mapping is required for:

- auditability;
- reopen synchronization;
- idempotent updates;
- debugging;
- future Finance/reporting integration.

The generated Cost Estimate row is only a projection. The approved Subcontract Estimate lines remain the source of truth.

---

## 6. Initial Cost Estimate Integration

When a Work Order has Final Approved subcontract contributions and a Cost Estimate is being prepared:

1. load all eligible Final Approved subcontract contributions for the Work Order;
2. aggregate them by `subcontract_work_id`;
3. create or synchronize one generated Cost Estimate row per work;
4. write provenance for every contributing source line;
5. ensure the operation is idempotent.

Running synchronization twice with no source changes must produce the same database state and must not create duplicate rows or duplicate provenance.

---

## 7. Reopen and Revision Behaviour

Phase 5 must support Phase 4 reopen semantics without modifying historical approved rows.

Example:

```text
Revision 0
Brick Work = ₹100,000
→ Final Approved
→ Cost Estimate receives ₹100,000

Subcontract Estimate reopened

ADDITION = ₹20,000
ADJUSTMENT = -₹10,000
→ Final Approved

New effective approved scope = ₹110,000
```

After the new Final Approval, Cost Estimate synchronization must update the existing generated Brick Work row to:

```text
₹110,000
```

It must **not** create another Brick Work row.

Historical provenance remains auditable, while the current Cost Estimate projection reflects the latest effective Final Approved scope.

Unapproved Draft, ZO Review, HO Review, revision-requested, or rejected current contributions must never affect the Cost Estimate.

---

## 8. Transaction and Idempotency Requirements

The synchronization operation should be implemented as one canonical transactional database path.

It must:

- lock or otherwise serialize the target Cost Estimate/work rows;
- calculate eligible approved contributions from canonical source data;
- upsert generated Cost Estimate rows;
- reconcile provenance;
- remove generated rows whose effective scope is exactly zero;
- reject inconsistent or ambiguous states;
- leave no partial synchronization on failure.

Do not implement multiple competing synchronization paths in backend and frontend.

---

## 9. Legacy Finance Boundary

This is the most important deployment constraint in Phase 5.

The existing Cost Estimate workflow contains legacy `Sub Contractor` Finance behavior that interprets Cost Estimate rows as contractor-level financial capacity using display fields.

Phase 5 generated rows represent **work-level aggregation across contractors**.

Therefore:

> Generated Phase 5 Cost Estimate rows must not be processed by the old Cost Estimate → subcontractor balance/ledger credit path.

Before Phase 5 is enabled in production, the legacy Finance hook must either:

- explicitly skip `source_type = SUBCONTRACT_ESTIMATE` rows; or
- be replaced as part of the later canonical Finance cutover.

Phase 5 must not redesign the complete Finance subsystem, but it must prevent generated rows from being misinterpreted as contractor identity.

---

## 10. Out of Scope

Phase 5 does **not** include:

- redesigning the Subcontract Estimate workflow;
- changing Phase 4 BASE / ADDITION / ADJUSTMENT semantics;
- changing ZO/HO review logic;
- redesigning requisition approval;
- replacing subcontractor ledger architecture;
- changing payment settlement logic;
- building final subcontractor reporting;
- migrating all legacy Finance balances;
- Phase 6 capacity cutover.

Only the minimum Finance protection required to safely introduce generated Cost Estimate rows is in scope.

---

## 11. Expected Outcomes

Phase 5 is complete when:

1. Final Approved subcontract contributions automatically project into the Cost Estimate.
2. Each canonical work produces at most one generated Cost Estimate row.
3. Contributions from multiple contractors are consolidated correctly.
4. Amount is authoritative and weighted rate is presentation-only.
5. Generated rows cannot be manually edited.
6. Every generated row has auditable source-line provenance.
7. Reopen/final-approval cycles update existing generated rows idempotently.
8. Zero effective scope removes the active generated row cleanly.
9. Unapproved revisions never affect the Cost Estimate.
10. Legacy Finance cannot interpret generated work-level rows as contractor-level capacity.
11. Existing manual Cost Estimate behavior remains unchanged.
12. Regression tests prove initial sync, reopen sync, idempotency, zero-scope handling, and Finance isolation.

---

## 12. Definition of Done

The Phase 5 runtime should be explainable as:

```text
Final Approved Subcontract Contributions
                 ↓
aggregate by subcontract_work_id
                 ↓
one generated Cost Estimate row per work
                 ↓
exact source provenance
                 ↓
idempotent resynchronization after reopen/final approval
```

At the end of Phase 5, the Cost Estimate becomes a reliable projection of approved subcontract scope while contractor-level approval and financial identity remain anchored in the Subcontract Estimate.
