import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import ZonalBalances from './ZonalBalances';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
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

describe('ZonalBalances Page', () => {
  describePageContract({
    title: 'ZonalBalances Page Contract',
    pageName: 'ZonalBalances',
    PageUnderContract: ZonalBalances,
    route: '/zonal-balances',
    routePath: '/zonal-balances',
    requiredRole: 'zo',
    headingText: 'Zonal Office Credit Control',
    emptyScenarioText: 'No balances configured.',
    actionControlText: 'Refresh',
    initialScenario: {
      zonalBalances: [
        {
          zo_user_id: 'zo-1',
          full_name: 'Western Zone Office',
          available_balance: 750000,
          total_credited: 1500000,
          total_debited: 750000,
          last_updated: '2026-09-01T00:00:00Z'
        }
      ]
    },
    emptyScenario: {
      zonalBalances: []
    }
  });

  it('renders available balances and transaction ledger section', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: {
        zonalBalances: [
          {
            zo_user_id: 'zo-1',
            full_name: 'Western Zone Office',
            available_balance: 750000,
            total_credited: 1500000,
            total_debited: 750000,
            last_updated: '2026-09-01T00:00:00Z'
          }
        ]
      }
    });

    renderPage(<ZonalBalances />, {
      role: 'zo',
      initialUrl: '/zonal-balances',
      routePath: '/zonal-balances',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Zonal Office Credit Control/i })).toBeInTheDocument();
    });

    expect(screen.getByText('Available Zonal Balances')).toBeInTheDocument();
    expect(screen.getByText('Transaction Ledger Logs')).toBeInTheDocument();
  });
});
