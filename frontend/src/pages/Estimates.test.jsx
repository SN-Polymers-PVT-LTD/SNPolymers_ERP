import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import Estimates from './Estimates';
import {
  renderPage,
  assertUrlState,
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

// 1. Layer 1 & 2 Page Contract Proof
describePageContract(Estimates, {
  name: 'Estimates',
  route: '/estimates',
  allowedRoles: ['staff', 'admin', 'je', 'zo', 'ho', 'accounts'],
  headingMatch: /Cost Estimate Sheets/i,
  emptyTextMatch: /No matching estimate sheets found/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('Estimates Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders estimate records from populated domain fixture', async () => {
    renderPage(<Estimates />, {
      initialUrl: '/estimates',
      role: 'admin'
    });

    const cards = await screen.findAllByText(/WO: WO-101/i);
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('EST-101')).toBeInTheDocument();
  });

  it('filters estimates to Draft sheets when Draft tab is clicked', async () => {
    const { readLocation } = renderPage(<Estimates />, {
      initialUrl: '/estimates',
      role: 'admin'
    });

    const draftBtn = await screen.findByRole('button', { name: /Draft Sheets/i });
    fireEvent.click(draftBtn);

    await waitFor(() => {
      assertUrlState({ filter: 'Draft' });
    });
    expect(readLocation()).toContain('filter=Draft');
    expect(screen.getByText('SE-201')).toBeInTheDocument();
  });
});
