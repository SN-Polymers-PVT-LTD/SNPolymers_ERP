import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('AcctHoQueue URL State, Aliases & Filters', () => {
  it('hydrates legacy sheet_number and date_from aliases, and writes canonical parameters', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'ho',
      overrides: { acctSheets: acctSheetsFixture }
    });

    const { readLocation } = renderPage(<AcctHoQueue />, {
      role: 'ho',
      initialUrl: '/acct-requisitions/ho-queue?sheet_number=SHEET-01&page=3',
      routePath: '/acct-requisitions/ho-queue',
      overrides: { acctSheets: acctSheetsFixture }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /HO Approval Queue/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Enter req. no...');
    expect(searchInput).toHaveValue('SHEET-01');

    fireEvent.change(searchInput, { target: { value: 'SHEET-99' } });

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('q=SHEET-99');
      expect(loc).not.toContain('sheet_number=');
      expect(loc).not.toContain('page=3');
    });
  });

  it('reset filters button removes managed filters while preserving unrelated parameters', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'ho',
      overrides: { acctSheets: acctSheetsFixture }
    });

    const { readLocation } = renderPage(<AcctHoQueue />, {
      role: 'ho',
      initialUrl: '/acct-requisitions/ho-queue?q=SHEET-01&from=2026-09-01&source=bookmark',
      routePath: '/acct-requisitions/ho-queue',
      overrides: { acctSheets: acctSheetsFixture }
    });

    const resetBtn = await screen.findByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('q=SHEET-01');
      expect(loc).not.toContain('from=2026-09-01');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid status or page numbers safely without crashing', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'ho',
      overrides: { acctSheets: [] }
    });

    renderPage(<AcctHoQueue />, {
      role: 'ho',
      initialUrl: '/acct-requisitions/ho-queue?status=INVALID&page=-99',
      routePath: '/acct-requisitions/ho-queue',
      overrides: { acctSheets: [] }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /HO Approval Queue/i })).toBeInTheDocument();
    });
  });
});
