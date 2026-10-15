import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AcctCreditLedger from './AcctCreditLedger';
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

const creditLedgerItem = {
  id: 'cl-1',
  credit_ledger_id: 'cl-1',
  dealer_name: 'Industrial Spares Ltd',
  beneficiary: {
    beneficiary_name: 'Industrial Spares Ltd',
    account_number: '9876543210',
    ifsc: 'SBIN0001234'
  },
  work_order_no: 'WO-101',
  material_details: 'Conduit pipes and brackets',
  opening_balance: 100000,
  paid_amount: 30000,
  paid_total: 30000,
  remaining_balance: 70000,
  ledger_status: 'Open',
  status: 'Open',
  created_at: '2026-08-01T10:00:00Z',
  source: { sheet_number: 'SHEET-2026-01' }
};

describe('AcctCreditLedger Page', () => {
  describePageContract({
    title: 'AcctCreditLedger Page Contract',
    pageName: 'AcctCreditLedger',
    PageUnderContract: AcctCreditLedger,
    route: '/acct-requisitions/credit-ledger',
    routePath: '/acct-requisitions/credit-ledger',
    requiredRole: 'accounts',
    headingText: 'Credit Ledger',
    emptyScenarioText: 'No open credit purchases.',
    actionControlText: 'Back to Sheets',
    initialScenario: {
      acctCreditLedger: [creditLedgerItem]
    },
    emptyScenario: {
      acctCreditLedger: []
    }
  });

  it('renders credit purchase records and navigation', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctCreditLedger: [creditLedgerItem]
      }
    });

    renderPage(<AcctCreditLedger />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/credit-ledger',
      routePath: '/acct-requisitions/credit-ledger',
    });

    await waitFor(() => {
      expect(screen.getByText('Industrial Spares Ltd')).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Sheets')).toBeInTheDocument();
  });
});
