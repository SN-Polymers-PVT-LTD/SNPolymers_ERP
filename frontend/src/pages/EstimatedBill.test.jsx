import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import EstimatedBill from './EstimatedBill';
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

describe('EstimatedBill Page', () => {
  describePageContract({
    title: 'EstimatedBill Page Contract',
    pageName: 'EstimatedBill',
    PageUnderContract: EstimatedBill,
    route: '/estimated-bills',
    routePath: '/estimated-bills',
    requiredRole: 'zo',
    headingText: 'Estimated Bill Module',
    emptyScenarioText: 'No Estimated Bills Recorded',
    actionControlText: 'New Estimate',
    initialScenario: {
      estimatedBills: [
        {
          work_order_no: 'WO-101',
          project_name: 'Substation Expansion',
          total_estimated: 1200000,
          total_disbursed: 900000,
          total_excess_returns: 50000,
          net_margin: 250000,
          last_updated: '2026-08-20T10:00:00Z'
        }
      ]
    },
    emptyScenario: {
      estimatedBills: []
    }
  });

  it('renders estimated bills table and action button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: {
        estimatedBills: [
          {
            work_order_no: 'WO-101',
            project_name: 'Substation Expansion',
            total_estimated: 1200000,
            total_disbursed: 900000,
            total_excess_returns: 50000,
            net_margin: 250000,
            last_updated: '2026-08-20T10:00:00Z'
          }
        ]
      }
    });

    renderPage(<EstimatedBill />, {
      role: 'zo',
      initialUrl: '/estimated-bills',
      routePath: '/estimated-bills',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Estimated Bill Module/i })).toBeInTheDocument();
    });

    expect(screen.getByText('New Estimate')).toBeInTheDocument();
  });
});
