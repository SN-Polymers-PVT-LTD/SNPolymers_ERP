// AUTO-GENERATED — do not edit. Run: npm run generate:manifests
module.exports = {
  "indexes": {
    "authorised_users_mobile_number_key": {
      "table": "authorised_users",
      "definition": "CREATE UNIQUE INDEX authorised_users_mobile_number_key ON public.authorised_users USING btree (mobile_number)"
    },
    "authorised_users_pkey": {
      "table": "authorised_users",
      "definition": "CREATE UNIQUE INDEX authorised_users_pkey ON public.authorised_users USING btree (id)"
    },
    "hr_employees_employee_code_key": {
      "table": "hr_employees",
      "definition": "CREATE UNIQUE INDEX hr_employees_employee_code_key ON public.hr_employees USING btree (employee_code)"
    },
    "hr_employees_erp_user_id_key": {
      "table": "hr_employees",
      "definition": "CREATE UNIQUE INDEX hr_employees_erp_user_id_key ON public.hr_employees USING btree (erp_user_id)"
    },
    "hr_employees_name_idx": {
      "table": "hr_employees",
      "definition": "CREATE INDEX hr_employees_name_idx ON public.hr_employees USING btree (lower(employee_name))"
    },
    "hr_employees_pkey": {
      "table": "hr_employees",
      "definition": "CREATE UNIQUE INDEX hr_employees_pkey ON public.hr_employees USING btree (id)"
    },
    "hr_employees_status_category_idx": {
      "table": "hr_employees",
      "definition": "CREATE INDEX hr_employees_status_category_idx ON public.hr_employees USING btree (active_status, employee_category)"
    },
    "idx_activity_breaks_active": {
      "table": "work_order_activity_breaks",
      "definition": "CREATE INDEX idx_activity_breaks_active ON public.work_order_activity_breaks USING btree (work_order_no) WHERE ((status)::text = ANY ((ARRAY['Active'::character varying, 'Reopen Requested'::character varying])::text[]))"
    },
    "idx_activity_breaks_one_active_per_wo": {
      "table": "work_order_activity_breaks",
      "definition": "CREATE UNIQUE INDEX idx_activity_breaks_one_active_per_wo ON public.work_order_activity_breaks USING btree (work_order_no) WHERE ((status)::text <> ALL ((ARRAY['Rejected by ZO'::character varying, 'Cancelled by JE'::character varying, 'Ended'::character varying])::text[]))"
    },
    "idx_activity_breaks_wo_status": {
      "table": "work_order_activity_breaks",
      "definition": "CREATE INDEX idx_activity_breaks_wo_status ON public.work_order_activity_breaks USING btree (work_order_no, status)"
    },
    "idx_arli_beneficiary_ac_no_trgm": {
      "table": "acct_requisition_line_items",
      "definition": "CREATE INDEX idx_arli_beneficiary_ac_no_trgm ON public.acct_requisition_line_items USING gin (beneficiary_ac_no gin_trgm_ops)"
    },
    "idx_arli_created_at": {
      "table": "acct_requisition_line_items",
      "definition": "CREATE INDEX idx_arli_created_at ON public.acct_requisition_line_items USING btree (created_at)"
    },
    "idx_arli_debit_bank_ac_type": {
      "table": "acct_requisition_line_items",
      "definition": "CREATE INDEX idx_arli_debit_bank_ac_type ON public.acct_requisition_line_items USING btree (debit_bank_ac_type)"
    },
    "idx_arli_sub_title_trgm": {
      "table": "acct_requisition_line_items",
      "definition": "CREATE INDEX idx_arli_sub_title_trgm ON public.acct_requisition_line_items USING gin (account_sub_title_text gin_trgm_ops)"
    },
    "idx_ars_sheet_status_created_at": {
      "table": "acct_requisition_sheets",
      "definition": "CREATE INDEX idx_ars_sheet_status_created_at ON public.acct_requisition_sheets USING btree (sheet_status, created_at DESC)"
    },
    "idx_bm_account_number_trgm": {
      "table": "beneficiary_master",
      "definition": "CREATE INDEX idx_bm_account_number_trgm ON public.beneficiary_master USING gin (account_number gin_trgm_ops)"
    },
    "idx_bm_beneficiary_name_trgm": {
      "table": "beneficiary_master",
      "definition": "CREATE INDEX idx_bm_beneficiary_name_trgm ON public.beneficiary_master USING gin (beneficiary_name gin_trgm_ops)"
    },
    "idx_cesc_source_line": {
      "table": "cost_estimate_subcontract_contributions",
      "definition": "CREATE INDEX idx_cesc_source_line ON public.cost_estimate_subcontract_contributions USING btree (subcontract_estimate_line_id)"
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
    "idx_pse_status": {
      "table": "project_subcontract_estimates",
      "definition": "CREATE INDEX idx_pse_status ON public.project_subcontract_estimates USING btree (estimate_status)"
    },
    "idx_pse_updated_at": {
      "table": "project_subcontract_estimates",
      "definition": "CREATE INDEX idx_pse_updated_at ON public.project_subcontract_estimates USING btree (updated_at DESC)"
    },
    "idx_pse_work_order": {
      "table": "project_subcontract_estimates",
      "definition": "CREATE INDEX idx_pse_work_order ON public.project_subcontract_estimates USING btree (work_order_no)"
    },
    "idx_psel_adjusts_line": {
      "table": "project_subcontract_estimate_lines",
      "definition": "CREATE INDEX idx_psel_adjusts_line ON public.project_subcontract_estimate_lines USING btree (adjusts_line_id) WHERE (adjusts_line_id IS NOT NULL)"
    },
    "idx_psel_estimate": {
      "table": "project_subcontract_estimate_lines",
      "definition": "CREATE INDEX idx_psel_estimate ON public.project_subcontract_estimate_lines USING btree (subcontract_estimate_id)"
    },
    "idx_psel_estimate_party_work": {
      "table": "project_subcontract_estimate_lines",
      "definition": "CREATE INDEX idx_psel_estimate_party_work ON public.project_subcontract_estimate_lines USING btree (subcontract_estimate_id, subcontractor_id, subcontract_work_id)"
    },
    "idx_psel_estimate_work": {
      "table": "project_subcontract_estimate_lines",
      "definition": "CREATE INDEX idx_psel_estimate_work ON public.project_subcontract_estimate_lines USING btree (subcontract_estimate_id, subcontract_work_id)"
    },
    "idx_psel_final_approved_revision": {
      "table": "project_subcontract_estimate_lines",
      "definition": "CREATE INDEX idx_psel_final_approved_revision ON public.project_subcontract_estimate_lines USING btree (subcontract_estimate_id, final_approved_revision) WHERE (final_approved_revision IS NOT NULL)"
    },
    "idx_psel_subcontractor": {
      "table": "project_subcontract_estimate_lines",
      "definition": "CREATE INDEX idx_psel_subcontractor ON public.project_subcontract_estimate_lines USING btree (subcontractor_id)"
    },
    "idx_psel_work": {
      "table": "project_subcontract_estimate_lines",
      "definition": "CREATE INDEX idx_psel_work ON public.project_subcontract_estimate_lines USING btree (subcontract_work_id)"
    },
    "idx_psewl_estimate_created_at": {
      "table": "project_subcontract_estimate_workflow_log",
      "definition": "CREATE INDEX idx_psewl_estimate_created_at ON public.project_subcontract_estimate_workflow_log USING btree (subcontract_estimate_id, created_at)"
    },
    "idx_requisitions_status": {
      "table": "requisitions",
      "definition": "CREATE INDEX idx_requisitions_status ON public.requisitions USING btree (requisition_status) WHERE (requisition_status = 'Pending'::requisition_status_enum)"
    },
    "idx_requisitions_subcontract_scope": {
      "table": "requisitions",
      "definition": "CREATE INDEX idx_requisitions_subcontract_scope ON public.requisitions USING btree (work_order_no, subcontractor_id, subcontract_work_id) WHERE (subcontractor_id IS NOT NULL)"
    },
    "idx_requisitions_work_order": {
      "table": "requisitions",
      "definition": "CREATE INDEX idx_requisitions_work_order ON public.requisitions USING btree (work_order_no)"
    },
    "idx_scb_relational_scope": {
      "table": "subcontractor_balances",
      "definition": "CREATE INDEX idx_scb_relational_scope ON public.subcontractor_balances USING btree (work_order_no, subcontractor_id, subcontract_work_id)"
    },
    "idx_scl_relational_scope": {
      "table": "subcontractor_ledger",
      "definition": "CREATE INDEX idx_scl_relational_scope ON public.subcontractor_ledger USING btree (work_order_no, subcontractor_id, subcontract_work_id)"
    },
    "idx_sessions_user_login": {
      "table": "sessions",
      "definition": "CREATE INDEX idx_sessions_user_login ON public.sessions USING btree (user_id, login_at DESC)"
    },
    "idx_swm_active": {
      "table": "subcontract_work_master",
      "definition": "CREATE INDEX idx_swm_active ON public.subcontract_work_master USING btree (is_active)"
    },
    "idx_swm_sub_head": {
      "table": "subcontract_work_master",
      "definition": "CREATE INDEX idx_swm_sub_head ON public.subcontract_work_master USING btree (sub_head)"
    },
    "uq_pcei_generated_subcontract_work": {
      "table": "project_cost_estimate_items",
      "definition": "CREATE UNIQUE INDEX uq_pcei_generated_subcontract_work ON public.project_cost_estimate_items USING btree (estimate_id, subcontract_work_id) WHERE ((source_type)::text = 'SUBCONTRACT_ESTIMATE'::text)"
    },
    "uq_pse_one_live_estimate_per_wo": {
      "table": "project_subcontract_estimates",
      "definition": "CREATE UNIQUE INDEX uq_pse_one_live_estimate_per_wo ON public.project_subcontract_estimates USING btree (work_order_no) WHERE (estimate_status <> ALL (ARRAY['Rejected by ZO'::estimate_status_enum, 'Rejected by HO'::estimate_status_enum]))"
    },
    "uq_serl_one_active_revision": {
      "table": "subcontract_estimate_revision_log",
      "definition": "CREATE UNIQUE INDEX uq_serl_one_active_revision ON public.subcontract_estimate_revision_log USING btree (subcontract_estimate_id) WHERE (resubmitted_at IS NULL)"
    },
    "uq_subcontract_work_master_identity": {
      "table": "subcontract_work_master",
      "definition": "CREATE UNIQUE INDEX uq_subcontract_work_master_identity ON public.subcontract_work_master USING btree (lower(btrim((sub_head)::text)), lower(btrim((material_details)::text)), lower(btrim((unit)::text)))"
    }
  }
};
