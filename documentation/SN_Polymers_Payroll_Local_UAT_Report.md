# Payroll local technical UAT — 12 October 2026

Local technical UAT is complete against `employee_management`, using the isolated `SNPolymersPayrollTests` Docker Supabase and synthetic fixtures. All 54 checklist scenarios have browser and/or automated coverage; the checklist identifies the method for each case. This is engineering verification, not client sign-off or validation of production employee/legal evidence. No commit or push was made.

## Environment and protections

- Frontend: http://127.0.0.1:5173; backend: http://127.0.0.1:5000.
- Isolated Supabase API 55421 / PostgreSQL 55422. Existing shared Supabase 54321/54322 remains running and was not reset, stopped or cleaned up.
- Backend is explicitly pinned to the isolated target. Telegram, Gmail and admin email delivery are disabled. Development OTP is `123456`.
- Synthetic future payroll periods (4014/4015), rates, employees and beneficiary evidence avoid collisions with existing integration fixtures. These values are test inputs, not approved client statutory rules.
- Owner-only financial integration tests temporarily exercised activation and restored it. Final SQL verification: `payroll_financial_enabled() = false`; `payroll_financial_clock()` returns `now()`.
- Browser locking checks never enabled finalization. No bank debit, payment, posting or accounting settlement was executed.

## Executed browser workflows

Admin, Accounts, HO, the FM granted both factories, linked employee JE, ZO and an ungranted FM signed in through the real OTP screen. The second Accounts actor was authenticated in the API matrix.

| Workflow | Observed result |
|---|---|
| Accounts salary preparation | 30000.00 gross, 703.70 EPF employee deduction, 29296.30 net; 925.93 employer contribution shown separately. Saved revision and submitted individual employee to HO. |
| Factory preparation | Same FM sees SNP/Fabric Casual, Local and Permanent groups. SNP 400 wage plus 200 holiday premium totals 600. Fabric 300 wage at double duty totals 600, without additional OT. Each employee was saved/submitted separately. |
| Accounts factory review | Forwarded both employees independently from pending Accounts to pending HO. |
| HO return | Returned office and Fabric employees with reasons; SNP employee remained pending HO. |
| FM correction/resubmission | Saved an evidence note without editing attendance, recalculated and resubmitted Fabric. Both revisions, original submission, Accounts forwarding, HO return and correction remain visible. |
| Legacy source recovery | Oversized three-year draft returned structured `PAYROLL_SOURCE_UNAVAILABLE`; correction saved and withdrawal reached `CANCELLED_DRAFT` through the UI. Audit confirmed via API. |
| Adjustment/advance ledger | Accounts recorded bonus 1000 and previously issued advance 5000 with installment 500 and evidence. HO independently approved both and paused/resumed recovery. Preview net became 29796.30 on 31000 gross; outstanding advance remained 5000 and no application was posted. |
| Cutoff/calendar | Accounts proposed SNP cutoff v1; HO independently approved v2. HO published one synthetic PAID Weekly Off. Evidence changes marked saved calculations stale. |
| Financial locking | Initial final check returned `FINANCIAL_FINALIZATION_DISABLED`. After cutoff change, final check rejected stale sources. Row remained pending HO. |
| Register | Search, department/status/date filters, pagination and empty scopes worked. Two immutable test rows across two periods total 60000 gross and 58592.60 net; date filtering selected one row at 30000/29296.30. Unknown deductions/net remain unavailable. |
| Downloads | Register XLSX, department XLSX and printable HTML displayed download success. Actual exported bytes were independently fetched through authenticated API and parsed. Browser download-event observation timed out, so workbook-content verification is attributed to API, not browser file inspection. |
| Diagnostic payslip | Saved a blocked missing-profile calculation. Register and diagnostic payslip show unavailable statutory deductions/net and `DIAGNOSTIC PREVIEW — NOT AN OFFICIAL PAYSLIP`. |
| Official payslip | Accounts and linked JE read the immutable test snapshot; beneficiary account masked as `****9571`. Payment remains `NOT_RECORDED`, separate from Locked salary. |
| Permission boundaries | FM office detail denied; official payslip download denied to FM. Ungranted FM sees no payroll groups/rows and cannot open factory detail. JE register and ZO review/statutory routes redirect to dashboard. Authenticated API independently denies forbidden endpoints and other employees' payslips. |
| Admin/HR compatibility | Existing employee edit form reuses canonical Accounts beneficiary/bank records. Policy form offers Fixed30 and Actual Calendar Days; saved and published a synthetic PROJECTS_JE revision with immutable history. Full permanent directory now includes 1219 employees and the previously hidden UAT record. |

Statutory master/profile timeline controls were inspected as Accounts. Their draft/publication, eligibility, canonical binding and historical correction writes were exercised by the automated integration suite. HR creation, arrears, employee addition to runs, mixed bulk results, source mutations and concurrency are likewise attributed to automated coverage where not performed manually in the browser.

## Automated results

| Verification | Final result | Local log |
|---|---|---|
| Full backend integration suite, isolated Supabase | 1009 passed / 128 files | `/tmp/payroll-uat-backend-final.log` |
| Backend unit suite after fixes | 219 passed / 24 files | `/tmp/payroll-uat-unit-final.log` |
| Full frontend suite | 1139 passed / 160 files | `/tmp/payroll-uat-frontend-all.log` |
| Static harness checks | 16 passed / 2 files | `/tmp/payroll-uat-static-verified.log` |
| DB/API contracts and notification regression selection | 68 passed / 12 files | `/tmp/payroll-uat-contract-notifications.log` |
| Additional authenticated local UAT matrix | 46 passed, 0 failed | `/tmp/payroll-uat-api-verified.log` |
| Frontend production build | Passed | `/tmp/payroll-uat-build.log` |
| Frontend lint | Passed | `/tmp/payroll-uat-lint.log` |
| Final whitespace/diff check | Passed | `git diff --check` |

Counts are separate executions and may overlap; they are not a unique summed test count. Earlier incomplete/failing attempts are not counted as passes. Notification tests required a harmless initial dummy Telegram token because the tests mock dispatch after module loading; final runs had real notification credentials blank. The first integration attempt exposed permanent-directory truncation; its successful full rerun is the final integration result above. Initial supplemental UAT assertions were corrected to the existing response/audit field names before the 46-check pass.

Coverage includes February/leap/31-day calculations, inclusive joining/leaving, overlapping leave and paid rest days, explicit zero-entitlement exceptions, unsupported LINE LOP, package diagnostics, sub-paise split reconciliation, statutory accumulation and open-ended revisions, negative/zero net, advance ceilings/replans, independent/duplicate concurrent locking, relevant source fences, unrelated operational writes, cutoff concurrency, rollback after snapshot insert and immutable history. Existing HR, attendance, leave and Accounts tests ran in the full integration suite.

## Fixes found during verification

1. `backend/src/controllers/hrPayStructures.controller.js`: fetch the complete permanent employee/pay directory in ordered batches rather than silently stopping at PostgREST's 1000-row response limit. Existing response and permissions preserved. Three focused regression tests cover more than one page, exact page boundaries and later-page failure. Live browser verification found EMP-5570 after restart and showed the full 1219-person directory.
2. The same controller now maps payroll source-fence `PY409` conflicts to HTTP 409 `PAYROLL_SOURCE_BUSY`. The existing source-conflict unit matrix includes permanent pay-structure writes.

No migration or frontend implementation change was needed during this UAT continuation. Graphify was refreshed after code changes. No test fixture or shared stack cleanup was performed.

## Evidence and remaining acceptance work

- Checklist: `SN_Polymers_Payroll_Local_UAT_Checklist.md`.
- Supplemental API outcomes: `/tmp/payroll-uat-api-results.json`; runner: `/tmp/payroll-uat-api.cjs`.
- Parsed exports: `/tmp/payroll-uat-register.xlsx`, `/tmp/payroll-uat-departments.xlsx`, and corresponding `.html` files.
- Final fixture/database audit: `/tmp/payroll-uat-final-state.json`. Only the one pre-seeded immutable row is Locked among these UAT fixtures; no additional snapshot was created. Advance applications: 0.
- Screenshots: `/tmp/payroll-uat-employee-payslip.png`, `/tmp/payroll-uat-diagnostic.png`, `/tmp/payroll-uat-fabric-resubmitted.png`.

Client acceptance using actual approved policies, employee statutory facts, beneficiary evidence and representative salary sheets remains separate. Production locking has not been activated and no payment workflow has been added. The future-dated/outdated package fixture deliberately remains blocked while preserving its component evidence. The SNP saved review is deliberately stale after cutoff approval and must be returned/recalculated before any future approval.

Servers and both Supabase stacks remain running for manual inspection. Synthetic login numbers (all OTP `123456`): Admin 7150184282; Accounts 9027361245; HO 8155583212; FM 8195333519; linked JE 9050944060; ZO 9115642289; ungranted FM 7422556651; second Accounts 8328492928.
