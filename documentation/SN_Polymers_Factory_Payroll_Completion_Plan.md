# Factory payroll completion plan

Status: OT and the clarified attendance-pay slices implemented through migrations 154–158. Medical certificates are not required; v1.4 and the client’s 28 October decisions are authoritative. See `SN_Polymers_Factory_Overtime_Implementation.md` for delivered behavior and verification.
Reviewed: 28 October 2026, branch `employee_management`, including pending migrations 152 and 153.

## Goal and delivery order

Complete the factory wage behavior described in the three supplied business documents, starting with salary-derived overtime for permanent workers. Reuse the existing dated salaries, attendance, payroll calculations, statutory pipeline, review and audit workflows.

Deliver the OT slice first. It removes a real calculator gap; it does not by itself make every payroll row ready. Missing calendars, stale draft salary references and other unsupported attendance treatments must remain independently visible.

Primary authority: `SN_Polymers_Payroll_Business_Rules_v1_4.md` and subsequent direct client decisions. The older DOCX files are supporting references and do not add certificate requirements.

Supporting documents:

- `/home/zenoguy/Documents/attendance_and_salary/Factory_Permanent_Staff_Salary_Wage_Rules.docx`
- `/home/zenoguy/Documents/attendance_and_salary/Factory_Casual_Staff_Wage_Payment_Rules.docx`
- `/home/zenoguy/Documents/attendance_and_salary/Factory_Local_Labour_Duty_Wage_Rules.docx`

The documents describe intended business behavior. Existing migrations and calculators describe current behavior. The newer gross-only salary and fixed-30 unpaid-leave decisions in `SN_Polymers_Payroll_Phase6_Decisions.md` take precedence over the older document's Basic salary and absence-divisor examples. This plan does not change the published joining/leaving proration policy.

## Current implementation and concrete gaps

| Capability | Existing implementation | Remaining work |
| --- | --- | --- |
| Factory configuration | `FactoryMasters.jsx`, `hrFactoryMasters.schema.js`, factory-master controller and migration 096 store dated duty hours, OT method/rate/multiplier | Store explicit calculation basis/divisor and rounding policy |
| Attendance duration | Effective row guard in migration 102 computes actual hours and OT above standard hours | Preserve this calculation; verify approval evidence for exceptional 24-hour duty |
| Dated monthly salary | `payroll/sources.js` resolves `day.pay` and `day.pay_applicability` | Consume these sources for salary-derived OT |
| Permanent OT | `payroll/factory.js` supports fixed hourly OT | Salary-derived branch currently emits `SALARY_DERIVED_OT_BASIS_REQUIRED` |
| Casual/local earnings | Daily wages, derived/fixed hourly OT, casual holiday premium and local double-duty multiplier already exist | Explicit rounding for repeating derived rates; confirm document exceptions separately |
| Exact money | `payroll/exact.js` provides rational arithmetic and approved rounding | Reuse it for the defined daily/hourly/amount rounding stages |
| Payroll integration | `payroll/preview.js` already merges factory earnings into gross and statutory calculation | Add complete source references and version the changed arithmetic |
| Freshness/review | Saved calculations and source fingerprints already exist | Include new calculation configuration and preserve submitted/locked results |
| Other factory treatments | Explicit blockers exist for stoppage, short hours, permanent holiday basis and casual paid leave | Separate subsequent calculation slices, not hidden fallbacks |

## Phase 1 — permanent salary-derived OT and explicit derived-rate rounding

### Business calculation contract

Proposed standard settings, visibly applied and saved by an authorized master editor:

- Salary basis: the employee's agreed monthly gross applicable on the attendance date. Do not recreate Basic salary or use gross after LOP as the hourly-rate base.
- OT salary days: 26, independently configured from the unpaid-leave divisor.
- Normal duty hours: existing rule value, normally 8 for permanent/casual and 12 for local workers.
- OT hours: existing approved attendance duration above normal duty hours. No duplicate manual OT-hours entry.
- OT multiplier: retain the configured rule value. Do not overwrite existing 1.5x rules with the document's 1x example.
- Proposed document-matching rounding: HALF_UP to two decimals at the daily-rate, base-hourly-rate, multiplied-hourly-rate and daily OT-amount stages. Store the convention explicitly; do not introduce silent rounding for old rules.
- Hourly rate is determined per attendance date. Overnight duty remains attributed to its existing duty-start date; do not split the same duty across two salary rates.

Permanent calculation:

```text
Daily rate       = round(applicable monthly gross / OT salary days)
Base hourly rate = round(daily rate / normal duty hours)
OT hourly rate   = round(base hourly rate * configured multiplier)
OT amount        = round(OT hourly rate * recorded OT hours)
```

For daily-wage-derived OT, use the applicable daily wage directly, then the same explicitly configured hourly and amount rounding stages. Preserve exact fixed-hourly calculations; require an explicit amount-rounding policy when fractional hours would otherwise produce a sub-paise amount.

Acceptance examples at 1x:

| Scenario | Expected |
| --- | --- |
| Permanent: gross 10,000 / 26 / 8, 2 OT hours | Daily 384.62; hourly 48.08; OT 96.16 |
| Permanent: same inputs, 24-hour duty | 16 OT hours; OT 769.28, subject to valid attendance/HO approval |
| Casual: daily 400 / 8, 2 OT hours | OT 100.00; total daily earnings 500.00 |
| Local: daily 350 / 12, 2 OT hours on Single Duty | Hourly 29.17; OT 58.34; total 408.34 |

These are synthetic test fixtures, not instructions to replace current employee salaries or factory wage masters.

### Persistence and existing UAT attendance

Factory rule revisions are immutable; attendance stores `pay_rule_revision_id`. Inserting a backdated replacement rule can make already-locked attendance fail `MISSING_OR_OUTDATED_FACTORY_RULE`. Avoid making an OT arithmetic completion require silent attendance rebinding.

Recommended design: an immutable calculation-configuration record bound by UUID to one factory pay-rule revision, rather than editable values scattered between the salary policy and attendance rows.

1. Add a narrowly scoped table, provisionally `hr_factory_pay_rule_calculations`, with a unique rule-revision FK, validated calculation settings, author, timestamp and reason. Inherit applicability from the referenced rule; do not introduce a second effective-date timeline.
2. For new applicable rules, save the rule and calculation settings atomically through a transactional RPC. Keep the existing HTTP workflow; remove the direct insert path for operations requiring both records.
3. For old rules missing calculation settings, provide an explicit one-time **Complete calculation setup** action. Show the referenced rule's period and affected draft rows before saving. Store approval/reason; do not seed 26, example wages or rounding into old rules automatically.
4. A completion applies to that rule's full effective interval, ending at the next category rule. Reject it if it would alter a covered locked financial result. If part of the interval is locked, use a new future rule or the established correction workflow instead.
5. Existing complete configuration is immutable. A subsequent policy change creates a new dated pay-rule revision with its own calculation configuration. It must not overwrite the prior record.
6. Enforce category/method compatibility, finite positive divisors, allowed basis/rounding enums, uniqueness, actor authorization and audit in PostgreSQL as well as Zod.
7. Extend the existing category source-fence/finalization lock protocol to this table. Completion and payroll finalization must serialize against the same factory source key; a controller-only locked-period check is insufficient.
8. Keep RLS/service-only database access consistent with adjacent masters. Regenerate schema/RPC/index manifests as applicable. Use the next unused forward migration number at implementation time; 154 is currently next.

This adds a calculation policy to existing attendance evidence without changing timestamps, OT hours or the attendance's original rule reference. The exact new table/RPC names are implementation details; the invariants above are required.

### Backend calculation and source plumbing

- Extend `get_payroll_preview_sources` from its latest effective definition in migration 153 to fetch relevant calculation configurations in one bounded query. Normalize decimal fields to strings, including the divisor. Ensure review and financial source RPCs receive the same configuration.
- Resolve configuration by the attendance's authoritative rule ID. Missing/malformed configuration produces an actionable blocker, not an exception, guessed basis or zero OT.
- Add salary-derived OT to `factoryDay`, using `day.pay.guaranteed_monthly_gross` and the applicable calculation configuration. Missing or suspended salary remains blocked through existing validation.
- Use `exact.js` throughout; no JavaScript floating-point monetary calculation. Capture daily rate, hourly rate, multiplier, hours, rounding convention and final amount as readable calculation evidence.
- Include attendance, rule, calculation-config, pay-structure and pay-applicability IDs on permanent OT earnings. Include wage-revision IDs for daily-wage OT.
- Continue emitting the existing `OVERTIME` earning code so configured statutory wage-inclusion rules continue to decide how it contributes. Do not force OT into every scheme's wage basis.
- Update the arithmetic fingerprint revision. Distinguish that salt from the financial snapshot's `calculation_revision`; if the latter changes, update PostgreSQL accepted-version guards in the same migration.
- Preserve existing automatic draft recalculation behavior on open/refocus/source checks. Submitted/returned/locked calculations keep their saved results and show the appropriate source-change action. Do not add background jobs merely for this feature.

### User-facing workflow and authorization

Keep the existing Factory Masters page and shared form components:

1. Choose worker category and effective date.
2. Set normal duty hours and OT multiplier in the existing fields.
3. For permanent salary-derived OT, show **Salary days used for OT**, default proposal 26, and **Uses agreed monthly gross**.
4. Show a plain-language calculation summary. Keep the proposed standard rounding convention compact, with an explicit saved choice rather than several new engine dropdowns.
5. Existing incomplete rules show **Complete calculation setup** and an impact confirmation. Human-readable errors explain missing salary, configuration or attendance approval.
6. Payroll details show the OT arithmetic and source dates, not JSON.

Preserve current authorization: Admin/Factory Manager author factory wage/pay rules; HO has current master read access. Accounts continues to own statutory setup and the existing payroll review actions. Do not expand Accounts master-author permissions as part of this calculation fix. Match backend and UI permissions.

### Required verification before release

- Unit tests: document examples, 1x/1.5x/2x, fractional OT hours, zero OT, disabled OT, missing salary/configuration, 26-day OT independent of 30-day LOP, midmonth salary changes and duty-start-date attribution.
- Regression tests: both permanent categories, casual and local derived rounding, unchanged fixed hourly/double-duty/holiday results, stable statutory inclusion/exclusion and no duplicate earnings.
- Database/API tests: atomic rule/config save, rollback on invalid config, direct SQL guards, authorization, one-time legacy completion, no overwrite/delete, effective interval boundaries, locked-result rejection and concurrent finalization fencing.
- Freshness tests: new configuration changes fingerprints; unsubmitted drafts append a new calculation when checked; submitted/locked snapshots are preserved; repeated checks are idempotent. Include any new financial revision token in DB acceptance tests.
- UI tests: relevant fields only, category/method switching clears incompatible values, loading/error/success states, completion impact preview and readable calculation details.
- Run focused backend tests first; isolated DB regression and DB contracts; relevant broader payroll tests; frontend tests/build/targeted lint; `git diff --check`. Report actual results and separate environmental failures from product failures.
- Update implementation documentation and graphify after code changes. Plan creation alone does not require a graph rebuild or runtime tests.

## Phase 2 — client decisions resolved on 28 October 2026

Implemented: missing-hours-only deductions, normal pay on management stoppage, total holiday entitlement, Paid leave based on HO’s final decision with no certificate requirement, and 2x Local Double Duty with a warning rather than a new hard cutoff beyond 24 hours. The original planning notes below are retained as the decision checklist; see the implementation report for current behavior.

| Slice | Planned behavior | Decision/verification needed before arithmetic is enabled |
| --- | --- | --- |
| Management stoppage | Permanent salary retained; casual full daily wage for an evidenced management-caused short day | Replace free text with executable policy and approved reason evidence; verify complete stoppage separately from a worked short day |
| Short hours | Apply an explicitly approved treatment only when there is no valid authorized exception | Confirm full-day deduction versus proportional deduction; use the applicable unpaid-leave policy without double deducting the day |
| Permanent holiday duty | Resolve approved calendar date and an explicit daily wage basis | Confirm whether 1.5x means additional payment on top of monthly salary or a total entitlement; do not reuse casual premium math blindly |
| Casual paid medical leave | Pay the effective daily wage only for approved paid leave using HO’s final Paid/Unpaid decision | No medical certificate or document is required. Use the finalized HO approval/pay treatment and avoid a duplicate daily wage |
| Exceptional 24-hour duty and next-day off | Preserve duty-start attribution and existing comp-off evidence | Confirm existing HO attendance approval meets management approval; add evidence only where missing, not a parallel approval system |
| Local double duty | Retain explicit Single/Double Duty and existing multiplier-based calculation | Confirm whether a fixed override such as 750 is actually required; current 2x handles 700. Document suggests OT beyond 24h, while current code forbids it and suppresses Double Duty OT; retain the guard pending an explicit newer decision |

Audit paid/unpaid full-month leave, joining/leaving, advance installments and calendar integration against existing implementations before proposing further changes. They already have substantial infrastructure; do not rebuild them from document screenshots or assume their configuration is complete.

Each slice gets its own structured policy, historical compatibility checks and positive/negative regression tests. No generic bypass for unsupported attendance or incomplete payroll inputs.

## UAT rollout after Phase 1 verification

1. Apply the reviewed forward migration to development only after local migration/contracts pass.
2. Through the UI, explicitly complete the relevant existing SNP and Fabric permanent rule configurations with 26-day OT, the existing duty hours/multipliers and the approved rounding convention. Keep current wage amounts and attendance intact.
3. Resolve stale draft salary references through the existing correction workflow and complete the applicable work-calendar evidence. These are independent of the OT implementation.
4. Open/check an unsubmitted August payroll row and verify the appended calculation history, OT evidence, gross, LOP, statutory entries and net salary.
5. Repeat for September/October, a salary change, no-OT worker, overnight duty and a daily-wage worker. Submitted/locked rows must retain their original snapshots.
6. Reassess readiness from the remaining blockers. Completing OT must not be reported as full payroll readiness if holiday/short-hours/stoppage/calendar cases remain unresolved.

## Completion criteria

Phase 1 is complete when both factories can calculate valid salary-derived OT using dated gross and explicitly approved settings, document arithmetic fixtures pass, old attendance references remain valid, historical financial results are protected, current source changes are visible, and migration/API/UI/DB regression checks pass. Remaining Phase 2 cases stay clearly blocked until their own approved rules are implemented.
