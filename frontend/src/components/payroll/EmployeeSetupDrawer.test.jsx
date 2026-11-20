import React from 'react';
import { beforeEach, it, expect, vi, describe } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeSetupDrawer from './EmployeeSetupDrawer';
import { ModalProvider, useModalOverlay } from '../ModalContext';
import * as api from '../../api/payrollProfilesApi';

vi.mock('../../api/payrollProfilesApi');

const employeeId = 'emp-101';
const scope = 'scope-snp';

const interval = {
  effective_from: '2026-08-01',
  effective_to: null,
  verification_status: 'ADVISOR_VERIFIED',
  advisor_name: 'Earlier advisor',
  verification_reference: 'Accounts proof',
  verified_on: '2026-08-01',
  schemes: {
    EPF: { statutory_scope_id: scope, applicability: 'APPLICABLE', enrolled: true, basis_reference: 'Accounts proof' },
    ESI: { statutory_scope_id: scope, applicability: 'APPLICABLE', enrolled: true, basis_reference: 'Accounts proof' },
    PT: { statutory_scope_id: scope, applicability: 'APPLICABLE', enrolled: null, basis_reference: 'Accounts proof' }
  }
};

function DockState() { const { isModalOpen } = useModalOverlay(); return <span data-testid="dock-state">{isModalOpen ? 'hidden' : 'visible'}</span>; }
const mountDrawer = (props = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return render(
    <QueryClientProvider client={queryClient}><ModalProvider><DockState/>
      <EmployeeSetupDrawer
        employeeId={employeeId}
        onClose={vi.fn()}
        user={{ id: 'acc-1', role: 'accounts', display_name: 'Accounts Admin' }}
        employeeSummary={{
          employee_code: 'EMP-101',
          employee_name: 'Vikram Sarabhai',
          department: 'SNP Factory',
          employee_category: 'SNP Permanent Factory Labour'
        }}
        {...props}
      />
    </ModalProvider></QueryClientProvider>
  );
};

describe('EmployeeSetupDrawer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getEmployeeStatutoryProfiles.mockResolvedValue({
      data: {
        result: {
          version: 1,
          employee_code: 'EMP-101',
          employee_name: 'Vikram Sarabhai',
          department: 'SNP Factory',
          employee_category: 'SNP Permanent Factory Labour',
          enrolment_managed_by_pay_structure: true,
          epf_enrolment: true,
          esi_enrolment: true,
          revisions: [{ version: 1, created_at: '2026-08-01', intervals: [interval] }]
        }
      }
    });
    api.getCompanyDeductionSetups.mockResolvedValue({
      data: {
        result: {
          setups: [{
            id: 'setup-1',
            establishment_name: 'SNP Factory',
            state_name: 'Assam',
            effective_from: '2026-08-01',
            effective_to: null,
            pt_revision_id: 'pt-1'
          }],
          total: 1
        }
      }
    });
    api.recordEmployeeStatutoryProfiles.mockResolvedValue({
      data: { result: { version: 2 } }
    });
  });

  it('renders nothing when employeeId is empty', () => {
    mountDrawer({ employeeId: '' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('dock-state')).toHaveTextContent('visible');
  });

  it('renders employee history, audit log, and enrolment overview', async () => {
    mountDrawer();

    expect(await screen.findByText(/Active Setup v1/)).toBeInTheDocument();
    expect(screen.getAllByText(/Enrolled \(Pay Structure\)/)).toHaveLength(2);
    expect(screen.getByText('Setup History & Audit Log')).toBeInTheDocument();
    expect(screen.getByText('Change employee setup')).toBeInTheDocument();
  });

  it('opens interval editor and saves dated statutory profile', async () => {
    mountDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Change employee setup' }));

    expect(screen.getByText('Configure Dated Changes')).toBeInTheDocument();
    expect(screen.getByText('Add dated change')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/I confirm these dated employee deduction settings/));
    fireEvent.click(screen.getByRole('button', { name: 'Save employee setup' }));

    await waitFor(() => {
      expect(api.recordEmployeeStatutoryProfiles).toHaveBeenCalledWith(
        'emp-101',
        expect.objectContaining({
          expected_version: 1,
          intervals: expect.any(Array)
        })
      );
    });

    expect(await screen.findByText(/Employee payroll setup saved/)).toBeInTheDocument();
  });

  it('disables editing for local daily-wage workers', async () => {
    api.getEmployeeStatutoryProfiles.mockResolvedValueOnce({
      data: {
        result: {
          version: 0,
          employee_code: 'EMP-101',
          employee_name: 'Vikram Sarabhai',
          department: 'SNP Factory',
          employee_category: 'Local Daily-Wage Workers',
          revisions: []
        }
      }
    });

    mountDrawer({
      employeeSummary: {
        employee_code: 'EMP-101',
        employee_name: 'Vikram Sarabhai',
        department: 'SNP Factory',
        employee_category: 'Local Daily-Wage Workers'
      }
    });

    expect(await screen.findByText('No deduction setup required for Local Daily-Wage Workers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change employee setup' })).toBeDisabled();
  });

  it('prevents Escape and close button from dismissing an in-flight save', async () => {
    const onClose = vi.fn();
    api.recordEmployeeStatutoryProfiles.mockImplementation(() => new Promise(() => {}));
    mountDrawer({ onClose });
    fireEvent.click(await screen.findByRole('button', { name: 'Change employee setup' }));
    fireEvent.click(screen.getByLabelText(/I confirm these dated employee deduction settings/));
    fireEvent.click(screen.getByRole('button', { name: 'Save employee setup' }));
    await waitFor(() => expect(screen.getByLabelText('Close employee setup')).toBeDisabled());
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('Close employee setup'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses the shared portal and hides the dock while open', async () => {
    const view = mountDrawer();
    const dialog = await screen.findByRole('dialog', { name: 'Employee statutory setup details' });
    expect(view.container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
    expect(screen.getByTestId('dock-state')).toHaveTextContent('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Close button click and Escape key', async () => {
    const onClose = vi.fn();
    mountDrawer({ onClose });

    fireEvent.click(await screen.findByLabelText('Close employee setup'));
    expect(onClose).toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
