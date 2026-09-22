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
