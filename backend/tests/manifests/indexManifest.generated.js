// AUTO-GENERATED — do not edit. Run: npm run generate:manifests
module.exports = {
  "generatedAt": "2026-08-05T19:05:28.478Z",
  "indexes": {
    "authorised_users_mobile_number_key": {
      "table": "authorised_users",
      "definition": "CREATE UNIQUE INDEX authorised_users_mobile_number_key ON public.authorised_users USING btree (mobile_number)"
    },
    "authorised_users_pkey": {
      "table": "authorised_users",
      "definition": "CREATE UNIQUE INDEX authorised_users_pkey ON public.authorised_users USING btree (id)"
    },
    "idx_fund_requests_status": {
      "table": "fund_requests",
      "definition": "CREATE INDEX idx_fund_requests_status ON public.fund_requests USING btree (request_status) WHERE (request_status = 'Pending'::fund_request_status_enum)"
    },
    "idx_pce_work_order": {
      "table": "project_cost_estimates",
      "definition": "CREATE INDEX idx_pce_work_order ON public.project_cost_estimates USING btree (work_order_no)"
    },
    "idx_project_health_mv_wo": {
      "table": "project_health_mv",
      "definition": "CREATE UNIQUE INDEX idx_project_health_mv_wo ON public.project_health_mv USING btree (work_order_no)"
    },
    "idx_projects_zo_user": {
      "table": "projects_master",
      "definition": "CREATE INDEX idx_projects_zo_user ON public.projects_master USING btree (zo_user_id)"
    },
    "idx_requisitions_status": {
      "table": "requisitions",
      "definition": "CREATE INDEX idx_requisitions_status ON public.requisitions USING btree (requisition_status) WHERE (requisition_status = 'Pending'::requisition_status_enum)"
    },
    "idx_requisitions_work_order": {
      "table": "requisitions",
      "definition": "CREATE INDEX idx_requisitions_work_order ON public.requisitions USING btree (work_order_no)"
    },
    "idx_sessions_user_login": {
      "table": "sessions",
      "definition": "CREATE INDEX idx_sessions_user_login ON public.sessions USING btree (user_id, login_at DESC)"
    }
  }
};
