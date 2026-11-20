# Payroll Phase 2 — Policy and Statutory Masters

Implemented on `employee_management`, based on v1.4 and committed Phase 1 (`341efae`). No commit, push or PR was created. Phase 3 has not started.

## Compatibility and scope

Phase 1.1 runner hardening is included in the working tree: structured CLI status validation, independent Docker detection on status failure, fixed local targets, project lock, and **no automatic stop/reset/destructive cleanup**. Full local integration runs, broad directories containing payroll, and explicit payroll selections automatically use isolation. Direct Phase 2 DB tests refuse to write fixtures without the payroll profile. Payroll tests use project `SNPolymersPayrollTests`, API 55421 / PostgreSQL 55422, with separate volumes. Both stacks remain running. The old fixture loss is documented; this work does not claim to recover those fixtures.

Phase 1 run/employee/source-history APIs and all three posting-gate triggers remain intact. No salary calculation, net pay, submission, approval, locking, coverage posting, monthly entitlement/allocation posting, statutory withholding/liability, payment or Accounts bank integration was added. Attendance, decided leave, permanent pay lifecycle, factory wages/rules and FM access to both factories retain their existing contracts.

The Permanent Pay Structure audit found only `epf_enrolment` and `esi_enrolment`, with no editable contribution amount/rate columns or controls. Existing strict request validation rejects forged rates/amounts. No pay columns, employee records or enrolment behavior were removed.

## Database and resolution

Forward migration **106_payroll_policy_statutory_masters.sql** extends the existing `payroll_policy_master_revisions`; no parallel policy table is introduced.

| Object | Contract |
| --- | --- |
| Policy revisions | Global or permanent payroll-group scope; contractual monthly entitlement; independent fixed/actual LOP, join/exit method/divisor, split allocation, full-unpaid exception, weekly-off/calendar dependency and rounding objects; draft version and published revision/audit fields |
| `payroll_statutory_rule_revisions` | Separate EPF/ESI/PT scope by exact scheme + jurisdiction + establishment; effective range, draft/published state, structured configuration and advisor verification evidence |
| Statutory configuration | Exact decimal-string employee/employer percentages, explicitly included/excluded earning components, named eligibility, eligibility/wage ceilings, contribution minimum/cap, named calculation/rounding, calendar-month aggregation and month-start applicability |
| `payroll_professional_tax_slabs` | Exact NUMERIC lower/upper/amount; half-open `[lower,upper)` boundaries; NULL upper means infinity; complete independent wage schedule for each calendar month |
| `payroll_master_events` | Append-only draft creation/edit, publication and future-supersession events with actor, time, before/after snapshots and FK to the exact revision |

No production policy, statutory rates or PT slabs are seeded. Synthetic monetary values appear only in isolated fixtures/tests and clearly labelled reference examples.

Published financial values, identity and approval metadata are immutable. Revisions remain `PUBLISHED` for historical lookup; the UI distinguishes future/current/historical applicability. Publication must start on a **future first day of a month** in Asia/Kolkata. Mid-month and retroactive publication remain unsupported until signed segmentation/contribution-period semantics exist.

A replacement can shorten the **future tail of one same-scope predecessor** to the day before its new start. It cannot rewrite past dates, consume another scheduled revision, or truncate the predecessor without covering its remaining range. The original published end date remains in `published_effective_to`, and supersession records both snapshots and replacement/approval references. GiST exclusion constraints reject overlapping published periods; unique indexes protect published revision numbers.

Policy resolution is **specific group → global default**. Drafts are excluded; missing/ambiguous results are explicit. Casual/Local resolution returns `DAILY_WAGE_MASTER_REQUIRED`, preventing implicit monthly-policy application to wage labour. Statutory resolution requires exact jurisdiction/establishment and only published, advisor-verified revisions. Resolvers preserve the revision UUID and return structured blockers. Historical dates continue resolving the old revision after replacement.

`rounding` holds independent LOP/proration/allocation method, precision and stage. The old `monetary_rounding_method=UNRESOLVED` placeholder is retained for compatibility; it does not supply an implicit final-salary rounding default. An evidence reference does not make the Phase 1 draft calendar executable: calendar-dependent cases remain blocked.

## Workflow and API

Current database-backed Admin role is checked at HTTP and RPC boundaries. No direct table privileges exist for anon, authenticated or service role; only explicit RPCs are service-callable. Draft edits use version compare-and-swap and check the current writer, preserving the historic creator even if that creator's account later becomes inactive. Changes to verified statutory financial/scope/date data clear verification in the UI; the RPC rejects reuse of unchanged verification evidence for altered verified rules. PT draft scheme changes remove old slabs while the parent is still a PT draft, atomically preserving/restoring all prior data on failure. Publication serializes master changes, rechecks the draft/version and preview token, validates effective-date conflicts, and writes audit events in the same transaction. Expected stale operations return HTTP 409 (`PY409`), with 400 validation, 403 access and 404 missing-record responses.

Base path: `/api/v1/auth/hr/payroll/masters/:kind`, where kind is `policies` or `statutory`.

| Endpoint | Request / result |
| --- | --- |
| GET base | `page`, `limit`; paginated revisions, complete draft data, groups and corresponding audit events |
| POST `/drafts` | `{id: UUID or null, expected_version: 0 for new, data: complete typed configuration}`; saved draft/version |
| GET `/:id/preview` | Field diff, predecessor(s), conflicts, readiness blockers, draft-row impact, publishability and preview token |
| POST `/:id/publish` | `{expected_version, preview_token, approval_reference}`; immutable published revision |
| GET `/resolve` | Date + group, or date + scheme/jurisdiction/establishment; exact revision and blockers, or explicit resolution error |

Policy publication may retain unresolved **case-specific** fields; publication alone never enables salary calculations. Statutory publication refuses unverified/missing/unsupported rules. Advisor name, evidence reference and verification date must be explicitly supplied; saving a draft is not automatic legal verification. The application records Admin-attested evidence; it does not independently certify its legal correctness.

PT schedules cover zero to infinity without gaps or overlaps for all 12 months, allowing month-specific amounts. Unresolved/profile-dependent conditions block statutory publication. No percentage is used for PT. Percentages, ceilings and amounts accept exact decimal strings through the API; PT uses NUMERIC storage. No JavaScript floating-point monetary arithmetic was added.

Impact counts policy-group/date affected drafts (permanent groups for global policy). Statutory impact is conservatively all drafts in the date range because employee jurisdiction/applicability profiles are not yet implemented. Phase 1 rows remain NOT_CALCULATED; no stale financial review exists to clear. Phase 3 must include policy/statutory IDs in source fingerprints and invalidate affected calculated previews.

Future statutory accumulation should serialize `(employee_id, scheme, statutory_month, jurisdiction, establishment)` across groups/runs, retaining revision IDs, qualifying-wage snapshots, prior employee withholding and separate employer liability. No accumulator postings are created here.

## Frontend and changed files

Admin → Payroll Management exposes `/admin/payroll/policies` and `/admin/payroll/statutory`, protected by Admin routes and navigation. Screens include separate drafts/published history, current/future/historical labels, structured draft editors, statutory wage-component/ceiling/eligibility controls, monthly PT slab editing, advisor evidence, historical resolution, diff/impact publication confirmation, loading/empty/error/success and paginated lists. TanStack Query refreshes after writes; existing shared controls and `authApi` are reused.

Phase 2 files:

- `backend/src/db/migrations/106_payroll_policy_statutory_masters.sql`
- `backend/src/controllers/payrollMasters.controller.js`, `backend/src/domain/payrollMasters.js`, `backend/src/validation/payrollMasters.schema.js`, `backend/src/routes/payroll.routes.js`
- `backend/tests/helpers/payrollMasterFixtures.js`; unit `payrollMasters.test.js`; regression `payrollMasters.test.js`, `payrollMastersApi.test.js`, and the Phase 2 compatibility update to `payrollFoundation.test.js`
- `backend/tests/manifests/{manifestScope,rpcAllowlist,indexAllowlist}.json` and all three generated manifests; `backend/package.json` includes the master suites in `test:payroll:local`
- `frontend/src/api/payrollMastersApi.js`; `frontend/src/pages/admin/{PayrollMasters,PayrollMasterFields}.jsx`, `PayrollMasters.test.jsx`; `frontend/src/{App.jsx,App.test.jsx,components/Sidebar.jsx}`
- This report and refreshed Graphify outputs (graph files were already dirty before this work).

Phase 1.1 files retained: `.gitignore`, `backend/README.md`, `backend/scripts/test-local.sh`, `backend/scripts/lib/check-local-supabase-status.js`, `backend/src/config/localTestTarget.js`, `backend/src/db/supabase.js`, `backend/vitest.config.js`, `backend/tests/local-supabase/supabase/config.toml`, `backend/tests/vitest/unit/localTestRunner.test.js`, and the Phase 1 implementation report follow-up.

## Verification

Tests ran against isolated Supabase only; no shared cleanup/reset/stop was performed.

| Executed verification | Final result | Evidence |
| --- | --- | --- |
| Broad backend unit/API/PostgreSQL compatibility selection, 20 files | **223 passed** | `/tmp/payroll-phase2-compatibility.log` |
| Final affected payroll + runner selection after last fixes, 7 files | **70 passed**: 18 master unit, 13 master DB (including real concurrency for both kinds), 4 master HTTP, 19 Phase 1, 16 runner tests | `/tmp/payroll-phase2-final-focused.log` |
| DB schema/RPC/index and API contracts, 7 files | **32 passed** | `/tmp/payroll-phase2-db-contracts.log` |
| Deployment/app boot contracts, 2 files | **16 passed** | `/tmp/payroll-phase2-deploy-contracts.log` |
| Frontend Payroll Masters, Employee Management, Factory Masters and App routes, 4 files | **108 passed** | `/tmp/payroll-phase2-frontend-tests.log` |
| Frontend production build | Passed | `/tmp/payroll-phase2-frontend-build.log` |
| ESLint on all seven changed frontend source/test files | Passed, no errors/warnings | `/tmp/payroll-phase2-frontend-lint.log` |
| Complete migration 106 replay from Phase 1 table shape inside rollback-only isolated transaction | Passed; original schema and fixtures restored | `/tmp/payroll106-fresh-replay.log` |
| Live migration function bodies vs final source | All 12 matched | Read-only PostgreSQL comparison |
| Manifests regenerated from isolated DB | 54 tables, 42 RPCs, 81 indexes | `/tmp/payroll-phase2-manifests.log` |
| Shell/Node syntax, diff check, Graphify AST update | Passed | `/tmp/payroll-phase2-graph.log` |

The broad backend run covers employee master, pay creation/revision/suspension, factory masters/rosters, attendance/leave/calendar/review/API, Accounts requisition lifecycle/close-review/credit invariants and authorization. Subsequent narrow verification covers the final draft reclassification, inherited-draft Admin access, verification-evidence and runner isolation fixes. Earlier failing development runs were corrected; only successful final results are reported above. Existing OTP contract tests logged Telegram delivery fallback, but all contract assertions passed.

Shared snapshots remained identical: **115 employees, 113 migration-log entries, 2 payroll runs, 0 Accounts items**. The shared DB has no new statutory table. Both shared 54321/54322 and isolated 55421/55422 stacks remain running. No existing enrolment data was migrated or removed. Test fixtures were rolled back where possible; persistent synthetic HTTP/concurrency fixtures remain only in the isolated DB.

Re-run the payroll suites with `npm run test:payroll:local` from backend. For DB contracts use `LOCAL_SUPABASE_TEST_PROFILE=payroll npm run test:contracts:db`. The full repository backend/frontend suites and repository-wide lint were not run; selected affected suites and changed-file lint were run. No manual browser UAT, production/staging migration or deployment, or verification of real legal rates was performed.

## Remaining decisions and Phase 3 boundary

Full-month unpaid treatment remains UNRESOLVED, including February residual and 31-day negative-gross cases. Join/exit numerator and holiday interaction, split-run residual allocation, explicit leave-range weekly offs, approved calendars and rounding placement still require signed rules. Actual-calendar LOP/proration options are available for explicit future approved revisions and are not seeded as current choices.

Live statutory rules require the client's advisor: wage components, ceilings, eligibility/continuity, scheme-specific caps/minima, rounding, jurisdiction conditions and contribution-period timing. This phase supports explicit monthly/month-start named configurations; schemes needing other timing or profile exceptions remain blocked. Employee statutory profiles, monthly liability reconciliation and filing are deferred.

Recommended Phase 3: agree outstanding decisions, add readiness/source segmentation and exact-decimal **preview-only** calculation with case-specific blockers, revision fingerprints and monthly reconciliation design. Preserve all posting/approval/payment gates until separately implemented and verified. No Phase 3 work was begun.
