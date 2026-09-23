import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import SubcontractorLedger from './SubcontractorLedger';
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
