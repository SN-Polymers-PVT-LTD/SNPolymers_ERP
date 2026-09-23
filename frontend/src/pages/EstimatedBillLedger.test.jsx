import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import EstimatedBillLedger from './EstimatedBillLedger';
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

describe('EstimatedBillLedger Page', () => {
  describePageContract({
    title: 'EstimatedBillLedger Page Contract',
    pageName: 'EstimatedBillLedger',
    PageUnderContract: EstimatedBillLedger,
    route: '/estimated-bills/ledger/WO-101',
    routePath: '/estimated-bills/ledger/:work_order_no',
    requiredRole: 'zo',
    headingText: 'Work Order Ledger Sheet',
    emptyScenarioText: 'No entries yet',
    actionControlText: 'Back to Overview',
    initialScenario: {
      estimatedBillLedger: [
        {
          entry_id: 'eb-1',
          work_order_no: 'WO-101',
          estimated_bill_amount: 1200000,
          disbursed_amount: 900000,
          excess_return_amount: 50000,
          current_net_margin: 250000,
          remarks: 'Initial assessment',
          created_at: '2026-08-01T10:00:00Z',
          created_by_name: 'ZO Officer'
        }
      ]
    },
    emptyScenario: {
      estimatedBillLedger: []
    }
  });

  it('renders ledger timeline and back button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: {
        estimatedBillLedger: [
          {
            entry_id: 'eb-1',
            work_order_no: 'WO-101',
            estimated_bill_amount: 1200000,
            disbursed_amount: 900000,
            excess_return_amount: 50000,
            current_net_margin: 250000,
            remarks: 'Initial assessment',
            created_at: '2026-08-01T10:00:00Z',
            created_by_name: 'ZO Officer'
          }
        ]
      }
    });

    renderPage(<EstimatedBillLedger />, {
      role: 'zo',
      initialUrl: '/estimated-bills/ledger/WO-101',
      routePath: '/estimated-bills/ledger/:work_order_no',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Work Order Ledger Sheet/i })).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Overview')).toBeInTheDocument();
  });
});

describe('EstimatedBillLedger URL State, Aliases & Modals', () => {
  const ledgerEntries = [
    {
      entry_id: 'eb-1',
      work_order_no: 'WO-101',
      estimated_bill_amount: 1200000,
      disbursed_amount: 900000,
      excess_return_amount: 50000,
      current_net_margin: 250000,
      remarks: 'Initial assessment',
      created_at: '2026-08-01T10:00:00Z',
      created_by_name: 'ZO Officer'
    }
  ];

  it('hydrates legacy date aliases and preserves active parameters and bookmark params on modal close', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { estimatedBillLedger: ledgerEntries }
    });

    const { readLocation } = renderPage(<EstimatedBillLedger />, {
      role: 'zo',
      initialUrl: '/estimated-bills/ledger/WO-101?payment_date_from=2026-08-01&sort=payment_date&dir=asc&source=bookmark&modal=new',
      routePath: '/estimated-bills/ledger/:work_order_no',
      overrides: { estimatedBillLedger: ledgerEntries }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Work Order Ledger Sheet/i })).toBeInTheDocument();
    });

    const closeBtn = await screen.findByTitle('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=new');
      expect(loc).toContain('sort=payment_date');
      expect(loc).toContain('dir=asc');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('handles invalid work order slugs or malformed params gracefully', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'zo',
      overrides: { estimatedBillLedger: [] }
    });

    renderPage(<EstimatedBillLedger />, {
      role: 'zo',
      initialUrl: '/estimated-bills/ledger/NON-EXISTENT?modal=unknown&dir=invalid',
      routePath: '/estimated-bills/ledger/:work_order_no',
      overrides: { estimatedBillLedger: [] }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Work Order Ledger Sheet/i })).toBeInTheDocument();
    });
  });
});
