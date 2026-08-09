-- Migration: 017_revoke_anon_work_orders_without_ra_bill_view.sql
-- Description: Revoke unnecessary anon SELECT on work_orders_without_ra_bill (applied if 015/016 already granted anon).

REVOKE SELECT ON public.work_orders_without_ra_bill FROM anon;
GRANT SELECT ON public.work_orders_without_ra_bill TO authenticated, service_role;
