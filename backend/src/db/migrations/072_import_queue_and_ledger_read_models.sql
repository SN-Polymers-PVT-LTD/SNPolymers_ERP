-- Migration 072: server-side Accounts import queue and date-safe ledger reads.
-- This is additive so already-applied migrations remain immutable.

CREATE OR REPLACE FUNCTION public.enforce_fund_request_submission_visibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.request_status = 'Draft'::public.fund_request_status_enum
     AND NEW.request_status = 'Pending'::public.fund_request_status_enum THEN
    NEW.accounts_import_dismissed := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fund_request_submission_visibility ON public.fund_requests;
CREATE TRIGGER trg_fund_request_submission_visibility
  BEFORE UPDATE ON public.fund_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_fund_request_submission_visibility();

CREATE OR REPLACE FUNCTION public.get_accounts_import_queue(
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 20,
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
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset integer;
  v_result jsonb;
BEGIN
  v_offset := (v_page - 1) * v_limit;

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
  ), page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC, item_type, id
    OFFSET v_offset
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY created_at DESC, item_type, id) FROM page_rows), '[]'::jsonb),
    'total', (SELECT COUNT(*) FROM filtered)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_accounts_import_queue(integer, integer, varchar, varchar, varchar, varchar, varchar, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_accounts_import_queue(integer, integer, varchar, varchar, varchar, varchar, varchar, timestamptz, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_subcontractor_ledger_entries(
  p_work_order_no varchar DEFAULT NULL,
  p_material_sub_head varchar DEFAULT NULL,
  p_material_details varchar DEFAULT NULL,
  p_search varchar DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
) RETURNS TABLE(entry jsonb, opening_balance numeric, closing_balance numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT l.*
    FROM public.subcontractor_ledger l
    WHERE l.ledger_visible = true
      AND (p_work_order_no IS NULL OR l.work_order_no = trim(p_work_order_no))
      AND (p_material_sub_head IS NULL OR l.material_sub_head = trim(p_material_sub_head))
      AND (p_material_details IS NULL OR l.material_details = trim(p_material_details))
  ), selected_partitions AS (
    SELECT DISTINCT work_order_no, material_sub_head, material_details
    FROM scoped
    WHERE p_search IS NULL
       OR material_details ILIKE '%' || trim(p_search) || '%'
       OR material_sub_head ILIKE '%' || trim(p_search) || '%'
       OR work_order_no ILIKE '%' || trim(p_search) || '%'
  ), full_window AS (
    SELECT s.*,
      SUM(s.amount) OVER (
        PARTITION BY s.work_order_no, s.material_sub_head, s.material_details
        ORDER BY s.created_at, s.ledger_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_balance
    FROM scoped s
    JOIN selected_partitions p
      ON p.work_order_no = s.work_order_no
     AND p.material_sub_head = s.material_sub_head
     AND p.material_details = s.material_details
  ), filtered AS (
    SELECT *
    FROM full_window
    WHERE (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to IS NULL OR created_at <= p_date_to)
  ), bounds AS (
    SELECT
      work_order_no, material_sub_head, material_details,
      COALESCE(SUM(amount) FILTER (WHERE p_date_from IS NOT NULL AND created_at < p_date_from), 0)::numeric AS opening_balance,
      (array_agg(running_balance ORDER BY created_at DESC, ledger_id DESC))[1]::numeric AS closing_balance
    FROM full_window
    WHERE (p_date_to IS NULL OR created_at <= p_date_to)
    GROUP BY work_order_no, material_sub_head, material_details
  )
  SELECT
    to_jsonb(f) - 'running_balance' || jsonb_build_object(
      'running_balance', f.running_balance,
      'credit_amount', CASE WHEN f.amount > 0 THEN f.amount ELSE 0 END,
      'debit_amount', CASE WHEN f.amount < 0 THEN abs(f.amount) ELSE 0 END
    ) AS entry,
    b.opening_balance,
    b.closing_balance
  FROM filtered f
  JOIN bounds b
    ON b.work_order_no = f.work_order_no
   AND b.material_sub_head = f.material_sub_head
   AND b.material_details = f.material_details
  ORDER BY f.created_at DESC, f.ledger_id DESC;
$$;

REVOKE ALL ON FUNCTION public.get_subcontractor_ledger_entries(varchar, varchar, varchar, varchar, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_subcontractor_ledger_entries(varchar, varchar, varchar, varchar, timestamptz, timestamptz)
  TO service_role;
