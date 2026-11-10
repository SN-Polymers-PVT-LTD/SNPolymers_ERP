# Factory-specific wage and pay-rule setup

Status: implemented and verified locally, 3 November 2026. Migrations 160 and 161 have been applied only to the isolated payroll test database. Development and production have not been migrated for this feature.

## Intended outcome

Factory Masters starts with Factory, then Worker type, then Applicable date. Factory choices are SNP Factory and Fabric Factory. Attendance and Pay Rules offers Permanent, Casual and Local within either factory. Daily Wage Master offers Casual and Local; Permanent salaries remain in Employee Pay Structures, with a clear explanation and navigation link rather than a second salary editor.

SNP Local and Fabric Local have independently effective-dated wages and pay-rule settings. Their calculation algorithms remain shared. Existing canonical employee categories stay unchanged: Local is still one employment category, distinguished by the employee's factory department. Do not create new employee categories or reclassify employees.

This changes the earlier documented shared Local master setup. The roster document and payroll business rules now distinguish shared calculation behavior from factory-specific configured values.

## Baseline before this implementation

- shared/hrEmployeeCategories.json already permits Local in both factories. Attendance identity includes date, employee category and factory department. The FM dashboard constructs all six rosters from this mapping.
- FactoryMasters.jsx and its query keys currently select only kind, category, date and page. There is no factory selector or department in master requests.
- hrFactoryMasters.schema.js accepts no department in create, list or effective lookup requests. The controller resolves current revisions per category.
- The wage and rule tables have category/date and category/revision uniqueness, without factory scope.
- The effective attendance-row guard from migration 102 picks wage and pay-rule revisions by category and attendance date, and saves their UUIDs on attendance.
- Payroll source RPCs load masters for assignment categories. sources.js selects the latest category revision and compares it with the attendance reference; it does not select by factory.
- Rule completion, period impact and payroll finalization use category source fences. Impact periods currently end at the next revision in the category, regardless of factory.
- The latest migration filename is 159_factory_unified_setup.sql. Verify this again before allocating the next migration number.

## 1. Database scope and migration

Add explicit factory department scope to wage and pay-rule revisions using the same canonical factory values already used by attendance and payroll assignments. Validate category/department pairs in PostgreSQL as well as the API.

New revisions require an explicit valid factory. Replace category-only uniqueness with scoped uniqueness for category, factory and effective date, and category, factory and revision number. Keep equivalent uniqueness for legacy unscoped rows using suitable partial indexes; a nullable column alone is insufficient. Allocate revision numbers within the same scope and serialize competing writes. Index the effective revision lookup.

Use forward migrations only. Do not edit applied migrations, update immutable master values, or rewrite existing attendance references. Regenerate schema, RPC and index manifests.

Preserve existing rows and UUIDs. For historical rows belonging to single-factory categories, their factory can be determined from the canonical mapping without rewriting their rates. Existing unscoped Local rows remain explicitly labelled shared legacy history; do not arbitrarily assign them to SNP or clone them silently into both factories.

## 2. Explicit historical compatibility

Define and test two resolution paths before changing lookups:

- Locked legacy attendance continues using the exact recorded revision UUIDs. Validate category, date and compatible historical factory scope. Do not let a newly created factory-specific revision replace that stored evidence merely because its date is later.
- New factory-scoped attendance resolves the latest explicitly configured revision for its factory, category and duty date. A missing Local factory setup blocks entry/submission with a clear message; it must not pick the other factory's rate or silently fall back to the old shared rate.

Draft and returned attendance keep the existing controlled edit flow. Where legacy combined sheets have null department, retain the legacy handling and require an explicit correction/allocation workflow instead of guessing a factory.

Create factory-specific settings through New revision, entering and reviewing the required values. The migration banner and earlier-values copy shortcut were retired at the client's request. Saving requires factory, effective date and reason and creates new audit history. It must show that SNP and Fabric need separate confirmation. No implicit seeding or backdating of rates. Historical corrections remain a separate explicit workflow.

## 3. Backend, attendance and payroll

- Extend existing list, effective lookup, wage creation and rule creation contracts with factory scope. Reject invalid pairs and ambiguous Local requests. Preserve existing role checks: Admin and Factory Manager author, HO reads; do not expand access.
- Include factory in revision numbering, current/future/historical status, pagination filters and audit context. Compare the next effective revision only within the same scope.
- Use one consistent scope-resolution contract across master APIs, attendance population/save/refresh and payroll source resolution; inspect every table caller rather than patching only the page.
- Keep stored wage/rule UUIDs authoritative for immutable legacy evidence. Include factory in new source data and source fingerprints. Validate the date-specific assignment's department, including transfers, rather than today's employee department or only the payroll run heading.
- Continue resolving calculation and treatment records through their parent rule UUID. New rule creation and Finish setup remain atomic and immutable.
- Make impact reports factory-aware for scoped rules, while old shared Local rules must still inspect both factories and frozen cross-factory source references. Preserve rejection of changes affecting locked payroll.
- Keep existing category source fences initially: they are conservative but safe across both factories and avoid a writer/finalizer lock mismatch. Factory-specific lock optimization is not required for this feature.
- Use existing automatic recalculation for affected unsubmitted drafts. Submitted, returned and locked review results remain protected. No financial activation or payment behavior changes.
- Extend existing RPC signatures deliberately without leaving ambiguous overloads; test old supported callers and update all current callers. Ambiguous Local calls must fail clearly rather than default to SNP.

## 4. Frontend

Use existing shared Select, Button, Modal, table and mobile card components, including the medium-yellow primary action style.

- Show Factory first and Worker type second. Derive the canonical category from the pair; use normal labels Permanent, Casual and Local.
- Permanent is available in Pay Rules. Daily Wages explains that Permanent salaries are maintained per employee and links to the existing pay-structure screen.
- Include department in URLs, query keys, form keys, submissions, impact context and success messages. Factory changes clear stale category choices, unsaved inputs, selection and pagination.
- Existing deep links for single-factory categories infer their only valid factory. Old Local links prompt for a factory; they must not silently choose SNP.
- History distinguishes factory-specific revisions from shared legacy records. Display an explicit missing-setup state for a selected factory rather than showing another factory's values.
- Preserve loading, empty, error and retry states; verify mobile cards, fixed modal Save action, browser navigation and read-only HO access.
- Keep FM dashboard links consistent with the same selection model.

## 5. Verification gates

Database and API:

1. Same date, same Local category: SNP can have wage 400 and Fabric 500 without conflict; each factory selects its own value.
2. A duplicate revision in one scope is rejected; another scope is unaffected. Effective-date boundaries and concurrent revision numbering remain deterministic.
3. Invalid factory/category pairs, omitted factory on new Local writes, inactive actors and unauthorized roles are rejected.
4. New Local attendance cannot use the other factory's setup or an implicit shared fallback.
5. Locked legacy attendance, existing revision UUIDs, frozen payroll snapshots and audit records remain unchanged.
6. Transfers use the factory assignment applicable on each duty date. Existing legacy combined Local sheets are not silently attributed.
7. Rule completion is atomic. Scoped impact counts and legacy shared impact both protect affected locked payroll; concurrent finalization remains fenced.
8. A permitted source change updates only affected unsubmitted drafts; reviewed or locked amounts do not change silently.

Calculation:

- Both Local rosters retain identical single/double duty, short-hours, unpaid-leave, no-holiday and double-duty-no-OT algorithms, while using their selected factory's values.
- Permanent and Casual existing arithmetic is unchanged. Verify overtime, missing-hours deductions, rounding, statutory wage inputs and monthly reconciliation against known amounts.
- The deferred Casual short-holiday premium issue is explicitly outside this feature. Do not silently fix or redefine it here.

Frontend:

- All six factory/type combinations on Pay Rules; four daily-wage combinations; correct Permanent salary navigation.
- Factory-aware deep links, back/forward state, cache isolation, category reset, pagination, role visibility and form success/error behavior.
- Desktop and narrow mobile visual inspection.

Run focused regressions first, then isolated database contracts and related payroll financial/review suites, frontend tests, lint and production build. Run graphify update after implementation. Report fresh results; prior passing test counts are not evidence for this change.

## Delivery order

1. Update the authoritative business documents with the clarified scope.
2. Implement forward schema changes and explicit legacy/scoped resolution, with database tests.
3. Update backend contracts, attendance binding, payroll sources and impact checks.
4. Add the factory/type UI and migration/adoption messaging.
5. Run financial and UI verification, inspect migration/manifests and review the diff.
6. Apply the migration to development and perform a controlled UAT setup of SNP Local and Fabric Local using explicitly approved dates and amounts. Do not assume previous UAT rates or readiness remain current.

No commit or push has been performed. Development adoption remains pending: enter explicitly approved effective dates, rates and reasons separately for each factory. Old shared Local settings are retained as legacy evidence; new Local attendance requires factory-specific wage and pay rules. A legacy combined Local sheet must use an explicit correction workflow rather than silently assigning its workers to one factory.


## Implementation and compatibility details

- Migration 160 adds factory scope, scoped unique indexes, legacy/scoped attendance resolution, and factory-aware preview sources and impact periods. Existing category identities and historical master UUIDs are preserved.
- Migration 161 makes the revision guard execute its private source-fence helper safely and rejects new wage/rule revisions overlapping locked payroll in the same factory.
- The original category-wide source fence remains in place. Immutable revision inserts serialize with a finalization fence; finalization retries while a source writer owns the fence. The factories have independent values and sequences, while this conservative concurrency boundary remains shared.
- Existing single-factory category callers may omit department and have their only valid factory inferred. Local callers must supply department and a setup reason. API writes remain Admin/FM only; HO remains read-only.
- Existing attendance has master_scope_version zero and resolves its stored rule/wage UUIDs. New or explicitly edited attendance is version one and binds exact factory scope. No implicit shared fallback exists for new Local attendance.
- The page uses the existing Factory Masters view and shared UI components. Factory, worker type and date are URL state and query-cache identity. New revision opens the normal category defaults with a blank effective date and reason. The migration banner and copy-only form state have been removed; Revision History and Finish setup remain available.
- Test fixtures isolate their synthetic rosters and search their uniquely named users, so accumulated local test history does not silently change the asserted population.


## Verification results — 3 November 2026

- Isolated local Supabase profile `payroll`, project `SNPolymersPayrollTests`: migrations 160–161 applied successfully; 17 selected database/integration files, 186 tests passed together. Includes API authorization, factory scope, attendance workflow and calendars, historical references, immutable revisions, concurrency, payroll preview/review/financial tests and schema/RPC/index contracts.
- Backend unit suite: 30 files, 270 tests passed.
- Backend deployment and boot contracts: 2 files, 16 tests passed. Initial sandbox-only EPERM failures were resolved by running these tests with local server/process permissions.
- Factory Masters and FM dashboard frontend tests: 2 files, 31 tests passed. Scoped page lint, production build and git diff whitespace check passed.
- Browser QA used a synthetic Admin against the isolated local API, not development. Factory switching preserves worker type; Pay Rules exposes Permanent/Casual/Local, wages Casual/Local. Desktop and 390×844 mobile inspected, including the shared setup modal with a fixed Save button. Mobile document width equalled viewport width (390px).
- Known amounts: independent same-date Local wages ₹400 and ₹500 produce Double Duty gross ₹800.00 and ₹1,000.00 with no OT line. New scoped rates do not replace legacy locked attendance references. Same-factory locked payroll rejects overlapping revisions; the other factory remains available.
- Generated database manifests refreshed from the isolated database. Development migration and actual UAT master adoption remain pending. The separately deferred Casual short-holiday premium issue remains outside this implementation.

## Merge-review follow-up — 3 November 2026

The broader review found two integration failures beyond the original focused checks. Both are now fixed:

- General audit search and global recent activity exclude every `HR ` module for non-admin readers, including the new overtime and attendance-pay audit types. Admin audit history remains available. New local regressions cover both modules, future HR module names, explicit searches, recent activity and Admin access.
- ZO balance user lookups split mapped IDs into batches of at most 100, then sort the combined results. A batch failure returns an error instead of partial balances. Unit coverage exercises 2,501 mapped users, bounded request size, complete results, preserved balance values, active-role filters and a failed batch.

Fresh verification after these fixes: all 107 isolated-local regression/contract files passed (851 tests); all 31 backend unit files passed (272 tests). The previously failing HR privacy and API serialization tests passed. Controller syntax checks and `git diff --check` passed; graph updated. No frontend or database schema changes were needed for these two fixes. Development remains unmigrated for 160–161, and no commit or push has been made.
