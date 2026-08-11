// AUTO-GENERATED — do not edit. Run: npm run generate:manifests
module.exports = {
  "tables": {
    "authorised_users": {
      "columns": {
        "id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "mobile_number": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "display_name": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "role": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": "'je'::character varying"
        },
        "permissions": {
          "type": "jsonb",
          "udtName": "jsonb",
          "nullable": true,
          "default": "'{}'::jsonb"
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": "now()"
        },
        "is_active": {
          "type": "boolean",
          "udtName": "bool",
          "nullable": true,
          "default": "true"
        },
        "telegram_chat_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": "NULL::character varying"
        },
        "daily_streak": {
          "type": "integer",
          "udtName": "int4",
          "nullable": true,
          "default": "0"
        },
        "last_report_date": {
          "type": "date",
          "udtName": "date",
          "nullable": true,
          "default": null
        }
      }
    },
    "sessions": {
      "columns": {
        "id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": true,
          "default": null
        },
        "login_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": "now()"
        },
        "logout_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "duration_seconds": {
          "type": "integer",
          "udtName": "int4",
          "nullable": true,
          "default": null
        },
        "ip_address": {
          "type": "inet",
          "udtName": "inet",
          "nullable": true,
          "default": null
        },
        "user_agent": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "module": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": "'office'::character varying"
        },
        "jwt_jti": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "is_active": {
          "type": "boolean",
          "udtName": "bool",
          "nullable": true,
          "default": "true"
        }
      }
    },
    "otp_requests": {
      "columns": {
        "id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "mobile_number": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "otp_hash": {
          "type": "text",
          "udtName": "text",
          "nullable": false,
          "default": null
        },
        "expires_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": null
        },
        "is_used": {
          "type": "boolean",
          "udtName": "bool",
          "nullable": true,
          "default": "false"
        },
        "attempts": {
          "type": "integer",
          "udtName": "int4",
          "nullable": true,
          "default": "0"
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": "now()"
        }
      }
    },
    "requisitions": {
      "columns": {
        "requisition_id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "requester_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "login_date": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "work_order_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "estimate_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "estimate_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": true,
          "default": null
        },
        "state": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "district": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "area_code": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "department": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "site_details": {
          "type": "text",
          "udtName": "text",
          "nullable": false,
          "default": null
        },
        "requisition_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "material_main_head": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "requisition_pdf_url": {
          "type": "text",
          "udtName": "text",
          "nullable": false,
          "default": null
        },
        "original_filename": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "requisition_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": false,
          "default": null
        },
        "gst_bill": {
          "type": "USER-DEFINED",
          "udtName": "gst_bill_enum",
          "nullable": false,
          "default": null
        },
        "gst_bill_pdf_url": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "bank_details": {
          "type": "text",
          "udtName": "text",
          "nullable": false,
          "default": null
        },
        "expen_head_remarks": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "requisition_status": {
          "type": "USER-DEFINED",
          "udtName": "requisition_status_enum",
          "nullable": false,
          "default": "'Pending'::requisition_status_enum"
        },
        "approved_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "payment_date": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "approve_type": {
          "type": "USER-DEFINED",
          "udtName": "requisition_action_enum",
          "nullable": true,
          "default": null
        },
        "approved_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": true,
          "default": null
        },
        "approved_balance_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": true,
          "default": null
        },
        "remarks_approved_authority": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "cancelled_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "cancelled_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "created_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "zo_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        }
      }
    },
    "fund_requests": {
      "columns": {
        "fund_request_id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "zo_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "zo_date": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "zo_fr_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "zo_fr_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": false,
          "default": null
        },
        "zo_remarks": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "request_status": {
          "type": "USER-DEFINED",
          "udtName": "fund_request_status_enum",
          "nullable": false,
          "default": "'Pending'::fund_request_status_enum"
        },
        "approve_ho_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "approve_ho_date": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "approve_ho_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": true,
          "default": null
        },
        "transfer_from_account": {
          "type": "USER-DEFINED",
          "udtName": "transfer_account_enum",
          "nullable": true,
          "default": null
        },
        "ho_remarks": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "cancelled_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "cancelled_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "created_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "attachments": {
          "type": "jsonb",
          "udtName": "jsonb",
          "nullable": true,
          "default": "'[]'::jsonb"
        },
        "work_order_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        }
      }
    },
    "projects_master": {
      "columns": {
        "work_order_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "estimate_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "site_details": {
          "type": "text",
          "udtName": "text",
          "nullable": false,
          "default": null
        },
        "state": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "district": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "zone": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "department": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "status": {
          "type": "USER-DEFINED",
          "udtName": "project_status",
          "nullable": false,
          "default": "'Running'::project_status"
        },
        "created_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "edited_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "edited_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "work_order_value": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": false,
          "default": null
        },
        "earnest_money_deposit": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": false,
          "default": "0.00"
        },
        "site_latitude": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": true,
          "default": null
        },
        "site_longitude": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": true,
          "default": null
        },
        "project_start_date": {
          "type": "date",
          "udtName": "date",
          "nullable": true,
          "default": null
        },
        "project_end_date": {
          "type": "date",
          "udtName": "date",
          "nullable": true,
          "default": null
        },
        "zo_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        }
      }
    },
    "project_cost_estimates": {
      "columns": {
        "estimate_id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "work_order_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "estimate_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "area_code": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "estimate_revision": {
          "type": "integer",
          "udtName": "int4",
          "nullable": false,
          "default": "0"
        },
        "zonal_office_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "estimate_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": false,
          "default": "0"
        },
        "estimate_status": {
          "type": "USER-DEFINED",
          "udtName": "estimate_status_enum",
          "nullable": false,
          "default": "'Draft'::estimate_status_enum"
        },
        "last_modified_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "je_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "je_date": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "je_remarks": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "zo_approved_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "zo_approval_date": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "zo_remarks": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "ho_approved_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "ho_approval_date": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "ho_remarks": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "created_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "last_approved_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": true,
          "default": "NULL::numeric"
        }
      }
    },
    "zo_balances": {
      "columns": {
        "zo_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "available_balance": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": false,
          "default": "0.00"
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        }
      }
    },
    "zo_fund_ledger": {
      "columns": {
        "ledger_id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "zo_user_id": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "transaction_type": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "reference_type": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "reference_id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": null
        },
        "amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": false,
          "default": null
        },
        "work_order_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "created_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        }
      }
    },
    "estimated_bills": {
      "columns": {
        "id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "work_order_no": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "estimated_bill_amount": {
          "type": "numeric",
          "udtName": "numeric",
          "nullable": false,
          "default": null
        },
        "estimated_payment_date": {
          "type": "date",
          "udtName": "date",
          "nullable": false,
          "default": null
        },
        "surety_pct": {
          "type": "smallint",
          "udtName": "int2",
          "nullable": false,
          "default": null
        },
        "remarks": {
          "type": "text",
          "udtName": "text",
          "nullable": true,
          "default": null
        },
        "created_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "updated_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        }
      }
    },
    "estimate_quotations": {
      "columns": {
        "quotation_id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()"
        },
        "estimate_id": {
          "type": "uuid",
          "udtName": "uuid",
          "nullable": false,
          "default": null
        },
        "storage_path": {
          "type": "text",
          "udtName": "text",
          "nullable": false,
          "default": null
        },
        "original_filename": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "vendor_label": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "flagged_for_replacement": {
          "type": "boolean",
          "udtName": "bool",
          "nullable": false,
          "default": "false"
        },
        "file_size": {
          "type": "bigint",
          "udtName": "int8",
          "nullable": false,
          "default": null
        },
        "uploaded_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": false,
          "default": null
        },
        "uploaded_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "is_locked": {
          "type": "boolean",
          "udtName": "bool",
          "nullable": false,
          "default": "false"
        },
        "locked_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "is_deleted": {
          "type": "boolean",
          "udtName": "bool",
          "nullable": false,
          "default": "false"
        },
        "deleted_by": {
          "type": "character varying",
          "udtName": "varchar",
          "nullable": true,
          "default": null
        },
        "deleted_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": true,
          "default": null
        },
        "created_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        },
        "updated_at": {
          "type": "timestamp with time zone",
          "udtName": "timestamptz",
          "nullable": false,
          "default": "now()"
        }
      }
    }
  }
};
