-- Migration 085: Subcontractor Ledger Payment Statement Read Model
-- Enhances get_canonical_subcontractor_ledger_entries:
-- 1. Makes p_subcontractor_id optional (DEFAULT NULL) to support full exports across contractors.
-- 2. Adds p_search to filter by contractor, work type, or requisition doc number.
-- 3. Computes positive cumulative_paid disbursements instead of negative scope running balances.
-- 4. Partitions bounds by (subcontractor_id, work_order_no, subcontract_work_id) for accurate multi-contractor groupings.

DROP FUNCTION IF EXISTS public.get_canonical_subcontractor_ledger_entries(uuid, varchar, uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_canonical_subcontractor_ledger_entries(
  p_subcontractor_id uuid DEFAULT NULL,
  p_work_order_no varchar DEFAULT NULL,
  p_subcontract_work_id uuid DEFAULT NULL,
  p_search varchar DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
) RETURNS TABLE(
  entry jsonb,
  scope_opening_balance numeric,
  scope_closing_balance numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      l.ledger_id,
      l.work_order_no,
      l.material_main_head,
      l.material_sub_head,
      l.material_details AS legacy_material_details,
      l.transaction_type,
      l.reference_type,
      l.reference_id,
      l.amount,
      l.created_at,
      l.created_by,
      l.settlement_status,
      l.settled_at,
      l.settled_by,
      l.subcontractor_id,
      l.subcontract_work_id,
      sm.subcontractor_name,
      swm.sub_head,
      swm.material_details,
      swm.unit,
      pm.site_details,
      pm.department,
      req.requisition_no,
      req.requisition_amount,
      req.approved_amount,
      req.requisition_status,
      COALESCE(req.remarks_approved_authority, req.expen_head_remarks) AS req_remarks
    FROM public.subcontractor_ledger l
    JOIN public.subcontractor_master sm ON sm.id = l.subcontractor_id
    LEFT JOIN public.subcontract_work_master swm ON swm.id = l.subcontract_work_id
    LEFT JOIN public.projects_master pm ON pm.work_order_no = l.work_order_no
    LEFT JOIN public.requisitions req ON (l.reference_type = 'REQUISITION' AND req.requisition_id = l.reference_id)
    WHERE l.ledger_visible = true
      AND (p_subcontractor_id IS NULL OR l.subcontractor_id = p_subcontractor_id)
      AND (p_work_order_no IS NULL OR l.work_order_no = trim(p_work_order_no))
      AND (p_subcontract_work_id IS NULL OR l.subcontract_work_id = p_subcontract_work_id)
      AND (
        p_search IS NULL
        OR sm.subcontractor_name ILIKE '%' || trim(p_search) || '%'
        OR COALESCE(swm.sub_head, l.material_sub_head) ILIKE '%' || trim(p_search) || '%'
        OR COALESCE(swm.material_details, l.material_details) ILIKE '%' || trim(p_search) || '%'
        OR l.work_order_no ILIKE '%' || trim(p_search) || '%'
        OR req.requisition_no ILIKE '%' || trim(p_search) || '%'
      )
  ),
  full_window AS (
    SELECT
      s.*,
      SUM(CASE WHEN s.amount < 0 THEN abs(s.amount) ELSE 0 END) OVER (
        PARTITION BY s.subcontractor_id, s.work_order_no, COALESCE(s.subcontract_work_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY s.created_at, s.ledger_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cumulative_paid
    FROM scoped s
  ),
  filtered AS (
    SELECT *
    FROM full_window
    WHERE (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to IS NULL OR created_at <= p_date_to)
  ),
  bounds AS (
    SELECT
      subcontractor_id,
      work_order_no,
      COALESCE(subcontract_work_id, '00000000-0000-0000-0000-000000000000'::uuid) AS sw_id,
      COALESCE(SUM(CASE WHEN amount < 0 THEN abs(amount) ELSE 0 END) FILTER (WHERE p_date_from IS NOT NULL AND created_at < p_date_from), 0)::numeric AS opening_balance,
      COALESCE((array_agg(cumulative_paid ORDER BY created_at DESC, ledger_id DESC))[1], 0)::numeric AS closing_balance
    FROM full_window
    WHERE (p_date_to IS NULL OR created_at <= p_date_to)
    GROUP BY subcontractor_id, work_order_no, COALESCE(subcontract_work_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  SELECT
    to_jsonb(f) - 'cumulative_paid' || jsonb_build_object(
      'paid_amount', CASE WHEN f.amount < 0 THEN abs(f.amount) ELSE 0 END,
      'cumulative_paid', f.cumulative_paid,
      'scope_running_balance', f.cumulative_paid,
      'credit_amount', CASE WHEN f.amount > 0 THEN f.amount ELSE 0 END,
      'debit_amount', CASE WHEN f.amount < 0 THEN abs(f.amount) ELSE 0 END,
      'remarks', COALESCE(f.req_remarks, f.legacy_material_details)
    ) AS entry,
    b.opening_balance AS scope_opening_balance,
    b.closing_balance AS scope_closing_balance
  FROM filtered f
  JOIN bounds b
    ON b.subcontractor_id = f.subcontractor_id
   AND b.work_order_no = f.work_order_no
   AND b.sw_id = COALESCE(f.subcontract_work_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY f.created_at DESC, f.ledger_id DESC;
$$;

REVOKE ALL ON FUNCTION public.get_canonical_subcontractor_ledger_entries(uuid, varchar, uuid, varchar, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_canonical_subcontractor_ledger_entries(uuid, varchar, uuid, varchar, timestamptz, timestamptz) TO service_role;
