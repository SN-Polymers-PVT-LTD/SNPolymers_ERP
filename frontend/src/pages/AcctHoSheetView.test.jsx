import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AcctHoSheetView from './AcctHoSheetView';
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

describe('AcctHoSheetView Page', () => {
  describePageContract({
    title: 'AcctHoSheetView Page Contract',
    pageName: 'AcctHoSheetView',
    PageUnderContract: AcctHoSheetView,
    route: '/acct-requisitions/ho-queue/sheets/1',
    routePath: '/acct-requisitions/ho-queue/sheets/:id',
    requiredRole: 'ho',
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

  it('renders line items and back navigation', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'ho',
      overrides: {
        acctSheetDetail: acctSheetDetailFixture,
      }
    });

    renderPage(<AcctHoSheetView />, {
      role: 'ho',
      initialUrl: '/acct-requisitions/ho-queue/sheets/1',
      routePath: '/acct-requisitions/ho-queue/sheets/:id',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /SHEET-2026-01/i })).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Queue')).toBeInTheDocument();
  });
});
