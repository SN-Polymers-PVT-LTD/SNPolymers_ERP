-- Forward-only remediation for databases that already applied 067-069.
-- Keeps direct ZO settlement and cancelled attachment cleanup idempotent.

CREATE OR REPLACE FUNCTION public.select_zo_balance_payment_transact(
  p_requisition_id uuid, p_actioned_by varchar
) RETURNS public.requisitions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions; v_balance numeric;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_req.requisition_status <> 'Approved' THEN
    RAISE EXCEPTION 'Only Approved requisitions can select a payment route. Current status: %', v_req.requisition_status USING ERRCODE = 'STA01';
  END IF;
  IF v_req.payment_destination IS NOT NULL THEN
    RAISE EXCEPTION 'This requisition has already selected a payment route (%).', v_req.payment_destination USING ERRCODE = 'RTE01';
  END IF;
  SELECT available_balance INTO v_balance FROM public.zo_balances WHERE zo_user_id = v_req.zo_user_id FOR UPDATE;
  IF NOT FOUND OR v_balance < v_req.approved_amount THEN
    RAISE EXCEPTION 'Insufficient available Zonal Office balance.' USING ERRCODE = 'BAL01';
  END IF;
  UPDATE public.zo_balances SET available_balance = available_balance - v_req.approved_amount, updated_at = now()
  WHERE zo_user_id = v_req.zo_user_id;
  INSERT INTO public.zo_fund_ledger (zo_user_id, transaction_type, reference_type, reference_id, amount, work_order_no, created_by)
  VALUES (v_req.zo_user_id, 'REQUISITION_APPROVAL', 'REQUISITION', p_requisition_id, -v_req.approved_amount, v_req.work_order_no, p_actioned_by);
  UPDATE public.requisitions SET payment_destination = 'ZO_BALANCE', payment_status = 'PAID', paid_amount = approved_amount,
    payment_date = now(), updated_at = now() WHERE requisition_id = p_requisition_id RETURNING * INTO v_req;
  -- Close the authorization reservation before recording the visible payment.
  PERFORM public.mark_subcontractor_requisition_settled(v_req.requisition_id, v_req.payment_date, p_actioned_by);
  PERFORM public.record_subcontractor_payment(v_req.requisition_id, v_req.paid_amount, v_req.payment_date, p_actioned_by);
  RETURN v_req;
END;
$$;

-- Only cancelled requisitions may authorize cleanup of a committed attachment.
CREATE OR REPLACE FUNCTION public.acquire_cancelled_requisition_attachment_cleanup(
  p_requisition_id uuid, p_actor varchar
) RETURNS SETOF public.requisition_attachments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions; v_is_admin boolean;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_req.requisition_status <> 'Cancelled' THEN
    RAISE EXCEPTION 'Attachment cleanup is only available for cancelled requisitions.' USING ERRCODE = 'STA08';
  END IF;
  SELECT (role = 'admin') INTO v_is_admin FROM public.authorised_users
  WHERE mobile_number = p_actor AND is_active = true;
  IF NOT COALESCE(v_is_admin, false) AND v_req.requester_user_id <> p_actor THEN
    RAISE EXCEPTION 'Access denied for attachment cleanup.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.requisition_attachments
  SET status = 'deleting', deletion_started_at = COALESCE(deletion_started_at, now())
  WHERE requisition_id = p_requisition_id AND status = 'committed';
  RETURN QUERY SELECT * FROM public.requisition_attachments
    WHERE requisition_id = p_requisition_id AND status = 'deleting';
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_cancelled_requisition_attachment_cleanup(uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cancelled_requisition_attachment_cleanup(uuid, varchar) TO service_role;
