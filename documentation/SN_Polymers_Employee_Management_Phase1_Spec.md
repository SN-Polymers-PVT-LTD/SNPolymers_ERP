# S. N. Polymers ERP — Employee Management Module

**Phase:** 1 — Employee & Worker Master and Permanent Employee Pay Structure  
**Document status:** Implementation specification / working agreement; not evidence of completed code  
**Last updated:** 26 September 2026
**Navigation / ownership:** Existing Admin module → Employee Management; Admin-only maintenance (confirmed client decision)  
**UI source of truth:** `SN_Polymers_Employee_Master_Pay_Structure_Client_UI.xlsx` (client-renamed copy of the latest approved v2 workbook)  
**Related input:** Codex Phase 1 repository inspection and updated plan. The workbook defines the **user-facing screens**; it is **not** a database schema.

## 1. Goal and implementation boundary

Create a company-wide employee identity and administration feature **inside the existing Admin module**. It must cover all six employee/worker categories, whether or not an individual has an ERP login. Add a separate pay-structure screen **only for permanent employees**. Reuse existing authentication, user accounts, Admin authorization, navigation and UI patterns; do not introduce a separate HR module, module launcher or role.

Phase 1 provides **two screens under Admin → Employee Management**:

1. **Employee & Worker Master** — company-wide employee directory and create/edit/status workflows.
2. **Permanent Employee Pay Structure** — agreed monthly compensation and EPF/ESI enrolment selections for permanent-category employees.

**Confirmed client decision: Admin is the sole maintainer of Employee Management and Permanent Employee Pay Structure. Do not create an HR role, a separate HR module/workspace or an HR launcher, now or as an assumed future requirement.** Do not create a parallel login system or alter JE/ZO/HO/Accounts permissions as part of this work.

**Out of scope:** daily attendance, factory shift/duty entry, casual/local wage-rate configuration, leave application and approval, overtime/holiday-duty calculation, individual bonus/allowance awards, statutory tax/contribution calculations, payroll runs, Accounts payroll import, disbursement, bank details, payment-method capture, and payment verification.

## 2. Workforce categories and business context

| Employee category — exact display label | Permanent? | Phase 1 pay-structure screen? | Current operational context (future phase) |
|---|---|---|---|
| HO Staff | Yes | Yes | Includes HO/Accounts staff; fixed or special-package salary; no daily ERP attendance. |
| Fabric Factory Permanent Employees | Yes | Yes | Factory Manager records attendance when that module is developed. |
| SNP Casual Factory Labour | No | No | Factory Manager records attendance; wage/rate configuration belongs to the future factory attendance/wage module. |
| SNP Permanent Factory Labour | Yes | Yes | Factory Manager records attendance when that module is developed. |
| Projects Department Employees | Yes | Yes | Includes JE, ZO and relevant HO-role ERP users; fixed or special-package salary; no daily ERP attendance. |
| Local Daily-Wage Workers | No | No | Employee record may exist without ERP login; wages/rates belong to the later factory attendance/wage module. |

**Employee category is not an ERP permission role.** An individual with an `ho` account may belong to HO Staff or Projects Department Employees according to their real employment assignment. Linking an ERP account must not change its current role or authentication.

Category-based behaviour for future modules (attendance required, leave application mode, holiday-duty treatment, company bonus eligibility and default Professional Tax treatment) must **not** be editable columns in the Employee Master. The previously agreed company bonus scope covers five categories, excluding Local Daily-Wage Workers. These rules are retained as future policy context, not implemented in Phase 1.

## 3. UI contract — Employee & Worker Master

**Exactly nine visible directory fields, in this order:**

| # | Field | UI behaviour |
|---:|---|---|
| 1 | Employee ID | System-generated, unique, stable identifier; no user-entered duplicate IDs. |
| 2 | Employee Name | Admin-entered full name. |
| 3 | Employee Category | Dropdown containing the six exact labels in §2. |
| 4 | Department / Function | Controlled selection; do **not** include worksite or project assignment in this screen. |
| 5 | Contact Number | Optional Indian mobile number; accept a 10-digit Indian mobile number with optional `+91` or leading `0` prefix. It is not the employee identity key or automatically a login. |
| 6 | Existing ERP Role | Dropdown used to filter account choices when an existing ERP login is linked. For an unlinked worker, show **No ERP account**. Do not persist this as a second, conflicting ERP role. |
| 7 | Existing ERP Account | Native searchable, role-filtered dropdown populated from actual existing ERP users. Use the browser's built-in select search; a separate search field is not required. Optional and unique: one ERP user cannot be linked to multiple employee records. No arbitrary typed account ID and no automatic account creation. |
| 8 | Joining Date | Admin-entered date; do not infer a joining date from the existing login. |
| 9 | Active Status | **Final visible column**; Active, Inactive or Exited. Preserve the record and historical references when changing status. |

A worker without an ERP account is a valid employee/worker record. All existing ERP users who need an employee profile are linked to a single existing account by its internal UUID rather than by phone number. The live account dropdown must not use the workbook's fictional example IDs.

**Explicitly excluded from this UI:** salary, wage/duty rate, annual package, statutory rate/slab, P. Tax eligibility flag, EPF/ESI calculation, attendance mode, leave mode, holiday-duty eligibility, company bonus eligibility, worksite, project, payroll period, payroll net pay, and payment details.

## 4. UI contract — Permanent Employee Pay Structure

This is a **separate screen linked to the same Employee ID**, available only for the four permanent categories in §2. Select an existing permanent employee; display their name and category read-only.

| # | Field | UI behaviour |
|---:|---|---|
| 1 | Employee ID | Select an existing permanent employee in the Employee Master. |
| 2 | Employee Name | Read-only, populated from the linked Employee Master record. |
| 3 | Permanent Employee Category | Read-only, populated from the linked employee. |
| 4 | Pay Basis | Dropdown: **Monthly salary** or **Special package** only. |
| 5 | Guaranteed Monthly Gross (₹) | Approved fixed monthly gross; not the final net salary or annual package. |
| 6 | Basic Salary (₹/month) | Fixed component where defined. |
| 7 | Staff Welfare (₹/month) | Fixed component where defined. |
| 8 | Other Fixed Components (₹/month) | Fixed recurring components only; variable allowances, bonus, holiday duty and OT are outside this screen. |
| 9 | EPF Enrolment | Admin-recorded selection; keep separate from ESI. |
| 10 | ESI Enrolment | Admin-recorded selection; keep separate from EPF. |
| 11 | Pay Structure Status | Active / Superseded; a newly created revision becomes Active immediately and supersedes the previously active revision. This is separate from an employee's Active Status. |

**Client decision, 26 September 2026:** Pay structures do not require a Draft review/activation step. Creating a revision activates it immediately; suspension is an available explicit action, and prior revisions remain in history. The earlier Draft → Activate workflow is superseded by this decision.

**Not present in this screen or Phase 1 pay API write contract:** Annual Package amount; `Annual package` pay-basis option; Salary Effective From; Payment Method; Payment Details Verified; bank details; casual/local wage/duty rates.

Keep the exact spelling **Special package** in the UI. It is a pay-basis label for an agreed **monthly** amount, not an instruction to derive an annual package. Monetary fields must be nonnegative. The intended fixed components should reconcile with the guaranteed monthly gross when the components are supplied; define optional/blank component semantics clearly in validation.

### Statutory distinction

- **P. Tax = Professional Tax, not PF.** The company wants P. Tax configured for the four permanent categories, but this is category/policy-derived rather than an editable field in the Employee Master. Actual liability, jurisdiction, slabs and remittance are later statutory-payroll work.
- EPF and ESI are **separate recorded employee enrolment selections** for the permanent categories. Phase 1 captures the chosen/enrolment state; it does **not** calculate or assert statutory eligibility. Later payroll must apply verified, current rules. An employee checkbox must not override a legally mandatory contribution.
- The company's proposed category exclusions for casual and local daily-wage workers are business inputs for later verification, **not** a statutory exemption implemented in this phase.

## 5. Proposed technical design (separate from the UI contract)

Codex's repository inspection identified the current ERP user identity in `authorised_users.id` (UUID), existing Admin user management, JWT/session and role middleware, ordered forward SQL migrations, and existing frontend module-navigation patterns. Verify the actual checkout before editing; this document describes the approved direction, not a guarantee about the current branch state.

Proposed Phase 1 data entities:

- **`hr_employees`**: UUID internal key, unique employee code, identity/directory fields, category/department, nullable **unique** FK to `authorised_users.id`, employment status, created/updated timestamps and actors. ERP role is read from the linked account rather than duplicated.
- **`hr_permanent_pay_structures`**: UUID internal key, employee FK, pay basis, monthly gross and recurring components, EPF and ESI enrolment selections, version/status and internal audit metadata. Preserve prior revisions; allow at most one active revision per employee, with transactional activation/supersession. Do not expose revision internals as additional UI columns.

A database-only record identifier, revision number and creation timestamp may be necessary for integrity and history. **Do not use that as justification to reintroduce Salary Effective From or other removed fields to the client-facing form.** Do not add a payment-profile entity or bank-verification workflow to Phase 1.

Maintain a clean separation between directory and pay endpoints: **the general employee-list response must not include salary or EPF/ESI details**. Admin authentication and authorization must be enforced server-side for all writes and pay reads, not merely by hiding frontend routes. Salary-bearing audit events should avoid leaking amounts to a broadly accessible audit log.

## 6. Proposed code integration and sequencing

Codex suggested the next forward HR migration and module-specific routes/controllers/validation/services within the current monorepo. Verify the next available migration number at implementation time rather than assuming `093` remains unused.

1. **Stage 1 — Employee foundation:** migration, category list, employee code generation, employee CRUD/search/filter/pagination, existing-account lookup/linking, Admin-only permissions, deactivation, uniqueness and regression tests. Do not create records for current users by guessing their category, department or joining date.
2. **Stage 2 — Permanent pay records:** versioned permanent pay structures, separate protected read/write API, draft/activate/supersede operations, validation and transaction/concurrency tests. No payment, statutory calculation or attendance tables.
3. **Stage 3 — Admin integration:** Add **Admin → Employee Management** navigation, with the lean Employee & Worker Master list/form and a separate Permanent Employee Pay Structure screen under Admin-protected routes. Use the existing Admin layout/sidebar and shared dropdown/UI patterns, with loading/empty/error/success handling. **Do not add an HR module launcher, standalone HR workspace or HR role.**
4. **Stage 4 — Integration and review:** database/schema contract tests, relevant frontend/build/lint tests, Admin auth and user-management regression, Projects/Accounts route regression, and review of exact UI field order. Do not commit or push unless explicitly requested.

**Existing account deletion:** if the current Admin workflow can delete ERP users, linking an employee to a user must not silently orphan the employee. Prefer referentially safe behaviour, preserving employee/pay history and retaining existing authentication semantics.

## 7. Acceptance criteria

- [ ] Both screens are located under the existing **Admin module → Employee Management** navigation and match the current client-facing workbook; there are nine directory columns and eleven permanent-pay columns, in the specified order.
- [ ] **Active Status** is the final employee-directory column.
- [ ] The six category labels include **SNP Casual Factory Labour** and **SNP Permanent Factory Labour** exactly.
- [ ] `Special package` and `Monthly salary` are the only permanent-pay basis choices. No annual-package amount or annual-package choice appears anywhere in the Phase 1 form/API.
- [ ] No Salary Effective From, Payment Method or Payment Details Verified is exposed in the Phase 1 pay form or accepted by its write API.
- [ ] No wage/duty rate appears in the Employee Master or permanent-pay form.
- [ ] Employee records can exist without ERP login accounts; linking an existing user neither creates a new login nor changes their existing role.
- [ ] ERP role and user choices come from the live directory; account links cannot be duplicated, fabricated or reused across employees.
- [ ] Only employees in the four permanent categories can receive a permanent pay structure.
- [ ] Only one active pay revision exists per employee; creating a revision activates it and supersedes the previous active revision, and historical revisions remain readable after changes.
- [ ] Contact number is optional and, when supplied, accepts an Indian mobile number with the agreed optional country/leading-zero prefix.
- [ ] Existing ERP account selection uses the native searchable role-filtered dropdown; no separate account-search input is required.
- [ ] General employee-directory responses do not contain salary or statutory enrolment data; all employee and pay operations are protected by existing Admin authorization at the API and UI levels. No HR role, separate HR workspace or launcher is introduced.
- [ ] No attendance, leave, wage-rate setup, payroll calculation, payment or statutory-formula feature is accidentally implemented in this phase.
- [ ] No unrelated local changes are overwritten; Codex reports test results and stops at the requested stage for review.

## 8. Inputs required during onboarding; not coding blockers

Existing ERP user accounts alone do **not** supply a dependable employee category, department or joining date for every user. Admin will supply/confirm these fields during employee onboarding. Do not generate plausible but invented employee records as part of a migration.

The workbook's example names, salaries and account IDs are **fictional illustrations**, not migration seed data. Pay amounts, employee details, applicable statutory formulae and the precise meaning of each company's special package must be validated against actual client records/policy before production payroll.

## 9. Later phases (context, not authorization to implement)

After the Employee Management System is accepted: one Factory Manager's factory attendance and worker wage configuration; employee self-service leave for HO/Projects ERP users; paid/unpaid leave reflected in fixed monthly payroll; category-specific holiday duty and optional recorded OT; approved allowances/bonuses; Accounts verification → HO approval → payment execution and reconciliation. These workflows will reference the employee IDs established in Phase 1 and require their own approved functional specifications.
