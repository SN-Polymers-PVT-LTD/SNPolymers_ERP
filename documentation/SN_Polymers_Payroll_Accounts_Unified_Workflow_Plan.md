# Payroll through Accounts requisitions — complete workflow plan

Status: approved by the user and implemented locally, 3 November 2026. See `SN_Polymers_Payroll_Accounts_Verification.md` for executed checks and remaining rollout boundaries. Financial activation and conversion of existing UAT records remain separate controlled rollout actions.

## 1. Outcome and scope

Factory: FM prepares payroll → Submit to Accounts → automatically linked Accounts requisition sheet → Accounts sends to HO → HO approves/returns/holds individual salaries.

Projects / Head Office: Accounts prepares payroll → automatically linked Accounts requisition sheet → Accounts sends to HO → HO approves/returns/holds individual salaries. No FM or Accounts peer-review step is introduced for these groups.

One employee = one salary approval unit. The sheet is a convenient batch, not an all-or-nothing approval. Approving one employee does not approve another. Reuse payroll calculations, exact decimals, immutable snapshots, statutory reconciliation, independent reviewers and Accounts' existing screens. Retire the standalone payroll Accounts-forward/HO-lock queue from the normal UX. Payroll Register remains reporting/export, not a second action workflow.

No salary rekeying; no manual import; no user-managed technical intervals, linkage IDs, source versions or cutoff approval form.

## 2. Implementation inspected before the approved replacement

- `SN_Polymers_Payroll_Business_Rules_v1_4.md`, current decision 10 and section 11: explicitly specify a separate per-employee payroll Accounts-forward and HO-lock flow. This contradicts the latest user request; this is a deliberate workflow replacement, not a minor UI rename. Update those sections and acceptance criteria before coding; keep the historical decisions identified as superseded.
- `111_payroll_employee_review_workflow.sql`, commit c17dfc7 (11 October): factory submit sets PENDING_ACCOUNTS_REVIEW; forward sets PENDING_HO_APPROVAL. It creates no Accounts requisition row.
- `119_payroll_guarded_atomic_finalization.sql`: financial snapshots, employee/date coverage, monthly salary allocations, statutory entries and adjustment applications are committed when HO locks the employee. Cutoff must be approved and reached. Finalization has a separate deployment gate.
- `payrollReview.controller.js`: the server fetches source data and calculates exact values; SQL validates source equality/tokens under source fences. Keep this trust boundary; never accept a salary calculation or approver identity supplied by the browser.
- `PayrollDraftEditor.jsx`: factory preparer is FM; Projects/Head Office preparer is Accounts. Generate saves a draft and attempts per-employee calculations.
- `acctRequisition.routes.js` / controller: existing Accounts Open → Submitted sheet flow, HO per-item actions, resubmit, close review, import/rollover and NEFT export. Readers are Accounts/HO/Admin; FM cannot use the general finance APIs.
- `071_accounts_beneficiary_reconciliation.sql`: submitting a sheet validates payment fields for its items and reconciles beneficiary information. Existing payroll employee-beneficiary linkage is Admin-controlled (`115_payroll_employee_beneficiary_link.sql`). Accounts needs a narrowly scoped way to resolve payment details without employee/salary editing rights.
- `057_fund_request_accounts_sheet_integration.sql`: the active general approval RPC deducts approved amounts from bank_balance_master and writes BANK_DEBITED_PAYOUT audit entries. Reusing the screen does NOT justify blindly calling this routine before payroll validation.
- `062_payment_requisition_execution_lifecycle.sql`: existing source_requisition_id synchronization treats Accounts approval as PAID / PARTIALLY_PAID for that source domain. A payroll bridge must have its own canonical source link and payment semantics. Never masquerade payroll as a generic payment requisition or fund request.
- `accounts/HO_Approval_Business_Logic_v3.md` describes five generic HO decisions; later migrations 037/041/061/067 make hold/rollover/descendant provenance important. Effective SQL and current UI, not that older document alone, determine compatibility.

## 3. Stupidly simple screens

### FM: Payroll

Select factory + worker group + month, then Generate payroll. Existing saved draft opens immediately. Show employee, gross, deductions, take-home, status, View details. The details modal shows the useful breakdown and plain-language blockers; deep diagnostics/history are collapsed.

Primary action: **Submit to Accounts**, for selected ready employees. Default selection can offer all ready rows, with a clear selected count. Submission receipt: "7 salaries sent to Accounts · Sheet <number>". Users never choose an Accounts user or target requisition sheet.

After submission: readonly salary figures and clear status. Returned rows offer **Correct and resubmit**. Default list excludes cancelled history. Keep a small history filter for old records/deep links.

Replace duplicate progress/queue panels with counts: Draft, With Accounts, With HO, Approved, Returned/On hold. Payment status is separate. Do not show a final-lock percentage as overall payroll progress.

### Accounts: existing Requisition Sheets

Auto-created salary sheets appear with a clear title such as **Fabric payroll · August 2026**, employee count, total and source link. Keep them separate from general expenses initially: this avoids mixing salary-specific rules with unrelated row types and requires no extra user decision.

Rows: employee + department, pay period, take-home, payment details/status, View salary. Salary amount and calculation are readonly. Account sub-title/particulars are generated from a canonical salary accounting category; Accounts does not type them repeatedly. Do not assign arbitrary Projects work orders, ZO funding or fund-request provenance to salary rows.

Accounts chooses debit bank/payment mode once per sheet and can apply them to rows missing those values. Explicit individual overrides remain possible. Existing valid employee beneficiaries populate automatically. Missing bank details say exactly which employee needs attention; provide a narrow saved-beneficiary linking/editor action with audited identity checks. No fuzzy name matching or broad Employee Management permissions.

Primary action: **Send to HO** using the existing sheet submission experience. This action is the Accounts verification event; there is no separate Verify and forward button elsewhere. A salary issue can be returned to its preparer before sending the remaining active rows. Do not silently submit or approve unready rows.

Projects/Head Office creation is available from the existing Payroll screen as Accounts. Once calculated, **Continue to Accounts sheet** opens the automatically linked sheet; payment details and Send to HO are identical to factory payroll. That navigation is not an extra approval stage.

### HO: existing approval screen

A Payroll badge identifies salary rows. Default columns: employee, period, requested take-home, status, View salary, action. Keep the same approval screen and batch selection pattern.

For salary rows propose only **Approve**, **Return**, **Hold**. Generic expense rows retain their existing actions. Full salary approval is exactly the calculated net. Hide and reject arbitrary partial salary approval and generic credit-purchase actions server-side. Partial disbursement, if later needed, belongs to payment/reconciliation; it does not change salary entitlement.

Return opens a short modal: "Salary calculation" or "Payment details", plus mandatory reason. Salary corrections go to the originating FM/Accounts preparer; payment-detail corrections go to Accounts. Hold preserves the current salary and never posts a debit. Reject/reopen paths of generic requisitions cannot silently cancel an employee's wage entitlement or reopen an approved salary.

### Register and payslip

Register defaults to current, non-cancelled records. Show Draft / With Accounts / With HO / Approved, and separate Not paid / Paid when confirmed. Show requisition sheet link and source calculation revision. Draft totals must not masquerade as approved/paid totals. Approved payslips use the frozen payroll snapshot; draft previews remain labelled diagnostic.

## 4. Backend delivery and ownership

FM submission must not depend on manual import or a particular Accounts user's open expense sheet. Internally create or reuse a dedicated **Open payroll Accounts sheet for that payroll run**. Use existing numbering and team visibility. Preserve the actual FM submitter in provenance; do not impersonate an Accounts creator to pass an existing check. A tightly scoped server RPC may create this typed sheet; FM still cannot read/edit general finance sheets.

If Accounts has already submitted that sheet to HO, later FM submissions create a successor payroll delivery sheet for the same run. Repeated submission of the same employee/revision must return its existing receipt, never create a second payable row. Lock the run/delivery allocation while finding or creating the Open target.

Bulk submission reports success/failure per employee by name/code. The UI retains failed employees selected and links successful items to their sheet(s). One employee's failure cannot cause an inaccurate "all sent" message. Lock order and retries must account for submission racing Accounts' Send to HO.

Accounts may move to a successor sheet only through the controlled rollover path; source payroll identity must survive every descendant. Generic copy/import/delete cannot duplicate or release a salary liability.

## 5. Persistence and state contract

Proposed additive objects (exact migration numbers selected at implementation time):

- Typed Accounts sheet metadata: PAYROLL vs ordinary, source payroll run UUID and delivery sequence. Canonical FK and a single authoritative association, not free-text tagging.
- A payroll-to-Accounts linkage/history table: source employee salary row UUID, immutable calculation revision, content/review version, source fingerprint, requisition item UUID, delivery sequence, supersedes link, active/superseded disposition and audit actors/times.
- One authoritative active requisition claim per source salary row. Also guard overlapping employee/date liabilities across separate payroll runs using existing employee/source locks and a database-enforced active coverage/reservation strategy; uniqueness on a run ID alone is insufficient.
- Submission/payment beneficiary and calculation snapshots with canonical employee/beneficiary IDs. Immutable revision references survive later master changes.
- Separate payroll payment-confirmation records/idempotency keys if not supplied by an existing suitable payroll ledger. Do not reuse the source_requisition_id PAID synchronization.

Recommended new internal state **IN_ACCOUNTS_SHEET** supports both factory and office sources. This avoids falsely calling an Accounts-created draft "Pending HO approval" before the Accounts sheet is submitted. Display it as **With Accounts**. Reuse existing PENDING_HO_APPROVAL and LOCKED where appropriate; show LOCKED as **Approved** to users.

| User action | Payroll result | Accounts result |
|---|---|---|
| Generate | Draft/calculated revision | No payable claim yet |
| Submit/continue | IN_ACCOUNTS_SHEET, reviewed revision frozen | Linked readonly salary line on Open payroll sheet |
| Accounts Send to HO | PENDING_HO_APPROVAL; verification actor/version recorded | Sheet Submitted, active salary items Pending HO Review |
| HO Approve | Exact calculation finally locked | Salary line Approved; authorized bank posting once under chosen policy |
| Return salary | Returned to originating preparer, prior snapshot retained | Current delivery returned/frozen; successor revision required |
| Return payment details | Financial figures frozen, Accounts action required | Correct recipient/payment metadata and resubmit for HO review |
| Hold | No lock/debit; review pending/held | Existing hold/close-review semantics preserved with source links |
| Confirm payment | Approved salary unchanged | Separate payment confirmation; no second approval debit |

Both records change in one PostgreSQL transaction for every state transition. Do not implement this as controller write A followed by write B. New bridge RPCs reuse private validation/finalization helpers; generic Accounts RPCs require typed-source guards so alternate API paths cannot bypass salary rules.

## 6. Financial approval and payment — explicit proposed policy

**Proposed default:** preserve the existing Accounts bank-balance debit convention at HO approval, once, and atomically combine it with payroll finalization. This is an ERP accounting posting, not proof a bank transfer occurred. Approval, NEFT export and confirmed disbursement remain distinct for payroll.

Before implementation approval, make this distinction explicit: the current Accounts module calls some approved sources Paid immediately, whereas payroll will not. If the business instead wants bank-balance deduction only on actual payment, that needs a separately approved bank-ledger change, not a quiet alteration to all requisitions.

HO approval transaction must: verify current role and independent reviewer; lock delivery/source/employee/statutory-month/payment resources in a consistent order; revalidate the authoritative source and exact saved net; verify current approved deductions, adjustments, beneficiary and monthly reconciliation; validate cutoff/finalization gate; create immutable salary/statutory/advance/coverage records; apply exactly one Accounts bank posting; approve the linked item. Any failure rolls back BOTH sides. Insufficient funds must leave the salary unapproved and create no statutory/advance application.

Retried approvals return the existing result, without new bank debits, coverage or advance recovery. Actual confirmation never deducts the bank balance a second time. Exporting a NEFT file does not mark a salary paid. Re-export/retry requires existing idempotency and audit rules. No bank transfer initiation is added by this integration.

For actual payment tracking, add a small **Record payment** action to approved salary rows in the Accounts screen. Default to the approved unpaid amount; require paid date and bank/reference evidence. The first release records a full outstanding salary payment; partial payments require a separately explicit installment UI, never Partially Approve salary. Batch NEFT confirmation must allow one transfer-batch reference across different employees while preventing repeat confirmation of the same item. Failed/unconfirmed transfers remain unpaid and can be retried with history. Confirmation must not reapply the approval debit, regenerate payroll or rewrite the recipient snapshot. No external transfer is initiated by this action.

Statutory deductions/employer contributions remain payroll liabilities with original source links; do not add employer contributions to employee take-home or automatically create remittance payment entries in this delivery.

Zero net: retain the employee's approval record and payroll coverage. Use a guarded salary-only zero-value path; skip bank debit, mandatory bank mode for a nonexistent payout, and NEFT export. Generic expense rows remain positive-only. Negative net remains blocked. Existing supported bank modes are reused; Credit is forbidden for salaries. Cash is not silently introduced because the present requisition mode set lacks it.

## 7. Cutoff without an extra user workflow

Proposed simplification: Accounts' Send to HO automatically records the cutoff proposal for the payroll run. The normal HO approval action records independent acceptance in the same transaction; users do not fill a separate cutoff form or perform another approval click. The retained cutoff is visible as a small sheet-level submission timestamp/history entry.

Use a valid Asia/Kolkata cutoff on/after the end of the run, preserve the existing passed-cutoff requirement, and block premature finalization of an unfinished future period. Existing approved cutoffs are reused; never silently replace a cutoff after any row is locked. A returned salary can be corrected with an explicit submission revision and the existing locks; there is no claim that a cutoff bans every later correction.

Important code change: cutoff/finalization workflow metadata currently appears in source snapshots. Independent approval of the cutoff must not make an unchanged salary look stale. Define separate calculation-source and workflow-authorization tokens, with a narrowly documented field set; never ignore genuine attendance, policy, pay, calendar, beneficiary or statutory changes. Keep strict database snapshot comparison under source fences.

This replaces the present separate Accounts-propose/HO-approve cutoff UI and must be documented as a changed interaction, not assumed already implemented. Admin final approval is allowed only with the same independent-review constraints; never bypass them via admin role.

## 8. Corrections, stale sources and protective boundaries

- Draft: auto-recalculate using the existing draft freshness mechanism; retain calculation revisions.
- Delivered/Open Accounts sheet: do not silently replace the submitted salary amount when inputs change. Mark Needs update and return it to its preparer. Recalculation and resubmission explicitly replace the active delivery revision.
- With HO: disable approval on changed inputs; Return explains the changed source. Accounts cannot retype a different net.
- Approved: immutable. Use a linked adjustment/arrears/correction in a later authorized payroll; generic requisition reopen/edit/import must not mutate or pay the same entitlement twice.
- Payment-detail return: keep salary arithmetic intact; update an audited recipient snapshot and require HO to review it. Global beneficiary edits cannot silently change an already approved payout destination.
- Hold/closed review: preserve the current source lineage and outstanding liability; controlled successor sheets reuse the same obligation and cannot create another active claim. Generic dismissal does not erase unpaid salary.
- No hard-delete of submitted payroll source/delivery links. Deleting an undelivered draft remains available under current rules; an Open salary line is returned/withdrawn through the source workflow, not generic expense deletion.
- FM, Accounts and HO cannot approve their own linked employee salaries where independence is required. Existing employee-self and maker/checker checks remain authoritative in SQL.
- FM sees only the permitted payroll submission receipt/employee details, never other expenses, debit-bank balances or general requisition APIs. Accounts/HO retain authorized employee data access. Batch endpoints enforce the same rules as single actions.

## 9. Compatibility and cutover

Ship additive migrations and compatibility reads before switching the normal UI. Preserve all existing calculations, cancelled sheets, approved payroll, ordinary requisitions, fund requests, subcontractor payments, credit installments and audit logs.

Inventory current pending payroll rows, duplicate/overlapping runs, existing locks/payments, beneficiaries, cutoffs and current source readiness. Produce a dry-run conversion report. Unlinked submitted payroll rows must not be silently paid, bank-debited, reset or re-submitted by deployment.

Provide an idempotent authorized **Move pending salaries to Accounts** cutover operation, with a concrete preview and explicit business authorization before changing existing UAT records. It links only eligible unlinked pending rows using their saved revisions and produces per-row receipts/conflicts. Handle old PENDING_HO_APPROVAL separately: retain the prior Accounts verification provenance and require an intentional destination decision, without bypassing HO.

For cancelled records, retain history-only access and no Retry salary sources action. For already locked rows, do not create a new salary request automatically; handle any unpaid existing entitlement through a separately reconciled migration/payment plan.

After cutover, remove standalone payroll Verify and forward / Check final lock controls and duplicate queues from the normal navigation. Old deep links open the corresponding calculation/history modal or linked Accounts item; do not create a second editable approval route. Retain non-public helpers and audited legacy history as needed.

Financial activation is a separately controlled environment rollout after local acceptance tests; do not enable bank posting/global financial gates automatically in a structural migration. The bridge must fail clearly with zero partial side effects when activation is off.

## 10. Implementation sequence

1. Align business-rule sections 0/11/15 and current workflow docs to this approved replacement; fix acceptance criteria and terminology. Agree the bank-posting/paid distinction and salary action set before financial implementation.
2. Add typed delivery/linkage/snapshot objects, uniqueness/reservation constraints, RLS/role guards, immutable audit and scoped feature gate. Regenerate schema/RPC/index manifests. Test raw SQL invariants before UI work.
3. Implement factory and office source-to-Accounts delivery with idempotency, automatic Open payroll sheet routing, source version pinning and per-employee results. Add readonly salary rows/modal and default payment settings in the existing Accounts screen.
4. Extend Accounts Submit/Return/Resubmit/HO actions atomically for typed payroll items, including private financial finalization, bank posting and zero-net paths. Guard every generic edit/delete/import/reopen/rollover/export bypass.
5. Replace the normal payroll review UX with preparation/status; keep Register/reporting. Move cutoff behind submission, update source-token semantics and recipient ownership. Add migration/deep-link/cancelled-history handling.
6. Run isolated database/financial/HTTP/UI tests, verify the rendered FM → Accounts → HO journey with synthetic data, inspect the final diff, then run the dry-run cutover report. Deploy schema/code, explicitly authorize any business-record conversion, and enable financial UAT only after acceptance.

Do not ship a half-connected flow where FM sees Sent but Accounts has no linked item, or HO approves a requisition while payroll remains unlocked. Keep the old route gated/compatible until the complete bridge is ready.

## 11. Required verification and UAT acceptance

- FM factory source and Accounts Projects/HO source produce identical authoritative net values through their proper creator paths. No direct salary edits or manual re-entry.
- Repeat submission, browser retry, two Accounts users, concurrent sheet submission and late partial FM submission create one live liability and correct successor routing, including items returned before an otherwise Open Accounts salary sheet is submitted.
- Source changes between read/send/HO approval, concurrent calendar/master updates, overlapping source runs and simultaneous monthly statutory finalization all fail atomically or retry safely.
- A full HO approval produces exactly one immutable payroll lock, statutory/advance application, bank debit and approved Accounts item. Failure at each stage leaves none of the partial effects. Repeating it adds nothing.
- Partial approval/Credit/forged salary amount, anonymous/inactive/unauthorized actor, self-approval, mobile-vs-UUID identity mismatch and generic CRUD/import/reopen bypasses are rejected server-side.
- Returning one employee preserves others. Salary return reaches FM/Accounts preparer; recipient return stays with Accounts. Resubmission pins the new revision and preserves the prior decision/history.
- Hold/close-review/rollover/dismiss/delete cannot duplicate or lose a salary claim. Existing non-payroll Accounts, credit, fund-request and subcontractor regressions continue to pass unchanged.
- Missing/wrong/stale beneficiary, invalid mode/cheque details, inactive debit bank, insufficient balance, zero/negative net, cutoff acceptance and disabled financial activation have clear recoverable behavior.
- Approved ≠ exported ≠ paid. Export retries and payment confirmations cannot double-debit or overpay; Register/payslip use correct snapshots and labels.
- UI: draft saved automatically, one primary action per role, clear receipt/status, useful blockers, bulk failure names rather than UUIDs, cancelled records hidden by default, direct links/back/refresh stable, responsive modal, loading/empty/error/pending states and role navigation.
- Run narrow payroll/linkage tests first, then isolated regression + DB/API contracts, relevant frontend tests/build/lint, and browser checks. Record which environment and actual test results; plan approval is not test evidence.

Acceptance scenario: FM sends three employees; they appear in one Accounts salary sheet; Accounts completes payment details and sends it to HO; HO approves A, returns B for salary correction and holds C. A has one finalized salary and one authorized ledger posting, B returns to FM, C remains held with no debit. FM corrects B and resubmits without another active payable claim. Accounts-created Projects and Head Office salaries complete the same downstream journey without an FM step. Actual payment is confirmed separately.

## 12. Approved decisions

The UI/routing direction is already requested. This plan additionally recommends: automatic dedicated Accounts salary sheets (no import/destination choice); three salary HO actions (Approve/Return/Hold, no arbitrary partial salary approval); existing bank-balance posting at HO approval with separate real payment confirmation; automatic cutoff proposal/acceptance within normal submission/approval; and narrow Accounts authority to maintain employee payment links without salary-edit rights. These contracts were approved by the user before implementation and supersede the earlier standalone payroll review workflow. Do not infer legal policy, cash payment support, new proration rules or statutory remittance automation from this integration.
