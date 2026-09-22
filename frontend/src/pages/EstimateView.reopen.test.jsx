import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EstimateView from './EstimateView';

let mockUser = { role: 'zo', mobile_number: '+918276071523' };
vi.mock('../components/AuthContext', () => ({
  useAuth: () => ({ user: mockUser })
}));

const mockPost = vi.fn();
const mockGet = vi.fn();

vi.mock('../api/authApi', () => ({
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args)
  }
}));

vi.mock('../utils/exportHelpers', () => ({
  exportToExcel: vi.fn(),
  exportArchiveToZip: vi.fn()
}));

const mockEstimateData = {
  estimate: {
    estimate_id: 'est-cost-1',
    work_order_no: 'WO-COST-001',
    estimate_status: 'Final Approved',
    estimate_amount: 150000,
    created_at: '2026-09-10T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
    projects_master: {
      work_order_value: 150000
    }
  },
  items: [
    {
      item_id: 'item-1',
      description: 'Excavation work',
      quantity: 100,
      unit_rate: 1500,
      total_amount: 150000,
      zo_office_approve: 'Approve',
      ho_office_approve: 'Approve'
    }
  ],
  quotations: [],
  revision_logs: []
};

const renderWithProviders = (estimateId = 'est-cost-1') => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/estimates/${estimateId}`]}>
        <Routes>
          <Route path="/estimates/:id" element={<EstimateView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('EstimateView: Reopen Option Moved from HO to ZO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((url) => {
      if (url.includes('/revisions')) {
        return Promise.resolve({ data: { revisions: [] } });
      }
      if (url.includes('/purchase-data')) {
        return Promise.resolve({ data: { options: [] } });
      }
      if (url.includes('/quotations')) {
        return Promise.resolve({ data: { quotations: [] } });
      }
      return Promise.resolve({
        data: {
          estimate: mockEstimateData.estimate,
          items: mockEstimateData.items,
          summary: { gross_total: 150000 }
        }
      });
    });
  });

  it('renders Reopen Estimate button for ZO role on Final Approved estimate and posts to reopen endpoint', async () => {
    const user = userEvent.setup();
    mockUser = { role: 'zo', mobile_number: '+918276071523' };
    mockPost.mockResolvedValue({
      data: { success: true, message: 'Estimate reopened successfully.' }
    });

    renderWithProviders();

    const reopenBtn = await screen.findByRole('button', { name: /reopen estimate/i });
    expect(reopenBtn).toBeInTheDocument();

    await user.click(reopenBtn);

    // Confirmation modal should open
    await waitFor(() => {
      expect(screen.getByText('Reopen Cost Estimate')).toBeInTheDocument();
      expect(screen.getByText(/Warning: Workflow Reopening/i)).toBeInTheDocument();
    });

    const confirmBtns = screen.getAllByRole('button', { name: /reopen estimate/i });
    // The second button is inside the modal footer
    const confirmBtn = confirmBtns[confirmBtns.length - 1];
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/estimates/est-cost-1/reopen');
    });
  });

  it('renders Reopen Estimate button for Admin role on Final Approved estimate', async () => {
    mockUser = { role: 'admin', mobile_number: '+919999999999' };

    renderWithProviders();

    const reopenBtn = await screen.findByRole('button', { name: /reopen estimate/i });
    expect(reopenBtn).toBeInTheDocument();
  });

  it('does NOT render Reopen Estimate button for HO role on Final Approved estimate', async () => {
    mockUser = { role: 'ho', mobile_number: '+917000000001' };

    renderWithProviders();

    // Wait for the estimate to load
    await screen.findByText('Estimate Detail Console');

    expect(screen.queryByRole('button', { name: /reopen estimate/i })).not.toBeInTheDocument();
  });

  it('does NOT render Reopen Estimate button for JE role on Final Approved estimate', async () => {
    mockUser = { role: 'je', mobile_number: '+919000000001' };

    renderWithProviders();

    await screen.findByText('Estimate Detail Console');

    expect(screen.queryByRole('button', { name: /reopen estimate/i })).not.toBeInTheDocument();
  });
});
