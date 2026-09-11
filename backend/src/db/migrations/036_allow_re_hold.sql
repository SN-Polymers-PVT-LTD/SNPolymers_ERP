-- Migration 036: Allow re-applying Hold to an already-On-Hold item
--
-- act_acct_line_item_non_approve_transact (021) blocked p_action = 'Hold'
-- when the item was already On Hold (ERRCODE 'STA02'), forcing HO to pick a
-- different action just to update remarks on a decision they're keeping.
-- In practice the review UI defaults each item's decision dropdown to its
-- last HO action, so re-submitting the same "Hold" is the natural way to
-- save updated remarks without changing the outcome -- not a mistake to
-- block. Return and Reject were never guarded this way from an On Hold item
-- (only the transition FROM Pending HO Review/On Hold TO the new status was
-- validated), so this brings Hold in line with them.
--
-- The audit trigger (audit_acct_line_item_events, 021) only fires when
-- requisition_status actually changes, so a same-status re-Hold still
-- doesn't produce a duplicate HO_HELD audit_log row -- ho_remarks/
-- ho_actioned_by/ho_actioned_at on the row itself update normally, same as
-- any other action.
CREATE OR REPLACE FUNCTION "public"."act_acct_line_item_non_approve_transact"(
    p_line_item_id uuid,
    p_action       varchar,    -- 'Hold' | 'Return' | 'Reject'
    p_actioned_by  varchar,
    p_ho_remarks   text
) RETURNS acct_requisition_line_items LANGUAGE plpgsql AS $$
DECLARE
    v_item          acct_requisition_line_items;
    v_new_status    varchar;
    v_new_process   varchar;
BEGIN
    IF p_action NOT IN ('Hold', 'Return', 'Reject') THEN
        RAISE EXCEPTION 'Invalid action %. Must be Hold, Return, or Reject.', p_action;
    END IF;

    IF p_ho_remarks IS NULL OR trim(p_ho_remarks) = '' THEN
        RAISE EXCEPTION 'ho_remarks is required for % action.', p_action USING ERRCODE = 'VAL03';
    END IF;

    SELECT * INTO v_item FROM acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.'; END IF;

    IF v_item.requisition_status NOT IN ('Pending HO Review', 'On Hold') THEN
        RAISE EXCEPTION 'HO can only act on Pending HO Review or On Hold items. Current: %',
            v_item.requisition_status USING ERRCODE = 'STA01';
    END IF;

    v_new_status  := CASE p_action WHEN 'Hold' THEN 'On Hold' WHEN 'Return' THEN 'Returned for Correction' WHEN 'Reject' THEN 'Rejected' END;
    v_new_process := CASE p_action WHEN 'Hold' THEN 'Hold'    WHEN 'Return' THEN 'Returned for Correction' WHEN 'Reject' THEN 'Rejected' END;

    UPDATE acct_requisition_line_items
    SET
        requisition_status = v_new_status,
        ho_process         = v_new_process,
        ho_remarks         = p_ho_remarks,
        ho_actioned_by     = p_actioned_by,
        ho_actioned_at      = now(),
        updated_at         = now()
    WHERE id = p_line_item_id
    RETURNING * INTO v_item;

    RETURN v_item;
END; $$;
