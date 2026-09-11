-- Migration 059: canonical Fund Request draft/submission workflow objects.
-- Historical migrations are intentionally left unchanged.

ALTER TABLE public.fund_requests
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by varchar;

-- New records are drafts; existing records retain their historical status.
ALTER TABLE public.fund_requests
  ALTER COLUMN request_status SET DEFAULT 'Draft'::public.fund_request_status_enum;

UPDATE public.fund_requests
SET submitted_at = COALESCE(submitted_at, created_at),
    submitted_by = COALESCE(submitted_by, zo_user_id)
WHERE request_status <> 'Draft';

-- Old, unimported Holds came from the removed direct-action workflow. Return
-- them to the canonical Accounts import queue; imported Holds remain intact.
UPDATE public.fund_requests
SET request_status = 'Pending'::public.fund_request_status_enum,
    updated_at = now()
WHERE request_status = 'Hold'
  AND accounts_line_item_id IS NULL;

-- The old direct settlement function must not remain callable.
DROP FUNCTION IF EXISTS public.approve_fund_request_transact(uuid, numeric, character varying, character varying, text);

-- Drop any previous 7-argument overload of submit_fund_request_transact so
-- that only the canonical, draft-authoritative 2-argument RPC exists.
DROP FUNCTION IF EXISTS public.submit_fund_request_transact(uuid, varchar, varchar, varchar, varchar, uuid, varchar);

-- Submission is the sole capacity reservation boundary. The project row is
-- locked before the aggregate is calculated, serializing submissions per WO.
-- Beneficiary details are read from the locked draft, upserted into
-- projects_beneficiary_master, and linked back to fund_requests.beneficiary_id.
CREATE OR REPLACE FUNCTION public.submit_fund_request_transact(
  p_fund_request_id uuid,
  p_submitted_by varchar
) RETURNS public.fund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fr public.fund_requests;
  v_project public.projects_master;
  v_estimate numeric(18,2);
  v_committed numeric(18,2);
  v_bank_name varchar;
  v_beneficiary_id uuid;
BEGIN
  SELECT * INTO v_fr
  FROM public.fund_requests
  WHERE fund_request_id = p_fund_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fund request not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_fr.request_status <> 'Draft' THEN
    RAISE EXCEPTION 'Only Draft fund requests can be submitted. Current status: %', v_fr.request_status USING ERRCODE = 'STA01';
  END IF;
  IF v_fr.accounts_line_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'Imported fund requests cannot be submitted again.' USING ERRCODE = 'STA06';
  END IF;
  IF v_fr.zo_fr_amount IS NULL OR v_fr.zo_fr_amount <= 0 THEN
    RAISE EXCEPTION 'Fund request amount must be greater than zero.' USING ERRCODE = 'VAL01';
  END IF;

  -- Read beneficiary data from the locked draft, never from a stale caller
  -- snapshot. This keeps draft edits and submission serialized consistently.
  IF v_fr.beneficiary_name IS NULL OR trim(v_fr.beneficiary_name) = ''
     OR v_fr.beneficiary_ac_no IS NULL OR v_fr.beneficiary_ac_no !~ '^[0-9]{9,18}$'
     OR v_fr.beneficiary_ifsc IS NULL OR upper(trim(v_fr.beneficiary_ifsc)) !~ '^[A-Z]{4}0[A-Z0-9]{6}$'
     OR v_fr.beneficiary_bank_id IS NULL THEN
    RAISE EXCEPTION 'Complete beneficiary bank details are required before submission.' USING ERRCODE = 'VAL01';
  END IF;
  SELECT bank_name INTO v_bank_name FROM public.indian_bank_master
  WHERE id = v_fr.beneficiary_bank_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected bank does not exist or is inactive.' USING ERRCODE = 'VAL01'; END IF;

  INSERT INTO public.projects_beneficiary_master (
    beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_name,
    beneficiary_bank_id, created_by, updated_by, last_used_at, updated_at
  ) VALUES (
    trim(v_fr.beneficiary_name), trim(v_fr.beneficiary_ac_no), upper(trim(v_fr.beneficiary_ifsc)), v_bank_name,
    v_fr.beneficiary_bank_id, p_submitted_by, p_submitted_by, now(), now()
  ) ON CONFLICT (beneficiary_ac_no, beneficiary_ifsc) DO UPDATE SET
    beneficiary_name = EXCLUDED.beneficiary_name,
    beneficiary_bank_name = EXCLUDED.beneficiary_bank_name,
    beneficiary_bank_id = EXCLUDED.beneficiary_bank_id,
    last_used_at = now(),
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING id INTO v_beneficiary_id;

  SELECT * INTO v_project
  FROM public.projects_master
  WHERE work_order_no = v_fr.work_order_no
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work Order not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_project.zo_user_id <> v_fr.zo_user_id THEN
    RAISE EXCEPTION 'Work Order mismatch with Zonal Office.' USING ERRCODE = 'AUT01';
  END IF;
  IF v_project.status NOT IN ('Running', 'Complete Under Maintenance') THEN
    RAISE EXCEPTION 'Work Order must be Active (Running) or Under Maintenance.' USING ERRCODE = 'STA02';
  END IF;

  SELECT estimate_amount INTO v_estimate
  FROM public.project_cost_estimates
  WHERE work_order_no = v_fr.work_order_no
    AND estimate_status = 'Final Approved'::public.estimate_status_enum
  ORDER BY estimate_revision DESC
  LIMIT 1;
  IF v_estimate IS NULL THEN
    RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
  END IF;

  SELECT COALESCE(SUM(CASE
    WHEN request_status IN ('Pending', 'Hold') THEN zo_fr_amount
    WHEN request_status = 'Approved' THEN approve_ho_amount
    ELSE 0
  END), 0) INTO v_committed
  FROM public.fund_requests
  WHERE work_order_no = v_fr.work_order_no
    AND request_status IN ('Pending', 'Hold', 'Approved');

  IF v_fr.zo_fr_amount > v_estimate - v_committed THEN
    RAISE EXCEPTION 'Requested amount exceeds the remaining Cost Estimate funding capacity (Capacity: %, Attempted: %).',
      v_estimate - v_committed, v_fr.zo_fr_amount USING ERRCODE = 'BUD02';
  END IF;

  UPDATE public.fund_requests
  SET request_status = 'Pending',
      submitted_at = now(),
      submitted_by = p_submitted_by,
      beneficiary_id = v_beneficiary_id,
      beneficiary_bank_name = v_bank_name,
      updated_at = now()
  WHERE fund_request_id = p_fund_request_id
  RETURNING * INTO v_fr;
  RETURN v_fr;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_fund_request_transact(uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_fund_request_transact(uuid, varchar) TO service_role;

-- Replace the import function's source-state guard while retaining its public
-- return contract used by the Accounts controller.
CREATE OR REPLACE FUNCTION public.import_fund_request_to_acct_sheet_transact(
  p_fund_request_id uuid,
  p_target_sheet_id uuid,
  p_imported_by varchar
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fr public.fund_requests;
  v_sheet_status varchar;
  v_sub_title_id uuid;
  v_item public.acct_requisition_line_items;
  v_particulars varchar;
BEGIN
  SELECT sheet_status INTO v_sheet_status FROM public.acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_sheet_status <> 'Open' THEN RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05'; END IF;

  SELECT * INTO v_fr FROM public.fund_requests WHERE fund_request_id = p_fund_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fund request not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_fr.request_status <> 'Pending' THEN
    RAISE EXCEPTION 'Only Pending fund requests can be imported. Current status: %', v_fr.request_status USING ERRCODE = 'STA01';
  END IF;
  IF v_fr.accounts_line_item_id IS NOT NULL THEN RAISE EXCEPTION 'This fund request has already been imported into an Accounts sheet.' USING ERRCODE = 'STA06'; END IF;
  IF COALESCE(v_fr.accounts_import_dismissed, false) THEN RAISE EXCEPTION 'This fund request has been dismissed and cannot be imported.' USING ERRCODE = 'STA07'; END IF;

  SELECT id INTO v_sub_title_id FROM public.account_sub_title_master WHERE is_active AND UPPER(TRIM(title)) = 'FUND REQUEST' LIMIT 1;
  v_particulars := COALESCE(NULLIF(TRIM(v_fr.zo_remarks), ''), 'Fund Request ' || v_fr.zo_fr_no);
  INSERT INTO public.acct_requisition_line_items (
    sheet_id, source_fund_request_id, created_by, account_sub_title_id, account_sub_title_text,
    particulars, beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_id,
    beneficiary_bank_name, req_amount, work_order_no
  ) VALUES (
    p_target_sheet_id, v_fr.fund_request_id, p_imported_by, v_sub_title_id, 'Fund Request',
    v_particulars, v_fr.beneficiary_ac_no, v_fr.beneficiary_name, v_fr.beneficiary_ifsc,
    v_fr.beneficiary_bank_id, v_fr.beneficiary_bank_name, v_fr.zo_fr_amount, v_fr.work_order_no
  ) RETURNING * INTO v_item;

  UPDATE public.fund_requests
  SET accounts_line_item_id = v_item.id, accounts_imported_at = now(), updated_at = now()
  WHERE fund_request_id = p_fund_request_id;
  SELECT * INTO v_fr FROM public.fund_requests WHERE fund_request_id = p_fund_request_id;
  RETURN jsonb_build_object('fund_request', row_to_json(v_fr), 'line_item', row_to_json(v_item));
END;
$$;

REVOKE ALL ON FUNCTION public.import_fund_request_to_acct_sheet_transact(uuid, uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_fund_request_to_acct_sheet_transact(uuid, uuid, varchar) TO service_role;

-- Preserve the Accounts Sheet non-approval workflow, but mirror distinct
-- source states instead of collapsing Return/Reject into Hold.
CREATE OR REPLACE FUNCTION public.act_acct_line_item_non_approve_transact(
  p_line_item_id uuid, p_action varchar, p_actioned_by varchar, p_ho_remarks text
) RETURNS public.acct_requisition_line_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.acct_requisition_line_items;
  v_new_status varchar;
  v_new_process varchar;
BEGIN
  IF p_action NOT IN ('Hold', 'Return', 'Reject') THEN RAISE EXCEPTION 'Invalid action %. Must be Hold, Return, or Reject.', p_action USING ERRCODE = 'VAL01'; END IF;
  IF p_ho_remarks IS NULL OR trim(p_ho_remarks) = '' THEN RAISE EXCEPTION 'ho_remarks is required for % action.', p_action USING ERRCODE = 'VAL03'; END IF;
  SELECT * INTO v_item FROM public.acct_requisition_line_items WHERE id = p_line_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_item.requisition_status <> 'Pending HO Review' THEN RAISE EXCEPTION 'HO can only act on Pending HO Review items. Current: %', v_item.requisition_status USING ERRCODE = 'STA01'; END IF;

  v_new_status := CASE p_action WHEN 'Hold' THEN 'On Hold' WHEN 'Return' THEN 'Returned for Correction' ELSE 'Rejected' END;
  v_new_process := CASE p_action WHEN 'Hold' THEN 'Hold' WHEN 'Return' THEN 'Returned for Correction' ELSE 'Rejected' END;
  IF v_item.source_fund_request_id IS NOT NULL THEN
    UPDATE public.fund_requests
    SET request_status = CASE p_action WHEN 'Hold' THEN 'Hold'::public.fund_request_status_enum WHEN 'Return' THEN 'Returned'::public.fund_request_status_enum ELSE 'Rejected'::public.fund_request_status_enum END,
        ho_remarks = p_ho_remarks, updated_at = now()
    WHERE fund_request_id = v_item.source_fund_request_id
      AND accounts_line_item_id = p_line_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fund Request source link is invalid.' USING ERRCODE = 'STA06'; END IF;
  END IF;

  UPDATE public.acct_requisition_line_items
  SET requisition_status = v_new_status, ho_process = v_new_process, ho_remarks = p_ho_remarks,
      ho_actioned_by = p_actioned_by, ho_actioned_at = now(), updated_at = now()
  WHERE id = p_line_item_id RETURNING * INTO v_item;
  RETURN v_item;
END;
$$;

-- A Fund Request cannot become financially Approved unless it is linked to
-- the Accounts line item that is performing the settlement.
CREATE OR REPLACE FUNCTION public.guard_fund_request_approval_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_source uuid;
BEGIN
  IF NEW.request_status = 'Approved'::public.fund_request_status_enum
     AND OLD.request_status IS DISTINCT FROM NEW.request_status THEN
    IF NEW.accounts_line_item_id IS NULL THEN
      RAISE EXCEPTION 'Fund Request approval must originate from an Accounts Sheet.' USING ERRCODE = 'STA06';
    END IF;
    SELECT source_fund_request_id INTO v_source FROM public.acct_requisition_line_items WHERE id = NEW.accounts_line_item_id;
    IF v_source IS DISTINCT FROM NEW.fund_request_id THEN
      RAISE EXCEPTION 'Fund Request Accounts source link is invalid.' USING ERRCODE = 'STA06';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_fund_request_approval_source ON public.fund_requests;
CREATE TRIGGER trg_guard_fund_request_approval_source
BEFORE UPDATE OF request_status ON public.fund_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_fund_request_approval_source();

-- A corrected returned Accounts item becomes reviewable again without ever
-- becoming eligible for a fresh import while its source link remains set.
CREATE OR REPLACE FUNCTION public.sync_returned_fund_request_on_resubmit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source_fund_request_id IS NOT NULL
     AND NEW.requisition_status = 'Pending HO Review'
     AND OLD.requisition_status = 'Returned for Correction' THEN
    UPDATE public.fund_requests
    SET request_status = 'Pending'::public.fund_request_status_enum, updated_at = now()
    WHERE fund_request_id = NEW.source_fund_request_id
      AND accounts_line_item_id = NEW.id
      AND request_status = 'Returned'::public.fund_request_status_enum;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_returned_fund_request ON public.acct_requisition_line_items;
CREATE TRIGGER trg_sync_returned_fund_request
AFTER UPDATE OF requisition_status ON public.acct_requisition_line_items
FOR EACH ROW EXECUTE FUNCTION public.sync_returned_fund_request_on_resubmit();
