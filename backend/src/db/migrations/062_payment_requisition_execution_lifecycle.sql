-- Migration 062: Payment Requisition execution state and complete PR lineage.
-- Builds on 052, 053 and 061.  Authorization, route and execution remain
-- separate concerns; financial settlement stays inside locked RPCs.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.requisitions r
    JOIN public.acct_requisition_line_items li ON li.id = r.accounts_line_item_id
    WHERE li.source_requisition_id IS DISTINCT FROM r.requisition_id
  ) THEN
    RAISE EXCEPTION 'Payment Requisition Accounts pointer integrity violation exists.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.acct_requisition_line_items
    WHERE source_fund_request_id IS NOT NULL AND source_requisition_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Accounts rows cannot have both Fund Request and Payment Requisition provenance.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.acct_requisition_line_items
    WHERE source_requisition_id IS NOT NULL
      AND (payment_mode = 'Credit' OR debit_bank_ac_type = 'Credit' OR credit_ledger_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Existing Payment Requisition Accounts rows violate the external-source Credit invariant.';
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_arli_source_requisition;
CREATE INDEX IF NOT EXISTS idx_arli_source_requisition
  ON public.acct_requisition_line_items(source_requisition_id);

ALTER TABLE public.acct_requisition_line_items
  DROP CONSTRAINT IF EXISTS chk_arli_external_source_exclusive,
  DROP CONSTRAINT IF EXISTS chk_arli_external_source_not_credit;

ALTER TABLE public.acct_requisition_line_items
  ADD CONSTRAINT chk_arli_external_source_exclusive CHECK (
    NOT (source_fund_request_id IS NOT NULL AND source_requisition_id IS NOT NULL)
  ),
  ADD CONSTRAINT chk_arli_external_source_not_credit CHECK (
    (source_fund_request_id IS NULL AND source_requisition_id IS NULL)
    OR (
      payment_mode IS DISTINCT FROM 'Credit'
      AND debit_bank_ac_type IS DISTINCT FROM 'Credit'
      AND credit_ledger_id IS NULL
    )
  );

ALTER TABLE public.requisitions
  ADD COLUMN IF NOT EXISTS payment_status varchar,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zo_actioned_at timestamptz;

ALTER TABLE public.requisitions
  DROP CONSTRAINT IF EXISTS chk_requisition_payment_status,
  DROP CONSTRAINT IF EXISTS chk_requisition_paid_amount;

ALTER TABLE public.requisitions
  ADD CONSTRAINT chk_requisition_payment_status CHECK (
    payment_status IS NULL OR payment_status IN (
      'AWAITING_PAYMENT_ROUTE', 'PENDING_ACCOUNTS_IMPORT', 'ACCOUNTS_DRAFT',
      'PENDING_HO_REVIEW', 'PENDING_REVIEW', 'ON_HOLD',
      'RETURNED_FOR_CORRECTION', 'REJECTED', 'PARTIALLY_PAID', 'PAID'
    )
  ),
  ADD CONSTRAINT chk_requisition_paid_amount CHECK (
    paid_amount >= 0 AND (approved_amount IS NULL OR paid_amount <= approved_amount)
  );

CREATE INDEX IF NOT EXISTS idx_requisitions_payment_status
  ON public.requisitions(payment_status);

-- Existing approvals used payment_date as the ZO action timestamp. Preserve
-- that history before payment_date is given its strict settlement meaning.
UPDATE public.requisitions
SET zo_actioned_at = payment_date
WHERE zo_actioned_at IS NULL
  AND requisition_status IN ('Approved', 'Hold')
  AND payment_date IS NOT NULL;

-- Existing routed Accounts records are execution-pending; current Accounts
-- rows are mapped separately below.
UPDATE public.requisitions
SET payment_status = CASE
  WHEN payment_destination = 'ACCOUNTS' AND accounts_line_item_id IS NULL THEN 'PENDING_ACCOUNTS_IMPORT'
  WHEN payment_destination = 'ZO_BALANCE' THEN 'PAID'
  WHEN requisition_status = 'Approved' THEN 'AWAITING_PAYMENT_ROUTE'
  ELSE NULL
END,
paid_amount = CASE WHEN payment_destination = 'ZO_BALANCE' THEN COALESCE(approved_amount, 0) ELSE 0 END,
payment_date = CASE WHEN payment_destination = 'ZO_BALANCE' THEN payment_date ELSE NULL END
WHERE payment_status IS NULL;

UPDATE public.requisitions r
SET payment_status = CASE li.requisition_status
      WHEN 'Pending HO Review' THEN 'PENDING_HO_REVIEW'
      WHEN 'Pending Review' THEN 'PENDING_REVIEW'
      WHEN 'On Hold' THEN 'ON_HOLD'
      WHEN 'Returned for Correction' THEN 'RETURNED_FOR_CORRECTION'
      WHEN 'Rejected' THEN 'REJECTED'
      WHEN 'Approved' THEN 'PAID'
      WHEN 'Partially Approved' THEN 'PARTIALLY_PAID'
      ELSE 'ACCOUNTS_DRAFT'
    END,
    paid_amount = CASE
      WHEN li.requisition_status IN ('Approved', 'Partially Approved') THEN COALESCE(li.ho_pass_amount, 0)
      ELSE 0
    END,
    payment_date = CASE
      WHEN li.requisition_status IN ('Approved', 'Partially Approved') THEN li.ho_actioned_at
      ELSE NULL
    END
FROM public.acct_requisition_line_items li
WHERE r.accounts_line_item_id = li.id;

ALTER TABLE public.subcontractor_ledger
  DROP CONSTRAINT IF EXISTS chk_scl_transaction_taxonomy;

ALTER TABLE public.subcontractor_ledger
  ADD CONSTRAINT chk_scl_transaction_taxonomy CHECK (
    (transaction_type = 'ESTIMATE_ITEM_APPROVAL' AND reference_type = 'ESTIMATE_ITEM' AND amount > 0) OR
    (transaction_type = 'ESTIMATE_ITEM_REVERSAL' AND reference_type = 'ESTIMATE_ITEM' AND amount < 0) OR
    (transaction_type = 'REQUISITION_APPROVAL' AND reference_type = 'REQUISITION' AND amount < 0) OR
    (transaction_type = 'REQUISITION_RELEASE' AND reference_type = 'REQUISITION' AND amount > 0) OR
    (transaction_type = 'ADMIN_ADJUSTMENT' AND reference_type = 'MANUAL_ADJUSTMENT' AND amount <> 0)
  );

-- Release a reserved subcontractor commitment once. The unique ledger identity
-- is the idempotency marker and the balance mutation follows the insert result.
CREATE OR REPLACE FUNCTION public.release_requisition_commitment_transact(
  p_requisition_id uuid,
  p_release_amount numeric,
  p_actioned_by varchar
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.requisitions;
  v_inserted integer;
BEGIN
  IF p_release_amount IS NULL OR p_release_amount <= 0 THEN RETURN false; END IF;
  SELECT * INTO v_req FROM public.requisitions
  WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF trim(v_req.material_main_head) <> 'Sub Contractor' THEN RETURN false; END IF;

  INSERT INTO public.subcontractor_ledger (
    work_order_no, material_main_head, material_sub_head, material_details,
    transaction_type, reference_type, reference_id, amount, created_by
  ) VALUES (
    v_req.work_order_no, 'Sub Contractor', v_req.material_sub_head, v_req.material_details,
    'REQUISITION_RELEASE', 'REQUISITION', p_requisition_id, p_release_amount, p_actioned_by
  ) ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN RETURN false; END IF;

  UPDATE public.subcontractor_balances
  SET paid_total = paid_total - p_release_amount,
      available_balance = available_balance + p_release_amount,
      updated_at = now()
  WHERE work_order_no = v_req.work_order_no
    AND material_main_head = 'Sub Contractor'
    AND material_sub_head = v_req.material_sub_head
    AND material_details = v_req.material_details
    AND paid_total >= p_release_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subcontractor commitment release exceeds the reserved balance.' USING ERRCODE = 'BAL01';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.release_requisition_commitment_transact(uuid, numeric, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_requisition_commitment_transact(uuid, numeric, varchar) TO service_role;

-- Latest 061 rollover function plus Payment Requisition pointer advancement.
CREATE OR REPLACE FUNCTION public.import_acct_line_item_transact(
  p_source_item_id uuid, p_target_sheet_id uuid, p_imported_by varchar
) RETURNS public.acct_requisition_line_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source public.acct_requisition_line_items;
  v_new public.acct_requisition_line_items;
  v_status varchar;
  v_updated integer;
BEGIN
  SELECT sheet_status INTO v_status FROM public.acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'Open' THEN RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05'; END IF;
  SELECT * INTO v_source FROM public.acct_requisition_line_items WHERE id = p_source_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source line item not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_source.requisition_status NOT IN ('On Hold', 'Rejected', 'Pending Review') THEN
    RAISE EXCEPTION 'Only On Hold, Rejected, or Pending Review line items can be imported.' USING ERRCODE = 'VAL05';
  END IF;
  IF v_source.imported_to_sheet_id IS NOT NULL THEN RAISE EXCEPTION 'This line item has already been imported.' USING ERRCODE = 'STA06'; END IF;
  IF v_source.import_dismissed THEN RAISE EXCEPTION 'This line item has been dismissed and cannot be imported.' USING ERRCODE = 'STA07'; END IF;
  IF v_source.sheet_id = p_target_sheet_id THEN RAISE EXCEPTION 'Cannot import an item into the same sheet it belongs to.' USING ERRCODE = 'STA06'; END IF;

  IF v_source.source_fund_request_id IS NOT NULL THEN
    PERFORM 1 FROM public.fund_requests WHERE fund_request_id = v_source.source_fund_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fund Request source link is invalid.' USING ERRCODE = 'STA06'; END IF;
  END IF;
  IF v_source.source_requisition_id IS NOT NULL THEN
    PERFORM 1 FROM public.requisitions WHERE requisition_id = v_source.source_requisition_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment Requisition source link is invalid.' USING ERRCODE = 'STA06'; END IF;
  END IF;

  INSERT INTO public.acct_requisition_line_items (
    sheet_id, created_by, imported_from_item_id, source_requisition_id, source_fund_request_id, credit_ledger_id,
    account_sub_title_id, account_sub_title_text, particulars, particulars_id,
    beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_name, beneficiary_bank_id,
    debit_bank_ac_type, req_amount, payment_mode, cheque_no, cheque_date, work_order_no
  ) VALUES (
    p_target_sheet_id, p_imported_by, v_source.id, v_source.source_requisition_id, v_source.source_fund_request_id, v_source.credit_ledger_id,
    v_source.account_sub_title_id, v_source.account_sub_title_text, v_source.particulars, v_source.particulars_id,
    v_source.beneficiary_ac_no, v_source.beneficiary_name, v_source.beneficiary_ifsc, v_source.beneficiary_bank_name, v_source.beneficiary_bank_id,
    v_source.debit_bank_ac_type, v_source.req_amount, v_source.payment_mode, v_source.cheque_no, v_source.cheque_date, v_source.work_order_no
  ) RETURNING * INTO v_new;

  UPDATE public.acct_requisition_line_items
  SET imported_to_sheet_id = p_target_sheet_id, imported_at = now(), imported_by = p_imported_by, updated_at = now()
  WHERE id = p_source_item_id AND imported_to_sheet_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This line item was imported concurrently.' USING ERRCODE = 'STA06'; END IF;

  IF v_source.source_fund_request_id IS NOT NULL THEN
    UPDATE public.fund_requests SET accounts_line_item_id = v_new.id, accounts_imported_at = now(), updated_at = now()
    WHERE fund_request_id = v_source.source_fund_request_id AND accounts_line_item_id = v_source.id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN RAISE EXCEPTION 'Fund Request Accounts lineage changed while this item was being imported.' USING ERRCODE = 'STA11'; END IF;
  END IF;
  IF v_source.source_requisition_id IS NOT NULL THEN
    UPDATE public.requisitions SET accounts_line_item_id = v_new.id, accounts_imported_at = now(), payment_status = 'ACCOUNTS_DRAFT', updated_at = now()
    WHERE requisition_id = v_source.source_requisition_id AND accounts_line_item_id = v_source.id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN RAISE EXCEPTION 'Payment Requisition Accounts lineage changed while this item was being imported.' USING ERRCODE = 'STA11'; END IF;
  END IF;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.import_acct_line_item_transact(uuid, uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_acct_line_item_transact(uuid, uuid, varchar) TO service_role;

-- Keep deferred import routing, adding execution-state transitions.
CREATE OR REPLACE FUNCTION public.route_requisition_to_accounts_transact(
  p_requisition_id uuid, p_actor varchar
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_req.requisition_status <> 'Approved' THEN RAISE EXCEPTION 'Only Approved requisitions can be sent to Accounts. Current status: %', v_req.requisition_status USING ERRCODE = 'STA01'; END IF;
  IF v_req.payment_destination IS NOT NULL THEN RAISE EXCEPTION 'This requisition has already selected a payment route (%).', v_req.payment_destination USING ERRCODE = 'RTE01'; END IF;
  UPDATE public.requisitions SET payment_destination = 'ACCOUNTS', payment_status = 'PENDING_ACCOUNTS_IMPORT', paid_amount = 0,
    payment_date = NULL, accounts_line_item_id = NULL, accounts_sent_at = now(), accounts_sent_by = p_actor,
    accounts_import_dismissed = false, updated_at = now()
  WHERE requisition_id = p_requisition_id RETURNING * INTO v_req;
  RETURN jsonb_build_object('requisition', row_to_json(v_req));
END;
$$;
GRANT ALL ON FUNCTION public.route_requisition_to_accounts_transact(uuid, varchar) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.select_zo_balance_payment_transact(
  p_requisition_id uuid, p_actioned_by varchar
) RETURNS public.requisitions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions; v_balance numeric;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_req.requisition_status <> 'Approved' THEN RAISE EXCEPTION 'Only Approved requisitions can select a payment route. Current status: %', v_req.requisition_status USING ERRCODE = 'STA01'; END IF;
  IF v_req.payment_destination IS NOT NULL THEN RAISE EXCEPTION 'This requisition has already selected a payment route (%).', v_req.payment_destination USING ERRCODE = 'RTE01'; END IF;
  SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_req.zo_user_id FOR UPDATE;
  IF NOT FOUND OR v_balance < v_req.approved_amount THEN RAISE EXCEPTION 'Insufficient available Zonal Office balance.' USING ERRCODE = 'BAL01'; END IF;
  UPDATE public.zo_balances SET available_balance = available_balance - v_req.approved_amount, updated_at = now() WHERE zo_user_id = v_req.zo_user_id;
  INSERT INTO public.zo_fund_ledger (zo_user_id, transaction_type, reference_type, reference_id, amount, work_order_no, created_by)
  VALUES (v_req.zo_user_id, 'REQUISITION_APPROVAL', 'REQUISITION', p_requisition_id, -v_req.approved_amount, v_req.work_order_no, p_actioned_by);
  UPDATE public.requisitions SET payment_destination = 'ZO_BALANCE', payment_status = 'PAID', paid_amount = approved_amount,
    payment_date = now(), updated_at = now() WHERE requisition_id = p_requisition_id RETURNING * INTO v_req;
  RETURN v_req;
END;
$$;
GRANT ALL ON FUNCTION public.select_zo_balance_payment_transact(uuid, varchar) TO anon, authenticated, service_role;

-- The old approval RPC still writes payment_date for compatibility. Normalize
-- that write at the database boundary so approval records the ZO action only.
CREATE OR REPLACE FUNCTION public.normalize_requisition_authorization_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.requisition_status = 'Approved'
     AND NEW.payment_destination IS NULL
     AND NEW.payment_status IS DISTINCT FROM 'PAID'
     AND NEW.payment_status IS DISTINCT FROM 'PENDING_ACCOUNTS_IMPORT' THEN
    NEW.zo_actioned_at := COALESCE(NEW.zo_actioned_at, NEW.payment_date, now());
    NEW.payment_status := 'AWAITING_PAYMENT_ROUTE';
    NEW.paid_amount := 0;
    NEW.payment_date := NULL;
  ELSIF NEW.requisition_status = 'Hold' THEN
    NEW.zo_actioned_at := COALESCE(NEW.zo_actioned_at, NEW.payment_date, now());
    NEW.payment_status := NULL;
    NEW.paid_amount := 0;
    NEW.payment_date := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_requisition_authorization_state ON public.requisitions;
CREATE TRIGGER trg_normalize_requisition_authorization_state
BEFORE UPDATE ON public.requisitions
FOR EACH ROW EXECUTE FUNCTION public.normalize_requisition_authorization_state();

CREATE OR REPLACE FUNCTION public.import_payment_requisition_to_acct_sheet_transact(
  p_requisition_id uuid, p_target_sheet_id uuid, p_imported_by varchar
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions; v_status varchar; v_title uuid; v_item public.acct_requisition_line_items;
BEGIN
  SELECT sheet_status INTO v_status FROM public.acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'Open' THEN RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05'; END IF;
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_req.payment_destination <> 'ACCOUNTS' THEN RAISE EXCEPTION 'Only requisitions routed to Accounts can be imported.' USING ERRCODE = 'VAL05'; END IF;
  IF v_req.accounts_line_item_id IS NOT NULL THEN RAISE EXCEPTION 'This requisition has already been imported into an Accounts sheet.' USING ERRCODE = 'STA06'; END IF;
  IF COALESCE(v_req.accounts_import_dismissed, false) THEN RAISE EXCEPTION 'This requisition has been dismissed and cannot be imported.' USING ERRCODE = 'STA07'; END IF;
  SELECT id INTO v_title FROM public.account_sub_title_master WHERE is_active AND upper(trim(title)) = upper(trim(v_req.material_main_head)) LIMIT 1;
  INSERT INTO public.acct_requisition_line_items (
    sheet_id, source_requisition_id, created_by, account_sub_title_id, account_sub_title_text,
    particulars, beneficiary_ac_no, beneficiary_name, beneficiary_ifsc, beneficiary_bank_id,
    beneficiary_bank_name, req_amount, work_order_no
  ) VALUES (
    p_target_sheet_id, p_requisition_id, p_imported_by, v_title, v_req.material_main_head,
    NULLIF(trim(v_req.expen_head_remarks), ''), v_req.beneficiary_ac_no, v_req.beneficiary_name,
    v_req.beneficiary_ifsc, v_req.beneficiary_bank_id, v_req.beneficiary_bank_name,
    v_req.approved_amount, v_req.work_order_no
  ) RETURNING * INTO v_item;
  UPDATE public.requisitions SET accounts_line_item_id = v_item.id, accounts_imported_at = now(), payment_status = 'ACCOUNTS_DRAFT', paid_amount = 0, updated_at = now()
  WHERE requisition_id = p_requisition_id
  RETURNING * INTO v_req;
  RETURN jsonb_build_object('requisition', row_to_json(v_req), 'line_item', row_to_json(v_item));
END;
$$;
GRANT ALL ON FUNCTION public.import_payment_requisition_to_acct_sheet_transact(uuid, uuid, varchar) TO anon, authenticated, service_role;

-- Project Accounts workflow status onto the current PR descendant. Financial
-- release is protected by the same transaction and idempotent ledger helper.
CREATE OR REPLACE FUNCTION public.sync_payment_requisition_execution_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions; v_status varchar; v_paid numeric := 0; v_release numeric := 0;
BEGIN
  IF NEW.source_requisition_id IS NULL OR NEW.requisition_status IS NOT DISTINCT FROM OLD.requisition_status THEN RETURN NEW; END IF;
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = NEW.source_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment Requisition source link is invalid.' USING ERRCODE = 'STA11'; END IF;
  IF v_req.accounts_line_item_id <> NEW.id THEN RAISE EXCEPTION 'Payment Requisition Accounts lineage is stale.' USING ERRCODE = 'STA11'; END IF;
  v_status := CASE NEW.requisition_status
    WHEN 'Pending HO Review' THEN 'PENDING_HO_REVIEW'
    WHEN 'Pending Review' THEN 'PENDING_REVIEW'
    WHEN 'On Hold' THEN 'ON_HOLD'
    WHEN 'Returned for Correction' THEN 'RETURNED_FOR_CORRECTION'
    WHEN 'Rejected' THEN 'REJECTED'
    WHEN 'Approved' THEN 'PAID'
    WHEN 'Partially Approved' THEN 'PARTIALLY_PAID'
    ELSE 'ACCOUNTS_DRAFT' END;
  IF NEW.requisition_status IN ('Approved', 'Partially Approved') THEN v_paid := COALESCE(NEW.ho_pass_amount, 0); END IF;
  IF NEW.requisition_status = 'Rejected' THEN v_release := COALESCE(v_req.approved_amount, 0); END IF;
  IF NEW.requisition_status = 'Partially Approved' THEN v_release := GREATEST(COALESCE(v_req.approved_amount, 0) - v_paid, 0); END IF;
  IF v_release > 0 THEN PERFORM public.release_requisition_commitment_transact(v_req.requisition_id, v_release, COALESCE(NEW.ho_actioned_by, 'SYSTEM')); END IF;
  UPDATE public.requisitions SET payment_status = v_status, paid_amount = v_paid,
    payment_date = CASE WHEN v_status IN ('PAID', 'PARTIALLY_PAID') THEN COALESCE(NEW.ho_actioned_at, now()) ELSE NULL END,
    updated_at = now() WHERE requisition_id = v_req.requisition_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payment_requisition_execution_status ON public.acct_requisition_line_items;
CREATE TRIGGER trg_sync_payment_requisition_execution_status
AFTER UPDATE OF requisition_status ON public.acct_requisition_line_items
FOR EACH ROW EXECUTE FUNCTION public.sync_payment_requisition_execution_status();
