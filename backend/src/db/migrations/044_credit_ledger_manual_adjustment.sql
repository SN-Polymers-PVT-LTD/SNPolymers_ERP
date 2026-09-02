-- Migration 044: let HO manually correct an Open credit ledger entry's
-- remaining balance, with a required remarks note, audited via audit_log.
--
-- Needed for data-entry corrections — e.g. an installment approved for the
-- wrong amount, or a balance that needs reconciling against what the
-- dealer/subcontractor actually reports. Only Open entries can be adjusted
-- (a Settled entry is done); the new balance recomputes paid_total to keep
-- paid_total + remaining_balance = opening_balance, and flips the entry to
-- Settled if HO adjusts it down to exactly zero.

CREATE OR REPLACE FUNCTION "public"."adjust_credit_ledger_balance_transact"(
    p_ledger_id             uuid,
    p_new_remaining_balance numeric,
    p_remarks               text,
    p_actioned_by           varchar
) RETURNS credit_ledger LANGUAGE plpgsql AS $$
DECLARE
    v_ledger           credit_ledger;
    v_new_paid         numeric(18,2);
    v_old_remaining    numeric(18,2);
    v_old_paid         numeric(18,2);
BEGIN
    SELECT * INTO v_ledger FROM credit_ledger WHERE id = p_ledger_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Credit ledger entry not found.'; END IF;

    IF v_ledger.ledger_status <> 'Open' THEN
        RAISE EXCEPTION 'Only an Open credit ledger entry can have its balance adjusted. Current status: %', v_ledger.ledger_status USING ERRCODE = 'STA10';
    END IF;

    IF p_new_remaining_balance IS NULL OR p_new_remaining_balance < 0 OR p_new_remaining_balance > v_ledger.opening_balance THEN
        RAISE EXCEPTION 'New remaining balance must be between 0 and the opening balance (%).', v_ledger.opening_balance USING ERRCODE = 'VAL11';
    END IF;

    IF p_remarks IS NULL OR btrim(p_remarks) = '' THEN
        RAISE EXCEPTION 'Remarks are required when adjusting a credit ledger balance.' USING ERRCODE = 'VAL12';
    END IF;

    v_old_remaining := v_ledger.remaining_balance;
    v_old_paid      := v_ledger.paid_total;
    v_new_paid      := v_ledger.opening_balance - p_new_remaining_balance;

    UPDATE credit_ledger
    SET remaining_balance = p_new_remaining_balance,
        paid_total        = v_new_paid,
        ledger_status      = CASE WHEN p_new_remaining_balance = 0 THEN 'Settled' ELSE 'Open' END,
        settled_at         = CASE WHEN p_new_remaining_balance = 0 THEN now() ELSE settled_at END,
        updated_at         = now()
    WHERE id = p_ledger_id
    RETURNING * INTO v_ledger;

    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
    VALUES (
        p_actioned_by, 'HO_ADJUSTED_CREDIT_BALANCE', 'Credit Ledger', p_ledger_id::varchar,
        jsonb_build_object('remaining_balance', v_old_remaining, 'paid_total', v_old_paid),
        jsonb_build_object('remaining_balance', v_ledger.remaining_balance, 'paid_total', v_ledger.paid_total, 'remarks', p_remarks, 'ledger_status', v_ledger.ledger_status),
        clock_timestamp()
    );

    RETURN v_ledger;
END; $$;
