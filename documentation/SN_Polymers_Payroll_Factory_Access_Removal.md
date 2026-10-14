# Factory payroll access removal

Client decision: 14 October 2026. Active Factory Managers may create and view payroll for both factories, matching attendance authorization. Separate per-user factory grants are removed; statutory scopes remain intact.

Migration 131 replaces the department authorization helper and foundation context, removes the authorised_users grant-revocation trigger/function, and drops the grant setter/table (including its index and identity sequence). It does not modify payroll runs, salary rows, calculation history, financial snapshots, attendance, or leave. Earlier migrations remain unchanged so fresh databases replay the same forward migration history.

The former POST /api/v1/auth/hr/payroll/factory-scopes endpoint is removed and returns 404. No frontend grant-management screen existed. Draft preparation no longer instructs users to execute a grant RPC.

| Actor | Payroll access |
|---|---|
| Active Factory Manager | Both factories; no Head Office/Projects payroll |
| Accounts | Company-wide read/review; office payroll preparation |
| HO/Admin | Existing company-wide oversight and independent final review |
| Inactive account or JE/ZO | No general payroll access; existing own official-payslip exception remains |

Reading another FM's factory payroll does not transfer ownership. Only the originating FM can calculate/correct/submit/withdraw its employee drafts. Accounts and HO/Admin maker-checker checks remain unchanged. FMs cannot download other employees' official payslips. Reactivation or restoration of the FM role restores both factories without regrant; requests still recheck current database role and active status.

Deploy migration 131 with the API removal. Existing development grant events are intentionally discarded as part of removing the grant system. No production deployment, commit or push is included.

## Verification

Migration 131 applied successfully on the existing isolated SNPolymersPayrollTests stack. The table, identity sequence, index, setter RPC and automatic-revocation function are absent, and no effective public function references the removed table. Replacement function bodies match migration 131; private-helper and service-only context permissions are preserved.

- Payroll regressions, factory-master compatibility and schema/RPC/index contracts: 131 tests passed in 17 files.
- Backend unit suite in its normal environment: 219 tests passed in 24 files.
- Affected frontend payroll suites: 45 tests passed in 7 files. Frontend build, targeted lint and diff checks passed.
- Updated the foundation test to compare calendar counts with the starting count rather than assume an empty database; existing calendar fixtures were preserved.
- Broader attendance compatibility remains unverified: roster tests expect two employees but the development stack contains 70 eligible rows, and the calendar suite's setup submits a payload exceeding the existing request limit. These failures are outside the removed payroll grant paths; no attendance implementation or fixtures were changed. A unit-runner test also failed when run under an inherited payroll profile; the normal unit run passed after removing that environment override.

No browser UAT, production deployment, commit or push was performed. Graphify AST update completed with its existing two missing-source metadata warnings.
