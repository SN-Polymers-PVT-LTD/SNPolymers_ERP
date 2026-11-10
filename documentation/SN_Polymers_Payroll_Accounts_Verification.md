# Unified payroll and Accounts workflow — implementation verification

Implementation date: 3 November 2026. Branch: `employee_management`.

## Implemented user flow

- Factory Manager generates/checks payroll and selects **Submit to Accounts**. A real numbered Accounts salary sheet is created automatically. Repeated submissions reuse the existing delivery receipt. Later submissions use a successor sheet if Accounts has already sent the first sheet.
- Accounts completes employee payment details in the existing Requisition Sheets page, optionally fills missing bank/mode defaults on the current page, and selects **Send to HO**. This is the Accounts verification step. Existing payment choices are preserved by defaults.
- Head Office and all four Projects payroll groups use the same downstream sheet. Accounts prepares these salaries; no FM or Accounts peer verification is required.
- HO approves full salaries, returns the salary calculation to the original preparer, returns payment details to Accounts, or holds an employee for later review. Other salaries continue independently.
- Payroll Register shows saved results, linked Accounts sheets and actual payment status. The normal payroll page no longer offers a second Verify/Forward/Final-lock approval step or lock-completion percentage.

## Durable protections

- Additive migrations **165–173**; no existing UAT salary, bank balance or approval is automatically changed by these migrations.
- Canonical source/delivery/item links, immutable calculation revisions, active employee/date exclusion, append-only audit and payment confirmation.
- Current roles, original-preparer ownership and independent reviewers enforced in PostgreSQL. FM receives only a safe receipt and cannot use general Accounts APIs. The UI disables ineligible/self review.
- The server calculates approval inputs; browsers cannot submit salary amounts or calculation payloads. Stale salary sources and recipient snapshots block the relevant actions.
- HO approval atomically freezes payroll/statutory/coverage/adjustment records and makes the existing Accounts bank posting once. Insufficient balance or any financial failure rolls everything back.
- Approval, export and confirmed bank payment are separate. Payment confirmation is idempotent, cannot change salary, and never debits the bank again. Zero-net salaries retain approval and coverage with no bank payout/export requirement.
- Generic Accounts CRUD, partial approval, Credit, copy/import, reopening and deletion cannot bypass the linked salary workflow. Ordinary requisitions retain their existing behavior.
- Cutoff proposal/acceptance happens within Accounts submission and independent HO approval. Future unfinished periods and disabled financial activation remain blocked.
- Salary/recipient changes after reviewer selection require selecting the current delivery version again.

## Local acceptance evidence

Tests use the isolated **SNPolymersPayrollTests** stack on localhost ports 55421/55422, synthetic employees and rollback-only financial activation/clock substitutions. They do not activate or pay live UAT payroll.

Executed checks:

- All payroll and Accounts regression files plus database/API contracts: **382 tests passed** across 47 files.
- Final focused database/HTTP/generation/review/schema/RPC/index verification after the last readiness migration: **46 tests passed** across 7 files.
- Backend unit suite: **276 tests passed** across 32 files.
- Full frontend suite with controlled concurrency (`npx vitest run --maxWorkers=2`): **1,347 tests passed** across 182 files. Two timing failures seen during parallel-load runs disappeared with controlled concurrency; no unrelated application code was changed for those timeouts.
- Frontend production build and lint of changed UI files passed.
- Browser checks used synthetic API responses in the actual shared components: Accounts light theme, payment-details modal, HO dark theme, return modal at 390px width; no browser console errors. The temporary harness was removed.
- Schema/RPC/index allowlists and generated manifests updated. Database contracts passed. `git diff --check` passed.

Financial scenarios include factory three-employee approve/return/hold, office and all four Projects groups, zero net, insufficient funds rollback, duplicate submission/approval/payment confirmation, missing/stale beneficiaries, changed salary inputs, independent actors, null/stale concurrency tokens, generic bypass attempts, explicit legacy conversion and cutoff acceptance without false salary staleness.

The broader regression/contracts/milestones run also reported two analytics assertions (`hoDashboardInsights` ZO balance and `milestone_scurve_option_b` project dates) and an OTP authentication setup timeout. An outdated payroll-generation assertion from that run was corrected to expect blocked salaries to remain unsubmitted, then passed the payroll rerun. The unrelated analytics/authentication failures are not represented as passing or fixed by this payroll change.

## UAT rollout boundary

This implementation has been migrated and exercised **locally**. Dev/UAT database migrations, conversion of existing pending salaries and financial activation have not been executed by this implementation run.

After deploying matching backend/frontend code and applying migrations with the normal environment-specific migration command:

1. As Accounts/Admin, open **Payroll → Earlier payroll submissions → Preview pending salaries**. Review readiness/overlaps and intentionally move selected earlier rows. The operation links salary sheets; it neither approves nor pays salaries.
2. New ready payroll submissions go directly to Accounts sheets. Complete recipients and payment details, send to HO, and test individual returns/holds.
3. Financial finalization remains behind its existing deployment gate. Enable financial UAT only through the separately controlled rollout, after business setup and opening bank balances are verified.
4. An earlier already-approved but unlinked salary requires reconciliation; it is never automatically converted into a new payable claim.

No commit, push, live approval, bank transfer or silent UAT record conversion was performed.

### Explicit financial activation

After migrations through 173 and local financial acceptance checks, enable only the intended UAT database:

```bash
cd backend
bash scripts/migrate-with-env.sh .env.dev-db set-payroll-financial-activation.js --enable
```

Use `--disable` with the same script to stop future financial finalization. This deployment action does not approve salaries, record payment, or reverse existing approvals. It preserves private function permissions. Structural migrations continue to default to disabled; do not enable production implicitly.
