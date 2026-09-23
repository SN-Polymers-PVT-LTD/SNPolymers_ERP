import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ExcessFundReturns from './ExcessFundReturns';
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

describe('ExcessFundReturns Page', () => {
  describePageContract({
    title: 'ExcessFundReturns Page Contract',
    pageName: 'ExcessFundReturns',
    PageUnderContract: ExcessFundReturns,
    route: '/excess-fund-returns',
    routePath: '/excess-fund-returns',
    requiredRole: 'zo',
    headingText: 'Excess Fund Returns',
    emptyScenarioText: 'No excess fund return requests found.',
    actionControlText: 'Status',
    initialScenario: {
      excessFundReturns: [
        {
          return_request_id: 'efr-1',
          zo_user_id: 'zo-1',
          zo_name: 'Western Zone Office',
          work_order_no: 'WO-101',
          requested_amount: 100000,
          status: 'Pending',
          remarks_ho: 'Excess return required',
          created_at: '2026-08-25T10:00:00Z',
          updated_at: '2026-08-25T10:00:00Z'
        }
      ]
    },
    emptyScenario: {
      excessFundReturns: []
    }
  });

  it('renders request fund return button for admin/ho role', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'admin',
      overrides: {
        excessFundReturns: [
          {
            return_request_id: 'efr-1',
            zo_user_id: 'zo-1',
            zo_name: 'Western Zone Office',
            work_order_no: 'WO-101',
            requested_amount: 100000,
            status: 'Pending',
            remarks_ho: 'Excess return required',
            created_at: '2026-08-25T10:00:00Z',
            updated_at: '2026-08-25T10:00:00Z'
          }
        ]
      }
    });

    renderPage(<ExcessFundReturns />, {
      role: 'admin',
      initialUrl: '/excess-fund-returns',
      routePath: '/excess-fund-returns',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Excess Fund Returns/i })).toBeInTheDocument();
    });

    expect(screen.getByText('Request Fund Return')).toBeInTheDocument();
  });
});
