# Accounts Department – HO Approval Requisition: Business Logic

**Module:** Accounts Department
**Roles:** `accounts` (data entry) · `ho` (final reviewer) · `admin` (one overall system admin — no separate "accounts admin")

---

## 1. Roles & Structure

What Accounts fills is a **Requisition Sheet** — a batch container (own
auto-generated sheet number, own creation date) that accumulates many line-item rows
over however long it stays open. There's no fixed time limit on that — a sheet might
be filled in a single day or take a week or more.

More than one Accounts user can have a sheet open at the same time. Open sheets are
visible to the whole Accounts team, not just their creator.

The approval workflow applies **per line item**, not per sheet — HO can Approve one
row, Return another, and Hold a third within the same sheet. The sheet itself is just
the batching and numbering wrapper; it doesn't carry its own approval decision.

Sheet number format: `<DDMMYYYY of creation>-<sequence for that date>`, assigned once
at creation, never changes. If an emergency requisition needs its own sheet on the same
day an existing sheet is already open, the new sheet gets the next sequence number for
that date.

---

## 2. Sheet-Level Status

| Status | Meaning | Entered from | Who can act | Editable fields |
|---|---|---|---|---|
| **Open** | Accounts is actively adding/editing line items. Not visible to HO. | New sheet created | Accounts | All row fields, freely, on any row in the sheet |
| **Submitted** | Sent to HO. No new rows can be added; every row it contains now has its own independent `requisition_status`, starting at Pending HO Review. | Open (Accounts clicks Submit) | — (sheet itself has no further actions; individual rows take over) | None at sheet level — all further editing happens per line item, per its own status |

---

## 3. Line-Item Status — State Machine

Only exists once the parent sheet is Submitted.

```
                              Pending HO Review
                                      │
              ┌───────────────┬───────┼───────┬───────────────┐
              ▼               ▼       ▼       ▼               ▼
          Approved   Partially Approved   On Hold   Returned for   Rejected
         (terminal)     (terminal)          │        Correction   (terminal,
                                             │             │        soft-lock)
                       ┌──────────┬─────────┘             │             │
                       ▼          ▼                       ▼             │
                   Approved  Partially Approved    Pending HO Review    │
                                                     (revision +1,      │
                                                    Accounts edited)    │
                                                                        ▼
                                                     (authorized reopen only)
                                                          Pending HO Review
                                                       (flagged "Reopened")
```

---

## 4. Field Ownership

### Accounts-side fields
Editable while the parent sheet is **Open**, and again on an individual row while it's
**Returned for Correction**. Read-only everywhere else, permanently.

`Account_Sub_Title`, `Particulars`, `Beneficiary A/c No`, `Beneficiary Name` (autofill),
`Beneficiary IFSC` (autofill), `Beneficiary Bank Name` (autofill), `Debit Bank Ac Type`,
`Req_Amount`, `Payment Mode`, `Cheque No`, `Cheque Date`.

`Req_Amount` and `Payment Mode` are required before a sheet can be submitted.
`Cheque No`/`Cheque Date` are only relevant when Payment Mode = Cheque, kept as free
text with no enforced format — Accounts fills them in as applicable.

### HO-side fields
Editable only while a row is **Pending HO Review** or **On Hold**. Read-only (or
hidden, where genuinely never applicable) everywhere else.

| `requisition_status` | HO_Pass_Amount | HO_Remarks |
|---|---|---|
| Pending HO Review | Editable (auto = `Req_Amount` if Approved chosen; manual, `>0` and `≤ Req_Amount`, if Partially Approved chosen) | Editable — required if Returned/Hold/Rejected chosen, optional if Approved/Partially Approved |
| On Hold | Read-only (whatever was last entered, if anything) | Editable — this cycle's Hold reason |
| Returned for Correction | Hidden (never applicable this cycle) | Read-only after save |
| Approved / Partially Approved | Read-only, locked | Read-only |
| Rejected | Hidden | Read-only, locked |

`Payment Mode` / `Cheque No` / `Cheque Date` are always read-only for HO — visible as
reference alongside the decision, never editable by HO at any stage.

---

## 5. The 5 `ho_process` Values

**Approved** — `Ho_Pass_Amount` auto-set to `Req_Amount`, read-only. `requisition_status → Approved`. Bank balance deducted by `Ho_Pass_Amount` against `Debit Bank Ac Type`.

**Partially Approved** — `Ho_Pass_Amount` manual entry, `>0` and `≤ Req_Amount`. `requisition_status → Partially Approved`. Same balance deduction as Approved, using the (lower) passed amount.

**Returned for Correction** — `HO_Remarks` required. `requisition_status → Returned for Correction`, row hands back to Accounts. On resubmit: `revision_number += 1`, `requisition_status → Pending HO Review`; the prior `ho_process` value and remark stay visible as a read-only "Last HO action" tag until HO decides again.

**Hold** — `HO_Remarks` required. `requisition_status → On Hold`. Doesn't touch Accounts-side fields.

**Rejected** — `HO_Remarks` required. `requisition_status → Rejected`. Fully locked except via the reopen path below.

---

## 6. Status Directory

### Sheet: Open
- **Level:** Sheet
- **Entered from:** New sheet created by Accounts
- **Who can view:** The whole Accounts team
- **Who can edit:** Accounts — full edit on every row, add/remove rows freely
- **Required to exit:** every row must have `Req_Amount` and `Payment Mode` filled (plus `Cheque No`/`Cheque Date` where Payment Mode = Cheque) before the whole sheet can be submitted
- **UI treatment:** not shown anywhere in HO's queue; live balance banner active here
- **Audit trail:** sheet creation logs to the Audit Log
- **Notes:** an Open sheet can sit for any length of time — a day, a week, longer — with no forced deadline

### Sheet: Submitted
- **Level:** Sheet
- **Entered from:** Open (Accounts clicks Submit)
- **Who can view:** Accounts (read-only), HO
- **Who can edit:** No one at the sheet level — control passes to each row's own status
- **UI treatment:** appears in HO's queue, grouped by sheet number
- **Audit trail:** submission event logged (who, when, sheet number, row count)
- **Notes:** cannot un-submit; a forgotten item needs a new sheet, not reopening this one

### Line item: Pending HO Review
- **Level:** Line item
- **Entered from:** Sheet submission (first time) · Returned for Correction resubmit · Rejected reopen
- **Who can view:** Accounts (read-only), HO
- **Who can edit:** HO only — `HO Process`, `Ho_Pass_Amount`, `HO_Remarks`
- **UI treatment:** HO's action queue, grouped by parent sheet. HO also sees the live balance projection for the row's `Debit Bank Ac Type` while deciding; approving into a negative balance is blocked. All Accounts-entered fields shown read-only for context. On a resubmit/reopen, the previous `ho_process` value and remark show as a read-only history tag above the fresh decision fields
- **Audit trail:** entry into this status is itself an event (submitted / resubmitted / reopened)
- **Notes:** first time through, `ho_process` is null — there's no "pending" decision value stored, it's simply the absence of one

### Line item: Approved
- **Level:** Line item
- **Entered from:** Pending HO Review, On Hold
- **Who can view:** Accounts (read-only), HO (read-only), payments team
- **Who can edit:** No one — terminal, fully locked
- **UI treatment:** `Ho_Pass_Amount` shown equal to `Req_Amount`; Payment Mode/Cheque details shown as originally entered by Accounts
- **Audit trail:** approval event logged with amount and bank account debited
- **Notes:** this is also the point the Bank Balance Master gets deducted (§8)

### Line item: Partially Approved
- Same as Approved in every respect above, except `Ho_Pass_Amount` is HO's manually entered lower figure, and that's the amount deducted from the bank balance.

### Line item: Returned for Correction
- **Level:** Line item
- **Entered from:** Pending HO Review, On Hold
- **Who can view:** Accounts, HO
- **Who can edit:** Accounts — full edit on all Accounts-side fields for this row only
- **Required to exit:** Accounts resubmits (same field requirements as a fresh row)
- **UI treatment:** appears in Accounts' "needs correction" queue with HO's remark surfaced prominently; HO-side fields hidden (not applicable this cycle)
- **Audit trail:** the return event and the resubmit event are both logged separately
- **Notes:** only this specific row is affected — other rows in the same (already-submitted) sheet keep their own independent status

### Line item: On Hold
- **Level:** Line item
- **Entered from:** Pending HO Review
- **Who can view:** Accounts (read-only), HO
- **Who can edit:** HO only — can change `HO_Remarks`, or change `ho_process` to move it out of Hold entirely
- **UI treatment:** Accounts sees it as a locked, informational state; no action available to Accounts. The row shows how many days it's been on Hold, so it doesn't get forgotten
- **Audit trail:** entering and leaving Hold are both logged

### Line item: Rejected
- **Level:** Line item
- **Entered from:** Pending HO Review, On Hold
- **Who can view:** Accounts (read-only), HO
- **Who can edit:** No one, except the reopen action itself
- **UI treatment:** fully locked, shown with rejection remark
- **Audit trail:** rejection event logged
- **Notes:** reopening (below) does **not** hand the row back to Accounts

### Line item: Reopened (flag on Pending HO Review, not a distinct status)
- **Level:** Line item
- **Entered from:** Rejected, via a user holding `ho.requisition.reopen`
- **Who can view:** Accounts (read-only), HO
- **Who can edit:** HO — same as any Pending HO Review row
- **Required:** mandatory remark explaining the reopen
- **UI treatment:** permanent "Reopened on [date] by [user]" badge that persists even after the row is later approved
- **Audit trail:** reopen event logged distinctly from a normal resubmit
- **Notes:** the underlying Accounts-entered data is untouched — Reopen and Returned for Correction serve different purposes. Returned for Correction assumes Accounts' data is wrong and needs fixing. Reopen assumes the data was fine and HO wants to revisit their own decision — it does not give Accounts a chance to edit anything

---

## 7. Beneficiary Master — Autofill on Account Number

**Table:** `beneficiary_master` — `id`, `account_number` + `ifsc` (composite lookup
key — account number alone isn't safe, since it's theoretically not unique across
banks), `beneficiary_name`, `beneficiary_bank_name` (validated against the Indian Banks
master list), standard audit columns, `last_used_at`.

**Flow:** Accounts types the account number → debounced lookup by `(account_number,
ifsc)` → if found, Name/IFSC/Bank auto-fill and lock with an override option that
prompts to update the saved record; if not found, the three fields unlock for manual
entry and get upserted into `beneficiary_master` on save.

---

## 8. Bank Balance Guardrail

The Bank Balance Master (manually maintained by Accounts, no bank API) is deducted the
moment `ho_process` becomes Approved or Partially Approved, keyed to `Ho_Pass_Amount`
against the row's `Debit Bank Ac Type`. There is no separate "Paid" status.

On top of that committed baseline, both Accounts (while filling a sheet) and HO (while
deciding on a row) see a **live projected balance** per bank account: Master Balance −
already-approved deductions − running `Req_Amount` total from any currently-open,
unsubmitted sheet(s). This projection is client-side and never written to the database
until HO actually approves a line item. HO cannot approve a row that would take an
account's balance below zero.

Bank accounts: **CANARA SNP CA**, **CANARA SNP CC**, **CANARA Esenco Fab CA**.

---

## 9. Reopen Permission

Distinct from the base `ho` role — `ho.requisition.reopen` — granted selectively by the
one system Admin to specific HO users, not automatically held by every HO reviewer.

---

## 10. Bulk NEFT Export

`Cheque No` / `Cheque Date` only get filled in when `Payment Mode = Cheque`. Bulk NEFT
never touches them at all; instead, approved Bulk NEFT line items feed an export
action.

- **Trigger:** Accounts selects a set of Approved/Partially Approved line items where
  `Payment Mode = Bulk NEFT`, within a single sheet.
- **Format:** one single export format — "Bulk Sheet 1" from `BULK_NEFT.xlsx` — for all
  three accounts, no entity-based split.
- **Output:** downloadable `.xlsx` matching that format exactly — beneficiary name,
  account number, IFSC, bank, amount.
- **Reprint:** re-exporting the same rows is allowed by default — no hard lock. Built
  as a switchable capability in code (a flag on the row or a config toggle) so it can be
  turned on later without a rebuild if one-export-only ever needs enforcing.

---

## 11. HO Review Queue

HO's review queue groups pending line items by their parent sheet, rather than showing
one flat list across every sheet.
