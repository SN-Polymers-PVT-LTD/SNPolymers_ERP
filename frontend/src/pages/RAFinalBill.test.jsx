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
