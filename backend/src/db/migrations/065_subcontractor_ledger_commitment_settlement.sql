-- Migration 065: Make subcontractor requisition ledger lifecycle explicit.
--
-- The existing negative REQUISITION_APPROVAL entry is created at ZO approval
-- to reserve budget. It must not be debited again when Accounts/HO completes
-- the payment. Track that same entry's lifecycle so the ledger distinguishes
-- RESERVED from SETTLED while keeping the existing overspend protection.

ALTER TABLE public.subcontractor_ledger
  ADD COLUMN IF NOT EXISTS settlement_status varchar NOT NULL DEFAULT 'RESERVED',
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by varchar;

ALTER TABLE public.subcontractor_ledger
  DROP CONSTRAINT IF EXISTS chk_scl_settlement_status;

ALTER TABLE public.subcontractor_ledger
  ADD CONSTRAINT chk_scl_settlement_status CHECK (
    settlement_status IN ('RESERVED', 'SETTLED', 'RELEASED')
  );

-- Existing requisition debits represent reservations. Mark records whose
-- payment has already completed as settled; rejected/cancelled records are
-- released by their compensating REQUISITION_RELEASE entry.
UPDATE public.subcontractor_ledger l
SET settlement_status = CASE
      WHEN r.payment_status IN ('PAID', 'PARTIALLY_PAID') OR r.payment_date IS NOT NULL THEN 'SETTLED'
      ELSE 'RESERVED'
    END,
    settled_at = CASE
      WHEN r.payment_status IN ('PAID', 'PARTIALLY_PAID') OR r.payment_date IS NOT NULL THEN r.payment_date
      ELSE NULL
    END
FROM public.requisitions r
WHERE l.reference_type = 'REQUISITION'
  AND l.transaction_type = 'REQUISITION_APPROVAL'
  AND l.reference_id = r.requisition_id;

-- Mark the reservation as settled when Accounts/HO approves the linked item.
CREATE OR REPLACE FUNCTION public.mark_subcontractor_requisition_settled(
  p_requisition_id uuid,
  p_settled_at timestamptz,
  p_settled_by varchar
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.subcontractor_ledger
  SET settlement_status = 'SETTLED',
      settled_at = COALESCE(p_settled_at, now()),
      settled_by = p_settled_by
  WHERE reference_type = 'REQUISITION'
    AND transaction_type = 'REQUISITION_APPROVAL'
    AND reference_id = p_requisition_id
    AND settlement_status = 'RESERVED';
END;
$$;

-- A compensating release closes the original reservation. This trigger keeps
-- the two append-only entries linked without changing the release RPC's
-- existing idempotency and balance logic.
CREATE OR REPLACE FUNCTION public.mark_subcontractor_requisition_released()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.transaction_type = 'REQUISITION_RELEASE'
     AND NEW.reference_type = 'REQUISITION' THEN
    UPDATE public.subcontractor_ledger
    SET settlement_status = 'RELEASED',
        settled_at = COALESCE(NEW.created_at, now()),
        settled_by = NEW.created_by
    WHERE transaction_type = 'REQUISITION_APPROVAL'
      AND reference_type = 'REQUISITION'
      AND reference_id = NEW.reference_id
      AND settlement_status = 'RESERVED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_subcontractor_requisition_released ON public.subcontractor_ledger;
CREATE TRIGGER trg_mark_subcontractor_requisition_released
AFTER INSERT ON public.subcontractor_ledger
FOR EACH ROW EXECUTE FUNCTION public.mark_subcontractor_requisition_released();

REVOKE ALL ON FUNCTION public.mark_subcontractor_requisition_settled(uuid, timestamptz, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subcontractor_requisition_settled(uuid, timestamptz, varchar) TO service_role;

-- Replace the execution synchronizer while retaining its existing balance
-- release behavior for rejection and partial approval.
CREATE OR REPLACE FUNCTION public.sync_payment_requisition_execution_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.requisitions;
  v_status varchar;
  v_paid numeric := 0;
  v_release numeric := 0;
BEGIN
  IF NEW.source_requisition_id IS NULL OR NEW.requisition_status IS NOT DISTINCT FROM OLD.requisition_status THEN RETURN NEW; END IF;

  SELECT * INTO v_req FROM public.requisitions
  WHERE requisition_id = NEW.source_requisition_id FOR UPDATE;
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
    ELSE 'ACCOUNTS_DRAFT'
  END;

  IF NEW.requisition_status IN ('Approved', 'Partially Approved') THEN
    v_paid := COALESCE(NEW.ho_pass_amount, 0);
  END IF;
  IF NEW.requisition_status = 'Rejected' THEN
    v_release := COALESCE(v_req.approved_amount, 0);
  ELSIF NEW.requisition_status = 'Partially Approved' THEN
    v_release := GREATEST(COALESCE(v_req.approved_amount, 0) - v_paid, 0);
  END IF;

  IF v_release > 0 THEN
    PERFORM public.release_requisition_commitment_transact(
      v_req.requisition_id, v_release, COALESCE(NEW.ho_actioned_by, 'SYSTEM')
    );
  END IF;

  IF NEW.requisition_status IN ('Approved', 'Partially Approved') THEN
    PERFORM public.mark_subcontractor_requisition_settled(
      v_req.requisition_id, COALESCE(NEW.ho_actioned_at, now()), NEW.ho_actioned_by
    );
  END IF;

  UPDATE public.requisitions
  SET payment_status = v_status,
      paid_amount = v_paid,
      payment_date = CASE WHEN v_status IN ('PAID', 'PARTIALLY_PAID') THEN COALESCE(NEW.ho_actioned_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE requisition_id = v_req.requisition_id;
  RETURN NEW;
END;
$$;
