# Payroll workflow design grounded in the current ERP

Status: proposed workflow and implementation contract, 27 October 2026. This document does not authorize production data backfills, policy values or financial activation. No calculation rules are changed by writing it.

## Outcome

Ordinary users maintain employees, effective salary/wage terms, deduction assignments and attendance. Payroll derives the corresponding dated source history automatically. Users never maintain an additional technical salary mapping or enter final payable salary into attendance.

## Current implementation facts

- `backend/src/controllers/hrPayStructures.controller.js:createPayStructure` calls the seven-argument `create_hr_pay_structure`. Migration 141 creates an HR salary revision and immediately supersedes Active/Suspended revisions, but does not record PERMANENT_PAY applicability dates.
- `backend/src/validation/payroll.schema.js` and `backend/src/routes/payroll.routes.js` expose Admin-only dated ASSIGNMENT and PERMANENT_PAY history APIs. The ordinary salary form does not expose that history workflow.
- `backend/src/domain/payroll/sources.js:resolveSources` requires one applicable assignment and, for permanent employees, one dated pay source and one published salary policy for the relevant days. The source resolver uses the latest complete history revision, not simply the current HR salary record.
- `backend/src/domain/payroll/permanent.js` blocks a month with multiple salary revision IDs (`SALARY_CHANGE_PRORATION_REQUIRED`). Mid-month salary-rate changes must remain unsupported until deliberate segmentation is implemented and tested. Joining/leaving proration is a separate supported-policy decision.
- Payroll generation already populates eligible employees and attempts initial calculations. Refresh preserves existing calculations, while explicit recalculation creates new reviewed evidence.
- Database and UI keep review status CALCULATED separate from calculation readiness. The table currently repeats each per-date blocker code, hiding useful context and making rows extremely tall.
- Approved category rules: Casual/Local have no EPF/ESI; PT applies except to Local daily wagers. Permanent enrolment comes from Employee Management. Assigning a company setup containing all schemes must not force every scheme onto every category.
- Factory Managers prepare their own factory sheets; Accounts prepares office sheets and independently reviews factory payroll; HO/Admin provides the final independent review. Financial locking remains deployment-gated; payment is outside this delivery.

## Ownership and normal screens

| Owner | Screen/task | Normal user inputs |
|---|---|---|
| Admin | Employee Management: employee assignment | Joining date, category, department; effective date and reason when changing assignment |
| Admin | Employee Management: salary | Pay basis, agreed gross, applies from, EPF/ESI enrolment, reason for a change |
| Admin / FM, matching existing permissions | Factory wage and pay rules | Category, effective date, daily rate where relevant, duty/OT/holiday terms |
| Admin | Salary calculation policy | Scope, effective dates, approved unpaid-leave/joining/leaving/rounding terms |
| Accounts | Company deduction setup | State/establishment, published applicable rules and effective dates |
| Accounts | Employee Payroll Setup | Employees, company setup, applies from; enrolment is derived from HR |
| FM | Attendance | Actual attendance/hours/leave facts; submit for existing review/lock flow |
| FM | Factory Payroll Review | Group, period and cycle; review generated results and submit employees |
| Accounts | Payroll Review | Independently check calculations and return or forward |
| HO/Admin | Final payroll review | Approve/lock only when all existing financial prerequisites permit it |

Do not transfer salary-policy ownership to Accounts as part of this design. That would be a separate role/workflow decision. Keep all role enforcement authoritative in PostgreSQL and backend middleware.

## 1. Initial onboarding / existing-data setup

1. Admin records employee identity, joining date, category and department. Saving also records the corresponding dated payroll assignment in the same database transaction. Derive group from canonical category/department rules; do not ask for raw group codes.
2. For a permanent employee, Admin records salary terms and **Applies from**. One save creates/links the salary revision and records the complete updated salary timeline atomically. A candidate start date may be suggested from joining date, but must be visible and confirmed; never silently backdate current pay.
3. For existing salaries without payroll dates, provide **Complete payroll salary setup**: employee, existing salary/pay basis, applies from and optional supporting note. Reuse the salary UUID; do not create a duplicate pay revision merely to attach dates. Permit selecting an older recorded revision if that is the correct historical salary.
4. A bulk initialization preview can propose common dates for selected employees, but must show each employee, existing salary revision and proposed interval. Admin confirms the date and historical facts. Report failures per employee; never overwrite existing dated history.
5. Admin publishes the salary policy covering permanent payroll periods. Use the explicit initial-publication path for first historical setup, retaining scope, locked-period, audit and future-revision guards. Explain terms in business language; do not infer policy decisions merely to pass readiness.
6. Accounts publishes shared deduction rules, saves the company setup and assigns it to employees for the required dates using the existing workflow. Validate employee pay/enrolment coverage when deriving profiles. If a later salary revision changes enrolment, flag the affected deduction profile interval for Accounts review; do not silently rewrite its confirmed history.
7. Casual labour requires dated factory wage/rule coverage and its applicable PT setup; do not ask for a permanent monthly salary mapping or permanent salary policy.

Initial dates must be supported by the user's records, not by when attendance happened to be imported. Setup entry/audit timestamps always record the actual save date.

## 2. Monthly preparation

1. FM records attendance normally. Attendance remains the source of worked time and leave facts; payroll computes earnings and deductions downstream.
2. Complete the existing attendance review/lock flow and applicable leave decisions. Calendar, weekly-off, holiday, overtime and wage-rule evidence must cover affected dates.
3. In Payroll Review, select group/department and period. Display a **Readiness check** before calculation: matched employees, ready count, missing setup count and unfinalized attendance count.
4. Give each problem one understandable message, affected dates and the owner/action that fixes it. Examples: “Admin: salary effective dates missing, 1–31 August”; “Admin: salary calculation policy missing for August”; “FM/reviewer: attendance awaiting lock on 12 August”. Links must respect the viewer's permissions.
5. A draft may still be saved with blocked employees, but they must be clearly marked **Needs setup** and excluded from submission. Once validation succeeds, Generate payroll uses the existing engine and saves initial calculations. Never substitute zero for unresolved amounts or invent dates/rates.

Readiness should reuse the authoritative source-resolution/calculation logic in a read-only operation. Avoid an independent rules engine in the frontend and avoid one API request per visible employee. The database rechecks all persistent invariants when saving/submitting/locking; readiness is not a reservation.

## 3. Calculation and review

Keep the existing review state machine and per-employee ownership/version checks. Display business readiness beside review state:

- Needs setup / Calculation blocked: at least one unresolved source or calculation blocker.
- Ready for review: an actual complete saved calculation, subject to current-source checks and financial readiness.
- Sources changed: review evidence no longer matches current inputs; require explicit recalculation and reason.
- Pending Accounts / Pending HO / Returned / Locked: existing workflow states, with calculation readiness still visible where relevant.

Group blockers by code plus meaningful source/reference and contiguous date range. “Salary source missing — 1–31 August (31 days)” replaces 31 identical lines. Retain the full per-day detail in an expandable diagnostic view. Keep employee name and the primary action visible; do not hide the row content below a giant warning list. Do not describe an unsuccessful saved calculation attempt as successfully calculated.

FM validates gross, LOP, OT/holiday amounts and applicable deductions, then submits ready employee rows. Accounts independently reviews and forwards or returns. HO/Admin independently reviews the forwarded result. Accounts-created office sheets retain their existing independent maker/checker restrictions; no actor may review their own work where the current rules forbid it.

Source changes never silently overwrite a saved calculation. Refresh adds eligible missing employees and checks existing evidence. Recalculate selected employees explicitly, with a reason and a new calculation revision. Submitted rows must be returned/corrected through the existing workflow. Locked snapshots remain immutable.

## 4. Subsequent changes and effective dates

- For salary changes, user sees new gross, applies from and reason. Preserve preceding coverage, append the new dated segment, and use optimistic version checks under the existing employee/source fences.
- Until the engine supports multi-salary monthly segmentation, allow salary revision changes only at month starts. A mid-month joiner can still have their initial salary starting on their actual joining date; existing joining/leaving proration rules apply.
- A future-dated salary must not change what the directory calls the employee's current salary today. Show Current and Scheduled terms derived from effective dates. The existing immediate Active/Superseded mutation is insufficient for scheduling and must be reconciled in the implementation.
- Record assignment changes through the normal employee edit flow with an explicit effective date and complete history preservation. Do not reconstruct historical category/department facts from the current row. Preserve existing attendance transition restrictions and unsupported same-month transfer limitations.
- Suspend/end salary coverage through a dated, audited action; do not erase the historical salary or use today's Suspended status to invent a historical end date.
- Reject changes to business facts already consumed by locked payroll unless they use an explicitly supported correction workflow. Historical onboarding is allowed only where the source/locked-period safeguards permit it.
- Any change affecting permanent EPF/ESI enrolment must produce a visible Accounts setup task for matching profile dates, while retaining Employee Management as the enrolment authority.

## 5. Immediate UAT recovery

For the August 2026 SNP permanent run, retain the existing salaries and sheet. Confirm the actual historical salary dates for those employees; record dated links to the existing revisions. Publish the historical salary policy through its existing initial-setup path, with real approved parameters. Resolve remaining calendar/leave/OT evidence, revalidate deduction-profile coverage, then explicitly recalculate the existing employee rows and review fresh results. No UAT database write or effective date is authorized solely by this design.

Test SNP Casual separately with its dated factory wage/rule sources. Approved category exclusions mean no EPF/ESI; PT remains applicable. Check a full-attendance case and an unpaid/absent-day case for each category. Follow with a new joiner, future salary change, missing policy, stale-source recalculation and locked-period rejection.

## Implementation slices and acceptance criteria

1. **Connect HR dates to payroll.** Add visible assignment/salary effective dates, atomic salary+timeline operations, existing-salary initialization, CAS and database overlap/locked-history guards. Test rollback when either half fails, salary ownership, joins, older/newer/future revisions, concurrent edits and no duplicate salary creation. Follow append-only source history: a new latest revision contains the complete intended timeline, not only the newest interval.
2. **Make setup readiness visible.** Summarize salary-policy coverage and employee readiness for the chosen period; keep policy approval choices explicit and current role ownership. Cover permanent/casual/local categories, missing and partial coverage, attendance/leave/calendars and no accidental EPF/ESI on casual employees.
3. **Repair calculation-table feedback.** Group repeated diagnostics, show blocked/ready separately from review state, preserve unavailable decimal amounts and full detailed evidence. Test same code across distinct sources/date gaps, keyboard/mobile access, stale sources and per-employee batch errors.
4. **End-to-end verification.** Use forward-only migrations and update relevant contracts. In the isolated stack exercise onboarding → dates/policy/profile → locked attendance → generation → explicit correction → FM submission → independent Accounts/HO review, retaining the deployment financial gate. Test the actual gate-disabled outcome; owner-only test substitutions may verify lock invariants but do not authorize deployment activation. Build/lint and relevant frontend/backend/DB contracts must pass before implementation readiness is claimed.

Payment initiation, bank transfer and payment reconciliation remain outside scope. Official payslips require an actual immutable locked snapshot; no design change makes a diagnostic calculation an official payslip.

## First implementation slice — 27 October 2026

Migration 145 and matching API/UI implement Admin-owned salary effective-date authoring, existing-salary initialization without duplication, explicit initial assignment confirmation, complete append-only salary timelines, source-fence protection and CAS. Employee Management now asks for salary applies-from and reason when saving via the dated operation. Existing undated salaries are linked by choosing the correct stored revision and confirming dates. This operation never fills dates from attendance or bulk-rewrites existing employee histories. The undated creation API is removed by migration 146 and its matching code change below; the creation helper is internal only.

New future scheduling and retroactive replacement of earlier salary segments are explicitly rejected in this slice. Initial salary can begin at joining or a month boundary; later changes begin on month boundaries. Existing assignment initialization does not replace a recorded assignment timeline. Dated category transfers and scheduled/suspension behavior, integrated new-employee assignment authoring and pre-generation readiness remain subsequent slices, rather than silently changing existing Active/Superseded semantics here.

The payroll sheet now groups repeated blockers by code/source/field and affected dates, retains expandable daily details, displays blocked calculation attempts separately from review status and disables submitting blocked/missing-net rows. Ready/needs-setup counts explicitly describe the current page, not the whole sheet. Server submission/locking checks remain authoritative.

When new salary dates are attached after a payroll row was created, existing `PAY_HISTORY_OUTDATED` protection still applies: use the employee's explicit correction/new content version action to refresh draft source references, then recalculate. Refresh alone preserves saved calculations. No automatic correction or source snapshot overwrite is added. No live UAT salary, assignment, policy, attendance or payroll row is changed by deployment of this slice.

### Remove undated salary creation — migration 146

Client decision: remove the obsolete Create path rather than retain two application workflows. The `POST /hr/pay-structures` route, controller and frontend API wrapper are removed. Salary-term validation belongs to the dated request, with no separate legacy create request schema. Migration 146 revokes all browser/public/service execution of `create_hr_pay_structure`; its existing body is retained solely as an owner-only internal implementation used by the security-definer dated save and controlled historical fixtures. This keeps pay creation and applicability atomic without duplicating compensation creation logic. The helper is removed from the application RPC allowlist. Apply 146 after 145; no existing salary rows or dates are rewritten.

Regression coverage now uses the dated path, asserts the removed route returns 404, checks direct service RPC denial, preserves read/privacy/authorization contracts, and verifies same-version concurrent saves have one winner. The creation-path removal does not address suspension; migration 147 below subsequently guards that separate unsafe action.

### Safe suspension boundary — migration 147

Migration 147 fixes the suspension merge blocker without pretending that a dated end-of-pay workflow already exists. `suspend_hr_pay_structure` now verifies the active Admin actor, acquires the same exclusive employee source fence as salary/date writes, serializes the employee and salary rows, and rejects any salary referenced by payroll applicability with a stable conflict. A table trigger prevents bypass through a direct status update. The reverse order is guarded too: a suspended salary cannot acquire a new payroll applicability mapping. Suspension remains idempotent for an unmapped salary.

Employee Management disables suspension for mapped salaries and while mapping context is unavailable, with a plain explanation. Current calculations reject legacy suspended pay sources instead of treating them as eligible salary. The source fingerprint calculation salt changes to PHASE6_SALARY_STATUS_GUARD_V1, so existing unlocked calculations require explicit review/recalculation; locked snapshots are read unchanged. No historical status, coverage date, attendance or financial snapshot is rewritten. A full dated suspension/end-of-coverage workflow remains future work; this fix intentionally rejects the unsafe action.


### Salary policy authoring simplification

The policy form keeps scope, effective dates and independent unpaid-leave / joining-leaving methods visible. Additional rules and rounding are collapsed. An explicit standard-settings action selects aggregate half-up rounding to two places, calendar-weighted split allocation, evidenced paid-rest-day exclusions and the no-payable-entitlement zero exception. It does not overwrite salary methods or published rules. Work-calendar joining/leaving proration is retained for inspecting existing data but is not offered for new selection because the calculator does not support it. Policy end dates are optional after migration 149. Admin navigation links to salary policies and employee pay structures; Accounts-only deduction setup is not shown to Admin.

### Explicit employee exit

Admin records Exited through Employee Management → employee details → Change Status, supplying an inclusive last working date and reason. Migration 148 stores these facts on the employee and appends a closed latest ASSIGNMENT revision atomically; prior assignment history and salary terms are retained. Dates before joining or after today, concurrent payroll readers, later assignment segments and finalized coverage after exit reject the entire operation. Recorded exits are immutable: correction and rehire need separate workflows. Legacy Exited rows are preserved without inventing dates. Employees without dated assignment history may record an exit, but later assignment initialization must respect the explicit exit date. New employee creation cannot start as Exited. No employee exit or UAT migration is performed merely by installing this feature.


### Ongoing salary policies

Migration 149 allows NULL effective_to on salary policies, matching statutory rules. Blank end dates mean ongoing. Publication retains the original end date (NULL for ongoing) and controlled later publication may shorten future applicability only. Existing overlap constraints, stale-preview checks, role guards and locked-payroll protections remain active. API and UI send NULL rather than an invented distant end date. Existing bounded policies are not rewritten.

### Automatic payroll freshness checks

Opening the payroll calculation table or refocusing the browser checks the visible page against current source snapshots through a read-only, no-store API. The endpoint is actor-scoped, capped at 20 employees and four concurrent source reads. It does not populate employees, create calculation revisions or advance review states. Unknown/error/mismatched evidence never certifies readiness. Changed rows show previous results and a reason where source references identify the category. Authorized preparers may explicitly recalculate affected rows on the current page with a reason; submitted/locked rows retain existing workflow protections. Freshness is checked on open/focus or manually, not via cross-session realtime notifications. Final transaction source-token checks remain authoritative against races after a successful check. Saved reports outside this calculation table remain historical reports; this change does not recompute financial totals or post money.

### Automatic unsubmitted draft recalculation

The originating Accounts/FM preparer opening or refocusing a sheet triggers an explicit server POST after freshness identifies changed or uncalculated DRAFT/CALCULATED rows on the visible page. The server rechecks run ownership, current role, source fingerprint and row state. Existing version/CAS and source-token guards prevent duplicate or stale writes across tabs. Identical inputs produce no new revision. Changed inputs append an audited calculation revision, including current blockers if calculation is incomplete. Submitted, returned, cancelled and locked rows are preserved. Reviewers see changed-input warnings and use the existing return workflow. Failed requests do not loop: the screen offers retry and the manual recalculation action remains available. This supersedes the previous detection-only behavior for eligible drafts; freshness GET remains read-only. There is no background recalculation while the sheet is closed or live notification subscription.
