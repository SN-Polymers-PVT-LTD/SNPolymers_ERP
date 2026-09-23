import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AcctRequisitionDetails from './AcctRequisitionDetails';
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

describe('AcctRequisitionDetails Page', () => {
  describePageContract({
    title: 'AcctRequisitionDetails Page Contract',
    pageName: 'AcctRequisitionDetails',
    PageUnderContract: AcctRequisitionDetails,
    route: '/acct-requisitions/details',
    routePath: '/acct-requisitions/details',
    requiredRole: 'accounts',
    headingText: 'Requisition Details',
    emptyScenarioText: 'No matching requisition details found.',
    actionControlText: 'Export to Excel',
    initialScenario: {
      acctSheetDetail: acctSheetDetailFixture,
    },
    emptyScenario: {
      acctSheetDetail: { ...acctSheetDetailFixture, items: [] },
    },
  });

  it('renders filter controls and back button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctSheetDetail: acctSheetDetailFixture,
      }
    });

    renderPage(<AcctRequisitionDetails />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/details',
      routePath: '/acct-requisitions/details',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Requisition Details/i })).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Sheets')).toBeInTheDocument();
    expect(screen.getByText('Export to Excel')).toBeInTheDocument();
  });
});
