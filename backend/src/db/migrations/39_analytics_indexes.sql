-- Migration 37: Add composite indexes for high-frequency analytics query optimization

CREATE INDEX IF NOT EXISTS idx_bills_wo_created 
    ON public.ra_final_bills(work_order_no, created_at);

CREATE INDEX IF NOT EXISTS idx_dpr_wo_visit 
    ON public.daily_progress_reports(work_order_no, site_visit_date);

CREATE INDEX IF NOT EXISTS idx_projects_zo_user 
    ON public.projects_master(zo_user_id);
