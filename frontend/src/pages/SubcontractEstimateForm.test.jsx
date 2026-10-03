import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubcontractEstimateForm from './SubcontractEstimateForm';

const mockNavigate = vi.fn();
let mockParams = {};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams
  };
});

vi.mock('../components/ThemeContext', () => ({
  useTheme: () => ({ isDark: true })
}));

const mockCreateSubcontractEstimate = vi.fn();
const mockGetSubcontractEstimate = vi.fn();
const mockGetSubcontractEstimateInit = vi.fn();
const mockReconcileSubcontractEstimateLines = vi.fn();
const mockTransitionSubcontractEstimateWorkflow = vi.fn();

vi.mock('../api/subcontractEstimatesApi', () => ({
  createSubcontractEstimate: (...args) => mockCreateSubcontractEstimate(...args),
  getSubcontractEstimate: (...args) => mockGetSubcontractEstimate(...args),
  getSubcontractEstimateInit: (...args) => mockGetSubcontractEstimateInit(...args),
  reconcileSubcontractEstimateLines: (...args) => mockReconcileSubcontractEstimateLines(...args),
  transitionSubcontractEstimateWorkflow: (...args) => mockTransitionSubcontractEstimateWorkflow(...args)
}));

const mockGetSubcontractors = vi.fn();
const mockFetchAllActiveSubcontractors = vi.fn();

vi.mock('../api/subcontractMastersApi', () => ({
  getSubcontractors: (...args) => mockGetSubcontractors(...args),
  fetchAllActiveSubcontractors: (...args) => mockFetchAllActiveSubcontractors(...args)
}));

const sampleSubcontractors = [
  {
    id: 'sub-alpha',
    subcontractor_name: 'Alpha Infra',
    is_active: true,
    capabilities: [
      {
        id: 'cap-1',
        subcontract_work_id: 'work-pipe',
        subcontract_work: { id: 'work-pipe', sub_head: 'Civil', material_details: 'Pipe Laying', unit: 'Mtr', is_active: true }
      },
      {
        id: 'cap-2',
        subcontract_work_id: 'work-excavation',
        subcontract_work: { id: 'work-excavation', sub_head: 'Earthwork', material_details: 'Excavation', unit: 'Cum', is_active: true }
      }
    ]
  },
  {
    id: 'sub-beta',
    subcontractor_name: 'Beta Construction',
    is_active: true,
    capabilities: [
      {
        id: 'cap-3',
        subcontract_work_id: 'work-welding',
        subcontract_work: { id: 'work-welding', sub_head: 'Mechanical', material_details: 'Welding Joint', unit: 'Nos', is_active: true }
      }
    ]
  }
];

function renderForm(queryClient) {
  const client = queryClient || new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SubcontractEstimateForm />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SubcontractEstimateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = {};

    mockGetSubcontractEstimateInit.mockResolvedValue({
      data: {
        success: true,
        availableWorkOrders: [
          { work_order_no: 'WO-101', site_details: 'Site Central' }
        ]
      }
    });

    mockFetchAllActiveSubcontractors.mockResolvedValue(sampleSubcontractors);
  });

  it('performs zero master-data requests when editing unrelated form fields', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } }
    });

    renderForm(queryClient);

    // Initial load calls fetchAllActiveSubcontractors once
    await waitFor(() => {
      expect(mockFetchAllActiveSubcontractors).toHaveBeenCalledTimes(1);
    });

    // Add a line
    const addLineButtons = screen.getAllByRole('button', { name: /\+ Add Line/i });
    await user.click(addLineButtons[0]);

    // Fill Qty
    const qtyInput = screen.getByPlaceholderText('Qty');
    await user.type(qtyInput, '15.5');

    // Fill Rate
    const rateInput = screen.getByPlaceholderText('Rate');
    await user.type(rateInput, '320');

    // Fill Remarks
    const remarksInput = screen.getByPlaceholderText('Remarks / scope');
    await user.type(remarksInput, 'Standard site execution');

    // Verify master data fetcher was NOT called again
    expect(mockFetchAllActiveSubcontractors).toHaveBeenCalledTimes(1);
  });

  it('correctly cascades contractor capabilities and clears work when contractor changes', async () => {
    const user = userEvent.setup();
    renderForm();

    await waitFor(() => {
      expect(screen.getByText('New Subcontract Estimate')).toBeInTheDocument();
    });

    // Add a line item
    const addButtons = screen.getAllByRole('button', { name: /\+ Add Line/i });
    await user.click(addButtons[0]);

    // Find the Subcontract Work select: initially disabled because no subcontractor is selected
    const workSelect = screen.getByDisplayValue('Select subcontractor first');
    expect(workSelect).toBeDisabled();

    // Type in the SearchableSelect to pick "Alpha Infra"
    const subInput = screen.getByPlaceholderText('Search active subcontractor…');
    await user.type(subInput, 'Alpha');

    // Pick Alpha from dropdown
    const alphaOption = await screen.findByRole('button', { name: 'Alpha Infra' });
    await user.click(alphaOption);

    // Now Subcontract Work select should be enabled and contain Pipe Laying and Excavation
    await waitFor(() => {
      expect(screen.getByText('Pipe Laying · Mtr')).toBeInTheDocument();
      expect(screen.getByText('Excavation · Cum')).toBeInTheDocument();
    });
    expect(screen.queryByText('Welding Joint · Nos')).not.toBeInTheDocument();

    // Select "Pipe Laying"
    const workSelectEl = screen.getAllByRole('combobox').find(el => el.querySelector('option[value="work-pipe"]'));
    await user.selectOptions(workSelectEl, 'work-pipe');
    expect(workSelectEl).toHaveValue('work-pipe');

    // Now change contractor to "Beta Construction"
    await user.clear(subInput);
    await user.type(subInput, 'Beta');

    const betaOption = await screen.findByRole('button', { name: 'Beta Construction' });
    await user.click(betaOption);

    // Verify that the previously selected work is cleared and work select now displays Beta's capability (Welding)
    await waitFor(() => {
      expect(screen.getByText('Welding Joint · Nos')).toBeInTheDocument();
    });
    expect(screen.queryByText('Pipe Laying · Mtr')).not.toBeInTheDocument();
  });

  it('clears committed subcontractor_id and work type when visible text diverges from committed contractor', async () => {
    const user = userEvent.setup();
    renderForm();

    await waitFor(() => {
      expect(mockFetchAllActiveSubcontractors).toHaveBeenCalled();
    });

    const addButtons = screen.getAllByRole('button', { name: /\+ Add Line/i });
    await user.click(addButtons[0]);

    const subInput = screen.getByPlaceholderText('Search active subcontractor…');
    await user.type(subInput, 'Alpha');

    const alphaOption = await screen.findByRole('button', { name: 'Alpha Infra' });
    await user.click(alphaOption);

    // Work select is enabled
    await waitFor(() => {
      expect(screen.getByText('Pipe Laying · Mtr')).toBeInTheDocument();
    });

    // Now modify the search input text so it no longer matches "Alpha Infra"
    await user.type(subInput, 'XYZ');

    // Work select should immediately be disabled / reverted to "Select subcontractor first"
    await waitFor(() => {
      expect(screen.getByDisplayValue('Select subcontractor first')).toBeInTheDocument();
    });
  });

  it('preserves saved estimate on workflow failure and allows retrying submission without duplicating records', async () => {
    const user = userEvent.setup();

    mockCreateSubcontractEstimate.mockResolvedValueOnce({
      data: {
        success: true,
        estimate: {
          subcontract_estimate_id: 'est-uuid-42',
          work_order_no: 'WO-101',
          estimate_status: 'Draft',
          updated_at: '2026-09-19T10:00:00Z',
          project_subcontract_estimate_lines: []
        }
      }
    });

    mockReconcileSubcontractEstimateLines.mockResolvedValue({
      data: {
        success: true,
        estimate: {
          subcontract_estimate_id: 'est-uuid-42',
          work_order_no: 'WO-101',
          estimate_status: 'Draft',
          updated_at: '2026-09-19T10:00:05Z',
          project_subcontract_estimate_lines: [
            { line_id: 'line-1', subcontractor_id: 'sub-alpha', subcontract_work_id: 'work-pipe', qty: '10', rate: '200' }
          ]
        }
      }
    });

    // Workflow transition fails on the first attempt
    mockTransitionSubcontractEstimateWorkflow.mockRejectedValueOnce(
      new Error('Workflow engine temporary outage')
    );

    renderForm();

    await waitFor(() => {
      expect(screen.getByText('Select Work Order')).toBeInTheDocument();
    });

    // Select Work Order
    const woSelect = screen.getByLabelText(/Work Order/i);
    await user.selectOptions(woSelect, 'WO-101');

    // Add Line
    const addButtons = screen.getAllByRole('button', { name: /\+ Add Line/i });
    await user.click(addButtons[0]);

    // Select contractor Alpha
    const subInput = screen.getByPlaceholderText('Search active subcontractor…');
    await user.type(subInput, 'Alpha');
    const alphaOption = await screen.findByRole('button', { name: 'Alpha Infra' });
    await user.click(alphaOption);

    // Select work
    await waitFor(() => {
      expect(screen.getByText('Pipe Laying · Mtr')).toBeInTheDocument();
    });
    const workSelect = screen.getAllByRole('combobox').find(el => el.querySelector('option[value="work-pipe"]'));
    await user.selectOptions(workSelect, 'work-pipe');

    // Fill Qty and Rate
    await user.type(screen.getByPlaceholderText('Qty'), '10');
    await user.type(screen.getByPlaceholderText('Rate'), '200');

    // Click Submit Estimate in header
    const submitBtn = screen.getAllByRole('button', { name: /Submit Estimate/i })[0];
    await user.click(submitBtn);

    // Confirmation modal appears
    expect(screen.getByText(/Submit Subcontract Estimate\?/i)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /Confirm & Submit/i });
    await user.click(confirmBtn);

    // Save succeeded, but workflow transition failed
    await waitFor(() => {
      expect(mockCreateSubcontractEstimate).toHaveBeenCalledTimes(1);
      expect(mockReconcileSubcontractEstimateLines).toHaveBeenCalledTimes(1);
      expect(mockTransitionSubcontractEstimateWorkflow).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Workflow engine temporary outage/i)).toBeInTheDocument();
    });

    // Route updated to edit URL
    expect(mockNavigate).toHaveBeenCalledWith('/subcontract-estimates/est-uuid-42/edit', { replace: true });

    // Now workflow transition succeeds on retry
    mockTransitionSubcontractEstimateWorkflow.mockResolvedValueOnce({
      data: { success: true }
    });

    // User clicks Submit Estimate again
    await user.click(submitBtn);
    const retryConfirmBtn = screen.getByRole('button', { name: /Confirm & Submit/i });
    await user.click(retryConfirmBtn);

    await waitFor(() => {
      // CRITICAL: createSubcontractEstimate must NOT be called again (no duplicate records!)
      expect(mockCreateSubcontractEstimate).toHaveBeenCalledTimes(1);
      // Reconcile and transition called with the existing estimate ID
      expect(mockReconcileSubcontractEstimateLines).toHaveBeenCalledTimes(2);
      expect(mockTransitionSubcontractEstimateWorkflow).toHaveBeenCalledTimes(2);
      expect(mockNavigate).toHaveBeenCalledWith('/subcontract-estimates/est-uuid-42');
    });
  });

  it('identifies rows needing correction vs protected rows, displays stage remarks, and tracks session corrections', async () => {
    const user = userEvent.setup();
    mockParams = { id: 'est-rev-1' };

    mockGetSubcontractEstimate.mockResolvedValueOnce({
      data: {
        estimate: {
          subcontract_estimate_id: 'est-rev-1',
          work_order_no: 'WO-101',
          estimate_status: 'ZO Revision Requested',
          estimate_revision: 1,
          zo_remarks: 'Please lower pipe rate to 350',
          ho_remarks: 'HO previous remark',
          updated_at: '2026-09-19T10:00:00Z',
          project_subcontract_estimate_lines: [
            {
              line_id: 'line-rejected',
              subcontractor_id: 'sub-alpha',
              subcontractor: sampleSubcontractors[0],
              subcontract_work_id: 'work-pipe',
              subcontract_work: sampleSubcontractors[0].capabilities[0].subcontract_work,
              qty: '10',
              rate: '500',
              amount: '5000',
              entry_kind: 'BASE',
              zo_office_approve: 'Not Approve',
              zo_remarks: 'Rate too high, max is 350'
            },
            {
              line_id: 'line-approved',
              subcontractor_id: 'sub-beta',
              subcontractor: sampleSubcontractors[1],
              subcontract_work_id: 'work-welding',
              subcontract_work: sampleSubcontractors[1].capabilities[0].subcontract_work,
              qty: '5',
              rate: '100',
              amount: '500',
              entry_kind: 'BASE',
              zo_office_approve: 'Approve',
              zo_remarks: 'Acceptable'
            }
          ]
        }
      }
    });

    renderForm();

    // Verify stage remarks in banner (ZO remarks, no fallback to HO)
    await waitFor(() => {
      expect(screen.getByText('ZO Revision Remarks:')).toBeInTheDocument();
      expect(screen.getByText('Please lower pipe rate to 350')).toBeInTheDocument();
      expect(screen.queryByText('HO previous remark')).not.toBeInTheDocument();
    });

    // Verify row statuses
    expect(screen.getByText('Requires Correction')).toBeInTheDocument();
    expect(screen.getByText(/ZO: Rate too high, max is 350/i)).toBeInTheDocument();
    expect(screen.getByText('Protected')).toBeInTheDocument();

    // Edit the rate on the rejected line
    const rateInputs = screen.getAllByPlaceholderText('Rate');
    await user.clear(rateInputs[0]);
    await user.type(rateInputs[0], '350');

    // (Corrected) indicator should appear for line-rejected
    await waitFor(() => {
      expect(screen.getByText('(Corrected)')).toBeInTheDocument();
    });
  });

  it('allows editing HO-rejected row in HO Revision Requested even if ZO approved it', async () => {
    mockParams = { id: 'est-ho-rev' };

    mockGetSubcontractEstimate.mockResolvedValueOnce({
      data: {
        estimate: {
          subcontract_estimate_id: 'est-ho-rev',
          work_order_no: 'WO-101',
          estimate_status: 'HO Revision Requested',
          estimate_revision: 1,
          zo_remarks: 'ZO approved earlier',
          ho_remarks: 'HO rejected rate on welding',
          updated_at: '2026-09-19T10:00:00Z',
          project_subcontract_estimate_lines: [
            {
              line_id: 'line-ho-rejected',
              subcontractor_id: 'sub-beta',
              subcontractor: sampleSubcontractors[1],
              subcontract_work_id: 'work-welding',
              subcontract_work: sampleSubcontractors[1].capabilities[0].subcontract_work,
              qty: '5',
              rate: '100',
              amount: '500',
              entry_kind: 'BASE',
              zo_office_approve: 'Approve', // Passed ZO
              ho_office_approve: 'Not Approve', // But rejected by HO!
              ho_remarks: 'Rate exceeds HO standard schedule'
            }
          ]
        }
      }
    });

    renderForm();

    await waitFor(() => {
      expect(screen.getByText('HO Revision Remarks:')).toBeInTheDocument();
      expect(screen.getByText('HO rejected rate on welding')).toBeInTheDocument();
    });

    // Row should show "Requires Correction" with HO remark
    expect(screen.getByText('Requires Correction')).toBeInTheDocument();
    expect(screen.getByText(/HO: Rate exceeds HO standard schedule/i)).toBeInTheDocument();

    // Line inputs must NOT be disabled (backend permits correction of HO-rejected row)
    const rateInput = screen.getByPlaceholderText('Rate');
    expect(rateInput).not.toBeDisabled();
  });
});
