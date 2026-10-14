// AUTO-GENERATED — do not edit. Run: npm run generate:manifests
module.exports = {
  "functions": {
    "accept_excess_fund_return": {
      "args": [
        {
          "name": "p_return_id",
          "type": "uuid"
        },
        {
          "name": "p_client_updated_at",
          "type": "timestamp with time zone"
        },
        {
          "name": "p_actioned_by",
          "type": "character varying"
        },
        {
          "name": "p_breakdown",
          "type": "jsonb DEFAULT NULL::jsonb"
        }
      ],
      "returns": "excess_fund_returns"
    },
    "act_payroll_adjustment": {
      "args": [
        {
          "name": "p_id",
          "type": "uuid"
        },
        {
          "name": "p_expected_version",
          "type": "integer"
        },
        {
          "name": "p_action",
          "type": "text"
        },
        {
          "name": "p_reason",
          "type": "text"
        },
        {
          "name": "p_data",
          "type": "jsonb"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "add_payroll_draft_employee": {
      "args": [
        {
          "name": "p_run_id",
          "type": "uuid"
        },
        {
          "name": "p_assignment_id",
          "type": "uuid"
        },
        {
          "name": "p_from",
          "type": "date"
        },
        {
          "name": "p_to",
          "type": "date"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "payroll_run_employees"
    },
    "approve_requisition_transact": {
      "args": [
        {
          "name": "p_requisition_id",
          "type": "uuid"
        },
        {
          "name": "p_approved_amount",
          "type": "numeric"
        },
        {
          "name": "p_actioned_by",
          "type": "character varying"
        },
        {
          "name": "p_remarks_approved_authority",
          "type": "text"
        }
      ],
      "returns": "requisitions"
    },
    "bind_payroll_statutory_scope": {
      "args": [
        {
          "name": "p_revision_id",
          "type": "uuid"
        },
        {
          "name": "p_scope_id",
          "type": "uuid"
        },
        {
          "name": "p_evidence",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "void"
    },
    "create_payroll_adjustment": {
      "args": [
        {
          "name": "p_employee_id",
          "type": "uuid"
        },
        {
          "name": "p_data",
          "type": "jsonb"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "create_payroll_draft_run": {
      "args": [
        {
          "name": "p_group_code",
          "type": "text"
        },
        {
          "name": "p_department",
          "type": "text"
        },
        {
          "name": "p_from",
          "type": "date"
        },
        {
          "name": "p_to",
          "type": "date"
        },
        {
          "name": "p_cycle",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "payroll_runs"
    },
    "create_ra_final_bill_secure": {
      "args": [
        {
          "name": "p_bill",
          "type": "jsonb"
        }
      ],
      "returns": "ra_final_bills"
    },
    "create_requisition_secure": {
      "args": [
        {
          "name": "p_requester_user_id",
          "type": "character varying"
        },
        {
          "name": "p_work_order_no",
          "type": "character varying"
        },
        {
          "name": "p_estimate_no",
          "type": "character varying"
        },
        {
          "name": "p_estimate_amount",
          "type": "numeric"
        },
        {
          "name": "p_state",
          "type": "character varying"
        },
        {
          "name": "p_district",
          "type": "character varying"
        },
        {
          "name": "p_area_code",
          "type": "character varying"
        },
        {
          "name": "p_department",
          "type": "character varying"
        },
        {
          "name": "p_site_details",
          "type": "text"
        },
        {
          "name": "p_requisition_no",
          "type": "character varying"
        },
        {
          "name": "p_material_main_head",
          "type": "character varying"
        },
        {
          "name": "p_requisition_pdf_url",
          "type": "text"
        },
        {
          "name": "p_original_filename",
          "type": "character varying"
        },
        {
          "name": "p_requisition_amount",
          "type": "numeric"
        },
        {
          "name": "p_gst_bill",
          "type": "gst_bill_enum"
        },
        {
          "name": "p_gst_bill_pdf_url",
          "type": "text"
        },
        {
          "name": "p_bank_details",
          "type": "text"
        },
        {
          "name": "p_expen_head_remarks",
          "type": "text"
        },
        {
          "name": "p_requisition_status",
          "type": "requisition_status_enum"
        },
        {
          "name": "p_created_by",
          "type": "character varying"
        },
        {
          "name": "p_material_sub_head",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_material_details",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_beneficiary_name",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_ac_no",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_ifsc",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_bank_name",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_bank_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_zo_user_id",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_requisition_pdf_attachment_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_gst_bill_pdf_attachment_id",
          "type": "uuid DEFAULT NULL::uuid"
        }
      ],
      "returns": "requisitions"
    },
    "create_subcontract_requisition_secure": {
      "args": [
        {
          "name": "p_requester_user_id",
          "type": "character varying"
        },
        {
          "name": "p_work_order_no",
          "type": "character varying"
        },
        {
          "name": "p_estimate_no",
          "type": "character varying"
        },
        {
          "name": "p_estimate_amount",
          "type": "numeric"
        },
        {
          "name": "p_state",
          "type": "character varying"
        },
        {
          "name": "p_district",
          "type": "character varying"
        },
        {
          "name": "p_area_code",
          "type": "character varying"
        },
        {
          "name": "p_department",
          "type": "character varying"
        },
        {
          "name": "p_site_details",
          "type": "text"
        },
        {
          "name": "p_requisition_no",
          "type": "character varying"
        },
        {
          "name": "p_material_main_head",
          "type": "character varying"
        },
        {
          "name": "p_requisition_pdf_url",
          "type": "text"
        },
        {
          "name": "p_original_filename",
          "type": "character varying"
        },
        {
          "name": "p_requisition_amount",
          "type": "numeric"
        },
        {
          "name": "p_gst_bill",
          "type": "gst_bill_enum"
        },
        {
          "name": "p_gst_bill_pdf_url",
          "type": "text"
        },
        {
          "name": "p_bank_details",
          "type": "text"
        },
        {
          "name": "p_expen_head_remarks",
          "type": "text"
        },
        {
          "name": "p_requisition_status",
          "type": "requisition_status_enum"
        },
        {
          "name": "p_created_by",
          "type": "character varying"
        },
        {
          "name": "p_material_sub_head",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_material_details",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_beneficiary_name",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_ac_no",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_ifsc",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_bank_name",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_bank_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_zo_user_id",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_requisition_pdf_attachment_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_gst_bill_pdf_attachment_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_subcontractor_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_subcontract_work_id",
          "type": "uuid DEFAULT NULL::uuid"
        }
      ],
      "returns": "requisitions"
    },
    "decide_hr_factory_sheet_leave": {
      "args": [
        {
          "name": "p_sheet_id",
          "type": "uuid"
        },
        {
          "name": "p_leave_id",
          "type": "uuid"
        },
        {
          "name": "p_decision",
          "type": "text"
        },
        {
          "name": "p_pay_treatment",
          "type": "text"
        },
        {
          "name": "p_remarks",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "hr_leave_requests"
    },
    "decide_hr_leave_request": {
      "args": [
        {
          "name": "p_leave_id",
          "type": "uuid"
        },
        {
          "name": "p_decision",
          "type": "text"
        },
        {
          "name": "p_pay_treatment",
          "type": "text"
        },
        {
          "name": "p_remarks",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "hr_leave_requests"
    },
    "get_accounts_import_queue": {
      "args": [
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        },
        {
          "name": "p_status",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_particulars",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_account_sub_title",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_ac_no",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_debit_bank_ac_type",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_date_from",
          "type": "timestamp with time zone DEFAULT NULL::timestamp with time zone"
        },
        {
          "name": "p_date_to",
          "type": "timestamp with time zone DEFAULT NULL::timestamp with time zone"
        }
      ],
      "returns": "jsonb"
    },
    "get_accounts_import_queue_export": {
      "args": [
        {
          "name": "p_status",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_particulars",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_account_sub_title",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_beneficiary_ac_no",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_debit_bank_ac_type",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_date_from",
          "type": "timestamp with time zone DEFAULT NULL::timestamp with time zone"
        },
        {
          "name": "p_date_to",
          "type": "timestamp with time zone DEFAULT NULL::timestamp with time zone"
        }
      ],
      "returns": "jsonb"
    },
    "get_hr_attendance_review_queue": {
      "args": [
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_from_date",
          "type": "date DEFAULT NULL::date"
        },
        {
          "name": "p_to_date",
          "type": "date DEFAULT NULL::date"
        },
        {
          "name": "p_category",
          "type": "text DEFAULT NULL::text"
        },
        {
          "name": "p_status",
          "type": "text DEFAULT NULL::text"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        },
        {
          "name": "p_department",
          "type": "text DEFAULT NULL::text"
        }
      ],
      "returns": "jsonb"
    },
    "get_hr_attendance_review_state": {
      "args": [
        {
          "name": "p_sheet_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_adjustments": {
      "args": [
        {
          "name": "p_employee_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_draft_candidates": {
      "args": [
        {
          "name": "p_run_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_draft_run": {
      "args": [
        {
          "name": "p_run_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_employee_review": {
      "args": [
        {
          "name": "p_row_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_foundation_context": {
      "args": [
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_master_revisions": {
      "args": [
        {
          "name": "p_kind",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_official_payslip": {
      "args": [
        {
          "name": "p_row_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_preview_sources": {
      "args": [
        {
          "name": "p_row_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_review_queue": {
      "args": [
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_run_id",
          "type": "uuid DEFAULT NULL::uuid"
        },
        {
          "name": "p_status",
          "type": "text DEFAULT NULL::text"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_review_sources": {
      "args": [
        {
          "name": "p_row_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_salary_register": {
      "args": [
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_filters",
          "type": "jsonb DEFAULT '{}'::jsonb"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_source_history": {
      "args": [
        {
          "name": "p_employee_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_statutory_employees": {
      "args": [
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_search",
          "type": "text DEFAULT ''::text"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_statutory_profile_context": {
      "args": [
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_search",
          "type": "text DEFAULT ''::text"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "get_payroll_statutory_profiles": {
      "args": [
        {
          "name": "p_employee_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "get_subcontract_financial_consumption": {
      "args": [
        {
          "name": "p_work_order_no",
          "type": "character varying"
        },
        {
          "name": "p_subcontractor_id",
          "type": "uuid"
        },
        {
          "name": "p_subcontract_work_id",
          "type": "uuid"
        }
      ],
      "returns": "numeric"
    },
    "get_subcontractor_ledger_entries": {
      "args": [
        {
          "name": "p_work_order_no",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_material_sub_head",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_material_details",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_search",
          "type": "character varying DEFAULT NULL::character varying"
        },
        {
          "name": "p_date_from",
          "type": "timestamp with time zone DEFAULT NULL::timestamp with time zone"
        },
        {
          "name": "p_date_to",
          "type": "timestamp with time zone DEFAULT NULL::timestamp with time zone"
        }
      ],
      "returns": "TABLE(entry jsonb, opening_balance numeric, closing_balance numeric)"
    },
    "increment_otp_attempts": {
      "args": [
        {
          "name": "p_id",
          "type": "uuid"
        }
      ],
      "returns": "integer"
    },
    "list_payroll_preview_runs": {
      "args": [
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_page",
          "type": "integer DEFAULT 1"
        },
        {
          "name": "p_limit",
          "type": "integer DEFAULT 20"
        }
      ],
      "returns": "jsonb"
    },
    "lock_estimate_quotations": {
      "args": [
        {
          "name": "p_estimate_id",
          "type": "uuid"
        }
      ],
      "returns": "void"
    },
    "populate_hr_attendance_sheet": {
      "args": [
        {
          "name": "p_date",
          "type": "date"
        },
        {
          "name": "p_category",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        },
        {
          "name": "p_department",
          "type": "text DEFAULT NULL::text"
        }
      ],
      "returns": "hr_attendance_sheets"
    },
    "preview_payroll_master_publication": {
      "args": [
        {
          "name": "p_kind",
          "type": "text"
        },
        {
          "name": "p_id",
          "type": "uuid"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "publish_payroll_calendar_days": {
      "args": [
        {
          "name": "p_group",
          "type": "text"
        },
        {
          "name": "p_department",
          "type": "text"
        },
        {
          "name": "p_days",
          "type": "jsonb"
        },
        {
          "name": "p_evidence",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "publish_payroll_master": {
      "args": [
        {
          "name": "p_kind",
          "type": "text"
        },
        {
          "name": "p_id",
          "type": "uuid"
        },
        {
          "name": "p_expected_version",
          "type": "integer"
        },
        {
          "name": "p_preview_token",
          "type": "text"
        },
        {
          "name": "p_approval_reference",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "reconcile_subcontract_estimate_lines": {
      "args": [
        {
          "name": "p_estimate_id",
          "type": "uuid"
        },
        {
          "name": "p_actor",
          "type": "character varying"
        },
        {
          "name": "p_expected_updated_at",
          "type": "timestamp with time zone"
        },
        {
          "name": "p_lines",
          "type": "jsonb"
        }
      ],
      "returns": "void"
    },
    "record_payroll_source_history": {
      "args": [
        {
          "name": "p_employee_id",
          "type": "uuid"
        },
        {
          "name": "p_kind",
          "type": "text"
        },
        {
          "name": "p_intervals",
          "type": "jsonb"
        },
        {
          "name": "p_evidence",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "uuid"
    },
    "record_payroll_statutory_profiles": {
      "args": [
        {
          "name": "p_employee_id",
          "type": "uuid"
        },
        {
          "name": "p_expected_version",
          "type": "integer"
        },
        {
          "name": "p_intervals",
          "type": "jsonb"
        },
        {
          "name": "p_evidence",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "refresh_analytics_views": {
      "args": [],
      "returns": "void"
    },
    "register_payroll_statutory_scope": {
      "args": [
        {
          "name": "p_jurisdiction_code",
          "type": "text"
        },
        {
          "name": "p_establishment_code",
          "type": "text"
        },
        {
          "name": "p_evidence",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "uuid"
    },
    "reopen_subcontract_estimate": {
      "args": [
        {
          "name": "p_estimate_id",
          "type": "uuid"
        },
        {
          "name": "p_actor",
          "type": "character varying"
        },
        {
          "name": "p_remarks",
          "type": "text"
        },
        {
          "name": "p_expected_updated_at",
          "type": "timestamp with time zone"
        }
      ],
      "returns": "void"
    },
    "resolve_payroll_master": {
      "args": [
        {
          "name": "p_kind",
          "type": "text"
        },
        {
          "name": "p_scope",
          "type": "jsonb"
        },
        {
          "name": "p_date",
          "type": "date"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "review_subcontract_estimate_rows": {
      "args": [
        {
          "name": "p_estimate_id",
          "type": "uuid"
        },
        {
          "name": "p_actor",
          "type": "character varying"
        },
        {
          "name": "p_stage",
          "type": "character varying"
        },
        {
          "name": "p_approvals",
          "type": "jsonb"
        },
        {
          "name": "p_expected_updated_at",
          "type": "timestamp with time zone"
        }
      ],
      "returns": "void"
    },
    "revise_payroll_draft_note": {
      "args": [
        {
          "name": "p_row_id",
          "type": "uuid"
        },
        {
          "name": "p_expected_version",
          "type": "integer"
        },
        {
          "name": "p_note",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "payroll_run_employees"
    },
    "save_hr_attendance_rows": {
      "args": [
        {
          "name": "p_sheet_id",
          "type": "uuid"
        },
        {
          "name": "p_rows",
          "type": "jsonb"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "SETOF hr_attendance_rows"
    },
    "save_hr_factory_attendance_leave": {
      "args": [
        {
          "name": "p_sheet_id",
          "type": "uuid"
        },
        {
          "name": "p_employee_id",
          "type": "uuid"
        },
        {
          "name": "p_leave_id",
          "type": "uuid"
        },
        {
          "name": "p_from_date",
          "type": "date"
        },
        {
          "name": "p_to_date",
          "type": "date"
        },
        {
          "name": "p_leave_type",
          "type": "text"
        },
        {
          "name": "p_reason",
          "type": "text"
        },
        {
          "name": "p_pay_treatment",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "hr_leave_requests"
    },
    "save_hr_leave_request": {
      "args": [
        {
          "name": "p_leave_id",
          "type": "uuid"
        },
        {
          "name": "p_employee_id",
          "type": "uuid"
        },
        {
          "name": "p_source",
          "type": "text"
        },
        {
          "name": "p_from_date",
          "type": "date"
        },
        {
          "name": "p_to_date",
          "type": "date"
        },
        {
          "name": "p_leave_type",
          "type": "text"
        },
        {
          "name": "p_reason",
          "type": "text"
        },
        {
          "name": "p_pay_treatment",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "hr_leave_requests"
    },
    "save_payroll_master_draft": {
      "args": [
        {
          "name": "p_kind",
          "type": "text"
        },
        {
          "name": "p_id",
          "type": "uuid"
        },
        {
          "name": "p_expected_version",
          "type": "integer"
        },
        {
          "name": "p_data",
          "type": "jsonb"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "set_payroll_period_cutoff": {
      "args": [
        {
          "name": "p_run_id",
          "type": "uuid"
        },
        {
          "name": "p_expected_version",
          "type": "integer"
        },
        {
          "name": "p_action",
          "type": "text"
        },
        {
          "name": "p_cutoff",
          "type": "timestamp with time zone"
        },
        {
          "name": "p_evidence",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "submit_fund_request_transact": {
      "args": [
        {
          "name": "p_fund_request_id",
          "type": "uuid"
        },
        {
          "name": "p_submitted_by",
          "type": "character varying"
        }
      ],
      "returns": "fund_requests"
    },
    "submit_reopened_subcontract_estimate": {
      "args": [
        {
          "name": "p_estimate_id",
          "type": "uuid"
        },
        {
          "name": "p_actor",
          "type": "character varying"
        },
        {
          "name": "p_expected_updated_at",
          "type": "timestamp with time zone"
        }
      ],
      "returns": "void"
    },
    "sync_subcontract_contributions_to_cost_estimate": {
      "args": [
        {
          "name": "p_cost_estimate_id",
          "type": "uuid"
        },
        {
          "name": "p_actor",
          "type": "character varying"
        }
      ],
      "returns": "void"
    },
    "transition_hr_attendance_sheet": {
      "args": [
        {
          "name": "p_sheet_id",
          "type": "uuid"
        },
        {
          "name": "p_action",
          "type": "text"
        },
        {
          "name": "p_remarks",
          "type": "text"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "hr_attendance_sheets"
    },
    "transition_payroll_employee_review": {
      "args": [
        {
          "name": "p_row_id",
          "type": "uuid"
        },
        {
          "name": "p_expected_version",
          "type": "integer"
        },
        {
          "name": "p_expected_review_version",
          "type": "integer"
        },
        {
          "name": "p_action",
          "type": "text"
        },
        {
          "name": "p_data",
          "type": "jsonb"
        },
        {
          "name": "p_actor_id",
          "type": "uuid"
        }
      ],
      "returns": "jsonb"
    },
    "transition_subcontract_estimate_workflow": {
      "args": [
        {
          "name": "p_estimate_id",
          "type": "uuid"
        },
        {
          "name": "p_actor",
          "type": "character varying"
        },
        {
          "name": "p_action",
          "type": "character varying"
        },
        {
          "name": "p_remarks",
          "type": "text"
        },
        {
          "name": "p_expected_updated_at",
          "type": "timestamp with time zone"
        },
        {
          "name": "p_deadline_hours",
          "type": "integer DEFAULT 24"
        }
      ],
      "returns": "void"
    }
  }
};
