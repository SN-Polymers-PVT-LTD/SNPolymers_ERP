import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AcctHoQueue from './AcctHoQueue';
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

describe('AcctHoQueue Page', () => {
  describePageContract({
    title: 'AcctHoQueue Page Contract',
    pageName: 'AcctHoQueue',
    PageUnderContract: AcctHoQueue,
    route: '/acct-requisitions/ho-queue',
    routePath: '/acct-requisitions/ho-queue',
    requiredRole: 'ho',
    headingText: 'HO Approval Queue',
    emptyScenarioText: 'No submitted sheets pending review.',
    actionControlText: 'View Bank Balances',
    initialScenario: {
      acctSheets: acctSheetsFixture,
    },
    emptyScenario: {
      acctSheets: [],
    },
  });

  it('renders queue tabs and bank balance button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'ho',
      overrides: {
        acctSheets: acctSheetsFixture,
      }
    });

    renderPage(<AcctHoQueue />, {
      role: 'ho',
      initialUrl: '/acct-requisitions/ho-queue',
      routePath: '/acct-requisitions/ho-queue',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /HO Approval Queue/i })).toBeInTheDocument();
    });

    expect(screen.getByText('View Bank Balances')).toBeInTheDocument();
  });
});
