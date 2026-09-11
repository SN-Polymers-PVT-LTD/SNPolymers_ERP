-- Migration 049: Subcontractor Balance Adjustment & Physical Accounting Invariant Hardening
--
-- Addresses GAP-08 and GAP-09:
-- 1. Updates chk_scl_transaction_taxonomy to allow ADMIN_ADJUSTMENT transactions.
-- 2. Enforces physical intra-row accounting identity check chk_scb_accounting_identity on subcontractor_balances.
-- 3. Creates adjust_subcontractor_balance_transact RPC with caller-provided idempotency key,
--    strict floor enforcement (new_estimated >= paid_total), cross-layer authorization,
--    subcontractor_ledger insertion, and audit_log recording.

-- ----------------------------------------------------------------------------
-- 1. Expand Transaction Taxonomy to include ADMIN_ADJUSTMENT
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."subcontractor_ledger"
    DROP CONSTRAINT IF EXISTS "chk_scl_transaction_taxonomy";

ALTER TABLE "public"."subcontractor_ledger"
    ADD CONSTRAINT "chk_scl_transaction_taxonomy" CHECK (
        (transaction_type = 'ESTIMATE_ITEM_APPROVAL' AND reference_type = 'ESTIMATE_ITEM' AND amount > 0) OR
        (transaction_type = 'ESTIMATE_ITEM_REVERSAL' AND reference_type = 'ESTIMATE_ITEM' AND amount < 0) OR
        (transaction_type = 'REQUISITION_APPROVAL'    AND reference_type = 'REQUISITION'   AND amount < 0) OR
        (transaction_type = 'ADMIN_ADJUSTMENT'       AND reference_type = 'MANUAL_ADJUSTMENT' AND amount <> 0)
    );

-- ----------------------------------------------------------------------------
-- 2. Physical Accounting Identity Constraint on subcontractor_balances (GAP-09)
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."subcontractor_balances"
    DROP CONSTRAINT IF EXISTS "chk_scb_accounting_identity";

ALTER TABLE "public"."subcontractor_balances"
    ADD CONSTRAINT "chk_scb_accounting_identity"
    CHECK (available_balance = estimated_total - paid_total);

-- ----------------------------------------------------------------------------
-- 3. Stored Procedure: adjust_subcontractor_balance_transact (GAP-08)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."adjust_subcontractor_balance_transact"(
    p_adjustment_id      uuid,
    p_work_order_no      character varying,
    p_material_sub_head  character varying,
    p_material_details   character varying,
    p_adjustment_amount  numeric,
    p_remarks            text,
    p_actioned_by        character varying
) RETURNS "public"."subcontractor_balances"
LANGUAGE "plpgsql" SECURITY DEFINER
AS $$
DECLARE
    v_clean_wo       VARCHAR := TRIM(p_work_order_no);
    v_clean_sub      VARCHAR := TRIM(p_material_sub_head);
    v_clean_det      VARCHAR := TRIM(p_material_details);
    v_user_role      VARCHAR;
    v_balance        subcontractor_balances;
    v_new_estimated  NUMERIC(18,2);
    v_new_available  NUMERIC(18,2);
BEGIN
    -- 1. Security check: User must be active HO or Admin
    SELECT role INTO v_user_role
    FROM authorised_users
    WHERE mobile_number = p_actioned_by AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.' USING ERRCODE = 'AUTH1';
    END IF;

    IF v_user_role NOT IN ('ho', 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only HO or Admin can adjust subcontractor balances.' USING ERRCODE = 'AUTH2';
    END IF;

    IF p_adjustment_id IS NULL THEN
        RAISE EXCEPTION 'p_adjustment_id (Idempotency Key) is required.' USING ERRCODE = 'VAL09';
    END IF;

    IF p_adjustment_amount IS NULL OR p_adjustment_amount = 0 THEN
        RAISE EXCEPTION 'Adjustment amount must be a non-zero number.' USING ERRCODE = 'VAL10';
    END IF;

    IF p_remarks IS NULL OR TRIM(p_remarks) = '' THEN
        RAISE EXCEPTION 'Adjustment remarks are mandatory.' USING ERRCODE = 'VAL11';
    END IF;

    -- 2. Idempotency check: if this adjustment_id was already processed, return current balance safely
    IF EXISTS (
        SELECT 1 FROM subcontractor_ledger
        WHERE transaction_type = 'ADMIN_ADJUSTMENT'
          AND reference_type = 'MANUAL_ADJUSTMENT'
          AND reference_id = p_adjustment_id
    ) THEN
        SELECT * INTO v_balance
        FROM subcontractor_balances
        WHERE work_order_no = v_clean_wo
          AND material_main_head = 'Sub Contractor'
          AND material_sub_head = v_clean_sub
          AND material_details = v_clean_det;
        RETURN v_balance;
    END IF;

    -- 3. Lock target balance row FOR UPDATE
    SELECT * INTO v_balance
    FROM subcontractor_balances
    WHERE work_order_no = v_clean_wo
      AND material_main_head = 'Sub Contractor'
      AND material_sub_head = v_clean_sub
      AND material_details = v_clean_det
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Subcontractor balance not found for Work Order %, Sub Head %, Details %.',
            v_clean_wo, v_clean_sub, v_clean_det USING ERRCODE = 'P0002';
    END IF;

    -- 4. Enforce strict floor: new_estimated cannot fall below paid_total
    v_new_estimated := v_balance.estimated_total + p_adjustment_amount;
    IF v_new_estimated < v_balance.paid_total THEN
        RAISE EXCEPTION 'Cannot adjust estimated total (%) below already paid total (%). Current estimated: %, Adjustment: %.',
            v_new_estimated, v_balance.paid_total, v_balance.estimated_total, p_adjustment_amount USING ERRCODE = 'BAL01';
    END IF;

    -- 5. Enforce accounting identity: available_balance = estimated_total - paid_total
    v_new_available := v_new_estimated - v_balance.paid_total;

    -- 6. Insert audited ledger row with caller-supplied adjustment_id
    INSERT INTO subcontractor_ledger (
        work_order_no, material_main_head, material_sub_head, material_details,
        transaction_type, reference_type, reference_id, amount, created_by
    ) VALUES (
        v_clean_wo, 'Sub Contractor', v_clean_sub, v_clean_det,
        'ADMIN_ADJUSTMENT', 'MANUAL_ADJUSTMENT', p_adjustment_id, p_adjustment_amount, p_actioned_by
    );

    -- 7. Update balance row
    UPDATE subcontractor_balances
    SET estimated_total   = v_new_estimated,
        available_balance = v_new_available,
        updated_at        = now()
    WHERE work_order_no = v_clean_wo
      AND material_main_head = 'Sub Contractor'
      AND material_sub_head = v_clean_sub
      AND material_details = v_clean_det
    RETURNING * INTO v_balance;

    -- 8. Insert audit_log record
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value, "timestamp")
    VALUES (
        p_actioned_by, 'ADMIN_ADJUST_SUBCONTRACTOR_BALANCE', 'Subcontractor Ledger',
        v_clean_wo || '::' || v_clean_sub || '::' || v_clean_det,
        jsonb_build_object('estimated_total', v_balance.estimated_total - p_adjustment_amount, 'available_balance', v_balance.available_balance - p_adjustment_amount),
        jsonb_build_object('adjustment_id', p_adjustment_id, 'estimated_total', v_balance.estimated_total, 'available_balance', v_balance.available_balance, 'adjustment', p_adjustment_amount, 'remarks', p_remarks),
        clock_timestamp()
    );

    RETURN v_balance;
END;
$$;
