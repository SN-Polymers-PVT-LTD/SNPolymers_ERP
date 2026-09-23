import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import RAFinalBill from './RAFinalBill';
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

describe('RAFinalBill Page', () => {
  describePageContract({
    title: 'RAFinalBill Page Contract',
    pageName: 'RAFinalBill',
    PageUnderContract: RAFinalBill,
    route: '/ra-final-bills',
    routePath: '/ra-final-bills',
    requiredRole: 'zo',
    headingText: 'RA / Final Bill Entry',
    emptyScenarioText: 'No bill entries found matching the filter criteria.',
    actionControlText: 'New Bill Entry',
    initialScenario: {
      raFinalBills: [
        {
          bill_id: 'bill-1',
          bill_no: 'RA-001',
          work_order_no: 'WO-101',
          payment_type: 'RA Bill',
          bill_amount: 500000,
          sgst_amount: 45000,
          cgst_amount: 45000,
          igst_amount: 0,
          tds_amount: 10000,
          labor_cess_amount: 5000,
          net_payable_amount: 575000,
          bill_date: '2026-08-15',
          created_at: '2026-08-15T12:00:00Z',
          project_name: 'Substation Expansion'
        }
      ]
    },
    emptyScenario: {
      raFinalBills: []
    }
  });

  it('renders bill records and filter controls', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: {
        raFinalBills: [
          {
            bill_id: 'bill-1',
            bill_no: 'RA-001',
            work_order_no: 'WO-101',
            payment_type: 'RA Bill',
            bill_amount: 500000,
            sgst_amount: 45000,
            cgst_amount: 45000,
            igst_amount: 0,
            tds_amount: 10000,
            labor_cess_amount: 5000,
            net_payable_amount: 575000,
            bill_date: '2026-08-15',
            created_at: '2026-08-15T12:00:00Z',
            project_name: 'Substation Expansion'
          }
        ]
      }
    });

    renderPage(<RAFinalBill />, {
      role: 'zo',
      initialUrl: '/ra-final-bills',
      routePath: '/ra-final-bills',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /RA \/ Final Bill Entry/i })).toBeInTheDocument();
    });

    expect(screen.getAllByText('New Bill Entry').length).toBeGreaterThan(0);
    expect(screen.getByText('Reset Filters')).toBeInTheDocument();
  });
});

describe('RAFinalBill URL State, Modals, Aliases & Reset', () => {
  const raBillsFixture = [
    {
      bill_id: 'bill-1',
      bill_no: 'RA-001',
      work_order_no: 'WO-101',
      payment_type: 'RA Bill',
      bill_amount: 500000,
      sgst_amount: 45000,
      cgst_amount: 45000,
      igst_amount: 0,
      tds_amount: 10000,
      labor_cess_amount: 5000,
      net_payable_amount: 575000,
      bill_date: '2026-08-15',
      created_at: '2026-08-15T12:00:00Z',
      project_name: 'Substation Expansion'
    }
  ];

  it('hydrates legacy wo_search alias and writes canonical keys while resetting page', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { raFinalBills: raBillsFixture }
    });

    const { readLocation } = renderPage(<RAFinalBill />, {
      role: 'zo',
      initialUrl: '/ra-final-bills?wo_search=WO-101&page=3',
      routePath: '/ra-final-bills',
      overrides: { raFinalBills: raBillsFixture }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /RA \/ Final Bill Entry/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search WO...');
    expect(searchInput).toHaveValue('WO-101');

    fireEvent.change(searchInput, { target: { value: 'WO-202' } });

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('search=WO-202');
      expect(loc).not.toContain('wo_search=');
      expect(loc).not.toContain('page=3');
    });
  });

  it('preserves active filters and bookmark query params when closing create modal', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { raFinalBills: raBillsFixture }
    });

    const { readLocation } = renderPage(<RAFinalBill />, {
      role: 'zo',
      initialUrl: '/ra-final-bills?search=WO-101&type=RA+Bill&page=2&source=bookmark&modal=create&create_wo=WO-101',
      routePath: '/ra-final-bills',
      overrides: { raFinalBills: raBillsFixture }
    });

    const cancelBtn = await screen.findByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=create');
      expect(loc).not.toContain('create_wo=');
      expect(loc).toContain('search=WO-101');
      expect(loc).toContain('type=RA+Bill');
      expect(loc).toContain('page=2');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('reset filters button removes managed filters while preserving unrelated query params', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { raFinalBills: raBillsFixture }
    });

    const { readLocation } = renderPage(<RAFinalBill />, {
      role: 'zo',
      initialUrl: '/ra-final-bills?search=WO-101&type=RA+Bill&page=2&source=bookmark',
      routePath: '/ra-final-bills',
      overrides: { raFinalBills: raBillsFixture }
    });

    const resetBtn = await screen.findByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('search=WO-101');
      expect(loc).not.toContain('type=RA+Bill');
      expect(loc).not.toContain('page=2');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid modal params and unknown IDs safely without crashing', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { raFinalBills: raBillsFixture }
    });

    renderPage(<RAFinalBill />, {
      role: 'zo',
      initialUrl: '/ra-final-bills?modal=invalid_modal&bill_id=nonexistent&page=-5',
      routePath: '/ra-final-bills',
      overrides: { raFinalBills: raBillsFixture }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /RA \/ Final Bill Entry/i })).toBeInTheDocument();
    });
  });
});
