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
    "lock_estimate_quotations": {
      "args": [
        {
          "name": "p_estimate_id",
          "type": "uuid"
        }
      ],
      "returns": "void"
    },
    "refresh_analytics_views": {
      "args": [],
      "returns": "void"
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
    }
  }
};
