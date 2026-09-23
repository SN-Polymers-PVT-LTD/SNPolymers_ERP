import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import FundRequests from './FundRequests';
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
describePageContract(FundRequests, {
  name: 'FundRequests',
  route: '/fund-requests',
  allowedRoles: ['zo', 'admin', 'ho'],
  unauthorizedRole: 'je',
  headingMatch: /Fund Request Dashboard/i,
  emptyTextMatch: /No requests matching filters/i,
  // errorTextMatch handled in custom suite because FundRequests portals error into a Modal
  errorTextMatch: null
});

// 2. Layer 3 & Domain Interactions Proof
describe('FundRequests Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });


  it('renders validation alert modal when API request fails', async () => {
    renderPage(<FundRequests />, {
      initialUrl: '/fund-requests',
      role: 'zo',
      scenario: 'apiError',
      errorMessage: 'Server unavailable'
    });

    const errorHeading = await screen.findByText('Action Blocked');
    expect(errorHeading).toBeInTheDocument();
    expect(screen.getByText('Server unavailable')).toBeInTheDocument();
  });

  it('renders fund request records from populated domain fixture', async () => {
    renderPage(<FundRequests />, {
      initialUrl: '/fund-requests',
      role: 'zo'
    });

    expect(await screen.findByText('FR-301')).toBeInTheDocument();
    expect(screen.getByText('FR-302')).toBeInTheDocument();
    expect(screen.getAllByText('WO-101').length).toBeGreaterThanOrEqual(2);
  });

  it('hydrates filter deep-link to show pending only', async () => {
    const { readLocation } = renderPage(<FundRequests />, {
      initialUrl: '/fund-requests?filter=pendingOnly',
      role: 'zo'
    });

    expect(await screen.findByText('FR-302')).toBeInTheDocument();
    assertUrlState({ filter: 'pendingOnly' });
    expect(readLocation()).toContain('filter=pendingOnly');
  });

  it('opens Create Request flow when deep-linked with ?create=true&wo=WO-101', async () => {
    renderPage(<FundRequests />, {
      initialUrl: '/fund-requests?create=true&wo=WO-101',
      role: 'zo'
    });

    expect(await screen.findByText('Fund Request Management')).toBeInTheDocument();
    assertUrlState({ create: 'true', wo: 'WO-101' });
  });
});

describe('FundRequests URL State Hydration & Canonical Writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('visibly hydrates search input and filter checkboxes from deep link', async () => {
    renderPage(<FundRequests />, {
      initialUrl: '/fund-requests?q=FR-301&filter=pendingOnly',
      role: 'zo'
    });

    const searchInput = await screen.findByPlaceholderText(/Search requests/i);
    expect(searchInput).toHaveValue('FR-301');

    const pendingCheckbox = screen.getByLabelText(/Pending Only/i);
    expect(pendingCheckbox).toBeChecked();

    const myRequestsCheckbox = screen.getByLabelText(/My Requests/i);
    expect(myRequestsCheckbox).not.toBeChecked();
  });

  it('interactively writes canonical filter parameter to URL on toggle', async () => {
    const { readLocation } = renderPage(<FundRequests />, {
      initialUrl: '/fund-requests?filter=pendingOnly',
      role: 'zo'
    });

    const myRequestsCheckbox = await screen.findByLabelText(/My Requests/i);
    myRequestsCheckbox.click();

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).toContain('filter=');
      expect(loc).toContain('myRequests');
    });
  });
});
