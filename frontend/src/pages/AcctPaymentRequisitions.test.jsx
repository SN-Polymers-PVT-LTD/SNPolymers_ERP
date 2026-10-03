import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AcctPaymentRequisitions from './AcctPaymentRequisitions';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import { acctPaymentRequisitionsFixture } from '../test/fixtures/domainFixtures';
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

describe('AcctPaymentRequisitions Page', () => {
  describePageContract({
    title: 'AcctPaymentRequisitions Page Contract',
    pageName: 'AcctPaymentRequisitions',
    PageUnderContract: AcctPaymentRequisitions,
    route: '/acct-requisitions/payment-requisitions',
    routePath: '/acct-requisitions/payment-requisitions',
    requiredRole: 'accounts',
    headingText: 'Payment Requisitions',
    emptyScenarioText: 'No Payment Requisitions have been sent to Accounts yet.',
    actionControlText: 'Back to Sheets',
    initialScenario: {
      acctPaymentRequisitions: acctPaymentRequisitionsFixture,
    },
    emptyScenario: {
      acctPaymentRequisitions: [],
    },
  });

  it('renders search input and back navigation', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctPaymentRequisitions: acctPaymentRequisitionsFixture,
      }
    });

    renderPage(<AcctPaymentRequisitions />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/payment-requisitions',
      routePath: '/acct-requisitions/payment-requisitions',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Payment Requisitions/i })).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Sheets')).toBeInTheDocument();
  });
});
