# Automatic populated payroll sheets

Client decision: 14 October 2026. The separate gross-only Employee Management setup change (migration 132) was completed first.

## Workflow

Select payroll group/department, cycle and period, then Generate payroll. The server creates the sheet, clips each recorded assignment to its valid payable interval, populates employees and saves initial calculations using the existing payroll engine and employee review RPC. The resulting table shows saved gross, EPF/ESI/PT, net, review status, blockers and source-check results. Monetary values remain authoritative decimal strings; unavailable amounts never become zero.

Employees with no assignment history are reported for HR setup. Eligibility uses recorded dated history rather than inventing timelines from present-day categories. Multiple eligible intervals for the same employee are reported for deliberate selection because the database permits one employee row per sheet. Individual addition remains an exception; refresh calculates unfinished initial drafts. Population covers the whole eligible roster rather than the visible page and explicitly rejects more than 1000 matching employees.

Refresh serializes population on the sheet and adds missing rows without duplicates. It retries only untouched version-1 drafts without a calculation revision. Existing calculations, corrections, submitted/withdrawn/locked rows remain intact. Retained saved sources are checked and flagged CURRENT/CHANGED/UNAVAILABLE; checks describe the last refresh, not continuous monitoring. Recalculation is explicit, requires a reason and uses version checks. Submitted corrections still follow return/correct/recalculate workflow.

Initial calculation failure for one employee does not roll back successful peers. A created sheet is returned even if population fails, allowing recovery on the same sheet. The selected sheet is preserved in the URL for reopening after reload. A report/review evidence mismatch disables selection rather than submitting a revision whose amounts were not displayed. Existing source/version checks and maker-checker approval remain authoritative. Selection applies to the current page; per-employee results are shown.

## Authorization and API

- POST /api/v1/auth/hr/payroll/runs/generate: Accounts office payroll or FM factory payroll. Strict group/department/date/cycle body; actor and monetary overrides rejected.
- POST /api/v1/auth/hr/payroll/runs/:runId/generate: strict empty body, originating preparer only.
- populate_payroll_draft_run(run_id, actor_id): service-only RPC; role, department and owner checked in PostgreSQL before population.
- Reuse the existing review/bulk endpoint for explicit selected-row recalculation/submission. Finalization and payment are never invoked by generation.
- Other authorized FMs, Accounts, HO and Admin can read an authorized sheet table and open individual detail/review; generation and maker controls are hidden for non-creators.

Per-employee source resolution and calculation keep independent transaction boundaries; the table uses paginated register/queue queries instead of fetching detail for each visible row. Existing financial gates, canonical beneficiary linkage and immutable snapshots remain unchanged. Deployment requires migrations 132 and 133 with their matching API/UI. No production deployment, commit or push is included.

## Verification

Isolated local Supabase: 149 tests across 20 payroll/HR/schema/RPC/index files passed, followed by all 7 final generation regressions (including Accounts office generation and submitted-row preservation). Backend unit suite: 220 passed. Frontend affected HR/payroll suites: 83 tests across 11 files passed; production build and affected-file lint passed. Existing-sheet table layout was inspected in the local browser without generating or changing live salary records. Migrations were applied only to the isolated local test stack.
