import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    const user = userEvent.setup();
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

    // Switch to History tab
    const historyTab = await screen.findByRole('button', { name: /History & Audit Log/i });
    await user.click(historyTab);

    await waitFor(() => {
      expect(screen.getByText('Workflow History')).toBeInTheDocument();
    });

    // Workflow History is collapsed by default; click to expand
    const workflowToggle = screen.getByRole('button', { name: /Workflow History/i });
    await user.click(workflowToggle);

    // John Doe should be displayed for log-1
    expect(await screen.findByText('John Doe (je)')).toBeInTheDocument();

    // Fallback to phone number for log-2
    expect(screen.getByText('919000000002 (zo)')).toBeInTheDocument();
  });

  it('collapses Revision Cycles and Workflow History by default and toggles on click', async () => {
    const user = userEvent.setup();
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
          subcontract_estimate_revision_log: [
            {
              id: 'rev-1',
              revision_cycle: 1,
              stage: 'ZO',
              requested_by: '918276071523',
              resubmitted_by: '919000000001',
              revision_deadline: '2026-09-20T10:00:00.000Z',
              created_at: '2026-09-19T10:00:00.000Z'
            }
          ],
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

    // Switch to History tab
    const historyTab = await screen.findByRole('button', { name: /History & Audit Log/i });
    await user.click(historyTab);

    // Both section buttons are visible
    const revisionToggle = await screen.findByRole('button', { name: /Revision Cycles/i });
    const workflowToggle = await screen.findByRole('button', { name: /Workflow History/i });

    // Defaults to collapsed: content is hidden
    expect(screen.queryByText(/Cycle 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText('John Doe (je)')).not.toBeInTheDocument();

    // Toggle Revision Cycles open
    await user.click(revisionToggle);
    expect(await screen.findByText(/Cycle 1/i)).toBeInTheDocument();

    // Toggle Revision Cycles closed
    await user.click(revisionToggle);
    expect(screen.queryByText(/Cycle 1/i)).not.toBeInTheDocument();

    // Toggle Workflow History open
    await user.click(workflowToggle);
    expect(await screen.findByText('John Doe (je)')).toBeInTheDocument();

    // Toggle Workflow History closed
    await user.click(workflowToggle);
    expect(screen.queryByText('John Doe (je)')).not.toBeInTheDocument();
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

    expect(screen.getAllByText('Please lower the plumbing rates').length).toBeGreaterThanOrEqual(1);
  });

  it('auto-saves row decisions when ZO requests revision with modal remarks interaction', async () => {
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

    // Click remarks input to open focused remarks modal
    const remarksInput = screen.getByPlaceholderText(/click to enter required reason/i);
    await user.click(remarksInput);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText(/Review Remarks \(ZO\)/i)).toBeInTheDocument();
    });

    const modalTextarea = screen.getByPlaceholderText(/Enter rejection reason or audit instruction…/i);
    await user.type(modalTextarea, 'Rate exceeds maximum cap');

    const saveRemarksBtn = screen.getByRole('button', { name: /save remarks/i });
    await user.click(saveRemarksBtn);

    // Click "Request Revision" header button
    const requestRevBtn = screen.getByRole('button', { name: /request revision/i });
    await user.click(requestRevBtn);

    // Confirmation dialog appears
    await waitFor(() => {
      expect(screen.getByText('Mandatory remarks')).toBeInTheDocument();
    });

    // Fill in header modal remarks
    const headerModalTextarea = screen.getByPlaceholderText('Enter the reason for this workflow action');
    await user.type(headerModalTextarea, 'Pls review line items');

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

  it('saves the final pending ZO decision before approving the header', async () => {
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
    const savedEstimate = {
      ...initialEstimate,
      updated_at: '2026-09-19T10:01:00.000Z',
      project_subcontract_estimate_lines: [{
        ...initialEstimate.project_subcontract_estimate_lines[0],
        zo_office_approve: 'Approve'
      }]
    };

    mockGetSubcontractEstimate.mockResolvedValue({ data: { estimate: initialEstimate } });
    mockReviewSubcontractEstimateRows.mockResolvedValue({ data: { estimate: savedEstimate } });
    mockTransitionSubcontractEstimateWorkflow.mockResolvedValue({
      data: { estimate: { ...savedEstimate, estimate_status: 'ZO Approved', updated_at: '2026-09-19T10:02:00.000Z' } }
    });

    render(
      <MemoryRouter>
        <SubcontractEstimateView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Pipe Laying')).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByRole('combobox'), 'Approve');
    await user.click(screen.getByRole('button', { name: 'Approve Header' }));

    await waitFor(() => {
      expect(mockReviewSubcontractEstimateRows).toHaveBeenCalledWith('est-123', {
        stage: 'ZO',
        approvals: [{ line_id: 'line-1', approve_status: 'Approve', remarks: null }],
        expected_updated_at: '2026-09-19T10:00:00.000Z'
      });
      expect(mockTransitionSubcontractEstimateWorkflow).toHaveBeenCalledWith('est-123', {
        action: 'ZO_APPROVE',
        remarks: null,
        expected_updated_at: '2026-09-19T10:01:00.000Z'
      });
    });
  });

  it('displays ZO and HO decisions and remarks separately without cross-stage fallbacks', async () => {
    mockUser = { role: 'ho', mobile_number: '+919876543210' };
    const estimateWithBothRemarks = {
      subcontract_estimate_id: 'est-123',
      work_order_no: 'WO-101',
      estimate_revision: 1,
      estimate_amount: 8000,
      estimate_status: 'Final Approved',
      updated_at: '2026-09-19T10:00:00.000Z',
      zo_remarks: 'ZO header approval note',
      ho_remarks: 'HO final authorization note',
      zo_approved_by: 'zo-user-1',
      ho_approved_by: 'ho-user-1',
      zo_approval_date: '2026-09-18T10:00:00.000Z',
      ho_approval_date: '2026-09-19T10:00:00.000Z',
      project_subcontract_estimate_lines: [
        {
          line_id: 'line-1',
          subcontractor_id: 'sub-1',
          subcontract_work_id: 'work-1',
          subcontractor: { subcontractor_name: 'Plumbing Experts', is_active: true },
          subcontract_work: { material_details: 'CPVC Fitting', unit: 'Mtr', is_active: true },
          qty: 20,
          rate: 400,
          amount: 8000,
          entry_kind: 'BASE',
          zo_office_approve: 'Approve',
          zo_remarks: 'ZO line audit verified',
          ho_office_approve: 'Approve',
          ho_remarks: 'HO line rate confirmed'
        }
      ]
    };

    mockGetSubcontractEstimate.mockResolvedValue({
      data: { estimate: estimateWithBothRemarks }
    });

    render(
      <MemoryRouter>
        <SubcontractEstimateView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('CPVC Fitting')).toBeInTheDocument();
    });

    // Verify ZO and HO remarks appear separately in their table columns
    expect(screen.getByText('ZO line audit verified')).toBeInTheDocument();
    expect(screen.getByText('HO line rate confirmed')).toBeInTheDocument();

    // Verify ZO and HO header cards display their distinct remarks
    expect(screen.getByText('ZO header approval note')).toBeInTheDocument();
    expect(screen.getByText('HO final authorization note')).toBeInTheDocument();
  });

  it('filters current lines by stage decision (All / Approve / Not Approve / Pending)', async () => {
    const user = userEvent.setup();
    const multiLineEstimate = {
      subcontract_estimate_id: 'est-123',
      work_order_no: 'WO-101',
      estimate_revision: 0,
      estimate_amount: 15000,
      estimate_status: 'Under ZO Review',
      updated_at: '2026-09-19T10:00:00.000Z',
      project_subcontract_estimate_lines: [
        {
          line_id: 'line-1',
          subcontractor: { subcontractor_name: 'Sub A', is_active: true },
          subcontract_work: { material_details: 'Line Approved', unit: 'Mtr' },
          qty: 10,
          rate: 500,
          amount: 5000,
          entry_kind: 'BASE',
          zo_office_approve: 'Approve',
          zo_remarks: null
        },
        {
          line_id: 'line-2',
          subcontractor: { subcontractor_name: 'Sub B', is_active: true },
          subcontract_work: { material_details: 'Line Rejected', unit: 'Nos' },
          qty: 5,
          rate: 1000,
          amount: 5000,
          entry_kind: 'BASE',
          zo_office_approve: 'Not Approve',
          zo_remarks: 'Too expensive'
        },
        {
          line_id: 'line-3',
          subcontractor: { subcontractor_name: 'Sub C', is_active: true },
          subcontract_work: { material_details: 'Line Pending', unit: 'Job' },
          qty: 1,
          rate: 5000,
          amount: 5000,
          entry_kind: 'BASE',
          zo_office_approve: null,
          zo_remarks: null
        }
      ]
    };

    mockGetSubcontractEstimate.mockResolvedValue({
      data: { estimate: multiLineEstimate }
    });

    render(
      <MemoryRouter>
        <SubcontractEstimateView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Line Approved')).toBeInTheDocument();
      expect(screen.getByText('Line Rejected')).toBeInTheDocument();
      expect(screen.getByText('Line Pending')).toBeInTheDocument();
    });

    // Filter to 'Approve'
    const approveFilterBtn = screen.getByRole('button', { name: 'Approve' });
    await user.click(approveFilterBtn);

    expect(screen.getByText('Line Approved')).toBeInTheDocument();
    expect(screen.queryByText('Line Rejected')).not.toBeInTheDocument();
    expect(screen.queryByText('Line Pending')).not.toBeInTheDocument();

    // Filter to 'Not Approve'
    const notApproveFilterBtn = screen.getByRole('button', { name: 'Not Approve' });
    await user.click(notApproveFilterBtn);

    expect(screen.queryByText('Line Approved')).not.toBeInTheDocument();
    expect(screen.getByText('Line Rejected')).toBeInTheDocument();
    expect(screen.queryByText('Line Pending')).not.toBeInTheDocument();

    // Filter to 'Pending'
    const pendingFilterBtn = screen.getByRole('button', { name: 'Pending' });
    await user.click(pendingFilterBtn);

    expect(screen.queryByText('Line Approved')).not.toBeInTheDocument();
    expect(screen.queryByText('Line Rejected')).not.toBeInTheDocument();
    expect(screen.getByText('Line Pending')).toBeInTheDocument();
  });

  it('opens History tab by default when estimate has only final-approved lines and displays approved summary on Current tab', async () => {
    const user = userEvent.setup();
    const finalApprovedEstimate = {
      subcontract_estimate_id: 'est-123',
      work_order_no: 'WO-101',
      estimate_revision: 0,
      estimate_amount: 25000,
      estimate_status: 'Final Approved',
      updated_at: '2026-09-19T10:00:00.000Z',
      project_subcontract_estimate_lines: [
        {
          line_id: 'line-hist-1',
          subcontractor_id: 'sub-1',
          subcontract_work_id: 'work-1',
          subcontractor: { subcontractor_name: 'Alpha Builders', is_active: true },
          subcontract_work: { material_details: 'Earth Excavation', unit: 'Cum', is_active: true },
          qty: 50,
          rate: 500,
          amount: 25000,
          entry_kind: 'BASE',
          final_approved_revision: 0,
          zo_office_approve: 'Approve',
          ho_office_approve: 'Approve'
        }
      ]
    };

    mockGetSubcontractEstimate.mockResolvedValue({
      data: { estimate: finalApprovedEstimate }
    });

    render(
      <MemoryRouter>
        <SubcontractEstimateView />
      </MemoryRouter>
    );

    // Should automatically open on History tab
    await waitFor(() => {
      expect(screen.getByText('Final Approved Contributions')).toBeInTheDocument();
    });
    expect(screen.getByText('Earth Excavation')).toBeInTheDocument();
    expect(screen.getByText('Rev 0')).toBeInTheDocument();

    // Switch to Current Working Estimate tab
    const currentTabBtn = screen.getByRole('button', { name: /Current Working Estimate/i });
    await user.click(currentTabBtn);

    // Should show the clear approved-estimate summary card with direct link
    await waitFor(() => {
      expect(screen.getByText('This Subcontract Estimate is Final Approved')).toBeInTheDocument();
    });
    expect(screen.getByText(/All 1 line items totaling/i)).toBeInTheDocument();

    // Click link back to history
    const viewHistoryLink = screen.getByRole('button', { name: /View Final Approved Lines in History/i });
    await user.click(viewHistoryLink);

    // History tab should be active again
    await waitFor(() => {
      expect(screen.getByText('Final Approved Contributions')).toBeInTheDocument();
    });
  });

  it('keeps row visible when decided in Pending filter mode so reviewer is not interrupted', async () => {
    const user = userEvent.setup();
    const pendingEstimate = {
      subcontract_estimate_id: 'est-123',
      work_order_no: 'WO-101',
      estimate_revision: 0,
      estimate_amount: 5000,
      estimate_status: 'Under ZO Review',
      updated_at: '2026-09-19T10:00:00.000Z',
      project_subcontract_estimate_lines: [
        {
          line_id: 'line-1',
          subcontractor: { subcontractor_name: 'Sub A', is_active: true },
          subcontract_work: { material_details: 'Uninterrupted Line', unit: 'Mtr' },
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
      data: { estimate: pendingEstimate }
    });

    render(
      <MemoryRouter>
        <SubcontractEstimateView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Uninterrupted Line')).toBeInTheDocument();
    });

    // Click Pending filter
    const pendingFilterBtn = screen.getByRole('button', { name: 'Pending' });
    await user.click(pendingFilterBtn);

    // Line is visible under Pending
    expect(screen.getByText('Uninterrupted Line')).toBeInTheDocument();

    // Mark as Not Approve
    const decisionSelect = screen.getByRole('combobox');
    await user.selectOptions(decisionSelect, 'Not Approve');

    // CRITICAL: Line must NOT vanish from under the reviewer's cursor!
    expect(screen.getByText('Uninterrupted Line')).toBeInTheDocument();

    // Reviewer can enter remarks without interruption
    const remarksInput = screen.getByPlaceholderText(/click to enter required reason/i);
    await user.click(remarksInput);

    await waitFor(() => {
      expect(screen.getByText(/Review Remarks \(ZO\)/i)).toBeInTheDocument();
    });

    const modalTextarea = screen.getByPlaceholderText(/Enter rejection reason or audit instruction…/i);
    await user.type(modalTextarea, 'Rate verification needed');

    const saveRemarksBtn = screen.getByRole('button', { name: /save remarks/i });
    await user.click(saveRemarksBtn);

    // Save Row Decisions should be enabled for partial save
    const saveRowDecisionsBtn = screen.getByRole('button', { name: /Save Row Decisions/i });
    expect(saveRowDecisionsBtn).toBeEnabled();
  });

  describe('Reopen Authorization (moved from HO to ZO)', () => {
    const finalApprovedEstimateWithHistory = {
      subcontract_estimate_id: 'est-123',
      work_order_no: 'WO-101',
      estimate_revision: 0,
      estimate_amount: 25000,
      estimate_status: 'Final Approved',
      updated_at: '2026-09-19T10:00:00.000Z',
      project_subcontract_estimate_lines: [
        {
          line_id: 'line-hist-1',
          subcontractor_id: 'sub-1',
          subcontract_work_id: 'work-1',
          subcontractor: { subcontractor_name: 'Alpha Builders', is_active: true },
          subcontract_work: { material_details: 'Earth Excavation', unit: 'Cum', is_active: true },
          qty: 50,
          rate: 500,
          amount: 25000,
          entry_kind: 'BASE',
          final_approved_revision: 0,
          zo_office_approve: 'Approve',
          ho_office_approve: 'Approve'
        }
      ]
    };

    it('renders Reopen button for ZO on Final Approved estimate and triggers reopen flow', async () => {
      const user = userEvent.setup();
      mockUser = { role: 'zo', mobile_number: '+918276071523' };
      mockGetSubcontractEstimate.mockResolvedValue({
        data: { estimate: finalApprovedEstimateWithHistory }
      });
      mockTransitionSubcontractEstimateWorkflow.mockResolvedValue({
        data: {
          estimate: {
            ...finalApprovedEstimateWithHistory,
            estimate_status: 'Estimate Reopened',
            updated_at: '2026-09-19T10:05:00.000Z'
          }
        }
      });

      render(
        <MemoryRouter>
          <SubcontractEstimateView />
        </MemoryRouter>
      );

      const reopenBtn = await screen.findByRole('button', { name: /^reopen$/i });
      expect(reopenBtn).toBeInTheDocument();

      await user.click(reopenBtn);

      // Dialog opens for remarks
      await waitFor(() => {
        expect(screen.getByText('Mandatory remarks')).toBeInTheDocument();
      });

      const remarksInput = screen.getByPlaceholderText('Enter the reason for this workflow action');
      await user.type(remarksInput, 'ZO needs to reopen this estimate');

      const confirmBtn = screen.getByRole('button', { name: /confirm/i });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockTransitionSubcontractEstimateWorkflow).toHaveBeenCalledWith('est-123', {
          action: 'REOPEN',
          remarks: 'ZO needs to reopen this estimate',
          expected_updated_at: '2026-09-19T10:00:00.000Z'
        });
      });
    });

    it('renders Reopen button for Admin on Final Approved estimate', async () => {
      mockUser = { role: 'admin', mobile_number: '+919999999999' };
      mockGetSubcontractEstimate.mockResolvedValue({
        data: { estimate: finalApprovedEstimateWithHistory }
      });

      render(
        <MemoryRouter>
          <SubcontractEstimateView />
        </MemoryRouter>
      );

      const reopenBtn = await screen.findByRole('button', { name: /^reopen$/i });
      expect(reopenBtn).toBeInTheDocument();
    });

    it('does NOT render Reopen button for HO role on Final Approved estimate', async () => {
      mockUser = { role: 'ho', mobile_number: '+917000000001' };
      mockGetSubcontractEstimate.mockResolvedValue({
        data: { estimate: finalApprovedEstimateWithHistory }
      });

      render(
        <MemoryRouter>
          <SubcontractEstimateView />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Final Approved Contributions')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /^reopen$/i })).not.toBeInTheDocument();
    });

    it('does NOT render Reopen button for JE role on Final Approved estimate', async () => {
      mockUser = { role: 'je', mobile_number: '+919000000001' };
      mockGetSubcontractEstimate.mockResolvedValue({
        data: { estimate: finalApprovedEstimateWithHistory }
      });

      render(
        <MemoryRouter>
          <SubcontractEstimateView />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Final Approved Contributions')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /^reopen$/i })).not.toBeInTheDocument();
    });
  });
});
