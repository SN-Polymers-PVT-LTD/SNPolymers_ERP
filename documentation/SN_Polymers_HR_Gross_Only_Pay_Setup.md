# Gross-only employee pay setup

Client decision: 14 October 2026. Complete this separate change before the automatic populated payroll table.

New pay structures record pay basis, agreed gross, enrolment facts and active revision status. Removed Basic Salary, Staff Welfare and Other Fixed inputs from the form/current summary and from the strict create API. Removed fields cannot be supplied as forged API inputs. The public create_hr_pay_structure RPC now has seven parameters; it fills historical component columns with NULL. The former ten-argument function is renamed hr_create_legacy_pay_structure and revoked from public/browser/service roles. It preserves historical fixtures and existing append-only revision semantics; no ordinary UI or API can author components through it. Earlier migrations remain unchanged.

Published statutory master rates, ceilings, PT slabs and wage treatment remain authoritative. Existing engine behavior is deliberate: a new gross-only contract has the full unallocated amount in PACKAGE_BALANCE. Including missing component evidence blocks final net/locking; it never silently becomes zero. Accounts must explicitly choose the intended statutory wage basis, not rely on a hidden migration default. No published master, salary revision or locked result is rewritten. Existing profiles continue to establish employee applicability; a rate is not an enrolment decision.

Employee beneficiary setup already exists in the Employee Master create/edit form, independent of the pay modal. It uses the same Accounts beneficiary_master and indian_bank_master and stores hr_employees.beneficiary_id. Parent-form persistence and shared-master saving are covered by tests. No payment/bank-transfer behavior is added.


## Superseding cleanup decision — 26 October 2026

Migration 141 removes the old component-authoring helper and inlines the existing gross-only create RPC. Basic, Staff Welfare and Other Fixed are no longer supported statutory configuration components, contribution calculation inputs, current HR API fields, pay-history UI columns or employee export columns. Agreed gross is used directly, including when a stored pay revision still has old component amounts. Existing component-based statutory rules must be replaced explicitly, not silently mapped to gross. Historical database columns, published rules and locked audit snapshots remain stored but are not active contribution inputs. Accounts save itself supplies statutory-master confirmation; no manual confirmation dropdown or identity/date input remains.
