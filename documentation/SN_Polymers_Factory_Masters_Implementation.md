# Factory role and effective-dated masters

Implemented scope: the first two approved stages, adding Factory Manager to the existing account system and adding the two authoritative factory masters. Attendance, leave, sheets, locking, and payroll remain later stages.

## Access and integration

| Capability | Admin | Factory Manager | HO | JE / ZO / Accounts |
| --- | --- | --- | --- | --- |
| Account creation and Employee Master account linking | Existing Admin access | No | No | No |
| Read factory masters and applicable revisions | Yes | Yes | Yes | No |
| Create master revisions | Yes | Yes | No | No |
| Existing project, finance, accounting, and Admin modules | Existing role boundaries | No | Existing role boundaries | Existing role boundaries |

The stored token is `factory_manager`; the interface displays **Factory Manager**. Employee linking reuses `hr_employees.erp_user_id` and `authorised_users.id`. No employee, salary, or account records are duplicated.

Migration `095_add_factory_manager_role.sql` extends the account role constraint and revokes active sessions transactionally when a role changes or an account is deactivated. Unchanged roles preserve sessions. `verifyJwt` resolves the current database role, and factory endpoints additionally use a live HR role guard. A role reassignment requires login again; old access and refresh tokens cannot revive the revoked session.

## Authoritative configuration

Migration `096_hr_factory_wage_and_attendance_rules.sql` adds:

- `hr_factory_wage_revisions`: category, effective date, daily wage, revision identity, and audit actor/time. Only Casual and Local Daily-Wage categories are valid.
- `hr_factory_pay_rule_revisions`: category, effective date, standard hours, OT configuration, holiday configuration, management stoppage treatment, short-hours treatment, compensatory-off description, and local double-duty multiplier, plus revision identity and audit actor/time.

Permanent employees retain the existing Permanent Employee Pay Structure as their salary source. Wage screens display repeated rule facts from the rule master without storing them again. Policy descriptions are saved as approved configuration information; they are not executed as formulas or a rules language.

Each master has unique `(employee_category, effective_from)` and `(employee_category, revision_number)` constraints. Applicable configuration is the latest revision whose effective date is at or before the requested business date. Wage and rule revisions resolve independently. Current/Future/Historical labels are derived relative to the selected date, including when the applicable revision lies outside the current history page.

Database triggers allocate per-category revisions under a transaction advisory lock, validate the current active Admin/FM actor, reject revision updates/deletes, and append full revision snapshots to the existing `audit_log` in the same transaction. Checks enforce category/method compatibility, exclusive OT rate/multiplier fields, local holiday restrictions, local-only double duty, valid policy descriptions, and finite nonnegative wages/positive hours and multipliers. Service-role access is SELECT/INSERT only; anonymous and authenticated database roles receive no table access.

There are no seeded rates or effective dates. UI starting references are editable and require an explicit effective date before saving. Historical revisions are immutable; corrections create revisions on a different effective date.

## API and UI

The API prefix is `/api/v1/auth/hr/factory-masters`:

- `GET /wages` and `GET /rules`: category filter, required `as_of`, page/limit, and derived revision status.
- `GET /effective`: required category/date; applicable wage/rule revisions, or null where no applicable configuration exists.
- `POST /wages` and `POST /rules`: strict validated revision payload, server-derived actor, and HTTP 409 for a duplicate category/effective date.

`/factory-masters` uses the existing `authApi`, TanStack Query, shared form/table/pagination components, and Factory navigation. Its URL retains master tab, category, applicable date, and page. FM/Admin can create revisions; HO sees the same configurations/history without a write form. Existing audit actor enrichment now resolves both UUID and legacy mobile-number identifiers.

## Verification on 30 September 2026

Local Docker Supabase was started and all 104 repository migrations were applied in filename order. The final version of migration 096 was also executed in a rollback-only transaction to preserve local browser/test records. Schema/index manifests were regenerated.

- Backend: 26 files / 157 tests passed, covering all unit and contract suites plus factory-master, employee, permanent-pay, and auth-whitelist regressions. This includes DB contract tests, concurrency, invalid direct SQL, atomic failed session-revocation rollback, stale-role denial, account linking, date boundaries, immutable revisions, and audit actor enrichment.
- Frontend: complete suite passed, 143 files / 953 tests. A final affected-suite rerun passed, 4 files / 68 tests. Nine new master UI tests cover canonical payloads, read-only HO, local rules, method changes, loading/errors/retry, duplicate dates, and URL pagination; route/navigation/account-management coverage was also extended.
- Frontend lint: zero errors; one existing `SubcontractEstimates.jsx` useMemo dependency warning. Production build and `git diff --check` passed.
- Browser against the local API/DB: FM login, casual wage creation, permanent and local rule creation, applicable configuration display, FM direct Admin-route denial, and HO read-only history were verified.

To reproduce backend verification, start local Supabase, apply migrations, and run from `backend/`:

```bash
GMAIL_USER= GMAIL_APP_PASSWORD= ADMIN_EMAIL= TELEGRAM_BOT_TOKEN= node_modules/.bin/vitest run \
  tests/vitest/unit tests/vitest/contracts \
  tests/vitest/regression/hrFactoryMasters.test.js \
  tests/vitest/regression/hrEmployees.test.js \
  tests/vitest/regression/hrPayStructures.test.js \
  tests/vitest/regression/authWhitelist.test.js
```

For local browser verification, run the API with `NODE_ENV=test`, port 5050, and empty Telegram/email credentials. Run Vite with `VITE_API_URL=http://localhost:5050/api/v1/auth`. Clearing credentials is necessary because the existing server startup overrides `TELEGRAM_MODE=disabled`. Test records are local-only and intentionally preserved where revision/audit immutability prohibits cleanup.
