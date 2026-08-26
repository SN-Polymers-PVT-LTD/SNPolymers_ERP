-- Migration 027: Batch HO line-item actions (Approve/PartiallyApprove/Hold/Return/Reject)
--
-- Mirrors the cost-estimate HO review flow's submit_row_approvals RPC — one
-- request carrying every decision, instead of the Accounts HO Approval
-- queue's prior behavior of one PATCH /items/:itemId/action round trip per
-- line item per click (500 items = 500 requests).
--
-- Unlike submit_row_approvals (a simple status/remarks write with no side
-- effects), Approve/PartiallyApprove here also debits bank_balance_master —
-- a real money movement (migration 025). An all-or-nothing batch, where one
-- bad item (e.g. insufficient balance) aborts every other decision in the
-- same batch, would be a correctness win but a usability regression: today,
-- one item failing doesn't block the other 99 from going through. This
-- function keeps that per-item independence: each action runs inside its
-- own nested BEGIN/EXCEPTION block (an implicit savepoint), so a failure on
-- one item rolls back only that item while every other item in the batch
-- still commits — same transaction, same one round trip, failures isolated
-- per item instead of poisoning the whole batch.
--
-- Reuses approve_acct_line_item_transact / act_acct_line_item_non_approve_transact
-- for the actual per-item logic (single source of truth for the business
-- rules, including the bank-balance guardrail and audit logging) rather than
-- duplicating it here.

CREATE OR REPLACE FUNCTION "public"."act_acct_line_items_batch_transact"(
    p_actions      jsonb,      -- [{ line_item_id, action, ho_pass_amount, ho_remarks }, ...]
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
