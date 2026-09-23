import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AcctRequisitions from './AcctRequisitions';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import { acctSheetsFixture } from '../test/fixtures/domainFixtures';
import authApi from '../api/authApi';

vi.mock('../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { response: { use: vi.fn() } }
  }
}));

describe('AcctRequisitions Page', () => {
  describePageContract({
    title: 'AcctRequisitions Page Contract',
    pageName: 'AcctRequisitions',
    PageUnderContract: AcctRequisitions,
    route: '/acct-requisitions',
    routePath: '/acct-requisitions',
    requiredRole: 'accounts',
    headingText: 'Requisition Sheets',
    emptyScenarioText: 'No matching requisition sheets found.',
    actionControlText: 'New Sheet',
    initialScenario: {
      acctSheets: acctSheetsFixture,
    },
    emptyScenario: {
      acctSheets: [],
    },
  });

  it('allows searching requisition sheets', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctSheets: acctSheetsFixture,
      }
    });

    renderPage(<AcctRequisitions />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions',
      routePath: '/acct-requisitions',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Requisition Sheets/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Enter req\. no\.\.\./i);
    expect(searchInput).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: 'REQ-SHEET-001' } });
    expect(searchInput.value).toBe('REQ-SHEET-001');
  });
});
