-- Migration 073: atomic Accounts import export snapshot.
--
-- The paginated queue RPC remains the UI read path. Exports use this separate
-- RPC so the complete filtered result is produced by one PostgreSQL statement
-- snapshot instead of a sequence of OFFSET queries over a changing queue.

CREATE OR REPLACE FUNCTION public.get_accounts_import_queue_export(
  p_status varchar DEFAULT NULL,
  p_particulars varchar DEFAULT NULL,
  p_account_sub_title varchar DEFAULT NULL,
  p_beneficiary_ac_no varchar DEFAULT NULL,
  p_debit_bank_ac_type varchar DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH normalized AS (
    SELECT
      li.id,
      'LINE_ITEM'::varchar AS item_type,
      li.sheet_id,
      s.sheet_number,
      s.sheet_status,
      li.account_sub_title_id,
      li.account_sub_title_text,
      li.particulars,
      li.beneficiary_ac_no,
      li.beneficiary_name,
      li.beneficiary_ifsc,
      li.beneficiary_bank_name,
      NULL::uuid AS beneficiary_bank_id,
      li.debit_bank_ac_type,
      li.req_amount,
      li.payment_mode,
      li.cheque_no,
      li.cheque_date,
      li.requisition_status,
      li.work_order_no,
      li.source_requisition_id,
      li.source_fund_request_id,
      li.created_at
    FROM public.acct_requisition_line_items li
    LEFT JOIN public.acct_requisition_sheets s ON s.id = li.sheet_id
    WHERE li.imported_to_sheet_id IS NULL
      AND li.import_dismissed = false
      AND (
        li.requisition_status IN ('On Hold', 'Pending Review')
        OR (
          li.requisition_status = 'Rejected'
          AND li.source_fund_request_id IS NULL
          AND li.source_requisition_id IS NULL
        )
      )

    UNION ALL

    SELECT
      r.requisition_id AS id,
      'PAYMENT_REQUISITION'::varchar AS item_type,
      NULL::uuid AS sheet_id,
      r.requisition_no AS sheet_number,
      NULL::varchar AS sheet_status,
      NULL::uuid AS account_sub_title_id,
      r.material_main_head AS account_sub_title_text,
      r.expen_head_remarks AS particulars,
      r.beneficiary_ac_no,
      r.beneficiary_name,
      r.beneficiary_ifsc,
      r.beneficiary_bank_name,
      r.beneficiary_bank_id,
      NULL::varchar AS debit_bank_ac_type,
      r.approved_amount AS req_amount,
      NULL::varchar AS payment_mode,
      NULL::varchar AS cheque_no,
      NULL::varchar AS cheque_date,
      'Pending Review'::varchar AS requisition_status,
      r.work_order_no,
      r.requisition_id AS source_requisition_id,
      NULL::uuid AS source_fund_request_id,
      COALESCE(r.accounts_sent_at, r.payment_date, r.created_at) AS created_at
    FROM public.requisitions r
    WHERE r.payment_destination = 'ACCOUNTS'
      AND r.accounts_line_item_id IS NULL
      AND r.accounts_import_dismissed = false

    UNION ALL

    SELECT
      f.fund_request_id AS id,
      'FUND_REQUEST'::varchar AS item_type,
      NULL::uuid AS sheet_id,
      f.zo_fr_no AS sheet_number,
      NULL::varchar AS sheet_status,
      NULL::uuid AS account_sub_title_id,
      'Fund Request'::varchar AS account_sub_title_text,
      COALESCE(f.zo_remarks, 'Fund Request ' || f.zo_fr_no) AS particulars,
      f.beneficiary_ac_no,
      f.beneficiary_name,
      f.beneficiary_ifsc,
      f.beneficiary_bank_name,
      f.beneficiary_bank_id,
      NULL::varchar AS debit_bank_ac_type,
      f.zo_fr_amount AS req_amount,
      NULL::varchar AS payment_mode,
      NULL::varchar AS cheque_no,
      NULL::varchar AS cheque_date,
      'Pending Review'::varchar AS requisition_status,
      f.work_order_no,
      NULL::uuid AS source_requisition_id,
      f.fund_request_id AS source_fund_request_id,
      COALESCE(f.submitted_at, f.created_at) AS created_at
    FROM public.fund_requests f
    WHERE f.accounts_line_item_id IS NULL
      AND f.accounts_import_dismissed = false
      AND f.request_status = 'Pending'::public.fund_request_status_enum
  ), filtered AS (
    SELECT *
    FROM normalized n
    WHERE (p_status IS NULL OR n.requisition_status = p_status)
      AND (p_particulars IS NULL OR n.particulars ILIKE '%' || p_particulars || '%')
      AND (p_account_sub_title IS NULL OR n.account_sub_title_text ILIKE '%' || p_account_sub_title || '%')
      AND (p_beneficiary_ac_no IS NULL OR n.beneficiary_ac_no ILIKE '%' || p_beneficiary_ac_no || '%')
      AND (p_debit_bank_ac_type IS NULL OR n.debit_bank_ac_type = p_debit_bank_ac_type)
      AND (p_date_from IS NULL OR n.created_at >= p_date_from)
      AND (p_date_to IS NULL OR n.created_at <= p_date_to)
  )
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC, f.item_type, f.id) FROM filtered f), '[]'::jsonb),
    'total', (SELECT COUNT(*) FROM filtered),
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_accounts_import_queue_export(varchar, varchar, varchar, varchar, varchar, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_accounts_import_queue_export(varchar, varchar, varchar, varchar, varchar, timestamptz, timestamptz)
  TO service_role;
