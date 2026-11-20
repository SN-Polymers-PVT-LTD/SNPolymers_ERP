import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AcctParticulars from './AcctParticulars';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import { acctParticularsFixture } from '../test/fixtures/domainFixtures';
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

describe('AcctParticulars Page', () => {
  describePageContract({
    title: 'AcctParticulars Page Contract',
    pageName: 'AcctParticulars',
    PageUnderContract: AcctParticulars,
    route: '/acct-requisitions/particulars',
    routePath: '/acct-requisitions/particulars',
    requiredRole: 'accounts',
    headingText: 'Particulars',
    emptyScenarioText: 'No particulars set up yet.',
    actionControlText: '+ Add Particular',
    initialScenario: {
      acctParticulars: acctParticularsFixture,
    },
    emptyScenario: {
      acctParticulars: [],
    },
  });

  it('opens add particular modal when clicking action button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctParticulars: acctParticularsFixture,
      }
    });

    renderPage(<AcctParticulars />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/particulars',
      routePath: '/acct-requisitions/particulars',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Particulars/i })).toBeInTheDocument();
    });

    const addBtn = screen.getByText('+ Add Particular');
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Add Particular').length).toBeGreaterThan(0);
    });
  });
});
