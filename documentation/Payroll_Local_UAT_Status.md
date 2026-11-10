# Isolated payroll UAT status

Local-only setup: frontend http://127.0.0.1:5175, API http://127.0.0.1:5055, fake-user chooser http://127.0.0.1:5055/__local-uat . Choose Accounts, HO, Admin or FM. The chooser is mounted only by scripts/start-payroll-uat-local.js, never the normal app entry point.

Remote .env files were not overwritten. Copies are saved as backend/.env.remote-before-local and frontend/.env.remote-before-local. Prior .env.local files, if present, are copied to .env.local.before-payroll-uat. Current .env.local files target only the local stack. To return to remote development, stop the separate 5055/5175 processes and restore prior .env.local files (or remove the generated local overrides if none existed); the normal .env remains intact.

Docker stack SNPolymersPayrollTests uses API port 55421 and PostgreSQL port 55422. Its bridge had lost its IPv4 address/route. The isolated network was recreated retaining endpoint IPs and aliases; no database volume was deleted. A temporary empty network sn-payroll-uat-local was also created during diagnosis.

The seed script uses fixed localhost configuration, a transaction, synthetic users and three employees for each of HO_STAFF, PROJECTS_JE, PROJECTS_ZO, PROJECTS_SUPERVISOR and PROJECTS_HEAD_OFFICE. The fixture intentionally uses distant future years to avoid existing records and substitutes a local financial clock. Use the dates shown on those seeded sheets; this is not a real-month readiness assessment. The seed output with fake-user identities/run IDs is /tmp/local-payroll-uat-fixtures.json. Do not rerun seeding casually: it creates another independent fixture set.

Executed: 50 tests passed in payrollAccountsBridge, payrollAccountsApi, payrollCategoryStatutory, payrollFinancial and payrollGeneration. Includes HO and four Projects groups, approval posting once, duplicate payment protection, salary/payment returns, hold/resume, stale sources/recipients, independent actors, insufficient balance rollback, zero-net and automatic generation. Test fixtures are synthetic; not every group/action combination or browser interaction was independently exercised.

Verified persistent fake Accounts login and normal /api/v1/auth/me response. No complete manual browser acceptance run yet. Existing frontend evidence: 1348 tests passed, build/lint passed in preceding fix run.

UX follow-ups: raw group/code labels and diagnostic payloads, excessive decimal precision in salary detail, two-stage Accounts navigation, and per-employee payment recording for bulk payouts. These are review recommendations, not implemented changes in this setup.

Isolation defect observed: normal app.js main startup starts bot polling and schedulers even with TELEGRAM_MODE=disabled. That temporary audit process was stopped; the local route-only launcher skips those startup hooks and clears the bot token. Its startup had already logged a webhook deletion; no further external startup is used by this launcher.

## Browser UAT executed

Accounts and HO were signed in through the localhost fake-user chooser. All workflow writes below were made through the visible UI against seeded local data.

- HO_STAFF sheet 08112026-3: three salaries auto-calculated at 29,296.30 net each. Selected all, submitted, followed Accounts link, completed three mock beneficiaries/banks. Send to HO was disabled until details were complete.
- HO approved EMP-16676; Accounts recorded LOCAL-UI-UAT-NO-REAL-TRANSFER-001. Paid status became visible and Record payment disappeared.
- HO returned EMP-16675 with a reason. Accounts saved a calculation revision and resubmitted; successor Accounts sheet 08112026-4 was created.
- HO held EMP-16674. Approval failed with remaining balance 20,703.70 vs requested 29,296.30 and preserved the hold. HO returned payment details; Accounts selected another mock bank and resent. HO approval then succeeded.
- PROJECTS_JE sheet 08112026-5: Accounts submitted EMP-16679, completed payment details and sent to HO. HO approved; Accounts recorded LOCAL-UI-UAT-PROJECTS-001. Payroll Register filtered by employee showed LOCKED, Approved/Paid, immutable revision 1 and zero blockers.
- Official payslip loaded, net 29,296.30, PAID. Reporting inconsistency: it shows beneficiary MISSING despite Accounts recipient and paid status. It appears to display source employee setup rather than the Accounts payment recipient; needs code-level confirmation/fix.
- Filtered Excel export downloaded as payroll-register-diagnostic (2).xlsx. UI reported Diagnostic export downloaded. Download contents not independently reconciled.
- No browser console errors captured at the payslip check.

UI friction: technical uppercase codes and six-decimal totals; detailed register explanations and many columns; per-employee payee selection from a general beneficiary master; collapsed sidebar first click expands rather than navigating; no explicit next-step action after submission. Seed fixture dates in the 6200s and accumulated old test fixtures are test-environment limitations, not real business scenarios.

Scope: browser end-to-end examples for HO and Projects JE, exception paths on HO. Other Projects groups have automated test evidence; not separately clicked end-to-end. Mobile, print preview, bulk NEFT and exported workbook reconciliation remain unverified in this browser session.

Screenshot evidence: /tmp/payroll-local-projects-ui-proof.png and /tmp/payroll-local-payslip-ui-proof.png.

## UI cleanup following browser UAT

Implemented plain salary line/status labels and two-decimal currency formatting with integer arithmetic (display rounding only; source decimal strings and calculations remain unchanged). Employee beneficiary search starts with the employee name when no saved recipient exists, never auto-selects a payee, masks account numbers in options and offers an explicit broader search/empty result message. Accounts receipts say Open Accounts sheet; submitted, returned, approved-unpaid and paid screens explain the next step with register navigation.

The payslip's employee-source beneficiary vs Accounts payment-recipient inconsistency remains a separate issue; this cleanup does not change that data contract.

## Payslip recipient fix

Migration 175 adds a masked payment_recipient to official payslips, read from the approved Accounts delivery snapshot. Calculation evidence stays unchanged and current beneficiary-master edits do not rewrite the historical recipient. Official payslips and Accounts salary details display this as Payment recipient. Legacy payslips without an approved Accounts recipient retain their existing employee setup presentation. Verified in the local browser: Payment recipient visible, false missing-beneficiary warning absent. Migration applied locally only; remote environments require migration 175.
