import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProfileLeaveSection from './ProfileLeaveSection';
import authApi from '../../api/authApi';

vi.mock('../../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn()
  }
}));

const mockEligibleContext = {
  success: true,
  eligible: true,
  employee: {
    id: 'emp-ho-1',
    employee_code: 'HO-101',
    employee_name: 'Aditi Roy',
    employee_category: 'HO Staff',
    department: 'Head Office',
    joining_date: '2025-01-01',
    active_status: 'Active'
  }
};

const mockIneligibleContext = {
  success: true,
  eligible: false,
  employee: {
    id: 'emp-fac-1',
    employee_code: 'FAC-101',
    employee_name: 'Factory Worker',
    employee_category: 'SNP Casual Factory Labour',
    department: 'SNP Factory',
    joining_date: '2025-01-01',
    active_status: 'Active'
  }
};

const mockMyRequests = {
  success: true,
  requests: [
    {
      id: 'leave-1',
      employee_id: 'emp-ho-1',
      employee_category: 'HO Staff',
      request_source: 'SELF_SERVICE',
      from_date: '2026-10-05',
      to_date: '2026-10-06',
      leave_type: 'Other Leave',
      reason: 'Personal function',
      approval_status: 'Pending',
      pay_treatment: 'Pending'
    },
    {
      id: 'leave-2',
      employee_id: 'emp-ho-1',
      employee_category: 'HO Staff',
      request_source: 'SELF_SERVICE',
      from_date: '2026-09-01',
      to_date: '2026-09-02',
      leave_type: 'Medical Leave',
      reason: 'Doctor appointment',
      approval_status: 'Approved',
      pay_treatment: 'Paid',
      decided_by: 'user-ho',
      decision_remarks: 'Approved with pay'
    }
  ],
  actors: {
    'user-ho': 'HO Approver'
  }
};

describe('ProfileLeaveSection Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ineligible notice when user is not linked to eligible HO/Projects employee', async () => {
    authApi.get.mockImplementation((url) => {
      if (url === '/hr/leaves/context') return Promise.resolve({ data: mockIneligibleContext });
      return Promise.resolve({ data: { success: true } });
    });

    render(<ProfileLeaveSection />);

    expect(await screen.findByText('Self-Service Leave Not Eligible')).toBeInTheDocument();
    expect(screen.getByText(/SNP Casual Factory Labour/)).toBeInTheDocument();
    expect(screen.queryByText('Apply for Leave')).not.toBeInTheDocument();
  });

  it('renders linked employee chip, form, and requests history when eligible', async () => {
    authApi.get.mockImplementation((url) => {
      if (url === '/hr/leaves/context') return Promise.resolve({ data: mockEligibleContext });
      if (url === '/hr/leaves/my-requests') return Promise.resolve({ data: mockMyRequests });
      return Promise.resolve({ data: { success: true } });
    });

    render(<ProfileLeaveSection />);

    expect(await screen.findByText('Aditi Roy')).toBeInTheDocument();
    expect(screen.getByText('HO-101')).toBeInTheDocument();
    expect(screen.getByText('Apply for Leave')).toBeInTheDocument();
    expect(screen.getByText('My Leave Requests')).toBeInTheDocument();

    // Requests rendered
    expect(await screen.findByText('Personal function')).toBeInTheDocument();
    expect(screen.getByText('Doctor appointment')).toBeInTheDocument();
    expect(screen.getByText('Approved with pay')).toBeInTheDocument();
  });

  it('submits a new leave request and reloads requests list', async () => {
    authApi.get.mockImplementation((url) => {
      if (url === '/hr/leaves/context') return Promise.resolve({ data: mockEligibleContext });
      if (url === '/hr/leaves/my-requests') return Promise.resolve({ data: mockMyRequests });
      return Promise.resolve({ data: { success: true } });
    });
    authApi.post.mockResolvedValue({ data: { success: true, leave: { id: 'new-leave' } } });

    render(<ProfileLeaveSection />);

    await screen.findByText('Apply for Leave');

    // Fill form
    const dateInputs = screen.getAllByDisplayValue('');
    const fromInput = dateInputs[0];
    const toInput = dateInputs[1];

    fireEvent.change(fromInput, { target: { value: '2026-10-15' } });
    fireEvent.change(toInput, { target: { value: '2026-10-16' } });

    const reasonArea = screen.getByPlaceholderText(/State reason clearly/i);
    fireEvent.change(reasonArea, { target: { value: 'Festival holiday with family' } });

    const submitBtn = screen.getByRole('button', { name: 'Submit Leave Request' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(authApi.post).toHaveBeenCalledWith(
        '/hr/leaves/self-service',
        expect.objectContaining({
          from_date: '2026-10-15',
          to_date: '2026-10-16',
          leave_type: 'Other Leave',
          reason: 'Festival holiday with family'
        })
      );
    });

    expect(await screen.findByText('Leave request submitted successfully as Pending.')).toBeInTheDocument();
  });

  it('clicking Edit on a pending leave populates the form and updates via PUT', async () => {
    authApi.get.mockImplementation((url) => {
      if (url === '/hr/leaves/context') return Promise.resolve({ data: mockEligibleContext });
      if (url === '/hr/leaves/my-requests') return Promise.resolve({ data: mockMyRequests });
      return Promise.resolve({ data: { success: true } });
    });
    authApi.put.mockResolvedValue({ data: { success: true } });

    render(<ProfileLeaveSection />);

    await screen.findByText('Personal function');

    const editBtn = screen.getByRole('button', { name: '✏️ Edit' });
    fireEvent.click(editBtn);

    // Form title updates
    expect(screen.getByText('Edit Pending Leave Request')).toBeInTheDocument();
    const updateBtn = screen.getByRole('button', { name: 'Update Leave Request' });
    expect(updateBtn).toBeInTheDocument();

    // Modify reason
    const reasonArea = screen.getByDisplayValue('Personal function');
    fireEvent.change(reasonArea, { target: { value: 'Updated personal event reason' } });

    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(authApi.put).toHaveBeenCalledWith(
        '/hr/leaves/self-service/leave-1',
        expect.objectContaining({
          from_date: '2026-10-05',
          to_date: '2026-10-06',
          reason: 'Updated personal event reason'
        })
      );
    });
  });
});

 it('shows and retries context failure without claiming ineligibility', async () => {
    authApi.get.mockRejectedValueOnce(new Error('Network unavailable')); render(<ProfileLeaveSection/>);
    expect(await screen.findByText('Failed to load employee leave context.')).toBeInTheDocument();
    expect(screen.queryByText('Self-Service Leave Not Eligible')).not.toBeInTheDocument();
    authApi.get.mockResolvedValue({data:mockIneligibleContext});
    fireEvent.click(screen.getByRole('button',{name:'Retry Leave Context'}));
    expect(await screen.findByText('Self-Service Leave Not Eligible')).toBeInTheDocument();
 });
 it('shows history loading and failure separately from an empty ledger, then retries', async () => {
    let rejectHistory;
    authApi.get.mockImplementation(path=>path.endsWith('/context')?Promise.resolve({data:mockEligibleContext}):new Promise((_,reject)=>{rejectHistory=reject;}));
    render(<ProfileLeaveSection/>);
    expect(await screen.findByText('Loading leave requests...')).toBeInTheDocument();
    expect(screen.queryByText(/No self-service leave requests found/)).not.toBeInTheDocument();
    rejectHistory(new Error('History unavailable'));
    expect(await screen.findByText('Failed to load leave requests.')).toBeInTheDocument();
    expect(screen.queryByText(/No self-service leave requests found/)).not.toBeInTheDocument();
    authApi.get.mockResolvedValue({data:mockMyRequests});
    fireEvent.click(screen.getByRole('button',{name:'Retry Leave Requests'}));
    expect(await screen.findByText('Personal function')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load leave requests.')).not.toBeInTheDocument();
 });
