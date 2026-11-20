import React from 'react';
import { beforeEach, it, expect, vi, describe } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StatutoryAssignmentModal from './StatutoryAssignmentModal';
import * as api from '../../api/payrollProfilesApi';

vi.mock('../../api/payrollProfilesApi');

const employee1 = {
  id: 'emp-1',
  employee_code: 'EMP-001',
  employee_name: 'Anil Kumar',
  department: 'SNP Factory',
  employee_category: 'SNP Permanent Factory Labour',
  joining_date: '2026-08-01',
  profile_version: 0
};

const employee2 = {
  id: 'emp-2',
  employee_code: 'EMP-002',
  employee_name: 'Bijoy Das',
  department: 'Fabric Factory',
  employee_category: 'Fabric Factory Casual Factory Labour',
  joining_date: '2026-08-15',
  profile_version: 0
};

const setup1 = {
  id: 'setup-1',
  establishment_name: 'SNP Factory',
  state_name: 'Assam',
  effective_from: '2026-08-01',
  effective_to: null,
  epf_revision_id: 'epf-1',
  pt_revision_id: 'pt-1'
};

const mountModal = (props = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <StatutoryAssignmentModal
        isOpen={true}
        onClose={vi.fn()}
        selectedEmployees={[employee1, employee2]}
        user={{ id: 'acc-1', role: 'accounts', display_name: 'Accounts Admin' }}
        {...props}
      />
    </QueryClientProvider>
  );
};

describe('StatutoryAssignmentModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.previewCompanyDeductionSetup.mockImplementation(async ({ employees, effective_from }) => {
      const proposals = employees.map(({ employee_id }) => ({
        employee_id, requested_from: employee_id === employee1.id ? effective_from : '2026-08-15',
        effective_from: employee_id === employee1.id ? '2026-09-01' : '2026-08-15',
        pay_from: employee_id === employee1.id ? '2026-09-01' : null, issue: null,
      }));
      return { data: { result: { proposals, dates: Object.fromEntries(proposals.map(row => [row.employee_id, row.effective_from])) } } };
    });
    api.getCompanyDeductionSetups.mockResolvedValue({
      data: {
        result: {
          setups: [setup1],
          total: 1
        }
      }
    });
    api.applyCompanyDeductionSetup.mockResolvedValue({
      data: {
        result: {
          results: [
            { employee_id: 'emp-1', success: true, effective_from: '2026-08-01' },
            { employee_id: 'emp-2', success: true, effective_from: '2026-08-15' }
          ]
        }
      }
    });
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = mountModal({ isOpen: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders selected employees and applies deduction setup on confirmation', async () => {
    const onSuccess = vi.fn();
    mountModal({ onSuccess });

    expect(await screen.findByText('Assign Company Deduction Setup')).toBeInTheDocument();
    expect(screen.getByRole('dialog').parentElement).toBe(document.body);
    expect(screen.getByText('EMP-001')).toBeInTheDocument();
    expect(screen.getByText('EMP-002')).toBeInTheDocument();

    const deductionSetup = screen.getByLabelText('Company deduction setup');
    await waitFor(() => expect(deductionSetup).toBeEnabled());
    fireEvent.click(deductionSetup);
    fireEvent.click(screen.getByRole('button', { name: /SNP Factory · Assam/ }));
    expect(deductionSetup).toHaveTextContent('SNP Factory · Assam');

    // Change effective date
    fireEvent.change(screen.getByLabelText(/Effective start date/), { target: { value: '2026-08-01' } });

    // Confirmation checkbox
    const confirmCheckbox = screen.getByLabelText(/I confirm this setup and the proposed start dates apply/);
    expect(confirmCheckbox).not.toBeChecked();
    await waitFor(() => expect(confirmCheckbox).toBeEnabled());
    expect(screen.getByText(/Salary history starts 2026-09-01/)).toBeInTheDocument();
    fireEvent.click(confirmCheckbox);

    // Submit
    const applyButton = screen.getByRole('button', { name: 'Apply to 2 employees' });
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(api.applyCompanyDeductionSetup).toHaveBeenCalledWith({
        employees: [
          { employee_id: 'emp-1', expected_version: 0 },
          { employee_id: 'emp-2', expected_version: 0 }
        ],
        setup_id: 'setup-1',
        confirmed_dates: { 'emp-1': '2026-09-01', 'emp-2': '2026-08-15' },
        effective_from: '2026-08-01',
        evidence_reference: ''
      });
    });

    expect(await screen.findByText(/Assignment completed successfully!/)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalled();
  });

  it('displays red error alert when all assignments fail', async () => {
    api.applyCompanyDeductionSetup.mockResolvedValueOnce({
      data: {
        result: {
          results: [
            { employee_id: 'emp-1', success: false, status: 409, message: 'Setup version conflict' },
            { employee_id: 'emp-2', success: false, status: 409, message: 'Setup version conflict' }
          ]
        }
      }
    });

    mountModal();

    const trigger = screen.getByLabelText('Company deduction setup');
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /SNP Factory · Assam/ }));
    fireEvent.change(screen.getByLabelText(/Effective start date/), { target: { value: '2026-08-01' } });
    const confirm = screen.getByLabelText(/I confirm this setup and the proposed start dates apply/);
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 employees' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Assignment failed for all 2 employees/);
    expect(screen.getAllByText(/Failed \(409\) — Setup version conflict/)).toHaveLength(2);
  });

  it('requires and submits a separate state PT setup for EPF-only selections', async () => {
    const epf = { ...setup1, pt_revision_id: null, esi_revision_id: 'esi-1', state_name: 'Pan India' };
    const pt = { ...setup1, id: 'setup-pt', epf_revision_id: null, state_id: 'assam' };
    const other = { ...pt, id: 'other', establishment_name: 'Other factory' };
    api.getCompanyDeductionSetups.mockResolvedValue({ data: { result: { setups: [epf, pt, other], total: 3 } } });
    api.applyCompanyDeductionSetup.mockResolvedValue({ data: { result: { results: [] } } });
    mountModal();
    const primary = screen.getByLabelText('Company deduction setup');
    await waitFor(() => expect(primary).toBeEnabled());
    fireEvent.click(primary);
    const nationwide = screen.getByRole('button', { name: /SNP Factory · Pan India/ });
    expect(nationwide).toHaveTextContent(/EPF.*ESI/);
    expect(nationwide).not.toHaveTextContent(/PT/);
    expect(screen.getByRole('button', { name: /SNP Factory · Assam/ })).toHaveTextContent('PT');
    fireEvent.click(nationwide);
    expect(primary).not.toHaveTextContent(/EPF|ESI/);
    const secondary = screen.getByLabelText('Professional Tax setup');
    await waitFor(() => expect(secondary).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/Effective start date/), { target: { value: '2026-08-01' } });
    const apply = screen.getByRole('button', { name: 'Apply to 2 employees' });
    expect(apply).toBeDisabled();
    fireEvent.click(secondary);
    expect(screen.queryByRole('button', { name: /Other factory/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /SNP Factory · Assam/ }));
    const confirm = screen.getByLabelText(/I confirm this setup and the proposed start dates apply/);
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    fireEvent.click(apply);
    await waitFor(() => expect(api.applyCompanyDeductionSetup).toHaveBeenCalledWith(expect.objectContaining({
      setup_id: epf.id, pt_setup_id: pt.id, effective_from: '2026-08-01',
    })));
  });

  it('blocks confirmation when the proposed date has no salary coverage', async () => {
    api.previewCompanyDeductionSetup.mockResolvedValue({ data: { result: {
      proposals: [{
        employee_id: employee1.id, effective_from: '2026-08-01',
        issue: 'Salary history does not cover this start date.',
      }],
    } } });
    mountModal();
    const trigger = screen.getByLabelText('Company deduction setup');
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /SNP Factory · Assam/ }));
    fireEvent.change(screen.getByLabelText(/Effective start date/), { target: { value: '2026-08-01' } });
    expect(await screen.findByText(/Salary history does not cover/)).toBeInTheDocument();
    expect(screen.getByLabelText(/I confirm/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply to 2 employees' })).toBeDisabled();
  });

  it('closes when cancel button is clicked or Escape key is pressed', async () => {
    const onClose = vi.fn();
    mountModal({ onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
