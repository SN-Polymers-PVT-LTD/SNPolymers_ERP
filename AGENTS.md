# SN Polymers ERP — Agent Instructions

Explicit user instructions take precedence over workflow guidance in repo skills. Skills provide defaults and verification discipline; they must not expand or block an explicitly scoped user request without a concrete safety or correctness reason.

## Purpose

This repository is the production ERP for S. N. Polymers Pvt. Ltd. Treat this file as a map and operating contract. Before changing a subsystem, inspect the current implementation and read its business-rule documents.

If documentation and code disagree, business documents describe intended behavior while migrations, controllers, and RPCs describe deployed behavior. Do not silently reconcile the conflict; call it out before changing semantics.

## Repository map

- `frontend/` — React/Vite/Tailwind frontend.
- `backend/` — Node/Express backend.
- `backend/src/db/migrations/` — ordered forward-only PostgreSQL/Supabase migrations.
- `backend/tests/vitest/` — contract, regression, milestone, and integration tests.
- `supabase/`, `accounts/`, `docs/`, and `documentation/` — supporting configuration and product/technical documentation.

Read the relevant subcontractor documents before touching subcontractor masters, estimates, Cost Estimate integration, requisitions, balances, or the subcontractor ledger:

- `subcontractor_database_foundation_plan.md`
- `subcontractor_estimate_business_rules_and_data_semantics (1).md`
- `subcontract_work_and_subcontractor_masters_final_plan.md`
- `IMPLEMENTATION_GUIDE_subcontractor_ledger.md`

## Architecture and authority

- Frontend server state is owned by TanStack Query; `authApi` is the authenticated Axios client.
- Backend routes use `verifyJwt`, `requireRole`, and Zod `validateRequest`.
- PostgreSQL/Supabase is authoritative for persistent invariants, accounting, capacity, concurrency, and irreversible workflow rules.
- Reuse shared frontend components and established page patterns.
- Use canonical UUIDs for identity; never persist display strings when an ID exists.

## Roles

Canonical roles are `je`, `zo`, `ho`, `admin`, and `accounts`. `staff` is legacy and must not be introduced into new authorization. Backend authorization is authoritative; frontend route/button visibility must match it.

## Subcontractor domain

Canonical identity is `subcontract_work_master.id` and `subcontractor_master.id`. The intended flow is:

```text
Masters → WO-specific Subcontractor Estimate → ZO/HO approval
        → Final Approved contribution → Cost Estimate aggregation
        → Payment Requisition / Subcontractor Ledger
```

Approved source rows are append-only. `BASE` and `ADDITION` are positive contributions; `ADJUSTMENT` is the signed correction mechanism. Cost Estimate aggregation is by canonical `subcontract_work_id`; contractor identity remains in estimate/finance scope. Beneficiary links use IDs while requisitions retain audit snapshots.

`Estimate Reopened` is a real editable/submittable Cost Estimate state; do not silently convert it to `Draft`.

## Change rules

Before implementing: verify branch/status, read adjacent routes/controllers/services/schemas/tests, search callers, identify migration and compatibility risk, and reuse existing patterns.

While implementing: make the smallest coherent change, preserve audit/history semantics, keep frontend/backend contracts aligned, avoid N+1 queries, allowlist sort fields, sanitize raw PostgREST filters, and map expected database conflicts to stable 4xx responses.

Migrations are forward-only. Never edit an already-pushed migration; add the next migration. Preserve schema/RPC/index manifests and regenerate them when required. Do not force-push, reset user work, or push/merge without explicit authorization.

## Testing

From `backend/`, use the narrowest relevant test first, then broader suites:

```bash
npm run test:unit
npm run test:contracts
npm run test:contracts:db
npm run test:regression
npm run test:local
```

When schema/RPC/indexes/migrations change, run DB contract tests and add valid/invalid regression coverage. For frontend changes, run the available build/test/lint commands and verify route permissions plus loading, empty, error, success, and pagination states.

## Scoped instructions

For backend-only work, prefer launching Codex with `--cd backend` so `backend/AGENTS.md` is active.

For frontend-only work, prefer launching Codex with `--cd frontend` so `frontend/AGENTS.md` is active.

For cross-stack work launched from the repository root, follow this root file plus the applicable repo skill, and inspect the backend/frontend instruction files when those layers are touched.

## Working style

For non-trivial changes: inspect, summarize current behavior, state the plan, implement, test, review the diff, and report changes, evidence, and remaining risk. Do not claim a test passed unless it actually ran successfully.
