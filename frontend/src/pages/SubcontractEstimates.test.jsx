import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import SubcontractEstimates from './SubcontractEstimates';
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
describePageContract(SubcontractEstimates, {
  name: 'SubcontractEstimates',
  route: '/subcontract-estimates',
  allowedRoles: ['je', 'zo', 'ho', 'admin'],
  unauthorizedRole: 'accounts',
  headingMatch: /Subcontract Estimates/i,
  emptyTextMatch: /No matching subcontract estimates found/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('SubcontractEstimates Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders subcontract estimate cards from populated domain fixture', async () => {
    renderPage(<SubcontractEstimates />, {
      initialUrl: '/subcontract-estimates',
      role: 'admin'
    });

    const cards = await screen.findAllByText(/WO: WO-101/i);
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Rev 0').length).toBeGreaterThanOrEqual(1);
  });

  it('filters estimates to Draft status when Draft tab is clicked', async () => {
    const { readLocation } = renderPage(<SubcontractEstimates />, {
      initialUrl: '/subcontract-estimates',
      role: 'admin'
    });

    const draftBtn = await screen.findByRole('button', { name: /Draft Sheets/i });
    fireEvent.click(draftBtn);

    await waitFor(() => {
      assertUrlState({ filter: 'Draft' });
    });
    expect(readLocation()).toContain('filter=Draft');
  });
});

describe('SubcontractEstimates URL State, Aliases & Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('hydrates legacy search alias, filter, and preserves bookmark param', async () => {
    const { readLocation } = renderPage(<SubcontractEstimates />, {
      initialUrl: '/subcontract-estimates?filter=Draft&search=WO-101&source=bookmark',
      role: 'admin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Subcontract Estimates/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Enter WO or Est No/i);
    expect(searchInput).toHaveValue('WO-101');
    expect(readLocation()).toContain('source=bookmark');
  });

  it('writes canonical q and drops legacy search alias while resetting page', async () => {
    const { readLocation } = renderPage(<SubcontractEstimates />, {
      initialUrl: '/subcontract-estimates?search=WO-old&page=2',
      role: 'admin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Subcontract Estimates/i })).toBeInTheDocument();
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
    renderPage(<SubcontractEstimates />, {
      initialUrl: '/subcontract-estimates?status=INVALID_STATUS&page=-5',
      role: 'admin'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Subcontract Estimates/i })).toBeInTheDocument();
    });
  });
});
