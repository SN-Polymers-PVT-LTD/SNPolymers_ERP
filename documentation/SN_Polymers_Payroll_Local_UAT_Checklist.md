# Payroll local UAT — 12 October 2026

Target: `employee_management`, isolated Docker Supabase `SNPolymersPayrollTests` (API 55421 / database 55422). Browser server is development mode with OTP `123456`; use synthetic accounts/employees only. Existing staged work, shared Supabase, financial posting gates and unrelated fixtures are preserved. No commit/push. Results distinguish browser observations, authenticated API/DB coverage and untested cases.

## Execution order

1. Inspect Docker/profile/server target; run complete automated backend and frontend suites, build/lint and DB contracts.
2. Restore/verify financial gate false and test clock `now()` before browser UAT; start local development servers pinned to isolated Supabase, with external notifications disabled.
3. Seed named synthetic UAT roles/employees and authoritative source records. Sign in through the UI with OTP `123456` as each role.
4. Execute checklist; capture outcomes and defects, retest related fixes. Leave servers/isolated stack running and write a final evidence report.

## Role happy paths

| ID | Role | Scenario | Expected | Result |
|---|---|---|---|---|
| H01 | All test roles | OTP login and logout | Correct identity/role, navigation changes; no external OTP delivery | Pass — browser: Admin, Accounts, HO, FM, JE, ZO, ungranted FM; API: all 8 synthetic accounts |
| H02 | Admin | Employee permanent/factory setup; beneficiary reference | Existing HR form and canonical beneficiary linking; masked payroll bank details | Pass — browser HR edit form/canonical saved beneficiary; HR/beneficiary writes covered by integration tests |
| H03 | Admin | Effective payroll policy setup | Fixed30/Actual Calendar proration, monthly package and rounding fields; draft/published history | Pass — browser selected both methods, saved/published PROJECTS_JE policy; publication history retained |
| H04 | Accounts | Statutory master and employee profile screens | Accounts configuration access, canonical schemes/scopes, effective dates and explicit evidence | Pass — browser Accounts masters/profile timeline/evidence controls; write/publication/profile validation covered by integration |
| H05 | FM | SNP and Fabric factory selection | Both granted scopes available; unrelated groups excluded | Pass — browser same FM sees all six SNP/Fabric groups; ungranted FM sees none |
| H06 | Accounts | Custom HO/Projects draft; select employee | Arbitrary valid range within assignment; canonical employee/row identity | Pass — browser created custom 2028-01-03–19 Projects sheet and empty-candidate recovery; employee selection/addition covered by API integration |
| H07 | FM | Factory custom draft and preview | Locked attendance/finalized leave references; factory wage/rule calculations | Pass — browser SNP/Fabric source-backed previews; custom factory draft coverage in payroll API integration |
| H08 | Accounts | Monthly permanent preview | Itemized gross/LOP, source revisions, statutory deduction/employer contribution separation | Pass — browser 30000.00 gross, 703.70 EPF, 29296.30 net; employer 925.93 separate |
| H09 | Preparer | Calculate then submit | Employee-level status/version/history; no sheet-wide approval | Pass — browser Accounts and FM save/submit each employee independently |
| H10 | Accounts | Factory independent review | FM submission forwards to HO queue | Pass — browser Accounts forwarded SNP and Fabric separately to HO |
| H11 | HO | Return one employee with reason | Returned row independent; other row remains reviewable | Pass — browser HO returned office/Fabric; SNP remained pending HO |
| H12 | Preparer | Correct note/range, recalculate/resubmit | Original versions preserved; correction reason and differences visible | Pass — browser FM corrected/recalculated/resubmitted Fabric; two immutable revisions and complete history |
| H13 | Accounts / HO | Prepare bonus/arrears, independent HO approve | Evidence, period linkage, history and one-time application plan | Pass — browser Accounts bonus preparation/HO approval; arrears/linkage/one-time application covered by integration |
| H14 | Accounts / HO | Advance preparation, HO plan approval/pause/resume | Approved installment/start, outstanding balance; preview never recovers money | Pass — browser advance 5000, installment 500; HO approval/pause/resume; outstanding unchanged |
| H15 | Accounts / HO | Cutoff proposal/independent approval | Versioned cutoff and actor history; no hardcoded dates | Pass — browser Accounts proposal v1 → independent HO approval v2; stale-source finalization denied |
| H16 | HO/Admin | Publish evidenced calendar days | Paid nonworking classification explicit; no automatic weekday inference | Pass — browser HO published explicit PAID Weekly Off for 2028-11-05; contradiction/immutability covered by integration |
| H17 | FM / Accounts / HO / Admin | Register search/group/department/period/status filters | Authorized rows, pagination and department totals; independent review/payment/posting labels | Pass — browser filters, exact totals, pagination, empty scopes and distinct statuses; cross-role report authorization checked by API |
| H18 | Authorized reporting roles | Excel register and department exports, printable summary | Authoritative precision, aggregate-only department report; diagnostic labeling | Pass — browser download success for register XLSX, department XLSX and printable HTML; actual XLSX/HTML bytes independently inspected by authenticated API |
| H19 | Authorized payroll roles | Diagnostic payslip | Clear diagnostic marker; incomplete net not guessed | Pass — browser blocked diagnostic watermark and unavailable net; saved evidence retained |
| H20 | HO/Admin | Final lock attempt with server gate disabled | Explicit blocker; no Locked salary, financial snapshot or posting created | Pass — browser and API FINANCIAL_FINALIZATION_DISABLED; later cutoff staleness denied without state mutation |
| H21 | DB integration only | Fully configured guarded finalization | Atomic immutable salary/coverage/month/statutory/adjustment records; temporary gate restored | Pass — isolated owner-only PostgreSQL suite; final gate false and clock now verified |
| H22 | Accounts/HO/Admin / linked employee | Official payslip from immutable fixture | Locked snapshot only, masked bank details; linked identity verified | Pass — browser Accounts and linked JE immutable payslip/masked bank; API Admin/HO/Accounts/JE access |

## Permissions and workflow edge cases

| ID | Scenario | Expected | Result |
|---|---|---|---|
| A01 | JE/ZO open review/register/statutory setup directly | Unauthorized routes/API blocked; own employee payslip remains identity-scoped | Pass — browser JE register and ZO review/statutory redirect; authenticated API JE/ZO all forbidden |
| A02 | FM open HO/Projects salary or ungranted factory | Backend denies scope; no unrelated names or salaries | Pass — browser/API FM office denied; ungranted FM empty queue and factory detail denied |
| A03 | HO/FM attempt statutory setup; Accounts policy administration | Administrative role boundaries preserved | Pass — authenticated API HO/FM statutory and Accounts policy administration forbidden; no master data returned |
| A04 | Self-approval or wrong reviewer transition | Denied by backend/database, no history mutation | Pass — API wrong reviewer denied; self-approval/current-role guards in PostgreSQL/API regression |
| A05 | Blank return/correction/approval evidence or stale version | Validation/409; existing values/history retained | Pass — browser reason-gated buttons/stale-source check; validation/CAS regression passed |
| A06 | Duplicate submit/approve/lock; bulk mixed returned/pending rows | Per-employee results; no double finalization or silent sheet approval | Pass — PostgreSQL/API concurrent/duplicate/mixed bulk regression; browser actions verified per employee |
| A07 | Legacy oversized period/source resolver failure | Metadata/history/withdraw/correction still accessible; structured source error | Pass — browser source_error, correction saved, withdrawal completed; audit verified through API |
| A08 | Legacy Admin-created draft ownership | No invented ownership handoff or bypass | Pass — payroll report/review regression preserves legacy Admin ownership; no handoff introduced |
| A09 | FM official download for another employee | Denied even if register visibility is permitted | Pass — browser/API FM official payslip forbidden |
| A10 | Unauthenticated/stale role/grant revoked account | Authentication/current database role and grant checks deny access | Pass — unauthenticated API denied; revoked grant/current-role regressions passed |

## Financial/source edge cases

| ID | Scenario | Expected | Result |
|---|---|---|---|
| E01 | Missing/unlocked/conflicting attendance or pending leave | Explicit blocker; no guessed wages/LOP/net | Pass — unit/PostgreSQL source blockers; browser missing statutory and outdated package sources explicit |
| E02 | February 28/29 and 31-day month LOP | Approved Fixed30/Actual Days formula and rounding | Pass — unit February 28/29 and 31-day cases |
| E03 | Joining/leaving partial month, inclusive endpoints | Selected published policy; effective source references retained | Pass — unit Fixed30/Actual Calendar inclusive employment cases; browser both policy options |
| E04 | Overlapping leave and paid weekly off/holiday inside unpaid range | No double deduction/sandwich; calendar evidence determines chargeable days | Pass — unit overlap/no-sandwich/calendar entitlement cases |
| E05 | Explicit whole-month no entitlement vs retained paid rest entitlement | Zero only approved exception; never automatic cap | Pass — unit explicit zero-entitlement vs paid-rest exception cases |
| E06 | Factory holiday ×1.5, Local double duty ×2, OT/comp-off interactions | No stacking/double counting; ambiguous evidence blocked | Pass — browser holiday 400+200 and double-duty 600 without OT; ambiguous/CO cases unit-tested |
| E07 | Special Package and effective salary change | Package diagnostics preserved and counted once; unresolved salary-change policy blocked | Pass — browser blocked Special Package retains 30000 total and component evidence; package/salary-change unit cases |
| E08 | Split runs, overlap, incomplete month or frozen allocation change | One entitlement/residual; conflict or reconciliation blocker | Pass — unit/PostgreSQL split-month residual, overlap, frozen entitlement and incomplete-month guards |
| E09 | Sub-paise split base/LOP allocations or unsupported LINE LOP | Explicit blocker instead of silently changing policy/monthly total | Pass — unit unsupported LINE LOP and sub-paise reconciliation blockers |
| E10 | Missing statutory profile/enrolment mismatch/canonical mapping/master/rule | Deductions/net unresolved, never shown as zero | Pass — browser unresolved deductions/net unavailable; profile/enrolment/canonical/master unit and integration cases |
| E11 | Published dated/open-ended master supersession, PT slabs/ceilings | Historical revision correct, no hardcoded values, immutable publication | Pass — statutory master/unit/PostgreSQL historical/open-ended/slab/ceiling/publication tests |
| E12 | Multiple statutory-month runs and later arrears | Collect residual only; unsupported timing/negative/original-month adjustment blocked | Pass — unit/PostgreSQL statutory residual accumulation, timing and adjustment guards |
| E13 | Advance duplicate recovery, balance residual, unapproved replan | Monthly allowance/outstanding ceiling; renewed independent approval; no preview application | Pass — browser unchanged advance balance; unit/PostgreSQL duplicate/monthly ceiling/replan guards |
| E14 | Negative or valid zero net | Negative blocks; complete zero can lock in guarded DB test with no payment obligation | Pass — unit negative-net blocker; PostgreSQL valid zero-net lock without payment |
| E15 | Source/beneficiary changes after saved review | Fingerprint stale; new review required, old versions intact | Pass — browser cutoff/ledger changes stale saved calculations; source/beneficiary regression cases |
| E16 | Concurrent independent locking vs duplicate locking | Different employees proceed; same employee serialized and only one snapshot | Pass — real-connection PostgreSQL independent and duplicate locking tests |
| E17 | Unrelated attendance/leave writes during open finalization | Proceed without payroll commit; related writers/phantom source inserts protected | Pass — PostgreSQL scoped-fence source-writer/concurrency cases |
| E18 | Concurrent factory revision dates and cutoff updates | Existing revision sequencing preserved; cutoff writer excluded during finalization | Pass — PostgreSQL factory revision sequencing and shared cutoff fence tests |
| E19 | Failure after snapshot insert; direct immutable record edits | Full rollback, history/snapshot/Locked records protected | Pass — PostgreSQL injected failure rollback and immutable history/snapshot guards |
| E20 | Department-only HTML; formula injection, empty/large exports | No employee salaries in aggregate report; safe spreadsheet cells and exact totals | Pass — authenticated department HTML/XLSX inspection; formula injection, empty, large/oversized exports in unit/API suites |
| E21 | UI loading/empty/error/search/pagination/refresh | Usable recovery, precise error states; no stale cross-role cached salaries | Pass — browser loading/search/date filtering/empty scopes/source error/retry/history/navigation; frontend suite |
| E22 | Payment/bank/statutory posting attempts | No enabled payment workflow or bank debit; independent informational states | Pass — gate false verified; no payment/bank/posting workflow activated or executed; permission/invariant regression |

## Evidence and final outcome

Completed local technical verification: all 54 checklist scenarios have browser and/or automated coverage, explicitly identified above. This is not client acceptance or production statutory-data verification. Evidence: `SN_Polymers_Payroll_Local_UAT_Report.md`. Financial activation remains false; the test clock is restored to `now()`. No real bank/payment transaction was performed.
