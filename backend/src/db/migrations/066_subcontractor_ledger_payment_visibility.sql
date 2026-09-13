-- Migration 066: show subcontractor-ledger debits only after HO settlement.
-- ZO approval continues reserving balance, but its reservation row is not a
-- ledger payment. HO Accounts approval creates the visible actual payment.

ALTER TABLE public.subcontractor_ledger
  ADD COLUMN IF NOT EXISTS ledger_visible boolean NOT NULL DEFAULT true;

ALTER TABLE public.subcontractor_ledger
  DROP CONSTRAINT IF EXISTS chk_scl_transaction_type,
  DROP CONSTRAINT IF EXISTS chk_scl_transaction_taxonomy;

ALTER TABLE public.subcontractor_ledger
  ADD CONSTRAINT chk_scl_transaction_type CHECK (transaction_type IN (
    'ESTIMATE_ITEM_APPROVAL', 'ESTIMATE_ITEM_REVERSAL',
    'REQUISITION_APPROVAL', 'REQUISITION_PAYMENT',
    'REQUISITION_RELEASE', 'ADMIN_ADJUSTMENT'
  )),
  ADD CONSTRAINT chk_scl_transaction_taxonomy CHECK (
    (transaction_type = 'ESTIMATE_ITEM_APPROVAL' AND reference_type = 'ESTIMATE_ITEM' AND amount > 0) OR
    (transaction_type = 'ESTIMATE_ITEM_REVERSAL' AND reference_type = 'ESTIMATE_ITEM' AND amount < 0) OR
    (transaction_type IN ('REQUISITION_APPROVAL', 'REQUISITION_PAYMENT') AND reference_type = 'REQUISITION' AND amount < 0) OR
    (transaction_type = 'REQUISITION_RELEASE' AND reference_type = 'REQUISITION' AND amount > 0) OR
    (transaction_type = 'ADMIN_ADJUSTMENT' AND reference_type = 'MANUAL_ADJUSTMENT' AND amount <> 0)
  );

-- Hide historical ZO reservation rows. For already-settled records, retain
-- one visible payment row at the actual HO-paid amount.
UPDATE public.subcontractor_ledger l
SET ledger_visible = false
WHERE l.transaction_type = 'REQUISITION_APPROVAL';

INSERT INTO public.subcontractor_ledger (
  work_order_no, material_main_head, material_sub_head, material_details,
  transaction_type, reference_type, reference_id, amount, created_by,
  settlement_status, settled_at, settled_by, ledger_visible
)
SELECT
  l.work_order_no, l.material_main_head, l.material_sub_head, l.material_details,
  'REQUISITION_PAYMENT', 'REQUISITION', l.reference_id,
  -COALESCE(r.paid_amount, 0), COALESCE(r.approved_user_id, 'SYSTEM'),
  'SETTLED', COALESCE(r.payment_date, now()), COALESCE(r.approved_user_id, 'SYSTEM'), true
FROM public.subcontractor_ledger l
JOIN public.requisitions r ON r.requisition_id = l.reference_id
WHERE l.transaction_type = 'REQUISITION_APPROVAL'
  AND r.payment_status IN ('PAID', 'PARTIALLY_PAID')
  AND COALESCE(r.paid_amount, 0) > 0
ON CONFLICT (transaction_type, reference_type, reference_id) DO UPDATE
SET amount = EXCLUDED.amount,
    settled_at = EXCLUDED.settled_at,
    settled_by = EXCLUDED.settled_by,
    ledger_visible = true;

CREATE OR REPLACE FUNCTION public.record_subcontractor_requisition_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.requisitions;
  v_paid numeric;
  v_ledger public.subcontractor_ledger;
BEGIN
  IF NEW.source_requisition_id IS NULL
     OR NEW.requisition_status IS NOT DISTINCT FROM OLD.requisition_status
     OR NEW.requisition_status NOT IN ('Approved', 'Partially Approved') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_req FROM public.requisitions
  WHERE requisition_id = NEW.source_requisition_id;
  IF NOT FOUND OR trim(v_req.material_main_head) <> 'Sub Contractor' THEN RETURN NEW; END IF;

  v_paid := COALESCE(NEW.ho_pass_amount, 0);
  IF v_paid <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.subcontractor_ledger (
    work_order_no, material_main_head, material_sub_head, material_details,
    transaction_type, reference_type, reference_id, amount, created_by,
    settlement_status, settled_at, settled_by, ledger_visible
  ) VALUES (
    v_req.work_order_no, 'Sub Contractor', v_req.material_sub_head, v_req.material_details,
    'REQUISITION_PAYMENT', 'REQUISITION', v_req.requisition_id, -v_paid,
    COALESCE(NEW.ho_actioned_by, 'SYSTEM'), 'SETTLED',
    COALESCE(NEW.ho_actioned_at, now()), NEW.ho_actioned_by, true
  ) ON CONFLICT (transaction_type, reference_type, reference_id) DO UPDATE
  SET amount = EXCLUDED.amount,
      created_by = EXCLUDED.created_by,
      settled_at = EXCLUDED.settled_at,
      settled_by = EXCLUDED.settled_by,
      ledger_visible = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_subcontractor_requisition_payment ON public.acct_requisition_line_items;
CREATE TRIGGER trg_record_subcontractor_requisition_payment
AFTER UPDATE OF requisition_status ON public.acct_requisition_line_items
FOR EACH ROW EXECUTE FUNCTION public.record_subcontractor_requisition_payment();

REVOKE ALL ON FUNCTION public.record_subcontractor_requisition_payment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subcontractor_requisition_payment() TO service_role;
