-- Migration 095: canonical subcontract finance and capacity cutover.
--
-- New Sub Contractor requisitions use canonical UUID scope and never mutate
-- subcontractor_balances.  Noncanonical requisitions retain the historical
-- Finance path.  The two capacity locks are always acquired in the same order:
-- pooled WO/work, then contractor/work.

CREATE OR REPLACE FUNCTION public.lock_subcontract_financial_scope_pooled(
  p_work_order_no varchar, p_subcontract_work_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_work_order_no IS NULL OR p_subcontract_work_id IS NULL THEN
    RAISE EXCEPTION 'Pooled subcontract financial scope identity is incomplete' USING ERRCODE = 'P4B60';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'subcontract-financial-pooled|' || btrim(p_work_order_no) || '|' || p_subcontract_work_id::text, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_subcontract_financial_scopes(
  p_work_order_no varchar, p_subcontractor_id uuid, p_subcontract_work_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- Pooled first, contractor second.  This order is shared by every writer.
  PERFORM public.lock_subcontract_financial_scope_pooled(p_work_order_no, p_subcontract_work_id);
  PERFORM public.lock_subcontract_financial_scope(p_work_order_no, p_subcontractor_id, p_subcontract_work_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_subcontract_finance_capacity(
  p_work_order_no varchar, p_subcontractor_id uuid, p_subcontract_work_id uuid
) RETURNS TABLE (
  approved_capacity numeric(18,2), reserved_amount numeric(18,2),
  paid_or_settled_amount numeric(18,2), consumed_amount numeric(18,2),
  available_contractor_capacity numeric(18,2), available_cost_estimate_capacity numeric(18,2),
  effective_available_capacity numeric(18,2)
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ce_id uuid;
  v_ce_capacity numeric(18,2) := 0;
  v_contractor_consumed numeric(18,2) := 0;
  v_reserved numeric(18,2) := 0;
  v_paid numeric(18,2) := 0;
  v_approved numeric(18,2) := 0;
BEGIN
  IF p_work_order_no IS NULL OR p_subcontractor_id IS NULL OR p_subcontract_work_id IS NULL THEN
    RAISE EXCEPTION 'Canonical subcontract finance scope is incomplete' USING ERRCODE = 'P4B60';
  END IF;

  SELECT COALESCE(SUM(l.amount), 0)::numeric(18,2) INTO v_approved
  FROM public.project_subcontract_estimates e
  JOIN public.project_subcontract_estimate_lines l ON l.subcontract_estimate_id = e.subcontract_estimate_id
  WHERE btrim(e.work_order_no) = btrim(p_work_order_no)
    AND l.subcontractor_id = p_subcontractor_id
    AND l.subcontract_work_id = p_subcontract_work_id
    AND l.final_approved_revision IS NOT NULL;

  SELECT estimate_id INTO v_ce_id
  FROM public.project_cost_estimates
  WHERE btrim(work_order_no) = btrim(p_work_order_no)
    AND estimate_status = 'Final Approved'
  ORDER BY estimate_revision DESC LIMIT 1;

  IF v_ce_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0)::numeric(18,2) INTO v_ce_capacity
    FROM public.project_cost_estimate_items
    WHERE estimate_id = v_ce_id AND source_type = 'SUBCONTRACT_ESTIMATE'
      AND subcontract_work_id = p_subcontract_work_id;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN l.transaction_type = 'REQUISITION_APPROVAL'
                       AND l.settlement_status = 'RESERVED' THEN abs(l.amount) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN l.transaction_type = 'REQUISITION_PAYMENT' THEN abs(l.amount) ELSE 0 END), 0)
  INTO v_reserved, v_paid
  FROM public.subcontractor_ledger l
  WHERE l.reference_type = 'REQUISITION'
    AND btrim(l.work_order_no) = btrim(p_work_order_no)
    AND l.subcontractor_id = p_subcontractor_id
    AND l.subcontract_work_id = p_subcontract_work_id;
  v_contractor_consumed := (v_reserved + v_paid)::numeric(18,2);

  SELECT v_approved, v_reserved, v_paid, v_contractor_consumed,
         (v_approved - v_contractor_consumed)::numeric(18,2),
         (v_ce_capacity - pooled.consumed)::numeric(18,2),
         LEAST(v_approved - v_contractor_consumed, v_ce_capacity - pooled.consumed)::numeric(18,2)
  INTO approved_capacity, reserved_amount, paid_or_settled_amount, consumed_amount,
       available_contractor_capacity, available_cost_estimate_capacity,
       effective_available_capacity
  FROM (
    SELECT COALESCE(SUM(CASE WHEN l.transaction_type = 'REQUISITION_APPROVAL'
                              AND l.settlement_status = 'RESERVED' THEN abs(l.amount)
                             WHEN l.transaction_type = 'REQUISITION_PAYMENT' THEN abs(l.amount)
                             ELSE 0 END), 0)::numeric(18,2) AS consumed
    FROM public.subcontractor_ledger l
    WHERE l.reference_type = 'REQUISITION'
      AND btrim(l.work_order_no) = btrim(p_work_order_no)
      AND l.subcontract_work_id = p_subcontract_work_id
  ) pooled;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_subcontract_financial_scope_pooled(varchar, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_subcontract_financial_scopes(varchar, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_subcontract_finance_capacity(varchar, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_subcontract_financial_scope_pooled(varchar, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_subcontract_financial_scopes(varchar, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_subcontract_finance_capacity(varchar, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.create_subcontract_requisition_secure(
  p_requester_user_id varchar, p_work_order_no varchar, p_estimate_no varchar,
  p_estimate_amount numeric, p_state varchar, p_district varchar, p_area_code varchar,
  p_department varchar, p_site_details text, p_requisition_no varchar,
  p_material_main_head varchar, p_requisition_pdf_url text, p_original_filename varchar,
  p_requisition_amount numeric, p_gst_bill public.gst_bill_enum, p_gst_bill_pdf_url text,
  p_bank_details text, p_expen_head_remarks text, p_requisition_status public.requisition_status_enum,
  p_created_by varchar, p_material_sub_head varchar DEFAULT NULL,
  p_material_details varchar DEFAULT NULL, p_beneficiary_id uuid DEFAULT NULL,
  p_beneficiary_name varchar DEFAULT NULL, p_beneficiary_ac_no varchar DEFAULT NULL,
  p_beneficiary_ifsc varchar DEFAULT NULL, p_beneficiary_bank_name varchar DEFAULT NULL,
  p_beneficiary_bank_id uuid DEFAULT NULL, p_zo_user_id varchar DEFAULT NULL,
  p_requisition_pdf_attachment_id uuid DEFAULT NULL, p_gst_bill_pdf_attachment_id uuid DEFAULT NULL,
  p_subcontractor_id uuid DEFAULT NULL, p_subcontract_work_id uuid DEFAULT NULL
) RETURNS public.requisitions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.requisitions;
  v_beneficiary uuid;
  v_beneficiary_row public.projects_beneficiary_master%ROWTYPE;
  v_capacity record;
  v_req_attachment public.requisition_attachments;
  v_gst_attachment public.requisition_attachments;
BEGIN
  IF p_subcontractor_id IS NULL OR p_subcontract_work_id IS NULL THEN
    RAISE EXCEPTION 'Canonical subcontractor and subcontract work IDs are required.' USING ERRCODE = 'P4B70';
  END IF;
  PERFORM public.lock_subcontract_financial_scopes(p_work_order_no, p_subcontractor_id, p_subcontract_work_id);
  IF NOT EXISTS (SELECT 1 FROM public.subcontractor_master WHERE id = p_subcontractor_id AND is_active) THEN
    RAISE EXCEPTION 'Selected subcontractor does not exist or is inactive.' USING ERRCODE = 'P4B71';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subcontract_work_master WHERE id = p_subcontract_work_id AND is_active) THEN
    RAISE EXCEPTION 'Selected subcontract work does not exist or is inactive.' USING ERRCODE = 'P4B72';
  END IF;
  SELECT * INTO v_capacity
  FROM public.get_subcontract_finance_capacity(
    p_work_order_no, p_subcontractor_id, p_subcontract_work_id
  );
  IF COALESCE(v_capacity.approved_capacity, 0) <= 0 THEN
    RAISE EXCEPTION 'No positive effective Final Approved subcontract scope exists for this contractor and work.' USING ERRCODE = 'P6F01';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.project_cost_estimates WHERE btrim(work_order_no) = btrim(p_work_order_no) AND estimate_status = 'Final Approved') THEN
    RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
  END IF;
  v_beneficiary := p_beneficiary_id;
  IF v_beneficiary IS NOT NULL THEN
    SELECT * INTO v_beneficiary_row FROM public.projects_beneficiary_master WHERE id = v_beneficiary;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected beneficiary does not exist.' USING ERRCODE = 'P6F02'; END IF;
  END IF;
  IF p_requisition_pdf_attachment_id IS NOT NULL THEN
    SELECT * INTO v_req_attachment
    FROM public.requisition_attachments
    WHERE attachment_id = p_requisition_pdf_attachment_id
      AND kind = 'requisition_pdf'
      AND bucket = 'requisition-pdfs'
      AND status = 'pending'::public.requisition_attachment_status_enum
      AND uploaded_by = p_created_by
    FOR UPDATE;
    IF NOT FOUND OR v_req_attachment.storage_path IS DISTINCT FROM p_requisition_pdf_url THEN
      RAISE EXCEPTION 'Requisition PDF attachment is invalid or no longer pending.' USING ERRCODE = 'ATT01';
    END IF;
  END IF;
  IF p_gst_bill_pdf_attachment_id IS NOT NULL THEN
    SELECT * INTO v_gst_attachment
    FROM public.requisition_attachments
    WHERE attachment_id = p_gst_bill_pdf_attachment_id
      AND kind = 'gst_bill'
      AND bucket = 'gst-bills'
      AND status = 'pending'::public.requisition_attachment_status_enum
      AND uploaded_by = p_created_by
    FOR UPDATE;
    IF NOT FOUND OR v_gst_attachment.storage_path IS DISTINCT FROM p_gst_bill_pdf_url THEN
      RAISE EXCEPTION 'GST bill attachment is invalid or no longer pending.' USING ERRCODE = 'ATT01';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects_master WHERE work_order_no = btrim(p_work_order_no) AND status = 'Closed') THEN
    RAISE EXCEPTION 'Cannot create requisitions for a closed Work Order.' USING ERRCODE = 'PR001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.requisitions WHERE requisition_no = btrim(p_requisition_no) AND requisition_status IS DISTINCT FROM 'Cancelled') THEN
    RAISE EXCEPTION 'A requisition with number % already exists.', btrim(p_requisition_no) USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.requisitions (
    requester_user_id, work_order_no, estimate_no, estimate_amount, state, district, area_code,
    department, site_details, requisition_no, material_main_head, material_sub_head, material_details,
    requisition_pdf_url, original_filename, requisition_amount, gst_bill, gst_bill_pdf_url, bank_details,
    expen_head_remarks, requisition_status, created_by, beneficiary_id, beneficiary_name,
    beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_name, beneficiary_bank_id,
    zo_user_id, subcontractor_id, subcontract_work_id
  ) VALUES (
    p_requester_user_id, btrim(p_work_order_no), p_estimate_no, p_estimate_amount, p_state, p_district, p_area_code,
    p_department, p_site_details, p_requisition_no, 'Sub Contractor', p_material_sub_head, p_material_details,
    p_requisition_pdf_url, p_original_filename, p_requisition_amount, p_gst_bill, p_gst_bill_pdf_url, p_bank_details,
    p_expen_head_remarks, p_requisition_status, p_created_by, v_beneficiary, COALESCE(p_beneficiary_name, v_beneficiary_row.beneficiary_name),
    COALESCE(p_beneficiary_ac_no, v_beneficiary_row.beneficiary_ac_no), COALESCE(p_beneficiary_ifsc, v_beneficiary_row.beneficiary_ifsc), COALESCE(p_beneficiary_bank_name, v_beneficiary_row.beneficiary_bank_name), COALESCE(p_beneficiary_bank_id, v_beneficiary_row.beneficiary_bank_id),
    p_zo_user_id, p_subcontractor_id, p_subcontract_work_id
  ) RETURNING * INTO v_req;
  IF p_requisition_pdf_attachment_id IS NOT NULL THEN
    UPDATE public.requisition_attachments
    SET requisition_id = v_req.requisition_id,
        status = 'committed'::public.requisition_attachment_status_enum,
        committed_at = now()
    WHERE attachment_id = p_requisition_pdf_attachment_id;
  END IF;
  IF p_gst_bill_pdf_attachment_id IS NOT NULL THEN
    UPDATE public.requisition_attachments
    SET requisition_id = v_req.requisition_id,
        status = 'committed'::public.requisition_attachment_status_enum,
        committed_at = now()
    WHERE attachment_id = p_gst_bill_pdf_attachment_id;
  END IF;
  RETURN v_req;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_requisition_transact(
  p_requisition_id uuid, p_approved_amount numeric, p_actioned_by varchar,
  p_remarks_approved_authority text
) RETURNS public.requisitions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.requisitions;
  v_cap record;
  v_ce_id uuid;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF btrim(COALESCE(v_req.material_main_head, '')) <> 'Sub Contractor'
     OR v_req.subcontractor_id IS NULL OR v_req.subcontract_work_id IS NULL THEN
    RETURN public.approve_requisition_transact_unlocked(p_requisition_id, p_approved_amount, p_actioned_by, p_remarks_approved_authority);
  END IF;
  PERFORM public.lock_subcontract_financial_scopes(v_req.work_order_no, v_req.subcontractor_id, v_req.subcontract_work_id);
  -- A Final Approved Cost Estimate is the pooled Finance authorization.  A
  -- SHARE lock makes this approval serialize with reopenEstimate's UPDATE of
  -- the same header: Finance either sees the approved CE before reopen, or
  -- sees no approved CE after reopen, never an interleaved state.
  SELECT estimate_id INTO v_ce_id
  FROM public.project_cost_estimates
  WHERE btrim(work_order_no) = btrim(v_req.work_order_no)
    AND estimate_status = 'Final Approved'
  ORDER BY estimate_revision DESC
  LIMIT 1
  FOR SHARE;
  IF v_ce_id IS NULL THEN
    RAISE EXCEPTION 'No Final Approved cost estimate found for this Work Order.' USING ERRCODE = 'EST01';
  END IF;
  SELECT * INTO v_cap FROM public.get_subcontract_finance_capacity(v_req.work_order_no, v_req.subcontractor_id, v_req.subcontract_work_id);
  IF p_approved_amount > v_cap.available_contractor_capacity THEN
    RAISE EXCEPTION 'Approval exceeds the Final Approved subcontract authorization.' USING ERRCODE = 'P4B19';
  END IF;
  IF p_approved_amount > v_cap.available_cost_estimate_capacity THEN
    RAISE EXCEPTION 'Approval exceeds remaining Cost Estimate work capacity.' USING ERRCODE = 'P6F04';
  END IF;
  IF v_req.requisition_status NOT IN ('Pending', 'Hold') THEN
    RAISE EXCEPTION 'Requisition status must be Pending or Hold.' USING ERRCODE = 'STA01';
  END IF;
  INSERT INTO public.subcontractor_ledger (
    work_order_no, material_main_head, material_sub_head, material_details,
    transaction_type, reference_type, reference_id, amount, created_by,
    settlement_status, subcontractor_id, subcontract_work_id
  ) VALUES (
    v_req.work_order_no, 'Sub Contractor', v_req.material_sub_head, v_req.material_details,
    'REQUISITION_APPROVAL', 'REQUISITION', p_requisition_id, -p_approved_amount, p_actioned_by,
    'RESERVED', v_req.subcontractor_id, v_req.subcontract_work_id
  );
  UPDATE public.requisitions SET requisition_status = 'Approved', approve_type = 'Approve',
    approved_amount = p_approved_amount, approved_balance_amount = requisition_amount - p_approved_amount,
    approved_user_id = p_actioned_by, payment_date = now(), remarks_approved_authority = p_remarks_approved_authority,
    payment_status = 'AWAITING_PAYMENT_ROUTE', updated_at = now()
  WHERE requisition_id = p_requisition_id RETURNING * INTO v_req;
  RETURN v_req;
END;
$$;

-- Canonical release/payment transitions serialize with approvals and do not
-- touch subcontractor_balances.
CREATE OR REPLACE FUNCTION public.release_requisition_commitment_transact(
  p_requisition_id uuid, p_release_amount numeric, p_actioned_by varchar
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions; v_rows integer;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF btrim(COALESCE(v_req.material_main_head, '')) <> 'Sub Contractor' THEN RETURN false; END IF;
  IF v_req.subcontractor_id IS NULL OR v_req.subcontract_work_id IS NULL THEN
    INSERT INTO public.subcontractor_ledger (work_order_no, material_main_head, material_sub_head, material_details, transaction_type, reference_type, reference_id, amount, created_by)
    VALUES (v_req.work_order_no, 'Sub Contractor', v_req.material_sub_head, v_req.material_details, 'REQUISITION_RELEASE', 'REQUISITION', p_requisition_id, p_release_amount, p_actioned_by)
    ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
      UPDATE public.subcontractor_balances SET paid_total = paid_total - p_release_amount, available_balance = available_balance + p_release_amount, updated_at = now()
      WHERE work_order_no = v_req.work_order_no AND material_main_head = 'Sub Contractor' AND material_sub_head = v_req.material_sub_head AND material_details = v_req.material_details AND paid_total >= p_release_amount;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Subcontractor commitment release exceeds the reserved balance.' USING ERRCODE = 'BAL01';
      END IF;
    END IF;
    RETURN v_rows = 1;
  END IF;
  PERFORM public.lock_subcontract_financial_scopes(v_req.work_order_no, v_req.subcontractor_id, v_req.subcontract_work_id);
  INSERT INTO public.subcontractor_ledger (work_order_no, material_main_head, material_sub_head, material_details, transaction_type, reference_type, reference_id, amount, created_by, settlement_status, subcontractor_id, subcontract_work_id)
  VALUES (v_req.work_order_no, 'Sub Contractor', v_req.material_sub_head, v_req.material_details, 'REQUISITION_RELEASE', 'REQUISITION', p_requisition_id, p_release_amount, p_actioned_by, 'RELEASED', v_req.subcontractor_id, v_req.subcontract_work_id)
  ON CONFLICT (transaction_type, reference_type, reference_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_subcontractor_payment(
  p_requisition_id uuid, p_paid_amount numeric, p_settled_at timestamptz, p_settled_by varchar
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF btrim(COALESCE(v_req.material_main_head, '')) <> 'Sub Contractor' THEN RETURN false; END IF;
  IF v_req.subcontractor_id IS NULL OR v_req.subcontract_work_id IS NULL THEN
    INSERT INTO public.subcontractor_ledger (work_order_no, material_main_head, material_sub_head, material_details, transaction_type, reference_type, reference_id, amount, created_by, settlement_status, settled_at, settled_by)
    VALUES (v_req.work_order_no, 'Sub Contractor', v_req.material_sub_head, v_req.material_details, 'REQUISITION_PAYMENT', 'REQUISITION', p_requisition_id, -p_paid_amount, COALESCE(p_settled_by, 'SYSTEM'), 'SETTLED', COALESCE(p_settled_at, now()), p_settled_by)
    ON CONFLICT (transaction_type, reference_type, reference_id) DO UPDATE SET amount = EXCLUDED.amount, settlement_status = 'SETTLED', settled_at = EXCLUDED.settled_at, settled_by = EXCLUDED.settled_by;
    RETURN true;
  END IF;
  PERFORM public.lock_subcontract_financial_scopes(v_req.work_order_no, v_req.subcontractor_id, v_req.subcontract_work_id);
  INSERT INTO public.subcontractor_ledger (work_order_no, material_main_head, material_sub_head, material_details, transaction_type, reference_type, reference_id, amount, created_by, settlement_status, settled_at, settled_by, subcontractor_id, subcontract_work_id)
  VALUES (v_req.work_order_no, 'Sub Contractor', v_req.material_sub_head, v_req.material_details, 'REQUISITION_PAYMENT', 'REQUISITION', p_requisition_id, -p_paid_amount, COALESCE(p_settled_by, 'SYSTEM'), 'SETTLED', COALESCE(p_settled_at, now()), p_settled_by, v_req.subcontractor_id, v_req.subcontract_work_id)
  ON CONFLICT (transaction_type, reference_type, reference_id) DO UPDATE SET amount = EXCLUDED.amount, settlement_status = 'SETTLED', settled_at = EXCLUDED.settled_at, settled_by = EXCLUDED.settled_by;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_subcontractor_requisition_settled(
  p_requisition_id uuid, p_settled_at timestamptz, p_settled_by varchar
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.requisitions;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE requisition_id = p_requisition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisition not found.' USING ERRCODE = 'P0002'; END IF;
  IF btrim(COALESCE(v_req.material_main_head, '')) <> 'Sub Contractor' THEN RETURN; END IF;
  IF v_req.subcontractor_id IS NULL OR v_req.subcontract_work_id IS NULL THEN
    UPDATE public.subcontractor_ledger SET settlement_status = 'SETTLED', settled_at = COALESCE(p_settled_at, now()), settled_by = p_settled_by
    WHERE reference_type = 'REQUISITION' AND reference_id = p_requisition_id AND transaction_type = 'REQUISITION_APPROVAL' AND settlement_status = 'RESERVED';
    RETURN;
  END IF;
  PERFORM public.lock_subcontract_financial_scopes(v_req.work_order_no, v_req.subcontractor_id, v_req.subcontract_work_id);
  UPDATE public.subcontractor_ledger SET settlement_status = 'SETTLED', settled_at = COALESCE(p_settled_at, now()), settled_by = p_settled_by
  WHERE reference_type = 'REQUISITION' AND reference_id = p_requisition_id
    AND transaction_type = 'REQUISITION_APPROVAL' AND settlement_status = 'RESERVED';
END;
$$;

REVOKE ALL ON FUNCTION public.create_subcontract_requisition_secure(varchar, varchar, varchar, numeric, varchar, varchar, varchar, varchar, text, varchar, varchar, text, varchar, numeric, public.gst_bill_enum, text, text, text, public.requisition_status_enum, varchar, varchar, varchar, uuid, varchar, varchar, varchar, varchar, uuid, varchar, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_subcontract_requisition_secure(varchar, varchar, varchar, numeric, varchar, varchar, varchar, varchar, text, varchar, varchar, text, varchar, numeric, public.gst_bill_enum, text, text, text, public.requisition_status_enum, varchar, varchar, varchar, uuid, varchar, varchar, varchar, varchar, uuid, varchar, uuid, uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.approve_requisition_transact(uuid, numeric, varchar, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_requisition_transact(uuid, numeric, varchar, text) TO service_role;
REVOKE ALL ON FUNCTION public.release_requisition_commitment_transact(uuid, numeric, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_requisition_commitment_transact(uuid, numeric, varchar) TO service_role;
REVOKE ALL ON FUNCTION public.record_subcontractor_payment(uuid, numeric, timestamptz, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subcontractor_payment(uuid, numeric, timestamptz, varchar) TO service_role;
REVOKE ALL ON FUNCTION public.mark_subcontractor_requisition_settled(uuid, timestamptz, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subcontractor_requisition_settled(uuid, timestamptz, varchar) TO service_role;

-- The legacy display tuple is not a valid identity for canonical entries.
-- Replace its unconditional FK with an equivalent legacy-only guard.
ALTER TABLE public.subcontractor_ledger DROP CONSTRAINT IF EXISTS fk_scl_balance;
CREATE OR REPLACE FUNCTION public.guard_subcontractor_ledger_balance_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.subcontractor_id IS NOT NULL AND NEW.subcontract_work_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.subcontractor_balances b
    WHERE b.work_order_no = NEW.work_order_no
      AND b.material_main_head = NEW.material_main_head
      AND b.material_sub_head = NEW.material_sub_head
      AND b.material_details = NEW.material_details
  ) THEN
    RAISE EXCEPTION 'Legacy subcontract ledger entry has no matching balance row.' USING ERRCODE = 'P6F06';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_subcontractor_ledger_balance_reference ON public.subcontractor_ledger;
CREATE TRIGGER trg_guard_subcontractor_ledger_balance_reference
BEFORE INSERT OR UPDATE ON public.subcontractor_ledger
FOR EACH ROW EXECUTE FUNCTION public.guard_subcontractor_ledger_balance_reference();
REVOKE ALL ON FUNCTION public.guard_subcontractor_ledger_balance_reference() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_subcontractor_ledger_balance_reference() TO service_role;

-- New canonical rows must be all-or-none and cannot be changed to a display
-- identity after creation.
CREATE OR REPLACE FUNCTION public.guard_canonical_subcontract_requisition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF btrim(COALESCE(NEW.material_main_head, '')) = 'Sub Contractor'
     AND ((NEW.subcontractor_id IS NULL) <> (NEW.subcontract_work_id IS NULL)) THEN
    RAISE EXCEPTION 'Canonical subcontractor and subcontract work IDs must be supplied together.' USING ERRCODE = 'P6F05';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_canonical_subcontract_requisition ON public.requisitions;
CREATE TRIGGER trg_guard_canonical_subcontract_requisition
BEFORE INSERT OR UPDATE OF material_main_head, subcontractor_id, subcontract_work_id ON public.requisitions
FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_subcontract_requisition();

REVOKE ALL ON FUNCTION public.guard_canonical_subcontract_requisition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_canonical_subcontract_requisition() TO service_role;

NOTIFY pgrst, 'reload schema';
