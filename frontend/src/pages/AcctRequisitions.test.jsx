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

describe('AcctRequisitions URL State, Aliases & Reset', () => {
  it('hydrates legacy sheet_number alias and updates canonical q while resetting page', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: { acctSheets: acctSheetsFixture }
    });

    const { readLocation } = renderPage(<AcctRequisitions />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions?sheet_number=SHEET-100&page=4',
      routePath: '/acct-requisitions',
      overrides: { acctSheets: acctSheetsFixture }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Requisition Sheets/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Enter req\. no\.\.\./i);
    expect(searchInput).toHaveValue('SHEET-100');

    fireEvent.change(searchInput, { target: { value: 'SHEET-200' } });

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('q=SHEET-200');
      expect(loc).not.toContain('sheet_number=');
      expect(loc).not.toContain('page=4');
    });
  });

  it('reset filters button removes managed filter keys while preserving bookmark parameters', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: { acctSheets: acctSheetsFixture }
    });

    const { readLocation } = renderPage(<AcctRequisitions />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions?q=SHEET-100&from=2026-09-01&source=bookmark',
      routePath: '/acct-requisitions',
      overrides: { acctSheets: acctSheetsFixture }
    });

    const resetBtn = await screen.findByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('q=SHEET-100');
      expect(loc).not.toContain('from=2026-09-01');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid status and page number gracefully without crashing', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts'
    });

    renderPage(<AcctRequisitions />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions?status=NON_EXISTENT&page=-10',
      routePath: '/acct-requisitions'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Requisition Sheets/i })).toBeInTheDocument();
      expect(screen.getByText('SHEET-2026-01')).toBeInTheDocument();
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
