# Factory payroll calculation completion — 28 October 2026

## Authority

`SN_Polymers_Payroll_Business_Rules_v1_4.md` and the client's subsequent direct clarifications control this implementation. Older factory DOCX examples do not introduce additional requirements. In particular, **medical leave requires no certificate, upload or medical-document reference**. HO's finalized Paid/Unpaid decision controls treatment; pending decisions remain blocked.

## Delivered behavior

- Permanent salary-derived OT resolves agreed monthly gross on each attendance date, with an explicit factory conversion divisor (proposed standard 26), existing duty hours and multiplier. OT conversion is independent of the published permanent LOP divisor (current client choice 30).
- An explicit half-up, two-decimal convention rounds daily, hourly, multiplied hourly and final OT amounts. The reference gross 10,000 / 26 / 8 gives 48.08/hour and 96.16 for two OT hours at 1x.
- Existing immutable factory rules receive separate immutable calculation and attendance-treatment records. Existing attendance rule UUIDs, timestamps and stored OT hours remain intact. New rule/settings creation is atomic.
- Permanent short days contribute only the missing-hours fraction to ordinary monthly LOP, using the published LOP divisor, rounding, calendar classification and split allocation. A month of partially worked days is not mistaken for full-month zero entitlement.
- Casual/Local short days pay proportional worked units without a second LOP deduction. Local Double Duty uses two duty units and remains 2x without OT.
- An approved Management Issue retains normal permanent salary or normal daily wage.
- Permanent holiday duty uses an explicitly saved daily conversion basis and published paid-holiday evidence. The master multiplier is total day entitlement: 1.5x adds only 0.5x when the normal day is already in monthly salary. Existing master rates are not rewritten automatically.
- Approved Paid casual medical/other leave uses the effective daily wage once. Approved Paid permanent leave has no LOP. Medical documents are not requested or checked. Unpaid/rejected days do not become paid work; pending decisions remain unresolved. Local leave remains Unpaid.
- Local duties exceeding 24 hours produce a verification warning rather than a new hard duration cutoff. Double Duty does not accumulate extra OT. Existing overlap checks remain.
- Earnings carry source UUIDs and readable arithmetic. Source fingerprints include settings, so unsubmitted drafts append a recalculation on the existing source check/open/refocus flow. Submitted, returned and locked calculations preserve their saved review history.

## Database and authorization

- 154: OT calculation configuration, immutable audit, transactional rule creation, impact preview and source snapshot integration.
- 159: unified, atomic completion of missing settings; confirmed settings remain immutable.
- 155: protect frozen rule evidence across factory/category transfers as well as the run heading.
- 156: executable missing-hours/stoppage/holiday treatment, atomic creation and current 2x Local authoring.
- 157/158: an unwanted medical-certificate implementation was introduced during development and then retired by forward migration 158. The final schema contains none of its table/RPCs; the frontend, backend and calculator contain no certificate workflow. The migration history is retained because 157 had already run on the isolated test database.

Admin/Factory Manager author factory masters and settings. HO retains master read/leave review responsibilities. Accounts statutory ownership and existing payroll review authorization are unchanged. Database constraints, audit triggers and category source fences protect immutable settings, competing finalization, actor validity and locked periods. All SQL/RPC/index manifests were regenerated.

## Verification

- 106 focused backend unit tests passed, including permanent and casual medical leave without certificates, unpaid/rejected/pending decisions, partial-hour LOP, total holiday entitlement, exact OT rounding and unchanged financial/review guards.
- 90 isolated database/API/contract tests passed. These cover both factories, preservation of locked attendance, immutable settings, concurrent finalization, transfer coverage, automatic recalculation/history, authorization, payroll previews, financial review and schema/RPC/index contracts.
- 60 frontend tests passed across Factory Masters, attendance entry, attendance review and payroll display.
- Targeted frontend ESLint, production build and `git diff --check` passed.
- Migrations 154–158 applied to development through `npm run migrate:dev`. No employee salaries, attendance, factory rates or existing rule settings were seeded/rewritten as part of deployment.

These checks are automated/local evidence, not a claim that every UAT employee is ready or that financial activation is authorized.

## UAT next step

In Factory Masters → Attendance & Pay Rules, select each relevant category. For an existing rule, use **Finish setup** to confirm all missing OT and attendance pay settings together. Review the impact/date range, conversion days and reason, then confirm. Existing incomplete settings remain explicit blockers; no legacy free-text rule is interpreted automatically.

Medical leave uses the existing entry and HO decision workflow unchanged. Reopen/check an unsubmitted payroll draft after saving settings. Resolve independent salary-history/calendar/setup blockers normally. Financial activation and payment remain separate existing workflows.


## Factory Masters UI cleanup

The FM mobile dashboard and desktop already use the same `/factory-masters` page; no additional master screen is introduced. New revision entry is opened on demand and can be cancelled. Revision history summarizes pay rules, readiness and conversion days in fewer columns. Missing OT and attendance settings share one impact preview, reason, confirmation and atomic save. Each conversion divisor remains independent; existing confirmed settings cannot be edited through completion. OT controls are hidden when disabled, and Local Double Duty is explained as 2x without an editable or redundant numeric control. Medical leave still uses only HO's Paid/Unpaid decision.


Cleanup verification: 25 frontend tests and 47 isolated database/API/contract tests passed, including combined-save rollback, independently configured divisors, immutable partial setup, role restrictions, locked payroll and finalization contention. Frontend ESLint and production build passed. Migration 159 was applied to development and the RPC manifest now includes both unified setup functions. The live page and combined modal were inspected without saving any real rule settings.

### Factory Masters visual polish

Primary actions and the selected tab use the shared yellow button variant. The setup dialog uses the shared large modal with a fixed footer; its Save action remains visible while the form scrolls and retains native validation through its form association. Mobile history shows compact revision cards, while desktop retains the table. Both reuse the same pay summary and setup action. Labels and explanations use ordinary website wording, with rounding details collapsed and no slash-separated paid-leave or rate wording.

Verification: 27 focused frontend tests, targeted ESLint, production build and diff whitespace checks passed. Browser inspection confirmed mobile cards, no horizontal page overflow at the checked narrow viewport, and the fixed Save action within the visible mobile viewport. No real rule values were saved during visual verification.
