-- Migration 069: forward-only fixes for environments that already applied 067.

-- Preserve partial-payment audit semantics: settle the reservation before the
-- release trigger can transition RESERVED rows to RELEASED.
CREATE OR REPLACE FUNCTION public.sync_payment_requisition_execution_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions; v_status varchar; v_paid numeric := 0; v_release numeric := 0;
BEGIN
  IF NEW.source_requisition_id IS NULL OR NEW.requisition_status IS NOT DISTINCT FROM OLD.requisition_status THEN RETURN NEW; END IF;
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = NEW.source_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment Requisition source link is invalid.' USING ERRCODE = 'STA11'; END IF;
  IF v_req.accounts_line_item_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'Payment Requisition Accounts lineage is stale.' USING ERRCODE = 'STA11'; END IF;
  v_status := CASE NEW.requisition_status
    WHEN 'Pending HO Review' THEN 'PENDING_HO_REVIEW' WHEN 'Pending Review' THEN 'PENDING_REVIEW'
    WHEN 'On Hold' THEN 'ON_HOLD' WHEN 'Returned for Correction' THEN 'RETURNED_FOR_CORRECTION'
    WHEN 'Rejected' THEN 'REJECTED' WHEN 'Approved' THEN 'PAID'
    WHEN 'Partially Approved' THEN 'PARTIALLY_PAID' ELSE 'ACCOUNTS_DRAFT' END;
  IF NEW.requisition_status IN ('Approved', 'Partially Approved') THEN v_paid := COALESCE(NEW.ho_pass_amount, 0); END IF;
  IF NEW.requisition_status = 'Rejected' THEN v_release := COALESCE(v_req.approved_amount, 0);
  ELSIF NEW.requisition_status = 'Partially Approved' THEN v_release := GREATEST(COALESCE(v_req.approved_amount, 0) - v_paid, 0); END IF;
  IF NEW.requisition_status IN ('Approved', 'Partially Approved') THEN
    PERFORM public.mark_subcontractor_requisition_settled(v_req.requisition_id, COALESCE(NEW.ho_actioned_at, now()), NEW.ho_actioned_by);
  END IF;
  IF v_release > 0 THEN
    PERFORM public.release_requisition_commitment_transact(v_req.requisition_id, v_release, COALESCE(NEW.ho_actioned_by, 'SYSTEM'));
  END IF;
  UPDATE public.requisitions SET payment_status = v_status, paid_amount = v_paid,
    payment_date = CASE WHEN v_status IN ('PAID', 'PARTIALLY_PAID') THEN COALESCE(NEW.ho_actioned_at, now()) ELSE NULL END,
    updated_at = now() WHERE requisition_id = v_req.requisition_id;
  RETURN NEW;
END;
$$;

-- 056 grants direct table access, but attachment state transitions must be
-- performed through the backend's service-role RPCs.
REVOKE ALL ON TABLE public.requisition_attachments FROM anon, authenticated;
GRANT ALL ON TABLE public.requisition_attachments TO service_role;

-- 067's view grant was too broad for financial data.
REVOKE ALL ON public.subcontractor_balance_summary FROM anon;
GRANT SELECT ON public.subcontractor_balance_summary TO authenticated, service_role;
