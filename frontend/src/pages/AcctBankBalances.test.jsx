import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AcctBankBalances from './AcctBankBalances';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import { bankBalancesFixture } from '../test/fixtures/domainFixtures';
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

describe('AcctBankBalances Page', () => {
  describePageContract({
    title: 'AcctBankBalances Page Contract',
    pageName: 'AcctBankBalances',
    PageUnderContract: AcctBankBalances,
    route: '/acct-requisitions/bank-balances',
    routePath: '/acct-requisitions/bank-balances',
    requiredRole: 'accounts',
    headingText: 'Bank Balance Master',
    emptyScenarioText: 'No bank accounts set up yet.',
    actionControlText: '+ Add Bank',
    initialScenario: {
      bankBalances: bankBalancesFixture,
    },
    emptyScenario: {
      bankBalances: [],
    },
  });

  it('opens add/reconcile bank modal on clicking + Add Bank button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        bankBalances: bankBalancesFixture,
      }
    });

    renderPage(<AcctBankBalances />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/bank-balances',
      routePath: '/acct-requisitions/bank-balances',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Bank Balance Master/i })).toBeInTheDocument();
    });

    const addBtn = screen.getByText('+ Add Bank');
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByText('Add / Reconcile Bank')).toBeInTheDocument();
    });
  });
});
