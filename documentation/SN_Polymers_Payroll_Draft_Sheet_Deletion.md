# Delete draft payroll sheets

Client authorization: 14 October 2026. Add deletion to the populated payroll sheet after applying the synthetic employee-beneficiary seed to UAT.

The originating Factory Manager (factory sheet) or Accounts preparer (office sheet) can delete an unsubmitted sheet with a recorded reason. PostgreSQL checks the complete sheet, not the current table page. DRAFT, CALCULATED and RETURNED_TO_CREATOR rows can be cancelled; already-cancelled rows remain intact. A submitted, under-review, locked or other preparer's editable row blocks the entire operation. Empty sheets can be deleted. Repeating a successful deletion returns the existing cancellation without duplicating audit events.

Deletion is atomic cancellation, not physical removal. The container becomes CANCELLED_DRAFT with cancelled_by, cancelled_at and cancellation_reason. Per-employee transitions append the existing CANCELLED_DRAFT action history; salary content, calculation revisions and source evidence remain unchanged. A sheet audit event records the reason. Cancelled sheets cannot be edited, restored, repopulated or given new salary rows. Direct service writes are guarded too.

Cancelled containers disappear from review queues, preview selectors, salary registers and Excel exports. A direct sheet URL returns 404. Individual row audit detail remains available to authorized readers, with no action or fresh preview. Explicit audit detail is not an active payroll listing.

DELETE /api/v1/auth/hr/payroll/runs/:runId accepts a strict reason-only body; actor identity comes from authentication. cancel_payroll_draft_run(uuid,text,uuid) is service-only and independently checks active role, department and creator. The UI requires confirmation and a nonblank reason, preserves the sheet on errors and returns to the payroll list on success.

The deletion RPC takes an exclusive sheet lock. Review, individual additions/notes and cutoff writes take compatible shared sheet locks before their other locks, preserving independent employee concurrency while excluding deletion. Population retains its existing exclusive sheet lock. Submission/deletion racing in either order is covered by database/API tests. Database guards remain authoritative when the UI's progress is stale.

Migration 134 replaces current RPC definitions with the same signatures and existing financial behavior plus cancellation guards/filtering. It adds the cancellation metadata and service-only RPC; schema/RPC manifests are regenerated. Migrations 131–133 remain required prerequisites for the current scope, gross-only pay setup and automatic-generation UI.

Validation: 158 isolated payroll/HR/schema/RPC/index checks passed, including whole-sheet cancellation, submitted/HO/locked rejection, empty sheets, authorization, direct-write guards, retry idempotence, both submission races and existing independent financial locking.

Final verification: 220 backend unit tests and 99 frontend tests passed; production build, affected-file lint and git diff --check passed. The button/confirmation were inspected in the browser and dismissed without deleting the existing sheet.

UAT status: the synthetic beneficiary seed was applied idempotently; all 27 eligible employees already had synthetic links, 9 local workers remained unchanged and canonical bank names matched. Automated approval rejected the combined migration deployment; the user subsequently ran migrations 131–134. Their ledger entries and all 15 migration-134 function bodies were verified against the tested source. An empty-sheet cancellation/active-preview-exclusion smoke check passed in a rolled-back UAT transaction. The existing user payroll sheet remains DRAFT. No production change, commit or push was performed.
