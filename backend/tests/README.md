# Backend Test Suite Policy

This document defines where tests live, how to add new coverage, and how milestone deduplication works.

## Folder roles

| Folder | Status | Purpose |
|--------|--------|---------|
| [`vitest/unit/`](vitest/unit/) | **Active** | Pure logic, helpers, no DB (or fully mocked) |
| [`vitest/contracts/`](vitest/contracts/) | **Active** | Schema, RPC signatures, API shapes, serialization types |
| [`vitest/regression/`](vitest/regression/) | **Active** | Cross-cutting bug prevention (auth, money, RBAC, idempotency) |
| [`vitest/milestones/`](vitest/milestones/) | **Frozen (legacy suite)** | Historical feature workflows — **do not add new tests** |

## Decision tree

```
Need to test a pure function / helper with no DB?
  → unit/

Testing API response shape, schema, RPC signature, or JSON types?
  → contracts/

Testing a production bug class (auth, money, RBAC drift, idempotency)?
  → regression/
  (+ update rbacMatrix.js or serializationSchemas.js when relevant)

Fixing a bug in an existing milestone feature workflow?
  → edit that milestone file only

Building a new feature?
  → do NOT add tests under milestones/
  → add unit/ + contracts/ and/or regression/ as appropriate
```

## When to extend shared helpers

| Change | Update |
|--------|--------|
| New `requireRole` / `requireAdmin` on a route | [`helpers/rbacMatrix.js`](helpers/rbacMatrix.js) — add a deny row for the dangerous wrong role |
| Money/date/boolean type drift on API payloads | [`helpers/serializationSchemas.js`](helpers/serializationSchemas.js) |
| New money-moving invariant or retry safety | New case in [`vitest/regression/`](vitest/regression/) using [`financialFixture.js`](helpers/financialFixture.js) |

## What stays in milestones

Do not deduplicate or migrate these without a 1:1 replacement mapping:

- ZO ownership mismatch (requisition approve, fund request detail)
- Per-project digital twin mapping
- Estimate ownership (`isOwnerOrAdmin`)
- Full CRUD / workflow lifecycle tests for a single module
- ZO zone scoping in analytics (e.g. `hoDashboardInsights` P0.x)

## Ownership / priority on failure

| Suite | On failure |
|-------|------------|
| **regression/** | **Release blocker** — fix before merge/deploy |
| **contracts/** | **Release blocker** (CI fast + integration gates) |
| **unit/** | **Release blocker** (CI unit gate) |
| **milestones/** | Regression in **legacy workflows** — fix if behavior broke; **do not add new coverage here** |

## Milestone deduplication

Remove a milestone test only if **all** of the following hold:

1. **Same behavior** — same user-visible outcome
2. **Equal or stronger assertions** — replacement checks same fields or more
3. **Same authorization context** — same role, route/handler layer, preconditions
4. **Same business constraints** — not merely “both are 403 tests”

Every removal must be recorded in [`DEDUP_MAP.md`](DEDUP_MAP.md) with the replacement file and test name. PRs that delete milestone tests must include a **Milestone dedup** table copied from that file.

## Commands

```bash
cd backend

npm run test:unit              # unit/ only
npm run test:contracts         # static deploy contracts (no DB)
npm run test:contracts:db      # schema, RPC, shapes, serialization
npm run test:regression        # active regression suite
npm run test:milestones        # frozen legacy suite only
npm run test:integration       # regression + milestones + root vitest (CI)
```

Requires local Supabase for DB-backed suites: `npx supabase start` then `npm run migrate`.

## Further reading

- [`vitest/README.md`](vitest/README.md) — Vitest conventions and file structure
- [`DEDUP_MAP.md`](DEDUP_MAP.md) — removed milestone tests → active replacements
