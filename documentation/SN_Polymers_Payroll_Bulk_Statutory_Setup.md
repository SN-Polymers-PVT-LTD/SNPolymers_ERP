# Bulk initial statutory profile setup

Current workflow and Accounts-only ownership are described in [Company deduction setup](SN_Polymers_Payroll_Company_Deduction_Setup.md), approved 26 October 2026. The sections below record the earlier implementation and are superseded where they describe manual scope entry or Admin setup access.

Accounts and Admin can apply one explicit statutory profile template to up to 100 selected active employees. Department, employee category and literal employee search identify a group; selection can include all matching employees independently of the current table page. No applicability or enrolment is assumed.

The template contains effective dates, canonical scope IDs, EPF/ESI/PT applicability, EPF/ESI enrolment, evidence and verification. Rates, formulas and thresholds remain in published deduction masters. One common scope can be assigned to the three schemes, with per-scheme scope overrides available. Accounts must exclude individual exceptions and acknowledge the selected facts. Editing underlying facts clears confirmation.

This creates initial profiles only (expected version zero). Existing timelines are protected, including profiles created after selection. Individual setup remains the correction and exception workflow. The common start date is clipped to each employee's joining date. Inactive employees, employees joining after a finite end date, invalid scope/evidence and conflicts with active pay-structure enrolment are rejected by PostgreSQL. Each employee write reuses the canonical audited profile RPC and is independently transactional. A result is returned for every selection; reruns cannot overwrite an existing profile. Concurrent submissions create at most one initial revision.

The candidate and bulk write APIs are Accounts/Admin only. Actor identity comes from the authenticated session; direct RPC access is service-role only. Migration 135 adds two RPCs without changing existing profile or deduction master semantics. Profile setup does not approve payroll or replace saved calculations; refresh/recalculate payroll explicitly after correcting source readiness.

## Enrolment reuse (migration 136)

Permanent and office employees do not reenter EPF/ESI enrolment in either statutory editor. Employee Management pay structures own those booleans. PostgreSQL derives new profile values from the latest dated permanent-pay source covering the profile start; an interval containing a documented change in enrolment must be split. If no dated pay source has been recorded, the Active Employee Management pay structure is reused. Missing pay setup is rejected. Existing immutable statutory revisions are preserved, and payroll's source-conflict safeguards remain enabled. Nonpermanent applicability/enrolment is not inferred or automatically exempted from permanent-pay flags; that separate decision is not part of removing duplicate permanent inputs.

## Category rules superseding manual applicability (migration 137)

Applicability and enrolment selectors are removed from both editors. EPF/ESI apply only through permanent/office pay enrolment; Casual/Local never receive them. PT applies automatically except for Local daily wagers. Forms collect scope/effective evidence for applicable schemes. Local payroll needs no statutory setup. PostgreSQL normalizes new profile values and rejects direct contrary inserts; calculation and locking enforce the same rule. A configured zero PT slab is evaluated normally. Existing saved drafts require explicit recalculation; existing locked records retain their recorded history.

## Consolidated location — 15 October 2026

Bulk and individual employee setup now live under Employee Management → Employee Payroll Setup. Admin can open a specific employee from the employee inspector's Maintain Payroll Setup action. Accounts have access only to this tab; employee-directory/pay-structure editing and exports remain Admin-only. The old standalone route and compatibility redirect are removed; direct employee links use the Employee Management tab. Shared mappings and published-master bindings are under Statutory Deduction Master. All existing backend profiles, history and payroll dependencies remain intact.
