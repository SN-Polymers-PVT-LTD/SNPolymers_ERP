import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AcctSubTitles from './AcctSubTitles';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import { acctSubTitlesFixture } from '../test/fixtures/domainFixtures';
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

describe('AcctSubTitles Page', () => {
  describePageContract({
    title: 'AcctSubTitles Page Contract',
    pageName: 'AcctSubTitles',
    PageUnderContract: AcctSubTitles,
    route: '/acct-requisitions/sub-titles',
    routePath: '/acct-requisitions/sub-titles',
    requiredRole: 'accounts',
    headingText: 'Account Sub-titles',
    emptyScenarioText: 'No account sub-titles set up yet.',
    actionControlText: '+ Add Sub-title',
    initialScenario: {
      acctSubTitles: acctSubTitlesFixture,
    },
    emptyScenario: {
      acctSubTitles: [],
    },
  });

  it('opens add sub-title modal when clicking action button', async () => {
    mockApiScenario(authApi, {
      scenario: 'populated',
      role: 'accounts',
      overrides: {
        acctSubTitles: acctSubTitlesFixture,
      }
    });

    renderPage(<AcctSubTitles />, {
      role: 'accounts',
      initialUrl: '/acct-requisitions/sub-titles',
      routePath: '/acct-requisitions/sub-titles',
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Account Sub-titles/i })).toBeInTheDocument();
    });

    const addBtn = screen.getByText('+ Add Sub-title');
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByText('Add Account Sub-title')).toBeInTheDocument();
    });
  });
});
