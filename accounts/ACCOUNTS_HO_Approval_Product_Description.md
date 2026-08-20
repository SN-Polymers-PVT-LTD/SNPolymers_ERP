# Accounts Department — HO Approval Requisition — Product Description

## 1. Problem

Payment requests to the bank currently move through the Accounts team informally,
with no shared record of what's been requested, what HO has approved, or what's
actually left in each account. There's no single place to see a live, correct
bank balance while a payment is being requested, no formal approval trail per
payment, and no repeatable way to hand a batch of approved NEFT payments to the
bank. This feature adds a proper **Requisition Sheet** workflow: Accounts batches
payment requests into a sheet, HO reviews and decides on each request
individually, approved amounts are deducted from a manually-maintained bank
balance the moment HO approves, and approved Bulk NEFT items can be exported in
the exact format the bank expects.

## 2. Roles

| Role | Capability in this feature |
| :--- | :--- |
| **accounts** | Maintains the Bank Balance Master, including adding new bank accounts and their balance figures; creates and fills Requisition Sheets; adds/edits line items while a sheet is Open; corrects a returned line item; runs the Bulk NEFT export. |
| **ho** | Reviews each submitted line item independently — Approve, Partially Approve, Return for Correction, Hold, or Reject. Sees Accounts-entered fields read-only for context. |
| **admin** | The one overall system admin (no separate "accounts admin" tier). Grants `ho.requisition.reopen` selectively to specific HO users. |

There is deliberately no separate accounts-admin role — anything an "admin" does
in this module is done by the same single overall system admin used elsewhere in
the platform.

## 3. Bank Balance Master

A small, manually-maintained reference table — there's no bank API, so nothing
here syncs automatically.

| Field | Entry Type | Who Enters |
| :--- | :--- | :--- |
| Name of the Bank | One-time setup, then reused as a dropdown source everywhere else | Accounts |
| Date of Balance | Manual, updated whenever Accounts reconciles against a bank statement | Accounts |
| Available Balance | Manual baseline figure | Accounts |

The three accounts are **CANARA SNP CA**, **CANARA SNP CC**, and **CANARA Esenco
Fab CA**. Available Balance is a baseline only — approved deductions and the live
projection (§7) are calculated on top of it, never stored back into it.

## 4. The Requisition Sheet

A **Requisition Sheet** is a batch container that Accounts fills with many
line-item payment requests before sending the whole batch to HO. It is not
itself an approval unit — approval happens per line item (§5).

- **Sheet number:** `<DDMMYYYY of creation>-<sequence for that date>`, assigned
  once at creation and never changed, regardless of how long the sheet stays
  Open. An emergency same-day sheet just gets the next sequence number for that
  date.
- **No fixed accumulation window** — a sheet might be filled in a single sitting
  or stay open for a week or more; there's no forced deadline.
- **Multiple Accounts users can have sheets open concurrently**, and open sheets
  are visible to the whole Accounts team, not just their creator.

| Sheet Status | Meaning | Who can act |
| :--- | :--- | :--- |
| **Open** | Accounts is actively adding/editing rows. Not visible to HO. | Accounts — full edit on every row, add/remove freely |
| **Submitted** | Sent to HO. No new rows can be added; every row now carries its own independent `requisition_status`. | No one at the sheet level — control passes to each row |

To submit, every row must have `Req_Amount` and `Payment Mode` filled (plus
`Cheque No` / `Cheque Date` where Payment Mode = Cheque). Once submitted, a
sheet cannot be un-submitted — a forgotten item needs a new sheet.

## 5. Line Item — State Machine

Only exists once the parent sheet is Submitted. First time through,
`ho_process` is null — "Pending HO Review" is simply the absence of a decision,
not a stored value.

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

**The 5 `ho_process` values:**

- **Approved** — `Ho_Pass_Amount` auto-set to `Req_Amount`, read-only. Bank
  balance deducted by `Ho_Pass_Amount` against `Debit Bank Ac Type`.
- **Partially Approved** — `Ho_Pass_Amount` is a manual entry, `> 0` and
  `≤ Req_Amount`. Same deduction behavior as Approved, using the lower figure.
- **Returned for Correction** — `HO_Remarks` required. Row hands back to
  Accounts. On resubmit, `revision_number += 1` and status returns to Pending HO
  Review; the prior `ho_process` value and remark stay visible as a read-only
  "Last HO action" tag until HO decides again.
- **Hold** — `HO_Remarks` required. Doesn't touch any Accounts-side field. Shows
  a days-on-hold indicator so it doesn't get forgotten.
- **Rejected** — `HO_Remarks` required. Fully locked except via the reopen path.

**Reopen** (a flag on Pending HO Review, not a distinct status) is available from
Rejected only, requires the `ho.requisition.reopen` permission (admin-granted
per HO user, not automatic), and requires a mandatory remark. It hands the row
back to HO for a fresh decision — **not** back to Accounts, since it assumes the
original data was fine and HO wants to revisit their own call. This is the key
difference from Returned for Correction, which assumes the data was wrong. A
reopened row carries a permanent "Reopened on [date] by [user]" badge, even
after it's later approved.

## 6. Field Ownership

**Accounts-side fields** — editable while the parent sheet is Open, and again on
an individual row while that row is Returned for Correction. Read-only
everywhere else, permanently.

`Account_Sub_Title`, `Particulars`, `Beneficiary A/c No`, `Beneficiary Name`
(autofill), `Beneficiary IFSC` (autofill), `Beneficiary Bank Name` (autofill),
`Debit Bank Ac Type`, `Req_Amount`, `Payment Mode`, `Cheque No`, `Cheque Date`.

`Req_Amount` and `Payment Mode` are required before a sheet can be submitted.
`Cheque No` / `Cheque Date` only matter when Payment Mode = Cheque, and stay
free text with no enforced format.

**HO-side fields** — editable only while a row is Pending HO Review or On Hold;
read-only or hidden (where genuinely never applicable) everywhere else.

| `requisition_status` | HO_Pass_Amount | HO_Remarks |
| :--- | :--- | :--- |
| Pending HO Review | Editable | Editable — required if Returned/Hold/Rejected, optional if Approved/Partially Approved |
| On Hold | Read-only | Editable — this cycle's Hold reason |
| Returned for Correction | Hidden | Read-only after save |
| Approved / Partially Approved | Read-only, locked | Read-only |
| Rejected | Hidden | Read-only, locked |

`Payment Mode` / `Cheque No` / `Cheque Date` are always read-only for HO —
visible as reference alongside the decision, never editable by HO.

Fields are always **disabled**, never hidden or deleted, when a row is on Hold
or Returned for Correction — so previously entered data is never lost from view.

## 7. Live Bank Balance Banner

Pinned at the top of the line-item entry screen for Accounts, and also shown to
HO while deciding on a row (for that row's `Debit Bank Ac Type`).

**Calculation (per bank account, client-side, real-time):**
Master Balance − already-approved deductions − running `Req_Amount` total from
any currently-open, unsubmitted sheet(s).

It updates live as `Req_Amount` is typed, is never written to the database until
HO actually approves a line item, and is built to account for multiple
concurrently open sheets for correctness — though in practice the Accounts team
is small and usually works one sheet at a time.

HO cannot approve a row that would take an account's balance below zero.

## 8. Beneficiary Master — Autofill

**Table:** `beneficiary_master` — `id`, composite lookup key `(account_number,
ifsc)` (account number alone isn't safe since it isn't guaranteed unique across
banks), `beneficiary_name`, `beneficiary_bank_name` (validated against the
Indian Banks master list), standard audit columns, `last_used_at`.

**Flow:** Accounts types an account number → debounced lookup by
`(account_number, ifsc)` → if found, Name/IFSC/Bank auto-fill and lock, with an
override option that prompts to update the saved record; if not found, the
three fields unlock for manual entry and get upserted into `beneficiary_master`
on save. Same interaction pattern as the Materials Master autofill used
elsewhere in the platform.

## 9. Account_Sub_Title Master

Dropdown with an in-list search/filter (the list is long — same style as the
Material Master's search), sourced from `Account_Sub_Title_Master`. The master
is directly editable by the regular Accounts role, not gated behind Admin —
there's no separate accounts-admin tier for it to be gated behind.

## 10. Bulk NEFT Export

`Cheque No` / `Cheque Date` are never touched for Bulk NEFT rows; instead,
approved Bulk NEFT line items feed an export action.

- **Trigger:** Accounts selects a set of Approved / Partially Approved line
  items with `Payment Mode = Bulk NEFT`, within a single sheet (no
  cross-sheet batching).
- **Format:** one single export format — "Bulk Sheet 1" from `BULK_NEFT.xlsx` —
  used for all three accounts, with no entity-based split.
- **Output:** a downloadable `.xlsx` matching that format exactly — beneficiary
  name, account number, IFSC, bank, amount.
- **Reprint:** re-exporting the same rows is allowed by default, no hard lock.
  Built as a switchable capability in code (a flag on the row, or a config
  toggle) so one-export-only enforcement can be turned on later without a
  rebuild.

## 11. HO Review Queue

Groups pending line items by their parent sheet, rather than showing one flat
list across every sheet — so HO reviews a batch in context rather than as
disconnected rows.

## 12. Audit Trail

Logged as discrete events, separate from each other even where they touch the
same row:

- Sheet creation
- Sheet submission (who, when, sheet number, row count)
- Entry into Pending HO Review (first submission / resubmit / reopen, tagged
  distinctly)
- Return for Correction, and the later resubmit — logged as two separate events
- Entering and leaving Hold
- Approval (with amount and bank account debited)
- Rejection
- Reopen (logged distinctly from a normal resubmit)

## 13. Bank Account Creation

The regular Accounts role can add new bank accounts to the Bank Balance Master
itself — this isn't gated behind Admin.
