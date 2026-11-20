# Payroll Phase 2 review of 93b028d against v1.4

Reviewed on 2026-10-11 on `employee_management`. Changes are uncommitted.
The original Phase 1/2 reports describe their original implementations; the
forward migrations below supersede their bounded-history/readiness descriptions.

## Findings and fixes

1. **P1 — CI isolation mismatch.** [The actual failed run](https://github.com/SN-Polymers-PVT-LTD/SNPolymers_ERP/actions/runs/38131939512)
   passed 117 integration files but failed both master fixture setup guards.
   The integration job now starts `backend/tests/local-supabase` and selects the
   `payroll` profile, API 55421 and PostgreSQL 55422 for migrations, manifests,
   contracts and integration tests. Existing fixture guards remain intact.
   Eleven legacy SQL test files now use the configured DB URI instead of a
   hardcoded shared connection; this prevents mixed API/SQL database fixtures.
   `test-local.sh` remains non-destructive: no reset/stop cleanup, including on
   failure, and existing-instance detection still validates JSON endpoints.

2. **P1 — aggregate adjustments cannot define a statutory wage base (§8, §9,
   §24.5, D08/D11).** Added optional `configuration.adjustment_basis` with exactly
   `SALARY_ARREARS`, `BONUS`, `REIMBURSEMENT`, `RECOVERY`. Earning types explicitly
   select `INCLUDE`, `EXCLUDE` or `UNRESOLVED` per scheme/revision. Recovery selects
   `DEDUCTION_ONLY` or `UNRESOLVED`: it is a separate deduction/ledger event, not
   a positive earning. A signed arrears correction belongs to salary arrears
   with original-period provenance; no correction arithmetic is activated.
   This is transaction/wage-basis classification, not a legal default.
   No rate, inclusion/exclusion choice or mobile-bill treatment is seeded.
   Legacy JSON with the eight-component partition remains valid and immutable.
   Its `ADJUSTMENTS` choice never determines individual typed treatment. When
   using typed classification, the old aggregate must be excluded so it cannot
   also contribute to the wage base. The UI starts all four types unresolved,
   offers explicit legacy-draft conversion, and resets advisor verification on
   changes. The database validates the same structure and retains the existing
   fresh-evidence, publication and immutability guards.

3. **P1 — configuration warnings mixed with scenario blockers (§6.3, §10,
   §17, §27).** Validation/resolution/publication preview now expose
   `configuration_warnings`. Invalid, missing/ambiguous or unverified statutory
   configuration remains blocking. Published monthly policy resolution no longer
   declares every employee blocked by irrelevant join/exit, split-run or leave
   exceptions. The pure `calculationReadiness(resolved, scenario)` requires
   explicit scenario facts; omitted/invalid context fails closed. It requires
   LOP rounding when there is LOP, independent proration/rounding for partial
   months, allocation/rounding for split runs, the full-unpaid exception for
   full-month absence, and leave/calendar rules for relevant leave. Calendar
   evidence text alone cannot supply an executable approved calendar. Statutory
   readiness requires canonical scope, an independently verified employee profile
   and classified adjustment types actually present. Legacy/unresolved treatment
   blocks affected adjustments; absence of adjustment facts is not assumed.
   A readiness result is a diagnostic, not authorization or a salary result;
   every result still has `financial_workflows_enabled: false`. Phase 3 must
   derive scenario facts and profile verification from authoritative sources,
   not request booleans, current enrolment flags alone, or caller guesses.

4. **P1 — free-text scope matching (§8.2, §24.5).** Safely prepared canonical
   migration using immutable `payroll_statutory_scopes` UUIDs for explicitly
   registered jurisdiction/establishment code pairs and immutable, evidenced
   revision bindings. `register_payroll_statutory_scope` and
   `bind_payroll_statutory_scope` require a current Admin; direct service/browser
   writes are denied. Only verified published revisions may be bound. Binding
   uses the existing master transaction lock and rejects overlapping published
   revisions of the same scheme/canonical scope, including differently spelled
   legacy aliases. Canonical resolution accepts `statutory_scope_id` and retains
   exact revision IDs and unchanged historical display labels. Existing label
   lookups remain available for historical inspection; unmapped results warn,
   and statutory calculation readiness requires a canonical binding.
   No production codes, aliases or employee statutory assignments are inferred.
   **Deliberately deferred:** business-confirmed scope inventory, Admin mapping
   UI, evidenced effective-dated employee statutory profiles, and requiring
   canonical scope before every new master publication. Until then publication
   of a verified legacy-labelled master is configuration-only; unmapped revisions
   cannot satisfy statutory calculation readiness. A binding cannot be corrected
   in place: an incorrectly mapped published revision requires a new reviewed
   revision. Future canonical publication must resolve/supersede by canonical
   scope and preserve this nonoverlap guard before financial activation.

5. **P1/P2 — Phase 1 foundation carryovers (§14, §24.1–4).** Migration 107 allows
   explicitly evidenced ongoing assignment/pay applicability with `effective_to:
   null`; no far-future end date or unknown exit is invented. Existing finite
   histories remain unchanged. Range exclusions prevent overlapping open-ended
   intervals; an evidenced exit requires a finite end within employment. Finite
   run dates and draft-row bounds still apply. A future transfer/salary change
   creates a new complete evidenced history revision; old snapshots remain.
   Account demotion/inactivation automatically appends payroll factory revocations
   for both factories. Reactivation/role restoration requires an explicit Admin
   regrant. System events are labelled `ACCOUNT_ACCESS_CHANGE`; their creator
   field identifies the affected account, not a claimed Admin authorizer. Already
   ineligible legacy grants are revoked by the migration as well. Attendance
   roles and factory-master access are unchanged.
   Allocations now require `employee_id` and composite foreign keys to both the
   monthly entitlement and employee salary row. Posting gates remain enabled;
   tests exercise exact constraint definitions on temporary copies. Migration
   107 intentionally aborts if anomalous existing allocations are found, rather
   than infer ownership or disable the posting gate to rewrite them.

## Migration and activation boundary

- Added forward-only migrations `107_payroll_phase2_review_hardening.sql` and
  `108_payroll_typed_adjustments_canonical_scope.sql`. Committed 104–106 are
  unchanged. The 106 validator is retained privately and extended by a small
  wrapper, preserving legacy validation rather than duplicating its rules.
- Updated schema/RPC/index manifests: 56 tables, 44 RPCs, 83 indexes.
- No employee profile, adjustment ledger, statutory accumulator or wage engine
  is implemented. Approval, employee locking, finalized coverage, entitlement/
  allocation posting, statutory liabilities, bank obligations and bank payments
  remain disabled. Policy decisions still require sign-off; publication never
  approves an unresolved employee scenario.
- No shared instance is stopped, reset or migrated for these checks.

## Verification

- Payroll-specific local runner: **70 tests / 7 files passed**.
- Complete backend unit suite: **122 tests / 17 files passed**.
- Complete CI integration command, isolated profile: **933 tests / 119 files
  passed**, including payroll fixture guards, master concurrency and affected HR
  and finance regressions.
- Static contracts: **16 tests / 2 files passed**. Initial sandbox execution
  denied local listeners/child processes; rerun with the required permissions
  passed without source changes.
- Database contracts: **32 tests / 7 files passed**.
- Payroll frontend: **8 tests passed**. Complete frontend suite: **1,069 tests
  / 152 files passed** with `npm test -- --maxWorkers=2`. The initial default-worker
  run had one unrelated five-second Excess Fund Returns timeout while other
  suites/builds ran concurrently; assertions and timeouts were not changed.
- Frontend lint: zero errors, one existing `SubcontractEstimates.jsx` warning.
- CI production build with the configured `VITE_API_URL`: passed.
- Manifest regeneration was identical on repeat. All nine new/replaced SQL
  function bodies matched the isolated database; financial posting triggers
  remain enabled and private helpers have no public/browser/service execute
  grants. Shared counts remain 115 employees, 113 applied migrations and two
  payroll runs; no new canonical scope table exists there.
- `git diff --check` passed. Graphify AST update completed; its existing semantic
  node warnings remain outside the payroll implementation.

An updated hosted GitHub Actions run requires an approved commit/push. The old
run remains failed; local results are not a claim that GitHub has run these
uncommitted changes. No commit or push has been made.
