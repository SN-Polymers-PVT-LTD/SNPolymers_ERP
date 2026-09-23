import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import SubcontractorLedger from './SubcontractorLedger';
import {
  renderPage,
  describePageContract,
  mockApiScenario,
  withFakeTimers
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

describe('SubcontractorLedger Page', () => {
  describePageContract({
    title: 'SubcontractorLedger Page Contract',
    pageName: 'SubcontractorLedger',
    PageUnderContract: SubcontractorLedger,
    route: '/subcontractor-ledger',
    routePath: '/subcontractor-ledger',
    requiredRole: 'je',
    headingText: 'Subcontractor Ledger',
    emptyScenarioText: 'No subcontractor ledger records found.',
    actionControlText: 'Back to Requisitions',
    initialScenario: {
      subcontractorLedger: [
        {
          subcontractor_id: 'sub-1',
          subcontractor_name: 'Apex Infra Solutions',
          total_approved: 450000,
          total_reserved: 50000,
          total_paid: 200000,
          total_remaining: 200000,
          work_orders: [
            {
              work_order_no: 'WO-101',
              approved_scope: 450000,
              reserved: 50000,
              paid: 200000,
              remaining: 200000
            }
          ]
        }
      ]
    },
    emptyScenario: {
      subcontractorLedger: []
    }
  });

  it('renders contractor summary card and navigations', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'je',
      overrides: {
        subcontractorLedger: [
          {
            subcontractor_id: 'sub-1',
            subcontractor_name: 'Apex Infra Solutions',
            total_approved: 450000,
            total_reserved: 50000,
            total_paid: 200000,
            total_remaining: 200000,
            work_orders: [
              {
                work_order_no: 'WO-101',
                approved_scope: 450000,
                reserved: 50000,
                paid: 200000,
                remaining: 200000
              }
            ]
          }
        ]
      }
    });

    renderPage(<SubcontractorLedger />, {
      role: 'je',
      initialUrl: '/subcontractor-ledger',
      routePath: '/subcontractor-ledger',
    });

    await waitFor(() => {
      expect(screen.getByText('Apex Infra Solutions')).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Requisitions')).toBeInTheDocument();
  });
});

describe('SubcontractorLedger URL State, Aliases, Modals & Debounce', () => {
  const ledgerFixture = [
    {
      subcontractor_id: 'sub-1',
      subcontractor_name: 'Apex Infra Solutions',
      total_approved: 450000,
      total_reserved: 50000,
      total_paid: 200000,
      total_remaining: 200000,
      work_orders: [
        {
          work_order_no: 'WO-101',
          approved_scope: 450000,
          reserved: 50000,
          paid: 200000,
          remaining: 200000
        }
      ]
    }
  ];

  it('hydrates legacy search alias and writes canonical q while resetting page', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'je',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    const { readLocation } = renderPage(<SubcontractorLedger />, {
      role: 'je',
      initialUrl: '/subcontractor-ledger?search=Apex&page=3',
      routePath: '/subcontractor-ledger',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search contractor, work type, or WO/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search contractor, work type, or WO/i);
    expect(searchInput).toHaveValue('Apex');

    fireEvent.change(searchInput, { target: { value: 'Delta' } });

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('q=Delta');
      expect(loc).not.toContain('search=');
      expect(loc).not.toContain('page=3');
    });
  });

  it('preserves active filters, pagination, and unrelated parameters when opening and closing modal', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'je',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    const { readLocation } = renderPage(<SubcontractorLedger />, {
      role: 'je',
      initialUrl: '/subcontractor-ledger?wo=WO-101&q=Apex&page=2&source=bookmark&modal=entries&subcontractor_id=sub-1&modal_wo=WO-101',
      routePath: '/subcontractor-ledger',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    await waitFor(() => {
      expect(screen.getByTitle('Close')).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=entries');
      expect(loc).toContain('wo=WO-101');
      expect(loc).toContain('q=Apex');
      expect(loc).toContain('page=2');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('filter reset button removes managed filter keys while preserving unrelated query params', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'je',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    const { readLocation } = renderPage(<SubcontractorLedger />, {
      role: 'je',
      initialUrl: '/subcontractor-ledger?wo=WO-101&q=Apex&page=2&source=bookmark',
      routePath: '/subcontractor-ledger',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    const resetBtn = await screen.findByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('wo=WO-101');
      expect(loc).not.toContain('q=Apex');
      expect(loc).not.toContain('page=2');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid IDs and malformed modal payloads safely without crashing', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'je',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    renderPage(<SubcontractorLedger />, {
      role: 'je',
      initialUrl: '/subcontractor-ledger?modal=nonexistent_modal&subcontractor_id=&page=-99',
      routePath: '/subcontractor-ledger',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Subcontractor Ledger/i })).toBeInTheDocument();
    });
  });

  it('debounces search input by 300ms using withFakeTimers', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'je',
      overrides: { subcontractorLedger: ledgerFixture }
    });

    await withFakeTimers(async ({ advanceTimers }) => {
      const { readLocation } = renderPage(<SubcontractorLedger />, {
        role: 'je',
        initialUrl: '/subcontractor-ledger',
        routePath: '/subcontractor-ledger',
        overrides: { subcontractorLedger: ledgerFixture }
      });

      const searchInput = screen.getByPlaceholderText(/Search contractor, work type, or WO/i);
      fireEvent.change(searchInput, { target: { value: 'Buildcon' } });

      // Before 300ms, URL should not have updated
      await act(async () => {
        advanceTimers(150);
      });
      expect(readLocation()).not.toContain('q=Buildcon');

      // At 300ms, debounce fires and updates URL
      await act(async () => {
        advanceTimers(160);
      });
      expect(readLocation()).toContain('q=Buildcon');
    });
  });
});
