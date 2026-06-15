-- Migration: Create transactional row-approvals RPC function
-- DB: PostgreSQL (Supabase)

CREATE OR REPLACE FUNCTION submit_row_approvals(
  p_estimate_id   UUID,
  p_approvals     JSONB,
  p_stage         TEXT,
  p_modified_by   VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role     VARCHAR;
  approval        JSONB;
  v_item_id       UUID;
  v_approve_status TEXT;
  v_remarks       TEXT;
  v_status        estimate_status_enum;
  v_new_amount    NUMERIC(18,2);
  v_rows          INT;
BEGIN
  -- 1. Security Check: Confirm modifier role has authorization for the stage
  SELECT role INTO v_user_role
  FROM authorised_users
  WHERE mobile_number = p_modified_by AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized: User is inactive or does not exist.';
  END IF;

  IF p_stage = 'ZO' AND v_user_role NOT IN ('zo', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have ZO or Admin role.';
  END IF;

  IF p_stage = 'HO' AND v_user_role NOT IN ('ho', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: User does not have HO or Admin role.';
  END IF;

  -- 2. Read current estimate status
  SELECT estimate_status INTO v_status
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found: %', p_estimate_id;
  END IF;

  -- 3. Apply each row approval
  FOR approval IN SELECT * FROM jsonb_array_elements(p_approvals)
  LOOP
    v_item_id       := (approval->>'item_id')::UUID;
    v_approve_status := approval->>'approve_status';
    v_remarks        := approval->>'remarks';

    IF p_stage = 'ZO' THEN
      UPDATE project_cost_estimate_items
      SET
        zo_office_approve = v_approve_status::row_approval_enum,
        zo_remarks        = v_remarks,
        updated_at        = now()
      WHERE item_id = v_item_id
        AND estimate_id = p_estimate_id;
    ELSIF p_stage = 'HO' THEN
      UPDATE project_cost_estimate_items
      SET
        ho_office_approve = v_approve_status::row_approval_enum,
        ho_remarks        = v_remarks,
        updated_at        = now()
      WHERE item_id = v_item_id
        AND estimate_id = p_estimate_id;
    ELSE
      RAISE EXCEPTION 'Invalid stage: %. Must be ZO or HO.', p_stage;
    END IF;

    -- Rollback Safety Check: Validate the target item row was modified
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'Item ID % not found or does not belong to estimate %.', v_item_id, p_estimate_id;
    END IF;
  END LOOP;

  -- 4. Recalculate amount based on current status (Workflow calculation matrix)
  -- Rationale: Approved grand total depends on estimate stage:
  -- - Pre-review / Draft: Sum all items regardless of approvals.
  -- - Under HO Review / ZO Approved: Sum ZO-approved rows.
  -- - Final Approved: Sum rows approved by both ZO and HO.
  -- - Rejected: Sum all items.
  IF v_status IN ('Draft', 'Submitted', 'Under ZO Review', 'ZO Revision Requested',
                  'Rejected by ZO', 'Rejected by HO') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;

  ELSIF v_status IN ('ZO Approved', 'Under HO Review', 'HO Revision Requested') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve';

  ELSIF v_status = 'Final Approved' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve'
      AND ho_office_approve = 'Approve';
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;
  END IF;

  -- 5. Write back to header
  UPDATE project_cost_estimates
  SET
    estimate_amount  = v_new_amount,
    last_modified_by = p_modified_by,
    updated_at       = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;

GRANT EXECUTE ON FUNCTION submit_row_approvals(UUID, JSONB, TEXT, VARCHAR) TO service_role;
