# Backend Agent Instructions

The backend is Node.js/Express with Supabase/PostgreSQL. Routes should compose `verifyJwt`, `requireRole`, and Zod `validateRequest`; controllers should keep HTTP mapping and orchestration clear; database objects should enforce durable invariants.

Before changing a route, controller, schema, service, RPC, or migration, inspect its callers and adjacent tests. Preserve response shapes and audit fields unless the requested contract explicitly changes them.

## Database and authorization

- Add forward-only numeric migrations; never edit an already-pushed migration.
- Prefer constraints, triggers, and transactional RPCs for rules that can race.
- Keep migrations deterministic and safe on a fresh database; update manifests when required.
- Map expected database conflicts/validation failures to explicit 4xx responses.
- Backend role checks are authoritative. Do not rely on frontend visibility.
- Use allowlists for sorting and sanitize values interpolated into PostgREST `.or()` expressions.
- Normalize optional inputs consistently before persistence.

## Tests

Use `npx vitest run <file>` for focused tests. For DB-backed tests use `bash scripts/test-local.sh ...`, which starts local Supabase and applies migrations. For migrations/RPCs/schema/indexes run `test:contracts:db`; for broad confidence run `npm test`.

Add regression coverage for successful and rejected paths, including authorization, invalid identifiers, conflicts, inactive visibility, and partial updates.
