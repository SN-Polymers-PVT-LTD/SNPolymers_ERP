import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AcctRequisitionLogs from './AcctRequisitionLogs';
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

const logEntry = {
  id: 'log-1',
  action: 'PENDING_HO_REVIEW_FIRST_SUBMIT',
  created_at: '2026-08-01T10:00:00Z',
  line_item: {
    sheet_number: 'SHEET-2026-01',
    account_sub_title_text: 'Material Procurement',
    beneficiary_ac_no: '9876543210',
    amount: 50000
  }
};

describe('AcctRequisitionLogs Page', () => {
  describePageContract({
    title: 'AcctRequisitionLogs Page Contract',
    pageName: 'AcctRequisitionLogs',
    PageUnderContract: AcctRequisitionLogs,
    route: '/acct-requisitions/logs',
    routePath: '/acct-requisitions/logs',
    requiredRole: 'accounts',
    headingText: 'Requisition Logs',
    emptyScenarioText: 'No log entries found.',
    actionControlText: 'Log Entries',
    initialScenario: {
      acctLogs: [logEntry]
    },
    emptyScenario: {
      acctLogs: []
    }
  });

  it('renders log records and filter dates', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctLogs: [logEntry]
      }
    });

    renderPage(<AcctRequisitionLogs />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/logs',
      routePath: '/acct-requisitions/logs',
    });

    await waitFor(() => {
      expect(screen.getByText('SHEET-2026-01')).toBeInTheDocument();
    });

    expect(screen.getByText('Material Procurement')).toBeInTheDocument();
  });
});
