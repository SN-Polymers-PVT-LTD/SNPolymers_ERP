-- Migration 067: make the subcontractor statement settlement-only and make
-- rejected externally sourced Accounts descendants terminal.
--
-- Capacity remains in subcontractor_balances. The visible ledger is an actual
-- payment statement: reservations and releases are operational bookkeeping,
-- not statement transactions.

-- Visibility is derived at the table boundary so existing and future ledger
-- writers cannot accidentally expose reservations or compensating releases.
CREATE OR REPLACE FUNCTION public.set_subcontractor_ledger_visibility()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.ledger_visible := NEW.transaction_type NOT IN ('REQUISITION_APPROVAL', 'REQUISITION_RELEASE');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_subcontractor_ledger_visibility ON public.subcontractor_ledger;
CREATE TRIGGER trg_set_subcontractor_ledger_visibility
BEFORE INSERT OR UPDATE OF transaction_type, ledger_visible ON public.subcontractor_ledger
FOR EACH ROW EXECUTE FUNCTION public.set_subcontractor_ledger_visibility();

UPDATE public.subcontractor_ledger
SET ledger_visible = transaction_type NOT IN ('REQUISITION_APPROVAL', 'REQUISITION_RELEASE');

ALTER TABLE public.subcontractor_ledger
  DROP CONSTRAINT IF EXISTS chk_scl_visibility_taxonomy;

ALTER TABLE public.subcontractor_ledger
  ADD CONSTRAINT chk_scl_visibility_taxonomy CHECK (
    ledger_visible = (transaction_type NOT IN ('REQUISITION_APPROVAL', 'REQUISITION_RELEASE'))
  );

-- One payment event represents the settled amount for a Sub Contractor
-- requisition. Both Accounts and ZO Balance settlement paths call this helper.
CREATE OR REPLACE FUNCTION public.record_subcontractor_payment(
  p_requisition_id uuid,
  p_paid_amount numeric,
  p_settled_at timestamptz,
  p_settled_by varchar
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.requisitions;
BEGIN
  IF p_paid_amount IS NULL OR p_paid_amount <= 0 THEN RETURN false; END IF;
  SELECT * INTO v_req FROM public.requisitions
  WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF trim(v_req.material_main_head) <> 'Sub Contractor' THEN RETURN false; END IF;

  INSERT INTO public.subcontractor_ledger (
    work_order_no, material_main_head, material_sub_head, material_details,
    transaction_type, reference_type, reference_id, amount, created_by,
    settlement_status, settled_at, settled_by
  ) VALUES (
    v_req.work_order_no, 'Sub Contractor', v_req.material_sub_head, v_req.material_details,
    'REQUISITION_PAYMENT', 'REQUISITION', v_req.requisition_id, -p_paid_amount,
    COALESCE(p_settled_by, 'SYSTEM'), 'SETTLED', COALESCE(p_settled_at, now()), p_settled_by
  ) ON CONFLICT (transaction_type, reference_type, reference_id) DO UPDATE
  SET amount = EXCLUDED.amount,
      created_by = EXCLUDED.created_by,
      settlement_status = 'SETTLED',
      settled_at = EXCLUDED.settled_at,
      settled_by = EXCLUDED.settled_by;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_subcontractor_payment(uuid, numeric, timestamptz, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subcontractor_payment(uuid, numeric, timestamptz, varchar) TO service_role;

-- Only the current Accounts descendant may produce the source requisition's
-- actual payment event.
CREATE OR REPLACE FUNCTION public.record_subcontractor_requisition_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.requisitions;
BEGIN
  IF NEW.source_requisition_id IS NULL
     OR NEW.requisition_status IS NOT DISTINCT FROM OLD.requisition_status
     OR NEW.requisition_status NOT IN ('Approved', 'Partially Approved') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_req FROM public.requisitions
  WHERE requisition_id = NEW.source_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment Requisition source link is invalid.' USING ERRCODE = 'STA11'; END IF;
  IF v_req.accounts_line_item_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Payment Requisition Accounts lineage is stale.' USING ERRCODE = 'STA11';
  END IF;

  PERFORM public.record_subcontractor_payment(
    v_req.requisition_id, COALESCE(NEW.ho_pass_amount, 0),
    COALESCE(NEW.ho_actioned_at, now()), NEW.ho_actioned_by
  );
  RETURN NEW;
END;
$$;

-- Direct ZO settlement is a payment too. Preserve its existing ZO debit and
-- add the same subcontractor statement event used by Accounts settlement.
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
  PERFORM public.record_subcontractor_payment(v_req.requisition_id, v_req.paid_amount, v_req.payment_date, p_actioned_by);
  RETURN v_req;
END;
$$;

-- Rejected external obligations have released their reservation and are
-- terminal. Generic Accounts rows keep the historic rejected-rollover flow.
CREATE OR REPLACE FUNCTION public.import_acct_line_item_transact(
  p_source_item_id uuid, p_target_sheet_id uuid, p_imported_by varchar
) RETURNS public.acct_requisition_line_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_source public.acct_requisition_line_items; v_new public.acct_requisition_line_items; v_status varchar; v_updated integer;
BEGIN
  SELECT sheet_status INTO v_status FROM public.acct_requisition_sheets WHERE id = p_target_sheet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target sheet not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'Open' THEN RAISE EXCEPTION 'Items can only be imported into an Open sheet.' USING ERRCODE = 'STA05'; END IF;
  SELECT * INTO v_source FROM public.acct_requisition_line_items WHERE id = p_source_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source line item not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_source.requisition_status NOT IN ('On Hold', 'Rejected', 'Pending Review') THEN RAISE EXCEPTION 'Only On Hold, Rejected, or Pending Review line items can be imported.' USING ERRCODE = 'VAL05'; END IF;
  IF v_source.requisition_status = 'Rejected' AND (v_source.source_fund_request_id IS NOT NULL OR v_source.source_requisition_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Rejected Fund Request and Payment Requisition line items are terminal and cannot be imported.' USING ERRCODE = 'STA12';
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
    account_sub_title_id, account_sub_title_text, particulars, particulars_id, beneficiary_ac_no, beneficiary_name,
    beneficiary_ifsc, beneficiary_bank_name, beneficiary_bank_id, debit_bank_ac_type, req_amount, payment_mode,
    cheque_no, cheque_date, work_order_no
  ) VALUES (
    p_target_sheet_id, p_imported_by, v_source.id, v_source.source_requisition_id, v_source.source_fund_request_id, v_source.credit_ledger_id,
    v_source.account_sub_title_id, v_source.account_sub_title_text, v_source.particulars, v_source.particulars_id,
    v_source.beneficiary_ac_no, v_source.beneficiary_name, v_source.beneficiary_ifsc, v_source.beneficiary_bank_name,
    v_source.beneficiary_bank_id, v_source.debit_bank_ac_type, v_source.req_amount, v_source.payment_mode,
    v_source.cheque_no, v_source.cheque_date, v_source.work_order_no
  ) RETURNING * INTO v_new;
  UPDATE public.acct_requisition_line_items SET imported_to_sheet_id = p_target_sheet_id, imported_at = now(), imported_by = p_imported_by, updated_at = now()
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

-- Apply the Fund Request cap invariant at the actual Pending/Hold -> Approved
-- transition and serialize approvals per work order.
CREATE OR REPLACE FUNCTION public.guard_fund_request_approval_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_source uuid; v_estimate numeric(18,2); v_committed numeric(18,2); v_self numeric(18,2);
BEGIN
  IF NEW.request_status = 'Approved'::public.fund_request_status_enum AND OLD.request_status IS DISTINCT FROM NEW.request_status THEN
    IF NEW.accounts_line_item_id IS NULL THEN RAISE EXCEPTION 'Fund Request approval must originate from an Accounts Sheet.' USING ERRCODE = 'STA06'; END IF;
    SELECT source_fund_request_id INTO v_source FROM public.acct_requisition_line_items WHERE id = NEW.accounts_line_item_id;
    IF v_source IS DISTINCT FROM NEW.fund_request_id THEN RAISE EXCEPTION 'Fund Request Accounts source link is invalid.' USING ERRCODE = 'STA06'; END IF;
    PERFORM 1 FROM public.projects_master WHERE work_order_no = NEW.work_order_no FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Work Order not found.' USING ERRCODE = 'P0002'; END IF;
    SELECT estimate_amount INTO v_estimate FROM public.project_cost_estimates
    WHERE work_order_no = NEW.work_order_no AND estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY estimate_revision DESC LIMIT 1;
    IF v_estimate IS NULL THEN RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01'; END IF;
    SELECT COALESCE(SUM(CASE WHEN request_status = 'Approved' THEN approve_ho_amount WHEN request_status IN ('Pending', 'Hold') THEN zo_fr_amount ELSE 0 END), 0)
    INTO v_committed FROM public.fund_requests WHERE work_order_no = NEW.work_order_no AND request_status IN ('Pending', 'Hold', 'Approved');
    v_self := CASE OLD.request_status
      WHEN 'Approved' THEN COALESCE(OLD.approve_ho_amount, 0)
      WHEN 'Pending' THEN COALESCE(OLD.zo_fr_amount, 0)
      WHEN 'Hold' THEN COALESCE(OLD.zo_fr_amount, 0)
      ELSE 0 END;
    IF COALESCE(NEW.approve_ho_amount, 0) > v_estimate - (v_committed - v_self) THEN
      RAISE EXCEPTION 'Approved amount exceeds the remaining Cost Estimate funding capacity (Capacity: %, Attempted: %).', v_estimate - (v_committed - v_self), NEW.approve_ho_amount USING ERRCODE = 'BUD02';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- A read model explicitly separates authorisation capacity from the payment
-- statement. Negative reserved_total is deliberately exposed as corruption.
CREATE OR REPLACE VIEW public.subcontractor_balance_summary AS
SELECT b.*,
       b.paid_total AS committed_total,
       COALESCE(SUM(CASE WHEN l.transaction_type = 'REQUISITION_PAYMENT' THEN -l.amount ELSE 0 END), 0)::numeric(18,2) AS settled_total,
       (b.paid_total - COALESCE(SUM(CASE WHEN l.transaction_type = 'REQUISITION_PAYMENT' THEN -l.amount ELSE 0 END), 0))::numeric(18,2) AS reserved_total,
       b.available_balance AS available_capacity,
       COALESCE(SUM(CASE WHEN l.ledger_visible THEN l.amount ELSE 0 END), 0)::numeric(18,2) AS statement_balance
FROM public.subcontractor_balances b
LEFT JOIN public.subcontractor_ledger l
  ON l.work_order_no = b.work_order_no
 AND l.material_main_head = b.material_main_head
 AND l.material_sub_head = b.material_sub_head
 AND l.material_details = b.material_details
GROUP BY b.work_order_no, b.material_main_head, b.material_sub_head, b.material_details,
         b.estimated_total, b.paid_total, b.available_balance, b.updated_at;

GRANT SELECT ON public.subcontractor_balance_summary TO anon, authenticated, service_role;
