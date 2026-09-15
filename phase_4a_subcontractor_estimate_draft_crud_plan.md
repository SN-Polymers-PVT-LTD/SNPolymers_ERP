# Phase 4A — Subcontractor Estimate Draft CRUD Implementation Plan

**Repository:** `SNPolymers`  
**Branch:** `subcontractor-ledger`  
**Status:** Implementation plan — pending approval  
**Scope:** Projects-side Subcontractor Estimate header and Draft line CRUD only  
**Reference:** `subcontractor_estimate_business_rules_and_data_semantics (1).md`, `subcontractor_database_foundation_plan.md`, and the Phase 4 specification

## 1. Outcome

Phase 4A will allow an authorized Projects user to create a Work Order-specific Subcontractor Estimate, add/edit/remove Draft BASE lines using canonical subcontractor and subcontract-work UUIDs, and reload the server-calculated total.

The delivered flow is:

```text
JE/Admin
  -> select an eligible mapped Work Order
  -> create one Draft Subcontractor Estimate
  -> add Contractor + Subcontract Work + Qty + Rate
  -> save Draft lines atomically
  -> reload the estimate and server total
```

Phase 4A stops before submission, approval, revision requests, reopening, Cost Estimate aggregation, and Finance behavior.

## 2. Repository trace

### Existing database foundation

The required relational identities already exist in:

- `backend/src/db/migrations/076_subcontractor_estimate_foundation.sql`
  - `project_subcontract_estimates`
  - `project_subcontract_estimate_lines`
  - `subcontract_estimate_revision_log`
  - canonical UUID foreign keys to `subcontractor_master` and `subcontract_work_master`
- `backend/src/db/migrations/077_subcontractor_foundation_corrections.sql`
  - signed `ADJUSTMENT` structure
  - `adjusts_line_id` validation
  - source identity corrections
- `backend/src/db/migrations/078_subcontract_source_identity_null_fix.sql`
  - NULL-safe source identity behavior
- `backend/src/db/migrations/079_subcontract_work_identity_guard.sql`
  - database protection against changing referenced work identity

The foundation already permits repeated contractor/work source lines and enforces `amount = round(qty * rate, 2)`. It does not yet provide the application transaction that reconciles Draft lines and recalculates the header total.

### Existing backend patterns

The implementation should follow these existing files rather than create a parallel workflow:

- `backend/src/routes/estimates.routes.js`
- `backend/src/controllers/estimates.core.controller.js`
- `backend/src/controllers/estimates.items.controller.js`
- `backend/src/controllers/estimates.helpers.js`
- `backend/src/validation/estimate.schema.js`
- `backend/src/workflow/estimate-rules.js`
- `backend/src/controllers/subcontractWorks.controller.js`
- `backend/src/controllers/subcontractors.controller.js`
- `backend/src/controllers/workOrderMappings.controller.js`
- `backend/src/middleware/verifyJwt.js`
- `backend/src/middleware/requireRole.js`
- `backend/src/middleware/validateRequest.js`
- `backend/src/app.js`

The existing Cost Estimate module establishes the role-filtered list/detail/init pattern, JE Work Order mapping checks, owner/admin write checks, pagination, UUID validation, and status naming conventions.

### Existing frontend patterns

- `frontend/src/api/estimatesApi.js`
- `frontend/src/pages/Estimates.jsx`
- `frontend/src/pages/EstimateForm.jsx`
- `frontend/src/pages/EstimateView.jsx`
- `frontend/src/components/ui/*`
- `frontend/src/components/ProtectedRoute.jsx`
- `frontend/src/components/TopNavbar.jsx`
- `frontend/src/components/Sidebar.jsx`
- `frontend/src/components/MobileHeader.jsx`
- `frontend/src/App.jsx`
- `frontend/src/api/subcontractMastersApi.js`
- `frontend/src/pages/SubcontractWorkMaster.jsx`
- `frontend/src/pages/SubcontractorMaster.jsx`

The new pages must use the shared table, input, select, button, modal, pagination, loading, and error/success patterns. Do not create a `SubcontractEstimateV2` parallel page.

### Existing tests

- `backend/tests/vitest/regression/subcontractorEstimateFoundation.test.js`
- `backend/tests/vitest/regression/subcontractMasters.test.js`
- Cost Estimate regression tests under `backend/tests/vitest/regression/`
- `frontend/src/components/ProtectedRoute.test.jsx`
- `frontend/src/components/TopNavbar.test.jsx`

The foundation test proves schema behavior only. Phase 4A needs controller/API-level authorization tests and DB-backed Draft reconciliation tests.

## 3. Locked Phase 4A contract

### Header

- One live estimate per Work Order.
- Initial `estimate_status = 'Draft'`.
- Initial `estimate_revision = 0`.
- Server owns UUID, status, revision, audit fields, and authoritative total.
- `created_by` and `last_modified_by` are populated from the authenticated actor.
- `je_user_id` remains `NULL` during Draft creation; Phase 4B assigns workflow metadata when the estimate is first submitted.
- `estimate_amount` is always recalculated from persisted lines.
- A Closed project cannot receive a new estimate.
- A duplicate live estimate returns HTTP `409`.
- JE creation requires an active `work_order_mappings` row for the authenticated JE.
- Admin creation is not restricted by JE mapping.

### Draft lines

Phase 4A exposes only `BASE` entry lines for a new Draft. `ADDITION` and signed `ADJUSTMENT` remain reserved for Phase 4B after approved history exists.

For each Draft BASE line:

- New selections must reference active `subcontractor_master` and `subcontract_work_master` rows;
- persisted lines whose masters later become inactive remain readable and editable/deletable by `line_id`; unrelated Draft edits are not blocked;
- `qty > 0`, `rate > 0`, and derived `amount > 0`;
- the server derives `amount = round(qty * rate, 2)`;
- `rate_reference` is optional during Draft;
- `remarks` is optional during Draft;
- client-supplied `amount`, status, approvals, audit fields, and revision fields are ignored or rejected;
- repeated contractor/work combinations are legal and remain separate source contributions;
- display labels are resolved from the master tables and are never persisted as identity.

### Save semantics

`PUT /:id/lines` uses one atomic reconciliation operation:

1. Lock the estimate header.
2. Compare the supplied `expected_updated_at` with the locked header timestamp; stale snapshots fail with a conflict and make no changes.
3. Verify the estimate exists, is Draft, and is editable by the authenticated user.
4. Validate every submitted line and canonical UUID.
5. Preserve any locked/historical rows if they exist.
6. Update submitted editable rows by `line_id`.
7. Insert new rows without a `line_id`.
8. Delete omitted editable Draft rows only.
9. Recalculate and persist `estimate_amount` from all surviving lines.
10. Return the refreshed header and lines.

The operation must not use delete-all/insert-all semantics.

Drafts may temporarily contain zero lines; their server total is `0.00`. Submission and approval validation belong to Phase 4B.

## 4. Database changes

### New migration

Add the next forward-only migration:

```text
backend/src/db/migrations/080_subcontract_estimate_draft_crud.sql
```

The migration should add a narrowly scoped transactional RPC, preferably:

```text
public.save_subcontract_estimate_draft_lines(
  p_estimate_id uuid,
  p_actor varchar,
  p_expected_updated_at timestamptz,
  p_lines jsonb
)
```

The RPC should:

- lock the header with `FOR UPDATE`;
- compare `p_expected_updated_at` after locking and raise a mapped stale-snapshot conflict;
- enforce Draft status;
- resolve `p_actor` against an active `authorised_users` record;
- enforce `actor.role = admin` or `actor.role = je` with an active Work Order mapping;
- validate active master rows for new lines, while allowing persisted inactive IDs to remain readable/editable/deletable;
- derive amounts server-side;
- reconcile rows without deleting locked rows;
- update `estimate_amount` in the same transaction;
- return the refreshed estimate and line data or a structured exception.

The RPC must not implement submission, row approval, revision requests, reopening, Cost Estimate synchronization, or Finance capacity logic.

The RPC is backend-only. Revoke execution from `PUBLIC`, `anon`, and `authenticated`; grant execution only to `service_role`. Keep it `SECURITY INVOKER` unless a narrowly justified `SECURITY DEFINER` implementation is required, in which case pin its `search_path`. The backend passes `req.user.mobile_number` as `p_actor`; the client never supplies actor identity.

Add only supporting indexes or constraints that are demonstrated necessary by the RPC. Do not alter migrations `076`–`079`.

Update generated schema/RPC/index manifests through the repository scripts if the contract tests require them.

## 5. Backend implementation

### New files

- `backend/src/controllers/subcontractEstimates.controller.js`
- `backend/src/routes/subcontractEstimates.routes.js`
- `backend/src/validation/subcontractEstimates.schema.js`
- `backend/src/controllers/subcontractEstimates.helpers.js` if shared role/scope/detail helpers are needed
- `backend/tests/vitest/regression/subcontractEstimateDraft.test.js`

### Route contract

Mount in `backend/src/app.js`:

```text
/api/v1/auth/subcontract-estimates
```

All routes use JWT verification.

Recommended Phase 4A endpoints:

```text
GET  /summary
GET  /init
GET  /
POST /
GET  /:id
PUT  /:id/lines
```

Role contract:

| Endpoint/action | JE | ZO | HO | Admin | Accounts/staff |
|---|---:|---:|---:|---:|---:|
| List/detail/summary | yes | yes | yes | yes | no |
| Init eligible WOs | yes | no | no | yes | no |
| Create header | yes, mapped WO | no | no | yes | no |
| Save Draft lines | owner JE | no | no | yes | no |

The route must reject unauthorized roles with `403` before controller writes.

### Visibility rules

- JE sees only estimates for actively mapped Work Orders.
- ZO sees estimates belonging to JEs actively mapped to that ZO.
- HO/Admin see all permitted Projects estimates.
- Closed Work Orders remain readable when historical estimate detail is requested, but are not eligible for new header creation.
- No endpoint should download all Projects merely to build the new-estimate selector.

### `GET /init`

`GET /init` is JE/Admin only and returns only data required to create a Draft:

- eligible Work Orders visible to the current role;
- no already-live Work Order estimate.

Line selectors call the existing master APIs with server-side search and active filtering:

- `GET /subcontractors?search=...&is_active=true&limit=20`
- `GET /subcontract-works?search=...&is_active=true&limit=20`

Historical inactive masters should be returned by detail resolution when referenced by existing lines, but not offered as new selections. An inactive persisted master must not block unrelated Draft edits.

### Error mapping

Use stable responses:

- `400` invalid UUID or malformed payload;
- `403` role, mapping, Closed Work Order, or non-owner edit denial;
- `404` missing estimate, Work Order, master, or detail;
- `409` duplicate live estimate or concurrent/unique conflict;
- `422` inactive master, invalid numeric values, invalid line ownership, or arithmetic/business validation;
- `500` only for unexpected failures.

Do not expose raw PostgREST errors to the client.

## 6. Frontend implementation

### New files

- `frontend/src/api/subcontractEstimatesApi.js`
- `frontend/src/pages/SubcontractEstimates.jsx`
- `frontend/src/pages/SubcontractEstimateForm.jsx`
- `frontend/src/pages/SubcontractEstimateView.jsx`

### Routing

Add lazy routes in `frontend/src/App.jsx` under:

```text
ProtectedRoute allowedRoles={['je', 'zo', 'ho', 'admin']}
```

Routes:

```text
/subcontract-estimates
/subcontract-estimates/new
/subcontract-estimates/:id
/subcontract-estimates/:id/edit
```

Accounts and staff must be redirected by frontend authorization as well as rejected by the backend.

### Navigation

Update `frontend/src/components/Sidebar.jsx`, its `MobileHeader`, and `frontend/src/components/TopNavbar.jsx` so Project Control presents:

```text
Subcontract Estimates
Cost Estimates
Material Master
Subcontract Work Master
Subcontractor Master
Daily Progress
```

The new navigation entry must preserve existing role visibility and active-route behavior.

Add `/subcontract-estimates` to the Sidebar `isProjectModule` detection and the TopNavbar Projects `isActive` paths. Place the entry before Cost Estimates.

### Form behavior

Header display:

- Work Order
- Estimate Revision
- Status
- Total Authorized Value

Line table:

- Subcontractor
- Subcontract Work
- Sub Head
- Unit
- Qty
- Rate
- Amount
- Rate Reference
- Remarks
- Entry Type (`Base`, read-only in Phase 4A)
- Actions

Selectors must store UUIDs and display master context. The form may calculate a preview amount for UX, but it must display the server response as authoritative after save.

The form must support:

- create Draft;
- add multiple lines;
- edit mutable lines;
- remove mutable lines;
- save and reload;
- clear validation/API errors without losing unsaved valid rows;
- prevent inactive masters from being selected;
- show historical inactive display values when viewing persisted lines.

## 7. Test plan

### Database/RPC regression

Add DB-backed coverage for:

- valid Draft header creation;
- one live estimate per Work Order;
- Closed Work Order rejection;
- duplicate live estimate conflict;
- two concurrent header creates produce one success and one `409` unique conflict;
- valid BASE line calculation;
- amount mismatch cannot be persisted;
- negative/zero qty and rate rejection;
- inactive contractor/work rejection for new lines;
- repeated contractor/work lines remain independent;
- edit mutable line;
- delete omitted mutable line;
- omitted locked line is preserved;
- total recalculation after insert/update/delete;
- stale `expected_updated_at` returns `409` and changes no lines;
- same `line_id` belonging to another estimate returns `422`;
- direct RPC execution by `anon`/`authenticated` is denied;
- unmapped JE actor is denied by the RPC and route;
- admin actor is allowed by the RPC;
- invalid UUID and foreign-key rejection;
- historical inactive master remains readable.

### Controller/route regression

Exercise actual controller/route behavior for:

- JE mapped Work Order creation;
- JE unmapped Work Order denial;
- Admin creation;
- ZO/HO cannot create Draft headers;
- list visibility for JE/ZO/HO/Admin;
- Accounts/staff denied list/detail/init;
- non-owner JE cannot edit another JE’s Draft;
- Admin can edit Draft;
- invalid estimate UUID returns `400`;
- missing estimate returns `404`;
- duplicate creation returns `409`.
- malformed client `amount`, status, `created_by`, and audit fields are ignored/rejected and never persisted;
- an existing Draft line whose master became inactive remains readable and can be edited/deleted without blocking unrelated Draft edits.

### Frontend regression

Add focused tests for:

- protected routes and role visibility;
- Work Order/contractor/work selector rendering;
- line add/edit/remove behavior;
- client preview versus server total refresh;
- validation and API error display;
- navigation entry and active state;
- no stale `V2` parallel implementation.

## 8. Verification commands

Run in this order:

```bash
cd backend
npx vitest run tests/vitest/regression/subcontractorEstimateFoundation.test.js tests/vitest/regression/subcontractEstimateDraft.test.js
bash scripts/test-local.sh tests/vitest/regression/subcontractorEstimateFoundation.test.js tests/vitest/regression/subcontractEstimateDraft.test.js
npm run test:contracts:db
npm run test:regression
npm run test:local
```

Then run the established frontend focused tests and production build. Record focused and full-suite results separately.

Before commit, inspect:

```bash
git diff --check
git status --short
git diff --stat
```

## 9. Explicit non-goals

Phase 4A must not implement:

- Submit;
- ZO review or approval;
- HO review or Final Approval;
- ZO/HO revision requests;
- Reopen;
- row-level approval mutations;
- `ADDITION` or `ADJUSTMENT` authoring in the UI;
- Cost Estimate generated rows or weighted rates;
- Cost Estimate provenance synchronization;
- Payment Requisition identity/capacity changes;
- Subcontractor Ledger or Finance crediting;
- financial consumed-capacity guards.

## 10. Risks and follow-up boundary

1. The existing schema already supports signed adjustments, but Phase 4A must not expose them before Phase 4B establishes approved-source validation.
2. Phase 4B must add database enforcement for approved-line immutability and validate `adjusts_line_id` against the same Work Order, contractor, work, and Final Approved history.
3. The existing revision-log table lacks all of the richer remarks/closure semantics described for Phase 4B; those changes belong in a later migration and must not be smuggled into the Draft CRUD migration.
4. Phase 5 must coordinate generated Cost Estimate activation with the Finance legacy-hook cutover described in the specification.

## 11. Acceptance gate

Phase 4A is complete only when:

```text
JE logs in
  -> sees only mapped eligible Work Orders
  -> creates a Draft estimate
  -> adds canonical contractor/work lines
  -> saves successfully
  -> reloads the same lines and server total
  -> edits, adds, and removes Draft rows
  -> cannot bypass role, mapping, UUID, active-master, or DB constraints
```

And the full backend and frontend verification suites pass without changing behavior in Cost Estimates, masters, requisitions, ledger, Finance, or Accounts.
