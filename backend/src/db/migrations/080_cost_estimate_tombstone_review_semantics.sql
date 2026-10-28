-- Migration 080: Exclude zero-scope subcontract tombstones from review semantics.
--
-- When effective subcontract scope drops to zero, the generated Cost Estimate
-- projection is retained as an internal qty=0, amount=0 tombstone to preserve
-- provenance and foreign-key integrity in cost_estimate_subcontract_contributions.
-- Such tombstones must not block ZO/HO review decisions as undecided rows, nor
-- participate in review approval amount sums.

CREATE OR REPLACE FUNCTION public.submit_zo_review(
  p_estimate_id uuid,
  p_reviewer varchar,
  p_remarks text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status              estimate_status_enum;
  v_user_role           VARCHAR;
  v_undecided_count     INT;
  v_rejected_count      INT;
  v_target_status       estimate_status_enum;
  v_new_amount          NUMERIC(18,2);
BEGIN
  -- Security Check: Confirm reviewer exists, is active, and is zo or admin
  SELECT role INTO v_user_role
  FROM authorised_users
  WHERE mobile_number = p_reviewer AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.';
  END IF;

  IF v_user_role NOT IN ('zo', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have ZO or Admin role.';
  END IF;

  -- Lock header and validate existence
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;

  -- Enforce status is Under ZO Review
  IF v_status <> 'Under ZO Review'::estimate_status_enum THEN
    RAISE EXCEPTION 'Expected Under ZO Review, found %', v_status;
  END IF;

  -- Validate all active items decided (ignoring inactive zero-scope tombstones)
  SELECT COUNT(*) INTO v_undecided_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0)
    AND zo_office_approve IS NULL;

  IF v_undecided_count > 0 THEN
    RAISE EXCEPTION 'All rows must be decided. Found % undecided rows.', v_undecided_count;
  END IF;

  -- Check for rejected items among active items
  SELECT COUNT(*) INTO v_rejected_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0)
    AND zo_office_approve = 'Not Approve';

  IF v_rejected_count > 0 THEN
    v_target_status := 'Rejected by ZO'::estimate_status_enum;
    -- Rejected is terminal; sum all active items for record-keeping
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0);
  ELSE
    v_target_status := 'ZO Approved'::estimate_status_enum;
    -- ZO Approved: sum approved active items only
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0)
      AND zo_office_approve = 'Approve';
  END IF;

  -- Update header
  UPDATE project_cost_estimates
  SET estimate_status = v_target_status,
      estimate_amount = v_new_amount,
      zo_approved_by = p_reviewer,
      zo_approval_date = now(),
      zo_remarks = p_remarks,
      last_modified_by = p_reviewer,
      updated_at = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;

ALTER FUNCTION public.submit_zo_review(uuid, varchar, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.submit_zo_review(uuid, varchar, text) TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.submit_ho_review(
  p_estimate_id uuid,
  p_reviewer varchar,
  p_remarks text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status              estimate_status_enum;
  v_user_role           VARCHAR;
  v_item_count          INT;
  v_undecided_count     INT;
  v_rejected_count      INT;
  v_target_status       estimate_status_enum;
  v_new_amount          NUMERIC(18,2);
  v_inconsistent_count  INT;
  v_rev_item            RECORD;
BEGIN
  -- 1. Security Check: Confirm reviewer exists, is active, and is HO or Admin
  SELECT role INTO v_user_role
  FROM authorised_users
  WHERE mobile_number = p_reviewer AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.';
  END IF;

  IF v_user_role NOT IN ('ho', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have HO or Admin role.';
  END IF;

  -- 2. Lock header and validate existence
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;

  -- 3. Acquire exclusive row-level locks on estimate items
  PERFORM 1
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  -- 4. Defensive Check: Prevent submission if estimate contains zero active line items
  SELECT COUNT(*) INTO v_item_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0);

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Estimate contains no line items.';
  END IF;

  -- 5. Enforce status is Under HO Review
  IF v_status <> 'Under HO Review'::estimate_status_enum THEN
    RAISE EXCEPTION 'Expected Under HO Review, found %', v_status;
  END IF;

  -- 6. Validate all active items decided by HO
  SELECT COUNT(*) INTO v_undecided_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0)
    AND ho_office_approve IS NULL;

  IF v_undecided_count > 0 THEN
    RAISE EXCEPTION 'All rows must be decided. Found % undecided rows.', v_undecided_count;
  END IF;

  -- 7. Determine if any active item was rejected by HO
  SELECT COUNT(*) INTO v_rejected_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0)
    AND ho_office_approve = 'Not Approve';

  IF v_rejected_count > 0 THEN
    v_target_status := 'Rejected by HO'::estimate_status_enum;

    -- Compensating reversal for any Sub Contractor items credited during approval
    FOR v_rev_item IN
        SELECT i.item_id, TRIM(e.work_order_no) AS work_order_no, 
               TRIM(i.material_sub_head) AS material_sub_head, 
               TRIM(i.material_details) AS material_details, i.amount
        FROM project_cost_estimate_items i
        JOIN project_cost_estimates e ON e.estimate_id = i.estimate_id
        WHERE i.estimate_id = p_estimate_id
          AND TRIM(i.material_main_head) = 'Sub Contractor'
          AND EXISTS (
              SELECT 1 FROM subcontractor_ledger l
              WHERE l.transaction_type = 'ESTIMATE_ITEM_APPROVAL'
                AND l.reference_type = 'ESTIMATE_ITEM'
                AND l.reference_id = i.item_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM subcontractor_ledger l
              WHERE l.transaction_type = 'ESTIMATE_ITEM_REVERSAL'
                AND l.reference_type = 'ESTIMATE_ITEM'
                AND l.reference_id = i.item_id
          )
    LOOP
        INSERT INTO subcontractor_ledger (
            work_order_no, material_main_head, material_sub_head, material_details,
            transaction_type, reference_type, reference_id, amount, created_by
        ) VALUES (
            v_rev_item.work_order_no, 'Sub Contractor', v_rev_item.material_sub_head, v_rev_item.material_details,
            'ESTIMATE_ITEM_REVERSAL', 'ESTIMATE_ITEM', v_rev_item.item_id, -v_rev_item.amount, p_reviewer
        );

        UPDATE subcontractor_balances
        SET estimated_total   = estimated_total - v_rev_item.amount,
            available_balance = available_balance - v_rev_item.amount,
            updated_at        = now()
        WHERE work_order_no = v_rev_item.work_order_no
          AND material_main_head = 'Sub Contractor'
          AND material_sub_head = v_rev_item.material_sub_head
          AND material_details = v_rev_item.material_details;
    END LOOP;

    -- Rejected is terminal; sum all active items for record-keeping
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0);

  ELSE
    v_target_status := 'Final Approved'::estimate_status_enum;

    -- Defensive Check: Verify all HO approved active items were also ZO approved
    SELECT COUNT(*) INTO v_inconsistent_count
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0)
      AND ho_office_approve = 'Approve'
      AND (zo_office_approve IS NULL OR zo_office_approve <> 'Approve');

    IF v_inconsistent_count > 0 THEN
      RAISE EXCEPTION 'Inconsistent review state: found % items approved by HO that were not approved by ZO.', v_inconsistent_count;
    END IF;

    -- Final Approved: sum items where both ZO and HO approved
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND NOT (source_type = 'SUBCONTRACT_ESTIMATE' AND qty = 0 AND amount = 0)
      AND zo_office_approve = 'Approve'
      AND ho_office_approve = 'Approve';
  END IF;

  -- 8. Update header
  UPDATE project_cost_estimates
  SET estimate_status = v_target_status,
      estimate_amount = v_new_amount,
      ho_approved_by = p_reviewer,
      ho_approval_date = now(),
      ho_remarks = p_remarks,
      last_modified_by = p_reviewer,
      updated_at = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;

ALTER FUNCTION public.submit_ho_review(uuid, varchar, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.submit_ho_review(uuid, varchar, text) TO anon, authenticated, service_role;
