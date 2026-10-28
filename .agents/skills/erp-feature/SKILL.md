---
name: erp-feature
description: Implement, extend, plan, or finish non-trivial SN Polymers ERP features across database, backend, frontend, and tests. Use for feature work and workflow changes; do not use for tiny isolated fixes.
---

# ERP Feature Implementation

Use this skill for feature work in SN Polymers ERP.

## Workflow

1. Confirm branch, worktree status, latest relevant migration, and current controller/RPC behavior. Read `backend/AGENTS.md` before modifying backend files and `frontend/AGENTS.md` before modifying frontend files when those nested instruction files are not already active in the session.
2. Read applicable business-rule and implementation-plan documents.
3. Trace routes, controllers, schemas, services, migrations, API wrappers, pages, navigation, and tests.
4. State the contract, authorization matrix, persistence invariants, migration plan, and compatibility risks.
5. Implement the smallest coherent vertical slice; put durable rules in the database where controller-only checks can race.
6. Add regression coverage before broad verification.
7. Run focused tests, DB contract tests when applicable, broader suites, and the frontend build.
8. Review `git diff --check`, status, and staged paths before committing.

Report changed files, migrations, authorization behavior, tests actually run, environmental/pre-existing failures, and remaining risks. Never include unrelated plans or generated artifacts in a feature commit.
