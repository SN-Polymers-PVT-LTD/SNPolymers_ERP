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
    "approve_fund_request_transact": {
      "args": [
        {
          "name": "p_fund_request_id",
          "type": "uuid"
        },
        {
          "name": "p_approved_amount",
          "type": "numeric"
        },
        {
          "name": "p_transfer_from_account",
          "type": "character varying"
        },
        {
          "name": "p_actioned_by",
          "type": "character varying"
        },
        {
          "name": "p_remarks",
          "type": "text"
        }
      ],
      "returns": "fund_requests"
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
        }
      ],
      "returns": "requisitions"
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
    }
  }
};
