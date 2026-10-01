import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SelfServiceLeaveQueue from './SelfServiceLeaveQueue';
import authApi from '../../api/authApi';

vi.mock('../../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn()
  }
}));

const mockQueueData = {
  success: true,
  requests: [
    {
      id: 'leave-pending-1',
      employee_id: 'emp-1',
      employee_category: 'HO Staff',
      request_source: 'SELF_SERVICE',
      from_date: '2026-09-10',
      to_date: '2026-09-12',
      leave_type: 'Other Leave',
      reason: 'Family event celebration',
      approval_status: 'Pending',
      pay_treatment: 'Pending',
      employee: {
        id: 'emp-1',
        employee_code: 'HO-001',
        employee_name: 'Ananya Sharma',
        department: 'Head Office',
        employee_category: 'HO Staff'
      }
    },
    {
      id: 'leave-decided-2',
      employee_id: 'emp-2',
      employee_category: 'Projects Department Employees',
      request_source: 'SELF_SERVICE',
      from_date: '2026-09-15',
      to_date: '2026-09-16',
      leave_type: 'Medical Leave',
      reason: 'Fever checkup',
      approval_status: 'Approved',
      pay_treatment: 'Paid',
      decided_by: 'user-ho-admin',
      decided_at: '2026-09-14T10:00:00Z',
      decision_remarks: 'Approved medical leave',
      employee: {
        id: 'emp-2',
        employee_code: 'PRJ-001',
        employee_name: 'Vikram Singh',
        department: 'Projects',
        employee_category: 'Projects Department Employees'
      }
    }
  ],
  actors: {
    'user-ho-admin': 'HO Admin Officer'
  },
  pagination: {
    page: 1,
    limit: 20,
    totalItems: 2,
    totalPages: 1
  }
};

function renderQueue(initialPath = '/hr/self-service-leaves') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/hr/self-service-leaves" element={<SelfServiceLeaveQueue />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SelfServiceLeaveQueue Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.get.mockResolvedValue({ data: mockQueueData });
    authApi.post.mockResolvedValue({ data: { success: true } });
  });

  it('renders queue requests with employee details, badges, and action buttons', async () => {
    renderQueue();

    expect(await screen.findByText('HO & Projects Self-Service Leave Queue')).toBeInTheDocument();
    expect(await screen.findByText('Ananya Sharma')).toBeInTheDocument();
    expect(screen.getByText('HO-001')).toBeInTheDocument();
    expect(screen.getByText('Vikram Singh')).toBeInTheDocument();
    expect(screen.getByText('PRJ-001')).toBeInTheDocument();

    // Pending leave has action buttons
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();

    // Decided leave shows Decided status
    expect(screen.getByText('Decided')).toBeInTheDocument();
    expect(screen.getByText('"Approved medical leave"')).toBeInTheDocument();
  });

  it('approving a leave requires explicit selection of Paid or Unpaid treatment', async () => {
    renderQueue();

    await screen.findByText('Ananya Sharma');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    // Modal opens
    expect(await screen.findByText('Approve Leave Request')).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: 'Confirm Approved' });
    expect(confirmBtn).toBeDisabled();

    // Select Paid treatment
    const select = screen.getByLabelText(/Select Pay Treatment/i);
    fireEvent.change(select, { target: { value: 'Paid' } });
    expect(confirmBtn).not.toBeDisabled();

    // Submit approval
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(authApi.post).toHaveBeenCalledWith(
        '/hr/leaves/leave-pending-1/decision',
        expect.objectContaining({
          decision: 'Approved',
          pay_treatment: 'Paid'
        })
      );
    });
  });

  it('rejecting a leave requires remarks and sets pay_treatment to Unpaid', async () => {
    renderQueue();

    await screen.findByText('Ananya Sharma');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    // Modal opens
    expect(await screen.findByText('Reject Leave Request')).toBeInTheDocument();
    expect(screen.getByText('Pay Treatment: Unpaid')).toBeInTheDocument();

    const remarksArea = screen.getByPlaceholderText('Provide mandatory explanation for rejection...');
    fireEvent.change(remarksArea, { target: { value: 'Project deadline conflict.' } });

    const confirmBtn = screen.getByRole('button', { name: 'Confirm Rejected' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(authApi.post).toHaveBeenCalledWith(
        '/hr/leaves/leave-pending-1/decision',
        expect.objectContaining({
          decision: 'Rejected',
          pay_treatment: 'Unpaid',
          remarks: 'Project deadline conflict.'
        })
      );
    });
  });
});

 it('keeps All Statuses selected and omits the API status filter', async () => {
    authApi.get.mockClear(); authApi.get.mockResolvedValue({data:mockQueueData});
    renderQueue(); await screen.findByText('Ananya Sharma');
    fireEvent.change(screen.getAllByRole('combobox')[0], {target:{value:'All'}});
    await waitFor(() => expect(authApi.get).toHaveBeenLastCalledWith('/hr/leaves/review-queue', {params:{page:1,limit:20}}));
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('All');
 });
 it('supports an All Statuses deep link', async () => {
    authApi.get.mockClear(); authApi.get.mockResolvedValue({data:mockQueueData});
    renderQueue('/hr/self-service-leaves?status=All'); await screen.findByText('Ananya Sharma');
    expect(authApi.get).toHaveBeenLastCalledWith('/hr/leaves/review-queue', {params:{page:1,limit:20}});
 });
