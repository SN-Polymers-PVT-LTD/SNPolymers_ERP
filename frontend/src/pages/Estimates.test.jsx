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

describe('Estimates URL State, Aliases & Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('hydrates legacy search alias, filter, and preserves bookmark param', async () => {
    const { readLocation } = renderPage(<Estimates />, {
      initialUrl: '/estimates?filter=Draft&search=WO-101&source=bookmark',
      role: 'admin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Cost Estimate Sheets/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Enter WO or Est No/i);
    expect(searchInput).toHaveValue('WO-101');
    expect(readLocation()).toContain('source=bookmark');
  });

  it('writes canonical q and drops legacy search alias while resetting page', async () => {
    const { readLocation } = renderPage(<Estimates />, {
      initialUrl: '/estimates?search=WO-old&page=2',
      role: 'admin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Cost Estimate Sheets/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Enter WO or Est No/i);
    fireEvent.change(searchInput, { target: { value: 'WO-101' } });

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('q=WO-101');
      expect(loc).not.toContain('search=WO-old');
      expect(loc).not.toContain('page=2');
    });
  });

  it('safely handles invalid status and negative page number without crashing', async () => {
    renderPage(<Estimates />, {
      initialUrl: '/estimates?status=INVALID_STATUS&page=-5',
      role: 'admin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Cost Estimate Sheets/i })).toBeInTheDocument();
    });
  });
});
