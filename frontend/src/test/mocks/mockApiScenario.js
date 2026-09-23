import { vi } from 'vitest';
import {
  usersFixture,
  projectsFixture,
  estimatesFixture,
  requisitionsFixture,
  fundRequestsFixture,
  materialsFixture,
  materialCategoriesFixture,
  accountsSheetsFixture,
  ledgerEntriesFixture,
  bankBalancesFixture,
  subcontractWorksFixture,
  subcontractorsFixture,
  userMappingsFixture,
  workOrderMappingsFixture,
  beneficiariesFixture,
  indianBanksFixture,
  subcontractEstimatesFixture,
  acctSubTitlesFixture,
  acctParticularsFixture,
  acctImportEligibleFixture,
  acctPaymentRequisitionsFixture,
  acctSheetDetailFixture
} from '../fixtures/domainFixtures';

/**
 * Returns scenario data for common endpoint paths.
 */
function getScenarioPayload(url, scenario, overrides = {}) {
  // Check explicit overrides first
  for (const [pattern, overrideValue] of Object.entries(overrides)) {
    if (url.includes(pattern)) {
      return typeof overrideValue === 'function' ? overrideValue(url) : overrideValue;
    }
  }

  if (scenario === 'empty') {
  if (url.includes('/materials/categories')) return { success: true, mainHeads: [], subHeads: [] };
    if (url.includes('/subcontract-estimates/summary')) return { success: true, summary: [] };
    if (url.includes('/subcontract-estimates/init')) return { success: true, activeProjects: projectsFixture, works: [] };
    if (url.includes('/subcontract-estimates')) return { success: true, estimates: [], subcontractEstimates: [], data: [] };
    if (url.includes('/estimates/summary')) return { success: true, estimates: [], summary: [] };
    if (url.includes('/acct-requisitions/sheets/')) return { success: true, sheet: null, items: [] };
    if (url.includes('/acct-requisitions/sheets')) return { success: true, sheets: [], data: [] };
    if (url.includes('/acct-requisitions/line-items')) return { success: true, lineItems: [], items: [], data: [] };
    if (url.includes('/acct-requisitions/account-sub-titles')) return { success: true, subTitles: [], data: [] };
    if (url.includes('/acct-requisitions/particulars')) return { success: true, particulars: [], data: [] };
    if (url.includes('/acct-requisitions/import-eligible-items')) return { success: true, items: [], data: [] };
    if (url.includes('/acct-requisitions/payment-requisitions')) return { success: true, paymentRequisitions: [], requisitions: [], data: [] };
    if (url.includes('/requisitions/subcontractor-ledger/entries')) return { success: true, entries: [] };
    if (url.includes('/requisitions/subcontractor-ledger/requisitions')) return { success: true, requisitions: [] };
    if (url.includes('/requisitions/subcontractor-ledger')) return { success: true, contractors: [], balances: [], pagination: { page: 1, limit: 15, total: 0, totalPages: 0 } };
    if (url.includes('/excess-fund-returns')) return { success: true, returnRequests: [] };
    if (url.includes('/ra-final-bills')) return { success: true, bills: [], totalCount: 0, pagination: { total: 0, page: 1, limit: 10 } };
    if (url.includes('/estimated-bills/ledger/') || url.includes('/estimated-bills/WO-101')) return { success: true, data: [] };
    if (url.includes('/estimated-bills')) return { success: true, data: [] };
    if (url.includes('/zo-balances/ledger')) return { success: true, ledger: [], pagination: { total: 0, page: 1, limit: 20 } };
    if (url.includes('/zo-balances')) return { success: true, balances: [] };
    
  
  if (url.includes('/reports')) return { success: true, reports: [] };
    
  if (url.includes('/acct-requisitions/credit-ledger')) return { success: true, entries: [] };
    if (url.includes('/acct-requisitions/logs')) return { success: true, logs: [], entries: [], data: { logs: [], entries: [] } };
    if (url.includes('/subcontract-works')) return { success: true, subcontractWorks: [], pagination: { page: 1, totalPages: 0, totalItems: 0 } };
    if (url.includes('/subcontractors')) return { success: true, subcontractors: [], pagination: { page: 1, totalPages: 0, totalItems: 0 } };
    if (url.includes('/user-mappings/eligible-jes')) return { success: true, eligibleJEs: [] };
    if (url.includes('/user-mappings/eligible-zos')) return { success: true, eligibleZOs: [] };
    if (url.includes('/user-mappings')) return { success: true, mappings: [], data: [] };
    if (url.includes('/work-order-mappings')) return { success: true, mappings: [], data: [] };
    if (url.includes('/indian-banks')) return { success: true, indianBanks: [], data: [] };
    if (url.includes('/beneficiary-master')) return { success: true, beneficiaries: [], data: [] };
    if (url.includes('/beneficiaries')) return { success: true, beneficiaries: [], data: [] };
        if (url.includes('/daily-progress')) return { success: true, reports: [], data: [], data: [] };
    if (url.includes('/activity-breaks')) return { success: true, activityBreaks: [], data: [] };
    if (url.includes('/analytics/audit-log')) return { success: true, data: [], totalCount: 0, totalPages: 1 };
    if (url.includes('/analytics/je-leaderboard')) return { success: true, leaderboard: [] };
    if (url.includes('/analytics/projects')) return { success: true, data: [] };
    if (url.includes('/analytics/project/')) return { success: true, data: { overview: {}, budget: {}, materials: [], approvals: [], media: [], audits: [] } };
    if (url.includes('/analytics/ho/kpis')) return { success: true, data: {} };
    if (url.includes('/analytics/ho/')) return { success: true, data: [] };
    if (url.includes('/analytics/zo/')) return { success: true, data: [] };
    if (url.includes('/analytics/recent-activity')) return { success: true, data: [] };
    if (url.includes('/profile')) return { success: true, data: { user: { role: 'admin' }, streak: 5 } };
        if (url.includes('/admin/users')) return { success: true, users: [] };
    if (url.includes('/purchase-data')) return { success: true, options: [], data: [], purchaseOptions: [] };
    if (url.includes('/materials')) return { success: true, materials: [], total: 0, totalPages: 0, data: [] };
    if (url.includes('/projects')) return { success: true, projects: [], data: [] };
    if (url.includes('/requisitions')) return { success: true, requisitions: [], data: [] };
    if (url.includes('/fund-requests')) return { success: true, fundRequests: [], data: [] };
    if (url.includes('/estimates')) return { success: true, estimates: [], data: [] };
    if (url.includes('/ledger')) return { success: true, ledger: [], entries: [] };
    if (url.includes('/users')) return { success: true, users: [] };
    if (url.includes('/sessions')) return { success: true, sessions: [], data: [] };
    return { success: true, data: [] };
  }

  // Populated scenario
  if (url.includes('/admin/users')) return { success: true, users: adminUsersFixture };
  if (url.includes('/purchase-data')) return { success: true, options: purchaseDataFixture, data: purchaseDataFixture, purchaseOptions: purchaseDataFixture };
  if (url.includes('/daily-progress/')) return { success: true, report: dailyProgressReportsFixture[0], data: dailyProgressReportsFixture[0] };
  if (url.includes('/daily-progress')) return { success: true, reports: dailyProgressReportsFixture, data: dailyProgressReportsFixture };
  if (url.includes('/activity-breaks')) return { success: true, activityBreaks: activityBreaksFixture, data: activityBreaksFixture };
  if (url.includes('/analytics/audit-log')) return { success: true, data: auditLogsFixture, totalCount: 1, totalPages: 1 };
  if (url.includes('/analytics/je-leaderboard')) return { success: true, leaderboard: jeLeaderboardFixture };
  if (url.includes('/analytics/projects/dashboard/overview')) return { success: true, data: { activeCount: 5, pendingCount: 2 } };
  if (url.includes('/analytics/projects')) return { success: true, data: projectsHealthFixture };
  if (url.includes('/analytics/project/')) return { success: true, data: digitalTwinDataFixture, ...digitalTwinDataFixture };
  if (url.includes('/analytics/ho/kpis')) return { success: true, data: hoKpisFixture, ...hoKpisFixture };
  if (url.includes('/analytics/ho/zone-benchmarking')) return { success: true, data: [{ zone: 'North', performance_score: 85, budget_utilization_pct: 78, delayed_projects: 1 }] };
  if (url.includes('/analytics/ho/budget-leakage')) return { success: true, data: [] };
  if (url.includes('/analytics/ho/actionable-insights')) return { success: true, data: [] };
  if (url.includes('/analytics/ho/chart-data')) return { success: true, data: { s_curve: [], waterfall: [], recovery: [], departments: [] } };
  if (url.includes('/analytics/ho/resource-utilization')) return { success: true, data: [] };
  if (url.includes('/analytics/ho/approval-sla')) return { success: true, data: [] };
  if (url.includes('/analytics/zo/productivity')) return { success: true, data: [{ je_name: 'Junior Engineer', reports_count: 24, approval_rate: 96 }] };
  if (url.includes('/analytics/recent-activity')) return { success: true, data: [] };
  if (url.includes('/projects/dashboard/overview')) return { success: true, data: { activeCount: 5, pendingCount: 2 } };
  if (url.includes('/profile')) return { success: true, data: { user: { role: 'admin' }, streak: 5 } };
  if (url.includes('/materials/categories')) return { success: true, ...materialCategoriesFixture };
  if (url.includes('/subcontract-estimates/summary')) return { success: true, summary: [] };
  if (url.includes('/subcontract-estimates/init')) return { success: true, activeProjects: projectsFixture, works: [] };
  if (url.includes('/subcontract-estimates/1')) return { success: true, estimate: subcontractEstimatesFixture[0], ...subcontractEstimatesFixture[0] };
  if (url.includes('/subcontract-estimates')) return { success: true, estimates: subcontractEstimatesFixture, subcontractEstimates: subcontractEstimatesFixture, data: subcontractEstimatesFixture };
  if (url.includes('/estimates/summary')) return { success: true, estimates: estimatesFixture, summary: estimatesFixture };
  if (url.includes('/estimates/1')) return { success: true, estimate: estimatesFixture[0], ...estimatesFixture[0] };
  if (url.includes('/acct-requisitions/sheets/1')) return { success: true, sheet: acctSheetDetailFixture, sheetDetail: acctSheetDetailFixture, items: acctSheetDetailFixture.items };
  if (url.includes('/acct-requisitions/sheets')) return { success: true, sheets: [acctSheetDetailFixture], data: [acctSheetDetailFixture] };
  if (url.includes('/acct-requisitions/line-items')) return { success: true, lineItems: acctSheetDetailFixture.items, items: acctSheetDetailFixture.items, data: acctSheetDetailFixture.items };
  if (url.includes('/acct-requisitions/account-sub-titles')) return { success: true, subTitles: acctSubTitlesFixture, data: acctSubTitlesFixture };
  if (url.includes('/acct-requisitions/particulars')) return { success: true, particulars: acctParticularsFixture, data: acctParticularsFixture };
  if (url.includes('/acct-requisitions/import-eligible-items')) return { success: true, items: acctImportEligibleFixture, data: acctImportEligibleFixture };
  if (url.includes('/acct-requisitions/payment-requisitions')) return { success: true, paymentRequisitions: acctPaymentRequisitionsFixture, requisitions: acctPaymentRequisitionsFixture, data: acctPaymentRequisitionsFixture };
  if (url.includes('/requisitions/subcontractor-ledger/entries')) return { success: true, entries: [] };
  if (url.includes('/requisitions/subcontractor-ledger/requisitions')) return { success: true, requisitions: [] };
  if (url.includes('/requisitions/subcontractor-ledger')) return {
    success: true,
    contractors: overrides.subcontractorLedger || [
      {
        subcontractor_id: 'sub-1',
        subcontractor_name: 'Apex Infra Solutions',
        total_approved: 450000,
        total_reserved: 50000,
        total_paid: 200000,
        total_remaining: 200000,
        work_orders: [
          {
            work_order_no: 'WO-101',
            approved_scope: 450000,
            reserved: 50000,
            paid: 200000,
            remaining: 200000
          }
        ]
      }
    ],
    balances: [],
    pagination: { page: 1, limit: 15, total: 1, totalPages: 1 }
  };
  if (url.includes('/excess-fund-returns/target-zos')) return {
    success: true,
    targetZOs: [{ zo_user_id: 'zo-1', full_name: 'Western Zone Office', available_balance: 750000 }]
  };
  if (url.includes('/excess-fund-returns')) return {
    success: true,
    returnRequests: overrides.excessFundReturns || [
      {
        return_request_id: 'efr-1',
        zo_user_id: 'zo-1',
        zo_name: 'Western Zone Office',
        work_order_no: 'WO-101',
        requested_amount: 100000,
        status: 'Pending',
        remarks_ho: 'Excess return required',
        created_at: '2026-08-25T10:00:00Z',
        updated_at: '2026-08-25T10:00:00Z'
      }
    ]
  };
  if (url.includes('/ra-final-bills/work-orders/without-ra-bill')) return { success: true, projects: [] };
  if (url.includes('/ra-final-bills/summary/')) return { success: true, total_billed: 1500000, remaining_balance: 3300000, billing_cap: 4800000 };
  if (url.includes('/ra-final-bills')) return {
    success: true,
    bills: overrides.raFinalBills || [
      {
        bill_id: 'bill-1',
        bill_no: 'RA-001',
        work_order_no: 'WO-101',
        payment_type: 'RA Bill',
        bill_amount: 500000,
        sgst_amount: 45000,
        cgst_amount: 45000,
        igst_amount: 0,
        tds_amount: 10000,
        labor_cess_amount: 5000,
        net_payable_amount: 575000,
        bill_date: '2026-08-15',
        created_at: '2026-08-15T12:00:00Z',
        project_name: 'Substation Expansion'
      }
    ],
    totalCount: 1,
    pagination: { total: 1, page: 1, limit: 10 }
  };
  if (url.includes('/estimated-bills/work-orders')) return {
    success: true,
    workOrders: [{ work_order_no: 'WO-101', project_name: 'Substation Expansion', client_name: 'WBSEDCL' }]
  };
  if (url.includes('/estimated-bills/ledger/') || url.includes('/estimated-bills/WO-101')) return {
    success: true,
    data: overrides.estimatedBillLedger || [
      {
        entry_id: 'eb-1',
        work_order_no: 'WO-101',
        estimated_bill_amount: 1200000,
        disbursed_amount: 900000,
        excess_return_amount: 50000,
        current_net_margin: 250000,
        remarks: 'Initial assessment',
        created_at: '2026-08-01T10:00:00Z',
        created_by_name: 'ZO Officer'
      }
    ]
  };
  if (url.includes('/estimated-bills')) return {
    success: true,
    data: overrides.estimatedBills || [
      {
        work_order_no: 'WO-101',
        project_name: 'Substation Expansion',
        total_estimated: 1200000,
        total_disbursed: 900000,
        total_excess_returns: 50000,
        net_margin: 250000,
        last_updated: '2026-08-20T10:00:00Z'
      }
    ]
  };
  if (url.includes('/zo-balances/ledger')) return {
    success: true,
    ledger: overrides.zonalLedger || [
      {
        ledger_id: 'ledg-1',
        reference_id: 'TXN-901',
        work_order_no: 'WO-101',
        transaction_type: 'Credit',
        amount: 250000,
        balance_after: 500000,
        remarks: 'Fund allocation',
        created_at: '2026-08-15T10:00:00Z'
      }
    ],
    pagination: { total: 1, page: 1, limit: 20 }
  };
  if (url.includes('/zo-balances')) return {
    success: true,
    balances: overrides.zonalBalances || [
      {
        zo_user_id: 'zo-1',
        full_name: 'Western Zone Office',
        available_balance: 750000,
        total_credited: 1500000,
        total_debited: 750000,
        last_updated: '2026-09-01T00:00:00Z'
      }
    ]
  };
  if (url.includes('/reports/admin/deleted')) return { success: true, reports: [] };
  if (url.includes('/acct-requisitions/logs')) return {
    success: true,
    entries: overrides.acctLogs || [
      {
        id: 'log-1',
        action: 'PENDING_HO_REVIEW_FIRST_SUBMIT',
        created_at: '2026-08-01T10:00:00Z',
        line_item: {
          sheet_number: 'SHEET-2026-01',
          account_sub_title_text: 'Material Procurement',
          beneficiary_ac_no: '9876543210',
          amount: 50000
        }
      }
    ],
    pagination: { total: 1, page: 1, limit: 20 }
  };
  if (url.includes('/acct-requisitions/credit-ledger')) return {
    success: true,
    entries: overrides.acctCreditLedger || [
      {
        credit_ledger_id: 'cl-1',
        dealer_name: 'Industrial Spares Ltd', beneficiary: { beneficiary_name: 'Industrial Spares Ltd', account_number: '9876543210' },
        work_order_no: 'WO-101',
        material_details: 'Conduit pipes and brackets',
        opening_balance: 100000,
        paid_amount: 30000,
        remaining_balance: 70000,
        status: 'Open',
        created_at: '2026-08-01T10:00:00Z',
        source: { sheet_number: 'SHEET-2026-01' }
      }
    ]
  };
  if (url.includes('/reports')) return {
    success: true,
    reports: overrides.fundReports || [
      {
        fund_report_id: 'rep-001',
        report_id: 'rep-001',
        work_order_no: 'WO-101',
        amount: 150000,
        remarks: 'Material purchase tranche',
        created_at: '2026-08-10T10:00:00Z',
        project_name: 'Substation Expansion'
      }
    ]
  };
  if (url.includes('/subcontract-works')) return { success: true, subcontractWorks: subcontractWorksFixture, pagination: { page: 1, totalPages: 1, totalItems: subcontractWorksFixture.length } };
  if (url.includes('/subcontractors')) return { success: true, subcontractors: subcontractorsFixture, pagination: { page: 1, totalPages: 1, totalItems: subcontractorsFixture.length } };
  if (url.includes('/user-mappings/eligible-jes')) return { success: true, eligibleJEs: [{ mobile_number: '9876543213', display_name: 'Vikram JE' }] };
  if (url.includes('/user-mappings/eligible-zos')) return { success: true, eligibleZOs: [{ mobile_number: '9876543212', display_name: 'Priya ZO' }] };
  if (url.includes('/user-mappings')) return { success: true, mappings: userMappingsFixture, data: userMappingsFixture };
  if (url.includes('/work-order-mappings')) return { success: true, mappings: workOrderMappingsFixture, data: workOrderMappingsFixture };
  if (url.includes('/indian-banks')) return { success: true, indianBanks: indianBanksFixture, data: indianBanksFixture };
  if (url.includes('/beneficiary-master')) return { success: true, beneficiaries: beneficiariesFixture, data: beneficiariesFixture };
  if (url.includes('/beneficiaries')) return { success: true, beneficiaries: beneficiariesFixture, data: beneficiariesFixture };
  if (url.includes('/materials')) return { success: true, materials: materialsFixture, total: materialsFixture.length, totalPages: 1 };
  if (url.includes('/projects')) return { success: true, projects: projectsFixture, data: projectsFixture };
  if (url.includes('/requisitions')) return { success: true, requisitions: requisitionsFixture, data: requisitionsFixture };
  if (url.includes('/fund-requests')) return { success: true, fundRequests: fundRequestsFixture, data: fundRequestsFixture };
  if (url.includes('/estimates')) return { success: true, estimates: estimatesFixture, data: estimatesFixture };
  if (url.includes('/ledger')) return { success: true, ledger: ledgerEntriesFixture, entries: ledgerEntriesFixture };
  if (url.includes('/bank-balances')) return { success: true, data: bankBalancesFixture, bankBalances: overrides.bankBalances !== undefined ? overrides.bankBalances : bankBalancesFixture };
  if (url.includes('/acct-requisitions')) return { success: true, data: accountsSheetsFixture };
  if (url.includes('/users')) return { success: true, users: Object.values(usersFixture) };
  if (url.includes('/sessions')) return { success: true, sessions: [], data: [] };

  return { success: true, data: [] };
}

/**
 * Creates a configured mock authApi instance matching a scenario.
 */

// Domain 4 Fixtures
export const dailyProgressReportsFixture = [
  {
    report_id: 'dpr-1',
    work_order_no: 'WO-101',
    report_date: '2026-09-01',
    work_done_details: 'Conduit laying and foundation curing completed.',
    daily_site_photo_url: 'https://example.com/site1.jpg',
    site_visit_date: '2026-09-01',
    created_at: '2026-09-01T17:00:00Z',
    author_name: 'Junior Engineer',
    author_role: 'je',
    authority_remarks: []
  }
];

export const activityBreaksFixture = [
  {
    break_id: 'brk-1',
    work_order_no: 'WO-101',
    start_date: '2026-09-05',
    end_date: null,
    reason: 'Heavy monsoon downpour hindering outdoor masonry work.',
    status: 'Pending ZO Review',
    created_at: '2026-09-05T08:00:00Z',
    requested_by: 'usr_je',
    requester_name: 'Junior Engineer'
  }
];

export const auditLogsFixture = [
  {
    id: 'aud-1',
    action: 'UPDATE_RECORD',
    user_id: 'usr_admin',
    user_name: 'Super Admin',
    module_name: 'Daily Work Progress',
    record_identifier: 'dpr-1',
    details: 'Status flag adjusted',
    ip_address: '127.0.0.1',
    created_at: '2026-09-02T10:00:00Z'
  }
];

export const jeLeaderboardFixture = [
  {
    user_id: 'usr_je',
    display_name: 'Junior Engineer',
    mobile_number: '+919876543213',
    score: 95,
    rank: 1,
    streak: 12,
    total_reports: 48,
    active_projects_count: 2
  },
  {
    user_id: 'usr_je_2',
    display_name: 'Rohan Sharma',
    mobile_number: '+919876543219',
    score: 88,
    rank: 2,
    streak: 8,
    total_reports: 36,
    active_projects_count: 1
  }
];

export const digitalTwinDataFixture = {
  overview: {
    work_order_no: 'WO-101',
    site_details: 'Substation Alpha, North District',
    work_order_value: 5000000,
    status: 'Running',
    estimate_id: 'EST-101',
    zone: 'North',
    client_name: 'WBSEDCL'
  },
  budget: {
    work_order_value: 5000000,
    approved_requisitions_amount: 3200000,
    budget_variance_pct: 64,
    estimated_bill_amount: 3500000
  },
  materials: [
    { material_name: 'Cement OPC 53', total_estimated_qty: 500, consumed_qty: 320, unit: 'Bags' }
  ],
  approvals: [
    { type: 'Technical Approval', status: 'Approved', approved_by: 'Zonal Officer' }
  ],
  media: [
    { daily_site_photo_url: 'https://example.com/site1.jpg', site_visit_date: '2026-09-01' }
  ],
  audits: []
};

export const projectsHealthFixture = [
  {
    work_order_no: 'WO-101',
    site_details: 'Substation Alpha, North District',
    district: 'North 24 Parganas',
    zone: 'North',
    health_status: 'Healthy',
    physical_progress: 65,
    financial_progress: 58,
    total_value: 5000000,
    active_alerts: 0
  }
];

export const hoKpisFixture = {
  active_projects: 12,
  delayed_projects: 2,
  total_portfolio_value: 65000000,
  disbursed_funds: 34000000,
  leakage_risk_count: 1
};


// Domain 5 Fixtures
export const adminUsersFixture = [
  {
    id: 'usr-1',
    mobile_number: '+919876543210',
    display_name: 'Super Admin',
    role: 'admin',
    is_active: true,
    telegram_chat_id: '123456789',
    created_at: '2026-08-01T00:00:00Z'
  },
  {
    id: 'usr-2',
    mobile_number: '+919876543213',
    display_name: 'Junior Engineer',
    role: 'je',
    is_active: true,
    telegram_chat_id: null,
    created_at: '2026-08-05T00:00:00Z'
  }
];

export const purchaseDataFixture = [
  {
    id: 'po-1',
    name: 'Standard Cash Purchase',
    description: 'Immediate cash purchase from local hardware supplier',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z'
  },
  {
    id: 'po-2',
    name: 'Credit Note Procurement',
    description: 'Procurement processed via vendor credit ledger',
    is_active: true,
    created_at: '2026-08-05T00:00:00Z'
  }
];

export function createMockAuthApi({
  scenario = 'populated',
  role = 'admin',
  user = null,
  overrides = {},
  errorMessage = 'API Error occurred'
} = {}) {
  const activeUser = user || usersFixture[role] || usersFixture.admin;

  const getHandler = (url) => {
    if (url === '/me') {
      if (scenario === 'unauthenticated') {
        return Promise.resolve({ data: { success: false, user: null } });
      }
      return Promise.resolve({ data: { success: true, user: activeUser } });
    }

    if (scenario === 'loading') {
      return new Promise(() => {}); // Intentionally pending
    }

    if (scenario === 'apiError') {
      const err = new Error(errorMessage);
      err.response = { status: 500, data: { success: false, message: errorMessage } };
      return Promise.reject(err);
    }

    const payload = getScenarioPayload(url, scenario, overrides);
    return Promise.resolve({ data: payload });
  };

  const postHandler = (url, body) => {
    if (url === '/logout') {
      return Promise.resolve({ data: { success: true } });
    }
    if (scenario === 'apiError') {
      return Promise.reject({
        response: { status: 500, data: { success: false, message: errorMessage } }
      });
    }
    return Promise.resolve({ data: { success: true, id: 'new-id', ...body } });
  };

  return {
    get: vi.fn().mockImplementation(getHandler),
    post: vi.fn().mockImplementation(postHandler),
    put: vi.fn().mockImplementation(postHandler),
    patch: vi.fn().mockImplementation(postHandler),
    delete: vi.fn().mockImplementation(postHandler),
    interceptors: {
      response: { use: vi.fn() }
    }
  };
}

/**
 * Safely installs scenario handlers onto an authApi instance regardless of whether
 * it has already been mocked with vi.mock() or is a raw Axios instance.
 */
export function mockApiScenario(authApiTarget, options = {}) {
  const mockInstance = createMockAuthApi(options);
  if (!authApiTarget) return mockInstance;

  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  for (const method of methods) {
    if (authApiTarget[method] && typeof authApiTarget[method].mockImplementation === 'function') {
      authApiTarget[method].mockImplementation(mockInstance[method]);
    } else {
      authApiTarget[method] = vi.fn().mockImplementation(mockInstance[method]);
    }
  }

  if (!authApiTarget.interceptors) {
    authApiTarget.interceptors = { response: { use: vi.fn() } };
  }

  return mockInstance;
}
