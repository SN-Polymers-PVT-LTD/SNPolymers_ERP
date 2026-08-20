# Requisition Sheet — Field Entry Types

Covers all three screens: the Bank Balance Master, the Requisition Sheet header, and
the Requisition Sheet line items.

**Role note:** there's no separate "accounts admin" tier — just the regular `accounts`
role, `ho`, and the one overall system `admin` that already exists elsewhere in the app.
Any "who edits this master" question below resolves to one of those three, not a new role.

## A. Bank Balance Master (`Entry_Screen_1`)

| Field | Entry Type | Who Enters | Notes |
|---|---|---|---|
| Name of the Bank | Manual — one-time setup, then reused as a dropdown source everywhere else | System Admin (the single overall admin — there's no separate "accounts admin" tier) | **Resolved:** the typo was in this sheet (Entry_Screen_1) — the correct three accounts, confirmed from Entry_Screen_2, are **CANARA SNP CA**, **CANARA SNP CC**, and **CANARA Esenco Fab CA**. This master needs updating to those exact names; the actual balance figures should be reconciled against the right account by whoever manages this, since it's not safe to assume a 1:1 old-label-to-new-label mapping. Still flagging for confirmation: should Accounts be able to add bank accounts themselves, or should this stay Admin-only? |
| Date of Balance | Manual | Accounts | Updated whenever Accounts reconciles against the actual bank statement. No auto-sync (no bank API). |
| Available Balance | Manual | Accounts | Baseline figure. Everything else (live banner, deduction) is calculated on top of this, not stored back into it. |

## B. Requisition Sheet — Header (one per sheet)

| Field | Entry Type | Who Enters | Notes |
|---|---|---|---|
| Requisition Sheet No | System-generated | System | Format: `<DDMMYYYY of creation>-<sequence for that date>`. Fixed at creation; doesn't change no matter how long the sheet stays open before submission (could be same-day, a few days, longer — no fixed limit). |
| Sheet Creation Date | System date (auto) | System | Set once, on creation — not editable after. |
| Sheet Status | System-derived | System | e.g. `Open` (Accounts still adding rows) → `Submitted` (sent to HO, no more rows can be added) — separate from each row's own `requisition_status`. |

## C. Requisition Sheet — Line Items (many per sheet)

### Accounts-entered fields

| Field | Entry Type | Who Enters | Notes |
|---|---|---|---|
| Line No | System-generated | System | Sequential within the sheet, purely for reference — not a separate requisition number. |
| Date | System date (auto) | System | Defaults to the date the row is added, not the sheet's creation date. |
| Account_Sub_Title | Dropdown with search/filter — Master list | Accounts | Sourced from `Account_Sub_Title_Master`. Search box inside the dropdown (list is long — same style as Material Master's search). The master itself is directly editable by the Accounts role, not gated behind Admin — there's no separate accounts-admin tier, so this is just part of the regular Accounts permissions. |
| Particulars | Manual | Accounts | Free text description. |
| Beneficiary A/c No | Manual | Accounts | Lookup key (with IFSC) into `beneficiary_master`. |
| Beneficiary Name | Autofill, overridable | Accounts | Auto-fills if the (A/c No + IFSC) pair is known; manual entry + auto-save-to-master if new. |
| Beneficiary IFSC | Autofill, overridable | Accounts | Same as above. |
| Beneficiary Bank Name | Autofill, overridable | Accounts | Same as above; validated against the Indian Banks master list. |
| Req_Amount | Manual, **required before sheet submission** | Accounts | Drives the live balance banner in real time as it's typed. |
| Debit Bank Ac Type | Dropdown — Bank Balance Master | Accounts | Sourced from the corrected three-account list above once the Bank Balance Master is fixed. |
| Payment Mode | Dropdown (fixed list: Bulk NEFT / NEFT / RTGS / Cheque, tbc), **required before sheet submission** | Accounts | Bulk NEFT rows don't use Cheque No/Date at all — see the export flow instead. |
| Cheque No | Manual, free text, no format validation | Accounts | Kept as-is (not renamed). Only meaningful when Payment Mode = Cheque; Accounts fills it in as applicable, no system-enforced format. |
| Cheque Date | Manual, no format validation | Accounts | Same as above. |

### HO-entered fields

| Field | Entry Type | Who Enters | Notes |
|---|---|---|---|
| HO Process | Dropdown (5 fixed values) | HO | Approved / Partially Approved / Returned for Correction / Hold / Rejected. |
| Ho_Pass_Amount | Auto-calculated if Approved (= Req_Amount, read-only) / Manual if Partially Approved | HO | This is the value that triggers the Bank Balance deduction. |
| HO_Remarks | Manual, required for Returned/Hold/Rejected | HO | Optional for Approved/Partially Approved. |

### Display-only, not stored on the line item

| Field | Entry Type | Who Sees It | Notes |
|---|---|---|---|
| Live Bank Balance Banner | Calculated, real-time, client-side | Accounts (pinned at top of the entry screen at all times) | Per bank account: Master Balance − already-approved deductions − running `Req_Amount` total from open, unsubmitted sheets. Built to cover multiple open sheets for correctness, though in practice the Accounts team is small and usually works one sheet at a time, so this rarely matters day-to-day. Not written to the database until HO actually approves a line item. |
