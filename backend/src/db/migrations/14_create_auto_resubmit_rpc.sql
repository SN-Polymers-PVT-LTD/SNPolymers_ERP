-- Migration: Create auto_resubmit_estimate and submit_zo_review RPC functions
-- DB: PostgreSQL (Supabase)

-- 1. Redefine trigger function to prevent crash when last_modified_by is NULL on system triggers
CREATE OR REPLACE FUNCTION audit_estimate_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estimate_status IS DISTINCT FROM OLD.estimate_status THEN
    INSERT INTO audit_log (user_id, action, module_name, record_identifier, old_value, new_value)
    VALUES (
      COALESCE(NEW.last_modified_by, 'SYSTEM'),
      CASE WHEN NEW.last_modified_by IS NULL THEN 'AUTO_RESUBMIT' ELSE 'STATUS_CHANGE' END,
      'Project Cost Estimate',
      NEW.estimate_id::VARCHAR,
      jsonb_build_object(
        'estimate_status', OLD.estimate_status,
        'estimate_revision', OLD.estimate_revision
      ),
      jsonb_build_object(
        'estimate_status', NEW.estimate_status,
        'estimate_revision', NEW.estimate_revision
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create auto_resubmit_estimate RPC
CREATE OR REPLACE FUNCTION auto_resubmit_estimate(
  p_estimate_id         UUID,
  p_stage               TEXT          -- 'ZO' or 'HO'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status              estimate_status_enum;
  v_new_revision        INT;
  v_open_log_count      INT;
  v_log_id              UUID;
  v_new_amount          NUMERIC(18,2);
  v_target_status       estimate_status_enum;
BEGIN
  -- Lock the estimate header and validate existence
  SELECT estimate_status, estimate_revision INTO v_status, v_new_revision
  FROM project_cost_estimates
  WHERE estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found';
  END IF;

  -- Validate stage and current status match
  IF p_stage = 'ZO' THEN
    IF v_status <> 'ZO Revision Requested'::estimate_status_enum THEN
      RAISE EXCEPTION 'Expected ZO Revision Requested, found %', v_status;
    END IF;
    v_target_status := 'Submitted'::estimate_status_enum;
  ELSIF p_stage = 'HO' THEN
    IF v_status <> 'HO Revision Requested'::estimate_status_enum THEN
      RAISE EXCEPTION 'Expected HO Revision Requested, found %', v_status;
    END IF;
    v_target_status := 'Under HO Review'::estimate_status_enum;
  ELSE
    RAISE EXCEPTION 'Invalid stage: %. Must be ZO or HO.', p_stage;
  END IF;

  -- Ensure exactly one open revision log entry for this stage
  SELECT COUNT(*) INTO v_open_log_count
  FROM estimate_revision_log
  WHERE estimate_id = p_estimate_id
    AND stage = p_stage
    AND resubmitted_at IS NULL;

  IF v_open_log_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one open revision log, found %', v_open_log_count;
  END IF;

  SELECT id INTO v_log_id
  FROM estimate_revision_log
  WHERE estimate_id = p_estimate_id
    AND stage = p_stage
    AND resubmitted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  -- Close the active revision log entry
  UPDATE estimate_revision_log
  SET resubmitted_at = now(),
      resubmitted_by = NULL,
      is_auto_resubmitted = TRUE,
      modified_item_ids = '{}'
  WHERE id = v_log_id;

  -- Reset unapproved items
  IF p_stage = 'ZO' THEN
    UPDATE project_cost_estimate_items
    SET zo_office_approve = NULL,
        updated_at = now()
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Not Approve';
  ELSIF p_stage = 'HO' THEN
    UPDATE project_cost_estimate_items
    SET ho_office_approve = NULL,
        updated_at = now()
    WHERE estimate_id = p_estimate_id
      AND ho_office_approve = 'Not Approve';
  END IF;

  -- Recalculate amount based on final target status rules
  IF p_stage = 'ZO' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;
  ELSIF p_stage = 'HO' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
      AND zo_office_approve = 'Approve';
  END IF;

  -- Update header (last_modified_by = NULL indicates system trigger)
  UPDATE project_cost_estimates
  SET estimate_status = v_target_status,
      estimate_revision = v_new_revision + 1,
      estimate_amount = v_new_amount,
      last_modified_by = NULL,
      updated_at = now()
  WHERE estimate_id = p_estimate_id;

END;
$$;

-- 3. Create submit_zo_review RPC
CREATE OR REPLACE FUNCTION submit_zo_review(
  p_estimate_id         UUID,
  p_reviewer            VARCHAR,
  p_remarks             TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

  -- Validate all items decided
  SELECT COUNT(*) INTO v_undecided_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND zo_office_approve IS NULL;

  IF v_undecided_count > 0 THEN
    RAISE EXCEPTION 'All rows must be decided. Found % undecided rows.', v_undecided_count;
  END IF;

  -- Check for rejected items
  SELECT COUNT(*) INTO v_rejected_count
  FROM project_cost_estimate_items
  WHERE estimate_id = p_estimate_id
    AND zo_office_approve = 'Not Approve';

  IF v_rejected_count > 0 THEN
    v_target_status := 'Rejected by ZO'::estimate_status_enum;
    -- Rejected is terminal; sum all items for record-keeping
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id;
  ELSE
    v_target_status := 'ZO Approved'::estimate_status_enum;
    -- ZO Approved: sum approved items only (all of them since rejected_count = 0)
    SELECT COALESCE(SUM(amount), 0) INTO v_new_amount
    FROM project_cost_estimate_items
    WHERE estimate_id = p_estimate_id
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

-- 4. Grant Permissions
GRANT EXECUTE ON FUNCTION auto_resubmit_estimate(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION submit_zo_review(UUID, VARCHAR, TEXT) TO service_role;
