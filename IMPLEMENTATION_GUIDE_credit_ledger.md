# Implementation Guide — Credit Purchases & the Credit Ledger

**Feature:** Let Accounts record a purchase made **on credit** from a dealer (no cash paid today) inside the existing Accounts Requisition Sheet, have HO approve it via a new **"Credit Approved"** decision, and track the resulting payable in a new **Credit Ledger** sub-module. Every later installment paid against that purchase is a normal cash line item, imported repeatably from the Credit Ledger until the balance reaches zero, at which point it moves from the ledger's active/import list into its history list.

**Audience:** an SDE (or LLM coding agent) picking this up cold. Every fact below — file paths, exact current function bodies, constraint names — was verified directly against `origin/accounts-dept` at commit `1e75149` (the branch this lands on, already carrying the prior "HO Close Review" feature, migrations through `041_close_review_pending_rollover.sql`). This is `042_...`.

---

## 1. Design decisions (locked in — do not re-litigate these)

1. **`Credit` never touches real bank balance.** A line item with Debit Bank Type = `Credit` skips `bank_balance_master` debit entirely — no cash moves when the original purchase is approved.
2. **The Credit Ledger is a genuinely new, repeatable-import mechanism** — not a reuse of the existing one-shot Hold/Reject/Pending-Review queue (`import_acct_line_item_transact`). A credit purchase must stay importable across *n* installments until its balance hits zero; the existing queue's `imported_to_sheet_id` marks a row used after exactly one import, which is the wrong shape here.
3. **Every installment is a normal cash payment** — real debit bank, real payment mode, decided via the existing Approve/Partially Approve flow. `Credit` as a debit-bank-type/payment-mode value only ever appears on the *original* purchase entry, never on an installment.
4. **`Credit Approved` is all-or-nothing** (parallel to `Approve`, not `Partially Approve`) — the full requested amount becomes the ledger's opening balance. Anything HO won't extend in full is just `Reject`ed (existing action, unmodified).
5. **Ledger grain: one row per purchase, not per dealer.** A dealer can have multiple simultaneous open credit purchases, each tracked independently. `beneficiary_master` (existing table) is the dealer identity — reused via a new FK, not duplicated into a new master table. A new `is_credit_dealer` boolean flag is added to `beneficiary_master` for filtering/reporting only; it is not load-bearing for the ledger mechanism itself (auto-set true on every Credit Approved, see §3.2).

---

## 2. Scope checklist

- [ ] DB: new migration `042_credit_purchases_and_ledger.sql`
- [ ] DB: `Credit` sentinel row in `bank_balance_master` (via `is_virtual` column, so it's selectable in the debit-bank dropdown but hidden from every balance-display screen)
- [ ] DB: widen `chk_arli_payment_mode` to add `'Credit'`
- [ ] DB: widen `chk_arli_status` / `chk_arli_ho_process` to add `'Credit Approved'`
- [ ] DB: new `credit_ledger` table
- [ ] DB: new `acct_requisition_line_items.credit_ledger_id` column
- [ ] DB: new `beneficiary_master.is_credit_dealer` column
- [ ] DB: new RPC `credit_approve_acct_line_item_transact`
- [ ] DB: new RPC `import_credit_installment_transact`
- [ ] DB: extend `approve_acct_line_item_transact` (installment path debits the ledger)
- [ ] DB: extend `approve_acct_line_item_transact` with a guard rejecting `Approve`/`PartiallyApprove` on a `Credit`-type item
- [ ] DB: extend `act_acct_line_items_batch_transact`'s dispatch with a `CreditApprove` branch
- [ ] DB: extend `submit_acct_sheet_transact`'s field-completeness check for `payment_mode = 'Credit'`
- [ ] DB: extend `audit_acct_line_item_events` with a `Credit Approved` branch
- [ ] Backend: `mapAcctRpcError` — new ERRCODEs
- [ ] Backend: `actOnLineItem` / `actOnLineItemsBatch` controller dispatch — `CreditApprove` branch
- [ ] Backend: `getCreditLedger`, `importCreditInstallment` controllers + routes
- [ ] Backend: Zod — `action` enum gains `CreditApprove`; `payment_mode` refine gains `'Credit'`
- [ ] Frontend: API functions for the two new endpoints
- [ ] Frontend: `HoDecisionPanel.jsx` — conditional action list (Credit-type items get `CreditApprove` instead of `Approve`/`PartiallyApprove`)
- [ ] Frontend: `LineItemRow.jsx` — `PAYMENT_MODES` gains `'Credit'`; `STATUS_VARIANTS` gains `'Credit Approved'`
- [ ] Frontend: `AcctHoSheetView.jsx` — `ACTION_TO_STATUS_LABEL` gains `CreditApprove`
- [ ] Frontend: filter the `Credit` sentinel bank out of 3 display sites (`AcctBankBalances.jsx`, `AcctRequisitionSheetView.jsx`, `AcctHoSheetView.jsx`)
- [ ] Frontend: new `AcctCreditLedger.jsx` page (Open / History toggle)
- [ ] Frontend: new `CreditLedgerImportModal.jsx`, wired into `AcctRequisitionSheetView.jsx`
- [ ] Frontend: route registration for the new page
- [ ] Tests + manual QA

---

## 3. Database changes

### 3.1 Why `Credit` needs a sentinel row in `bank_balance_master` — read this first

`acct_requisition_line_items.debit_bank_ac_type` has a real FK: `fk_arli_debit_bank FOREIGN KEY (debit_bank_ac_type) REFERENCES bank_balance_master(bank_name)`. There is no allowlist on this column in the Zod schema (`accountsLineItemBody.debit_bank_ac_type` just trims/nullifies empty string — the FK is the only real constraint). This means **`Credit` cannot be entered as a debit bank type unless a `bank_balance_master` row named `'Credit'` exists** — the FK will otherwise reject the insert outright.

Separately, `LineItemRow.jsx`'s debit-bank `<Select>` builds its options directly from the `bankBalances` prop (`bankOptions = bankBalances.map(b => ({ value: b.bank_name, label: b.bank_name }))`, line 119) — which is exactly `GET /acct-requisitions/bank-balances`'s result, passed down unfiltered from both `AcctRequisitionSheetView.jsx` and `AcctHoSheetView.jsx`. So inserting one sentinel row is also how `Credit` becomes selectable in that dropdown **with zero changes to `LineItemRow.jsx`'s dropdown logic.**

The catch: that same `bankBalances` array is *also* what three other places render as a real bank balance card — `BankBalanceBanner` (rendered from both sheet-view pages) and the bank list on `AcctBankBalances.jsx`. A `Credit ₹0.00` balance card would be confusing there. Fix: add `is_virtual boolean NOT NULL DEFAULT false` to `bank_balance_master`; the sentinel row gets `is_virtual = true`; the 3 display sites filter it out; `LineItemRow.jsx` keeps consuming the full unfiltered list so the dropdown is unaffected.

### 3.2 New migration file

`backend/src/db/migrations/042_credit_purchases_and_ledger.sql`

```sql
-- Migration 042: Credit purchases and the Credit Ledger
--
-- Lets Accounts record a dealer purchase made on credit (no cash paid today)
-- as a normal line item on the existing Accounts Requisition Sheet, using
-- new Debit Bank Type / Payment Mode = 'Credit' values. HO approves it via a
-- new all-or-nothing decision, 'Credit Approved' (parallel to Approve, never
-- Partially-Approved) which creates a credit_ledger row instead of debiting
-- any real bank. Each later installment against that ledger row is a
-- perfectly normal cash line item (real bank, real payment mode, normal
-- Approve/Partially Approve) that debits the ledger's remaining balance on
-- approval. The ledger is repeatably importable — unlike the existing
-- On Hold/Rejected/Pending Review queue's one-shot import
-- (import_acct_line_item_transact), the same purchase can be imported into
-- many future sheets, one per installment, until its balance hits zero.
--
-- Ledger grain is one row PER PURCHASE, not per dealer — a dealer can have
-- several simultaneously-open credit purchases, each paid down
-- independently. beneficiary_master is reused as the dealer identity (a new
-- is_credit_dealer flag is added for filtering/reporting only, auto-set on
-- every Credit Approved) rather than introducing a new master table.

-- ----------------------------------------------------------------------------
-- 1. bank_balance_master: is_virtual flag + the 'Credit' sentinel row.
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."bank_balance_master"
    ADD COLUMN "is_virtual" boolean NOT NULL DEFAULT false;

-- Seeded by a system account, not a real Accounts user — created_by/updated_by
-- are NOT NULL + FK'd to authorised_users, so this uses whichever mobile
-- number the seed script/admin runs as. Replace 'SYSTEM' below with a real
-- existing authorised_users.mobile_number before running this migration —
-- check `SELECT mobile_number FROM authorised_users WHERE role = 'admin' LIMIT 1;`
-- and substitute it in both created_by/updated_by values.
INSERT INTO bank_balance_master (bank_name, balance_date, available_balance, is_virtual, created_by, updated_by)
VALUES ('Credit', CURRENT_DATE, 0, true, 'SYSTEM', 'SYSTEM')
ON CONFLICT (bank_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. beneficiary_master: is_credit_dealer flag (reporting/filter only).
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."beneficiary_master"
    ADD COLUMN "is_credit_dealer" boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 3. acct_requisition_line_items: widen CHECK constraints, add credit_ledger_id.
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."acct_requisition_line_items" DROP CONSTRAINT "chk_arli_payment_mode";
ALTER TABLE "public"."acct_requisition_line_items" ADD CONSTRAINT "chk_arli_payment_mode"
    CHECK (payment_mode IS NULL OR payment_mode IN (
        'Cheque', 'Bulk NEFT', 'RTGS', 'NEFT', 'Credit'
    ));

ALTER TABLE "public"."acct_requisition_line_items" DROP CONSTRAINT "chk_arli_status";
ALTER TABLE "public"."acct_requisition_line_items" ADD CONSTRAINT "chk_arli_status"
    CHECK (requisition_status IS NULL OR requisition_status IN (
        'Pending HO Review', 'Approved', 'Partially Approved',
        'On Hold', 'Returned for Correction', 'Rejected', 'Pending Review',
        'Credit Approved'
    ));

ALTER TABLE "public"."acct_requisition_line_items" DROP CONSTRAINT "chk_arli_ho_process";
ALTER TABLE "public"."acct_requisition_line_items" ADD CONSTRAINT "chk_arli_ho_process"
    CHECK (ho_process IS NULL OR ho_process IN (
        'Approved', 'Partially Approved', 'Returned for Correction', 'Hold', 'Rejected',
        'Credit Approved'
    ));

ALTER TABLE "public"."acct_requisition_line_items"
    ADD COLUMN "credit_ledger_id" uuid;
-- FK added after credit_ledger exists below (table must exist first).

-- ----------------------------------------------------------------------------
-- 4. credit_ledger — one row per credit purchase.
-- ----------------------------------------------------------------------------
CREATE TABLE "public"."credit_ledger" (
    "id"                  uuid          DEFAULT gen_random_uuid() NOT NULL,
    "source_line_item_id" uuid          NOT NULL,
    "beneficiary_id"      uuid          NOT NULL,
    "opening_balance"     numeric(18,2) NOT NULL,
    "paid_total"          numeric(18,2) NOT NULL DEFAULT 0,
    "remaining_balance"   numeric(18,2) NOT NULL,
    "ledger_status"       varchar       NOT NULL DEFAULT 'Open',
    "created_by"          varchar       NOT NULL,
    "created_at"          timestamptz   DEFAULT now() NOT NULL,
    "updated_at"          timestamptz   DEFAULT now() NOT NULL,
    "settled_at"          timestamptz,
    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_cl_status" CHECK (ledger_status IN ('Open', 'Settled')),
    CONSTRAINT "chk_cl_opening_balance" CHECK (opening_balance > 0),
    CONSTRAINT "chk_cl_paid_total" CHECK (paid_total >= 0),
    CONSTRAINT "chk_cl_remaining_balance" CHECK (remaining_balance >= 0),
    CONSTRAINT "fk_cl_source_item" FOREIGN KEY (source_line_item_id) REFERENCES acct_requisition_line_items(id) ON DELETE RESTRICT,
    CONSTRAINT "fk_cl_beneficiary" FOREIGN KEY (beneficiary_id) REFERENCES beneficiary_master(id) ON DELETE RESTRICT,
    CONSTRAINT "fk_cl_created_by" FOREIGN KEY (created_by) REFERENCES authorised_users(mobile_number) ON DELETE RESTRICT
);

CREATE INDEX "idx_cl_beneficiary" ON credit_ledger (beneficiary_id);
-- Backs the import-list / history-list query (filter by status, sort by age).
CREATE INDEX "idx_cl_status_created" ON credit_ledger (ledger_status, created_at DESC);

ALTER TABLE "public"."acct_requisition_line_items"
    ADD CONSTRAINT "fk_arli_credit_ledger" FOREIGN KEY (credit_ledger_id) REFERENCES credit_ledger(id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 5. RPC: credit_approve_acct_line_item_transact
--    HO-only, all-or-nothing. Creates the credit_ledger row and
--    auto-upserts the dealer into beneficiary_master (flips
--    is_credit_dealer true) — Accounts never has to separately "register" a
--    credit dealer first.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."credit_approve_acct_line_item_transact"(
    p_line_item_id uuid,
    p_actioned_by  varchar,
    p_ho_remarks   text DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item           acct_requisition_line_items;
    v_beneficiary_id uuid;
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Pending HO Review' THEN
        RAISE EXCEPTION 'HO can only act on Pending HO Review items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    IF v_item.debit_bank_ac_type <> 'Credit' THEN
        RAISE EXCEPTION 'Credit Approved is only valid for line items with Debit Bank Type = Credit.' USING ERRCODE = 'VAL06';
    END IF;

    IF v_item.beneficiary_ac_no IS NULL OR v_item.beneficiary_ifsc IS NULL
       OR v_item.beneficiary_name IS NULL OR v_item.beneficiary_bank_name IS NULL THEN
        RAISE EXCEPTION 'Beneficiary (dealer) details are required before Credit Approved.' USING ERRCODE = 'VAL07';
    END IF;

    INSERT INTO beneficiary_master (account_number, ifsc, beneficiary_name, beneficiary_bank_name, is_credit_dealer, last_used_at, created_by, updated_by)
    VALUES (v_item.beneficiary_ac_no, v_item.beneficiary_ifsc, v_item.beneficiary_name, v_item.beneficiary_bank_name, true, now(), p_actioned_by, p_actioned_by)
    ON CONFLICT (account_number, ifsc) DO UPDATE
        SET is_credit_dealer = true, last_used_at = now(), updated_by = p_actioned_by, updated_at = now()
    RETURNING id INTO v_beneficiary_id;

    UPDATE acct_requisition_line_items
    SET requisition_status = 'Credit Approved',
        ho_process          = 'Credit Approved',
        ho_pass_amount      = v_item.req_amount,
        ho_remarks          = p_ho_remarks,
        ho_actioned_by      = p_actioned_by,
        ho_actioned_at      = now(),
        updated_at          = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    INSERT INTO credit_ledger (source_line_item_id, beneficiary_id, opening_balance, paid_total, remaining_balance, ledger_status, created_by)
    VALUES (p_line_item_id, v_beneficiary_id, v_item.req_amount, 0, v_item.req_amount, 'Open', p_actioned_by);

    RETURN v_item;
END; $$;
```

**A note before continuing** — this RPC deliberately raises `VAL06` if `debit_bank_ac_type <> 'Credit'` (prevents accidentally Credit-Approving a normal cash item) and `VAL07` if beneficiary fields are missing (belt-and-suspenders — §3.2 continued below also blocks this at submit time, closing the gap earlier).

```sql
-- ----------------------------------------------------------------------------
-- 6. approve_acct_line_item_transact: two changes —
--    a) guard against Approve/PartiallyApprove being used on a Credit-type
--       item (must use Credit Approved instead);
--    b) after a successful bank debit, if this item carries a
--       credit_ledger_id (i.e. it's an installment imported from the Credit
--       Ledger), also debit that ledger's remaining balance and flip it to
--       Settled once it reaches zero.
--    Full body reproduced from 037_terminal_hold_and_rejected.sql with only
--    those two additions — everything else (the bank-balance guardrail, the
--    BANK_DEBITED_PAYOUT audit row) is unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."approve_acct_line_item_transact"(
    p_line_item_id   uuid,
    p_ho_process     varchar,
    p_ho_pass_amount numeric,
    p_actioned_by    varchar,
    p_ho_remarks     text DEFAULT NULL
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item              acct_requisition_line_items;
    v_bbm               bank_balance_master;
    v_pass_amount       numeric(18,2);
    v_ledger_remaining  numeric(18,2);
BEGIN
    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status <> 'Pending HO Review' THEN
        RAISE EXCEPTION 'HO can only approve Pending HO Review items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    -- NEW: a Credit-type item must go through credit_approve_acct_line_item_transact.
    IF v_item.debit_bank_ac_type = 'Credit' THEN
        RAISE EXCEPTION 'This item was entered as Credit — use Credit Approved instead of Approve/Partially Approve.' USING ERRCODE = 'VAL09';
    END IF;

    IF p_ho_process = 'Approved' THEN
        v_pass_amount := v_item.req_amount;
    ELSIF p_ho_process = 'Partially Approved' THEN
        v_pass_amount := p_ho_pass_amount;
        IF v_pass_amount IS NULL OR v_pass_amount <= 0 OR v_pass_amount > v_item.req_amount THEN
            RAISE EXCEPTION 'ho_pass_amount must be > 0 and <= req_amount.' USING ERRCODE = 'VAL01';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid ho_process for approve RPC: %. Use the non-approve RPC for Hold/Return/Reject.', p_ho_process;
    END IF;

    -- NEW: if this is a credit-ledger installment, verify it before touching
    -- any real money — lock the ledger row now so a concurrent installment
    -- against the same purchase can't race past this check.
    IF v_item.credit_ledger_id IS NOT NULL THEN
        SELECT remaining_balance INTO v_ledger_remaining
        FROM credit_ledger WHERE id = v_item.credit_ledger_id FOR UPDATE;
        IF v_pass_amount > v_ledger_remaining THEN
            RAISE EXCEPTION 'Approved amount (%) exceeds this purchase''s remaining credit balance (%).',
                v_pass_amount, v_ledger_remaining USING ERRCODE = 'VAL10';
        END IF;
    END IF;

    SELECT * INTO v_bbm FROM bank_balance_master
        WHERE bank_name = v_item.debit_bank_ac_type FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bank Balance Master entry not found: %', v_item.debit_bank_ac_type USING ERRCODE = 'BNK01';
    END IF;

    IF v_bbm.available_balance - v_pass_amount < 0 THEN
        RAISE EXCEPTION 'Approval would drive % balance below zero. Remaining: %, Requested: %.',
            v_item.debit_bank_ac_type, v_bbm.available_balance, v_pass_amount USING ERRCODE = 'BAL01';
    END IF;

    UPDATE bank_balance_master
    SET available_balance = available_balance - v_pass_amount,
        updated_by = p_actioned_by
    WHERE id = v_bbm.id;

    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (p_actioned_by, 'BANK_DEBITED_PAYOUT', 'Bank Balance Master', v_item.debit_bank_ac_type,
            jsonb_build_object('available_balance', v_bbm.available_balance),
            jsonb_build_object('available_balance', v_bbm.available_balance - v_pass_amount,
                                'delta', -v_pass_amount, 'line_item_id', p_line_item_id,
                                'sheet_id', v_item.sheet_id, 'ho_process', p_ho_process));

    -- NEW: debit the credit ledger this installment belongs to, if any.
    IF v_item.credit_ledger_id IS NOT NULL THEN
        UPDATE credit_ledger
        SET paid_total        = paid_total + v_pass_amount,
            remaining_balance = remaining_balance - v_pass_amount,
            ledger_status     = CASE WHEN remaining_balance - v_pass_amount <= 0 THEN 'Settled' ELSE 'Open' END,
            settled_at        = CASE WHEN remaining_balance - v_pass_amount <= 0 THEN now() ELSE settled_at END,
            updated_at        = now()
        WHERE id = v_item.credit_ledger_id;
    END IF;

    UPDATE acct_requisition_line_items
    SET
        requisition_status     = CASE WHEN p_ho_process = 'Approved' THEN 'Approved' ELSE 'Partially Approved' END,
        ho_process             = p_ho_process,
        ho_pass_amount         = v_pass_amount,
        ho_remarks             = p_ho_remarks,
        ho_actioned_by         = p_actioned_by,
        ho_actioned_at         = now(),
        bank_balance_master_id = v_bbm.id,
        updated_at             = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;
```

```sql
-- ----------------------------------------------------------------------------
-- 7. RPC: import_credit_installment_transact
--    Repeatable — unlike import_acct_line_item_transact, does NOT mark the
--    source (credit_ledger row) as "used". The only gate is
--    ledger_status = 'Open' (i.e. remaining_balance > 0), which naturally
--    becomes false once approve_acct_line_item_transact's new block above
--    settles it. Only identity/beneficiary fields are prefilled — amount,
--    debit bank, and payment mode are deliberately left blank for Accounts
--    to fill in per-installment (an installment's amount varies each time,
--    unlike a Hold/Reject re-import which copies the original amount
--    unchanged).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."import_credit_installment_transact"(
    p_ledger_id       uuid,
    p_target_sheet_id uuid,
    p_imported_by     varchar
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_sheet_status varchar;
    v_ledger       credit_ledger;
    v_beneficiary  beneficiary_master;
    v_new_item     acct_requisition_line_items;
BEGIN
    SELECT sheet_status INTO v_sheet_status
    FROM acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.'; END IF;
    IF v_sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Installments can only be imported into an Open sheet.' USING ERRCODE = 'STA05';
    END IF;

    SELECT * INTO v_ledger FROM credit_ledger WHERE id = p_ledger_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Credit ledger entry not found.'; END IF;
    IF v_ledger.ledger_status <> 'Open' THEN
        RAISE EXCEPTION 'This credit purchase is already fully settled.' USING ERRCODE = 'STA09';
    END IF;

    SELECT * INTO v_beneficiary FROM beneficiary_master WHERE id = v_ledger.beneficiary_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dealer record not found.'; END IF;

    INSERT INTO acct_requisition_line_items (
        sheet_id, created_by, credit_ledger_id,
        particulars, beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name
    ) VALUES (
        p_target_sheet_id, p_imported_by, p_ledger_id,
        'Credit installment — ' || v_beneficiary.beneficiary_name,
        v_beneficiary.account_number, v_beneficiary.beneficiary_name,
        v_beneficiary.ifsc, v_beneficiary.beneficiary_bank_name
    ) RETURNING * INTO v_new_item;

    RETURN v_new_item;
END; $$;
```

```sql
-- ----------------------------------------------------------------------------
-- 8. act_acct_line_items_batch_transact: add the CreditApprove dispatch
--    branch. Full body reproduced from 027 with one new ELSIF — everything
--    else (per-item savepoint isolation) unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."act_acct_line_items_batch_transact"(
    p_actions      jsonb,
    p_actioned_by  varchar
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_action        jsonb;
    v_item_id       uuid;
    v_action_name   varchar;
    v_pass_amount   numeric(18,2);
    v_remarks       text;
    v_result        acct_requisition_line_items;
    v_results       jsonb := '[]'::jsonb;
BEGIN
    FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
    LOOP
        v_item_id     := (v_action->>'line_item_id')::uuid;
        v_action_name := v_action->>'action';
        v_pass_amount := NULLIF(v_action->>'ho_pass_amount', '')::numeric;
        v_remarks     := v_action->>'ho_remarks';

        BEGIN
            IF v_action_name IN ('Approve', 'PartiallyApprove') THEN
                v_result := approve_acct_line_item_transact(
                    v_item_id,
                    CASE WHEN v_action_name = 'Approve' THEN 'Approved' ELSE 'Partially Approved' END,
                    v_pass_amount,
                    p_actioned_by,
                    v_remarks
                );
            -- NEW
            ELSIF v_action_name = 'CreditApprove' THEN
                v_result := credit_approve_acct_line_item_transact(v_item_id, p_actioned_by, v_remarks);
            ELSIF v_action_name IN ('Hold', 'Return', 'Reject') THEN
                v_result := act_acct_line_item_non_approve_transact(
                    v_item_id, v_action_name, p_actioned_by, v_remarks
                );
            ELSE
                RAISE EXCEPTION 'Invalid action %.', v_action_name;
            END IF;

            v_results := v_results || jsonb_build_object(
                'line_item_id', v_item_id,
                'success', true,
                'item', to_jsonb(v_result)
            );
        EXCEPTION WHEN OTHERS THEN
            v_results := v_results || jsonb_build_object(
                'line_item_id', v_item_id,
                'success', false,
                'error_code', COALESCE(SQLSTATE, ''),
                'error_message', SQLERRM
            );
        END;
    END LOOP;

    RETURN v_results;
END; $$;
```

```sql
-- ----------------------------------------------------------------------------
-- 9. submit_acct_sheet_transact: require beneficiary fields for
--    payment_mode = 'Credit' at submit time too (same convention as the
--    existing Bulk NEFT clause) — catches a missing dealer identity before
--    it ever reaches HO, rather than only at Credit Approved time.
--    Full body reproduced from 033 with one added OR clause.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."submit_acct_sheet_transact"(
    p_sheet_id     uuid,
    p_submitted_by varchar
) RETURNS acct_requisition_sheets LANGUAGE plpgsql AS $$
DECLARE
    v_sheet     acct_requisition_sheets;
    v_row_count integer;
    v_invalid   integer;
BEGIN
    SELECT * INTO v_sheet FROM acct_requisition_sheets WHERE id = p_sheet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sheet not found.'; END IF;
    IF v_sheet.sheet_status <> 'Open' THEN
        RAISE EXCEPTION 'Sheet is already Submitted.' USING ERRCODE = 'STA01';
    END IF;

    SELECT COUNT(*) INTO v_row_count FROM acct_requisition_line_items WHERE sheet_id = p_sheet_id;
    IF v_row_count = 0 THEN RAISE EXCEPTION 'Sheet has no line items.'; END IF;

    SELECT COUNT(*) INTO v_invalid
    FROM acct_requisition_line_items
    WHERE sheet_id = p_sheet_id
      AND (req_amount IS NULL OR payment_mode IS NULL
           OR (payment_mode = 'Cheque' AND (cheque_no IS NULL OR cheque_date IS NULL))
           OR (payment_mode = 'Bulk NEFT'
               AND (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL))
           OR (payment_mode = 'Credit'
               AND (beneficiary_ac_no IS NULL OR beneficiary_ifsc IS NULL OR beneficiary_name IS NULL OR beneficiary_bank_name IS NULL)));
    IF v_invalid > 0 THEN
        RAISE EXCEPTION '% row(s) missing required fields.', v_invalid USING ERRCODE = 'VAL02';
    END IF;

    UPDATE acct_requisition_sheets
    SET sheet_status = 'Submitted', submitted_by = p_submitted_by,
        submitted_at = now(), row_count_at_submission = v_row_count, updated_at = now()
    WHERE id = p_sheet_id
    RETURNING * INTO v_sheet;

    UPDATE acct_requisition_line_items
    SET requisition_status = 'Pending HO Review', updated_at = now()
    WHERE sheet_id = p_sheet_id;

    RETURN v_sheet;
END; $$;
```

> Verify the tail of `submit_acct_sheet_transact` (the final two statements above, after the `RAISE EXCEPTION` block) against the live `033_add_line_item_transact_and_neft_beneficiary_check.sql` before running this — reproduced here from the same source, but confirm nothing between `033` and `041` touched this function (nothing found in this review, but double-check).

```sql
-- ----------------------------------------------------------------------------
-- 10. audit_acct_line_item_events: add a Credit Approved branch.
--     Full body reproduced from 041 with one new WHEN branch — everything
--     else identical.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."audit_acct_line_item_events"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_action VARCHAR;
  v_user   VARCHAR;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (NEW.created_by, 'LINE_ITEM_ADDED', 'Acct Requisition Line Item', NEW.id::VARCHAR, NULL,
            jsonb_build_object('sheet_id', NEW.sheet_id, 'req_amount', NEW.req_amount,
                               'payment_mode', NEW.payment_mode));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.requisition_status IS DISTINCT FROM OLD.requisition_status THEN

    CASE NEW.requisition_status

      WHEN 'Pending HO Review' THEN
        IF OLD.requisition_status IS NULL THEN
          v_action := 'PENDING_HO_REVIEW_FIRST_SUBMIT';
          v_user   := NEW.created_by;
        ELSIF NEW.reopened_at IS DISTINCT FROM OLD.reopened_at THEN
          v_action := 'REOPEN';
          v_user   := NEW.reopened_by;
        ELSIF NEW.revision_number > OLD.revision_number THEN
          v_action := 'RESUBMIT_AFTER_CORRECTION';
          v_user   := NEW.created_by;
        ELSE
          v_action := 'PENDING_HO_REVIEW_ENTER';
          v_user   := NEW.created_by;
        END IF;

      WHEN 'Approved', 'Partially Approved' THEN
        v_action := 'HO_APPROVED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'On Hold' THEN
        v_action := 'HO_HELD';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Returned for Correction' THEN
        v_action := 'HO_RETURNED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Rejected' THEN
        v_action := 'HO_REJECTED';
        v_user   := NEW.ho_actioned_by;
      WHEN 'Pending Review' THEN
        v_action := 'HO_CLOSED_REVIEW_UNDECIDED';
        v_user   := NEW.created_by;
      -- NEW
      WHEN 'Credit Approved' THEN
        v_action := 'HO_CREDIT_APPROVED';
        v_user   := NEW.ho_actioned_by;
      ELSE
        v_action := 'STATUS_CHANGE';
        v_user   := COALESCE(NEW.ho_actioned_by, NEW.created_by);
    END CASE;

    IF OLD.requisition_status = 'On Hold' AND NEW.requisition_status <> 'On Hold' THEN
      INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
      VALUES (NEW.ho_actioned_by, 'HO_HOLD_RELEASED', 'Acct Requisition Line Item', NEW.id::VARCHAR,
              jsonb_build_object('requisition_status', OLD.requisition_status, 'ho_remarks', OLD.ho_remarks),
              jsonb_build_object('requisition_status', NEW.requisition_status),
              clock_timestamp());
    END IF;

    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
    VALUES (v_user, v_action, 'Acct Requisition Line Item', NEW.id::VARCHAR,
            jsonb_build_object('requisition_status', OLD.requisition_status,
                               'ho_process', OLD.ho_process,
                               'ho_actioned_by', OLD.ho_actioned_by,
                               'revision_number', OLD.revision_number),
            jsonb_build_object('requisition_status', NEW.requisition_status,
                               'ho_process', NEW.ho_process,
                               'ho_pass_amount', NEW.ho_pass_amount,
                               'ho_actioned_by', NEW.ho_actioned_by,
                               'bank_balance_master_id', NEW.bank_balance_master_id,
                               'revision_number', NEW.revision_number,
                               'is_reopened', NEW.is_reopened),
            clock_timestamp());
  END IF;
  RETURN NEW;
END; $$;
```

**Error code summary added by this migration:** `VAL06` (Credit Approved used on a non-Credit item), `VAL07` (missing beneficiary for Credit Approved), `VAL09` (Approve/PartiallyApprove used on a Credit item), `VAL10` (installment amount exceeds remaining ledger balance), `STA09` (import attempted on a Settled ledger entry). Map all five in `mapAcctRpcError` (§4.1) — `VAL0x` → 400, `STA09` → 409 (matches the existing `STA05`-`STA08` convention).

---

## 4. Backend changes

### 4.1 `backend/src/controllers/acctRequisition.controller.js`

**a) `mapAcctRpcError`** — extend both groups:

```js
function mapAcctRpcError(rpcErr) {
  switch (rpcErr.code) {
    case 'STA01':
    case 'STA03':
    case 'STA05':
    case 'STA06':
    case 'STA07':
    case 'STA08':
    case 'STA09':                 // <-- add
      return { status: 409, message: rpcErr.message };
    case 'VAL01':
    case 'VAL02':
    case 'VAL03':
    case 'VAL04':
    case 'VAL05':
    case 'VAL06':                 // <-- add
    case 'VAL07':                 // <-- add
    case 'VAL09':                 // <-- add
    case 'VAL10':                 // <-- add
      return { status: 400, message: rpcErr.message };
    ...
```

**b) `actOnLineItem`** — add the `CreditApprove` branch to the existing if/else dispatch (around the `if (action === 'Approve' || action === 'PartiallyApprove') {...} else { // Hold|Return|Reject ... }` block):

```js
let data, rpcErr;

if (action === 'Approve' || action === 'PartiallyApprove') {
  ({ data, error: rpcErr } = await supabase.rpc('approve_acct_line_item_transact', {
    p_line_item_id: itemId,
    p_ho_process: action === 'Approve' ? 'Approved' : 'Partially Approved',
    p_ho_pass_amount: ho_pass_amount ?? null,
    p_actioned_by: req.user.mobile_number,
    p_ho_remarks: ho_remarks?.trim() || null
  }));
} else if (action === 'CreditApprove') {                       // <-- NEW
  ({ data, error: rpcErr } = await supabase.rpc('credit_approve_acct_line_item_transact', {
    p_line_item_id: itemId,
    p_actioned_by: req.user.mobile_number,
    p_ho_remarks: ho_remarks?.trim() || null
  }));
} else {
  // Hold | Return | Reject
  ({ data, error: rpcErr } = await supabase.rpc('act_acct_line_item_non_approve_transact', {
    p_line_item_id: itemId,
    p_action: action,
    p_actioned_by: req.user.mobile_number,
    p_ho_remarks: ho_remarks?.trim() || null
  }));
}
```

The existing pre-check a few lines above (`if (item.requisition_status !== 'Pending HO Review') return 409;`) already covers `CreditApprove` for free — no change needed there.

**c) New `getCreditLedger` controller** (mirrors `getImportEligibleItems`'s shape — fetch base rows, then batch-fetch related rows by id, merge in JS, same as every other list endpoint in this file):

```js
/**
 * GET /acct-requisitions/credit-ledger
 * ?status=Open (default) | Settled. Optional beneficiary name/date-range
 * filters. Open entries are the "importable" list a future installment can
 * be pulled from; Settled entries are history — same table, just a status
 * filter, not two separate lists.
 */
async function getCreditLedger(req, res) {
  try {
    const query = req.query || {};
    const status = query.status === 'Settled' ? 'Settled' : 'Open';
    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 20;
    if (limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    let dbQuery = supabase
      .from('credit_ledger')
      .select('*', { count: 'exact' })
      .eq('ledger_status', status);

    if (query.date_from) dbQuery = dbQuery.gte('created_at', query.date_from);
    if (query.date_to) dbQuery = dbQuery.lte('created_at', `${query.date_to}T23:59:59.999`);

    dbQuery = dbQuery.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data: ledgerRows, count, error } = await dbQuery;
    if (error) throw error;

    const beneficiaryIds = [...new Set((ledgerRows || []).map(r => r.beneficiary_id))];
    const sourceItemIds = [...new Set((ledgerRows || []).map(r => r.source_line_item_id))];

    let beneficiaryMap = {};
    if (beneficiaryIds.length > 0) {
      const { data: beneficiaries } = await supabase
        .from('beneficiary_master')
        .select('id, beneficiary_name, account_number, ifsc, beneficiary_bank_name')
        .in('id', beneficiaryIds);
      // NEW: dealer-name filter applied here (post-fetch) rather than a DB-side
      // .ilike on a joined table — Supabase JS can't filter on a related
      // table's column in one query without a Postgres view/RPC, and this
      // table is small enough per page that filtering post-fetch is fine.
      beneficiaryMap = (beneficiaries || []).reduce((acc, b) => { acc[b.id] = b; return acc; }, {});
    }

    let sourceItemMap = {};
    if (sourceItemIds.length > 0) {
      const { data: sourceItems } = await supabase
        .from('acct_requisition_line_items')
        .select('id, sheet_id, particulars')
        .in('id', sourceItemIds);
      const sheetIds = [...new Set((sourceItems || []).map(i => i.sheet_id))];
      let sheetMap = {};
      if (sheetIds.length > 0) {
        const { data: sheets } = await supabase.from('acct_requisition_sheets').select('id, sheet_number').in('id', sheetIds);
        sheetMap = (sheets || []).reduce((acc, s) => { acc[s.id] = s.sheet_number; return acc; }, {});
      }
      sourceItemMap = (sourceItems || []).reduce((acc, i) => {
        acc[i.id] = { particulars: i.particulars, sheet_number: sheetMap[i.sheet_id] || null };
        return acc;
      }, {});
    }

    let enrichedRows = (ledgerRows || []).map(row => ({
      ...row,
      beneficiary: beneficiaryMap[row.beneficiary_id] || null,
      source: sourceItemMap[row.source_line_item_id] || null
    }));

    if (query.dealer) {
      const term = query.dealer.toLowerCase();
      enrichedRows = enrichedRows.filter(r => r.beneficiary?.beneficiary_name?.toLowerCase().includes(term));
    }

    return res.status(200).json({
      success: true,
      entries: enrichedRows,
      pagination: { page, limit, total: count || 0, totalPages: Math.max(Math.ceil((count || 0) / limit), 1) }
    });
  } catch (error) {
    console.error(`getCreditLedger failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve credit ledger.' });
  }
}
```

**d) New `importCreditInstallment` controller:**

```js
/**
 * POST /acct-requisitions/credit-ledger/:ledgerId/import
 * body: { target_sheet_id }
 * Creates a new, mostly-blank line item on the target Open sheet, prefilled
 * only with the dealer's identity (import_credit_installment_transact,
 * 042) — Accounts fills in the actual installment amount, a real debit
 * bank, and payment mode afterward like any normal new row. Unlike
 * importLineItem (Hold/Reject/Pending Review), the source credit_ledger
 * row is untouched by this call — it stays importable again next time,
 * until its own balance is driven to zero by a later approval.
 */
async function importCreditInstallment(req, res) {
  const { ledgerId } = req.params;
  const { target_sheet_id } = req.body;

  try {
    const { data, error: rpcErr } = await supabase.rpc('import_credit_installment_transact', {
      p_ledger_id: ledgerId,
      p_target_sheet_id: target_sheet_id,
      p_imported_by: req.user.mobile_number
    });

    if (rpcErr) {
      const mapped = mapAcctRpcError(rpcErr);
      if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });
      throw rpcErr;
    }

    return res.status(201).json({ success: true, item: data, message: 'Installment line item created.' });
  } catch (error) {
    console.error(`importCreditInstallment failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to import credit installment.' });
  }
}
```

**e) `module.exports`** — add `getCreditLedger, importCreditInstallment`.

### 4.2 `backend/src/routes/acctRequisition.routes.js`

```js
const {
  ...,
  getCreditLedger, importCreditInstallment,   // <-- add
} = require('../controllers/acctRequisition.controller');
```

```js
router.get('/credit-ledger', requireRole(readerRoles), getCreditLedger);
router.post('/credit-ledger/:ledgerId/import', requireRole(accountsRoles), validateRequest(importCreditInstallmentSchema), importCreditInstallment);
```

Place both right after the existing `import-eligible-items` group at the bottom of the file. `readerRoles` (not `accountsRoles`) for the GET — same convention as `getLineItems`/`getSheets`, since HO may reasonably want to browse the ledger too, even though only Accounts imports from it.

### 4.3 `backend/src/validation/acctRequisition.schema.js`

**a) Widen the payment-mode refine:**

```js
payment_mode: z.string().trim().optional().nullable()
  .transform(val => (val === '' ? null : val))
  .refine(val => val == null || ['Cheque', 'Bulk NEFT', 'RTGS', 'NEFT', 'Credit'].includes(val), {
    message: 'payment_mode must be one of Cheque, Bulk NEFT, RTGS, NEFT, Credit.'
  }),
```

**b) Widen the action enum:**

```js
const acctLineItemActionFields = {
  action:         z.enum(['Approve', 'PartiallyApprove', 'CreditApprove', 'Hold', 'Return', 'Reject']),
  ho_pass_amount: z.coerce.number().positive().optional().nullable(),
  ho_remarks:     z.string().trim().optional().nullable(),
};
```

`acctLineItemActionRefine` needs **no change** — `CreditApprove` requires neither `ho_pass_amount` (all-or-nothing, like `Approve`) nor `ho_remarks` (not in the `['Return','Hold','Reject']` required-remarks list).

**c) New schema for the import endpoint:**

```js
const importCreditInstallmentSchema = {
  params: z.object({ ledgerId: uuidSchema }),
  body: z.object({ target_sheet_id: uuidSchema })
};
```

Add `importCreditInstallmentSchema` to `module.exports`.

---

## 5. Frontend changes

### 5.1 `frontend/src/components/acctRequisition/LineItemRow.jsx`

**a) `PAYMENT_MODES`** (line 22):
```js
const PAYMENT_MODES = ['Cheque', 'Bulk NEFT', 'RTGS', 'NEFT', 'Credit'].map(v => ({ value: v, label: v }));
```

**b) `STATUS_VARIANTS`** (line 12) — add `'Credit Approved': 'indigo'` (reuse `indigo`, same choice already made for `Pending Review` — both are "resolved, but not a normal cash approval" states; `emerald` stays reserved for `Approved`/`Partially Approved` real-money outcomes).

No change needed to `bankOptions` (line 119) — it already maps every `bankBalances` row including the new `Credit` sentinel, for free (§3.1).

### 5.2 `frontend/src/components/acctRequisition/HoDecisionPanel.jsx`

**Conditional action list** — a `Credit`-type item must never be offered plain `Approve`/`PartiallyApprove` (the backend now hard-rejects that with `VAL09`, but the UI shouldn't let HO pick it in the first place):

```jsx
const ACTION_OPTIONS_CASH = [
  { value: 'Approve', label: 'Approve' },
  { value: 'PartiallyApprove', label: 'Partially Approve' },
  { value: 'Hold', label: 'Hold' },
  { value: 'Return', label: 'Return for Correction' },
  { value: 'Reject', label: 'Reject' }
];

const ACTION_OPTIONS_CREDIT = [
  { value: 'CreditApprove', label: 'Credit Approved' },
  { value: 'Hold', label: 'Hold' },
  { value: 'Return', label: 'Return for Correction' },
  { value: 'Reject', label: 'Reject' }
];
```

Inside the component, pick the list based on the item:

```jsx
const actionOptions = item.debit_bank_ac_type === 'Credit' ? ACTION_OPTIONS_CREDIT : ACTION_OPTIONS_CASH;
```

...and use `actionOptions` in place of `ACTION_OPTIONS` in the `<Select options={[...]}>` call. `needsPassAmount`/`needsRemarks` need no change — `CreditApprove` naturally falls outside both (`action === 'PartiallyApprove'` and `['Hold','Return','Reject'].includes(action)` are both false for it).

### 5.3 `frontend/src/pages/AcctHoSheetView.jsx`

**`ACTION_TO_STATUS_LABEL`** — add the staged-decision preview label:

```js
const ACTION_TO_STATUS_LABEL = {
  Approve: 'Approved',
  PartiallyApprove: 'Partially Approved',
  CreditApprove: 'Credit Approved',   // <-- add
  Hold: 'On Hold',
  Return: 'Returned for Correction',
  Reject: 'Rejected'
};
```

No other change needed here — `handleSubmitDecisions`'s client-side pre-batch validation only special-cases `PartiallyApprove` (needs `ho_pass_amount`) and `['Hold','Return','Reject']` (needs `ho_remarks`); `CreditApprove` needs neither, so it flows through unchanged into the `actions` array sent to `actOnLineItemsBatch`.

### 5.4 Bank balance display — filter the `Credit` sentinel out of 3 places

All three currently render every row of the same unfiltered `bankBalances` query result:

- `frontend/src/pages/AcctBankBalances.jsx` (line 54, `bankBalances.map((b) => (...))`)
- `frontend/src/pages/AcctRequisitionSheetView.jsx` (line 430, `bankBalances.map((bank) => <BankBalanceBanner .../>)`)
- `frontend/src/pages/AcctHoSheetView.jsx` (line 395, same pattern)

In all three, change the `.map(` call to filter first:

```jsx
{bankBalances.filter(b => !b.is_virtual).map((bank) => (
  ...
))}
```

Do **not** filter inside `LineItemRow.jsx`'s `bankOptions` — that dropdown is the one place `Credit` must remain selectable.

### 5.5 `frontend/src/api/acctRequisitionsApi.js`

```js
// ── Credit Ledger ────────────────────────────────────────────────────────
// Credit purchases approved via 'Credit Approved' land here as one row per
// purchase. ?status=Open (default) is the repeatable-import list; ?status=
// Settled is history — same table, not two separate endpoints
// (042_credit_purchases_and_ledger.sql).
export const getCreditLedger = (params) => authApi.get(`${BASE}/credit-ledger`, { params });
export const importCreditInstallment = (ledgerId, targetSheetId) =>
  authApi.post(`${BASE}/credit-ledger/${ledgerId}/import`, { target_sheet_id: targetSheetId });
```

### 5.6 New page: `frontend/src/pages/AcctCreditLedger.jsx`

Mirror `AcctImportEligibleItems.jsx`'s overall shape (a role-gated page, `useQuery` list, a table), but add an Open/History toggle (mirror `AcctHoQueue.jsx`'s `STATUS_TABS` pattern) since this is explicitly two views over one table, not one flat list:

- Columns: Dealer (from `entry.beneficiary.beneficiary_name`/account/IFSC/bank), Source (Particulars + Sheet No. from `entry.source`), Opening Balance, Paid So Far, Remaining Balance, Status, and (Open tab only) an "Import" action.
- "Import" opens a small sheet-picker (which Open sheet to attach the installment to) — either inline (a `<select>` of the Accounts user's currently-Open sheets, fetched via the existing `getSheets({ sheet_status: 'Open' })`) or, simpler and more consistent with how `ImportEligibleItemsModal.jsx` works: **this page itself doesn't do the import** — importing only happens from *within* an Open sheet (see §5.7), exactly like the existing Hold/Reject import is Accounts-initiated from inside a sheet, not from the standalone `AcctImportEligibleItems.jsx` page (that page only supports Dismiss, no Import button — confirmed in the existing code). Follow the same split here: `AcctCreditLedger.jsx` is browse/history-only; the actual "pull this into my sheet" action lives in the new modal below.
- History tab (`status=Settled`): same columns minus the Import action, maybe add a "Settled On" column from `entry.settled_at`.

### 5.7 New component: `frontend/src/components/acctRequisition/CreditLedgerImportModal.jsx`

Mirror `ImportEligibleItemsModal.jsx` closely — same `Modal` + `Table` shape, `getCreditLedger({ status: 'Open', limit: 100 })` as the query, one "Import" button per row calling `importCreditInstallment(entry.id, targetSheetId)`. Key difference: after a successful import here, the new line item is **mostly blank** (no `req_amount`/`debit_bank_ac_type`/`payment_mode` prefilled) — so unlike the Hold/Reject import (whose optimistic UI just removes the row, since it's used up), this modal's row should **stay visible** after import (the ledger entry is still `Open`, still importable again) — no optimistic removal needed at all here, just invalidate the query on success so the Paid/Remaining columns refresh if `onImported` triggers a refetch soon after (they won't actually change until the new line item is later approved, so this is a minor nicety, not a correctness requirement).

### 5.8 `frontend/src/pages/AcctRequisitionSheetView.jsx`

Add a second import trigger button next to the existing "Import Held / Rejected" one (line ~584):

```jsx
<Button variant="glass" size="sm" onClick={() => setShowCreditImportModal(true)} title="Pull an installment from an open credit purchase">
  Import from Credit Ledger
</Button>
```

New state `showCreditImportModal`, and render `<CreditLedgerImportModal isOpen={showCreditImportModal} onClose={...} targetSheetId={id} onImported={...} />` alongside the existing `<ImportEligibleItemsModal .../>` render (mirror its `onImported` handler — `invalidateSheet()` + a success message).

### 5.9 Route registration

Add `AcctCreditLedger.jsx` to the router (find where `AcctImportEligibleItems` is registered — same file, e.g. `frontend/src/App.jsx` — and add an analogous route, e.g. `/acct-requisitions/credit-ledger`, same role gate as the import-eligible-items route). Add a nav link wherever the existing "Held / Rejected Items" link lives (likely `AcctRequisitions.jsx`'s header or a shared nav component) — locate it by searching for how that existing link is rendered and mirror it exactly.

---

## 6. What NOT to touch

- `act_acct_line_item_non_approve_transact` (Hold/Return/Reject) — **zero changes**. It already works unmodified for a `Credit`-type item (no `debit_bank_ac_type` restriction in that RPC), which is exactly what's needed: "If the item is rejected, it can be done using the existing reject option."
- `sync_acct_sheet_review_status` — unaffected. `Credit Approved` leaving `Pending HO Review` decrements the pending count the same as any other decision; the trigger doesn't care which status it moved to.
- `getImportEligibleItems` / `import_acct_line_item_transact` (the Hold/Reject/Pending-Review queue) — `Credit Approved` is never one of that queue's eligible statuses, so it's naturally excluded. Don't add it there; it has its own queue (`credit_ledger`).
- `getIndianBanks` / `indian_bank_master` — unrelated table (beneficiary's own bank, for the `beneficiary_bank_name` dropdown), not touched by this feature.
- `exportBulkNeft` — a `Credit`-type item is never `payment_mode = 'Bulk NEFT'` (they're mutually exclusive choices in the same dropdown), so it can never appear in a Bulk NEFT batch. No guard needed there.
- `BankBalanceEditor.jsx` (the upsert form on `AcctBankBalances.jsx`) — no change required for the feature to work; note in a comment that the `Credit` sentinel row should not be hand-edited from this screen, but don't spend time building an explicit block for it (P2 polish, not correctness).

---

## 7. Tests (backend, `backend/tests/vitest/regression/`)

New file `creditLedger.test.js`, reusing `acctRequisitionFixture.js`'s seed/cleanup helpers (same pattern as every other file in this directory):

1. **Original purchase entry:** a `Pending HO Review` item with `debit_bank_ac_type = 'Credit'`, `payment_mode = 'Credit'` — `credit_approve_acct_line_item_transact` succeeds, item becomes `Credit Approved` with `ho_pass_amount = req_amount`, a `credit_ledger` row is created with `opening_balance = remaining_balance = req_amount`, `paid_total = 0`, `ledger_status = 'Open'`.
2. **Guard:** calling `credit_approve_acct_line_item_transact` on an item whose `debit_bank_ac_type` is a real bank raises `VAL06`.
3. **Guard:** calling it on an item missing beneficiary fields raises `VAL07`.
4. **Dealer auto-upsert:** after (1), `beneficiary_master` has a row for that `(account_number, ifsc)` with `is_credit_dealer = true` — run it twice with two different credit purchases from the *same* dealer and confirm only one `beneficiary_master` row exists (upsert, not duplicate) and `credit_ledger` now has two rows both pointing at that one `beneficiary_id`.
5. **Guard:** calling `approve_acct_line_item_transact` (`Approve`/`PartiallyApprove`) on a `Credit`-type item raises `VAL09`.
6. **Installment import:** `import_credit_installment_transact` against an Open ledger entry creates a new line item on the target sheet with `credit_ledger_id` set and beneficiary fields prefilled from `beneficiary_master`, but `req_amount`/`debit_bank_ac_type`/`payment_mode` all `NULL`.
7. **Guard:** importing against a `Settled` ledger entry raises `STA09`.
8. **Repeatable import:** import the same Open ledger entry twice in a row (before either installment is approved) — both succeed, confirming no one-shot "already imported" restriction exists here (the key behavioral difference from `import_acct_line_item_transact`).
9. **Installment approval debits the ledger:** fill in the imported installment (real bank, real payment mode, some amount less than the remaining balance), approve it via `approve_acct_line_item_transact` — assert `credit_ledger.paid_total` increased and `remaining_balance` decreased by exactly the approved amount, `ledger_status` still `'Open'`, and the *real* bank's `available_balance` was debited (existing behavior, just confirming it still fires for a `credit_ledger_id`-carrying item).
10. **Settlement:** approve a final installment whose amount equals the remaining balance exactly — assert `ledger_status` flips to `'Settled'` and `settled_at` is stamped.
11. **Guard:** approving an installment for more than the remaining balance raises `VAL10`.
12. **Queue exclusion:** after (10), the settled entry no longer appears in `getCreditLedger({ status: 'Open' })` but does appear under `{ status: 'Settled' }`.
13. **Batch path:** `act_acct_line_items_batch_transact` with one `CreditApprove` action in the same batch as ordinary `Approve`/`Hold` actions — confirms the new dispatch branch (§3.2 step 8) is wired correctly and doesn't fall through to the `RAISE EXCEPTION 'Invalid action %.'` else-branch.
14. **Submit-time guard:** a sheet with a `payment_mode = 'Credit'` item missing beneficiary fields fails `submit_acct_sheet_transact` with `VAL02` (same code Bulk NEFT's equivalent check already uses).
15. **`Reject` still works on a Credit item:** confirm `act_acct_line_item_non_approve_transact` with `p_action = 'Reject'` succeeds unmodified on a `Credit`-type item, and creates no `credit_ledger` row.

**Frontend:** no existing test files were found for `HoDecisionPanel.jsx` or `LineItemRow.jsx` — a full suite isn't required; manually verify the conditional action list (§5.2) and the bank-balance filtering (§5.4) instead (see QA checklist below), since a `Credit ₹0.00` banner leaking into the UI or `Approve` being offered on a Credit item would both be visible, obvious mistakes to catch by eye.

---

## 8. Manual QA checklist

1. On `AcctBankBalances.jsx`, confirm no `Credit` row appears in the list (it exists in the DB, just hidden here).
2. Create a sheet, add a line item, set Debit Bank Type to `Credit` (confirm it's selectable) and Payment Mode to `Credit`, fill in dealer beneficiary details, submit.
3. Confirm the `BankBalanceBanner` row of cards on this sheet's page does **not** show a `Credit` card.
4. As HO, open the sheet — confirm the decision dropdown for this item shows `Credit Approved`, `Hold`, `Return for Correction`, `Reject` — **not** `Approve`/`Partially Approve`.
5. Pick `Credit Approved`, submit — item becomes `Credit Approved` (indigo badge). Confirm no bank balance changed anywhere.
6. Go to the new Credit Ledger page (Open tab) — the purchase appears with the correct dealer, opening balance = remaining balance, paid = 0.
7. Go to Beneficiary Master — confirm the dealer now shows `is_credit_dealer = true` (however that's surfaced in the UI, even if just a DB check for now if no UI toggle was built).
8. Open a *different*, Open sheet. Click "Import from Credit Ledger" — the same purchase is selectable. Import it — confirm a new, mostly-blank line item appears (dealer prefilled, amount/bank/payment-mode empty) and the Credit Ledger's Open list **still shows the same entry** (not removed).
9. Fill in the new installment item: a real bank, a real payment mode, an amount less than the full remaining balance. Submit, approve as HO via normal `Approve`.
10. Confirm: the real bank's balance dropped by the approved amount; the Credit Ledger entry's Paid So Far increased and Remaining Balance decreased by that same amount; `ledger_status` still `Open`.
11. Import the same purchase again into a third sheet, fill in an amount **equal to** the remaining balance, approve it.
12. Confirm the purchase now appears under the Credit Ledger's **History** tab, not the Open tab, and disappears from the `CreditLedgerImportModal`'s list.
13. Try importing a Settled entry directly (e.g. via a stale browser tab still showing it, or a direct API call) — expect a 409/`STA09` error, not a silently-created installment.
14. Try submitting a sheet with a `Credit`-type item that has no beneficiary details filled in — confirm submit is blocked with a clear error, same as the existing Bulk NEFT beneficiary-required behavior.
15. As HO, try to directly call the single-item `Approve` action (not `CreditApprove`) on a still-pending Credit-type item (e.g. via the batch endpoint bypassing the UI's conditional dropdown) — confirm it's rejected with the `VAL09` message rather than silently succeeding or crashing.
