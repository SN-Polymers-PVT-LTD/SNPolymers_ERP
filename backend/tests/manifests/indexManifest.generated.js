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
    "hr_attendance_rows_pkey": {
      "table": "hr_attendance_rows",
      "definition": "CREATE UNIQUE INDEX hr_attendance_rows_pkey ON public.hr_attendance_rows USING btree (id)"
    },
    "hr_attendance_sheets_pkey": {
      "table": "hr_attendance_sheets",
      "definition": "CREATE UNIQUE INDEX hr_attendance_sheets_pkey ON public.hr_attendance_sheets USING btree (id)"
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
    "hr_factory_pay_rule_revisions_employee_category_effective_f_key": {
      "table": "hr_factory_pay_rule_revisions",
      "definition": "CREATE UNIQUE INDEX hr_factory_pay_rule_revisions_employee_category_effective_f_key ON public.hr_factory_pay_rule_revisions USING btree (employee_category, effective_from)"
    },
    "hr_factory_pay_rule_revisions_employee_category_revision_nu_key": {
      "table": "hr_factory_pay_rule_revisions",
      "definition": "CREATE UNIQUE INDEX hr_factory_pay_rule_revisions_employee_category_revision_nu_key ON public.hr_factory_pay_rule_revisions USING btree (employee_category, revision_number)"
    },
    "hr_factory_wage_revisions_employee_category_effective_from_key": {
      "table": "hr_factory_wage_revisions",
      "definition": "CREATE UNIQUE INDEX hr_factory_wage_revisions_employee_category_effective_from_key ON public.hr_factory_wage_revisions USING btree (employee_category, effective_from)"
    },
    "hr_factory_wage_revisions_employee_category_revision_number_key": {
      "table": "hr_factory_wage_revisions",
      "definition": "CREATE UNIQUE INDEX hr_factory_wage_revisions_employee_category_revision_number_key ON public.hr_factory_wage_revisions USING btree (employee_category, revision_number)"
    },
    "hr_leave_active_range_excl": {
      "table": "hr_leave_requests",
      "definition": "CREATE INDEX hr_leave_active_range_excl ON public.hr_leave_requests USING gist (employee_id, daterange(from_date, to_date, '[]'::text)) WHERE (approval_status = ANY (ARRAY['Pending'::text, 'Approved'::text]))"
    },
    "hr_leave_queue_idx": {
      "table": "hr_leave_requests",
      "definition": "CREATE INDEX hr_leave_queue_idx ON public.hr_leave_requests USING btree (approval_status, request_source, from_date)"
    },
    "hr_leave_requests_pkey": {
      "table": "hr_leave_requests",
      "definition": "CREATE UNIQUE INDEX hr_leave_requests_pkey ON public.hr_leave_requests USING btree (id)"
    },
    "hr_pay_revision_unique": {
      "table": "hr_permanent_pay_structures",
      "definition": "CREATE UNIQUE INDEX hr_pay_revision_unique ON public.hr_permanent_pay_structures USING btree (employee_id, revision_number)"
    },
    "hr_pay_structures_employee_idx": {
      "table": "hr_permanent_pay_structures",
      "definition": "CREATE INDEX hr_pay_structures_employee_idx ON public.hr_permanent_pay_structures USING btree (employee_id, status)"
    },
    "hr_pay_structures_one_active_idx": {
      "table": "hr_permanent_pay_structures",
      "definition": "CREATE UNIQUE INDEX hr_pay_structures_one_active_idx ON public.hr_permanent_pay_structures USING btree (employee_id) WHERE (status = 'Active'::text)"
    },
    "hr_permanent_pay_structures_pkey": {
      "table": "hr_permanent_pay_structures",
      "definition": "CREATE UNIQUE INDEX hr_permanent_pay_structures_pkey ON public.hr_permanent_pay_structures USING btree (id)"
    },
    "hr_row_sheet_employee_unique": {
      "table": "hr_attendance_rows",
      "definition": "CREATE UNIQUE INDEX hr_row_sheet_employee_unique ON public.hr_attendance_rows USING btree (sheet_id, employee_id)"
    },
    "hr_rows_employee_idx": {
      "table": "hr_attendance_rows",
      "definition": "CREATE INDEX hr_rows_employee_idx ON public.hr_attendance_rows USING btree (employee_id, sheet_id)"
    },
    "hr_rows_leave_idx": {
      "table": "hr_attendance_rows",
      "definition": "CREATE INDEX hr_rows_leave_idx ON public.hr_attendance_rows USING btree (leave_request_id, sheet_id) WHERE (leave_request_id IS NOT NULL)"
    },
    "hr_sheet_date_category_factory_unique": {
      "table": "hr_attendance_sheets",
      "definition": "CREATE UNIQUE INDEX hr_sheet_date_category_factory_unique ON public.hr_attendance_sheets USING btree (attendance_date, employee_category, department) NULLS NOT DISTINCT"
    },
    "hr_sheets_queue_idx": {
      "table": "hr_attendance_sheets",
      "definition": "CREATE INDEX hr_sheets_queue_idx ON public.hr_attendance_sheets USING btree (status, attendance_date, employee_category)"
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
    "payroll_adjustment_applications_pkey": {
      "table": "payroll_adjustment_applications",
      "definition": "CREATE UNIQUE INDEX payroll_adjustment_applications_pkey ON public.payroll_adjustment_applications USING btree (adjustment_id, salary_row_id, contribution_month)"
    },
    "payroll_adjustment_employee_idx": {
      "table": "payroll_adjustments",
      "definition": "CREATE INDEX payroll_adjustment_employee_idx ON public.payroll_adjustments USING btree (employee_id, effective_date, id)"
    },
    "payroll_adjustment_events_pkey": {
      "table": "payroll_adjustment_events",
      "definition": "CREATE UNIQUE INDEX payroll_adjustment_events_pkey ON public.payroll_adjustment_events USING btree (id)"
    },
    "payroll_adjustments_pkey": {
      "table": "payroll_adjustments",
      "definition": "CREATE UNIQUE INDEX payroll_adjustments_pkey ON public.payroll_adjustments USING btree (id)"
    },
    "payroll_advance_application_month_idx": {
      "table": "payroll_adjustment_applications",
      "definition": "CREATE INDEX payroll_advance_application_month_idx ON public.payroll_adjustment_applications USING btree (adjustment_id, contribution_month, salary_row_id)"
    },
    "payroll_assignment_employee_scope_idx": {
      "table": "payroll_employee_assignments",
      "definition": "CREATE INDEX payroll_assignment_employee_scope_idx ON public.payroll_employee_assignments USING btree (employee_id, group_code, employee_category)"
    },
    "payroll_assignment_nonoverlap": {
      "table": "payroll_employee_assignments",
      "definition": "CREATE INDEX payroll_assignment_nonoverlap ON public.payroll_employee_assignments USING gist (revision_id, daterange(effective_from, effective_to, '[]'::text))"
    },
    "payroll_calendar_group_date_idx": {
      "table": "payroll_work_calendar_days",
      "definition": "CREATE INDEX payroll_calendar_group_date_idx ON public.payroll_work_calendar_days USING btree (group_code, department, calendar_date)"
    },
    "payroll_calendar_published_unique": {
      "table": "payroll_work_calendar_days",
      "definition": "CREATE UNIQUE INDEX payroll_calendar_published_unique ON public.payroll_work_calendar_days USING btree (group_code, department, calendar_date) WHERE (status = 'PUBLISHED'::text)"
    },
    "payroll_employee_finalized_nonoverlap": {
      "table": "payroll_employee_coverage",
      "definition": "CREATE INDEX payroll_employee_finalized_nonoverlap ON public.payroll_employee_coverage USING gist (employee_id, daterange(period_from, period_to, '[]'::text))"
    },
    "payroll_employee_month_entitlement_employee_id_salary_month_key": {
      "table": "payroll_employee_month_entitlements",
      "definition": "CREATE UNIQUE INDEX payroll_employee_month_entitlement_employee_id_salary_month_key ON public.payroll_employee_month_entitlements USING btree (employee_id, salary_month)"
    },
    "payroll_employee_observations_employee_idx": {
      "table": "payroll_employee_observations",
      "definition": "CREATE INDEX payroll_employee_observations_employee_idx ON public.payroll_employee_observations USING btree (employee_id, observed_at)"
    },
    "payroll_employee_review_queue_idx": {
      "table": "payroll_run_employees",
      "definition": "CREATE INDEX payroll_employee_review_queue_idx ON public.payroll_run_employees USING btree (status, run_id, id)"
    },
    "payroll_employee_statutory_profiles_pkey": {
      "table": "payroll_employee_statutory_profiles",
      "definition": "CREATE UNIQUE INDEX payroll_employee_statutory_profiles_pkey ON public.payroll_employee_statutory_profiles USING btree (id)"
    },
    "payroll_entitlement_employee_unique": {
      "table": "payroll_employee_month_entitlements",
      "definition": "CREATE UNIQUE INDEX payroll_entitlement_employee_unique ON public.payroll_employee_month_entitlements USING btree (id, employee_id)"
    },
    "payroll_factory_scope_latest_idx": {
      "table": "payroll_factory_scope_events",
      "definition": "CREATE INDEX payroll_factory_scope_latest_idx ON public.payroll_factory_scope_events USING btree (user_id, department, id DESC)"
    },
    "payroll_financial_snapshots_pkey": {
      "table": "payroll_financial_snapshots",
      "definition": "CREATE UNIQUE INDEX payroll_financial_snapshots_pkey ON public.payroll_financial_snapshots USING btree (row_id)"
    },
    "payroll_history_run_idx": {
      "table": "payroll_action_history",
      "definition": "CREATE INDEX payroll_history_run_idx ON public.payroll_action_history USING btree (run_id, id)"
    },
    "payroll_master_policy_events_idx": {
      "table": "payroll_master_events",
      "definition": "CREATE INDEX payroll_master_policy_events_idx ON public.payroll_master_events USING btree (policy_revision_id, id) WHERE (policy_revision_id IS NOT NULL)"
    },
    "payroll_master_statutory_events_idx": {
      "table": "payroll_master_events",
      "definition": "CREATE INDEX payroll_master_statutory_events_idx ON public.payroll_master_events USING btree (statutory_revision_id, id) WHERE (statutory_revision_id IS NOT NULL)"
    },
    "payroll_pay_applicability_nonoverlap": {
      "table": "payroll_permanent_pay_applicability",
      "definition": "CREATE INDEX payroll_pay_applicability_nonoverlap ON public.payroll_permanent_pay_applicability USING gist (revision_id, daterange(effective_from, effective_to, '[]'::text))"
    },
    "payroll_period_cutoffs_pkey": {
      "table": "payroll_period_cutoffs",
      "definition": "CREATE UNIQUE INDEX payroll_period_cutoffs_pkey ON public.payroll_period_cutoffs USING btree (run_id, version)"
    },
    "payroll_policy_published_nonoverlap": {
      "table": "payroll_policy_master_revisions",
      "definition": "CREATE INDEX payroll_policy_published_nonoverlap ON public.payroll_policy_master_revisions USING gist (COALESCE(group_code, 'GLOBAL'::text), daterange(effective_from, effective_to, '[]'::text)) WHERE (status = 'PUBLISHED'::text)"
    },
    "payroll_policy_revision_number_unique": {
      "table": "payroll_policy_master_revisions",
      "definition": "CREATE UNIQUE INDEX payroll_policy_revision_number_unique ON public.payroll_policy_master_revisions USING btree (COALESCE(group_code, 'GLOBAL'::text), revision_number) WHERE (status = 'PUBLISHED'::text)"
    },
    "payroll_profile_interval_nonoverlap": {
      "table": "payroll_employee_statutory_profiles",
      "definition": "CREATE INDEX payroll_profile_interval_nonoverlap ON public.payroll_employee_statutory_profiles USING gist (revision_id, scheme, daterange(effective_from, effective_to, '[]'::text))"
    },
    "payroll_pt_slab_nonoverlap": {
      "table": "payroll_professional_tax_slabs",
      "definition": "CREATE INDEX payroll_pt_slab_nonoverlap ON public.payroll_professional_tax_slabs USING gist (revision_id, month, numrange(lower_bound, upper_bound, '[)'::text))"
    },
    "payroll_review_action_version_unique": {
      "table": "payroll_action_history",
      "definition": "CREATE UNIQUE INDEX payroll_review_action_version_unique ON public.payroll_action_history USING btree (row_id, review_version) WHERE ((review_version IS NOT NULL) AND (action <> 'LOCK_BLOCKED'::text))"
    },
    "payroll_review_revisions_pkey": {
      "table": "payroll_review_revisions",
      "definition": "CREATE UNIQUE INDEX payroll_review_revisions_pkey ON public.payroll_review_revisions USING btree (row_id, revision)"
    },
    "payroll_run_employee_source_period_idx": {
      "table": "payroll_run_employees",
      "definition": "CREATE INDEX payroll_run_employee_source_period_idx ON public.payroll_run_employees USING btree (employee_id, period_from, period_to, run_id)"
    },
    "payroll_run_employees_run_id_employee_id_key": {
      "table": "payroll_run_employees",
      "definition": "CREATE UNIQUE INDEX payroll_run_employees_run_id_employee_id_key ON public.payroll_run_employees USING btree (run_id, employee_id)"
    },
    "payroll_runs_scope_period_idx": {
      "table": "payroll_runs",
      "definition": "CREATE INDEX payroll_runs_scope_period_idx ON public.payroll_runs USING btree (department, group_code, period_from, period_to)"
    },
    "payroll_sources_row_version_idx": {
      "table": "payroll_source_links",
      "definition": "CREATE INDEX payroll_sources_row_version_idx ON public.payroll_source_links USING btree (row_id, row_version)"
    },
    "payroll_statutory_entries_pkey": {
      "table": "payroll_statutory_entries",
      "definition": "CREATE UNIQUE INDEX payroll_statutory_entries_pkey ON public.payroll_statutory_entries USING btree (salary_row_id, scheme, contribution_month)"
    },
    "payroll_statutory_month_idx": {
      "table": "payroll_statutory_entries",
      "definition": "CREATE INDEX payroll_statutory_month_idx ON public.payroll_statutory_entries USING btree (employee_id, scheme, contribution_month, salary_row_id)"
    },
    "payroll_statutory_published_nonoverlap": {
      "table": "payroll_statutory_rule_revisions",
      "definition": "CREATE INDEX payroll_statutory_published_nonoverlap ON public.payroll_statutory_rule_revisions USING gist (scheme, jurisdiction, establishment, daterange(effective_from, effective_to, '[]'::text)) WHERE (status = 'PUBLISHED'::text)"
    },
    "payroll_statutory_revision_number_unique": {
      "table": "payroll_statutory_rule_revisions",
      "definition": "CREATE UNIQUE INDEX payroll_statutory_revision_number_unique ON public.payroll_statutory_rule_revisions USING btree (scheme, jurisdiction, establishment, revision_number) WHERE (status = 'PUBLISHED'::text)"
    },
    "payroll_statutory_scope_bindings_scope_idx": {
      "table": "payroll_statutory_scope_bindings",
      "definition": "CREATE INDEX payroll_statutory_scope_bindings_scope_idx ON public.payroll_statutory_scope_bindings USING btree (statutory_scope_id, revision_id)"
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
