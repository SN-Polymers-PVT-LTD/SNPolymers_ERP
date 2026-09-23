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
  if (url.includes('/reports')) return { success: true, reports: [] };
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
