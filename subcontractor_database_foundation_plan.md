# Subcontractor Estimate V2 — Database Foundation Plan

**Repository:** `SN-Polymers-PVT-LTD/SNPolymers_ERP`  
**Branch reviewed:** `subcontractor-ledger`  
**Scope:** Phase 2 — Database foundation only  
**Implementation strategy:** Additive / non-destructive foundation first; no workflow or Finance behavior switch in this PR  
**Business baseline:** `subcontractor_estimate_business_rules_and_data_semantics (1).md`

---

## 1. Goal of this phase

This phase establishes the normalized database model required for the new Projects-side Subcontractor Estimate architecture without yet changing the behavior of the current Cost Estimate, Payment Requisition, or Finance Subcontractor Ledger flows.

The foundation must make the following future flow possible:

```text
Subcontract Work Master
        +
Subcontractor Master
        ↓
WO-specific Subcontractor Estimate
        ↓
JE → ZO → HO approval / revision / reopen
        ↓
Final Approved
        ├──────────────────────────────┐
        │                              │
        ▼                              ▼
Cost Estimate aggregation       Contractor monetary capacity
(one work row, weighted rate)   (WO + contractor + work)
        │                              │
        └─────────────┬────────────────┘
                      ▼
              Payment Requisition
                      ↓
              Existing Finance ledger
```

This PR must create the relational identities and provenance structures required for that flow while leaving the existing production behavior untouched.

---

# 2. Existing architecture traced from `main`

The following files are directly relevant to this foundation.

## 2.1 Migration infrastructure

### `backend/scripts/apply-migrations.js`

Current migration behavior:

- migration files live in `backend/src/db/migrations/`;
- each migration is executed in a transaction;
- applied files are tracked in `public._migration_log`;
- already-applied migration filenames are skipped;
- files are ordered by numeric prefix and then lexicographically.

The current migration history reaches `075_beneficiary_master_update_audit.sql`.

### Decision

Create a new forward-only migration:

```text
backend/src/db/migrations/076_subcontractor_estimate_foundation.sql
```

Do **not** edit:

```text
00_full_schema_dump.sql
047_subcontractor_ledger.sql
048_subcontractor_ledger_hardening.sql
...
075_beneficiary_master_update_audit.sql
```

Historical migrations must remain immutable.

---

## 2.2 Cost Estimate status model

### `backend/src/constants/estimate-status.js`

The Cost Estimate statuses are:

```text
Draft
Submitted
Under ZO Review
ZO Revision Requested
ZO Approved
Rejected by ZO
Under HO Review
HO Revision Requested
Final Approved
Rejected by HO
Estimate Reopened
```

### `backend/src/workflow/estimate-rules.js`

Existing Cost Estimate logic defines the editable/submittable statuses and row rejection semantics.

### Foundation decision

Do **not** create a second status enum.

The new Subcontractor Estimate header will reuse:

```sql
public.estimate_status_enum
```

and its row-level approvals will reuse:

```sql
public.row_approval_enum
```

This directly reflects the locked business rule that Subcontractor Estimates follow the same status vocabulary and approval lifecycle as Cost Estimates.

Actual workflow functions will be implemented in a later phase.

---

# 3. Existing Cost Estimate schema that must be mirrored selectively

## 3.1 `project_cost_estimates`

Relevant existing columns include:

```text
estimate_id
work_order_no
estimate_revision
estimate_amount
estimate_status
last_approved_amount

last_modified_by

je_user_id
je_date
je_remarks

zo_approved_by
zo_approval_date
zo_remarks

ho_approved_by
ho_approval_date
ho_remarks

created_by
created_at
updated_at
```

The new Subcontractor Estimate header should deliberately mirror this lifecycle shape.

Fields that are project metadata and can be resolved from `projects_master` should not automatically be duplicated unless required.

For the foundation, avoid duplicating:

```text
area_code
site details
state
district
department
```

because the Work Order is already the authoritative relation.

---

## 3.2 `project_cost_estimate_items`

Current Cost Estimate items contain:

```text
item_id
estimate_id

material_main_head
material_sub_head
material_details
unit

qty
rate
amount
rate_reference

source_of_purchase

zo_office_approve
zo_remarks

ho_office_approve
ho_remarks
```

and currently enforce:

```text
amount = ROUND(qty × rate, 2)
```

The new Subcontractor Estimate line model should reuse the numeric precision and row-approval conventions but use canonical foreign keys rather than Material Master strings for identity.

---

# 4. Existing reopen behavior that the new model must support

### `backend/src/controllers/estimates.items.controller.js`

The existing Cost Estimate implementation already contains a useful model:

- HO-approved rows are permanently locked;
- previously approved rows remain locked after reopen;
- newly added rows during a reopen cycle can be added/edited/deleted before approval.

### `backend/src/controllers/estimates.workflow.controller.js`

The current reopen process:

- is HO/Admin controlled;
- preserves existing row decisions;
- creates a new revision log entry;
- changes header status to `Estimate Reopened`;
- does not rewrite historical approved rows.

### Foundation implication

The Subcontractor Estimate line table must **not** have a uniqueness rule that forces the same subcontractor/work pair into one mutable record.

This business case must be legal:

```text
PUR01
Contractor C
700 mm Pipe Laying
200 Mtr @ ₹100
```

followed later by:

```text
PUR01
Contractor C
700 mm Pipe Laying
150 Mtr @ ₹105
```

Both are separate auditable source rows.

Therefore there must be **no UNIQUE constraint** on:

```text
(subcontract_estimate_id, subcontractor_id, subcontract_work_id)
```

---

# 5. Existing Finance subcontractor architecture

The current Finance implementation must be treated as mature behavior that we will bridge into later rather than rewrite immediately.

## 5.1 `047_subcontractor_ledger.sql`

The current architecture explicitly treats Material Master rows with:

```text
Material_Main_Head = 'Sub Contractor'
```

as an identity for:

```text
(work package, subcontractor)
```

The current balance key is:

```text
work_order_no
+ material_main_head
+ material_sub_head
+ material_details
```

and HO approval of a Cost Estimate `Sub Contractor` item currently credits the Finance subcontractor balance.

That identity is obsolete under the new business rules, but this phase will not switch behavior yet.

---

## 5.2 `048_subcontractor_ledger_hardening.sql`

The existing ledger already has important financial invariants:

```text
available_balance = estimated_total - paid_total
```

as well as idempotency and transaction/reference taxonomy.

Do not weaken these in the foundation phase.

---

## 5.3 `065`, `066`, `067`, `069`

Later migrations establish:

- reservation vs settlement lifecycle;
- `RESERVED`, `SETTLED`, and `RELEASED`;
- actual-payment visibility;
- compensating releases;
- balance summary/read model;
- payment audit hardening.

### Foundation decision

Do not modify these semantics.

The future architecture should replace the **identity/source of authorization**, not the reservation/payment machinery.

---

# 6. Existing Projects beneficiary architecture

## 6.1 `projects_beneficiary_master`

The repository already has a Projects-side beneficiary directory with:

```text
id
beneficiary_name
beneficiary_ac_no
beneficiary_ifsc
beneficiary_bank_name
beneficiary_bank_id
last_used_at
created_by
updated_by
timestamps
```

It is already used by Payment Requisitions and is keyed by:

```text
beneficiary_ac_no + beneficiary_ifsc
```

## 6.2 `indian_bank_master`

Bank identity already has a normalized canonical table.

## 6.3 Existing Accounts reconciliation

The current Accounts reconciliation process can update the shared Projects beneficiary directory and audit beneficiary changes.

### Senior recommendation

Do **not** create a second set of bank columns directly inside `subcontractor_master`.

Instead use:

```text
subcontractor_master.primary_beneficiary_id
        ↓
projects_beneficiary_master.id
```

The Projects-side Subcontractor Master UI can still display/edit the beneficiary fields as part of the subcontractor form, but persistence should reuse the existing beneficiary directory.

This preserves:

- one canonical bank directory;
- existing IFSC/account uniqueness;
- existing bank validation;
- existing Accounts reconciliation;
- existing beneficiary audit trail;
- clean Payment Requisition autofill.

This relationship is part of the foundation contract:

```text
subcontractor_master.primary_beneficiary_id
        ↓
projects_beneficiary_master.id
```

The Subcontractor Master must not duplicate beneficiary account, IFSC, bank, or beneficiary-name columns. Payment Requisitions may retain the selected `beneficiary_id` plus the existing beneficiary snapshot fields for auditability.

This is a physical-schema refinement only; it does not change the agreed business behavior.

---

# 7. Proposed migration: `076_subcontractor_estimate_foundation.sql`

The migration should contain six logical sections.

---

# 8. Table 1 — `subcontract_work_master`

## Purpose

Canonical global catalogue of subcontract work shared across all Work Orders.

It must not be contractor-specific and must not contain WO quantities or rates.

## Proposed schema

```sql
CREATE TABLE public.subcontract_work_master (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    sub_head         varchar NOT NULL,
    material_details varchar NOT NULL,
    unit             varchar NOT NULL,

    is_active        boolean NOT NULL DEFAULT true,

    created_by       varchar NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       varchar,
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_swm_created_by
      FOREIGN KEY (created_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT fk_swm_updated_by
      FOREIGN KEY (updated_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT chk_swm_sub_head_nonempty
      CHECK (btrim(sub_head) <> ''),

    CONSTRAINT chk_swm_details_nonempty
      CHECK (btrim(material_details) <> ''),

    CONSTRAINT chk_swm_unit_nonempty
      CHECK (btrim(unit) <> '')
);
```

## Why `material_main_head` should not be stored

For this table, the semantic main head is always:

```text
Sub Contractor
```

Storing that text on every row creates redundant data and another opportunity for drift.

When the work is eventually projected into Cost Estimate:

```text
material_main_head = 'Sub Contractor'
```

can be generated by the integration layer.

## Normalized uniqueness

Create a case/whitespace-insensitive unique index:

```sql
CREATE UNIQUE INDEX uq_subcontract_work_master_identity
ON public.subcontract_work_master (
    lower(btrim(sub_head)),
    lower(btrim(material_details)),
    lower(btrim(unit))
);
```

This prevents accidental duplicates such as:

```text
DI Pipe Line Work / 700 mm Pipe Laying / Mtr
di pipe line work / 700 mm pipe laying / mtr
```

while allowing different work items or units.

## Performance indexes

```sql
CREATE INDEX idx_swm_active
ON public.subcontract_work_master(is_active);

CREATE INDEX idx_swm_sub_head
ON public.subcontract_work_master(sub_head);
```

---

# 9. Table 2 — `subcontractor_master`

## Purpose

Canonical Projects-side identity for an actual subcontractor.

This is separate from:

- Material Master;
- Subcontract Work Master;
- beneficiary/payment identity.

## Proposed schema

```sql
CREATE TABLE public.subcontractor_master (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    subcontractor_name       varchar NOT NULL,
    contact_person           varchar,
    mobile                   varchar,
    email                    varchar,
    address                  text,

    pan_no                   varchar,
    gst_no                   varchar,

    primary_beneficiary_id   uuid,

    is_active                boolean NOT NULL DEFAULT true,

    created_by               varchar NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_by               varchar,
    updated_at               timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_scm_primary_beneficiary
      FOREIGN KEY (primary_beneficiary_id)
      REFERENCES public.projects_beneficiary_master(id)
      ON DELETE SET NULL,

    CONSTRAINT fk_scm_created_by
      FOREIGN KEY (created_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT fk_scm_updated_by
      FOREIGN KEY (updated_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT chk_scm_name_nonempty
      CHECK (btrim(subcontractor_name) <> '')
);
```

## Do not add an unconditional UNIQUE constraint on name

Two legal entities may have similar or identical trading names.

Canonical identity is the UUID.

If the business later guarantees uniqueness through PAN/GST, partial normalized unique indexes can be added after actual data rules are confirmed.

## Do not make a human code mandatory yet

A generated code such as `SC001` may be useful in the UI, but it was not part of the locked business rules.

Do not create a database invariant around an unconfirmed display convention.

---

# 10. Table 3 — `project_subcontract_estimates`

## Purpose

WO-specific header for the JE-created Subcontractor Estimate.

## Proposed schema

```sql
CREATE TABLE public.project_subcontract_estimates (
    subcontract_estimate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    work_order_no           varchar NOT NULL,

    estimate_revision       integer NOT NULL DEFAULT 0,
    estimate_amount         numeric(18,2) NOT NULL DEFAULT 0,
    estimate_status         public.estimate_status_enum
                            NOT NULL DEFAULT 'Draft',
    last_approved_amount    numeric(18,2),

    last_modified_by        varchar,

    je_user_id              varchar,
    je_date                 timestamptz,
    je_remarks              text,

    zo_approved_by          varchar,
    zo_approval_date        timestamptz,
    zo_remarks              text,

    ho_approved_by          varchar,
    ho_approval_date        timestamptz,
    ho_remarks              text,

    created_by              varchar NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_pse_work_order
      FOREIGN KEY (work_order_no)
      REFERENCES public.projects_master(work_order_no)
      ON DELETE RESTRICT,

    CONSTRAINT fk_pse_created_by
      FOREIGN KEY (created_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT fk_pse_last_modified_by
      FOREIGN KEY (last_modified_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT fk_pse_je
      FOREIGN KEY (je_user_id)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT fk_pse_zo
      FOREIGN KEY (zo_approved_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT fk_pse_ho
      FOREIGN KEY (ho_approved_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT chk_pse_revision_nonnegative
      CHECK (estimate_revision >= 0),

    CONSTRAINT chk_pse_amount_nonnegative
      CHECK (estimate_amount >= 0),

    CONSTRAINT chk_pse_last_approved_nonnegative
      CHECK (last_approved_amount IS NULL OR last_approved_amount >= 0)
);
```

## One logical subcontract estimate per WO

The agreed reopen model strongly implies that subsequent approved scope is appended by reopening the same logical estimate rather than creating parallel active estimates.

Enforce at DB level:

```sql
CREATE UNIQUE INDEX uq_pse_one_live_estimate_per_wo
ON public.project_subcontract_estimates(work_order_no)
WHERE estimate_status NOT IN ('Rejected by ZO', 'Rejected by HO');
```

That gives race-condition protection missing from application-only checks.

Rejected estimates remain historical, and a replacement estimate can be created if required.

## Other indexes

```sql
CREATE INDEX idx_pse_work_order
ON public.project_subcontract_estimates(work_order_no);

CREATE INDEX idx_pse_status
ON public.project_subcontract_estimates(estimate_status);

CREATE INDEX idx_pse_updated_at
ON public.project_subcontract_estimates(updated_at DESC);
```

---

# 11. Table 4 — `project_subcontract_estimate_lines`

## Purpose

Immutable-source line records defining approved work by:

```text
WO
+ Subcontractor
+ Subcontract Work
+ Qty
+ Rate
```

## Proposed schema

```sql
CREATE TABLE public.project_subcontract_estimate_lines (
    line_id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    subcontract_estimate_id   uuid NOT NULL,
    subcontractor_id          uuid NOT NULL,
    subcontract_work_id       uuid NOT NULL,

    qty                       numeric(18,4) NOT NULL DEFAULT 0,
    rate                      numeric(18,4) NOT NULL DEFAULT 0,
    amount                    numeric(18,2) NOT NULL DEFAULT 0,

    rate_reference            varchar,
    remarks                   text,

    entry_kind                varchar NOT NULL DEFAULT 'BASE',
    adjusts_line_id           uuid,

    zo_office_approve         public.row_approval_enum,
    zo_remarks                text,

    ho_office_approve         public.row_approval_enum,
    ho_remarks                text,

    created_by                varchar NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_by                varchar,
    updated_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_psel_estimate
      FOREIGN KEY (subcontract_estimate_id)
      REFERENCES public.project_subcontract_estimates(subcontract_estimate_id)
      ON DELETE RESTRICT,

    CONSTRAINT fk_psel_subcontractor
      FOREIGN KEY (subcontractor_id)
      REFERENCES public.subcontractor_master(id)
      ON DELETE RESTRICT,

    CONSTRAINT fk_psel_work
      FOREIGN KEY (subcontract_work_id)
      REFERENCES public.subcontract_work_master(id)
      ON DELETE RESTRICT,

    CONSTRAINT fk_psel_adjusted_line
      FOREIGN KEY (adjusts_line_id)
      REFERENCES public.project_subcontract_estimate_lines(line_id)
      ON DELETE RESTRICT,

    CONSTRAINT fk_psel_created_by
      FOREIGN KEY (created_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT fk_psel_updated_by
      FOREIGN KEY (updated_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT chk_psel_amount
      CHECK (amount = round(qty * rate, 2)),

    CONSTRAINT chk_psel_entry_kind
      CHECK (entry_kind IN ('BASE', 'ADDITION', 'ADJUSTMENT')),

    CONSTRAINT chk_psel_positive_values
      CHECK (
        (
          entry_kind IN ('BASE', 'ADDITION')
          AND adjusts_line_id IS NULL
          AND qty > 0
          AND rate > 0
          AND amount > 0
        )
        OR
        (
          entry_kind = 'ADJUSTMENT'
          AND adjusts_line_id IS NOT NULL
        )
      )
);
```

## Important: repeated work is deliberately allowed

Do **not** add:

```sql
UNIQUE (
  subcontract_estimate_id,
  subcontractor_id,
  subcontract_work_id
)
```

because the business rule explicitly requires individually auditable repeated assignments.

Example:

```text
Line A
Contractor C
700 mm Pipe Laying
200 × 100

Line B
Contractor C
700 mm Pipe Laying
150 × 105
```

Both must remain separate rows.

## `entry_kind`

This supports the locked append-only revision rule:

```text
BASE        initial estimate line
ADDITION    new additional approved scope
ADJUSTMENT  signed delta against a previously approved source line
```

Approved BASE, ADDITION, and ADJUSTMENT rows are immutable. Scope increases use ADDITION; corrections or reductions use a new signed ADJUSTMENT referencing the affected approved source line.

The current amount identity remains:

```text
amount = qty × rate
```

BASE and ADDITION rows require positive quantity, rate, and amount. ADJUSTMENT rows may contain signed quantity and amount deltas, while preserving the rounded amount identity.

Cross-row validation is intentionally deferred to the authoritative workflow/RPC: same estimate/subcontractor/work scope, referenced source approval state, non-negative effective totals, and Finance consumed-capacity protection.

## Indexes

```sql
CREATE INDEX idx_psel_estimate
ON public.project_subcontract_estimate_lines(subcontract_estimate_id);

CREATE INDEX idx_psel_subcontractor
ON public.project_subcontract_estimate_lines(subcontractor_id);

CREATE INDEX idx_psel_work
ON public.project_subcontract_estimate_lines(subcontract_work_id);

CREATE INDEX idx_psel_estimate_work
ON public.project_subcontract_estimate_lines(
    subcontract_estimate_id,
    subcontract_work_id
);

CREATE INDEX idx_psel_estimate_party_work
ON public.project_subcontract_estimate_lines(
    subcontract_estimate_id,
    subcontractor_id,
    subcontract_work_id
);
```

The last two indexes directly support:

- Cost Estimate aggregation by work;
- contractor-specific Finance capacity calculation.

---

# 12. Table 5 — `subcontract_estimate_revision_log`

## Purpose

Keep Subcontractor Estimate revision/reopen history separate from Cost Estimate revision history while using the same lifecycle semantics.

Do not overload `estimate_revision_log`, because that table is explicitly FK-bound to `project_cost_estimates`.

## Proposed schema

```sql
CREATE TABLE public.subcontract_estimate_revision_log (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    subcontract_estimate_id  uuid NOT NULL,

    revision_cycle           integer NOT NULL DEFAULT 1,
    stage                    varchar NOT NULL,

    requested_by             varchar NOT NULL,
    revision_deadline        timestamptz NOT NULL,

    resubmitted_at           timestamptz,
    resubmitted_by           varchar,

    is_auto_resubmitted      boolean NOT NULL DEFAULT false,

    modified_line_ids        uuid[] NOT NULL DEFAULT '{}',

    created_at               timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_serl_estimate
      FOREIGN KEY (subcontract_estimate_id)
      REFERENCES public.project_subcontract_estimates(subcontract_estimate_id)
      ON DELETE RESTRICT,

    CONSTRAINT fk_serl_requested_by
      FOREIGN KEY (requested_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT fk_serl_resubmitted_by
      FOREIGN KEY (resubmitted_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT chk_serl_stage
      CHECK (stage IN ('ZO', 'HO')),

    CONSTRAINT chk_serl_cycle_positive
      CHECK (revision_cycle >= 1)
);
```

## One active revision/reopen cycle

```sql
CREATE UNIQUE INDEX uq_serl_one_active_revision
ON public.subcontract_estimate_revision_log(subcontract_estimate_id)
WHERE resubmitted_at IS NULL;
```

This mirrors the current Cost Estimate invariant.

---

# 13. Table 6 — `cost_estimate_subcontract_contributions`

## Purpose

This table is required by the business rule that:

- multiple approved contractor-specific source lines become one Cost Estimate work row;
- later approved additions update the same logical Cost Estimate row;
- approved source contributions must remain auditable.

It is the bridge between immutable source rows and the consolidated Cost Estimate row.

## Proposed schema

```sql
CREATE TABLE public.cost_estimate_subcontract_contributions (
    contribution_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    cost_estimate_item_id        uuid NOT NULL,
    subcontract_estimate_line_id uuid NOT NULL,

    qty_contribution             numeric(18,4) NOT NULL,
    amount_contribution          numeric(18,2) NOT NULL,

    created_by                   varchar,
    created_at                   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_cesc_cost_item
      FOREIGN KEY (cost_estimate_item_id)
      REFERENCES public.project_cost_estimate_items(item_id)
      ON DELETE RESTRICT,

    CONSTRAINT fk_cesc_subcontract_line
      FOREIGN KEY (subcontract_estimate_line_id)
      REFERENCES public.project_subcontract_estimate_lines(line_id)
      ON DELETE RESTRICT,

    CONSTRAINT fk_cesc_created_by
      FOREIGN KEY (created_by)
      REFERENCES public.authorised_users(mobile_number)
      ON DELETE RESTRICT,

    CONSTRAINT uq_cesc_item_source_line
      UNIQUE (cost_estimate_item_id, subcontract_estimate_line_id)
);
```

## Why snapshots are stored

Although the source subcontract estimate row becomes immutable after approval, storing:

```text
qty_contribution
amount_contribution
```

on the link gives explicit audit provenance and protects Cost Estimate reconstruction from future schema evolution.

## Why the source line is not globally UNIQUE

A rejected Cost Estimate may later be replaced by another Cost Estimate header.

The same approved Subcontractor Estimate source line may need to be represented in that replacement estimate.

Therefore do not use:

```sql
UNIQUE (subcontract_estimate_line_id)
```

globally.

Idempotency within an active Cost Estimate will be enforced by the integration RPC later.

Add source-oriented indexes for automatic import and adjustment lookup:

```sql
CREATE INDEX idx_cesc_source_line
ON public.cost_estimate_subcontract_contributions(subcontract_estimate_line_id);

CREATE INDEX idx_psel_adjusts_line
ON public.project_subcontract_estimate_lines(adjusts_line_id)
WHERE adjusts_line_id IS NOT NULL;
```

## 13A. Automatic Cost Estimate import contract

The foundation must support automatic import of eligible Final Approved subcontractor estimate lines.

The later integration workflow must apply these rules:

- If a Work Order has a Cost Estimate in `Draft` or `Estimate Reopened` status, all eligible Final Approved subcontractor estimate lines are automatically appended.
- If no editable Cost Estimate exists, eligible lines remain pending and are imported when the Work Order's Cost Estimate becomes `Draft` or `Estimate Reopened`.
- If the Cost Estimate is `Final Approved`, pending contributions wait until HO reopens it and it enters `Estimate Reopened`.
- `ZO Revision Requested` and `HO Revision Requested` states do not receive new subcontract work rows.
- Import is append-only at the source-contribution level; previously approved source lines are never overwritten.
- Import is idempotent. A source line must not be imported more than once into the same Cost Estimate item. The existing unique constraint on `(cost_estimate_item_id, subcontract_estimate_line_id)` is the database guard for this rule.
- Absence of a contribution-link row represents an eligible-but-not-yet-imported source line; a separate queue table is not required for the foundation phase.

The integration RPC must validate that:

- the parent `project_subcontract_estimates.estimate_status` is `Final Approved`;
- the source line has `zo_office_approve = 'Approve'`;
- the source line has `ho_office_approve = 'Approve'`;
- the source line belongs to the same Work Order as the target Cost Estimate;
- the target Cost Estimate is `Draft` or `Estimate Reopened`.

---

# 14. Additive changes to existing Cost Estimate items

Add two nullable fields:

```sql
ALTER TABLE public.project_cost_estimate_items
  ADD COLUMN source_type varchar,
  ADD COLUMN subcontract_work_id uuid;
```

Foreign key:

```sql
ALTER TABLE public.project_cost_estimate_items
ADD CONSTRAINT fk_pcei_subcontract_work
FOREIGN KEY (subcontract_work_id)
REFERENCES public.subcontract_work_master(id)
ON DELETE RESTRICT;
```

Taxonomy:

```sql
ALTER TABLE public.project_cost_estimate_items
ADD CONSTRAINT chk_pcei_source_type
CHECK (
  source_type IS NULL
  OR source_type IN ('MANUAL', 'SUBCONTRACT_ESTIMATE')
);
```

The source taxonomy and canonical work identity are paired:

```sql
ALTER TABLE public.project_cost_estimate_items
ADD CONSTRAINT chk_pcei_subcontract_source_identity
CHECK (
  (
    source_type = 'SUBCONTRACT_ESTIMATE'
    AND subcontract_work_id IS NOT NULL
  )
  OR
  (
    (source_type IS NULL OR source_type = 'MANUAL')
    AND subcontract_work_id IS NULL
  )
);
```

## Intended future meaning

Normal Cost Estimate rows:

```text
source_type = MANUAL
```

Generated subcontract rows:

```text
source_type = SUBCONTRACT_ESTIMATE
subcontract_work_id = canonical work ID
```

During this foundation phase existing rows remain `NULL`.

No existing application behavior changes.

Generated subcontract rows must remain one logical Cost Estimate row per canonical subcontract work item:

```sql
CREATE UNIQUE INDEX uq_pcei_generated_subcontract_work
ON public.project_cost_estimate_items (
    estimate_id,
    subcontract_work_id
)
WHERE source_type = 'SUBCONTRACT_ESTIMATE';
```

This does not restrict ordinary manual rows or repeated source contribution lines.

---

# 15. Critical weighted-average compatibility issue

This needs to be explicitly tracked before the Cost Estimate integration phase.

The current `project_cost_estimate_items` table has:

```text
rate numeric(18,4)
```

and a strict constraint:

```text
amount = ROUND(qty × rate, 2)
```

That is safe for ordinary manually entered rows where amount is derived from qty × rate.

It is **not universally safe** for a consolidated subcontract row where:

```text
amount = exact sum of contractor amounts
rate   = amount / total qty
```

because the weighted rate may be repeating.

Example:

```text
Total Qty    = 1200
Total Amount = ₹122,900

Exact weighted rate
= 122900 / 1200
= 102.4166666...
```

If stored at four decimal places:

```text
rate = 102.4167
```

then:

```text
1200 × 102.4167 = 122,900.04
```

which violates the existing exact amount check.

## Foundation-phase handling

Do **not** drop or weaken the existing check in migration `076`.

That would exceed the additive-foundation scope.

Instead:

- add `source_type`;
- document this as a required integration change;
- in the Cost Estimate integration migration, modify the constraint so manual rows retain the strict `qty × rate` rule while `SUBCONTRACT_ESTIMATE` rows treat the summed contribution amount as authoritative.

Likely future rule:

```text
MANUAL:
    amount = ROUND(qty × rate, 2)

SUBCONTRACT_ESTIMATE:
    amount = SUM(source contribution amounts)
    rate   = amount / qty for presentation
```

This must be handled before any generated subcontract row is written.

---

# 16. Additive links to `requisitions`

Add:

```sql
ALTER TABLE public.requisitions
  ADD COLUMN subcontractor_id uuid,
  ADD COLUMN subcontract_work_id uuid;
```

FKs:

```sql
FOREIGN KEY (subcontractor_id)
REFERENCES public.subcontractor_master(id)
ON DELETE RESTRICT;

FOREIGN KEY (subcontract_work_id)
REFERENCES public.subcontract_work_master(id)
ON DELETE RESTRICT;
```

Index:

```sql
CREATE INDEX idx_requisitions_subcontract_scope
ON public.requisitions(
    work_order_no,
    subcontractor_id,
    subcontract_work_id
)
WHERE subcontractor_id IS NOT NULL;
```

## Pooled requisition capacity

Payment Requisitions identify the pooled contractor/work scope:

```text
WO + subcontractor + subcontract work
```

Repeated source lines remain separate for audit. A single requisition does not claim one source line as its exact allocation; cumulative capacity is enforced across the full Work Order + Subcontractor + Subcontract Work combination. If exact source allocation is later required, introduce a many-to-many allocation table rather than adding a single source-line FK to `requisitions`.

The later Finance integration must calculate pooled capacity only from Final Approved BASE, ADDITION, and ADJUSTMENT contributions belonging to the same Work Order + Subcontractor + Subcontract Work scope.

Before a negative adjustment is Final Approved, the authoritative workflow/RPC must atomically verify:

```text
new effective approved amount
    >= active Finance reservations + settled payments
```

The foundation migration only creates the columns and structural constraints; this financial safety check belongs to the later transactional workflow/integration phase.

---

# 17. Additive links to `subcontractor_balances`

Current balance identity remains untouched in this phase.

Add nullable relational columns:

```sql
ALTER TABLE public.subcontractor_balances
  ADD COLUMN subcontractor_id uuid,
  ADD COLUMN subcontract_work_id uuid;
```

with FKs to the two new masters.

Add:

```sql
CREATE INDEX idx_scb_relational_scope
ON public.subcontractor_balances(
    work_order_no,
    subcontractor_id,
    subcontract_work_id
);
```

## Important

Do **not** change the current primary key yet.

The current Finance logic still reads/writes using:

```text
work_order_no
material_main_head
material_sub_head
material_details
```

Changing the primary key now would switch behavior prematurely.

The later Finance bridge migration will move the authoritative balance identity to:

```text
work_order_no
subcontractor_id
subcontract_work_id
```

after all credit/debit RPCs have been updated atomically.

---

# 18. Additive links to `subcontractor_ledger`

Add:

```sql
ALTER TABLE public.subcontractor_ledger
  ADD COLUMN subcontractor_id uuid,
  ADD COLUMN subcontract_work_id uuid;
```

with FKs to the new masters.

Add:

```sql
CREATE INDEX idx_scl_relational_scope
ON public.subcontractor_ledger(
    work_order_no,
    subcontractor_id,
    subcontract_work_id
);
```

## Do not change ledger taxonomy yet

Do not yet change:

```text
ESTIMATE_ITEM_APPROVAL
ESTIMATE_ITEM_REVERSAL
REQUISITION_APPROVAL
REQUISITION_PAYMENT
REQUISITION_RELEASE
ADMIN_ADJUSTMENT
```

or their reference-type checks.

The source of contractor credit will move from Cost Estimate approval to Subcontractor Estimate Final Approval in a later Finance integration phase.

Changing transaction taxonomy now creates a half-migrated financial system.

---

# 19. RLS and permissions

The database contains an event trigger that automatically enables RLS for newly created `public` tables.

The backend uses Supabase's service-role client.

For the new tables, the foundation should therefore explicitly grant backend access while avoiding unnecessarily broad client access.

Recommended initial grants:

```sql
GRANT ALL ON public.subcontract_work_master TO service_role;
GRANT ALL ON public.subcontractor_master TO service_role;
GRANT ALL ON public.project_subcontract_estimates TO service_role;
GRANT ALL ON public.project_subcontract_estimate_lines TO service_role;
GRANT ALL ON public.subcontract_estimate_revision_log TO service_role;
GRANT ALL ON public.cost_estimate_subcontract_contributions TO service_role;
```

Do not copy the older pattern of broad `anon` write access.

When APIs/pages are implemented, direct authenticated access can be added only if actually needed.

---

# 20. Updated-at handling

The existing schema uses table-specific `BEFORE UPDATE` trigger functions.

For this phase either:

1. create one reusable generic function such as:

```sql
public.set_updated_at()
```

and use it for new tables, or

2. define table-specific trigger functions to remain stylistically consistent with the current schema.

Recommended approach: use one generic new function for the new tables only.

Apply it to:

```text
subcontract_work_master
subcontractor_master
project_subcontract_estimates
project_subcontract_estimate_lines
```

Revision/contribution rows are append-oriented and do not require a mutable `updated_at` field unless later workflow semantics require one.

---

# 21. What migration `076` must NOT do

This boundary is important.

Do not modify:

```text
submit_row_approvals
submit_zo_review
submit_ho_review
submit_estimate
create_requisition_secure
approve_requisition_transact
record_subcontractor_payment
release_requisition_commitment_transact
computeSubcontractorCapacity
```

Do not:

- credit balances from Subcontractor Estimate yet;
- stop Cost Estimate items from crediting the existing ledger yet;
- alter Payment Requisition validation yet;
- change the Finance read model yet;
- change ledger settlement logic;
- change Cost Estimate UI/API behavior;
- import the Excel workbook into production tables yet;
- remove old `Sub Contractor` Material Master rows yet;
- change existing ledger PKs yet;
- seed fake compatibility data.

This PR is structure only.

The foundation migration must not treat Final Approved Subcontractor Estimate lines as usable Sub Contractor Main Head capacity. Main Head capacity becomes usable only after the related Cost Estimate has reached `Final Approved`. The later integration must preserve this sequencing when automatic contributions are imported and the Cost Estimate is subsequently approved.

---

# 22. Schema contract / manifest changes

The current schema contract scope does not cover several tables involved in this feature.

Update:

```text
backend/tests/manifests/manifestScope.json
```

to include at minimum:

```text
project_cost_estimate_items
estimate_revision_log

projects_beneficiary_master
indian_bank_master

subcontractor_balances
subcontractor_ledger

subcontract_work_master
subcontractor_master
project_subcontract_estimates
project_subcontract_estimate_lines
subcontract_estimate_revision_log
cost_estimate_subcontract_contributions
```

`requisitions` is already included.

Then regenerate:

```bash
npm run generate:schema-manifest
```

Do not hand-edit:

```text
schemaManifest.generated.js
```

---

# 23. Index contract changes

Current index-contract coverage is allowlist based.

Update:

```text
backend/tests/manifests/indexAllowlist.json
```

with the important new indexes.

At minimum include:

```text
uq_subcontract_work_master_identity
idx_swm_active
idx_swm_sub_head

uq_pse_one_live_estimate_per_wo
idx_pse_work_order
idx_pse_status

idx_psel_estimate
idx_psel_subcontractor
idx_psel_work
idx_psel_estimate_work
idx_psel_estimate_party_work

uq_serl_one_active_revision

idx_requisitions_subcontract_scope
idx_scb_relational_scope
idx_scl_relational_scope
```

Then run:

```bash
npm run generate:index-manifest
```

or:

```bash
npm run generate:manifests
```

---

# 24. New regression test file

Create:

```text
backend/tests/vitest/regression/subcontractorEstimateFoundation.test.js
```

The test must validate the actual business/data invariants rather than merely checking that tables exist.

---

## Test group A — Work Master

Verify:

1. work can be inserted;
2. invalid creator FK fails;
3. empty sub-head fails;
4. empty work detail fails;
5. normalized duplicate work fails;
6. same sub-head with a different work item succeeds;
7. inactive records remain stored.

---

## Test group B — Subcontractor Master

Verify:

1. subcontractor can be inserted;
2. duplicate name is allowed;
3. nonexistent beneficiary FK fails;
4. valid `projects_beneficiary_master` record can be linked;
5. deleting a linked beneficiary sets `primary_beneficiary_id` to NULL;
6. invalid audit actor fails.

---

## Test group C — Estimate Header

Verify:

1. valid WO accepts a Draft subcontract estimate;
2. nonexistent WO fails;
3. status is backed by `estimate_status_enum`;
4. negative revision fails;
5. negative total fails;
6. a second live estimate for the same WO fails;
7. a rejected header does not permanently prevent creation of a replacement;
8. actor FKs are enforced.

---

## Test group D — Estimate Lines

Verify:

1. valid line can be inserted;
2. invalid subcontractor FK fails;
3. invalid work FK fails;
4. invalid header FK fails;
5. amount mismatch fails;
6. two lines with the exact same:

```text
estimate
subcontractor
work
```

are allowed;

7. `ADDITION` is allowed as a separate row;
8. `ADJUSTMENT` with a valid source reference succeeds structurally;
9. `BASE` with an adjustment reference fails;
10. `ADDITION` with an adjustment reference fails;
11. `ADJUSTMENT` without an adjustment reference fails;
12. BASE/ADDITION zero or negative quantity, rate, or amount values fail;
13. deleting a referenced source line fails;
14. adjustment cross-row approval and Finance-capacity rules are deferred to workflow tests.

This test is essential because repeated source lines are a locked business rule.

---

## Test group E — Revision Log

Verify:

1. revision record accepts stages `ZO` and `HO`;
2. invalid stage fails;
3. one open revision per estimate is allowed;
4. second open revision fails;
5. after first is closed, another revision cycle succeeds.

---

## Test group F — Cost Estimate provenance

Verify:

1. contribution can link one Cost Estimate item to one Subcontract Estimate line;
2. duplicate `(cost_item, source_line)` fails;
3. multiple source lines may link to the same Cost Estimate item;
4. one source line may link to a replacement Cost Estimate item if required by a rejected/recreated Cost Estimate scenario;
5. invalid FK fails.

---

## Test group G — Existing tables remain backward-compatible

Verify a normal existing insert can still happen without providing:

```text
subcontractor_id
subcontract_work_id
```

for:

```text
requisitions
subcontractor_balances
subcontractor_ledger
```

This proves migration `076` is additive.

---

# 25. Existing regression suites that must remain green

At minimum run the existing tests that exercise the parts we are structurally touching:

```text
tests/vitest/regression/subcontractorLedger.test.js
tests/vitest/regression/subcontractorLedgerGaps1to5.test.js
tests/vitest/regression/subcontractorLedgerGaps6to10.test.js
tests/vitest/regression/subcontractorLedgerP0Remediation.test.js

tests/vitest/regression/estimateReopenItemEditing.test.js

tests/vitest/regression/businessRuleInvariants.test.js
tests/vitest/regression/financialInvariants.test.js

tests/vitest/milestones/payment_requisition_capacity.test.js
```

and DB contracts:

```bash
npm run test:contracts:db
```

Full regression:

```bash
npm run test:regression
```

Full normal local suite before merge:

```bash
npm run test:local
```

The local test script already starts/uses local Supabase and applies pending migrations before tests.

---

# 26. Migration verification sequence

Recommended implementation procedure:

```text
1. Create migration 076
        ↓
2. Add/modify schema manifest scope
        ↓
3. Add index allowlist entries
        ↓
4. Start local Supabase
        ↓
5. Apply migration
        ↓
6. Inspect new tables / FKs / indexes manually
        ↓
7. Regenerate schema + index manifests
        ↓
8. Add foundation regression tests
        ↓
9. Run targeted tests
        ↓
10. Run all DB contract tests
        ↓
11. Run full regression suite
        ↓
12. Run full test:local
        ↓
13. Review generated manifest diff
        ↓
14. Deploy migration to dev DB
        ↓
15. Verify dev schema against manifest
```

---

# 27. Manual database checks after migration

Run checks equivalent to:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'subcontract_work_master',
    'subcontractor_master',
    'project_subcontract_estimates',
    'project_subcontract_estimate_lines',
    'subcontract_estimate_revision_log',
    'cost_estimate_subcontract_contributions'
  );
```

Inspect FKs:

```sql
SELECT
  conname,
  conrelid::regclass,
  confrelid::regclass
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text IN (
    'subcontract_work_master',
    'subcontractor_master',
    'project_subcontract_estimates',
    'project_subcontract_estimate_lines',
    'subcontract_estimate_revision_log',
    'cost_estimate_subcontract_contributions'
  );
```

Inspect indexes:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'subcontract_work_master',
    'subcontractor_master',
    'project_subcontract_estimates',
    'project_subcontract_estimate_lines',
    'subcontract_estimate_revision_log',
    'cost_estimate_subcontract_contributions',
    'requisitions',
    'subcontractor_balances',
    'subcontractor_ledger'
  )
ORDER BY tablename, indexname;
```

---

# 28. Production reset implications

The product owner has confirmed that production can be reset for this redesign.

That changes the eventual migration strategy, but it should **not** tempt us to make migration `076` destructive.

Why keep `076` additive anyway:

- local/dev databases contain existing fixtures and tests;
- current Finance flows must remain testable while Projects-side functionality is built;
- the feature will land over multiple PRs;
- later PRs can migrate behavior atomically;
- rollback/debugging is much easier when the schema foundation does not simultaneously rewrite financial logic.

Once the entire V2 path is complete and validated, production can be rebuilt/seeded on the normalized architecture without preserving old fake-material subcontractor data.

---

# 29. Important design decision: beneficiary normalization

The earlier business-rules document describes beneficiary fields conceptually as part of the Projects-side Subcontractor Master.

At the UI/business level, keep that behavior:

```text
Edit Subcontractor
  ├── Identity
  ├── Contact
  └── Beneficiary Details
```

At the physical database level use:

```text
subcontractor_master
    primary_beneficiary_id
            ↓
projects_beneficiary_master
```

instead of storing a second copy of:

```text
beneficiary_name
account_number
IFSC
bank
```

on the subcontractor row.

The Payment Requisition later resolves:

```text
subcontractor_id
        ↓
subcontractor_master.primary_beneficiary_id
        ↓
projects_beneficiary_master
        ↓
autofill requisition beneficiary snapshot
```

This is the cleanest fit with the current repository.

---

# 30. Important design decision: Finance capacity identity

The final target identity is:

```text
work_order_no
+ subcontractor_id
+ subcontract_work_id
```

not:

```text
work_order_no
+ material_sub_head
+ material_details
```

However migration `076` only introduces the new IDs as nullable columns.

It does not change balance keys or RPC logic.

Later Finance integration will:

1. move balance credits to Final Approved Subcontractor Estimate work;
2. populate canonical IDs;
3. change capacity queries to use those IDs;
4. migrate/recreate the balance primary key;
5. change ledger joins/read model;
6. remove string identity as an authoritative key.

This ordering avoids an intermediate state where Finance uses IDs but its upstream approval source still uses old Cost Estimate strings.

---

# 31. Important design decision: Cost Estimate aggregation

The foundation must support:

```text
Approved source lines
    C / 400 @ 100
    D / 300 @ 105
    B / 300 @ 98
            ↓
one Cost Estimate item
            ↓
Qty    1000
Amount 100900
Rate   100.90
```

Later additions:

```text
X / 200 @ 110
```

must append provenance and update the same logical work row.

The key is:

```text
subcontract_work_id
```

not:

```text
display strings
contractor
rate
```

The contribution table is the mechanism that preserves this mapping.

---

# 32. Files expected to change in this PR

The database-foundation PR should be intentionally small in file count.

## Required

```text
backend/src/db/migrations/076_subcontractor_estimate_foundation.sql

backend/tests/manifests/manifestScope.json
backend/tests/manifests/indexAllowlist.json

backend/tests/manifests/schemaManifest.generated.js
backend/tests/manifests/indexManifest.generated.js

backend/tests/vitest/regression/subcontractorEstimateFoundation.test.js
```

## Optional documentation

```text
docs/subcontractor-estimate/database-foundation.md
```

## Files that should NOT change in this PR

```text
backend/src/controllers/estimates.*
backend/src/controllers/requisitions.controller.js
backend/src/services/mainHeadCapacity.service.js
backend/src/validation/estimate.schema.js
backend/src/validation/requisition.schema.js
backend/src/routes/*
frontend/*
```

If those files appear in the PR, the PR is likely crossing the intended phase boundary.

---

# 33. Acceptance criteria for Phase 2

The database foundation is complete only when all of the following are true.

### Master identity

- `subcontract_work_master` exists and is global.
- `subcontractor_master` exists and uses UUID identity.
- beneficiary linkage reuses `projects_beneficiary_master`.

### Estimate structure

- WO-specific Subcontractor Estimate header exists.
- it uses the existing Cost Estimate status enum.
- lines reference real subcontractors and real subcontract work IDs.
- repeated same contractor/work lines are legal.
- source rows can distinguish BASE, ADDITION, and signed ADJUSTMENT contributions.
- revision logs have one active cycle at a time.

### Cost Estimate provenance

- Cost Estimate items can carry `subcontract_work_id`.
- Cost Estimate items can identify generated source type.
- contribution table can map many approved subcontract lines to one Cost Estimate line.

### Finance preparation

- Requisition can carry nullable `subcontractor_id` + `subcontract_work_id`.
- existing balance/ledger tables can carry the same nullable IDs.
- old Finance logic remains functional.

### Safety

- all new FKs work;
- normalized work duplicates are blocked;
- current financial regression suites remain green;
- schema and index manifests reflect the new foundation;
- no existing RPC behavior changes;
- no current frontend behavior changes.

---

# 34. Corrective follow-up migrations

Migration `077_subcontractor_foundation_corrections.sql` is the forward-only hardening follow-up to `076`. It removes the misleading single-line requisition provenance column, tightens signed-adjustment structure, and adds source-oriented lookup indexes. Migration `078_subcontract_source_identity_null_fix.sql` makes the generated source/work pairing constraint NULL-safe. Migrations `076` and `077` remain immutable.

# 35. Follow-on work after this PR

Only after this foundation is merged should implementation continue in this order:

```text
PR 2
Subcontract Work Master + Subcontractor Master APIs/UI
        ↓
PR 3
Subcontractor Estimate draft CRUD
        ↓
PR 4
ZO/HO approval, revision, reopen workflow
        ↓
PR 5
Cost Estimate aggregation + weighted-rate compatibility
        ↓
PR 6
Finance capacity credit-source and identity migration
        ↓
PR 7
Payment Requisition integration + beneficiary autofill
        ↓
PR 8
Finance ledger/read-model/reporting update
        ↓
Final cleanup / normalized production reset
```

The PR 5/PR 6 boundary must be cut over atomically. The current legacy database hook credits `subcontractor_balances` when an HO approves a Cost Estimate `Sub Contractor` row using the legacy text identity. Generated aggregate rows must not become active while that hook is still authoritative; the legacy credit path must be disabled or replaced in the same deployment that enables the new Finance source/identity migration.

---

# 35. One rule to preserve throughout implementation

The architecture should maintain this separation:

```text
Projects
    decides approved work and approved contractor value

Cost Estimate
    presents consolidated WO cost

Finance
    controls reservation, payment and settlement
```

The new schema should never again use a subcontractor's display name or Material Master text as the authoritative financial identity.
