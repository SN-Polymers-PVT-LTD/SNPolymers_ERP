# Payroll Phase 6A — Statutory profile foundation

> Factory grant references below describe the historical implementation. The 14 October 2026 client decision and migration 131 supersede them: active FMs access payroll for both factories without grants. See [factory access removal](SN_Polymers_Payroll_Factory_Access_Removal.md).
Phase 6 is **not financially complete**. This delivery stops at the safe employee-profile subphase permitted by the request. No statutory deduction formula, final net salary, monthly statutory ledger, salary locking, payment ledger, bank debit, statutory posting or settlement has been activated. Existing Phase 1 posting gates and Phase 4 `approve_lock` blockers remain intact. No commit or push was made.

## Why financial implementation stops here

The v1.4 decision register still requires reviewed employee eligibility, contribution bases, ceilings, rounding, state and effective rules (D08), statutory accumulation across runs (D09), permitted limits/approval per recovery type (D11), negative-net/zero-pay/off-cycle treatment (D14), and bank/cash settlement mechanics (remaining D15). D10 mobile-bill treatment, D22 split permanent allocation and D23 full-month unpaid/weekly-off treatment also remain unresolved for affected scenarios. The specification's sign-off section does not supply the missing decisions. Master publication or a profile evidence reference does not resolve these policies.

Before continuing Phase 6, supply approved client/advisor decisions and employee evidence covering these cases. Salary approval, payment and statutory settlement must remain separate. No production rates, exemptions, enrolments, recovery limits or payment methods were seeded or inferred from spreadsheets or existing display labels.

## Implemented vertical slice

- Migration `114_payroll_statutory_profile_foundation.sql` adds one private, append-only profile-child table to the existing source-history revision architecture. Each complete timeline carries all three schemes (EPF, ESI, PT), canonical scope UUIDs, applicability, explicit EPF/ESI enrolment evidence and private advisor/basis references. PT cannot inherit an enrolment flag. Existing HR enrolment flags are preserved; contradictory evidence blocks readiness.
- Admin-only history, authoring and paginated canonical context RPCs/API routes reuse current actor checks, the canonical scope registry and explicit revision-binding RPCs. No ownership-handoff policy is introduced for legacy payroll drafts.
- The Admin profile screen supports employee/scope search and pagination, explicit canonical registration/binding, dated complete-timeline corrections and immutable evidence history. Edits to dates or scheme facts clear verification; a stale save retains the edits and requires reloading the current history. There are no deduction or net-amount input fields.
- Source resolution uses the same single PostgreSQL MVCC statement as existing previews. Only the selected employee's minimal profile fields and applicable, canonically bound, verified published rule identifiers are returned. Advisor references, basis documents, establishment labels and full statutory rule payloads remain private. A profile change updates the source fingerprint and invalidates stale approvals. Employees without profile history retain the previous source JSON shape and fingerprint behavior.
- Readiness distinguishes missing coverage, ambiguity, unverified facts, missing canonical IDs, conflicting enrolment and absent applicable rule coverage. A documented non-applicability result is diagnostic evidence; deductions and employer contributions remain `null`, not zero. All previews retain explicit calculation-not-activated and monthly-reconciliation-not-implemented blockers.

Profiles can contain multiple non-overlapping dated intervals and ongoing periods. Current diagnostic rule resolution requires a single profile/rule to cover the complete source window; changes within that window remain blocked until an approved segmentation/monthly reconciliation contract is implemented. Verification records evidence entered by Admin; the ERP does not independently validate the advisor's legal conclusion.

## Database and authorization safeguards

Profile writes lock the employee and compare the expected history version before inserting a complete immutable revision. Concurrent writers cannot both publish the same expected version. Foreign keys enforce canonical IDs and employee/revision ownership; exclusion constraints prevent overlapping scheme intervals within a revision. Invalid timelines roll back the parent and every child. Verification requires explicit applicability, scope and enrolment evidence; future verification dates are rejected. Updates/deletes and direct service-role table access are denied.

API authorization and service-only database RPC actor checks both require Admin for authoring/private evidence. Existing role/factory grants still govern payroll previews, including both factories for the granted Manager. Existing Accounts/HO review transactions revalidate source fingerprints. Verified profiles cannot bypass `FINANCIAL_FINALIZATION_DISABLED` or write coverage/entitlement/allocation records.

## Changed files

- Database: migration 114; schema/RPC/index manifest scope, allowlists and regenerated manifests.
- Backend: `payrollProfiles.controller.js`, `payrollProfiles.schema.js`, `payroll.routes.js`, `domain/payroll/statutory.js`, `domain/payroll/preview.js`; `package.json` isolated payroll suite registration.
- Frontend: `payrollProfilesApi.js`, `EmployeeStatutorySetup.jsx` within Employee Management, Accounts/Admin route, sidebar and statutory-master navigation. The standalone profiles route has been removed.
- Tests: synthetic `payrollProfileFixtures.js`, profile unit/API/PostgreSQL regressions, profile screen and Admin route tests.
- The pre-existing uncommitted Phase 5 department-only HTML export fix is preserved separately; this subphase does not change payroll reporting semantics or official-payslip eligibility.

## Verification

The isolated `SNPolymersPayrollTests` project uses ports 55421/55422. Tests leave it running and perform no destructive cleanup; the shared Supabase instance is untouched.

- Backend unit suite: 182 tests passed.
- Complete isolated payroll suite: 182 tests passed, including the final Factory Manager privacy regression.
- Profile API plus DB schema/RPC/index and Employee/Pay Structure contracts: 30 tests passed before the additional factory privacy regression.
- Isolated attendance, attendance review, leave and Accounts requisition lifecycle compatibility: 73 tests passed.
- Affected payroll frontend pages and App routing: 132 tests passed.
- Frontend production build passed. Lint reported zero errors and the existing `SubcontractEstimates.jsx` `activeFilters` hook warning.
- Full frontend suite: 1128 passed and 2 failed out of 1130. All new profile tests passed. The unrelated Requisitions JE retry/create-modal test also fails on the untouched pre-Phase-5 checkout. A separate unchanged BeneficiaryAutofill banner test timed out in this broad run. The focused rerun of both unchanged Accounts files passed all 14 tests, demonstrating run-sensitive failures; the full-suite failures are still reported.

Regressions exercise actual two-connection version races, rollback safety, immutable history, direct-table/RPC permissions, canonical registration/binding, employee-only rule selection, private-evidence minimization, stale fingerprints/approvals and blocked locking. Payment duplication, partial settlement and final financial-lock concurrency are deliberately not simulated through a fabricated ledger: those require the deferred approved contracts and atomic financial implementation.

## Remaining prerequisites and rollout risks

Do not enable financial flags after merely populating profiles. The next safe slice needs approved scheme formulas and eligibility/continuity evidence, exact-decimal contribution calculation, statutory-month accumulation/rounding and reconciliation, approved adjustments/recoveries, and valid final net. Atomic locking must then create immutable financial snapshots and enforce coverage/allocation invariants before replacing any posting gate. Payment records, partial/failed/reversed settlement, idempotent reference imports, ledger authorization and official payslips remain later Phase 6 work, not Phase 7.

Migration 114 has been applied only in the isolated test project. Production deployment and financial activation require separate approval and verification. No existing Locked salary, attendance or finalized leave record is modified.

The subsequent guarded financial implementation is documented in [Phase 6 implementation](SN_Polymers_Payroll_Phase6_Implementation.md); it supersedes this foundation report’s earlier implementation-status limitations while retaining the production activation gate.
