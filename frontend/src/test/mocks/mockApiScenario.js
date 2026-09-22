import { vi } from 'vitest';
import {
  usersFixture,
  projectsFixture,
  estimatesFixture,
  requisitionsFixture,
  fundRequestsFixture,
  accountsSheetsFixture,
  ledgerEntriesFixture,
  bankBalancesFixture
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
      return Promise.reject({
        response: { status: 500, data: { success: false, message: errorMessage } },
        message: errorMessage
      });
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
 * Configures the default authApi mock module with a scenario.
 */
export function mockApiScenario(authApiMock, options = {}) {
  const mockInstance = createMockAuthApi(options);
  if (authApiMock) {
    if (authApiMock.get?.mockImplementation) authApiMock.get.mockImplementation(mockInstance.get);
    if (authApiMock.post?.mockImplementation) authApiMock.post.mockImplementation(mockInstance.post);
    if (authApiMock.put?.mockImplementation) authApiMock.put.mockImplementation(mockInstance.put);
    if (authApiMock.patch?.mockImplementation) authApiMock.patch.mockImplementation(mockInstance.patch);
    if (authApiMock.delete?.mockImplementation) authApiMock.delete.mockImplementation(mockInstance.delete);
  }
  return mockInstance;
}
