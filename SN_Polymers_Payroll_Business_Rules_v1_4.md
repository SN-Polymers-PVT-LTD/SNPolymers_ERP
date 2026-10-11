# S. N. Polymers Pvt. Ltd. — Payroll Management: Business Rules & Workflow Specification

**Document ID:** SNP-ERP-HR-PAYROLL-BR-001  
**Version:** 1.4 — configurable Payroll Policy Master, fixed/actual-day methods, ERP research and month-length controls / design draft  
**Prepared:** 11 October 2026  
**Status:** **Client-confirmed approval and compensation rules incorporated; remaining statutory/calculation details still require sign-off**  
**Module:** Employee Management → Payroll Management  
**Currency:** Indian rupees (INR); store monetary values as decimal, display to two places  
**Business timezone:** Asia/Kolkata

**Pre-implementation dry run:** 75 synthetic cases + 44,100 interval-pair checks (see §§21–26); model only, **not actual ERP/database test results**. Version 1.4 adds policy-method examples and future acceptance tests; it **does not** claim another full 75-case ERP/database test run.

**v1.4 policy decision (11 October 2026):** Build an **Admin-controlled, effective-dated Payroll Policy Master** from day one. The **active client LOP rule stays fixed `Gross ÷ 30`** for permanent employees. Alternative methods (e.g. actual days per month) are available as **future configurable options**, not silently enabled. **Monthly contractual entitlement, LOP deduction and joining/leaving proration are independent calculations**, and the Statutory Deduction Master remains separate.

> **How to read this specification**
>
> - **[CONFIRMED]** — decisions given for this ERP and/or established by its existing approved HR workflows.
> - **[PROPOSED]** — a recommended implementation rule requiring normal design review.
> - **[DECISION REQUIRED]** — must be settled by S. N. Polymers before calculation can be enabled for the affected case.
> - **[LEGAL VALIDATION]** — requires current professional/statutory verification for the relevant establishment, state, employee, contribution month and effective date.
>
> The sample **“Salary for the month of APRIL'2026”** spreadsheet supplied by the client is a **layout and terminology reference, not a complete or authoritative calculation policy**. Any displayed percentages, counts, deductions or column placement must not silently become hardcoded payroll rules.

---

## Client-confirmed changes — 11 October 2026 (supersede older open-question wording)

**Decision authority:** Client directions conveyed during the payroll-design discussion. A policy marked **[CONFIRMED]** below replaces conflicting proposed language in earlier versions.

1. **All permanent employees** (SNP/Fabric permanent factory, HO Staff and Projects including the specific JE/ZO/supervisor/Head office categories and legacy Projects): loss-of-pay daily rate is **contractual monthly gross / 30**, **not / 26**. For every explicitly recorded unpaid leave day or recorded HO-rejected/unapproved leave day that is deductible under the calendar rule, subtract one such daily amount from contractual gross. HO-approved paid leave has **zero deduction**. Do not deduct both absence and unpaid leave for the same date. Deduction is made from **gross**, before calculating applicable statutory deductions.
2. **No sandwich policy**: do not insert weekly offs/holidays into an unpaid-leave count merely because leave dates straddle them. Deduct only evidenced, chargeable leave dates; the explicit calendar rule for weekly offs appearing **inside** a requested date range still needs a precise acceptance example (see Open Decisions).
3. **Partial joining/exiting a month**: the client earlier directed use of the same `gross/30` per-day logic. **That remains the previously communicated instruction**; the exact eligible-day numerator/holiday interaction is still open. Our later **actual-calendar-day proration** is a **separate recommended configurable alternative**, **not a replacement approved by the client**. Do not activate actual-day join/exit proration without explicit sign-off. For a complete eligible month, contractual gross remains the full monthly amount in 28/29/30/31-day months.
4. **No fabricated HO/Projects absences**: take approved or unapproved/rejected leave only from recorded requests/authorized absence evidence; missing leave data is not an automatic unpaid day. Pending requests must not be silently treated as approved or rejected.
5. **Factory attendance**: derive pay from the existing approved attendance/wage/pay-rule contract, including Locked daily rows, CO, stoppage, short hours, duty types, and leave decisions. Where the reference has **free-text** short-hours/stoppage descriptions rather than executable formulas, require a structured policy-code mapping; do not invent monetary arithmetic.
6. **Holiday pay multiplier means TOTAL daily compensation**, not a premium added at the full multiplier on top of ordinary pay. E.g. if normal daily compensation is already in salary/base wage and multiplier is 1.5, add only a **0.5× extra component** to reach **1.5× total**. Apply only where the category and attendance permit holiday pay; Local has no holiday-pay eligibility under existing rules. Use each effective rule's configured multiplier (1.5 is an example, not a code constant).
7. **Special package** is an agreed compensation amount for a person, payable either as one amount or broken into salary components; breaking it into components must not increase or reduce the agreed total. Component classification for statutory contribution bases must still be approved.
8. **Admin** controls the new statutory master. EPF/ESI percentages, applicability, salary bases, caps, effective dates, and PT slabs are sourced from its published revisions; keep changes auditable. Admin authority is confirmed; any additional separate sign-off by another person is not confirmed.
9. **Manual adjustments** use a separate auditable earning/recovery/advance ledger with reason, authorization and links; no direct manual edit to calculated net or statutory percentages.
10. **Existing Accounts requisition UX is the workflow reference.** Inspected `accounts/HO_Approval_Business_Logic_v3.md`, `backend/src/routes/acctRequisition.routes.js`, `backend/src/controllers/acctRequisition.controller.js` and requisition migration `021`. In that module, Accounts creates an Open sheet, submits it, and **HO acts on individual line items** (approve/partially approve/hold/return/reject), not on the entire sheet. For payroll, the **confirmed actors** remain FM → Accounts → HO/Admin (factory) and Accounts → HO/Admin (office). **NOW CONFIRMED:** Payroll decisions are **per employee salary row**, not per whole sheet. Accounts may clear or return each factory salary row; HO/Admin may finally approve-and-lock or return each forwarded row. Other rows continue independently. Use a separate payroll schema and transactions, not requisition-bank-debit RPCs. Approval does **not** mean salary has been disbursed; employee payment status remains separate.

11. **[CONFIRMED DESIGN CHOICE] Configurable payroll calculation policies**: use a separate **Admin → Payroll Management → Payroll Policy Master**, with versioned effective dates, configurable `FIXED_DIVISOR` and `ACTUAL_CALENDAR_DAYS` LOP methods, **Fixed 30** as the currently active client choice, an independent join/exit proration method, full-month exception controls and a monthly cross-run reconciliation strategy. This does **not** authorize switching the client's current calculation, nor resolve full-month-unpaid leave without sign-off. Details in §6.3.

### Confirmed decision: employee-level payroll review and locking

1. **Sheet/run = batch container:** tracks factory or department, pay group, inclusive period, creator, submission and aggregate progress. It has no all-or-nothing payroll approval decision.
2. **Employee salary row = approval unit:** one employee's earnings/deductions/net are checked by Accounts (factory flow) and finally approved by HO/Admin. A returned row does not reset, amend or block another employee's already approved row.
3. **Factory:** FM creates/submits the sheet; Accounts **clears/forwards** or **returns** each employee row; only cleared rows reach HO/Admin for final per-row approval and locking.
4. **HO/Projects:** Accounts creates/submits employee rows directly to HO/Admin; an additional Accounts peer review is **not** assumed.
5. **Locking, coverage and payment eligibility happen per employee row**, atomically. A parent sheet can be partially locked while other rows are awaiting review, returned, or pending. No direct edit of a locked row, even by Admin; corrections are traceable adjustments/arrears.
6. **No partial salary approval as an uncalculated amount:** if the proposed net pay is wrong, return and recalculate the row. **Partial payment** is a separate downstream transaction against an already locked net amount.
7. **Audit and resubmission:** keep immutable row revisions, reviewer decisions, return reasons, creator/Accounts/HO timestamps, and references to the reviewed calculation version. A resubmitted factory row must pass Accounts review again.

### Effective permanent salary LOP calculation — example

```text
Contractual monthly gross salary:           ₹30,000.00
Approved divisor:                                30
Daily LOP rate:                   ₹30,000 / 30 = ₹1,000.00
HO-approved paid leave:                          2 days -> ₹0 deduction
Explicitly recorded unpaid / HO-rejected leave: 2 chargeable days
LOP deduction:                   2 × ₹1,000 = ₹2,000.00
Gross after LOP:              ₹30,000 − ₹2,000 = ₹28,000.00
Employee EPF, ESI, PT, advances: computed separately from applicable masters/ledgers
Net pay: computed only after those items are known
```

**Rounding:** Keep precise calculation units and apply the approved rounding rule; no floating-point money calculations.

---

## 1. Business objective and system boundary

**[CONFIRMED]** Deliver an auditable payroll workflow for SNP Factory, Fabric Factory, Head Office and Projects. Payroll must use the employee directory and pay structures, factory wage/rule revisions, **Locked** factory attendance and finalized leave decisions, rather than changing attendance or recreating historical facts.

The system shall:

1. Generate salary/wage results over any permitted **inclusive** date range.
2. Support distinct preparers and approvers by organizational group.
3. Calculate gross earnings, statutory employee deductions, authorized recoveries, net pay and employer liabilities transparently.
4. Retain a permanent, explainable snapshot of **each finalized employee calculation**, its inputs and governing revision IDs.
5. Produce an employee register (screen, Excel/PDF) and employee payslips consistent with the approved payroll data.
6. Pass approved, locked payroll to a separate Accounts payment/reconciliation process.
7. Prevent duplicate finalization of the same employee's payable dates across overlapping payroll runs.

**Out of scope until separately approved:** bank integration/direct transfer initiation, accounting journal posting, tax return filing, government-challan submission, employee loans beyond a simple controlled recovery ledger, attendance capture, retroactive editing of Locked attendance, and automatic reinterpretation of an already locked payroll.

### 1.1 Authoritative upstream data

| Existing ERP source | Authoritative facts | Payroll use |
|---|---|---|
| `hr_employees` | Employee ID/code, category, department, joining date, employment status, ERP linkage | Eligibility and payroll classification |
| `hr_permanent_pay_structures` | Approved/suspended pay revisions, guaranteed monthly gross, basic, staff welfare, other fixed components, EPF/ESI enrolment flags | Permanent/office pay source and enrolment signals |
| `hr_factory_wage_revisions` | Effective-dated daily wages for Casual and Local | Daily-rate earnings |
| `hr_factory_pay_rule_revisions` | Effective-dated duty hours, OT method/rate, holiday setting/multiplier, management stoppage/short-hours policy, Local double-duty multiplier | Factory earnings decisions |
| `hr_attendance_sheets` + `hr_attendance_rows` | Locked daily status, entry/exit, actual hours, OT hours, duty type, holiday eligibility, revision references | Factory payroll attendance facts |
| `hr_leave_requests` | Date range, source, decision, pay treatment, audit | Paid/unpaid leave; HO/Projects self-service |
| **New** statutory deduction master | Approved, effective-dated EPF/ESI rules and PT slabs | Statutory computation |
| **New** work calendar, employee statutory profile, payroll adjustment/recovery ledger | Scheduled/paid rest days, location/treatment metadata, approved transactions | Completeness and nonattendance deductions |

**Design constraint:** Existing permanent pay structures have revision history but do **not** presently establish a fully specified effective-date model for payroll. Add explicit payroll-effective dating or an approved, unambiguous applicability strategy **before** processing historical/cross-revision periods. Never infer past pay rates from today's active revision.

---

## 2. Workforce groups and payroll source

The category names below match the current HR directory. Employment categories are **not** ERP authorization roles.

| Payroll group | Employee category | Department/factory | Base pay model | Payroll creator |
|---|---|---|---|---|
| `SNP_PERMANENT` | SNP Permanent Factory Labour | SNP Factory | Permanent pay structure | Factory Manager |
| `SNP_CASUAL` | SNP Casual Factory Labour | SNP Factory | Daily wage | Factory Manager |
| `SNP_LOCAL` | Local Daily-Wage Workers | SNP Factory | Daily wage + Single/Double Duty | Factory Manager |
| `FABRIC_PERMANENT` | Fabric Factory Permanent Employees | Fabric Factory | Permanent pay structure | Factory Manager |
| `FABRIC_CASUAL` | Fabric Factory Casual Factory Labour | Fabric Factory | Daily wage | Factory Manager |
| `FABRIC_LOCAL` | Local Daily-Wage Workers | Fabric Factory | Daily wage + Single/Double Duty | Factory Manager |
| `HO_STAFF` | HO Staff | Head Office | Permanent pay structure | Accounts |
| `PROJECTS_ZO` | Zonal Office | Projects | Permanent pay structure | Accounts |
| `PROJECTS_JE` | Junior Engineer | Projects | Permanent pay structure | Accounts |
| `PROJECTS_SUPERVISOR` | Local project supervisor | Projects | Permanent pay structure | Accounts |
| `PROJECTS_HEAD_OFFICE` | Head office | Projects **or** Head Office | Permanent pay structure | Accounts |
| `LEGACY_PROJECTS` | Projects Department Employees (retired for new onboarding) | Projects | Existing permanent pay structure, if applicable | Accounts |

- **[CONFIRMED]** There are six distinct factory attendance rosters per date: Permanent, Casual and Local in each of SNP and Fabric. The same category `Local Daily-Wage Workers` is separated by **department**.
- **[CONFIRMED]** Legacy Projects employee identities, existing pay data and leave history must be retained, not rewritten automatically.
- **[CONFIRMED]** An existing pre-split Local attendance sheet with a null department stays a historical combined sheet; payroll must **not guess or reassign its factory**.
- **[PROPOSED]** One payroll run covers one payroll group and one date interval. Cross-group consolidated reports can combine several locked runs without merging their approval histories.
- **[DECISION REQUIRED]** If management wants one consolidated SNP Factory or Fabric Factory run covering all three employee types, treat it as a **batch/container of three child runs**, each with its own calculation policy and coverage.

---

## 3. Roles, ownership and separation of duties

### 3.1 Factory payroll — approved workflow

**[CONFIRMED]** Factory Manager creates and submits a **payroll sheet** for their authorized factory/group/period. **Each employee salary row** independently follows FM → Accounts → HO/Admin, and HO/Admin alone can finally lock that row.

```text
Factory Manager creates/ calculates payroll sheet
                       |
           Submit employee salary rows
                       v
            Accounts review queue
                       |
         +-------------+------------------+
         |                                |
    Return row to FM                Clear / forward row
  (reason mandatory)                        |
         |                                  v
   FM corrects/resubmits              HO/Admin review
         |                                  |
         +--> Accounts recheck     +--------+------------+
                                  |                     |
                           Return one row        Approve + LOCK
                          (reason required)        that one row
                                  |                     |
                             Rework route          Payment-eligible
                             via Accounts           (NOT yet Paid)
```

- Accounts **approval** means `ACCOUNTS_CLEARED` / *verified for HO*, **not** a final wage approval.
- The Accounts and HO queues act on **specific employee rows** and may perform bulk UI operations as long as each row validates and records its own independent action/result.
- HO/Admin should be able to view a sheet summary and individual calculations, return one employee, and finalize others.
- A returned row cannot change, unblock, or regress a different employee's locked row. Only the returned employee's current revision becomes editable to the originating creator.
- **[PROPOSED ROUTING DETAIL]** When HO returns an FM row, send it to the FM for correction with Accounts notified; after FM resubmission, Accounts must reverify the new version before it returns to HO. Confirm notification/assignment specifics before UX implementation.

### 3.1a Relationship with existing Accounts requisition workflow

**[CONFIRMED]** Reuse the *concepts* from Accounts requisitions: a numbered parent sheet; per-item review; individual return/correction; audited resubmission; reviewer remarks; batch review UI with independent row outcomes. Do **not** call the existing requisition approve RPCs or bank-balance debit logic: payroll calculations, accounting commitments, statutory totals, and payments are separate bounded workflows.

**[CONFIRMED]** No arbitrary `Partially Approved` net salary action that skips earnings and statutory calculations. An incorrect payroll row is returned for correction. Accounts may later record partial **payment** against an already locked net salary as a separate payment event, subject to the approved payment policy.

### 3.2 Non-factory payroll

- **[CONFIRMED]** Accounts generates payroll for Head Office and Projects.
- **[PROPOSED]** Accounts calculates/submits these runs straight to HO/Admin for **independent final approval and locking**; the Accounts review step used for FM submissions is not duplicated unnecessarily.
- **[DECISION REQUIRED]** Confirm whether any extra Accounts peer-review is required before HO approval of Accounts-created payroll.

### 3.3 Permission matrix

| Action | Factory Manager | Accounts | HO/Admin |
|---|---|---|---|
| Create/calculate own authorized factory-group run | Yes | No (unless delegated) | Admin override, audited |
| Create/calculate HO or Projects run | No | Yes | Admin override, audited |
| Save own unsubmitted factory draft | Yes | No | Override only |
| Submit factory run to Accounts | Yes | No | Override only |
| Verify/forward or return an individual submitted factory employee row | No | Yes | Oversight/return |
| Forward individual factory employee row to HO/Admin | No | Yes | N/A |
| Final approve and lock an eligible **employee salary row** | No | No | Yes |
| Return an individual employee row from final review | No | No | Yes |
| Modify a Locked employee salary calculation | **Never** | **Never** | **Never** |
| Maintain statutory deduction master | No | View only unless Admin delegates in future | Admin only; audited publish/revise **[CONFIRMED]** |
| Maintain approved payroll adjustment | Draft request only **[PROPOSED]** | Review/create by policy | Approve final adjustments |
| Execute/reconcile payments | No | Yes | View/oversight |
| View workforce/pay data | Authorized factory only; scope TBD | Payroll access by responsibility | Authorized company-wide oversight |

**[PROPOSED]** Enforce maker-checker **per employee row**: the person who created or materially edited a salary calculation cannot be its final approver, even if their role changes. Accounts factory verification and HO final approval must use current permissions and store actor identities on each row.

**[DECISION REQUIRED]** Assign factory scope explicitly (`SNP Factory`, `Fabric Factory`, or both) to each Factory Manager. Current ERP role `factory_manager` alone must not automatically authorize confidential payroll visibility for both factories. Server-side payroll calculation may need protected access to Admin-owned pay structures without granting unrestricted Employee Management access to the FM.

---

## 4. Payroll periods, grouping and cutoffs

### 4.1 Flexible periods

**[CONFIRMED]** Support **Monthly**, **Fortnightly**, **Weekly** and **Custom** presets; persist the chosen **inclusive** `period_from` and `period_to` as the real calculation boundary. Preset is metadata, not a different engine.

Examples:

| Run | Group | From | To | Cycle |
|---|---|---|---|---|
| Example A | SNP Casual | 2026-10-01 | 2026-10-15 | Fortnightly |
| Example B | Fabric Local | 2026-10-16 | 2026-10-22 | Weekly/custom |
| Example C | HO Staff | 2026-10-01 | 2026-10-31 | Monthly |

- Validate `period_from <= period_to`; calendar calculations use **Asia/Kolkata** business dates, not UTC boundary shifts.
- **[PROPOSED]** Publish payroll deadlines, cutoff dates and holiday calendars by group; reject invalid presets but permit authorized custom corrections.
- An employee may appear in several nonoverlapping runs over time, including after switching factory or category. Classify using **effective historical assignment**, not just today's department.
- **[DECISION REQUIRED]** Maximum custom period length, allowed future payroll, off-cycle payroll, and partial-period runs.

### 4.2 Overlap and double-pay prevention

**[CONFIRMED]** A **Locked employee salary row** reserves that employee's covered payroll date range, which must not overlap another Locked row even if the two sheets belong to different groups. Example: `01–15 Oct` plus `10–25 Oct` is invalid for the same employee unless the second run explicitly excludes the overlapping dates.

**[PROPOSED]** Maintain employee-level coverage rows with `(employee_id, daterange(period_from, period_to, '[]'), original_run_id, status)`. Enforce a PostgreSQL exclusion constraint or equivalent transactional invariant for finalized coverage. A global `(group, from, to)` uniqueness rule **is insufficient**.

- Warn on conflicts already present in Draft/Submitted **employee rows**; **hard-block only the conflicting row(s)** at individual HO final approval/locking, without preventing unrelated employees from locking.
- Serialize **employee-row finalization** so two parallel approvals cannot both pass validation for the same employee/date; make idempotent retries safe.
- For changes to an already-paid period, create an auditable **retro/arrears/reversal transaction** linked to the original run. Do not generate an overlapping normal base-salary run or remove locked evidence.
- A group reassignment does not reset an employee's already finalized date coverage.

### 4.3 Day classification / work calendar

The screenshot uses **26 working days + 4 Sundays = 30 total days** for April 2026. This is a **reference layout**, not a formula that can be generalized to every month or employee category.

**[PROPOSED]** Add an approved `Payroll Work Calendar` with date, department/factory, type (`Scheduled Workday`, `Weekly Off`, `Paid Holiday`, `Unpaid Closure`, `Special Working Day`), compensation eligibility and effective calendar version.

- The **fixed divisor of 30** is confirmed for permanent-employee daily LOP; do not confuse this with the actual number of calendar days or scheduled working days. Do not assume every Sunday is paid or all Saturdays are nonworking.
- Calendar days, scheduled working days, weekly offs and payable days are **different metrics**.
- An absence should create **one** deduction effect, not a deduction for both `Absent` and `Without Pay` in separate lines.
- Weekly-off/holiday entitlement and treatment during unpaid absences must be configured and approved per employment policy **[DECISION REQUIRED]**.

---

## 5. Payroll eligibility and pre-calculation readiness

### 5.1 Employee selection

**[PROPOSED]** Select an employee when their employment was applicable to some portion of the period, even if their **current** status is `Exited` or `Inactive`. Do not drop final salary, arrears or historical rows merely because the employee is no longer Active today.

Check: stable employee ID, effective join/exit dates, payroll group history, valid pay source, statutory profile, relevant factory assignment, and finalized leave/attendance.

**Existing model gap:** joining date and present status alone cannot represent every historical employment change. Add effective exit date and assignment history or an equivalent trustworthy snapshot before supporting backdated calculations.

### 5.2 Factory readiness — hard gates

- All **required attendance dates** in the period must have the appropriate **Locked** sheet for that group; Draft, Submitted, Returned for Correction and missing sheets are not interchangeable with zero days.
- Employee rows must be complete and have valid attendance, pay rule and (for Casual/Local) wage revision references.
- The employee/date cannot appear twice across factory sheets; legacy null-department sheets must be resolved as **historical combined evidence**, not split or duplicated.
- Leave referenced by Locked attendance must have the required approved decision and payment treatment.
- Require a valid pay structure or daily wage/rule revision for **every applicable date**, not just the last day of the run.
- Validate configured work calendar, OT rules and the absence/holiday/duty treatments needed by each row.
- Show a blocker list: **date, group, employee (where applicable), failed rule, source link, responsible team**.

**[DECISION REQUIRED]** Whether paid weekly offs/holidays without a daily attendance sheet are represented by an explicit calendar entitlement or require dedicated locked attendance. Payroll must not infer them as `Present`.

### 5.3 HO/Projects readiness

- Required permanent pay structure covers the payable period.
- Leave decisions for dates that affect payroll are final; pending relevant leave prevents unqualified finalization.
- Absence/leave is **not** inferred from the lack of factory attendance; HO/Projects do not use factory daily sheets.
- **[DECISION REQUIRED]** HO/Projects absence register, public holidays, standard working days and treatment of unrequested leave. Until approved, payroll can preview full salary but cannot automatically deduct for an undocumented absence.

### 5.4 Preview versus lock

**[PROPOSED]** Allow an informative incomplete preview showing missing data, but disallow transition to final approval or Locked while hard blockers exist. Rerun readiness and all arithmetic inside the finalization transaction to prevent time-of-check/time-of-use mistakes.

---

## 6. Earnings rules — common principles

Each employee result should be a clear **set of earnings lines**, not a single opaque `gross_salary` value. All computation operates on approved monetary inputs and applicable date segments.

```text
Earned gross = Base salary/wages earned
             + Approved paid leave / paid rest entitlements (if not already in base)
             + Overtime pay
             + Extra holiday-work premium (if applicable)
             + Other approved earnings / reimbursements
             + Arrears adjustments

Total employee deductions = Unpaid absence / loss of pay (where base not already reduced)
                          + Employee EPF + Employee ESI + Professional Tax
                          + Approved advances / recoveries
                          + Other authorized deductions

Net salary / wages = Earned gross − Total employee deductions
```

**Critical no-double-counting rule:** A calculator must choose **either** (A) a full contractual base minus unpaid-day deductions **or** (B) pay only eligible earned units. Do **not** combine an earned-days-only base with a second deduction of those same unpaid days. Similarly, holiday/weekly-off/paid-leave pay must not be counted twice when already included in a guaranteed monthly gross.

Keep employer EPF/ESI and other employer liabilities **outside employee deductions and net salary**, while reporting them separately.

### 6.1 Pay structure components

The existing permanent structure contains:

- `guaranteed_monthly_gross`
- `basic_salary`
- `staff_welfare`
- `other_fixed_components`
- `pay_basis`: `Monthly salary` or `Special package`
- `epf_enrolment`, `esi_enrolment` (booleans, **not amount fields**)

**[PROPOSED]** Classify each component as payable, pension/insurance-eligible where legally applicable, pro-ratable, reimbursement/allowance, and included/excluded from contractual guaranteed gross. A difference between specified components and guaranteed gross must be explained by a named component or a clearly classified balancing line; never silently discard or duplicate it.

**[CONFIRMED]** `Special package` is a person-specific agreed total amount which may be paid as one line or broken down into components; those components must reconcile to the agreed total. **[DECISION REQUIRED]** Verify whether the recorded special-package figure is monthly, what period it covers if different, and how its statutory wage base and partial-period proration are classified.

### 6.2 Permanent salary daily deduction — confirmed, with partial-month details remaining

**[CONFIRMED]** For **all permanent categories**, including both factory permanent categories, HO Staff and Projects, the currently selected **published LOP policy** is `FIXED_DIVISOR` with divisor **30** (see §6.3):

```text
Daily LOP rate = contractual monthly gross / 30
LOP amount = Daily LOP rate × explicitly recorded, deductible unpaid/rejected leave days
Gross after LOP = contractual monthly gross − LOP amount
```

- A recorded HO-approved **Paid** leave day results in **no** deduction.
- A recorded **Unpaid** or HO-**Rejected/Unapproved** leave day is deducted once, subject to the no-sandwich day-count rule.
- No blanket inference of absence from lack of attendance or a missing leave request for office employees.
- Do not charge a second absence deduction for the same date. Keep `contractual_gross`, `lop_deduction`, `earned_gross`, and statutory employee deductions as separate amounts.
- A complete employment month pays the contracted gross before applicable documented LOP, regardless of whether the month contains 28, 29, 30, or 31 calendar days. **[EARLIER CLIENT DIRECTION; IMPLEMENTATION POLICY STILL OPEN]** Midmonth join/exit was initially described using monthly gross / 30; the eligible-date numerator/holiday interaction remains unresolved. **[PROPOSED ALTERNATIVE, NOT APPROVED]** Use `ACTUAL_CALENDAR_DAYS` for join/exit proration if the client approves it. Do **not** turn this alternative on by default merely because LOP is configurable.
- A `Special package` may be one line or components but must total the employee's agreed compensation.
- Weekly-off/holiday dates must not be **automatically added** as sandwich leave; confirm the treatment when the dates are explicitly part of a requested interval.
- On a salary revision within a month, store dated segments and reconcile their total using an approved changeover rule; do not apply the newest rate retrospectively.
- Rounding for the daily value and aggregate deduction remains a versioned payroll policy.

### 6.3 Admin Payroll Policy Master — approved configurable architecture, controlled calculation methods

**[CONFIRMED DESIGN CHOICE]** Introduce **Admin → Payroll Management → Payroll Policy Master**, separate from the **Statutory Deduction Master** and from the factory **Wage Master / Attendance & Pay Rule Master**. Admin may configure **future-effective** revisions. Payroll calculators must resolve a **published applicable revision**, use it consistently and retain the revision ID + inputs + outputs in every locked employee result.

#### 6.3.1 Keep three monetary questions distinct

| Concern | Governing value/formula | Configuration | Client status |
|---|---|---|---|
| **Full-month entitlement** | Agreed contractual monthly gross, irrespective of 28/29/30/31 calendar days, before eligible LOP | `monthly_entitlement_method = CONTRACTUAL_MONTHLY_GROSS` | **[CONFIRMED]** |
| **Unpaid/rejected leave (LOP)** | `gross / divisor × chargeable unpaid days`, or actual-month-day alternative | `lop_method`, `lop_fixed_divisor` | **[CONFIRMED]** **Fixed 30 currently active**; actual days future option only |
| **Join/exit/partial-month earning** | Amount attributable to dates actually eligible for salary, independent of LOP | `partial_month_proration_method`, applicable work calendar | **[DECISION REQUIRED]** Original client direction suggests gross/30; **actual calendar days is recommended, not client-approved** |
| **One salary paid over multiple runs** | Allocations must reconcile to the **single monthly contractual entitlement** | `split_period_allocation_method`, employee/month ledger | **[PROPOSED]** calendar-day-weighted allocation plus final residual; sign-off required |
| **Full-period unpaid exception** | No work/payable entitlements, or literal deductions exceed monthly salary | `full_month_unpaid_treatment`, exception policy | **[DECISION REQUIRED]** block until explicit payable/weekly-off rule signed |
| **LOP day classification** | Recorded chargeable dates; paid leave never deductible; no inferred sandwich leave | `sandwich_enabled = false`, work calendar / leave day-count rule | **[CONFIRMED]** no sandwich, **[DECISION REQUIRED]** explicit leave-range weekly offs |

**Avoid conflating** `30` (current LOP divisor) with the number of calendar days in the month, paid working days, entitled calendar dates, or the dates contained in a fortnightly pay run.

#### 6.3.2 Supported LOP methods (no automatic switch)

- `FIXED_DIVISOR`: `lop = (applicable_monthly_gross / fixed_divisor) × chargeable_unpaid_days`; current approved `fixed_divisor = 30` for **all permanent groups**. A future fixed divisor may be configurable **only in a newly published Admin revision** and only with appropriate policy approval. No employee-specific UI override.
- `ACTUAL_CALENDAR_DAYS`: `lop = (applicable_monthly_gross / days_in_that_calendar_month) × chargeable_unpaid_days`; **future selectable method, not currently approved for this client**. Each unpaid date is evaluated against its own month and salary revision; split cross-month leave first.
- Do **not** automatically choose `ACTUAL_CALENDAR_DAYS` for February, switch based on unpaid-day counts, or turn a blocked extreme-absence case into a paid result. Switching methods is a policy decision, not an error-handling fallback.
- Gross/method examples below are **reference calculations**, not new client wage rates. Amounts use precise Decimal arithmetic, then a displayed two-decimal final deduction; **actual approved rounding placement is still open**.

| ₹30,000 gross, 2 LOP days | Month length | Fixed ÷30 **active** | Actual-days **optional, not active** |
|---|---:|---:|---:|
| February 2026 | 28 | ₹2,000.00 LOP → ₹28,000.00 gross | ₹2,142.86 LOP → ₹27,857.14 gross |
| October 2026 | 31 | ₹2,000.00 LOP → ₹28,000.00 gross | ₹1,935.48 LOP → ₹28,064.52 gross |
| No LOP in any month | 28/29/30/31 | ₹30,000.00 full gross | ₹30,000.00 full gross |

#### 6.3.3 Published policy revision contract (proposed storage)

| Field | Meaning / validation |
|---|---|
| `id`, `revision_number` | Immutable UUID and positive revision per policy scope |
| `scope_type`, `pay_group_id` | `GLOBAL` or specific pay group; lookup precedence must be **specific group → global fallback** and documented. No ambiguous multiple active revisions |
| `effective_from`, `effective_to` | Date range of applicability. **[PROPOSED]** activate permanent monthly salary-method changes on the **first day of a payroll month**, avoiding implicit mixed methods mid-month; exceptional effective dates need explicit split semantics |
| `status` | `DRAFT`, `PUBLISHED`, `SUPERSEDED` (append-only changes to published rule values) |
| `monthly_entitlement_method` | `CONTRACTUAL_MONTHLY_GROSS` for current permanent groups |
| `lop_method`, `lop_fixed_divisor` | `FIXED_DIVISOR` / `ACTUAL_CALENDAR_DAYS`; divisor required and strictly positive only for fixed method; default **30** only via approved initial revision |
| `partial_month_proration_method` | Distinct enum: `FIXED_DIVISOR`, `ACTUAL_CALENDAR_DAYS`, `WORK_CALENDAR`, or `UNRESOLVED`; initially mark affected cases unresolved pending explicit confirmation |
| `partial_month_fixed_divisor` | Used only if separately selected; never automatically inherit `lop_fixed_divisor` |
| `split_period_allocation_method` | `CALENDAR_WEIGHTED_WITH_RESIDUAL` (proposed) or `UNRESOLVED`; cannot create extra entitlement merely by selecting more periods |
| `full_month_unpaid_treatment` | Initially `UNRESOLVED` to block affected live finalizations; any later `ZERO_WHEN_NO_PAYABLE_DAYS` or specific entitlement-preserving method requires sign-off/legal verification |
| `sandwich_enabled`, `leave_weekly_off_method` | `false` for sandwich; separate `UNRESOLVED`/calendar-based method for explicit date ranges |
| `monetary_rounding_method` | Per-aggregate/per-line/day plus Decimal precision (approval required); do not round silently in browser |
| `created_by`, `published_by`, `published_at`, `reason`, `approval_reference` | Admin actor/time/change rationale and traceable business sign-off; no unpublished policy used to calculate final amounts |

**Publication controls:** Admin alone can create/edit **Draft** policy revisions and publish approved revisions. Existing published records cannot be modified in place or backdated to rewrite a locked salary. Require an explicit diff, affected groups, future effective date, nonoverlap validation and preview impact check before publishing. Revisions are **not Statutory Master revisions**, and cannot override statutory eligibility, caps or contribution rates.

**Scope controls:** A future per-group rule may be justified for nonpermanent employees, but Casual/Local calculations continue using the existing wage/duty master unless a **separately approved** salary policy maps their calculation to this master. There is no assumption that the office `FIXED_DIVISOR` policy applies to daily-wage labour.

#### 6.3.4 Monthly entitlement ledger and split-run allocation

A monthly-salaried employee must have a **single entitlement calculation per `(employee_id, salary_month, effective salary segments)`**, regardless of whether the payment interface creates one monthly, two fortnightly or multiple custom payroll runs. Maintain an employee/month ledger that records the contractual gross, effective salary revisions, policy revision, allocated portions, recorded LOP dates/deductions, approved earning adjustments, and total already **locked** amounts.

**[PROPOSED; REQUIRES SIGN-OFF]** For a full month with no join/exit/revision and no LOP, use calendar-weighted allocation with a final residual assigned to the last eligible run:

```text
Full monthly entitlement: ₹30,000, October 2026 (31 calendar days)
First run (1–15): 30,000 × 15/31 = ₹14,516.13
Final run (16–31): ₹30,000 − ₹14,516.13 = ₹15,483.87
Sum of regular base allocations: ₹30,000.00 exactly
```

- LOP is **assigned to the actual recorded unpaid dates** and deducted once, not multiplied through every subperiod independently or inferred from 31 calendar days.
- If the employee joins/leaves or salary changes, first segment entitlement under the **separately approved partial-month/revision proration method**, then allocate; do not use the example full-month weighting blindly.
- Maintain currency residual handling in one deterministic final allocation row (no hidden loss/gain from per-run rounding). A run can be Locked only when that employee's month-total allocation and allowed outstanding periods reconcile; allow incomplete ongoing months only through a defined deferred-entitlement policy.
- Return/recalculate of an unlocked row recalculates the relevant **remaining** allocation and checks earlier locked amounts; never modify an already locked row to compensate for a changed future preview.
- Overlapping employee date coverage **and** exceeding or inconsistently distributing monthly entitlement are **distinct blocks**. Both validations are mandatory for live approval.

#### 6.3.5 Extreme-absence and audit safeguards

- Literal fixed-30 full-month calculations show the known anomaly: a February 28-day total unpaid leave leaves ₹2,000 residual, and 31 unpaid dates in October produce **negative ₹1,000**. **Neither is automatically accepted.** Set `CALCULATION_BLOCKED_POLICY`, explain the dates and alternatives, and request the signed `full_month_unpaid_treatment` rule.
- A generic `max(0, gross − lop)` **does not resolve the policy**; it hides the question whether holidays/weekly offs remain entitled. The engine must not silently clamp and approve.
- Do not infer all Sundays to be unpaid, or subtract an explicit Sunday without an approved date-classification rule. **No sandwich** prohibits inferring extra unpaid days outside documented absence; it does not settle charging a Sunday **inside** a leave request.
- Master publication or scope/effective-date changes affecting **unlocked** row calculations invalidate stale previews/Accounts clearance/HO review until revalidated with the new policy version; audit the decision and new calculation hash. Locked results remain identical; corrections use a separately approved future adjustment.
- If published policies overlap, are absent for the relevant group/month, require ambiguous historical employee/factory assignment, or conflict with statutory requirements: block locking with an explanation rather than choosing a hidden fallback.

#### 6.3.6 Worked calculation pipeline (reference semantics)

```text
1. Determine employee + pay group + salary month + historical employment dates.
2. Resolve published Payroll Policy revision at month/employee-group scope.
3. Determine contractual MONTH entitlement using effective salary structure segments.
4. Separately determine join/exit/transfer/pay-change PRORATION (if applicable).
5. Read only documented, finalized leave/Locked factory attendance; classify chargeable dates.
6. Calculate LOP using the resolved LOP method, without inferred sandwich dates.
7. Handle full-period unpaid, negative entitlement and uncertain weekly-off cases as BLOCKED_POLICY.
8. Allocate month entitlement to requested nonoverlapping runs and reconcile locked month ledger.
9. Add approved OT/holiday/adjustments; resolve Statutory Master independently on qualifying earnings.
10. Freeze per-employee source IDs + policy revisions + arithmetic + rounding + results at HO final lock.
```

**Reference implementation principle:** this is a **small set of explicit, named, versioned formulas and validators**, not an unrestricted custom formula editor. Configuration must not allow arbitrary code execution, hidden employee-level overrides, or edits to completed payroll snapshots.

---

## 7. Earnings by employee type

### 7.1 Permanent factory employees — SNP and Fabric

**[CONFIRMED]** Base pay comes from an applicable Permanent Employee Pay Structure. Locked attendance provides Present/Absent/Leave/CO/MI, actual hours, stored OT hours and holiday eligibility.

**[PROPOSED]** The payroll calculator:

1. Resolves contractual components for each applicable date segment.
2. Applies the approved full-month/partial-period policy and subtracts unpaid time **once**.
3. Credits eligible paid medical/other leave using HO's final pay treatment, according to contractual leave policy.
4. Treats `Compensatory Off` backed by a qualifying **Locked previous-day 24-hour duty** as non-deductible, per approved attendance design; do not create extra CO earnings unless separately approved.
5. Applies holiday pay **only if** the saved row is eligible and the effective rule enables holiday work.
6. Uses stored OT hours and effective OT **method/rate**; revalidate the source rule rather than overwriting attendance facts.
7. Applies `Management Issue` and short-hours treatment using a **structured, approved payroll interpretation** of the rule master (the current free-text descriptions do not themselves define executable formulas).

**[CONFIRMED]** Holiday multiplier denotes **total** eligible day compensation. With a 1.5× master rate, a day whose 1× base is already included in guaranteed salary gets **only an extra 0.5×**. A day whose base has not been included is paid 1.5× in total. Never add a 1.5× supplement on top of an already-paid day.

### 7.2 Casual factory workers — SNP and Fabric

**[CONFIRMED]** Effective-dated daily wage revisions govern daily pay; Fabric Casual has its own category and revisions but follows the same method as SNP Casual. Existing examples of ₹400/day and ₹50/h are references, **not mandatory current rates**.

**[PROPOSED]** For each date:

- `Present`: eligible daily base wage, plus effective OT and holiday pay if approved.
- `Absent`: no day wage (do not also subtract a second LOP line).
- `Approved + Paid leave`: wage based on approved leave compensation policy.
- `Approved + Unpaid leave`: no wage.
- `Compensatory Off`: policy-defined payable rest treatment, tied to the qualifying locked prior-day duty.
- `Management Issue`: apply the approved stoppage/short-hours wage treatment, not an arbitrary automatic zero or full day.
- `Rejected/unresolved leave`: never silently convert to paid work.

Where wage/rule revisions change midperiod, split calculation on the relevant **attendance dates**. Store each revision ID and calculation line, then sum.

### 7.3 Local Daily-Wage Workers — SNP and Fabric

**[CONFIRMED]** Both factories use the Local category wage/rule revisions. Employee Master `department` determines which factory roster they belong to. Local leave is **Unpaid**, no holiday-work eligibility is supported in the current attendance rules, and **Double Duty has zero OT**.

**[PROPOSED]** For a qualifying worked day:

```text
Single Duty base = applicable daily wage × 1
Double Duty base = applicable daily wage × effective double-duty multiplier
Local OT earnings = 0 for Double Duty
Local Single Duty OT = stored eligible OT hours × effective OT calculation
```

The multiplier above is a **worked example of configured policy**, not a promise that every Double Duty always uses a 2.0 multiplier. Stored `duty_type` is authoritative. Do not combine Double Duty with extra OT, and do not pay Local leave/holiday premiums contrary to approved factory rules.

**[DECISION REQUIRED]** Clarify pay for `Management Issue` with actual hours, early stoppages, working on a normally nonworking date, and whether any special duty spans several calendar dates.

### 7.4 HO Staff and Projects

**[CONFIRMED]** Accounts creates these payrolls from applicable Permanent Pay Structure revisions and self-service leave decisions; **factory attendance is not used**.

- Apply monthly gross ÷ 30 to **each evidenced unpaid or HO-rejected leave day**, with no sandwich days added automatically. The gross is reduced by LOP once, before separate statutory deductions.
- Approved Paid leave must not be subtracted. A leave request with HO decision Approved but `pay_treatment=Unpaid` **must** be deducted. Recorded Rejected leave is also chargeable according to the client rule; it must not be reclassified as paid or inferred as an absence outside the recorded dates.
- Pending leave affecting the run blocks finalization or is escalated for an explicit decision.
- No default OT or holiday premium without a separate approved policy/source.
- **[CONFIRMED]** Never fabricate absence where no recorded request/approved evidence exists; no automatic sandwich policy. **[DECISION REQUIRED]** Precisely define weekly off/public-holiday dates inside an explicit leave range and the partial joining/exiting month numerator.

### 7.5 Employment and payroll classification changes

**[PROPOSED]** Handle midperiod changes by date-segmented calculation. A permanent-to-casual or SNP-to-Fabric change is not merged into one invented rate: preserve distinct lines, historical assignment, actual pay source and single employee-level coverage. Moves from the retired Projects category must not rewrite prior payroll classifications.

---

## 8. Statutory Deduction Master (new)

### 8.1 Central rate ownership

**[CONFIRMED]** Employee Management must **not** accept manual EPF/ESI percentage fields or direct contribution **amounts** as pay-structure components. Payroll takes all statutory rates/rules from a centrally managed **effective-dated Statutory Deduction Master**.

The currently inspected Permanent Pay Structure stores `epf_enrolment` and `esi_enrolment` **yes/no flags**; it does **not** currently expose an `ESI amount` field in the reviewed page. Keep those flags (subject to a legally appropriate employee statutory profile). If a legacy/manual ESI amount field exists elsewhere, audit usage and migrate it safely, without discarding historical evidence.

### 8.2 Master design

| Field | Business purpose |
|---|---|
| Scheme | EPF / ESI / Professional Tax |
| Jurisdiction / establishment / state | Which rule applies to whom |
| Effective from / until | Version applicability and prevention of ambiguous overlaps |
| Employee contribution rate | % where applicable (EPF/ESI) |
| Employer contribution rate | % where applicable (EPF/ESI) |
| Contribution wage basis | Definition of qualifying salary/wage components |
| Eligibility ceiling / criteria | Where legally required |
| Contribution cap / minimum | Where legally required |
| Rounding / precision method | Scheme-specific verified formula |
| Professional Tax salary slabs | Effective-dated **amount by applicable earnings slab**, not a blanket percentage |
| Monthly aggregation method | Which payroll runs contribute to the statutory month |
| Publication status | Draft → Reviewed → Published/Superseded |
| Audit fields | Creator, reviewer, effective date, reason, timestamps |

> **The spreadsheet's `EPF @12%` and `ESI @0.75%` headings are reference labels only.** No percentages are hardcoded in Employee Management or payroll. Actual rates, wage ceilings, legal definitions, employee/employer split, thresholds and PT slabs need statutory validation before production use. Professional Tax is generally configured by jurisdiction-specific slabs, not a universal percent.

### 8.3 Employee-specific statutory information

Maintain only necessary eligibility/enrolment and identifier data in a protected **Employee Statutory Profile**, including effective dates and audit. The existing permanent-pay EPF/ESI flags can be migration inputs, but should not be the sole source of statutory applicability for factory Casual/Local workers.

The statutory engine combines:

```text
Employee statutory profile & legally applicable status
+ employee work establishment/jurisdiction
+ dated statutory master revision
+ qualifying earnings/components and monthly aggregation
= employee contribution + employer contribution + tax deduction
```

- Employee contribution reduces net pay.
- Employer contribution is a **separate employer liability**, not another deduction from net salary.
- A zero contribution may mean exempt, outside eligibility, below threshold, or missing configuration; record the **reason**, not just `0`.
- Statutory deductions must never be entered as arbitrary editable per-employee deduction amounts without a controlled, explained exception procedure.

### 8.4 Weekly/fortnightly pay and statutory month

**[PROPOSED]** Use a distinct monthly statutory ledger by employee, scheme, statutory month and payroll run. This is necessary when a person has two or more payrolls in one month.

- Avoid collecting a **monthly PT amount multiple times** across two fortnightly runs.
- Apply legally appropriate monthly aggregate wage/eligibility rules for EPF/ESI where required.
- If a statutory rate changes during a pay interval, resolve the master revision using **that scheme's legally defined effective/contribution-period rule**, not blindly splitting every contribution by day.
- Record any amounts withheld in earlier runs and the increment still payable in the current run.
- Do not silently change contributions in old Locked runs; carry approved statutory adjustments forward with source links and reconciliation.

**[LEGAL VALIDATION]** Rate version timing, wage definitions, exclusions, threshold continuity, employer/employee share, month of contribution, state PT applicability and rounding must be verified before allowing live statutory computation.

### 8.5 Safe removal of any legacy manual statutory amount input

**[PROPOSED]** This is a deliberate **deprecation**, not a blind column deletion:

1. Inventory all frontend forms, API DTOs/validators, DB columns, imports/exports, reports, tests and seeded fixtures for EPF/ESI contribution **amount** or **percentage** inputs. Do not confuse `esi_enrolment` / `epf_enrolment` booleans with money inputs.
2. Identify and preserve historical values in existing records or audit/export history where they are needed for prior-period explanation. Do not rewrite or silently recompute past payments.
3. Hide or remove editable monetary/percentage controls, stop accepting new values through write APIs, and update any legacy import mapping to reject/warn rather than silently accept them.
4. Add published statutory-master rules and employee eligibility profiles before enabling replacement auto-calculation. Run old versus new values as a controlled comparison where data exists.
5. Deprecate legacy database columns only after proving no live reads/writes need them and after a documented migration/rollback plan. A schema deletion is **not required** merely to stop using a legacy field in new payroll calculations.
6. Verify tests for no user-supplied statutory rates, historical payslip preservation, zero/contribution-exemption rationale, and consistent web/Excel/PDF outputs.

**Current code finding:** The inspected `EmployeeMaster.jsx` and `PermanentPayStructure.jsx` use EPF/ESI enrolment flags and do not expose a dedicated ESI **amount** input. Recheck any other branch, legacy page or spreadsheet import before claiming a column actually exists.

---

## 9. Nonstatutory adjustments, advances and recoveries

### 9.1 Standard adjustment types

| Type | Nature | Example | Rule |
|---|---|---|---|
| Bonus / incentive | Earning | Approved discretionary bonus | Approval + reason required |
| Arrears | Earning or recovery | Approved past difference | Link to original period/run |
| Salary advance recovery | Deduction | Recovery of earlier advance | Must reference approved advance/outstanding ledger |
| Loan recovery | Deduction | Employee loan installment | Requires separate approved loan rule/source |
| Mobile bill | **Pending classification** | Sample puts it under deductions | Confirm deduction vs reimbursement/allowance |
| Other authorized deduction | Deduction | Approved employee-specific charge | Restricted codes, consent/legal basis as needed |
| Other authorized earning | Earning | Reimbursement or special allowance | Tax/statutory treatment must be classified |

**[CONFIRMED]** The example sheet contains `ADVANCE` and `MOBILE BILL` under deductions; it does not establish why they are deductions. **[DECISION REQUIRED]** Confirm mobile bill direction and recovery policy.

### 9.2 Adjustment controls

**[PROPOSED]** Each adjustment requires employee, run/period, reason code, signed monetary effect, explanation, creator, approval trail, attachment/reference **if required by policy**, and scheme/wage-basis classification. Amounts are decimal, not negative strings in a UI field.

- Advance balance may never be silently over-recovered; store original sanctioned amount, recovered amount and remaining balance.
- Exclude rejected/cancelled adjustments.
- Deduction codes must prevent unsafe combinations (e.g., already reduced unpaid day + second manual LOP for the same date).
- Do not allow payroll creators to alter statutory calculation results to balance a register.
- **[DECISION REQUIRED]** Negative net pay handling (block, zero-and-carry-forward, or sanctioned recovery limit) and employee consent/document requirements.

---

## 10. Calculation order and rounding

**[PROPOSED]** A deterministic calculation pipeline:

1. Freeze the employee list and historical assignments for the target dates.
2. Validate and snapshot Locked attendance or approved leave as applicable.
3. Resolve applicable salary/wage/pay-rule/calendar revisions by effective date.
4. Segment earnings at any applicable revision/category boundaries.
5. Calculate contractual base, worked-day wages, paid leaves/rest, OT, holiday and other approved earnings.
6. Identify unpaid days **once** and calculate absence/LOP once according to the chosen category policy.
7. Calculate approved earnings and nonstatutory deductions; classify taxable/qualifying wages.
8. Aggregate statutory wages/amounts for the relevant month and determine statutory deductions from the published master.
9. Calculate employee deductions; calculate employer contributions separately.
10. Calculate employee Net Pay; generate all line explanations, warnings and totals.
11. Reconcile line sums, rounding differences and previously withheld statutory amounts.
12. Store a complete **calculation preview** version. On final approval, revalidate and freeze the **Locked** snapshot atomically.

Recommended display equations (exact wage bases/deduction methods require sign-off):

```text
Payable gross = Sum of approved earnings lines
Employee deductions = Sum of approved deduction lines (including statutory employee shares)
Net payable = Payable gross - Employee deductions
Employer statutory cost = Sum of employer-side statutory contributions
Employer total payroll cost = Payable gross + Employer statutory cost + other employer costs
```

- Store rates, quantities and money as exact decimal values; no JavaScript binary-float arithmetic for money.
- **[DECISION REQUIRED]** Scheme-specific rounding precision (per day, per line, per employee, per month) and final payroll rupee rounding. Preserve exact intermediate context before applying the approved policy.
- The **Payroll Policy Master** is resolved and snapshotted separately from the **Statutory Deduction Master**. No generic `daily_salary` variable may be used interchangeably for LOP, join/exit proration, monthly run allocation and statutory wage bases.
- Sum **line-item amounts** and compare to saved totals; export must use saved amounts, not rerun formulas on the client.

---

## 11. Payroll sheet, employee-row states and approvals

### 11.1 Two levels: parent sheet vs employee approval unit

**[CONFIRMED]** A `payroll_run` / **payroll sheet** groups employee salary rows by pay group and date range. It is a *batch container* for printing, selection and reporting. It does **not** have a single all-or-nothing HO approval decision. **The employee row is the unit of review, final lock, financial snapshot and payment eligibility.**

Recommended parent-sheet states are **derived, not competing approval sources**: `DRAFT`, `SUBMITTED`, `IN_REVIEW`, `PARTIALLY_LOCKED`, `COMPLETE`, `CANCELLED_EMPTY` (the final two apply only if their respective conditions hold). Determine the status from row counts/allowed sheet operations. A sheet is `COMPLETE` only when all required employee rows have reached an approved terminal disposition; specifically, returned/pending rows must not be falsely marked complete.

| Employee-row state | Meaning | Who can act next |
|---|---|---|
| `DRAFT` | Calculation input/adjustments being prepared | FM for factory / Accounts for office |
| `CALCULATED` | Versioned preview ready for submission, with source and blocker diagnostics | Originating creator |
| `PENDING_ACCOUNTS_REVIEW` | FM submitted this factory row | Accounts: verify/forward or return |
| `RETURNED_TO_CREATOR` | Accounts or HO requests correction, with mandatory reason | Originating creator: correct/recalculate/resubmit |
| `PENDING_HO_APPROVAL` | Accounts cleared factory row; or Accounts submitted office row | HO/Admin: final approve-and-lock or return |
| `LOCKED` | Final immutable approved employee payroll result | Accounts payment route only; no edits |
| `CANCELLED_DRAFT` | Unapproved employee row withdrawn with audit | No payment or payroll coverage |

- The event log **must** identify who returned the row (`ACCOUNTS` vs `HO`) and preserve both the previous decision and the exact revision it concerned.
- Factory `RETURNED_TO_CREATOR` resubmission returns to `PENDING_ACCOUNTS_REVIEW`, including when the return came from HO. Office resubmission returns to `PENDING_HO_APPROVAL`.
- An Accounts `verify/forward` event is **not** HO approval. HO final approval and locking must be one atomic transition for the specific employee row.
- **[PROPOSED]** `ON_HOLD` is optional: add only if client confirms a meaningful paused-review business process; it cannot be a synonym for paid or locked. Rejection/void semantics for an entire employee entitlement also require policy sign-off.
- A batch action must report **per-employee success/failure**, not claim the entire parent sheet is locked because a subset passed.

### 11.2 Per-employee finalization transaction

For an individual employee salary row, in **one serialized database transaction**:

1. Verify current HO/Admin role, row state `PENDING_HO_APPROVAL`, correct actor separation, and factory Accounts-verification provenance where applicable.
2. Lock row/version and any relevant monthly statutory accumulator; revalidate its source snapshot, input freshness, and final policy/readiness blockers.
3. Reconcile that employee's saved earnings, deduction, employer-cost and net-pay lines, including statutory-month allocations and previously locked related rows.
4. Check global employee/date coverage conflicts, including cross-factory, cross-category and other-sheet conflicts; fail only this employee's finalization when coverage overlaps.
5. Persist immutable employee salary snapshot, calculation version, source/adjustment/statutory revision references and finalized coverage for the employee.
6. Set **this employee row only** to `LOCKED`; write HO/Admin approver, final timestamp and append-only action event.
7. Create or expose this employee's **payment eligibility** record, without marking it `PAID` or changing a bank balance. Recompute parent-sheet aggregate status.

Idempotent retries must return the existing locked result. Approval of another employee in the same sheet must never overwrite, unlock or change this one.

### 11.3 Independent returns and versioning

- Accounts can **return one factory employee row** with a reason, leaving every other salary row untouched.
- HO/Admin can **return one salary row** with a reason, leaving other Pending/Locked rows untouched.
- The creator may only edit **the returned, non-locked employee row**. Recalculate into a **new version**, retaining the entire submitted/returned lineage. Factory row must pass Accounts verification again; office row goes back to HO.
- An already `LOCKED` row **cannot** be returned, recalculated, deleted or altered—even by Admin. Errors discovered after locking use separate approved adjustments/arrears/reversals linked to the original.
- Changing a draft/run-wide setting after any row is locked must not silently recalculate already locked rows. Prefer freezing group, period and policy scope after initial submission; scope changes require a new sheet or a controlled migration/exception path.
- Accounts/HO bulk review can be provided as a UI convenience; **authorization, validation, audit and response status must remain per employee**.

### 11.4 Partial completion, reporting and statutory consistency

- The parent sheet may have, for example, `12 LOCKED`, `2 RETURNED`, `1 PENDING_HO_APPROVAL`; the locked 12 are payment-eligible without waiting for the remaining 3, subject to the separately approved payment schedule.
- Totals must be labelled **Submitted**, **Locked**, **Pending** and **Returned**; never present unapproved gross/net as approved liability. Financial exports and payouts use each employee's stored **locked amounts**.
- When employees are locked in different orders or multiple weekly/fortnightly sheets contribute to one statutory month, monthly EPF/ESI/PT accumulation must remain deterministic and avoid duplicate withholding. Lock/recalculate pending rows against the correct monthly state; do not retroactively mutate locked rows. A pending row with stale preview must be reverified before HO locking.
- **[DECISION REQUIRED]** Exact statutory-month close/reconciliation rules and whether partial sheet payment eligibility creates any disbursement scheduling restrictions.

## 12. Suggested database entities and core constraints

The table names below are **proposed design names**, not assertions that they already exist.

| Entity | Important fields / purpose |
|---|---|
| `payroll_groups` | Code; factory/department scope; default cycle; policy version; active flag |
| `payroll_work_calendars` + `payroll_calendar_days` | Site/group date type; scheduled/paid day; version; effective applicability |
| `payroll_statutory_rule_revisions` | Scheme, jurisdiction, effective dates, employee/employer rates, bases, caps, rounding, publication state |
| `payroll_professional_tax_slabs` | Parent revision, lower/upper thresholds, PT amount, period, state |
| `payroll_employee_statutory_profiles` | Employee effective-date applicability, identifiers, enrolment/status/exception rationale |
| `payroll_policy_master_revisions` | **New Admin Payroll Policy Master (§6.3)**: effective-dated policy scope, monthly entitlement method, `lop_method`/fixed divisor, **separate** partial-month proration, split allocation, full-unpaid treatment, leave day-count, published/audit metadata; nonoverlapping revisions |
| `payroll_salary_policy_revisions` | Existing **proposed** name for category-specific salary/stoppage/holiday policy; may be consolidated with `payroll_policy_master_revisions` during schema design. **Do not build two conflicting policy sources.** |
| `payroll_runs` | Sheet/container ID, code, group, inclusive dates, cycle, originating role/user, submission metadata, **derived aggregate review counts/status**, policy/group scope |
| `payroll_run_employees` | **Individual approval and finalization unit**: employee ID, period, historical group, row state, submitted version, Accounts reviewer, HO approver, return actor/reason, source references, gross/deductions/net, employer cost, locked snapshot/version |
| `payroll_earning_lines` | Employee result, earning code, quantity, rate, calculation basis, amount, source IDs/date segment |
| `payroll_deduction_lines` | Employee result, deduction code, amount, statutory revision or approved adjustment reference |
| `payroll_source_links` | Locked attendance sheet/row IDs, leave IDs, salary/wage/rule/calendar revision IDs and source hashes |
| `payroll_adjustments` + `payroll_recovery_ledger` | Approved bonus/recovery/arrears; original liability and amount left to recover |
| `payroll_statutory_month_ledgers` | Per employee, scheme, contribution month, total eligible wages, already withheld, employer share, source runs |
| `payroll_employee_month_entitlements` | Unique `(employee_id, salary_month)`: contractual full gross or dated segments, applicable Payroll Policy revision, total base allocation/LOP/paid-to-date and remaining entitlement across all runs; transactional reconciliation |
| `payroll_employee_coverage` | Employee, inclusive covered date range, **locked employee payroll row ID**, finalization/void status; unique/nonoverlap globally by employee |
| `payroll_action_history` | **Per-employee row** append-only transition/version history; actor, previous/new state, amounts/version hashes, return reason, timestamps; optional parent sheet events |
| `payroll_payments` | **Locked employee salary row** FK, scheduled vs paid amount, payment reference, date, payment/reconciliation status independent of approval |

### 12.1 Key invariants

- Employee cannot have overlapping **finalized** payroll coverage, regardless of group.
- All permanent employee LOP calculations must use a **published Payroll Policy Master revision**, currently `FIXED_DIVISOR=30`; proration, split allocation, and full-period unpaid rules are separately resolved and cannot silently inherit the LOP choice.
- Date-range uniqueness is insufficient for monthly-salaried employee payroll: enforce **per-employee/per-salary-month** entitlement reconciliation across disjoint pay runs.
- **Employee salary row** cannot be Locked without HO/Admin authorization and, for factory rows, an Accounts verification of the same submitted version; a whole parent sheet is not required to be Locked.
- A **Locked employee row**, its source and result snapshots, and its approval history cannot be updated/deleted through ordinary CRUD; all changes use a separate audited correction route. Pending/returned rows of the same sheet remain editable only under their respective state rules.
- Only published statutory master revisions can be used; conflicting published effective ranges for the same scheme/scope are invalid.
- Employee calculation lines must balance: `net = gross - employee_deductions` using the approved rounding scheme.
- Employer contributions are not inserted into employee deductions.
- A draft/run event cannot claim attendance `Locked` unless it actually is Locked and correctly scoped.
- Every payment must trace to an existing **Locked employee result**; payment status never mutates earnings totals. A `PARTIALLY_LOCKED` sheet can contain payment-eligible rows and unapproved rows at the same time.
- A **locked employee row's** source snapshot must remain readable even if Employee Master names, departments or rates change later; parent sheet status must derive from row states rather than a misleading all-or-nothing approval flag.

### 12.2 Security

**[PROPOSED]** Expose payroll operations through permission-checked server endpoints or controlled database RPCs; do not trust the browser's actor ID, employee set, statutory amounts, review status or total. Use the authenticated account's **current** role and factory scope. Apply least-privilege read permissions, avoid logging payslips/identifiers into diagnostics, and maintain access audits for payroll exports.

---

## 13. Salary register: improve the sample format

### 13.1 What the sample sheet actually shows

Reference sheet header: **S. N. POLYMERS PVT. LTD. — Salary for the month of APRIL'2026**.

Columns visible in the image:

1. **SL. NO**
2. **EMPLOYEE NAME**
3. **Staff Category**
4. **Basic Salary**
5. **STAFF WELFARE**
6. **GROSS SALARY**
7. **NO OF WORKING DAYS**
8. **NO OF SUNDAY**
9. **TOTAL DAYS**
10. **ABSENT**
11. **DEDUCTION — WITHOUT PAY**
12. **DEDUCTION — P. TAX**
13. **DEDUCTION — EPF @ 12%**
14. **DEDUCTION — ESI @ 0.75%**
15. **DEDUCTION — ADVANCE**
16. **DEDUCTION — MOBILE BILL**
17. **NET SALARY**

The illustrative rows show `HO Staff` and `26` working days + `4` Sundays = `30` total days. These cells **do not establish** an entitlement/proration formula or universal EPF/ESI rate.

### 13.2 Proposed payroll register sections

Instead of a single excessively wide hardcoded spreadsheet, the ERP should offer a screen with grouped headers and an export preserving all details:

| Group | Suggested columns | Notes |
|---|---|---|
| Identity | SL No, Employee Code, Employee Name, Category, Department/Factory | Stable historical identity, payroll run ID |
| Period | From, To, Payroll Cycle, Calendar Days, Scheduled Working Days, Paid Weekly-Off Days, Paid Holiday Days | Replace ambiguous `No of Sunday` with clear classification, optionally show Sunday count |
| Attendance | Present, Absent, Paid Leave, Unpaid Leave, Medical Leave, CO, Management Issue, Worked Hours, OT Hours, Single/Double Duty | Factory sourced from Locked sheets; nonfactory not fabricated |
| Fixed Earnings | Basic Salary, Staff Welfare, Other Fixed, Guaranteed Gross / Base Wage | Show only the columns relevant to category |
| Variable Earnings | Paid Leave/Off earnings where additional, OT Amount, Holiday Premium, Double Duty Premium, Other Earnings, Arrears | Prevent double counting |
| Gross | **Earned Gross** | Explicitly distinct from contractual monthly gross |
| Statutory Deductions | EPF Employee, ESI Employee, PT | Use rates/slabs from master; no literal `%` column header |
| Other Deductions | LOP/Unpaid Deduction, Advance Recovery, Mobile Bill (if approved), Other Deductions | Some categories use earned-days basis, so LOP shown as zero/included rather than deducted twice |
| Final | Total Deductions, **Net Pay**, Payment Status | Locked net is source of truth |
| Employer Liabilities | EPF Employer, ESI Employer, Other Statutory Cost | Separate summary/optional export columns; never net deductions |

**[PROPOSED]** Export presets: `HO/Projects Salary Register`, `Factory Permanent Salary Register`, `Casual Wages Register`, `Local Daily-Wage Register`, `Consolidated Payroll Summary`, `Statutory Summary`, and per-employee `Payslip`. Each export indicates date range, payment cycle, master revision/source status, generation timestamp and run ID.

### 13.3 Example — client-confirmed deduction rule, illustrative amounts

```text
Illustrative HO employee, April 2026
Contractual monthly gross:              ₹30,000.00 (illustrative)
Employee/pay period:                     01–30 April
Approved paid leave:                     2 days -> ₹0 deduction
Recorded chargeable unpaid/rejected:     2 days
Daily LOP rate:                         ₹30,000 / 30 = ₹1,000.00
LOP:                                    2 × ₹1,000 = ₹2,000.00
Earned gross after LOP:                 ₹28,000.00
EPF employee:                           [FROM STATUTORY MASTER]
ESI employee:                           [FROM STATUTORY MASTER]
Professional Tax:                       [FROM PT SLAB MASTER]
Advance recovery:                       [FROM APPROVED LEDGER]
Mobile bill:                            [ONLY IF APPROVED AS A DEDUCTION]
Net Pay:                                [CALCULATED AFTER DEDUCTIONS]
```

The **gross/30 and LOP formula are client confirmed**. Example employee, amounts and leave days are invented solely to demonstrate arithmetic; the final net needs real statutory and adjustment inputs.

---

## 14. Payroll UI and operational experience

### 14.1 Factory Manager screens

- **Factory Payroll Dashboard:** SNP/Fabric groups authorized to this FM; period selector; Locked attendance completeness; last submitted/returned runs.
- **Create Run:** factory, employment type, cycle, dates; show source readiness before Calculate.
- **Run Preview:** per-employee earnings/deductions, source revisions, totals, blockers and discrepancy explanations.
- **Returned Employee Rows:** per-person return reason and previous approved/submitted calculation version; edit/recompute/resubmit only returned rows without modifying already locked employees.
- **Submission Confirmation:** Submitted to Accounts, **not** yet approved, locked or paid.

### 14.2 Accounts screens

- **Incoming Factory Payroll Queue:** submitter, factory, group, dates, gross/net, exception counts, statutory ledger status; drill down to employee-level source evidence.
- **Verify Employee Row:** check Locked attendance, pay structure/rates, statutory master, advances and other deductions; individually return with a mandatory reason or clear/forward that employee row to HO. Batch UI must report each row result.
- **HO/Projects Run Creation:** same engine, but office pay/leave input; no fake attendance sheet.
- **Payments:** only after locking; import/post results, partial/unpaid/failed amounts, reconciliation references.

### 14.2a Admin — Payroll Policy Master (new)

- Show **Current Published Policies** by payroll group, method, fixed divisor, effective month and last Admin publisher; show **Draft revisions** separately.
- Fields: Monthly Entitlement (fixed agreed gross), LOP Method (`Fixed divisor` or `Actual calendar days`), Fixed Days (30 for current published permanent policy), Joining/Leaving Proration Method (**independent**), Split-Run Allocation Method, Full-Month Unpaid Treatment, No Sandwich flag, explicit weekly-off leave treatment, rounding mode, effective date, publication reason/reference.
- Before saving a draft, display a **comparison preview** for February and October with `₹30,000` gross and 2 LOP days; warn that selecting Actual Calendar Days would **change** current contractual policy.
- Publishing requires **Admin**, a justified future/effective date, nonoverlap check and an explicit acknowledgement that **previously locked payroll will not change**. A mid-month salary-method change should be blocked until a signed segmentation rule exists.
- Do not expose this master to Factory Manager or Accounts as an editable rate field; both can view the applicable revision and calculation explanation according to existing payroll-access scopes.

### 14.3 HO/Admin screens

- **Per-Employee Final Approval Queue:** Accounts-cleared factory employee rows and Accounts-created HO/Projects employee rows; grouped by sheet, with submitted vs locked totals, individual variance, policy blockers and reviewer identity.
- **Approve + Lock Employee:** one explicit action per salary row, with immutable snapshot, employee-level coverage and audit event; other rows in the sheet remain independent.
- **Return Employee Row:** reason mandatory; route only that employee's version for correction; do not undo other employees' locked results.
- **Statutory Master:** publish and supersede effective revisions with full change review.

### 14.4 Auditability and explanation

On any employee line, provide a **Calculation Explanation**:

```text
Date / date segment → attendance or leave source
Pay component / wage source revision → eligible quantity × rate
Applicable salary/wage/calendar/statutory revision → formula and rounding
Employee statutory deduction → monthly accumulation and adjustment rationale
Approved adjustment → authorizer and remaining recovery balance
Gross → deductions → net, with exact saved amounts
```

No user should need to reverse-engineer a spreadsheet formula to understand the result.

---

## 15. Payment and reconciliation (distinct from payroll approval)

**[CONFIRMED DESIGN DIRECTION]** A payroll becoming `LOCKED` means salary amounts are finalized, **not** that employees have been paid.

**[PROPOSED]** Use separate states on payment records:

`NOT_SCHEDULED → SCHEDULED → PARTIALLY_PAID / PAID → RECONCILED`, with `FAILED` and controlled retry paths.

- Payment file/bank-reference numbers, actual payment date, paid amount and reconciliation evidence are separate from calculated net.
- Partial payment never edits net salary; unpaid balance = locked amount less confirmed payments.
- Prevent overpayment, double import and repeated bank-reference application through idempotency constraints.
- **[DECISION REQUIRED]** Cash vs bank transfers, beneficiary/bank collection, authorized cash receipt proof, bank export template and accounting posting integration.

---

## 16. Exceptions and edge cases

| Situation | Expected handling |
|---|---|
| Missing/unlocked factory sheet | Block finalization; list exact date/group |
| Pending leave overlapping run | Block or explicit approved exception, never assume Paid |
| Historical employee now Exited | Include earned historical amounts if eligible; use effective employment dates |
| Salary/wage revision midperiod | Segment and use effective revision; snapshot every segment |
| Statutory revision midperiod | Apply scheme-defined effective/contribution rules, then reconcile statutory month |
| Two fortnightly runs in one month | Prevent overlapping days and duplicate monthly PT collection |
| Factory Local worker moved between factories | Preserve dated membership and prevent employee-day double coverage |
| Legacy Local sheet with null department | Preserve its rows; show unresolved factory identity; no automatic reassignment |
| HO/Projects has no attendance | Use approved salary/leave policy, never infer Present/Absent |
| Manual recovery exceeds balance | Reject or require separately approved credit; no silent negative ledger |
| Employee net becomes negative | Follow expressly approved policy; no hidden net floor |
| Holiday on an absent/leave day | Use calendar/leave entitlement rule; no unconditional holiday premium |
| Approved 24h duty followed by CO | Accept only with qualifying Locked prior-day attendance; avoid a second wage bonus unless approved |
| Returned employee payroll row after changing source data | Recalculate a new version of that employee only, preserve previous submission and reviewers; leave other locked employees unchanged |
| Locked employee salary row later discovered wrong | Audited arrear/recovery/reversal; never mutate that employee's locked snapshot or other finalized rows |
| Simultaneous HO final approvals | Serialize per employee/statutory month, idempotent; only one final record and one coverage set per employee-date range |
| Master rate changed retroactively | Block/flag impacts and require managed recomputation for only unfinalized runs; locked unchanged |
| Employee has no EPF/ESI liability | Record exemption/nonapplicability reason; do not assume missing config is zero |
| Role/factory access changes during review | Re-check **current** role/factory scope at action time |

---

## 17. Acceptance tests (must pass before rollout)

### 17.1 Workflow and authorization

- **PAY-001** FM can create SNP and Fabric payroll only for assigned factory scopes; cannot create HO/Projects.
- **PAY-002** Accounts cannot directly modify FM-submitted financial figures; can return or verify/forward **each employee row** independently, with mandatory return reason.
- **PAY-003** HO/Admin can approve and atomically lock **an individually ready, correctly reviewed employee row** without waiting for other sheet rows.
- **PAY-004** Each Accounts-created HO/Projects employee salary row requires independent HO/Admin final approval.
- **PAY-005** Locked employee results, rate references, lines and source snapshots reject direct update/delete.
- **PAY-031 [CONFIRMED]** Accounts/HO return one employee salary row without editing, invalidating, delaying or unlocking other rows; independently locked rows remain immutable.
- **PAY-032** Payroll approval never posts bank deductions or marks wages Paid; payment/reconciliation is separately authorized.
- **PAY-033** Rejected leave is deducted only where a recorded leave date is chargeable; absent/missing data creates no automatic LOP; approved paid leave costs zero LOP.
- **PAY-034** Holiday total-pay 1.5× never becomes 2.5× via a duplicated base earning.
- **PAY-035** In one sheet, Accounts forwards A, returns B, and leaves C pending; HO can lock A without changing B or C; the sheet shows `PARTIALLY_LOCKED` accurately.
- **PAY-036** HO returns a factory row, FM resubmits only it, and the revised row must pass Accounts again before final HO approval; prior versions remain auditable.
- **PAY-037** A batch approval with one employee blocked by stale statutory data cannot claim that blocked row as locked; each affected row reports an independent result.
- **PAY-038** Concurrent locking of overlapping dates for one employee in separate sheets cannot duplicate coverage; another employee in either sheet may still lock.
- **PAY-039** Payment/reconciliation can reference a locked row in an otherwise incomplete sheet, but cannot pay pending or returned employee rows.
- **PAY-040** A later employee-row approval updates statutory monthly accumulation without altering existing locked salary/statutory snapshots; it checks applicable monthly ledgers before locking.

### 17.2 Period integrity

- **PAY-006** Two nonoverlapping runs for the same employee are permitted.
- **PAY-007** Different pay groups cannot finalize overlapping dates for the same employee.
- **PAY-008** Parallel approval requests cannot create duplicate coverage or payment queue entries.
- **PAY-009** Changing employee category/factory after an earlier run does not bypass coverage.
- **PAY-010** Weekly/fortnightly/monthly/custom date ranges are handled consistently; no UTC off-by-one errors.

### 17.3 Attendance and earnings

- **PAY-011** Missing Locked attendance blocks relevant factory payroll with precise dates.
- **PAY-012** Casual present/absent/paid/unpaid leave and OT follow effective wage/rule revisions.
- **PAY-013** Local Double Duty pays configured multiplier and **zero OT**.
- **PAY-014** SNP and Fabric Local workers remain distinct rosters with shared Local policy and no duplicate employee-day.
- **PAY-015** All permanent groups compute documented unpaid/rejected LOP from gross / 30; Paid leave is zero LOP; 28/29/31-day full months still get full contractual gross; partial-month policy is checked before deployment.
- **PAY-016** A period spanning pay revisions calculates correct date segments.
- **PAY-017** `Absent` count and `Without Pay` amount do not deduct the same unpaid day twice.
- **PAY-018** Paid holidays, CO and management stoppage use documented rules, never guesses.

### 17.4 Statutory and adjustments

- **PAY-019** Statutory contributions derive solely from the applicable **published master**, not UI-supplied rates.
- **PAY-020** Employee and employer EPF/ESI are distinct and correctly shown.
- **PAY-021** PT slabs and contribution-month aggregation avoid repeat deduction in two fortnightly runs.
- **PAY-022** An effective statutory revision is replayed correctly for its legally applicable period; locked results unchanged.
- **PAY-023** A manual advance deduction references a balance and cannot recover more than allowed.
- **PAY-024** Negative-net behavior matches approved policy; other adjustments are auditable.

### 17.5 Audit, exports, payment

- **PAY-025** Exported register and payslip match exact locked line amounts, not recalculated UI totals.
- **PAY-026** Historical source names, values and pay revisions remain explainable after later edits.
- **PAY-027** Payment status for each **Locked employee row** can move independently of salary approval status without changing net or marking unapproved rows Paid.
- **PAY-028** Failed/retried payment imports never double record amounts.
- **PAY-029** Returned/resubmitted **employee rows** preserve all prior submitted calculation versions, Accounts/HO decisions, remarks and actors.
- **PAY-030** Legacy manual statutory amount/percentage fields cannot influence new payroll, while older records remain reviewable after the deprecation.

---

## 18. Implementation phases (suggested)

| Phase | Deliverables | Exit condition |
|---|---|---|
| **P1 — Policy & foundation** | Sign-off decision register; payroll groups; effective-date/assignment history; calendar; pay-source applicability; draft run schema; actor/factory scopes | Can list complete eligible employees and pay sources for any supported period |
| **P2 — Factory payroll calculation** | Readiness gates; permanent/casual/local calculators; source links, numeric precision; employee-level preview; duplicate coverage checking | Reproducible SNP/Fabric payroll previews backed by Locked attendance |
| **P3 — Statutory & adjustment master** | EPF/ESI effective master; PT slabs; employee statutory profiles; statutory month ledger; recovery ledger; controlled adjustments | Calculations produce independently verifiable gross/net/employer liability |
| **P4 — Approval & locking** | **Per-employee** FM → Accounts → HO/Admin or Accounts → HO/Admin; independent return/resubmit, row versions, immutable employee locking and overlap exclusion, parent aggregate states | Strict maker-checker; locking one employee leaves other employee states unchanged |
| **P5 — Payroll UX & exports** | Role-specific dashboards, salary register, departmental reports, payslips, breakdown tooltips, diffs | Register matches approved sample vocabulary while presenting correct modern data |
| **P6 — Payment/reconciliation** | Payment queue, payment events, partial/failed statuses, matching/export; accounting integration if approved | Accounts can trace locked net to actual amount paid |
| **P7 — Compliance & rollout** | Legal checks, sample-month parallel run, migration/backfill, exception handling, training, UAT | Signed sample reconciliations; authorization, regulatory and audit tests pass |

**[PROPOSED]** Begin P1 before payroll engine coding. The **gross/30**, **no-sandwich**, **holiday total multiplier**, **Special package total**, **Admin master ownership**, and **per-employee review/locking** choices are now established. Finalizing affected live calculations still requires the remaining **partial-month day counts, explicit weekly-off examples, other wage treatments and statutory** policies.

---

## 19. Open decisions requiring client confirmation

| ID | Decision | Why it matters | Suggested default pending approval |
|---|---|---|---|
| **D01** | **RESOLVED LOP DEFAULT**: all permanent LOP uses **published Fixed ÷30**. **OPEN JOIN/EXIT**: original gross/30 per-day instruction versus proposed **actual calendar-day** partial-month calculation; settle eligible date count and holiday handling | Do not conflate LOP and joining/leaving salary | Keep Fixed30 LOP; proration method `UNRESOLVED` until explicit sign-off |
| **D02** | **PARTIALLY RESOLVED**: No sandwich policy; define calendar weekend/holiday handling when a day falls **inside an explicitly requested leave range** | Precise deductible-day counting | No automatic bridging; use explicit dated entitlement |
| **D03** | Factory closed/holiday dates: paid, unpaid or premium? | Completeness and holiday pay | Versioned work calendar |
| **D04** | **RESOLVED FOR INPUT SOURCE**: No inferred HO/Projects absence; require documented leave/authorized evidence. Remaining: leave finalization cutoff. | No fictitious payroll deductions | Pending unresolved decisions block locking |
| **D05** | **RESOLVED**: Holiday multiplier is **total** day compensation; 1.5× means 1× base + 0.5× extra where base is already included. | Prevent double payment | Apply configured master multiplier |
| **D06** | Pay treatment of `Management Issue`/short hours | Existing rule text is descriptive, not executable | Structured policy code with approval |
| **D07** | **PARTIALLY RESOLVED**: Special package = contracted total amount, optionally split into salary components. Confirm coverage period and statutory component classifications. | Salary reconciliation and wage basis | Preserve same contracted total regardless of display breakdown |
| **D08** | EPF/ESI/PT eligibility, contribution bases, ceilings, rounding, state and effective rules | Legal correctness | Reviewed statutory master; no hardcoded rates |
| **D09** | Statutory deductions across fortnightly runs | Prevent double PT/incorrect monthly aggregation | Monthly statutory ledger |
| **D10** | Mobile bill: employee recovery or reimbursement? | Sample places it under deductions | Exclude until confirmed |
| **D11** | **RESOLVED ARCHITECTURE**: Separate auditable adjustment/recovery ledger. Remaining: permitted limits/approval per recovery type. | Prevent double/unauthorized deductions | Approved recovery ledger |
| **D12** | Can factory managers view permanent employees' salaries? Which factory scopes? | Privacy and authorization | Least privilege; explicit mapping |
| **D13** | Nonfactory Accounts-generated payroll peer review required? | Segregation of duties | Accounts creator → HO/Admin approver |
| **D14** | Treatment of negative net, zero-pay periods and off-cycle corrections | Payment safety | Block until approved rule |
| **D15** | **RESOLVED**: Requisition-style **per-employee Accounts/HO review and HO final locking** in a batch payroll sheet. Remaining: bank/cash settlement mechanics. | Independent salary rows; parent is not an approval unit | Separate payroll tables, employee row snapshots, audit and payment; no automatic bank debit on approval |
| **D16** | Maximum period length, payroll closing timetable, late leave decisions and holidays | Scheduling and historical corrections | Configurable per group |
| **D17** | Legacy Local null-department attribution when reporting by factory | Avoid false historical cost attribution | Preserve as `Legacy/Unallocated` until formally resolved |
| **D18** | Employee effective exit/transfer/salary-effective dates | Historical calculation correctness | Add explicit effective-dated source history |
| **D19** | **RESOLVED ACTOR**: Admin owns statutory master creation/edit/publication. Any additional separate review gate remains unconfirmed. | Payroll integrity | Admin-only, audited and effective-dated |
| **D21** | **RESOLVED ARCHITECTURE**: introduce **Admin Payroll Policy Master**; current Fixed ÷30 LOP, optional actual-calendar LOP future configuration, published effective-dated revisions | Flexible policies without backdating a locked payroll | Admin-only draft/publish; no fallback or in-place edits of published revisions |
| **D22** | **OPEN**: approve month allocation method for 2+ runs (proposed calendar-weighted plus final residual), including whether permanent groups use split pay at all | Fixed-month entitlement must not be over/underpaid | Keep split permanent finalization blocked until signed method |
| **D23** | **OPEN**: full-month unpaid treatment and paid weekly-off entitlement, especially 28/29/31-day months | Fixed 30 may leave positive residual or create negative gross | Block affected result until explicit, legally reviewed treatment |
| **D24** | **OPEN**: adopt actual calendar days for join/exit proration instead of originally communicated gross/30 method? | Policy choice changes employee pay | Offer as independent configurable option; not active without sign-off |
| **D20** | Payslip format, optional bank details, secrecy/retention/access policy | HR privacy and client compliance | Role-limited, immutable saved reports |

---

## 20. Traceability and sign-off

### Confirmed client direction carried into this draft

1. Payroll can use Monthly, Fortnightly, Weekly or Custom date ranges.
2. SNP Factory and Fabric Factory payrolls are prepared by **Factory Manager**, submitted to **Accounts**, then **HO/Admin** grants final approval and lock.
3. HO and Projects payrolls are generated by **Accounts** (independent HO/Admin final approval is proposed, not separately reconfirmed for nonfactory groups).
4. ESI/EPF rates and PT schedules come from the **new centrally adjustable statutory master**; Employee Management is not the source of contribution amounts or percentage rates.
5. Locked historical payroll remains immutable; overlapping finalized employee payroll periods are prohibited.
6. The provided April 2026 salary sheet is a **format example**, not a binding rates/days/calculation table.
7. All permanent groups use **monthly gross / 30** for each recorded unpaid/HO-rejected deductible leave day; approved Paid leave is non-deductible; no sandwich policy.
8. Holiday 1.5× is **total daily pay**, not 1.5× additional compensation over an included base.
9. `Special package` is agreed total compensation, one line or broken into components; Admin owns published statutory rules; adjustments use an auditable separate ledger.
10. **[CONFIRMED SYSTEM DESIGN]** Admin owns a separate **effective-dated Payroll Policy Master** with **Fixed30 currently active for permanent LOP** and Actual Calendar Days supported as a **future optional** LOP method; joining/leaving proration and month allocation are independent, pending client confirmation.
10. Existing Accounts requisition approval provides a design reference; **per-employee row review, return, HO/Admin final locking and independent payment status are confirmed**. Parent payroll sheet only groups the rows and summarizes their progress.

### Related existing ERP business references

- `SN_Polymers_Factory_Attendance_Leave_Business_Rules_Workflow_Final.md`
- `documentation/SN_Polymers_Employee_Category_Factory_Rosters.md`
- `shared/hrEmployeeCategories.json`
- `backend/src/domain/hrEmployeeCategories.js`
- `backend/src/db/migrations/096_hr_factory_wage_and_attendance_rules.sql`
- `backend/src/db/migrations/097_hr_attendance_leave_foundation.sql`
- `backend/src/db/migrations/100_hr_factory_manager_self_service_leave.sql`
- `backend/src/db/migrations/101_hr_leave_attendance_integrity.sql`
- `backend/src/db/migrations/102_hr_category_department_factory_rosters.sql`
- `backend/src/db/migrations/103_hr_retired_projects_category_guard.sql`

These references are the current HR/attendance context as inspected on the `employee_management` branch at commit `a6d06bf91a0574ae0065634c5dfd2e239d8a152c`. They do **not** imply that the proposed payroll tables, calculations or statutory master already exist.

### Approval record (to complete)

| Review role | Name | Date | Decision/comments |
|---|---|---|---|
| S. N. Polymers HR/business owner | | | |
| Factory operations | | | |
| Accounts | | | |
| HO/Management | | | |
| Statutory compliance / payroll advisor | | | |
| ERP implementation owner | | | |

**Implementation gate:** Do not activate payroll lock/payment for live employees until unresolved rules affecting the employee, period, wages or applicable statutory jurisdiction are resolved and documented with an effective date.

---

## 21. Pre-implementation edge-case dry run — purpose, scope and evidence

**Status:** Scenario simulation executed; no payroll implementation claimed.  
**Reference model:** `payroll_edge_case_dry_run.py` in the analysis bundle.  
**Detailed machine-readable output:** `payroll_edge_case_dry_run_results.json`.  
**Human-readable results:** `payroll_edge_case_dry_run_report.md`.  
**Source rules:** Sections 1–20 of this document, the confirmed client choices above, the existing factory attendance/leave rules, the employee categories/rosters contract and the Accounts requisition workflow.

### 21.1 What was actually executed

A local deterministic Python model used `decimal.Decimal`, explicit inclusive dates, synthetic payroll rows, creator/reviewer transitions, overlap checks, separate payment events, and synthetic monthly statutory withholding. It **asserted** policy arithmetic and the guard behavior we want implemented. It did **not** import or execute the application JavaScript, connect to Supabase/PostgreSQL, change any payroll table, use real employee data, validate current statutes, simulate real concurrent database transactions, or call a bank. Treat a `PASS_REFERENCE` as a **target for implementation tests**, not as an ERP bug fix or evidence of production safety.

**Executed checks:**

| Measure | Observed outcome |
|---|---:|
| Named scenario cases | **75** |
| Reference-model assertions / guard scenarios passed | **57** |
| Counterexamples to incomplete monthly pay policy | **5** |
| Cases with missing business/legal policy | **12** |
| Case requiring application-level separation verification | **1** |
| Model assertion failures after fixing the test harness | **0** |
| Inclusive interval-pair combinations checked | **44,100** |
| Months tested for day length (years 2026 and leap 2028) | **24** |
| Synthetic statutory posting/retry events checked | **110** |

These numbers count test-model behaviors, **not real implemented ERP safeguards**. The synthetic professional-tax amount in the tests is intentionally arbitrary; it is not a statutory rate assertion.

### 21.2 Severity and result interpretation

- **Critical:** May overpay/underpay an employee, duplicate a finalized liability, break a permission boundary, or alter historical payroll. Block the affected approval/payment path until fixed or its business policy is resolved.
- **High:** Incorrect breakdown, reporting, month close, deduction, or correction behavior that must be implemented and tested before rollout of the relevant feature.
- `PASS_REFERENCE`: expected behavior asserted in the simulator only.
- `COUNTEREXAMPLE_POLICY`: arithmetic of a currently confirmed input rule exposes an **unresolved edge case**, not a bug in already-written payroll code.
- `POLICY_REQUIRED`: ask the client or payroll/compliance advisor; no hidden default should be coded.
- `IMPLEMENTATION_VERIFICATION`: cannot establish from a stand-alone model; requires an integration check against the Accounts/Payroll boundaries.

## 22. Five high-impact arithmetic counterexamples (client confirmation required)

### 22.1 Full-month unpaid absence with a 30-day divisor (SIM-008–010)

Client-confirmed deduction **per chargeable leave day** is `monthly_gross / 30`. For a fictitious ₹30,000 monthly gross, a literal deduction yields:

| Month | Calendar days | Entire month marked unpaid | Literal deduction | Gross remaining |
|---|---:|---:|---:|---:|
| February 2026 | 28 | 28 days | ₹28,000 | **₹2,000** |
| February 2028 | 29 | 29 days | ₹29,000 | **₹1,000** |
| October 2026 | 31 | 31 days | ₹31,000 | **−₹1,000** |

**[DECISION REQUIRED, CRITICAL]** Must a worker with **no payable days** in a month receive ₹0? How should the 30-day method be normalized or capped for 28/29/31-day months, without contradicting the client-approved Gross ÷ 30 daily deduction? **No automatic clamp or reinterpretation is approved.** Keep row in `CALCULATION_BLOCKED_POLICY`/equivalent until signed policy for that exceptional case; never approve a negative gross or pay unexplained residual salary. **[v1.4]** The new `Payroll Policy Master.full_month_unpaid_treatment` records the eventual decision; switching to the optional actual-days LOP method for that employee without approval is **not** the exception handler.

### 22.2 Splitting a monthly salary into custom/fortnightly runs (SIM-016–017)

For the **same full-month** ₹30,000 contract, using `₹1,000 × calendar days` as a separate earnings formula for each run gives:

| Month | Example segments | Naive sum across runs | Contractual monthly gross | Difference |
|---|---|---:|---:|---:|
| October (31 days) | 01–15 + 16–31 | ₹31,000 | ₹30,000 | **₹1,000 overpaid** |
| February (28 days) | 01–14 + 15–28 | ₹28,000 | ₹30,000 | **₹2,000 underpaid** |

**[DECISION REQUIRED, CRITICAL]** Gross ÷ 30 is confirmed for **loss-of-pay deductions**, but its use as an **earnings allocation** for two nonoverlapping salary runs is not sufficient. Define a month-level contractual salary allocation ledger, including full-month guarantee, leave deduction, join/exit, cross-run residual allocation and whether permanent staff can actually be paid fortnightly. Employee-date overlap checks **do not** detect these nonoverlapping 28/31-day errors. Until resolved, permit previews but **block locking affected split fixed-month salary runs**. **[v1.4 proposed method]** Calendar-day-weighted allocation with a final rounding residual (see §6.3.4) is a candidate only; it does **not** change the approved Fixed30 LOP divisor.

### 22.3 Partial-month join/exit and salary revisions (SIM-018–020)

`2026-10-16..2026-10-31` is **16 calendar dates**. `16 × ₹30,000 / 30 = ₹16,000` is only an illustrative computation; it may not be the approved proration numerator, especially with unpaid leave and an employee whose basic/pay structure changes midmonth. Likewise, Oct 1–15 ₹30k and Oct 16–30 ₹33k yields ₹31,500 under a purely date-split 30-day computation, but its relationship to a full-month contractual guarantee is not resolved.

**[DECISION REQUIRED, CRITICAL]** Define the joining date inclusive/exclusive rule, exit date, pay-structure effective date, break in service, eligible nonworking days and revision reconciliation to a monthly total. Do not backfill an unknown exit date or silently use the latest salary for earlier days. **[v1.4 clarification]** The client's earlier gross/30 partial-month direction and the new recommended Actual Calendar Days proration are **alternative policies** requiring a business decision; the new configurable master must not silently select the latter.

### 22.4 No sandwich vs an explicitly continuous leave request (SIM-006–007)

The reference model correctly avoids *automatically adding* Saturday/Sunday between leave separately recorded on Friday and Monday. But a single request explicitly entered as **Friday 09 Oct–Monday 12 Oct** covers four calendar dates, including Saturday 10 and Sunday 11. “No sandwich policy” alone does **not** specify whether those dates *within* the explicit request are chargeable leave days.

**[DECISION REQUIRED, CRITICAL]** Confirm with one signed Friday–Monday example whether weekly offs inside a date-range request are payable or deductible; if treatment depends on employee work calendar, define the authoritative calendar. In any case, do not create inferred leave dates outside the submitted request or approved absence evidence.

### 22.5 Rounding boundary (SIM-013)

Gross ₹30,001 ÷ 30 = ₹1,000.033333…; 2 LOP days:

- Round daily rate to two decimals first: `₹1,000.03 × 2 = ₹2,000.06`.
- Multiply precise daily rate first, then round: `₹30,001 / 30 × 2 → ₹2,000.07`.

**[DECISION REQUIRED, HIGH]** Agree where employee salary calculations round (per day, pay component, employee, month), and separately validate EPF/ESI/PT statutory rounding. Use decimal/NUMERIC arithmetic, not binary floating point or UI-generated totals.

## 23. Test matrix — every dry-run case and required guard

The following 75 rows constitute **implementation acceptance-test requirements**. They are not statements that the current ERP payroll passes them.

| Test | Risk | Scenario | Simulated outcome | Implementation guard / missing rule |
|---|---|---|---|---|
| SIM-001 | Critical | 2 unpaid days at gross 30000 | PASS_REFERENCE | Apply gross/30 exactly; net gross=28000 |
| SIM-002 | High | 2 paid + 2 unpaid days | PASS_REFERENCE | Only unpaid two days deducted |
| SIM-003 | High | Rejected leave + absence refer to same date | PASS_REFERENCE | Use date-set union; deduct once |
| SIM-004 | High | Unrecorded office absence | PASS_REFERENCE | No evidence => zero automatically deducted |
| SIM-005 | Critical | Pending leave at finalization | PASS_REFERENCE | Block; must receive final disposition |
| SIM-006 | High | No sandwich: Fri/Mon explicitly recorded | PASS_REFERENCE | Do not automatically insert Sat/Sun |
| SIM-007 | Critical | Explicit Fri-Mon date range includes Sunday | POLICY_REQUIRED | Client must define chargeable dates WITHIN requested range |
| SIM-008 | Critical | Full February 2026 unpaid, 28 days | COUNTEREXAMPLE_POLICY | Client must define full-month unpaid normalization; literal formula leaves payable 2/30 gross |
| SIM-009 | Critical | Full October 2026 unpaid, 31 days | COUNTEREXAMPLE_POLICY | Client must define cap/full-month handling; literal formula gives negative gross |
| SIM-010 | High | February 2028 leap-year full month unpaid | COUNTEREXAMPLE_POLICY | Literal 29 days gives 1/30 gross; full-month policy required |
| SIM-011 | Critical | Repeated overlapping leave submissions | PASS_REFERENCE | Count distinct employee dates once, reject active overlaps |
| SIM-012 | High | Leave crosses month boundary | PASS_REFERENCE | Allocate dates to their month and respective gross/revision |
| SIM-013 | High | Daily rate rounding vs total rounding | POLICY_REQUIRED | Define one explicit rounding point; outcomes can differ |
| SIM-014 | High | Gross=0 and 4 unpaid days | PASS_REFERENCE | Zero deductions; no divide-by-gross errors |
| SIM-015 | Critical | HO-rejected leave changed to paid after payroll lock | PASS_REFERENCE | Historical row cannot mutate; create new adjustment |
| SIM-016 | Critical | 31-day month split into two disjoint runs | COUNTEREXAMPLE_POLICY | Naive 15/30 + 16/30 overpays gross; needs monthly allocation rule |
| SIM-017 | Critical | 28-day month split into two disjoint runs | COUNTEREXAMPLE_POLICY | Naive 14/30 + 14/30 underpays full monthly gross |
| SIM-018 | Critical | Employee joins 16 Oct; payable fraction ambiguous | POLICY_REQUIRED | Numerator for gross/30 needs client definition (calendar/service/working) |
| SIM-019 | Critical | Employee exits 10 February; 10 calendar days worked | POLICY_REQUIRED | Need normalized join/exit policy and exact effective exit date |
| SIM-020 | High | Salary revision on 16th | POLICY_REQUIRED | Date segments must use their own effective revision; not present-day salary |
| SIM-021 | Critical | Special package components 22000+6000+3000 exceed total 30000 | PASS_REFERENCE | Block or explicitly classify a reconciling component |
| SIM-022 | High | Special package 30000 with single line | PASS_REFERENCE | Single line and matching breakdown are alternative representations, not additive |
| SIM-023 | Critical | Employee changes factory midperiod | POLICY_REQUIRED | Date-segment assignment and preserve unique employee-day payroll coverage |
| SIM-024 | High | Employee left company but has historical wages | PASS_REFERENCE | Current inactive status must not erase previously earned pay |
| SIM-025 | High | Casual ₹400/day, 10h on 8h standard, ₹50 OT | PASS_REFERENCE | Base 400 + 2*50 = 500; no gross leave double deduction |
| SIM-026 | Critical | Local double duty ₹350 x2, 24h elapsed | PASS_REFERENCE | ₹700 base, ₹0 OT regardless of 12h overage |
| SIM-027 | High | Local absent day | PASS_REFERENCE | Earned-days model pays 0, no additional absence subtraction |
| SIM-028 | Critical | 1.5x holiday on ₹400 daily base already paid | PASS_REFERENCE | Add 0.5x premium; total 600, not 1000 |
| SIM-029 | High | 1.5x holiday base NOT already included | PASS_REFERENCE | Pay total 1.5x once; no extra full multiplier |
| SIM-030 | Critical | Local holiday premium attempted | PASS_REFERENCE | No holiday premium eligible for Local category |
| SIM-031 | High | Unpaid Local leave on working date | PASS_REFERENCE | Base earned=0, no paid leave or extra loss-of-pay debit |
| SIM-032 | High | Unapproved CO after a 24h day not yet locked | PASS_REFERENCE | Disallow CO payment eligibility until previous sheet Locked and >=24 stored hours |
| SIM-033 | High | Approved 24-hour duty then next-day CO | PASS_REFERENCE | 24h actual, 16h OT at 8h standard, CO no second base bonus |
| SIM-034 | Critical | Overnight duty crosses payroll month | POLICY_REQUIRED | Attribute actual+OT once to approved attendance start date; check end/cross-period policy |
| SIM-035 | Critical | Missing day sheet / Submitted not Locked | PASS_REFERENCE | Block only employee rows dependent on missing or unlocked attendance |
| SIM-036 | High | Management Issue / short-hours free-text only | POLICY_REQUIRED | Require structured payable-day treatment not inferred from prose |
| SIM-037 | High | Fabric Casual changes from 400 to 450 on 16th | PASS_REFERENCE | Per-date effective-dated wage revision yields 850 over two worked days |
| SIM-038 | High | Legacy combined Local sheet factory=null | POLICY_REQUIRED | Do not fabricate which factory owns historical costs |
| SIM-039 | Critical | Employee attendance on two factory rosters same day | PASS_REFERENCE | Require unique employee-day across rosters |
| SIM-040 | High | Factory standard 8h, exit earlier than entry | PASS_REFERENCE | Normalize to explicit next-day timestamp; reject ambiguous 0/negative duration |
| SIM-041 | High | Rejected leave but attendance row says Paid Leave | PASS_REFERENCE | Block pay computation; reconciliation required |
| SIM-042 | Critical | Factory FM tries another factory | PASS_REFERENCE | Scope check prevents SNP FM creating Fabric payroll |
| SIM-043 | High | FM tries HO/Projects payroll | PASS_REFERENCE | Only Accounts/Admin may create nonfactory |
| SIM-044 | Critical | FM tries final HO lock | PASS_REFERENCE | Must be HO/Admin after Accounts review |
| SIM-045 | Critical | Factory payroll bypasses Accounts review | PASS_REFERENCE | HO lock blocked while pending Accounts review |
| SIM-046 | High | Accounts returns one salary row | PASS_REFERENCE | Only target row returned; sibling unaffected |
| SIM-047 | Critical | Return without reason | PASS_REFERENCE | Mandatory notes for return actions |
| SIM-048 | Critical | FM edits Accounts-cleared row | PASS_REFERENCE | No mutation after forwarded review |
| SIM-049 | Critical | Returned row resubmitted stale clearance | PASS_REFERENCE | Accounts must reverify revised version |
| SIM-050 | Critical | Lock one employee while sibling returned | PASS_REFERENCE | One locked row unaffected by returned sibling |
| SIM-051 | Critical | Overlap different payroll groups and disjoint run IDs | PASS_REFERENCE | Employee-date exclusion checks employee ID, not payroll group |
| SIM-052 | High | Adjacent periods 1-15 and 16-31 | PASS_REFERENCE | Inclusive ranges can touch without overlap; month allocation still open |
| SIM-053 | Critical | Concurrent HO requests for same salary row | PASS_REFERENCE | Only one successful lock; duplicate/retry does not create second coverage |
| SIM-054 | Critical | Stale leave/salary/attendance changed after review | PASS_REFERENCE | Version/source-fingerprint mismatch blocks lock |
| SIM-055 | Critical | Admin attempts edit finalized row | PASS_REFERENCE | Financial lock immutable, including Admin |
| SIM-056 | High | Accounts-created HO row skips redundant Accounts approval | PASS_REFERENCE | Accounts submit -> HO lock permitted; separate maker-checker |
| SIM-057 | Critical | HO tries to approve own payroll row created by same actor | PASS_REFERENCE | No self-approval / role check |
| SIM-058 | High | Bulk HO action half succeeds | PASS_REFERENCE | Return a per-employee success/failure result; do not report entire sheet success |
| SIM-059 | High | Invalid period from after to | PASS_REFERENCE | Reject before calculating days |
| SIM-060 | High | Employee moved from legacy Projects bucket to JE | PASS_REFERENCE | Stable employee ID preserves coverage; category rename not reset |
| SIM-061 | Critical | Monthly PT across 2 fortnightly payrolls | PASS_REFERENCE | Synthetic PT 200 collected once across runs, not twice |
| SIM-062 | High | Retry statutory posting from same payroll run | PASS_REFERENCE | Same run id cannot withhold twice |
| SIM-063 | Critical | Statutory month full salary unknown while HO approves first half | POLICY_REQUIRED | Need PT/ESI month-close adjustment / hold/reconcile rule; cannot claim correct real PT yet |
| SIM-064 | High | Employer EPF/ESI erroneously subtracted from employee net | PASS_REFERENCE | Employee net excludes employer liabilities |
| SIM-065 | Critical | Statutory master revised while employee awaits HO | PASS_REFERENCE | New applicable rule invalidates old preview/requires re-review |
| SIM-066 | High | Master is unpublished/overlapping | PASS_REFERENCE | Do not compute with draft or conflicting statutory revisions |
| SIM-067 | High | Advance recovery > outstanding ledger | PASS_REFERENCE | Reject, no negative recoverable balance |
| SIM-068 | Critical | Advance + statutory deductions exceed earnings | POLICY_REQUIRED | Do not silently clamp net to zero; approved handling needed |
| SIM-069 | Critical | Payment attempted before employee row is locked | PASS_REFERENCE | Only finalized row can create payment obligation |
| SIM-070 | Critical | Payment event retried with same reference | PASS_REFERENCE | Idempotent duplicate = no second payout |
| SIM-071 | Critical | Same payment reference used for different amount | PASS_REFERENCE | Reject altered retry payload |
| SIM-072 | High | Partial salary payout 500 then 700 for net 1000 | PASS_REFERENCE | Never pay more than locked net; payroll amount unchanged |
| SIM-073 | High | Bank export duplicated | POLICY_REQUIRED | Exports are not payment evidence; require external settlement reference |
| SIM-074 | High | Employee payslip after rate/master edit | PASS_REFERENCE | Use locked snapshot, not re-query live rate |
| SIM-075 | Critical | HO payroll approval accidentally debits Accounts bank balance | IMPLEMENTATION_VERIFICATION | Requisition RPC must not be called by payroll approval; payment separate |


## 24. Mandatory technical guards to implement before live approval

### 24.1 Per-employee state machine, approvals and row-version CAS

- A parent payroll sheet is **not** an approval unit. Status and financial snapshot belong to each employee salary row.
- Factory row: `DRAFT → SUBMITTED_TO_ACCOUNTS → PENDING_HO_APPROVAL → LOCKED`; either reviewer can `RETURN_FOR_CORRECTION` an individual row with a mandatory reason.
- Accounts-created HO/Projects row: `DRAFT → PENDING_HO_APPROVAL → LOCKED`; no redundant self-review by Accounts.
- On correction, increment a **row version**; invalidate all earlier Accounts clearance / HO decisions. An FM-resubmitted row returns to Accounts even if HO was the person who returned it.
- Authorization uses **current database role, assigned factory scope, row state, and creator/reviewer identity**. Prevent maker-checker self-approval even where one physical person has broad Admin rights, unless the client explicitly approves an emergency audited exception. The latter is **not confirmed**.
- The row being returned/held/rejected must not change another row's state or revoke a sibling's locked result. Batch APIs report `successes[]` and `failures[]` per salary row; do not emit one generic “All approved” response for mixed results.
- **Optimistic concurrency / compare-and-swap:** `UPDATE ... WHERE id = ? AND version = ? AND status = ?` with row count = 1, or an equivalent PostgreSQL row lock and status check. Return HTTP 409 for stale reviewer operations. UI must show last reviewer, last version, reason and resubmission history.

### 24.2 Atomic finalization and employee-level coverage

One transaction per approved employee row must validate sources and actor, resolve the applicable published policies, confirm calculation hash/version, insert immutable line and source snapshots, reserve date coverage, append audit history, lock the employee salary row and create a payment **obligation** (not a bank debit). A failure in any step rolls back the entire row transition, without rolling back independently finalized sibling rows.

**Target PostgreSQL constraint, schematic only — refine for actual table names and migrations:**

```sql
-- Requires btree_gist; use employee_id as the grouping key, not payroll group.
EXCLUDE USING gist (
  employee_id WITH =,
  daterange(period_from, period_to, '[]') WITH &&
)
WHERE (coverage_state = 'LOCKED');
```

Also enforce one employee-result per sheet, immutable snapshots, FK to the locked employee row for disbursement, unique external payment operation IDs, and idempotent review/finalization request IDs. For an adjustment-only retro run, reference the original locked period and classify the event separately; **do not create a second ordinary salary coverage row**.

**Concurrent execution gap:** The dry-run model tested *sequential duplicate requests* and 44,100 interval predicate comparisons, **not actual Postgres concurrency**. Required DB tests: two sessions attempt overlapping salary finalization at once; one commits and the other fails cleanly. Retry identical transactions after network timeouts; observe exactly one coverage and one audit finalization event. Test concurrent approvals of **different employees in the same sheet** proceed independently.

### 24.3 Pay-month budgeting beyond coverage exclusion

For every permanent employee, maintain an effective-dated monthly contractual earnings/allocation record separate from employee-date coverage:

- Identify `(employee_id, salary_month, contract/revision, payroll_policy_revision)` and already finalized earnings/deductions across multiple runs.
- Resolve a **published** Payroll Policy Master revision with `lop_method=FIXED_DIVISOR`, `lop_fixed_divisor=30` for currently covered permanent leave; resolve joining/exiting and split-allocation methods as **separate** policy fields. Prevent fallback from an unresolved field to an unrelated method.
- Reconcile full-month fixed gross to the approved monthly policy; make LOP distinct from the base-salary amount to avoid subtraction twice.
- For a split month, block the final affected employee lock if contractual earnings would be duplicated or left unjustifiably short, **even if employee-date coverage does not overlap**.
- Keep an explicit basis for `SPECIAL_PACKAGE` and all named salary components. The sum of components must equal the agreed gross where the contract requires it; a single full-package amount and its breakdown are **alternative display forms**, not two sources of earnings.
- Do not invent an approved 28/29/31-day normalization; the monthly allocation and full-month unpaid handling are **client decisions**. The optional `ACTUAL_CALENDAR_DAYS` LOP method and proposed calendar-weighted split-run method are **configuration options**, not hidden corrective fallbacks.

### 24.4 Factory facts, approval dependencies and cutoffs

- For each applicable factory date and employee, require the relevant **Locked** attendance sheet; `Submitted` / `Returned` / a missing sheet is **not** equivalent to absence or zero wages.
- Pay by **locked start-date attendance** once for overnight duty unless the approved earnings attribution policy explicitly differs. Full entry/exit timestamps, timezone, overnight toggle and maximum duration must be preserved. At month boundaries, reject any computation attempting to pay one duty twice.
- Resolve effective category, factory department, permanent pay source or Casual/Local wage revision, standard hours and overtime rules for the **actual date**, not today's employee category/master values.
- A row marked paid leave must agree with the HO leave decision. Pending/rejected leave and salary row must not silently disagree. No salary row may finalize using a leave whose status will still change during review.
- Only eligible categories can receive holiday work compensation. `total holiday pay = 1.5 × eligible base` means if base already includes `1.0 ×`, additional premium is **0.5 ×**, not **1.5 ×** again; for another configured multiplier use `(multiplier − 1) × base` as the incremental portion.
- Local Double Duty is paid at the configured multiplier and **OT=0**; Local leave is Unpaid and holiday premium is not applicable. Existing approved 24h-duty/CO eligibility still requires prior locked attendance. Never pay the CO rest day twice.
- The existing free-text `management_stoppage_treatment` and `short_hours_treatment` values do not define executable code; introduce reviewed structured rule identifiers and versioned payout semantics, or mark affected rows blocked.
- Historical `Local` sheets with null factory cannot be auto-attributed to either SNP or Fabric; preserve identity and require explicitly approved historical allocation when cost-centre reporting demands it.
- An authorized correction of a locked attendance fact (if ever introduced) must create an adjustment/reconciliation path; it cannot modify an already Locked payroll row.

### 24.5 Statutory month, adjustment and money integrity

- Statutory master: Admin-only **create/publish** permissions, effective-dated nonoverlapping published revisions, employee eligibility and applicable jurisdiction, explicit contribution wage basis/ceiling/rounding. Do not accept employee-provided ESI/EPF amounts or percentages.
- Monthly statute ledger: key by `(employee_id, scheme, statutory_month, jurisdiction/establishment where legally relevant)` and serialize postings **across all payroll groups**. A synthetic “once-only PT” test is **insufficient** for a real slab rule; validate monthly aggregated wages and any adjustment when later payroll runs change the final slab or statutory eligibility.
- Employer EPF/ESI must not reduce employee net. Only employee-share contributions and legally authorized deductions belong on the employee payslip deduction side.
- Advances/recoveries have their own approved source, outstanding balance, per-installment idempotency key, attachment/remarks policy and remaining ledger; no recovery beyond the approved outstanding amount. Zero/negative net cases require a business/legal handling rule rather than silent clamping.
- Currency: exact `NUMERIC`/`Decimal`; nonnegative and bounded input checks, centralized rounding rules, sum-of-lines reconciliation, and frozen result snapshots. Never allow UI input to overwrite calculated statutory results or net salary.

### 24.6 Payment / Accounts integration boundary

- **Payroll approval and requisition approval are distinct transactions.** Reuse requisition-style per-row review UX, return reasons and audit structure, **not** `approve_acct_line_item_transact` or the bank-master debit side effects.
- A Locked employee salary result creates a payable obligation; marking `Paid` requires separate verified settlement evidence. Re-exporting a bank/NEFT file is not proof of payment.
- Match every payment instruction/response with immutable external reference or an internal idempotency key. A retry must not create another payment. Aggregate successful partial payments must never exceed the locked net. A failed transaction must not mark the salary row as Paid.
- Maintain a clear audit chain `payroll sheet → employee locked result → payment request → disbursement event → reconciliation`. Reuse the existing Accounts payment/requisition patterns only after explicitly defining whether payroll payments are posted as separate requisition items, linked payment instructions or an independently controlled disbursement batch. Prevent both routes from authorizing the **same payment** twice.
- Bank account/NEFT/PF details are sensitive: least-privilege API reads and exports, scoped role checks, no credentials in audit payload, safe retention, and no employee cross-visibility.

## 25. Remaining sign-offs before coding irreversible/payable logic

| Rank | Decision | Why now / dry-run ID | Interim implementation disposition |
|---|---|---|---|
| **P0** | Full-month unpaid treatment with current Fixed30 LOP in 28/29/31 days; zero pay vs valid weekly-off entitlement | SIM-008–010; §6.3 | Keep `full_month_unpaid_treatment=UNRESOLVED`; block affected finalization, never silently swap to actual days |
| **P0** | Permanent monthly gross distribution across **two or more nonoverlapping runs** | SIM-016–017, SIM-052 | Do not lock split permanent monthly pay before agreed month-allocation logic |
| **P0** | Join/exit, midmonth pay revisions, off-cycle leave corrections, salary-effective dates; **Gross/30 vs proposed actual-calendar proration** | SIM-018–020, SIM-023; §6.3 | Implement both named methods as available options; keep actual-days **unpublished**, block ambiguous results until explicit approval |
| **P0** | Sunday/weekly offs **inside one explicit leave range**, in absence of sandwich policy | SIM-006–007 | Do not infer; determine chargeable dates from an approved rule |
| **P0** | Negative gross/net and recoveries exceeding earning balance | SIM-009, SIM-068 | Reject negative gross; block live payment and seek approved net treatment |
| **P1** | Pay calendar/workday requirements for factory closed days; management stoppages/short hours | SIM-035–036 | Map structured attendance rule codes before payable calculations |
| **P1** | Overnight 24h and cross-month duty attribution / maximum duty duration | SIM-032–034 | Preserve timestamp; reject ambiguous duplicate allocations |
| **P1** | Professional Tax/month close, EPF/ESI salary bases/thresholds/rounding and jurisdiction | SIM-061–066 | Statutory master schema may be built; **no live contributions** without professional sign-off |
| **P1** | True FM factory assignments and temporary/emergency Admin overrides | SIM-042, SIM-057 | Restricted server-side factory mapping and maker-checker; do not auto-elevate |
| **P1** | Whether payment uses linked Accounts requisition workflow or dedicated payroll disbursement records | SIM-069–075 | Keep payment integration separate until exact idempotent owner/ledger semantics fixed |
| **P2** | Salary advance approvals, mobile bill treatment, negative balance recovery process | SIM-067–068 | Approved adjustment ledger only; defer unapproved deduction types |
| **P2** | Legacy Local department attribution, retired Projects carryover, document/receipt retention | SIM-038, SIM-060 | Preserve historical identity; no automatic remapping or invented cost centre |

**The formula “gross/30” is [CONFIRMED] for leave deduction. The questions in this table do not cancel it; they define how to handle special circumstances that the formula alone does not settle.** No permanent payroll generator should silently fall back to calendar/26/working-day proration, or conceal these exceptions behind a UI tooltip.

## 26. Code/test implementation checklist and release gates

Use `SIM-*` as stable test IDs and map them to backend integration and UI regression tests. Group the test implementation as follows:

1. **Core calculations** — `SIM-001..024`: Decimal arithmetic, leave date sets, 30-day divisor, month spanning and salary allocation. Keep unresolved cases in explicit `requires_policy` fixtures until policy is signed; then replace with approved expected values. **Also implement `POL-001..018` (see §27) for the new Payroll Policy Master.**
2. **Factory** — `SIM-025..041`: real Supabase fixture with wage/pay-rule revisions, locked rows, overnight and previous-day CO, two Local factory rosters, approved vs rejected leave and null-department legacy sheet.
3. **Role and workflow** — `SIM-042..060`: test authenticated FM/Accounts/HO/Admin sessions and actual RPC/HTTP endpoints; independently lock 2 of 3 rows, return the third, reopen and resubmit it with a new version and Accounts re-clearance.
4. **Statutory and payments** — `SIM-061..075`: verify Admin-only effective master revisions, employee/employer share separation, month-state serialization, monthly slab changes, recovery ledger, idempotent settlement references and **no bank balance debit from HO payroll approval**.
5. **Real concurrency** — start two PostgreSQL transactions on separate connections for the **same employee and overlapping dates**. Expect one successful lock, the other a deterministic conflict, no orphaned statutory ledger rows or duplicate payment obligations. Also concurrently lock unrelated employees in the same sheet; neither should block the other unnecessarily.
6. **Presentation/export** — compare every salary register/Excel/payslip number with immutable locked line-item sums and payment records. HO should be able to approve a group partly; aggregate sheet dashboard must show precise pending/returned/locked counts and actual amount states.
7. **Reconciliation sample** — obtain anonymized client-generated salary registers for one 28-day month, one 31-day month, two payroll runs in the same month, a person joining/leaving, paid/rejected leave, 24h/CO, double duty, and at least one EPF/ESI/PT case. Run in shadow mode; block activation until agreed fixtures reconcile to the rupee and policy exceptions are signed.

### Staged release gates

- **Schema + workflow:** May start while P0 formulas remain open, including the Admin Payroll Policy Master, provided locked-payroll/posting paths cannot use unapproved policy choices.
- **Payroll preview:** May show calculated totals and explicit `BLOCKED_POLICY`/`BLOCKED_SOURCE` statuses, with explanations; no silent fallback.
- **Final payroll row lock:** Requires resolved case-specific P0 rules, reviewed wages/leave sources, valid statutory configuration (or an explicitly approved compliance-managed launch scope), and passing DB/HTTP concurrency tests.
- **Actual payment:** Requires locked salary row, unique payment operation, settlement proof/approval mechanics and payment reconciliation integration tests. HO approval alone must never debit a bank balance or imply transfer success.

### Change control

On client confirmation of outstanding business decisions, update the policy section, append decision metadata (`approved_by`, `approved_on`, `effective_from`, `applies_to_groups`), replace any `POLICY_REQUIRED` example with a signed expected outcome, add executable regression fixtures and increment this specification version. Preserve test IDs so every discovered edge case remains visible during review.

---

## 27. Configurable-policy acceptance matrix, ERP research basis and v1.4 change log

### 27.1 Additional regression cases (NOT yet implemented in the ERP)

The `POL-*` cases supplement the original 75 `SIM-*` cases. All examples use **synthetic** salaries, not production employee data; arithmetic checks do not constitute approval of policy choices.

| ID | Case | Required result / guard |
|---|---|---|
| `POL-001` | Full eligible February 2026, ₹30,000, no unpaid leave | Exactly ₹30,000 gross, regardless of 28 days |
| `POL-002` | Full eligible October 2026, ₹30,000, no unpaid leave | Exactly ₹30,000 gross, regardless of 31 days |
| `POL-003` | February, two chargeable unpaid days, `FIXED_DIVISOR=30` | LOP ₹2,000.00 and gross after LOP ₹28,000.00 |
| `POL-004` | October, two chargeable unpaid days, `FIXED_DIVISOR=30` | LOP ₹2,000.00 and gross after LOP ₹28,000.00 |
| `POL-005` | February, 2 unpaid days, **explicit test-only** `ACTUAL_CALENDAR_DAYS` policy | LOP ₹2,142.86, gross ₹27,857.14; default client LOP remains fixed 30 |
| `POL-006` | October, 2 unpaid days, **explicit test-only** `ACTUAL_CALENDAR_DAYS` policy | LOP ₹1,935.48, gross ₹28,064.52; not silently selected |
| `POL-007` | Entire 28-day February marked unpaid under Fixed30 | Detect ₹2,000 residual; **block** if full-month treatment unresolved |
| `POL-008` | All 31 October dates marked unpaid under Fixed30 | Detect −₹1,000 candidate; **block**, no negative salary |
| `POL-009` | One ₹30,000 month split 1–15 and 16–31 October | Proposed calendar weighting gives ₹14,516.13 + ₹15,483.87 = ₹30,000.00; cannot lock before signed allocation policy |
| `POL-010` | Same period split into several runs; no overlapping dates | Unique monthly entitlement ledger prevents extra base pay despite passing date overlap checks |
| `POL-011` | Joining October 16; Gross/30 vs Actual Calendar methods | Distinct method previews and explanations; **no silent proration switch**; block without approved join/exit rule |
| `POL-012` | Admin publishes future LOP method change | New revision, exact scope + effective date; existing locked row unchanged |
| `POL-013` | Accounts/Factory Manager attempts to publish/change active policy | Denied server-side; no money-changing UI override |
| `POL-014` | Published policy with overlapping effective dates for same scope | DB rejects ambiguous published revisions (specific-group override must be explicit) |
| `POL-015` | Admin policy changed during submitted/cleared but **unlocked** review | Stale employee preview/hash detected; re-review required; other locked employee rows unaffected |
| `POL-016` | Employee unpaid leave spans February/March or a dated salary change | LOP split to actual affected dates/months and governing published revisions, no new sandwich days |
| `POL-017` | Casual/Local factory payroll under configured permanent Fixed30 policy | Unaffected; wage/duty/revision rules remain authoritative for daily-wage groups |
| `POL-018` | Manual rates, missing master, unpublished policy or unresolved full-unpaid case | Cannot finalize; clear source/policy error, never silent fallback |

**Suggested future automated suite:** domain tests for formula selection and Decimal rounding; database tests for nonoverlapping published revisions, approval/version compare-and-swap and employee/month concurrent posting; HTTP authorization tests for Admin/master edit; end-to-end per-employee preview → Accounts clear → HO lock → unchanged locked payslip after next policy publication. The new cases are **specification requirements**, not results of running the live ERP.

### 27.2 Vendor documentation — useful patterns, not SN Polymers policy

The following references inform **system design**; they do not override the confirmed client policy, establish statutory compliance in India, or imply that these vendor systems all use the same formula.

| Documented product behavior | Design lesson for this ERP | Official reference |
|---|---|---|
| **Zoho Payroll** allows an employer to choose **actual number of days** or a **fixed number of days** in monthly salary calculation. Its product-specific pay-schedule editing limitations are **not** an instruction to change this ERP's versioning design. | Offer named fixed-divisor/actual-calendar methods, with client-specific published default | [Zoho Payroll — Pay Schedule](https://www.zoho.com/in/payroll/help/employer/settings/set-pay-schedule.html) |
| **SAP HCM** documents the fixed-period-divisor deduction method, including the potential for **negative remuneration in long months** and unintended salary despite entire-month absence in **short months**; it also describes separate factoring approaches. | Detect/stop February/31-day LOP anomalies; do not hide them by silently switching formulas | [SAP — Deduction Method](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d9b2188095ad4922bd9977126e0d92b7/afcade537187424de10000000a174cb4.html); [SAP — Payroll Factoring](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/8e44bafcbdcb4d6b85e4564d69a14500/353ac2531bb9b44ce10000000a174cb4.html) |
| **Oracle Fusion Cloud Payroll** documents independent **proration conversion methods** (calendar days or work schedules) for earnings and deductions and identifies joiners and mid-period salary changes as proration events. | Separate the join/exit and salary-change calculation from the LOP rule | [Oracle — Calculation of Prorated Earnings and Deductions](https://docs.oracle.com/en/cloud/saas/human-resources/facpe/calculation-of-prorated-earnings-and-deductions.html); [Oracle — Overview of Proration](https://docs.oracle.com/en/cloud/saas/human-resources/facpe/overview-of-element-proration.html) |
| **Frappe HR** provides configurable calculation using leave applications vs attendance records, working days, holidays and payment days. | Store explicit leave dates, calendars and payable-day classification; don't infer office absences | [Frappe HR — Payroll Settings](https://docs.frappe.io/hr/payroll-settings); [Frappe HR — Leave Calculation](https://docs.frappe.io/hr/leave-calculation-in-salary-slip) |

**Research boundary:** These examples support configurable **calculation architecture**, not a default to Actual Calendar Days, automatic hybrid switching between deduction/payment methods, or any particular Indian statutory treatment. Rate applicability and full-unpaid-month entitlement still need client and statutory review.

### 27.3 v1.3 → v1.4 change register

- **Added:** Admin-managed **Payroll Policy Master** as a separate effective-dated, immutable published policy source; `Fixed 30` remains the active client-approved LOP policy, while Actual Calendar Days is a future option.
- **Separated:** monthly contractual salary entitlement, LOP calculation, join/exit proration and multi-run monthly allocation. Earlier client indication of Gross ÷ 30 for joining/exiting **not silently superseded** by the proposed actual-calendar alternative.
- **Strengthened:** full-month-unpaid `BLOCKED_POLICY`, weekly-off/no-sandwich distinction, negative/residual salary checks, submitted-preview invalidation after master changes, and per-employee month-ledger reconciliation.
- **Extended:** proposed database entities, Admin UI, audit/versioning requirements and `POL-001..018` test matrix; preserved all original `SIM-*` test IDs and historical dry-run result counts.
- **Documented:** official ERP sources as **research references only**; the final client policy and statutory definitions remain the controlling sources for production use.

