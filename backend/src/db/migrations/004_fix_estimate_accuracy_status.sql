-- ===========================================================================
-- Migration 004: Fix estimate_accuracy_mv.accuracy_status NULL-coalesce bug
-- Root cause: accuracy_status recomputed variance using
--   COALESCE(fe.estimate_amount, fe.estimate_amount) instead of
--   COALESCE(fe.estimate_amount, oe.estimate_amount), producing NULL
--   (and therefore 'High Variance') for any WO without a Final Approved estimate.
-- ===========================================================================

DROP MATERIALIZED VIEW IF EXISTS public.estimate_accuracy_mv;

CREATE MATERIALIZED VIEW public.estimate_accuracy_mv AS
WITH original_estimates AS (
    SELECT DISTINCT ON (work_order_no) work_order_no, estimate_id, estimate_amount, estimate_no, created_at
    FROM public.project_cost_estimates
    WHERE estimate_revision = 0
    ORDER BY work_order_no, created_at
), final_estimates AS (
    SELECT DISTINCT ON (work_order_no) work_order_no, estimate_id, estimate_amount, estimate_revision
    FROM public.project_cost_estimates
    WHERE estimate_status = 'Final Approved'::public.estimate_status_enum
    ORDER BY work_order_no, estimate_revision DESC
)
SELECT
    oe.work_order_no,
    oe.estimate_no,
    oe.estimate_amount AS original_estimate_amount,
    COALESCE(fe.estimate_amount, oe.estimate_amount) AS final_approved_estimate_amount,
    (COALESCE(fe.estimate_amount, oe.estimate_amount) - oe.estimate_amount) AS variance_amount,
    CASE
        WHEN oe.estimate_amount = 0 THEN 0.00
        ELSE ((COALESCE(fe.estimate_amount, oe.estimate_amount) - oe.estimate_amount) / oe.estimate_amount) * 100.00
    END AS variance_pct,
    COALESCE(fe.estimate_revision, 0) AS number_of_revisions,
    CASE
        WHEN fe.work_order_no IS NULL THEN 'Highly Accurate'
        WHEN ABS(
            CASE WHEN oe.estimate_amount = 0 THEN 0.00
                 ELSE ((fe.estimate_amount - oe.estimate_amount) / oe.estimate_amount) * 100.00
            END
        ) <= 5.00 THEN 'Highly Accurate'
        WHEN ABS(
            CASE WHEN oe.estimate_amount = 0 THEN 0.00
                 ELSE ((fe.estimate_amount - oe.estimate_amount) / oe.estimate_amount) * 100.00
            END
        ) <= 15.00 THEN 'Moderate Variance'
        ELSE 'High Variance'
    END AS accuracy_status,
    now() AS last_refreshed_at
FROM original_estimates oe
LEFT JOIN final_estimates fe ON oe.work_order_no = fe.work_order_no
WITH NO DATA;

ALTER MATERIALIZED VIEW public.estimate_accuracy_mv OWNER TO postgres;
CREATE UNIQUE INDEX idx_estimate_accuracy_mv_wo ON public.estimate_accuracy_mv (work_order_no);

GRANT SELECT ON public.estimate_accuracy_mv TO anon;
GRANT SELECT ON public.estimate_accuracy_mv TO authenticated;
GRANT SELECT ON public.estimate_accuracy_mv TO service_role;

REFRESH MATERIALIZED VIEW public.estimate_accuracy_mv;
