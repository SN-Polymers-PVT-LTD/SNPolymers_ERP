-- Migration: 016_fix_work_orders_without_ra_bill_view_status.sql
-- Description: Update work_orders_without_ra_bill view to use status NOT IN ('Closed', 'Complete Under Maintenance') to match business rules.

CREATE OR REPLACE VIEW public.work_orders_without_ra_bill AS
SELECT 
    pm.work_order_no,
    pm.site_details,
    pm.state,
    pm.district,
    pm.department,
    pm.zo_user_id,
    pm.status,
    pm.created_at
FROM public.projects_master pm
WHERE pm.status NOT IN ('Closed', 'Complete Under Maintenance')
  AND NOT EXISTS (
      SELECT 1 
      FROM public.ra_final_bills rb 
      WHERE rb.work_order_no = pm.work_order_no 
        AND rb.payment_type LIKE 'RA Bill%'
  );

-- Grant select privilege to authenticated roles only (not anon)
REVOKE SELECT ON public.work_orders_without_ra_bill FROM anon;
GRANT SELECT ON public.work_orders_without_ra_bill TO authenticated, service_role;
