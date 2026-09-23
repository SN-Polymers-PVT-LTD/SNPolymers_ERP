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
  if (url.includes('/bank-balances')) return { success: true, data: bankBalancesFixture };
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
