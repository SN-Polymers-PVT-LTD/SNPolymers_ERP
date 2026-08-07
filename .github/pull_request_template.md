## Summary

<!-- What changed and why? Link any related issue. -->

## Checklist

- [ ] **CI green** — all staged jobs pass (lint → backend unit → static contracts → integration → frontend)
- [ ] **Production migrations** — if `backend/src/db/migrations/` changed, `npm run migrate:prod` was run against production (or will run immediately after merge)
- [ ] **Manifests** — if migrations changed schema, RPCs, or indexes: `npm run generate:manifests` run and `backend/tests/manifests/*` committed
- [ ] **Production smoke** — after deploy, `/health` shows the expected `git` SHA (or Production smoke workflow dispatched)

## Milestone dedup

<!-- Delete this section if no milestone tests were removed. -->

If this PR removes tests from `backend/tests/vitest/milestones/`, confirm all [four dedup criteria](../backend/tests/README.md#milestone-deduplication) pass and paste the mapping below (see [`DEDUP_MAP.md`](../backend/tests/DEDUP_MAP.md)):

| Removed | Replacement |
|---------|-------------|
| | |
