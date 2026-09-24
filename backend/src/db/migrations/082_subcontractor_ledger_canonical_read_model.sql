-- Migration 082: Canonical Subcontractor Ledger Read Model
-- Introduces canonical contractor-centric summary and transaction read RPCs.
-- Enforces strict isolation per (work_order_no, subcontractor_id, subcontract_work_id).

CREATE OR REPLACE FUNCTION public.get_canonical_subcontractor_summary(
  p_work_order_no varchar DEFAULT NULL,
  p_subcontractor_id uuid DEFAULT NULL,
  p_search varchar DEFAULT NULL
) RETURNS TABLE(
  subcontractor_id uuid,
  subcontractor_name varchar,
  is_active boolean,
  total_approved numeric,
  total_reserved numeric,
  total_paid numeric,
  total_remaining numeric,
  work_order_count bigint,
  scope_count bigint,
  scopes jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH approved_scopes AS (
    SELECT
      psel.subcontractor_id,
      pse.work_order_no,
      psel.subcontract_work_id,
      COALESCE(SUM(psel.amount), 0)::numeric(18,2) AS approved_scope
    FROM public.project_subcontract_estimate_lines psel
    JOIN public.project_subcontract_estimates pse
      ON pse.subcontract_estimate_id = psel.subcontract_estimate_id
    WHERE psel.final_approved_revision IS NOT NULL
      AND (p_work_order_no IS NULL OR pse.work_order_no = trim(p_work_order_no))
      AND (p_subcontractor_id IS NULL OR psel.subcontractor_id = p_subcontractor_id)
    GROUP BY psel.subcontractor_id, pse.work_order_no, psel.subcontract_work_id
  ),
  ledger_scopes AS (
    SELECT
      sl.subcontractor_id,
      sl.work_order_no,
      sl.subcontract_work_id,
      COALESCE(SUM(CASE WHEN sl.transaction_type = 'REQUISITION_APPROVAL' AND sl.settlement_status = 'RESERVED' THEN abs(sl.amount) ELSE 0 END), 0)::numeric(18,2) AS reserved,
      COALESCE(SUM(CASE WHEN sl.transaction_type = 'REQUISITION_PAYMENT' THEN abs(sl.amount) ELSE 0 END), 0)::numeric(18,2) AS paid
    FROM public.subcontractor_ledger sl
    WHERE sl.subcontractor_id IS NOT NULL
      AND sl.subcontract_work_id IS NOT NULL
      AND (p_work_order_no IS NULL OR sl.work_order_no = trim(p_work_order_no))
      AND (p_subcontractor_id IS NULL OR sl.subcontractor_id = p_subcontractor_id)
    GROUP BY sl.subcontractor_id, sl.work_order_no, sl.subcontract_work_id
  ),
  combined_scopes AS (
    SELECT
      COALESCE(a.subcontractor_id, l.subcontractor_id) AS subcontractor_id,
      COALESCE(a.work_order_no, l.work_order_no) AS work_order_no,
      COALESCE(a.subcontract_work_id, l.subcontract_work_id) AS subcontract_work_id,
      COALESCE(a.approved_scope, 0) AS approved_scope,
      COALESCE(l.reserved, 0) AS reserved,
      COALESCE(l.paid, 0) AS paid,
      GREATEST(0, COALESCE(a.approved_scope, 0) - (COALESCE(l.reserved, 0) + COALESCE(l.paid, 0)))::numeric(18,2) AS remaining
    FROM approved_scopes a
    FULL OUTER JOIN ledger_scopes l
      ON a.subcontractor_id = l.subcontractor_id
     AND a.work_order_no = l.work_order_no
     AND a.subcontract_work_id = l.subcontract_work_id
  ),
  enriched_scopes AS (
    SELECT
      cs.*,
      sm.subcontractor_name,
      sm.is_active,
      swm.sub_head,
      swm.material_details,
      swm.unit,
      pm.department,
      pm.site_details
    FROM combined_scopes cs
    JOIN public.subcontractor_master sm ON sm.id = cs.subcontractor_id
    JOIN public.subcontract_work_master swm ON swm.id = cs.subcontract_work_id
    LEFT JOIN public.projects_master pm ON pm.work_order_no = cs.work_order_no
    WHERE (p_search IS NULL OR sm.subcontractor_name ILIKE '%' || trim(p_search) || '%' OR cs.work_order_no ILIKE '%' || trim(p_search) || '%')
  ),
  works_by_wo AS (
    SELECT
      subcontractor_id,
      subcontractor_name,
      is_active,
      work_order_no,
      department,
      site_details,
      SUM(approved_scope)::numeric(18,2) AS wo_approved,
      SUM(reserved)::numeric(18,2) AS wo_reserved,
      SUM(paid)::numeric(18,2) AS wo_paid,
      SUM(remaining)::numeric(18,2) AS wo_remaining,
      jsonb_agg(
        jsonb_build_object(
          'subcontract_work_id', subcontract_work_id,
          'sub_head', sub_head,
          'material_details', material_details,
          'unit', unit,
          'approved_scope', approved_scope,
          'reserved', reserved,
          'paid', paid,
          'remaining', remaining
        ) ORDER BY sub_head, material_details
      ) AS works
    FROM enriched_scopes
    GROUP BY subcontractor_id, subcontractor_name, is_active, work_order_no, department, site_details
  ),
  wo_aggregated AS (
    SELECT
      subcontractor_id,
      subcontractor_name,
      is_active,
      COUNT(DISTINCT work_order_no) AS work_order_count,
      SUM(jsonb_array_length(works)) AS scope_count,
      SUM(wo_approved)::numeric(18,2) AS total_approved,
      SUM(wo_reserved)::numeric(18,2) AS total_reserved,
      SUM(wo_paid)::numeric(18,2) AS total_paid,
      SUM(wo_remaining)::numeric(18,2) AS total_remaining,
      jsonb_agg(
        jsonb_build_object(
          'work_order_no', work_order_no,
          'department', department,
          'site_details', site_details,
          'approved_scope', wo_approved,
          'reserved', wo_reserved,
          'paid', wo_paid,
          'remaining', wo_remaining,
          'works', works
        ) ORDER BY work_order_no
      ) AS scopes
    FROM works_by_wo
    GROUP BY subcontractor_id, subcontractor_name, is_active
  )
  SELECT
    wa.subcontractor_id,
    wa.subcontractor_name,
    wa.is_active,
    wa.total_approved,
    wa.total_reserved,
    wa.total_paid,
    wa.total_remaining,
    wa.work_order_count,
    wa.scope_count,
    wa.scopes
  FROM wo_aggregated wa
  ORDER BY wa.subcontractor_name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_canonical_subcontractor_summary(varchar, uuid, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_canonical_subcontractor_summary(varchar, uuid, varchar) TO service_role;

CREATE OR REPLACE FUNCTION public.get_canonical_subcontractor_ledger_entries(
  p_subcontractor_id uuid,
  p_work_order_no varchar DEFAULT NULL,
  p_subcontract_work_id uuid DEFAULT NULL,
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
      AND l.subcontractor_id = p_subcontractor_id
      AND (p_work_order_no IS NULL OR l.work_order_no = trim(p_work_order_no))
      AND (p_subcontract_work_id IS NULL OR l.subcontract_work_id = p_subcontract_work_id)
  ),
  full_window AS (
    SELECT
      s.*,
      SUM(s.amount) OVER (
        PARTITION BY s.work_order_no, COALESCE(s.subcontract_work_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY s.created_at, s.ledger_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS scope_running_balance
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
      work_order_no,
      COALESCE(subcontract_work_id, '00000000-0000-0000-0000-000000000000'::uuid) AS sw_id,
      COALESCE(SUM(amount) FILTER (WHERE p_date_from IS NOT NULL AND created_at < p_date_from), 0)::numeric AS opening_balance,
      (array_agg(scope_running_balance ORDER BY created_at DESC, ledger_id DESC))[1]::numeric AS closing_balance
    FROM full_window
    WHERE (p_date_to IS NULL OR created_at <= p_date_to)
    GROUP BY work_order_no, COALESCE(subcontract_work_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  SELECT
    to_jsonb(f) - 'scope_running_balance' || jsonb_build_object(
      'scope_running_balance', f.scope_running_balance,
      'credit_amount', CASE WHEN f.amount > 0 THEN f.amount ELSE 0 END,
      'debit_amount', CASE WHEN f.amount < 0 THEN abs(f.amount) ELSE 0 END,
      'remarks', COALESCE(f.req_remarks, f.legacy_material_details)
    ) AS entry,
    b.opening_balance AS scope_opening_balance,
    b.closing_balance AS scope_closing_balance
  FROM filtered f
  JOIN bounds b
    ON b.work_order_no = f.work_order_no
   AND b.sw_id = COALESCE(f.subcontract_work_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY f.created_at DESC, f.ledger_id DESC;
$$;

REVOKE ALL ON FUNCTION public.get_canonical_subcontractor_ledger_entries(uuid, varchar, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_canonical_subcontractor_ledger_entries(uuid, varchar, uuid, timestamptz, timestamptz) TO service_role;
