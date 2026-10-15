import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AcctImportEligibleItems from './AcctImportEligibleItems';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import { acctImportEligibleFixture } from '../test/fixtures/domainFixtures';
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

describe('AcctImportEligibleItems Page', () => {
  describePageContract({
    title: 'AcctImportEligibleItems Page Contract',
    pageName: 'AcctImportEligibleItems',
    PageUnderContract: AcctImportEligibleItems,
    route: '/acct-requisitions/import-eligible-items',
    routePath: '/acct-requisitions/import-eligible-items',
    requiredRole: 'accounts',
    headingText: 'Held / Rejected / Pending Review Items',
    emptyScenarioText: 'No On Hold, Rejected, or Pending Review items are waiting to be imported.',
    actionControlText: 'Back to Sheets',
    initialScenario: {
      acctImportEligible: acctImportEligibleFixture,
    },
    emptyScenario: {
      acctImportEligible: [],
    },
  });

  it('renders filter bar and back navigation', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctImportEligible: acctImportEligibleFixture,
      }
    });

    renderPage(<AcctImportEligibleItems />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/import-eligible-items',
      routePath: '/acct-requisitions/import-eligible-items',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Held \/ Rejected \/ Pending Review Items/i })).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Sheets')).toBeInTheDocument();
  });
});
