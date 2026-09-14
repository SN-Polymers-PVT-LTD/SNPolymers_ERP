# Final Implementation Plan — Subcontract Work Master + Subcontractor Master APIs / Pages

**Repository:** `SN-Polymers-PVT-LTD/SNPolymers_ERP`  
**Target branch:** `subcontractor-ledger`  
**Verified against branch head:** `1dca42382dba9162f4a34a6ffa031739f97bfd04`  
**Phase:** Step 3 — Projects reusable subcontract masters  
**Scope:** Backend APIs + frontend management pages only

---

# 1. Objective

Build two reusable Projects-side master-data modules:

1. **Subcontract Work Master**
2. **Subcontractor Master**

These masters become the canonical sources used by the later Subcontractor Estimate workflow.

The goal of this phase is to give Projects stable UUID-based identities for:

```text
Subcontract Work
Subcontractor
```

without yet implementing:

```text
Subcontractor Estimate CRUD
ZO / HO approval workflow
Estimate reopen/revision behavior
Cost Estimate aggregation
Finance capacity migration
Payment Requisition integration
Subcontractor Ledger normalized cutover
```

This phase must remain a clean master-data implementation.

---

# 2. Existing ERP patterns to preserve

The implementation must deliberately follow the existing application style rather than introducing a separate API/UI design language.

## 2.1 Material Master pattern

The existing Material Master provides the management-page baseline:

```text
GET    /api/v1/auth/materials
GET    /api/v1/auth/materials/categories
GET    /api/v1/auth/materials/subheads
GET    /api/v1/auth/materials/:id

POST   /api/v1/auth/materials
PUT    /api/v1/auth/materials/:id
PATCH  /api/v1/auth/materials/:id/status
```

Its management page already uses:

```text
React Query
server-side pagination
server-side search
filters
sorting
400 ms debounced search
next-page prefetching
create/edit modal
status badges
query invalidation
SuccessPopup / ErrorPopup
```

The two new master pages should visually and behaviorally feel like siblings of Material Master.

## 2.2 Cost Estimate API pattern

Cost Estimate establishes the preferred newer backend style:

```text
router.use(verifyJwt)

requireRole(...)
validateRequest(zodSchema)
controller
```

It also establishes:

- backend-authoritative role enforcement;
- backend-authoritative business-rule enforcement;
- UUID validation at API boundaries;
- `409 Conflict` for business conflicts;
- role-specific data access;
- frontend does not decide security.

The new master APIs should follow this newer pattern.

## 2.3 Cost Estimate master-data consumption pattern

Cost Estimate does not use Material Master management endpoints directly for every dropdown.

Instead, it consumes:

```text
GET /api/v1/auth/master-data/version
GET /api/v1/auth/master-data/catalog
```

and caches the active catalog client-side.

Therefore this phase should **not prematurely add `/options` endpoints**.

The master management APIs should stay focused on management. A dedicated Subcontractor Estimate catalog/typeahead contract can be introduced later when the estimate form is built.

---

# 3. Canonical data sources

The database foundation already provides:

```text
subcontract_work_master
subcontractor_master
projects_beneficiary_master
```

## 3.1 Subcontract Work identity

Canonical key:

```text
subcontract_work_master.id
```

Identity fields:

```text
sub_head
material_details
unit
```

The existing normalized unique index is authoritative across:

```text
lower(trim(sub_head))
lower(trim(material_details))
lower(trim(unit))
```

A display string is never an identity.

## 3.2 Subcontractor identity

Canonical key:

```text
subcontractor_master.id
```

A subcontractor name is **not** globally unique.

Two records may legitimately have the same display name.

Identity always comes from the UUID.

## 3.3 Beneficiary relationship

Subcontractor Master reuses:

```text
projects_beneficiary_master
```

through:

```text
subcontractor_master.primary_beneficiary_id
```

Do not duplicate account number, IFSC, bank name, or bank ID inside `subcontractor_master`.

---

# 4. Permission model

| Action | JE | ZO | HO | Admin |
|---|---:|---:|---:|---:|
| Read active Subcontract Works | Yes | Yes | Yes | Yes |
| Read active Subcontractors | Yes | Yes | Yes | Yes |
| View inactive records | No | No | No | Yes |
| Create Subcontract Work | Yes | No | No | Yes |
| Create Subcontractor | Yes | No | No | Yes |
| Edit existing Subcontract Work | No | No | No | Yes |
| Edit existing Subcontractor | No | No | No | Yes |
| Activate / deactivate Work | No | No | No | Yes |
| Activate / deactivate Subcontractor | No | No | No | Yes |

This intentionally differs slightly from Material Master, where JE can currently toggle status.

Subcontractor and Subcontract Work masters will eventually affect approved project scope and financial authorization, so status changes remain Admin-only.

No hard-delete endpoint should exist.

---

# 5. Active / inactive semantics

`is_active = false` means:

> The record must not be offered for new business transactions.

It does **not** mean the record no longer exists.

Therefore:

- inactive records remain stored;
- historical Estimate / Finance screens may still resolve and display them;
- non-admin master-management list endpoints return active records only;
- Admin may explicitly view active, inactive, or all records.

---

# 6. Backend route structure

Create:

```text
backend/src/routes/subcontractWorks.routes.js
backend/src/routes/subcontractors.routes.js
```

Mount in `backend/src/app.js`:

```js
app.use('/api/v1/auth/subcontract-works', subcontractWorksRoutes);
app.use('/api/v1/auth/subcontractors', subcontractorsRoutes);
```

---

# 7. Subcontract Work Master API

Base:

```text
/api/v1/auth/subcontract-works
```

Routes:

```text
GET    /subcontract-works
GET    /subcontract-works/:id

POST   /subcontract-works
PUT    /subcontract-works/:id
PATCH  /subcontract-works/:id/status
```

Do not create a DELETE route.  
Do not add `/options` in this phase.

---

# 8. GET /subcontract-works

Purpose:

- management page;
- search;
- pagination;
- filtering;
- sorting.

Query params:

```text
page
limit
search
sub_head
unit
is_active
sortBy
sortOrder
```

Recommended defaults:

```text
page      = 1
limit     = 10
sortBy    = material_details
sortOrder = asc
```

Backend maximum:

```text
limit <= 1000
```

Search case-insensitively across:

```text
sub_head
material_details
unit
```

Visibility:

For JE / ZO / HO:

```text
force is_active = true
```

For Admin:

```text
is_active=true
is_active=false
empty = all
```

Response:

```json
{
  "success": true,
  "subcontractWorks": [],
  "pagination": {
    "totalItems": 0,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

Use `totalItems`, matching Material Master.

---

# 9. GET /subcontract-works/:id

Validate UUID before DB access.

Responses:

```text
400 Invalid UUID
404 Work not found
403 inactive work requested by non-admin
200 success
```

Response:

```json
{
  "success": true,
  "subcontractWork": {
    "id": "...",
    "sub_head": "...",
    "material_details": "...",
    "unit": "...",
    "is_active": true,
    "created_by": "...",
    "created_at": "...",
    "updated_by": "...",
    "updated_at": "..."
  }
}
```

---

# 10. POST /subcontract-works

Allowed:

```text
JE
Admin
```

Body:

```json
{
  "sub_head": "DI Pipe Line Work",
  "material_details": "700 mm Pipe Laying",
  "unit": "Mtr"
}
```

Backend should:

1. trim all identity fields;
2. validate non-empty values;
3. default `is_active = true`;
4. set `created_by` from authenticated user;
5. rely on normalized DB uniqueness as final duplicate protection.

Map PostgreSQL `23505` to:

```text
409 Conflict
```

Message:

```text
That subcontract work already exists.
```

---

# 11. PUT /subcontract-works/:id

Allowed:

```text
Admin only
```

Critical rule:

Once a Subcontract Work has been referenced by:

```text
project_subcontract_estimate_lines.subcontract_work_id
```

its identity fields become immutable:

```text
sub_head
material_details
unit
```

Before changing identity, query:

```sql
SELECT line_id
FROM project_subcontract_estimate_lines
WHERE subcontract_work_id = :id
LIMIT 1;
```

If referenced and identity changed:

```text
409 Conflict
```

Message:

```text
This subcontract work is already in use.
Create a new work item and deactivate the old one instead.
```

Deactivation remains legal.

---

# 12. PATCH /subcontract-works/:id/status

Allowed:

```text
Admin only
```

Body:

```json
{
  "is_active": false
}
```

Deactivation:

- does not delete;
- does not alter existing references;
- removes record from future selectable active master data.

Reactivation is allowed.

---

# 13. Subcontractor Master API

Base:

```text
/api/v1/auth/subcontractors
```

Routes:

```text
GET    /subcontractors
GET    /subcontractors/:id

POST   /subcontractors
PUT    /subcontractors/:id
PATCH  /subcontractors/:id/status
```

No DELETE route.  
No `/options` route in this phase.

---

# 14. GET /subcontractors

Query params:

```text
page
limit
search
is_active
beneficiary_status
sortBy
sortOrder
```

Recommended:

```text
beneficiary_status = linked | unlinked
```

Search across:

```text
subcontractor_name
contact_person
mobile
email
pan_no
gst_no
```

Non-admin:

```text
active only
```

Admin:

```text
active / inactive / all
```

Response:

```json
{
  "success": true,
  "subcontractors": [],
  "pagination": {
    "totalItems": 0,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

# 15. Subcontractor response enrichment

Subcontractor list/detail responses should resolve the beneficiary relationship.

Recommended shape:

```json
{
  "id": "...",
  "subcontractor_name": "ABC Contractors",
  "contact_person": "John Doe",
  "mobile": "9876543210",
  "email": "accounts@example.com",
  "address": "...",
  "pan_no": "...",
  "gst_no": "...",
  "primary_beneficiary_id": "...",
  "is_active": true,
  "primary_beneficiary": {
    "id": "...",
    "beneficiary_name": "ABC Contractors",
    "beneficiary_ac_no": "...",
    "beneficiary_ifsc": "...",
    "beneficiary_bank_name": "..."
  }
}
```

`primary_beneficiary_id` remains authoritative. The embedded object is display enrichment only.

---

# 16. POST /subcontractors

Allowed:

```text
JE
Admin
```

Body:

```json
{
  "subcontractor_name": "ABC Contractors",
  "contact_person": "John Doe",
  "mobile": "9876543210",
  "email": "accounts@example.com",
  "address": "...",
  "pan_no": "...",
  "gst_no": "...",
  "primary_beneficiary_id": null
}
```

Only `subcontractor_name` is mandatory.

Duplicate display names are allowed.

---

# 17. PUT /subcontractors/:id

Allowed:

```text
Admin only
```

Editable:

```text
subcontractor_name
contact_person
mobile
email
address
pan_no
gst_no
primary_beneficiary_id
is_active
```

Unlike Subcontract Work identity, subcontractor profile fields remain editable.

The UUID is the stable identity, while legitimate business information may change.

Historical transaction snapshots remain separate.

---

# 18. Beneficiary rules

`primary_beneficiary_id` is optional.

A subcontractor may exist with:

```text
primary_beneficiary_id = NULL
```

UI:

```text
Banking not configured
```

If supplied:

1. validate UUID;
2. verify record exists in `projects_beneficiary_master`;
3. reject invalid relationship.

Recommended response:

```text
422 Unprocessable Entity
Selected beneficiary does not exist.
```

Changing `primary_beneficiary_id` affects future defaults only.

It must never rewrite historical requisition beneficiary snapshots.

---

# 19. PATCH /subcontractors/:id/status

Allowed:

```text
Admin only
```

Inactive subcontractors:

- remain historically resolvable;
- are excluded from future active master selection;
- may be reactivated.

---

# 20. Validation layer

Create:

```text
backend/src/validation/subcontractMasters.schema.js
```

Use:

```text
Zod
validateRequest
```

Subcontract Work validation:

```text
sub_head          required trimmed non-empty
material_details  required trimmed non-empty
unit              required trimmed non-empty
id                UUID
is_active         boolean where applicable
```

Subcontractor validation:

```text
subcontractor_name       required trimmed non-empty
contact_person           optional nullable
mobile                   optional nullable
email                    optional valid email nullable
address                  optional nullable
pan_no                   optional nullable
gst_no                   optional nullable
primary_beneficiary_id   optional nullable UUID
```

Do not over-constrain PAN/GST unless an approved business rule exists.

---

# 21. Backend controller files

Create:

```text
backend/src/controllers/subcontractWorks.controller.js
backend/src/controllers/subcontractors.controller.js
```

Controllers own:

```text
pagination
search
filters
sorting
role-sensitive active visibility
friendly DB error mapping
referenced-work immutability guard
beneficiary enrichment
audit actor assignment
```

---

# 22. Sort-field allowlists

Do not pass arbitrary `sortBy` to DB ordering.

Subcontract Work allowed:

```text
sub_head
material_details
unit
created_at
updated_at
```

Default:

```text
material_details
```

Subcontractor allowed:

```text
subcontractor_name
contact_person
created_at
updated_at
```

Default:

```text
subcontractor_name
```

Invalid values fall back to defaults.

---

# 23. Frontend API wrapper

Create:

```text
frontend/src/api/subcontractMastersApi.js
```

Keep it thin, matching existing `materialsApi.js` / `estimatesApi.js`.

---

# 24. Frontend page — Subcontract Work Master

Create:

```text
frontend/src/pages/SubcontractWorkMaster.jsx
```

Route:

```text
/subcontract-works
```

Header:

```text
PROJECTS · MASTER DATA

Subcontract Work Master

Reusable subcontract work definitions used across Work Orders.
```

Controls:

```text
[ Search work... ]

[ Sub Head ▼ ]
[ Unit ▼ ]
[ Status ▼ ]   <- Admin only

                           [+ Add Work]
```

Add button:

```text
JE / Admin
```

Edit/status actions:

```text
Admin only
```

Table:

```text
Sub Head
Work Details
Unit
Status
Updated
Actions
```

Create/Edit modal:

```text
Sub Head
Work Details
Unit
Active
```

Do not include:

```text
Qty
Rate
Contractor
Work Order
```

---

# 25. Frontend page — Subcontractor Master

Create:

```text
frontend/src/pages/SubcontractorMaster.jsx
```

Route:

```text
/subcontractors
```

Header:

```text
PROJECTS · MASTER DATA

Subcontractor Master

Canonical subcontractor directory and default payment beneficiary.
```

Controls:

```text
[ Search subcontractors... ]

[ Beneficiary: All / Linked / Missing ]
[ Status ▼ ]   <- Admin only

                           [+ Add Subcontractor]
```

Table:

```text
Subcontractor
Contact
PAN / GST
Primary Beneficiary
Bank
Status
Actions
```

---

# 26. Subcontractor form layout

Identity:

```text
Subcontractor Name
PAN
GST
```

Contact:

```text
Contact Person
Mobile
Email
Address
```

Beneficiary:

```text
Primary Beneficiary
```

Display selected beneficiary details:

```text
Beneficiary Name
Account Number
IFSC
Bank
```

Provide:

```text
[ Manage Beneficiaries ]
```

linking to:

```text
/requisitions/beneficiary-master
```

Do not recreate beneficiary-bank CRUD here.

---

# 27. React Query conventions

Use:

```text
['subcontractWorks', filters]
['subcontractors', filters]
```

Reuse existing beneficiary queries.

After Work mutation:

```text
invalidate ['subcontractWorks']
```

After Subcontractor mutation:

```text
invalidate ['subcontractors']
```

---

# 28. Search behavior

Match Material Master:

```text
400 ms debounce
reset page to 1 when search/filter changes
server-side search
```

Do not filter only the current paginated page client-side.

---

# 29. Pagination behavior

Match Material Master:

```text
default page size = 10
server-side pagination
next-page prefetch
```

Use:

```text
totalItems
page
limit
totalPages
```

---

# 30. Frontend routing

Update:

```text
frontend/src/App.jsx
```

Lazy-load both pages.

Routes readable by:

```text
je
zo
ho
admin
```

Write buttons remain role-controlled in UI and backend-enforced.

---

# 31. Sidebar placement

Update:

```text
frontend/src/components/Sidebar.jsx
```

Under Project Control:

```text
Project Control
├── Cost Estimates
├── Material Master
├── Subcontract Work Master
├── Subcontractor Master
└── Daily Progress
```

Ensure desktop and mobile navigation both receive the entries.

---

# 32. Error semantics

Use:

```text
400 Bad Request
Malformed UUID / payload / query

403 Forbidden
Role does not permit operation

404 Not Found
Record does not exist
or inactive detail is hidden from non-admin

409 Conflict
Normalized duplicate Work
Referenced Work identity modification

422 Unprocessable Entity
Invalid beneficiary relationship

500 Internal Server Error
Unexpected failure
```

Do not expose raw DB/Supabase errors.

---

# 33. Database changes

No new master tables are required.

Do not modify:

```text
project_subcontract_estimates
project_subcontract_estimate_lines workflow behavior
project_cost_estimate_items integration behavior
subcontractor_balances behavior
subcontractor_ledger behavior
Finance requisition behavior
```

Only add a migration if implementation discovers a concrete missing DB invariant or index.

---

# 34. Backend tests — Subcontract Work

Cover:

```text
✓ JE/ZO/HO/Admin can read active
✓ Admin can read inactive/all

✓ JE/Admin can create
✓ ZO/HO cannot create

✓ only Admin can edit
✓ only Admin can status-change

✓ normalized duplicate returns 409
✓ whitespace/case duplicate returns 409

✓ invalid UUID returns 400
✓ missing record returns 404

✓ inactive hidden from non-admin
✓ inactive visible to Admin

✓ pagination/search/sort contracts work

✓ referenced work identity cannot change
✓ referenced work can be deactivated
✓ deactivation preserves FK history
```

---

# 35. Backend tests — Subcontractor

Cover:

```text
✓ project roles read active subcontractors
✓ Admin reads inactive

✓ JE/Admin can create
✓ ZO/HO cannot create

✓ duplicate contractor names allowed
✓ optional fields nullable
✓ invalid email rejected if supplied
✓ invalid UUID rejected

✓ valid beneficiary link accepted
✓ nonexistent beneficiary rejected
✓ beneficiary can be cleared

✓ only Admin can edit
✓ only Admin can change status

✓ inactive hidden from non-admin
✓ beneficiary enrichment correct
```

---

# 36. Backward compatibility

Verify this phase does not alter:

```text
Material Master
Cost Estimate
Projects Beneficiary Master
Payment Requisition
Subcontractor Ledger
```

Run:

```bash
npm run test:contracts:db
npm run test:regression
npm run test:local
```

---

# 37. Frontend QA

Verify:

```text
both pages load
JE sees Add buttons
JE does not see Edit/Status actions
ZO/HO see read-only management pages
Admin sees full controls

search debounce works
filters reset page to 1
pagination works
sorting works
inactive filter Admin-only

success/error popups match Material Master
beneficiary link opens existing Beneficiary Master
desktop/mobile navigation includes both pages
mobile layout remains usable
```

---

# 38. Performance

Use:

```text
server pagination
field-limited selects
batched beneficiary resolution
```

Avoid N+1 beneficiary queries.

Do not load the entire global master for management views.

---

# 39. Security

Every route requires JWT.

Never rely on frontend role checks.

Use backend role middleware.

Audit actor values come from:

```text
req.user.mobile_number
```

not client payloads.

No public direct table-write access is introduced.

---

# 40. Future Subcontractor Estimate integration

Later estimate lines will reference:

```text
subcontractor_id
subcontract_work_id
```

not:

```text
subcontractor_name
Material Master text
```

A future estimate form can consume a dedicated cached catalog or active typeahead endpoint.

Potential line shape:

```text
Subcontractor → UUID
Subcontract Work → UUID
Qty
Rate
Amount
```

---

# 41. Explicit non-goals

Do not implement here:

```text
Subcontractor Estimate header/line CRUD
BASE / ADDITION / ADJUSTMENT UI
ZO approval
HO approval
revision request
reopen
negative-adjustment workflow
Finance-capacity guard
Cost Estimate auto-import
weighted-rate integration
generated Cost Estimate row behavior
Payment Requisition beneficiary autofill
normalized Finance ledger cutover
```

---

# 42. Suggested implementation order

```text
1. Add Zod schemas
        ↓
2. Add Subcontract Work controller
        ↓
3. Add Subcontract Work routes
        ↓
4. Add Subcontractor controller
        ↓
5. Add Subcontractor routes
        ↓
6. Mount both in app.js
        ↓
7. Add backend regression tests
        ↓
8. Add frontend API wrapper
        ↓
9. Build Subcontract Work Master page
        ↓
10. Build Subcontractor Master page
        ↓
11. Add App.jsx routes
        ↓
12. Add desktop/mobile navigation
        ↓
13. Run DB contracts/regression/local suite
        ↓
14. Manual role/UX verification
```

---

# 43. Files expected to change

Backend:

```text
backend/src/app.js

backend/src/routes/subcontractWorks.routes.js
backend/src/routes/subcontractors.routes.js

backend/src/controllers/subcontractWorks.controller.js
backend/src/controllers/subcontractors.controller.js

backend/src/validation/subcontractMasters.schema.js

backend/tests/vitest/regression/subcontractMasters.test.js
```

Frontend:

```text
frontend/src/api/subcontractMastersApi.js

frontend/src/pages/SubcontractWorkMaster.jsx
frontend/src/pages/SubcontractorMaster.jsx

frontend/src/App.jsx
frontend/src/components/Sidebar.jsx
```

No Cost Estimate or Requisition implementation changes should be required in this phase.

---

# 44. Acceptance criteria

## Subcontract Work

- UUID-based canonical master is manageable;
- JE/Admin can create;
- only Admin can edit/status-change;
- normalized duplicates are blocked cleanly;
- inactive records remain stored;
- referenced work identity fields become immutable;
- referenced works may still be deactivated.

## Subcontractor

- UUID-based canonical master is manageable;
- JE/Admin can create;
- only Admin can edit/status-change;
- duplicate names remain legal;
- beneficiary linkage reuses `projects_beneficiary_master`;
- beneficiary is optional;
- inactive contractors remain historically resolvable;
- beneficiary enrichment has no N+1 behavior.

## UX

- pages match Material Master interaction patterns;
- server search/pagination/filter/sort work;
- React Query invalidation is correct;
- desktop/mobile navigation is present;
- role-specific actions are correct.

## Safety

- no hard deletes;
- no Finance behavior changes;
- no Cost Estimate behavior changes;
- no Subcontractor Estimate workflow changes;
- existing regression suites remain green.

---

# 45. Final architectural rule

Preserve:

```text
Subcontract Work Master
    defines WHAT subcontract work exists

Subcontractor Master
    defines WHO the contractor is

Subcontractor Estimate
    later defines WHO performs WHAT,
    at WHAT qty/rate/value,
    for WHICH Work Order

Cost Estimate
    later presents consolidated approved WO cost

Finance
    later enforces contractor/work monetary capacity
    and payment settlement
```

The master phase must not collapse those responsibilities together.

---

# 46. Suggested PR title

```text
feat(projects): add subcontract work and subcontractor masters
```

Suggested feature branch if implementation is split before merging back:

```text
feat/subcontract-masters
```
