-- Migration 088: Phase 4B Finance identity bridge and canonical consumption.
--
-- This migration deliberately does not mutate Finance balances or payment
-- state.  It only carries the normalized identity into new requisitions and
-- ledger events, and exposes the read-only amount needed by Final Approval.

CREATE OR REPLACE FUNCTION public.get_subcontract_financial_consumption(
  p_work_order_no varchar,
  p_subcontractor_id uuid,
  p_subcontract_work_id uuid
)
RETURNS numeric(18,2)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      -- A reservation remains active until it is released.  Once settled,
      -- the payment event is the consumption and the reservation is not
      -- counted a second time.
      WHEN l.transaction_type = 'REQUISITION_APPROVAL'
       AND l.settlement_status = 'RESERVED' THEN abs(l.amount)
      WHEN l.transaction_type = 'REQUISITION_PAYMENT' THEN abs(l.amount)
      ELSE 0
    END
  ), 0)::numeric(18,2)
  FROM public.subcontractor_ledger l
  WHERE l.reference_type = 'REQUISITION'
    AND btrim(l.work_order_no) = btrim(p_work_order_no)
    AND l.subcontractor_id = p_subcontractor_id
    AND l.subcontract_work_id = p_subcontract_work_id;
$$;

REVOKE ALL ON FUNCTION public.get_subcontract_financial_consumption(varchar, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_subcontract_financial_consumption(varchar, uuid, uuid)
  TO service_role;

-- Legacy Finance RPCs still insert ledger rows from display snapshots.  Fill
-- the canonical IDs from the requisition inside the same transaction so
-- approval, payment, and release events all share one identity bridge.
CREATE OR REPLACE FUNCTION public.populate_subcontract_ledger_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.requisitions%ROWTYPE;
BEGIN
  IF NEW.reference_type = 'REQUISITION'
     AND NEW.reference_id IS NOT NULL
     AND (NEW.subcontractor_id IS NULL OR NEW.subcontract_work_id IS NULL) THEN
    SELECT * INTO v_req
    FROM public.requisitions
    WHERE requisition_id = NEW.reference_id;

    IF FOUND AND btrim(COALESCE(v_req.material_main_head, '')) = 'Sub Contractor' THEN
      NEW.subcontractor_id := COALESCE(NEW.subcontractor_id, v_req.subcontractor_id);
      NEW.subcontract_work_id := COALESCE(NEW.subcontract_work_id, v_req.subcontract_work_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_subcontract_ledger_identity ON public.subcontractor_ledger;
CREATE TRIGGER trg_populate_subcontract_ledger_identity
BEFORE INSERT ON public.subcontractor_ledger
FOR EACH ROW EXECUTE FUNCTION public.populate_subcontract_ledger_identity();

REVOKE ALL ON FUNCTION public.populate_subcontract_ledger_identity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.populate_subcontract_ledger_identity() TO service_role;

-- The existing create RPC remains available for legacy requisitions.  New
-- Sub Contractor creation goes through this atomic identity-aware adapter.
CREATE OR REPLACE FUNCTION public.create_subcontract_requisition_secure(
  p_requester_user_id varchar,
  p_work_order_no varchar,
  p_estimate_no varchar,
  p_estimate_amount numeric,
  p_state varchar,
  p_district varchar,
  p_area_code varchar,
  p_department varchar,
  p_site_details text,
  p_requisition_no varchar,
  p_material_main_head varchar,
  p_requisition_pdf_url text,
  p_original_filename varchar,
  p_requisition_amount numeric,
  p_gst_bill public.gst_bill_enum,
  p_gst_bill_pdf_url text,
  p_bank_details text,
  p_expen_head_remarks text,
  p_requisition_status public.requisition_status_enum,
  p_created_by varchar,
  p_material_sub_head varchar DEFAULT NULL,
  p_material_details varchar DEFAULT NULL,
  p_beneficiary_id uuid DEFAULT NULL,
  p_beneficiary_name varchar DEFAULT NULL,
  p_beneficiary_ac_no varchar DEFAULT NULL,
  p_beneficiary_ifsc varchar DEFAULT NULL,
  p_beneficiary_bank_name varchar DEFAULT NULL,
  p_beneficiary_bank_id uuid DEFAULT NULL,
  p_zo_user_id varchar DEFAULT NULL,
  p_requisition_pdf_attachment_id uuid DEFAULT NULL,
  p_gst_bill_pdf_attachment_id uuid DEFAULT NULL,
  p_subcontractor_id uuid DEFAULT NULL,
  p_subcontract_work_id uuid DEFAULT NULL
)
RETURNS public.requisitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.requisitions;
BEGIN
  IF p_subcontractor_id IS NULL OR p_subcontract_work_id IS NULL THEN
    RAISE EXCEPTION 'Canonical subcontractor and subcontract work IDs are required.' USING ERRCODE = 'P4B70';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subcontractor_master WHERE id = p_subcontractor_id AND is_active = true) THEN
    RAISE EXCEPTION 'Selected subcontractor does not exist or is inactive.' USING ERRCODE = 'P4B71';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subcontract_work_master WHERE id = p_subcontract_work_id AND is_active = true) THEN
    RAISE EXCEPTION 'Selected subcontract work does not exist or is inactive.' USING ERRCODE = 'P4B72';
  END IF;

  PERFORM public.lock_subcontract_financial_scope(p_work_order_no, p_subcontractor_id, p_subcontract_work_id);

  v_req := public.create_requisition_secure(
    p_requester_user_id, p_work_order_no, p_estimate_no, p_estimate_amount,
    p_state, p_district, p_area_code, p_department, p_site_details,
    p_requisition_no, p_material_main_head, p_requisition_pdf_url,
    p_original_filename, p_requisition_amount, p_gst_bill, p_gst_bill_pdf_url,
    p_bank_details, p_expen_head_remarks, p_requisition_status, p_created_by,
    p_material_sub_head, p_material_details, p_beneficiary_id,
    p_beneficiary_name, p_beneficiary_ac_no, p_beneficiary_ifsc,
    p_beneficiary_bank_name, p_beneficiary_bank_id, p_zo_user_id,
    p_requisition_pdf_attachment_id, p_gst_bill_pdf_attachment_id
  );

  UPDATE public.requisitions
  SET subcontractor_id = p_subcontractor_id,
      subcontract_work_id = p_subcontract_work_id
  WHERE requisition_id = v_req.requisition_id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public.create_subcontract_requisition_secure(
  varchar, varchar, varchar, numeric, varchar, varchar, varchar, varchar, text,
  varchar, varchar, text, varchar, numeric, public.gst_bill_enum, text, text,
  text, public.requisition_status_enum, varchar, varchar, varchar, uuid, varchar,
  varchar, varchar, varchar, uuid, varchar, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_subcontract_requisition_secure(
  varchar, varchar, varchar, numeric, varchar, varchar, varchar, varchar, text,
  varchar, varchar, text, varchar, numeric, public.gst_bill_enum, text, text,
  text, public.requisition_status_enum, varchar, varchar, varchar, uuid, varchar,
  varchar, varchar, varchar, uuid, varchar, uuid, uuid, uuid, uuid
) TO service_role;

-- Make the already-installed workflow implementation conservative for its
-- legacy internal check. The public wrapper added in 087 performs the
-- canonical read-only check; this prevents the old check from double-counting
-- settled reservations after a payment has been recorded.
DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'transition_subcontract_estimate_workflow_unlocked'
    AND p.pronargs = 6
  ORDER BY p.oid DESC LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 4B unlocked workflow function was not found.';
  END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  v_new := replace(v_def,
    'AND settlement_status IN (''RESERVED'', ''SETTLED'')',
    'AND settlement_status = ''RESERVED''');
  IF v_new <> v_def THEN EXECUTE v_new; END IF;
END $$;

-- Redefine the public wrapper so the canonical primitive is the authoritative
-- guard while preserving the existing workflow implementation and audit path.
CREATE OR REPLACE FUNCTION public.transition_subcontract_estimate_workflow(
  p_estimate_id uuid,
  p_actor varchar,
  p_action varchar,
  p_remarks text,
  p_expected_updated_at timestamptz,
  p_deadline_hours integer DEFAULT 24
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_work_order_no varchar;
  v_effective numeric(18,2);
  v_consumed numeric(18,2);
  v_scope record;
BEGIN
  IF p_action = 'HO_APPROVE' THEN
    SELECT work_order_no INTO v_work_order_no
    FROM public.project_subcontract_estimates
    WHERE subcontract_estimate_id = p_estimate_id;

    FOR v_scope IN
      SELECT subcontractor_id, subcontract_work_id, sum(amount) AS effective_amount
      FROM public.project_subcontract_estimate_lines
      WHERE subcontract_estimate_id = p_estimate_id
      GROUP BY subcontractor_id, subcontract_work_id
    LOOP
      PERFORM public.lock_subcontract_financial_scope(v_work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id);
      v_effective := v_scope.effective_amount;
      v_consumed := public.get_subcontract_financial_consumption(v_work_order_no, v_scope.subcontractor_id, v_scope.subcontract_work_id);
      IF v_effective < v_consumed THEN
        RAISE EXCEPTION 'SUBCONTRACT_SCOPE_BELOW_FINANCIAL_CONSUMPTION: proposed %, consumed %', v_effective, v_consumed
          USING ERRCODE = 'P4B18';
      END IF;
    END LOOP;
  END IF;

  PERFORM public.transition_subcontract_estimate_workflow_unlocked(
    p_estimate_id, p_actor, p_action, p_remarks, p_expected_updated_at, p_deadline_hours
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_subcontract_estimate_workflow(uuid, varchar, varchar, text, timestamptz, integer)
  TO service_role;
