import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AcctRequisitionSheetView from './AcctRequisitionSheetView';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import { acctSheetDetailFixture } from '../test/fixtures/domainFixtures';
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

describe('AcctRequisitionSheetView Page', () => {
  describePageContract({
    title: 'AcctRequisitionSheetView Page Contract',
    pageName: 'AcctRequisitionSheetView',
    PageUnderContract: AcctRequisitionSheetView,
    route: '/acct-requisitions/sheets/1',
    routePath: '/acct-requisitions/sheets/:id',
    requiredRole: 'accounts',
    headingText: 'SHEET-2026-01',
    emptyScenarioText: 'Requisition sheet not found.',
    actionControlText: 'Manage Bank Balances',
    initialScenario: {
      acctSheetDetail: acctSheetDetailFixture,
    },
    emptyScenario: {
      acctSheetDetail: null,
    },
  });

  it('renders line items and back button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctSheetDetail: acctSheetDetailFixture,
      }
    });

    renderPage(<AcctRequisitionSheetView />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/sheets/1',
      routePath: '/acct-requisitions/sheets/:id',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Sheets')).toBeInTheDocument();
  });
});
