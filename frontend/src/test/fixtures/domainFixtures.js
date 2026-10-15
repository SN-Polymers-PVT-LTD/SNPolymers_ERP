/**
 * Canonical domain fixtures matching PostgreSQL schema and API contracts.
 * Used across page, contract, and workflow tests.
 */

// ─── Users & Roles ──────────────────────────────────────────────────────────
export const usersFixture = {
  admin: {
    id: 'usr_admin',
    display_name: 'Super Admin',
    role: 'admin',
    mobile_number: '+919876543210',
    is_active: true
  },
  ho: {
    id: 'usr_ho',
    display_name: 'HO Approver',
    role: 'ho',
    mobile_number: '+919876543211',
    is_active: true
  },
  zo: {
    id: 'usr_zo',
    display_name: 'Zonal Officer',
    role: 'zo',
    mobile_number: '+919876543212',
    is_active: true
  },
  je: {
    id: 'usr_je',
    display_name: 'Junior Engineer',
    role: 'je',
    mobile_number: '+919876543213',
    is_active: true
  },
  accounts: {
    id: 'usr_acct',
    display_name: 'Accounts Manager',
    role: 'accounts',
    mobile_number: '+919876543214',
    is_active: true
  }
};

// ─── Projects & Work Orders ─────────────────────────────────────────────────
export const projectsFixture = [
  {
    work_order_no: 'WO-101',
    estimate_no: 'EST-101',
    site_details: 'Substation Alpha, North District',
    work_order_value: 5000000,
    department: 'Electrical',
    zone: 'North',
    status: 'Running',
    physical_progress: 45,
    zo_user_id: '+919876543212',
    assigned_jes: [
      { name: 'Junior Engineer', mobile_number: '+919876543213' }
    ],
    created_at: '2026-08-01T00:00:00Z'
  },
  {
    work_order_no: 'WO-102',
    estimate_no: 'EST-102',
    site_details: 'Culvert Beta, South District',
    work_order_value: 2500000,
    department: 'Civil',
    zone: 'South',
    status: 'Closed',
    physical_progress: 100,
    assigned_jes: [],
    created_at: '2026-06-15T00:00:00Z'
  },
  {
    work_order_no: 'WO-103',
    estimate_no: 'EST-103',
    site_details: 'Pump Station Gamma, East District',
    work_order_value: 1500000,
    department: 'Mechanical',
    zone: 'East',
    status: 'Complete Under Maintenance',
    physical_progress: 95,
    assigned_jes: [],
    created_at: '2026-07-20T00:00:00Z'
  }
];

// ─── Cost & Subcontract Estimates ───────────────────────────────────────────
export const estimatesFixture = [
  {
    estimate_id: 'est-cost-1',
    estimate_no: 'EST-101',
    work_order_no: 'WO-101',
    estimate_status: 'Final Approved',
    estimate_amount: 4800000,
    department: 'Electrical',
    created_at: '2026-08-05T00:00:00Z',
    items: [
      {
        item_id: 'item-1',
        material_main_head: 'Electrical',
        material_sub_head: 'Cables',
        material_details: 'Trench Excavation and Conduit Laying',
        unit: 'Mtr',
        qty: 500,
        rate: 1200,
        amount: 600000,
        description: 'Trench Excavation and Conduit Laying',
        quantity: 500,
        unit_rate: 1200,
        total_amount: 600000,
        zo_office_approve: 'Approve',
        ho_office_approve: 'Approve'
      },
      {
        item_id: 'item-2',
        description: 'Transformer Installation and Grounding',
        quantity: 2,
        unit_rate: 2100000,
        total_amount: 4200000,
        zo_office_approve: 'Approve',
        ho_office_approve: 'Approve'
      }
    ]
  },
  {
    estimate_id: 'est-subcontract-1',
    estimate_no: 'SE-201',
    work_order_no: 'WO-101',
    estimate_status: 'Draft',
    subcontractor_name: 'Apex Infra Solutions',
    total_amount: 450000,
    created_at: '2026-09-01T00:00:00Z',
    items: [
      {
        item_id: 'sub-item-1',
        description: 'Cable Jointing and Terminations',
        quantity: 150,
        unit_rate: 3000,
        total_amount: 450000
      }
    ]
  }
];

// ─── Requisitions ───────────────────────────────────────────────────────────
export const requisitionsFixture = [
  {
    requisition_id: 'req-501',
    requisition_no: 'REQ-501',
    work_order_no: 'WO-101',
    requisition_status: 'Pending',
    requisition_amount: 150000,
    approved_amount: 0,
    payment_status: 'Unpaid',
    particulars: 'Emergency Cable Drum Delivery',
    beneficiary_name: 'Pioneer Cable Works',
    beneficiary_ac_no: '987654321001',
    bank_name: 'State Bank of India',
    created_at: '2026-09-15T00:00:00Z'
  },
  {
    requisition_id: 'req-502',
    requisition_no: 'REQ-502',
    work_order_no: 'WO-101',
    requisition_status: 'Approved',
    requisition_amount: 320000,
    approved_amount: 320000,
    payment_status: 'Paid',
    particulars: 'Panel Boards Delivery',
    beneficiary_name: 'Apex Switchgear Ltd',
    beneficiary_ac_no: '987654321002',
    bank_name: 'HDFC Bank',
    payment_date: '2026-09-20T00:00:00Z',
    created_at: '2026-09-10T00:00:00Z'
  }
];

// ─── Fund Requests ──────────────────────────────────────────────────────────
export const fundRequestsFixture = [
  {
    fund_request_id: 'fr-301',
    zo_fr_no: 'FR-301',
    work_order_no: 'WO-101',
    zo_fr_amount: 500000,
    remaining_amount: 500000,
    request_status: 'Approved',
    urgent: true,
    reason: 'Critical transformer site delivery payment',
    zo_user_id: 'usr_zo',
    created_at: '2026-09-12T00:00:00Z',
    // Backward-compat aliases
    request_id: 'fr-301',
    request_no: 'FR-301',
    request_amount: 500000,
    allocated_amount: 500000,
    status: 'Approved'
  },
  {
    fund_request_id: 'fr-302',
    zo_fr_no: 'FR-302',
    work_order_no: 'WO-101',
    zo_fr_amount: 200000,
    remaining_amount: 200000,
    request_status: 'Pending',
    urgent: false,
    reason: 'Secondary cable conduits procurement',
    zo_user_id: 'usr_zo',
    created_at: '2026-09-21T00:00:00Z',
    // Backward-compat aliases
    request_id: 'fr-302',
    request_no: 'FR-302',
    request_amount: 200000,
    allocated_amount: 0,
    status: 'Pending'
  }
];

// ─── Materials ──────────────────────────────────────────────────────────────
export const materialsFixture = [
  {
    id: 1,
    Material_Main_Head: 'Civil',
    Material_Sub_Head: 'Cement',
    Material_Details: 'Portland Pozzolana Cement Grade 53',
    M_Unit: 'Bags',
    is_active: true
  },
  {
    id: 2,
    Material_Main_Head: 'Electrical',
    Material_Sub_Head: 'Cables',
    Material_Details: '4-Core 16 sq mm Armoured Copper Cable',
    M_Unit: 'Meters',
    is_active: true
  },
  {
    id: 3,
    Material_Main_Head: 'Plumbing',
    Material_Sub_Head: 'Pipes',
    Material_Details: '110mm PVC Drainage Pipe Class 4',
    M_Unit: 'Lengths',
    is_active: true
  }
];

export const materialCategoriesFixture = {
  mainHeads: ['Civil', 'Electrical', 'Plumbing'],
  subHeads: ['Cement', 'Cables', 'Pipes']
};

// ─── Accounts Sheets & Queues ───────────────────────────────────────────────
export const accountsSheetsFixture = [
  {
    id: 'sheet-401',
    sheet_id: 'sheet-401',
    sheet_number: 'ACCT-SHT-2026-09-01',
    sheet_status: 'Submitted',
    total_amount: 850000,
    item_count: 4,
    created_at: '2026-09-18T00:00:00Z',
    items: [
      {
        item_id: 's-item-1',
        requisition_no: 'REQ-502',
        amount: 320000,
        beneficiary_name: 'Apex Switchgear Ltd',
        status: 'Approved'
      }
    ]
  }
];

// ─── Subcontractor Ledger Entries ───────────────────────────────────────────
export const ledgerEntriesFixture = [
  {
    entry_id: 'led-1',
    work_order_no: 'WO-101',
    subcontractor_id: 'sc-10',
    subcontractor_name: 'Apex Infra Solutions',
    entry_type: 'bill',
    gross_amount: 250000,
    tds_amount: 5000,
    surety_retention: 12500,
    net_payable: 232500,
    payment_status: 'Paid',
    created_at: '2026-09-08T00:00:00Z'
  },
  {
    entry_id: 'led-2',
    work_order_no: 'WO-101',
    subcontractor_id: 'sc-10',
    subcontractor_name: 'Apex Infra Solutions',
    entry_type: 'payment',
    gross_amount: 232500,
    tds_amount: 0,
    surety_retention: 0,
    net_payable: 232500,
    payment_status: 'Settled',
    created_at: '2026-09-14T00:00:00Z'
  }
];

// ─── Bank Balances ──────────────────────────────────────────────────────────
export const bankBalancesFixture = [
  {
    bank_id: 'bank-1',
    bank_name: 'State Bank of India',
    account_number: 'XXXXXX3210',
    current_balance: 14500000,
    is_active: true
  },
  {
    bank_id: 'bank-2',
    bank_name: 'HDFC Bank',
    account_number: 'XXXXXX8899',
    current_balance: 9200000,
    is_active: true
  }
];


// --- Domain 1: Masters and Project Setup Fixtures ---

export const subcontractWorksFixture = [
  {
    subcontract_work_id: 'scw-001',
    id: 'scw-001',
    sub_head: 'Earthwork Excavation',
    material_details: 'Soil excavation in trenches and foundation',
    unit: 'Cum',
    is_active: true
  },
  {
    subcontract_work_id: 'scw-002',
    id: 'scw-002',
    sub_head: 'RCC Works',
    material_details: 'M25 grade concrete laying and casting',
    unit: 'Cum',
    is_active: true
  }
];

export const subcontractorsFixture = [
  {
    subcontractor_id: 'sc-001',
    id: 'sc-001',
    name: 'Apex Infrastructure Ltd',
    subcontractor_name: 'Apex Infrastructure Ltd',
    is_active: true,
    works: [subcontractWorksFixture[0]],
    capabilities: [
      {
        capability_id: 'cap-001',
        subcontract_work_id: 'scw-001',
        subcontract_work: subcontractWorksFixture[0]
      }
    ]
  },
  {
    subcontractor_id: 'sc-002',
    id: 'sc-002',
    name: 'BuildWell Constructions',
    subcontractor_name: 'BuildWell Constructions',
    is_active: true,
    works: [subcontractWorksFixture[1]],
    capabilities: [
      {
        capability_id: 'cap-002',
        subcontract_work_id: 'scw-002',
        subcontract_work: subcontractWorksFixture[1]
      }
    ]
  }
];

export const userMappingsFixture = [
  {
    mapping_id: 'um-101',
    id: 'um-101',
    je_mobile_number: '9876543213',
    je_name: 'Vikram JE',
    zo_mobile_number: '9876543212',
    zo_name: 'Priya ZO',
    is_active: true,
    assigned_at: '2026-01-10T10:00:00Z',
    deactivated_at: null
  }
];

export const workOrderMappingsFixture = [
  {
    id: 'wom-201',
    work_order_no: 'WO-101',
    je_mobile_number: '9876543213',
    je_name: 'Vikram JE',
    assigned_by: '9876543210',
    assigned_at: '2026-01-12T10:00:00Z',
    is_active: true
  }
];

export const beneficiariesFixture = [
  {
    beneficiary_id: 'ben-001',
    id: 'ben-001',
    beneficiary_name: 'National Suppliers Corp',
    account_number: '123456789012',
    beneficiary_ac_no: '123456789012',
    ifsc: 'SBIN0001234',
    beneficiary_ifsc: 'SBIN0001234',
    bank_name: 'State Bank of India',
    is_active: true
  }
];

export const indianBanksFixture = [
  {
    bank_id: 'bank-01',
    id: 'bank-01',
    bank_name: 'State Bank of India',
    is_active: true
  },
  {
    bank_id: 'bank-02',
    id: 'bank-02',
    bank_name: 'HDFC Bank',
    is_active: true
  }
];


// --- Domain 2: Estimates & Requisitions Fixtures ---

export const subcontractEstimatesFixture = [
  {
    subcontract_estimate_id: '1',
    id: '1',
    work_order_no: 'WO-101',
    estimate_status: 'Submitted',
    subcontractor_id: 'sc-001',
    subcontractor_name: 'Apex Infrastructure Ltd',
    total_amount: 150000,
    created_at: '2026-01-15T10:00:00Z',
    project_subcontract_estimate_lines: [
      {
        line_id: 'line-01',
        subcontractor_id: 'sc-001',
        subcontractor: {
          subcontractor_id: 'sc-001',
          subcontractor_name: 'Apex Infrastructure Ltd',
          is_active: true
        },
        subcontract_work_id: 'scw-001',
        subcontract_work: {
          subcontract_work_id: 'scw-001',
          sub_head: 'Earthwork Excavation',
          material_details: 'Soil excavation in trenches and foundation',
          unit: 'Cum',
          is_active: true
        },
        unit: 'Cum',
        qty: 100,
        rate: 500,
        amount: 50000,
        entry_kind: 'New',
        final_approved_revision: null
      }
    ]
  }
];

export const acctSubTitlesFixture = [
  {
    sub_title_id: 'st-01',
    id: 'st-01',
    sub_title_name: 'Fuel & Transportation',
    code: 'FT01',
    is_active: true
  },
  {
    sub_title_id: 'st-02',
    id: 'st-02',
    sub_title_name: 'Material Procurement',
    code: 'MP02',
    is_active: true
  }
];

export const acctParticularsFixture = [
  {
    particular_id: 'part-01',
    id: 'part-01',
    particular_name: 'Diesel Refill for Generator',
    title: 'Diesel Refill for Generator',
    sub_title_id: 'st-01',
    sub_title_name: 'Fuel & Transportation',
    is_active: true
  }
];

export const acctImportEligibleFixture = [
  {
    item_id: 'item-held-01',
    id: 'item-held-01',
    requisition_no: 'REQ-2026-001',
    work_order_no: 'WO-101',
    sub_head: 'Earthwork',
    requested_amount: 25000,
    status: 'Held',
    reason: 'Pending verification'
  }
];

export const acctPaymentRequisitionsFixture = [
  {
    payment_requisition_id: 'pay-req-01',
    id: 'pay-req-01',
    requisition_no: 'REQ-2026-001',
    work_order_no: 'WO-101',
    beneficiary_name: 'National Suppliers Corp',
    amount: 50000,
    status: 'Ready for Payment'
  }
];

export const acctSheetDetailFixture = {
  sheet_id: '1',
  id: '1',
  sheet_number: 'SHEET-2026-01',
  status: 'Open', sheet_status: 'Open',
  created_at: '2026-01-20T10:00:00Z',
  total_amount: 100000,
  items: [
    {
      item_id: 'item-01',
      id: 'item-01',
      requisition_no: 'REQ-2026-001',
      work_order_no: 'WO-101',
      particular: 'Diesel Refill for Generator',
      amount: 50000,
      status: 'Pending',
      beneficiary_name: 'National Suppliers Corp',
      account_number: '123456789012',
      ifsc: 'SBIN0001234'
    }
  ]
};

export const acctSheetsFixture = accountsSheetsFixture;

export const raBillsFixture = [
  {
    bill_id: 'bill-1',
    id: 'bill-1',
    work_order_no: 'WO-101',
    bill_no: 'RA-001',
    bill_date: '2026-08-15',
    payment_type: 'RA Bill',
    gross_bill: 500000,
    agency_payment: 450000,
    security_deposit_amount: 50000,
    status: 'Approved'
  }
];
