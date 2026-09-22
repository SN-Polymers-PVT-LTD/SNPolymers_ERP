import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import {
  usersFixture,
  projectsFixture,
  requisitionsFixture,
  estimatesFixture,
  fundRequestsFixture,
  ledgerEntriesFixture,
  bankBalancesFixture,
  createMockAuthApi,
  mockApiScenario,
  renderPage,
  assertUrlState,
  assertCanonicalUrl,
  describePageContract
} from '../index';
import authApi from '../../api/authApi';

// Mock authApi globally for testing harness
vi.mock('../../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { response: { use: vi.fn() } }
  }
}));

describe('Shared Test Infrastructure Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Domain Fixtures', () => {
    it('provides complete, valid user persona fixtures for all roles', () => {
      expect(usersFixture.admin.role).toBe('admin');
      expect(usersFixture.ho.role).toBe('ho');
      expect(usersFixture.zo.role).toBe('zo');
      expect(usersFixture.je.role).toBe('je');
      expect(usersFixture.accounts.role).toBe('accounts');
    });

    it('provides valid project fixtures with assigned JEs and progress metrics', () => {
      expect(projectsFixture.length).toBeGreaterThanOrEqual(3);
      const wo1 = projectsFixture[0];
      expect(wo1.work_order_no).toBe('WO-101');
      expect(wo1.status).toBe('Running');
      expect(wo1.physical_progress).toBe(45);
    });

    it('provides valid estimate, requisition, fund request, and ledger fixtures', () => {
      expect(estimatesFixture.length).toBeGreaterThanOrEqual(2);
      expect(requisitionsFixture.length).toBeGreaterThanOrEqual(2);
      expect(fundRequestsFixture.length).toBeGreaterThanOrEqual(2);
      expect(ledgerEntriesFixture.length).toBeGreaterThanOrEqual(2);
      expect(bankBalancesFixture.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Mock API Scenario Engine', () => {
    it('resolves populated domain fixtures under populated scenario', async () => {
      const mockClient = createMockAuthApi({ scenario: 'populated' });
      const meRes = await mockClient.get('/me');
      const projRes = await mockClient.get('/projects');
      const reqRes = await mockClient.get('/requisitions');

      expect(meRes.data.success).toBe(true);
      expect(meRes.data.user.role).toBe('admin');
      expect(projRes.data.projects.length).toBe(projectsFixture.length);
      expect(reqRes.data.requisitions.length).toBe(requisitionsFixture.length);
    });

    it('resolves empty arrays under empty scenario', async () => {
      const mockClient = createMockAuthApi({ scenario: 'empty' });
      const projRes = await mockClient.get('/projects');
      const reqRes = await mockClient.get('/requisitions');

      expect(projRes.data.projects).toEqual([]);
      expect(reqRes.data.requisitions).toEqual([]);
    });

    it('rejects with HTTP 500 error under apiError scenario', async () => {
      const mockClient = createMockAuthApi({ scenario: 'apiError', errorMessage: 'Database connection failed' });
      await expect(mockClient.get('/projects')).rejects.toMatchObject({
        response: { status: 500 },
        message: 'Database connection failed'
      });
    });

    it('respects targeted endpoint overrides', async () => {
      const customProject = [{ work_order_no: 'CUSTOM-999', status: 'Running' }];
      const mockClient = createMockAuthApi({
        scenario: 'populated',
        overrides: {
          '/projects': { success: true, projects: customProject }
        }
      });

      const res = await mockClient.get('/projects');
      expect(res.data.projects).toEqual(customProject);
    });
  });

  describe('renderPage and URL Assertions', () => {
    const TestComponent = () => {
      return (
        <div>
          <h1>Operational Dashboard</h1>
          <p>Active System Status: Nominal</p>
        </div>
      );
    };

    it('renders component wrapped in all application providers and asserts URL state', () => {
      const { readLocation } = renderPage(<TestComponent />, {
        initialUrl: '/test-route?status=active&page=2'
      });

      expect(screen.getByText('Operational Dashboard')).toBeInTheDocument();
      expect(readLocation()).toBe('/test-route?status=active&page=2');

      // Successful assertions
      assertUrlState({ status: 'active', page: '2' });
      assertUrlState({ missingParam: undefined });
      assertCanonicalUrl('/test-route?status=active&page=2');
    });

    it('throws descriptive errors on failed URL state assertions', () => {
      renderPage(<TestComponent />, {
        initialUrl: '/test-route?status=active'
      });

      expect(() => assertUrlState({ status: 'inactive' })).toThrow(/Expected URL param "status"/);
      expect(() => assertUrlState({ status: undefined })).toThrow(/to be absent/);
      expect(() => assertCanonicalUrl('/wrong-route')).toThrow(/Expected canonical URL/);
    });
  });
});

// Test the declarative Page Contract Runner on a sample mock page
const SampleOperationalPage = ({ error, empty }) => {
  if (error) return <div role="alert">Unable to load operational data</div>;
  if (empty) return <div>No matching records found in system</div>;
  return (
    <div>
      <h1>Sample Requisitions Console</h1>
      <p>Loaded 10 active items</p>
    </div>
  );
};

// When testing a real route via describePageContract, expectDom validates the mounted DOM
describePageContract(SampleOperationalPage, {
  name: 'SampleOperationalPage',
  route: '/requisitions',
  allowedRoles: ['je', 'admin'],
  unauthorizedRole: 'accounts',
  headingMatch: /Sample Requisitions Console/i,
  expectDom: async (screen) => {
    // Proves that the actual page mounted under the App route (/requisitions mounts Requisition Management)
    expect(await screen.findByRole('heading', { name: /Requisition Management/i })).toBeInTheDocument();
  }
});
