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

describe('EstimatedBill URL State, Aliases, Modals & Filters', () => {
  const testEstimatedBills = [
    {
      work_order_no: 'WO-101',
      project_name: 'Substation Expansion',
      total_estimated: 1200000,
      total_disbursed: 900000,
      total_excess_returns: 50000,
      net_margin: 250000,
      last_updated: '2026-08-20T10:00:00Z'
    }
  ];

  it('hydrates legacy aliases (work_order_no, min_surety) and writes canonical parameters', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { estimatedBills: testEstimatedBills }
    });

    const { readLocation } = renderPage(<EstimatedBill />, {
      role: 'zo',
      initialUrl: '/estimated-bills?work_order_no=WO-101&min_surety=75',
      routePath: '/estimated-bills',
      overrides: { estimatedBills: testEstimatedBills }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Estimated Bill Module/i })).toBeInTheDocument();
    });

    // Toggle status or surety
    const statusSelect = screen.getByDisplayValue(/Running \(Active\)/i);
    fireEvent.change(statusSelect, { target: { value: 'Closed' } });

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('status=Closed');
      expect(loc).toContain('wo=WO-101');
      expect(loc).toContain('surety=75');
      expect(loc).not.toContain('work_order_no=');
      expect(loc).not.toContain('min_surety=');
    });
  });

  it('preserves active filters and unrelated parameters when opening and closing modal', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { estimatedBills: testEstimatedBills }
    });

    const { readLocation } = renderPage(<EstimatedBill />, {
      role: 'zo',
      initialUrl: '/estimated-bills?wo=WO-101&surety=75&source=bookmark&modal=new&modal_wo=WO-101',
      routePath: '/estimated-bills',
      overrides: { estimatedBills: testEstimatedBills }
    });

    const closeBtn = await screen.findByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=new');
      expect(loc).not.toContain('modal_wo=');
      expect(loc).toContain('wo=WO-101');
      expect(loc).toContain('surety=75');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('clear filters button removes managed filters while preserving unrelated query params', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { estimatedBills: testEstimatedBills }
    });

    const { readLocation } = renderPage(<EstimatedBill />, {
      role: 'zo',
      initialUrl: '/estimated-bills?wo=WO-101&surety=75&source=bookmark',
      routePath: '/estimated-bills',
      overrides: { estimatedBills: testEstimatedBills }
    });

    const clearBtn = await screen.findByRole('button', { name: /Clear Filters/i });
    fireEvent.click(clearBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('wo=WO-101');
      expect(loc).not.toContain('surety=75');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid modal parameters and malformed inputs safely without crashing', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { estimatedBills: testEstimatedBills }
    });

    renderPage(<EstimatedBill />, {
      role: 'zo',
      initialUrl: '/estimated-bills?modal=invalid_modal&surety=non_numeric&status=unknown',
      routePath: '/estimated-bills',
      overrides: { estimatedBills: testEstimatedBills }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Estimated Bill Module/i })).toBeInTheDocument();
    });
  });
});
