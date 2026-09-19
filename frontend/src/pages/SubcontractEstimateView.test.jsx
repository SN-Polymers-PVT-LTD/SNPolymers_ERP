import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SubcontractEstimateView from './SubcontractEstimateView';

const mockNavigate = vi.fn();
let mockParams = { id: 'est-123' };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams
  };
});

let mockUser = { role: 'zo', mobile_number: '+918276071523' };
vi.mock('../components/AuthContext', () => ({
  useAuth: () => ({ user: mockUser })
}));

const mockGetSubcontractEstimate = vi.fn();
const mockReviewSubcontractEstimateRows = vi.fn();
const mockTransitionSubcontractEstimateWorkflow = vi.fn();

vi.mock('../api/subcontractEstimatesApi', () => ({
  getSubcontractEstimate: (...args) => mockGetSubcontractEstimate(...args),
  reviewSubcontractEstimateRows: (...args) => mockReviewSubcontractEstimateRows(...args),
  transitionSubcontractEstimateWorkflow: (...args) => mockTransitionSubcontractEstimateWorkflow(...args)
}));

describe('SubcontractEstimateView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { role: 'zo', mobile_number: '+918276071523' };
  });

  it('renders actor display_name in Workflow History when present, and falls back to mobile number', async () => {
    mockGetSubcontractEstimate.mockResolvedValue({
      data: {
        estimate: {
          subcontract_estimate_id: 'est-123',
          work_order_no: 'WO-101',
          estimate_revision: 0,
          estimate_amount: 10000,
          estimate_status: 'Submitted',
          updated_at: '2026-09-19T10:00:00.000Z',
          project_subcontract_estimate_lines: [],
          project_subcontract_estimate_workflow_log: [
            {
              id: 'log-1',
              actor: '919000000001',
              actor_role: 'je',
              actor_user: { display_name: 'John Doe' },
              action: 'SUBMIT',
              from_status: 'Draft',
              to_status: 'Submitted',
              created_at: '2026-09-19T10:00:00.000Z'
            },
            {
              id: 'log-2',
              actor: '919000000002',
              actor_role: 'zo',
              actor_user: null, // missing display_name
              action: 'OPEN_ZO_REVIEW',
              from_status: 'Submitted',
              to_status: 'Under ZO Review',
              created_at: '2026-09-19T10:05:00.000Z'
            }
          ]
        }
      }
    });

    render(
      <MemoryRouter>
        <SubcontractEstimateView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Workflow History')).toBeInTheDocument();
    });

    // John Doe should be displayed for log-1
    expect(screen.getByText('John Doe (je)')).toBeInTheDocument();

    // Fallback to phone number for log-2
    expect(screen.getByText('919000000002 (zo)')).toBeInTheDocument();
  });

  it('renders the Revision Request banner with ZO remarks and deadline when in ZO Revision Requested status', async () => {
    mockGetSubcontractEstimate.mockResolvedValue({
      data: {
        estimate: {
          subcontract_estimate_id: 'est-123',
          work_order_no: 'WO-101',
          estimate_revision: 0,
          estimate_amount: 10000,
          estimate_status: 'ZO Revision Requested',
          zo_remarks: 'Please lower the plumbing rates',
          updated_at: '2026-09-19T10:00:00.000Z',
          project_subcontract_estimate_lines: [],
          subcontract_estimate_revision_log: [
            {
              id: 'rev-1',
              revision_cycle: 1,
              stage: 'ZO',
              revision_deadline: '2026-09-20T10:00:00.000Z',
              created_at: '2026-09-19T10:00:00.000Z'
            }
          ]
        }
      }
    });

    render(
      <MemoryRouter>
        <SubcontractEstimateView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/ZO Revision Requested/i).length).toBeGreaterThanOrEqual(2);
    });

    expect(screen.getByText('Please lower the plumbing rates')).toBeInTheDocument();
  });

  it('auto-saves row decisions when ZO requests revision', async () => {
    const user = userEvent.setup();
    const initialEstimate = {
      subcontract_estimate_id: 'est-123',
      work_order_no: 'WO-101',
      estimate_revision: 0,
      estimate_amount: 5000,
      estimate_status: 'Under ZO Review',
      updated_at: '2026-09-19T10:00:00.000Z',
      project_subcontract_estimate_lines: [
        {
          line_id: 'line-1',
          subcontractor_id: 'sub-1',
          subcontract_work_id: 'work-1',
          subcontractor: { subcontractor_name: 'ABC Corp', is_active: true },
          subcontract_work: { material_details: 'Pipe Laying', unit: 'Mtr', is_active: true },
          qty: 10,
          rate: 500,
          amount: 5000,
          entry_kind: 'BASE',
          zo_office_approve: null,
          zo_remarks: null
        }
      ]
    };

    mockGetSubcontractEstimate.mockResolvedValue({
      data: { estimate: initialEstimate }
    });

    mockReviewSubcontractEstimateRows.mockResolvedValue({
      data: {
        estimate: {
          ...initialEstimate,
          updated_at: '2026-09-19T10:01:00.000Z',
          project_subcontract_estimate_lines: [
            {
              ...initialEstimate.project_subcontract_estimate_lines[0],
              zo_office_approve: 'Not Approve',
              zo_remarks: 'Rate exceeds maximum cap'
            }
          ]
        }
      }
    });

    mockTransitionSubcontractEstimateWorkflow.mockResolvedValue({
      data: {
        estimate: {
          ...initialEstimate,
          estimate_status: 'ZO Revision Requested',
          zo_remarks: 'Pls review line items',
          updated_at: '2026-09-19T10:02:00.000Z'
        }
      }
    });

    render(
      <MemoryRouter>
        <SubcontractEstimateView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Pipe Laying')).toBeInTheDocument();
    });

    // Select "Not Approve" on line-1
    const decisionSelect = screen.getByRole('combobox');
    await user.selectOptions(decisionSelect, 'Not Approve');

    // Fill in required row remarks
    const rowRemarksInput = screen.getByPlaceholderText('Required reason');
    await user.type(rowRemarksInput, 'Rate exceeds maximum cap');

    // Click "Request Revision" header button
    const requestRevBtn = screen.getByRole('button', { name: /request revision/i });
    await user.click(requestRevBtn);

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByText('Mandatory remarks')).toBeInTheDocument();
    });

    // Fill in modal remarks
    const modalTextarea = screen.getByPlaceholderText('Enter the reason for this workflow action');
    await user.type(modalTextarea, 'Pls review line items');

    // Confirm modal
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      // 1. reviewSubcontractEstimateRows should have been called first!
      expect(mockReviewSubcontractEstimateRows).toHaveBeenCalledWith('est-123', {
        stage: 'ZO',
        approvals: [
          {
            line_id: 'line-1',
            approve_status: 'Not Approve',
            remarks: 'Rate exceeds maximum cap'
          }
        ],
        expected_updated_at: '2026-09-19T10:00:00.000Z'
      });

      // 2. transitionSubcontractEstimateWorkflow should have been called with the updated timestamp!
      expect(mockTransitionSubcontractEstimateWorkflow).toHaveBeenCalledWith('est-123', {
        action: 'ZO_REQUEST_REVISION',
        remarks: 'Pls review line items',
        expected_updated_at: '2026-09-19T10:01:00.000Z'
      });
    });
  });
});
