-- Migration: 015_create_work_orders_without_ra_bill_view.sql
-- Description: Create a database view for active projects that do not have any RA bills, performing an optimized database-level anti-join.

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
WHERE pm.status = 'Running'
  AND NOT EXISTS (
      SELECT 1 
      FROM public.ra_final_bills rb 
      WHERE rb.work_order_no = pm.work_order_no 
        AND rb.payment_type LIKE 'RA Bill%'
  );

-- Grant select privilege to authenticated roles for PostgREST
GRANT SELECT ON public.work_orders_without_ra_bill TO authenticated, service_role;
