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
    expect(screen.getByText('EMP-001')).toBeInTheDocument();
    expect(screen.getByText('EMP-002')).toBeInTheDocument();

    // Select deduction setup
    await screen.findByRole('option', { name: /SNP Factory · Assam/ });
    fireEvent.change(screen.getByLabelText('Company deduction setup'), { target: { value: 'setup-1' } });

    // Change effective date
    fireEvent.change(screen.getByLabelText(/Effective start date/), { target: { value: '2026-08-01' } });

    // Confirmation checkbox
    const confirmCheckbox = screen.getByLabelText(/I confirm this setup and start date apply/);
    expect(confirmCheckbox).not.toBeChecked();
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

    await screen.findByRole('option', { name: /SNP Factory · Assam/ });
    fireEvent.change(screen.getByLabelText('Company deduction setup'), { target: { value: 'setup-1' } });
    fireEvent.change(screen.getByLabelText(/Effective start date/), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByLabelText(/I confirm this setup and start date apply/));

    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 employees' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Assignment failed for all 2 employees/);
    expect(screen.getAllByText(/Failed \(409\) — Setup version conflict/)).toHaveLength(2);
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
