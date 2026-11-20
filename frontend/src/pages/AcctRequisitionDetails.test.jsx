import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('AcctRequisitionDetails URL State, Aliases & Reset', () => {
  it('hydrates legacy aliases (beneficiary_ac_no, work_order_no) and writes canonical parameters', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: { acctSheetDetail: acctSheetDetailFixture }
    });

    const { readLocation } = renderPage(<AcctRequisitionDetails />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/details?beneficiary_ac_no=987654321&page=3',
      routePath: '/acct-requisitions/details',
      overrides: { acctSheetDetail: acctSheetDetailFixture }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Requisition Details/i })).toBeInTheDocument();
    });

    const acInput = screen.getByPlaceholderText('Enter account number...');
    expect(acInput).toHaveValue('987654321');

    fireEvent.change(acInput, { target: { value: '1122334455' } });

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('beneficiary_ac=1122334455');
      expect(loc).not.toContain('beneficiary_ac_no=');
      expect(loc).not.toContain('page=3');
    });
  });

  it('reset filters button removes managed filter keys while preserving bookmark parameters', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: { acctSheetDetail: acctSheetDetailFixture }
    });

    const { readLocation } = renderPage(<AcctRequisitionDetails />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/details?beneficiary_ac=987654321&source=bookmark',
      routePath: '/acct-requisitions/details',
      overrides: { acctSheetDetail: acctSheetDetailFixture }
    });

    const resetBtn = await screen.findByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('beneficiary_ac=');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid filter payloads safely without crashing', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: { acctSheetDetail: { ...acctSheetDetailFixture, items: [] } }
    });

    renderPage(<AcctRequisitionDetails />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/details?page=-99&status=UNKNOWN',
      routePath: '/acct-requisitions/details',
      overrides: { acctSheetDetail: { ...acctSheetDetailFixture, items: [] } }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Requisition Details/i })).toBeInTheDocument();
    });
  });
});
