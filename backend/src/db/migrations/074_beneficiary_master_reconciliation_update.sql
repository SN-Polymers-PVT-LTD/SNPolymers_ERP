-- Migration 074: keep the shared beneficiary directory synchronized with
-- Accounts corrections during external-source reconciliation.
--
-- Migration 071 remains immutable. This forward definition preserves its
-- locking, audit, and current-descendant checks while replacing the stale
-- directory no-op with an upsert of the corrected Accounts snapshot.

CREATE OR REPLACE FUNCTION public.reconcile_external_beneficiary_on_accounts_submit(
  p_line_item_id uuid,
  p_submitted_by varchar
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.acct_requisition_line_items;
  v_req public.requisitions;
  v_fr public.fund_requests;
  v_beneficiary_id uuid;
  v_changed boolean;
  v_new_name varchar;
  v_new_ac_no varchar;
  v_new_ifsc varchar;
  v_new_bank_name varchar;
  v_new_bank_id uuid;
BEGIN
  SELECT * INTO v_item
  FROM public.acct_requisition_line_items
  WHERE id = p_line_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounts line item not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.source_fund_request_id IS NULL AND v_item.source_requisition_id IS NULL THEN
    RETURN;
  END IF;

  IF v_item.source_fund_request_id IS NOT NULL AND v_item.source_requisition_id IS NOT NULL THEN
    RAISE EXCEPTION 'Accounts line item has ambiguous external provenance.' USING ERRCODE = 'STA11';
  END IF;

  v_new_name := NULLIF(trim(v_item.beneficiary_name), '');
  v_new_ac_no := NULLIF(trim(v_item.beneficiary_ac_no), '');
  v_new_ifsc := NULLIF(upper(trim(v_item.beneficiary_ifsc)), '');
  v_new_bank_name := NULLIF(trim(v_item.beneficiary_bank_name), '');
  v_new_bank_id := v_item.beneficiary_bank_id;

  IF v_new_bank_id IS NULL AND v_new_bank_name IS NOT NULL THEN
    SELECT id INTO v_new_bank_id
    FROM public.indian_bank_master
    WHERE is_active AND lower(trim(bank_name)) = lower(v_new_bank_name)
    ORDER BY bank_name
    LIMIT 1;
  END IF;

  IF v_new_name IS NULL OR v_new_ac_no IS NULL OR v_new_ifsc IS NULL
     OR (v_new_bank_id IS NULL AND v_new_bank_name IS NULL) THEN
    RAISE EXCEPTION 'External payment rows require complete beneficiary details before Accounts submission.' USING ERRCODE = 'VAL02';
  END IF;

  INSERT INTO public.projects_beneficiary_master (
    beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_name,
    beneficiary_bank_id, created_by, updated_by, last_used_at, updated_at
  ) VALUES (
    v_new_name, v_new_ac_no, v_new_ifsc, v_new_bank_name,
    v_new_bank_id, p_submitted_by, p_submitted_by, now(), now()
  )
  ON CONFLICT (beneficiary_ac_no, beneficiary_ifsc)
  DO UPDATE SET
    beneficiary_name = EXCLUDED.beneficiary_name,
    beneficiary_bank_name = COALESCE(EXCLUDED.beneficiary_bank_name, projects_beneficiary_master.beneficiary_bank_name),
    beneficiary_bank_id = COALESCE(EXCLUDED.beneficiary_bank_id, projects_beneficiary_master.beneficiary_bank_id),
    updated_by = EXCLUDED.updated_by,
    last_used_at = now(),
    updated_at = now()
  RETURNING id INTO v_beneficiary_id;

  IF v_beneficiary_id IS NULL THEN
    SELECT id INTO v_beneficiary_id
    FROM public.projects_beneficiary_master
    WHERE beneficiary_ac_no = v_new_ac_no
      AND beneficiary_ifsc = v_new_ifsc
    LIMIT 1;
  END IF;

  IF v_beneficiary_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve the submitted beneficiary.' USING ERRCODE = 'VAL02';
  END IF;

  IF v_item.source_fund_request_id IS NOT NULL THEN
    SELECT * INTO v_fr
    FROM public.fund_requests
    WHERE fund_request_id = v_item.source_fund_request_id
      AND accounts_line_item_id = v_item.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fund Request Accounts lineage is stale.' USING ERRCODE = 'STA11';
    END IF;

    v_changed := v_fr.beneficiary_name IS DISTINCT FROM v_new_name
      OR v_fr.beneficiary_ac_no IS DISTINCT FROM v_new_ac_no
      OR upper(trim(COALESCE(v_fr.beneficiary_ifsc, ''))) IS DISTINCT FROM v_new_ifsc
      OR v_fr.beneficiary_bank_name IS DISTINCT FROM v_new_bank_name
      OR v_fr.beneficiary_bank_id IS DISTINCT FROM v_new_bank_id;

    IF v_changed THEN
      INSERT INTO public.audit_log (
        user_id, action, module_name, record_identifier, old_value, new_value
      ) VALUES (
        p_submitted_by,
        'BENEFICIARY_RECONCILED',
        'Fund Request',
        v_fr.fund_request_id::varchar,
        jsonb_build_object(
          'beneficiary_id', v_fr.beneficiary_id,
          'beneficiary_name', v_fr.beneficiary_name,
          'beneficiary_ac_no', v_fr.beneficiary_ac_no,
          'beneficiary_ifsc', v_fr.beneficiary_ifsc,
          'beneficiary_bank_name', v_fr.beneficiary_bank_name,
          'beneficiary_bank_id', v_fr.beneficiary_bank_id
        ),
        jsonb_build_object(
          'beneficiary_id', v_beneficiary_id,
          'beneficiary_name', v_new_name,
          'beneficiary_ac_no', v_new_ac_no,
          'beneficiary_ifsc', v_new_ifsc,
          'beneficiary_bank_name', v_new_bank_name,
          'beneficiary_bank_id', v_new_bank_id,
          'source_accounts_line_item_id', v_item.id
        )
      );
    END IF;

    UPDATE public.fund_requests
    SET beneficiary_id = v_beneficiary_id,
        beneficiary_name = v_new_name,
        beneficiary_ac_no = v_new_ac_no,
        beneficiary_ifsc = v_new_ifsc,
        beneficiary_bank_name = v_new_bank_name,
        beneficiary_bank_id = v_new_bank_id,
        updated_at = now()
    WHERE fund_request_id = v_fr.fund_request_id
      AND accounts_line_item_id = v_item.id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fund Request Accounts lineage changed during beneficiary reconciliation.' USING ERRCODE = 'STA11';
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_req
  FROM public.requisitions
  WHERE requisition_id = v_item.source_requisition_id
    AND accounts_line_item_id = v_item.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment Requisition Accounts lineage is stale.' USING ERRCODE = 'STA11';
  END IF;

  v_changed := v_req.beneficiary_name IS DISTINCT FROM v_new_name
    OR v_req.beneficiary_ac_no IS DISTINCT FROM v_new_ac_no
    OR upper(trim(COALESCE(v_req.beneficiary_ifsc, ''))) IS DISTINCT FROM v_new_ifsc
    OR v_req.beneficiary_bank_name IS DISTINCT FROM v_new_bank_name
    OR v_req.beneficiary_bank_id IS DISTINCT FROM v_new_bank_id;

  IF v_changed THEN
    INSERT INTO public.audit_log (
      user_id, action, module_name, record_identifier, old_value, new_value
    ) VALUES (
      p_submitted_by,
      'BENEFICIARY_RECONCILED',
      'Payment Requisition',
      v_req.requisition_id::varchar,
      jsonb_build_object(
        'beneficiary_id', v_req.beneficiary_id,
        'beneficiary_name', v_req.beneficiary_name,
        'beneficiary_ac_no', v_req.beneficiary_ac_no,
        'beneficiary_ifsc', v_req.beneficiary_ifsc,
        'beneficiary_bank_name', v_req.beneficiary_bank_name,
        'beneficiary_bank_id', v_req.beneficiary_bank_id
      ),
      jsonb_build_object(
        'beneficiary_id', v_beneficiary_id,
        'beneficiary_name', v_new_name,
        'beneficiary_ac_no', v_new_ac_no,
        'beneficiary_ifsc', v_new_ifsc,
        'beneficiary_bank_name', v_new_bank_name,
        'beneficiary_bank_id', v_new_bank_id,
        'source_accounts_line_item_id', v_item.id
      )
    );
  END IF;

  UPDATE public.requisitions
  SET beneficiary_id = v_beneficiary_id,
      beneficiary_name = v_new_name,
      beneficiary_ac_no = v_new_ac_no,
      beneficiary_ifsc = v_new_ifsc,
      beneficiary_bank_name = v_new_bank_name,
      beneficiary_bank_id = v_new_bank_id,
      updated_at = now()
  WHERE requisition_id = v_req.requisition_id
    AND accounts_line_item_id = v_item.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment Requisition Accounts lineage changed during beneficiary reconciliation.' USING ERRCODE = 'STA11';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_external_beneficiary_on_accounts_submit(uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_external_beneficiary_on_accounts_submit(uuid, varchar) TO service_role;
