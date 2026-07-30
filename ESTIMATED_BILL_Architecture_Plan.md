# Estimated Bill Module — Architecture & Delivery Plan

**Project:** S.N. Polymers IDBP
**Module:** Estimated Bill (ZO/HO forecasting layer)
**Author:** Engineering
**Status:** Draft for review

---

## 1. Purpose and scope

The Estimated Bill module lets Zonal Office (ZO) and Head Office (HO) users record a forward-looking billing estimate against a Work Order, for cash-flow forecasting. It is deliberately **not** a workflow module — no drafts, no submission, no approval chain. One Work Order maps to at most one Estimated Bill record, which is created on first save and overwritten on every subsequent save (upsert).

Out of scope for this module: reconciliation against actual RA/Final Bills (flagged as a possible future phase, see §9), revision history, and JE-level access.

---

## 2. Business logic specification

### 2.1 Actors and visibility

| Role | Can view | Can create / edit |
|---|---|---|
| ZO | Work Orders where `projects_master.zo_user_id` = self | Same set only |
| HO | All Work Orders | All records |
| JE / Staff | No access | No access |

Visibility is derived from the existing `zo_user_id` column on `projects_master` (added in migration 24) — **not** a new mapping table. This keeps the module consistent with how ZO scoping already works for Fund Requests and Requisitions.

### 2.2 Data model rule

One Work Order → one Estimated Bill record. Enforced with a `UNIQUE` constraint on `work_order_no`, not application logic — the same guarantee `active_estimate_unique_index` gives the estimates module.

### 2.3 Workflow (there isn't one)

```
ZO / HO
   |
   v
Select Work Order
   |
   +-- record exists?  --yes--> load into form --> edit --> Save --> UPDATE
   |
   +-- no record       --no---> autofill master data --> fill in --> Save --> INSERT
```

No status field. No `submitted_at`. No approval actor. A single `POST /estimated-bills` upsert endpoint serves both paths — the client never has to know which one it's calling.

### 2.4 Field specification

| Field | Source | Editable | Notes |
|---|---|---|---|
| `user_id` | session (JWT) | No | mobile number of acting user |
| `login_date` | session | No | display only, not persisted separately — covered by `created_at`/`updated_at` |
| `work_order_no` | user selects | No (fixed after create) | FK to `projects_master`, drives every autofill field below |
| `work_order_value` | `projects_master.work_order_value` | No | autofilled, used for the amount cap |
| `state`, `district`, `zone`, `department`, `site_details` | `projects_master` | No | autofilled |
| `estimated_bill_amount` | user | Yes | numeric(18,2), required |
| `estimated_payment_date` | user | Yes | date, required |
| `surety_pct` | user | Yes | integer 0–100, required |
| `remarks` | user | Yes | text, optional |
| `created_by`, `created_at`, `updated_by`, `updated_at` | system | No | audit only — no revision history |

### 2.5 Validation rules

1. `estimated_bill_amount` ≤ `projects_master.work_order_value` for the selected Work Order.
2. `estimated_bill_amount` > 0.
3. `surety_pct` between 0 and 100 inclusive, integer.
4. `estimated_payment_date` required, no past-date restriction imposed by default (ZO/HO may legitimately backfill).
5. `work_order_no` must exist in `projects_master` and, for ZO callers, must belong to that ZO (`zo_user_id` match) — checked server-side regardless of what the client sends.
6. All validation returns a specific field-level error, not a generic 500 — matches the pattern in `requisitions.controller.js`.

### 2.6 Audit behavior

Every insert sets `created_by`/`created_at`. Every update sets `updated_by`/`updated_at` and leaves `created_by`/`created_at` untouched. No history table — this is an explicit product decision to keep the module lightweight; see §9 for the tradeoff if that changes later.

---

## 3. Data model

### Migration `29_create_estimated_bills.sql`

```sql
-- ===========================================================================
-- Migration 29: Create Estimated Bills
-- DB: PostgreSQL (Supabase)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.estimated_bills (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_no          VARCHAR NOT NULL UNIQUE
                             REFERENCES public.projects_master(work_order_no) ON DELETE RESTRICT,
    estimated_bill_amount  NUMERIC(18,2) NOT NULL CHECK (estimated_bill_amount > 0),
    estimated_payment_date DATE NOT NULL,
    surety_pct             SMALLINT NOT NULL CHECK (surety_pct BETWEEN 0 AND 100),
    remarks                TEXT,
    created_by             VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by             VARCHAR NOT NULL REFERENCES public.authorised_users(mobile_number) ON DELETE RESTRICT,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.estimated_bills OWNER TO postgres;

-- amount cannot exceed the work order value — enforced at RPC level (see below)
-- rather than a cross-table CHECK, since Postgres CHECK constraints can't
-- reference another table.

CREATE INDEX IF NOT EXISTS idx_estimated_bills_work_order
    ON public.estimated_bills (work_order_no);
```

### Upsert RPC — `30_create_estimated_bill_upsert_rpc.sql`

Following the same locking discipline as `accept_excess_fund_return`: lock, validate, write.

```sql
CREATE OR REPLACE FUNCTION public.upsert_estimated_bill(
    p_work_order_no  VARCHAR,
    p_amount         NUMERIC,
    p_payment_date   DATE,
    p_surety_pct     SMALLINT,
    p_remarks        TEXT,
    p_actor          VARCHAR   -- acting user's mobile number
)
RETURNS public.estimated_bills AS $$
DECLARE
    v_wo_value  NUMERIC(18,2);
    v_zo        VARCHAR;
    v_result    public.estimated_bills;
BEGIN
    -- 1. Lock and validate the work order
    SELECT work_order_value, zo_user_id INTO v_wo_value, v_zo
    FROM public.projects_master
    WHERE work_order_no = p_work_order_no
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % not found.', p_work_order_no;
    END IF;

    IF p_amount > v_wo_value THEN
        RAISE EXCEPTION 'Estimated bill amount cannot exceed work order value (%.2f).', v_wo_value;
    END IF;

    IF p_surety_pct < 0 OR p_surety_pct > 100 THEN
        RAISE EXCEPTION 'Surety percentage must be between 0 and 100.';
    END IF;

    -- 2. Upsert — one row per work order
    INSERT INTO public.estimated_bills (
        work_order_no, estimated_bill_amount, estimated_payment_date,
        surety_pct, remarks, created_by, updated_by
    ) VALUES (
        p_work_order_no, p_amount, p_payment_date,
        p_surety_pct, p_remarks, p_actor, p_actor
    )
    ON CONFLICT (work_order_no) DO UPDATE SET
        estimated_bill_amount  = EXCLUDED.estimated_bill_amount,
        estimated_payment_date = EXCLUDED.estimated_payment_date,
        surety_pct             = EXCLUDED.surety_pct,
        remarks                = EXCLUDED.remarks,
        updated_by             = EXCLUDED.updated_by,
        updated_at             = now()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

The ZO-ownership check (`v_zo` above) is fetched here for use in the controller-side authorization decision — see §4.2. The RPC itself does not reject on ZO mismatch, because it doesn't know the caller's role; that check happens in the controller before the RPC is called, matching how `requisitions.controller.js` separates authorization from data mutation.

---

## 4. Backend architecture

### 4.1 File layout (matches existing module structure)

```
backend/src/
├── db/migrations/
│   ├── 29_create_estimated_bills.sql
│   └── 30_create_estimated_bill_upsert_rpc.sql
├── validation/
│   └── estimatedBills.schema.js
├── controllers/
│   └── estimatedBills.controller.js
└── routes/
    └── estimatedBills.routes.js
```

### 4.2 Endpoints

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/estimated-bills` | ZO, HO | List, scoped by role. Query params: `zone`, `work_order_no`, `min_surety`, `payment_date_from`, `payment_date_to` |
| `GET` | `/api/v1/estimated-bills/:work_order_no` | ZO, HO | Fetch single record (or 404 if none — client treats 404 as "new entry" state) |
| `POST` | `/api/v1/estimated-bills` | ZO, HO | Upsert. Body: `work_order_no, estimated_bill_amount, estimated_payment_date, surety_pct, remarks` |
| `GET` | `/api/v1/estimated-bills/work-orders` | ZO, HO | Work Order picker options, scoped by role — reuses the same scoping query as the list endpoint but returns id/label pairs only |

No `PATCH`/`PUT`/`DELETE` — deletion is intentionally not supported; if a record needs to go away, that's a data-correction request handled outside the module (consistent with `projects_master`'s "no soft delete support" note in migration 01).

### 4.3 Controller responsibilities (`estimatedBills.controller.js`)

```js
'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { upsertEstimatedBillSchema } = require('../validation/estimatedBills.schema');

async function listEstimatedBills(req, res) {
  const { role, mobile_number } = req.user; // set by verifyJwt middleware

  let query = supabase
    .from('estimated_bills')
    .select('*, projects_master!inner(zone, department, zo_user_id, work_order_value)');

  if (role === 'zo') {
    query = query.eq('projects_master.zo_user_id', mobile_number);
  }
  // HO: no filter — sees everything

  if (req.query.zone) query = query.eq('projects_master.zone', req.query.zone);
  if (req.query.min_surety) query = query.gte('surety_pct', Number(req.query.min_surety));
  if (req.query.payment_date_from) query = query.gte('estimated_payment_date', req.query.payment_date_from);
  if (req.query.payment_date_to) query = query.lte('estimated_payment_date', req.query.payment_date_to);

  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data });
}

async function upsertEstimatedBill(req, res) {
  if (!validate(req, res, upsertEstimatedBillSchema)) return;

  const { role, mobile_number } = req.user;
  const { work_order_no } = req.body;

  // Authorization: ZO may only write within their own scope
  if (role === 'zo') {
    const { data: wo } = await supabase
      .from('projects_master')
      .select('zo_user_id')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (!wo || wo.zo_user_id !== mobile_number) {
      return res.status(403).json({ success: false, message: 'Work order not in your zone.' });
    }
  }

  const { data, error } = await supabase.rpc('upsert_estimated_bill', {
    p_work_order_no: work_order_no,
    p_amount: req.body.estimated_bill_amount,
    p_payment_date: req.body.estimated_payment_date,
    p_surety_pct: req.body.surety_pct,
    p_remarks: req.body.remarks || null,
    p_actor: mobile_number
  });

  if (error) return res.status(400).json({ success: false, message: error.message });
  res.json({ success: true, data });
}

module.exports = { listEstimatedBills, upsertEstimatedBill /* + getOne, listWorkOrderOptions */ };
```

### 4.4 Validation schema (`estimatedBills.schema.js`)

Joi-style, matching `workOrderMappings.schema.js` conventions:

```js
const Joi = require('joi');

const upsertEstimatedBillSchema = Joi.object({
  work_order_no: Joi.string().required(),
  estimated_bill_amount: Joi.number().positive().required(),
  estimated_payment_date: Joi.date().iso().required(),
  surety_pct: Joi.number().integer().min(0).max(100).required(),
  remarks: Joi.string().allow('', null).max(500)
});

module.exports = { upsertEstimatedBillSchema };
```

### 4.5 Routes (`estimatedBills.routes.js`)

```js
const router = require('express').Router();
const verifyJwt = require('../middleware/verifyJwt');
const requireRole = require('../middleware/requireRole');
const ctrl = require('../controllers/estimatedBills.controller');

router.use(verifyJwt, requireRole(['zo', 'ho']));

router.get('/', ctrl.listEstimatedBills);
router.get('/work-orders', ctrl.listWorkOrderOptions);
router.get('/:work_order_no', ctrl.getEstimatedBill);
router.post('/', ctrl.upsertEstimatedBill);

module.exports = router;
```

Mount in the main router as `/api/v1/estimated-bills`, same pattern as the other route files.

---

## 5. Frontend architecture

### 5.1 File layout

```
frontend/src/
├── api/
│   └── estimatedBills.api.js        # axios client: list, getOne, upsert, listWorkOrders
├── pages/
│   └── EstimatedBill.jsx            # page shell: filters, stat cards, table, modal mount point
└── components/
    └── estimatedBill/
        ├── EstimatedBillTable.jsx
        ├── EstimatedBillFilters.jsx
        ├── EstimatedBillStats.jsx
        ├── EstimatedBillEntryModal.jsx   # the modal from the approved mockup
        └── SuccessPopup.jsx              # shared, reusable beyond this module
```

`EstimatedBillEntryModal` and `SuccessPopup` should be written as reusable primitives from day one — the success-popup pattern (animated checkmark, glass card) is generically useful across the app (Fund Requests, Requisitions could adopt it later), so it belongs under `components/ui/` rather than nested only in this module, once a second consumer appears. For the first cut, ship it locally and promote it if reused.

### 5.2 State and data flow

- `EstimatedBill.jsx` owns the list query (`TanStack Query`, key: `['estimated-bills', filters, role]`) and modal open/closed state (`{ mode: 'closed' | 'create' | 'edit', workOrderNo }`).
- Work Order dropdown inside the modal is a separate query (`['estimated-bill-work-order-options', role]`) so it can be cached independently of the list.
- On save success: invalidate `['estimated-bills']`, close modal, show `SuccessPopup`. No optimistic update — amounts feed financial reporting, so wait for server confirmation.
- Selecting a Work Order inside the modal triggers a `getOne` fetch; a 404 response means "no existing record" and the form simply stays in create mode with fields blank except the autofilled master-data block.

### 5.3 Component responsibility boundaries

| Component | Owns |
|---|---|
| `EstimatedBillFilters` | zone / WO / surety / date-range filter state, lifted up via props |
| `EstimatedBillStats` | pure display — count, total, surety-weighted total, avg surety, computed client-side from the current filtered rows |
| `EstimatedBillTable` | row rendering, edit-click dispatch |
| `EstimatedBillEntryModal` | form state, client-side validation mirror of §2.5, calls `upsert` mutation |

Reuse existing primitives (`<Input />`, `<Select />`, `<Modal />` if one already exists in `components/ui/` — check before building a new modal shell) rather than hand-rolling new form controls, per the "Zero Ad-Hoc Components" policy in `frontend_guidelines.md`.

---

## 6. Security and permissions

- All endpoints behind `verifyJwt` + `requireRole(['zo','ho'])` — JE and staff get a 403 at the middleware layer, never reach the controller.
- ZO scoping is enforced **server-side** on every read and write (§4.3) — the frontend filter is UX convenience only, never the security boundary.
- `upsert_estimated_bill` is `SECURITY DEFINER` so it can update `projects_master`-adjacent data consistently, but the controller — not the RPC — is where the ZO-ownership check lives, keeping authorization logic in one layer.
- Rate limiting: reuse the existing `rateLimiter.js` middleware on the `POST` route, same threshold class as `requisitions.routes.js`.

---

## 7. Non-functional considerations

| Concern | Approach |
|---|---|
| Concurrency | Row lock in the RPC (`FOR UPDATE` on `projects_master`) prevents two simultaneous saves on the same WO from producing inconsistent amount-vs-value validation. Last write wins on the `estimated_bills` row itself — acceptable given no revision history requirement. |
| Analytics integration | `estimated_bills` should be added to the existing `analyticsRefresh.service.js` refresh set so HO dashboard cards pick up surety-weighted totals without a separate polling path. |
| Currency/number formatting | Reuse existing `Intl.NumberFormat('en-IN')` helper already used elsewhere in the frontend rather than reintroducing lakh-formatting logic. |
| Migration numbering | Confirm `29`/`30` are the next free numbers at merge time — the repo has a couple of duplicate-numbered migrations already (two files numbered `13`); don't perpetuate that. |

---

## 8. Milestone plan

### Milestone 1 — Data layer (0.5–1 day)
- Write and apply migrations `29_create_estimated_bills.sql`, `30_create_estimated_bill_upsert_rpc.sql`
- Local Supabase migration test: insert, conflict-upsert, amount-exceeds-value rejection, surety-out-of-range rejection
- **Exit criteria:** RPC callable from Supabase SQL editor with correct success/error behavior on all validation cases in §2.5

### Milestone 2 — Backend API (1–1.5 days)
- `estimatedBills.schema.js`, `estimatedBills.controller.js`, `estimatedBills.routes.js`
- Wire into main router, apply `verifyJwt` + `requireRole` + rate limiter
- Postman/manual test matrix: ZO reading own zone, ZO blocked from other zone, HO unrestricted, amount-cap rejection, surety-range rejection
- **Exit criteria:** all four endpoints pass the test matrix; no direct table access bypasses the RPC

### Milestone 3 — Frontend — read path (1 day)
- `estimatedBills.api.js`, `EstimatedBill.jsx` page shell routed into the sidebar nav
- `EstimatedBillFilters`, `EstimatedBillStats`, `EstimatedBillTable` wired to the list query
- **Exit criteria:** ZO and HO logins render correctly scoped tables and stats against real API data (no modal yet)

### Milestone 4 — Frontend — write path (1–1.5 days)
- `EstimatedBillEntryModal` built to the approved mockup (glass modal, autofill block, slider, validation)
- `SuccessPopup` component
- Wire create and edit flows to the `POST` upsert endpoint; cache invalidation on success
- **Exit criteria:** full create → success popup → list refresh cycle and edit → success popup → list refresh cycle both work against the real API, including the amount-cap client-side check matching the server rejection

### Milestone 5 — Analytics integration (0.5 day)
- Add `estimated_bills` to `analyticsRefresh.service.js`
- Confirm HO dashboard can surface a surety-weighted total card if desired (stretch — confirm with product whether this ships now or later)
- **Exit criteria:** refreshed analytics view includes estimated-bill totals without a separate manual trigger

### Milestone 6 — QA, docs, rollout (0.5–1 day)
- Update `USER_MANUAL.md` and `ROLE_PERMISSIONS_MATRIX.md` with the new module
- Manual regression pass: ZO/HO role switch, concurrent-edit scenario, boundary values (amount = exactly WO value, surety = 0 and 100)
- Ship behind no feature flag (module is additive, zero-risk to existing modules) — direct deploy once QA sign-off is complete

**Total estimate: ~5–6.5 working days**, one backend-leaning engineer plus one frontend-leaning engineer working the two tracks in parallel from Milestone 3 onward (Milestones 1–2 are a hard prerequisite for 3–4).

---

## 9. Deferred / explicitly out of scope

Flag these to product now so they're conscious decisions, not oversights:

- **Reconciliation against actual RA/Final bills** — no link between `estimated_bills` and `ra_final_bills` today. If HO wants "estimate vs actual" variance reporting later, that's a new join key and a new milestone, not a small add-on.
- **Revision history** — current design overwrites in place. If audit requirements tighten later (e.g. regulatory ask), retrofitting history means adding a `estimated_bills_history` table and trigger, not a schema rewrite — worth knowing the migration path exists even though we're not building it now.
- **Bulk import** — no CSV/bulk-upload path for estimates in this phase, even though `projects_master` and `material master` support bulk operations elsewhere in the app.
