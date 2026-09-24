import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModalProvider } from '../../components/ModalContext';
import EmployeeManagement from './EmployeeManagement';
import { CATEGORIES, DEPARTMENTS } from './employeeConstants';
import authApi from '../../api/authApi';

vi.mock('../../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

const mockEmployees = [
  {
    id: 'emp-1-uuid',
    employee_code: 'EMP-001',
    employee_name: 'Amit Sharma',
    employee_category: 'HO Staff',
    department: 'Head Office',
    contact_number: '9876543210',
    erp_user_id: 'usr-admin-uuid',
    joining_date: '2025-01-15',
    active_status: 'Active',
    erp_user: {
      id: 'usr-admin-uuid',
      display_name: 'Amit (Admin)',
      role: 'admin',
      is_active: true
    }
  },
  {
    id: 'emp-2-uuid',
    employee_code: 'EMP-002',
    employee_name: 'Raju Yadav',
    employee_category: 'Local Daily-Wage Workers',
    department: 'Projects',
    contact_number: null,
    erp_user_id: null,
    joining_date: '2025-03-01',
    active_status: 'Active',
    erp_user: null
  }
];

const mockErpUsers = [
  {
    id: 'usr-admin-uuid',
    display_name: 'Amit (Admin)',
    role: 'admin',
    mobile_number: '9876543210',
    is_active: true
  },
  {
    id: 'usr-je-uuid',
    display_name: 'Priya Engineer',
    role: 'je',
    mobile_number: '9811122233',
    is_active: true
  }
];

const mockPayStructure = {
  employee: mockEmployees[0],
  active_structure: {
    id: 'ps-active-uuid',
    employee_id: 'emp-1-uuid',
    revision_number: 1,
    pay_basis: 'Monthly salary',
    guaranteed_monthly_gross: 50000,
    basic_salary: 30000,
    staff_welfare: 5000,
    other_fixed_components: 5000,
    epf_enrolment: true,
    esi_enrolment: false,
    status: 'Active',
    effective_from: '2025-01-15'
  },
  revisions: [
    {
      id: 'ps-active-uuid',
      employee_id: 'emp-1-uuid',
      revision_number: 1,
      pay_basis: 'Monthly salary',
      guaranteed_monthly_gross: 50000,
      basic_salary: 30000,
      staff_welfare: 5000,
      other_fixed_components: 5000,
      epf_enrolment: true,
      esi_enrolment: false,
      status: 'Active',
      updated_at: '2025-01-15T10:00:00.000Z'
    }
  ]
};

function renderWithClient(ui, initialEntries = ['/admin/employee-management']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ModalProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/admin/employee-management" element={ui} />
          </Routes>
        </MemoryRouter>
      </ModalProvider>
    </QueryClientProvider>
  );
}

describe('Phase 1 Employee Management Component Contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authApi.get.mockImplementation((url, config) => {
      if (url === '/hr/employees') {
        return Promise.resolve({
          data: {
            success: true,
            employees: mockEmployees,
            pagination: { page: 1, totalPages: 1, totalItems: 2, limit: 15 }
          }
        });
      }
      if (url === '/hr/employees/erp-users') {
        const role = config?.params?.role;
        const users = role
          ? mockErpUsers.filter((u) => u.role === role)
          : mockErpUsers;
        return Promise.resolve({
          data: { success: true, users, pagination: { page: 1, totalPages: 1, totalItems: users.length } }
        });
      }
      if (url.startsWith('/hr/pay-structures/employees/')) {
        return Promise.resolve({
          data: { success: true, ...mockPayStructure }
        });
      }
      return Promise.resolve({ data: { success: true } });
    });

    authApi.post.mockResolvedValue({
      data: {
        success: true,
        employee: {
          id: 'emp-new-uuid',
          employee_code: 'EMP-003',
          employee_name: 'Sunil Verma',
          employee_category: 'Projects Department Employees',
          department: 'Projects',
          active_status: 'Active'
        }
      }
    });

    authApi.patch.mockResolvedValue({
      data: {
        success: true,
        employee: { ...mockEmployees[0], active_status: 'Inactive' }
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Employee Management layout with exactly two tabs', async () => {
    renderWithClient(<EmployeeManagement />);

    expect(screen.getByRole('heading', { level: 1, name: /Employee Management/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Employee & Worker Master/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Permanent Employee Pay Structure/i })).toBeInTheDocument();
  });

  it('renders Employee Directory table with exactly 9 columns in strict order ending in Active Status', async () => {
    renderWithClient(<EmployeeManagement />);

    await waitFor(() => {
      expect(screen.getByText('EMP-001')).toBeInTheDocument();
    });

    // Verify exactly 9 table headers in exact order
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(9);

    const expectedColumns = [
      'Employee ID',
      'Employee Name',
      'Employee Category',
      'Department / Function',
      'Contact Number',
      'Existing ERP Role',
      'Existing ERP Account',
      'Joining Date',
      'Active Status'
    ];

    expectedColumns.forEach((colName, idx) => {
      expect(headers[idx]).toHaveTextContent(colName);
    });

    // Active Status MUST remain the last data column
    expect(headers[8]).toHaveTextContent('Active Status');
  });

  it('contains the approved 6 category labels and 5 department options', () => {
    const expectedCategories = [
      'HO Staff',
      'Fabric Factory Permanent Employees',
      'SNP Casual Factory Labour',
      'SNP Permanent Factory Labour',
      'Projects Department Employees',
      'Local Daily-Wage Workers'
    ];
    expect(CATEGORIES).toEqual(expectedCategories);

    const expectedDepartments = [
      'Head Office',
      'Accounts',
      'Fabric Factory',
      'Manufacturing Factory',
      'Projects'
    ];
    expect(DEPARTMENTS).toEqual(expectedDepartments);
  });

  it('opens Add Employee modal with role-filtered ERP account linking', async () => {
    const user = userEvent.setup();
    renderWithClient(<EmployeeManagement />);

    await waitFor(() => {
      expect(screen.getByText('EMP-001')).toBeInTheDocument();
    });

    const addBtn = screen.getByRole('button', { name: /Add Employee/i });
    await user.click(addBtn);

    expect(screen.getByRole('heading', { name: /Add New Employee/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. Ramesh Chandra Sen/i)).toBeInTheDocument();
    expect(screen.getByText(/ERP Account Linking \(Optional\)/i)).toBeInTheDocument();

    // Select ERP Role to trigger filtered account fetching
    const roleSelect = screen.getByLabelText(/Filter by ERP Role/i);
    await user.selectOptions(roleSelect, 'admin');

    await waitFor(() => {
      expect(authApi.get).toHaveBeenCalledWith('/hr/employees/erp-users', expect.objectContaining({
        params: expect.objectContaining({ role: 'admin' })
      }));
    });
  });

  it('opens employee detail inspection modal on row click with navigation to Pay Structure for permanent category', async () => {
    const user = userEvent.setup();
    renderWithClient(<EmployeeManagement />);

    await waitFor(() => {
      expect(screen.getByText('EMP-001')).toBeInTheDocument();
    });

    const emp1Cell = screen.getByText('EMP-001');
    await user.click(emp1Cell);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Employee Details — EMP-001/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Maintain Pay Structure/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change Status/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit Employee/i })).toBeInTheDocument();

    const payStructureBtn = screen.getByRole('button', { name: /Maintain Pay Structure/i });
    await user.click(payStructureBtn);

    // Switches tab to Permanent Employee Pay Structure
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Permanent Employee Pay Structure/i })).toBeInTheDocument();
    });
  });

  it('renders Permanent Employee Pay Structure with 11 approved fields and validates component reconciliation', async () => {
    const user = userEvent.setup();
    renderWithClient(<EmployeeManagement />, ['/admin/employee-management?tab=pay-structure&employeeId=emp-1-uuid']);

    await waitFor(() => {
      expect(screen.getByText('Current Active Pay Structure')).toBeInTheDocument();
    });

    // Check presence of approved fields
    expect(screen.getByText(/1\. Employee ID/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Employee Name/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Permanent Employee Category/i)).toBeInTheDocument();
    expect(screen.getByText(/4\. Pay Basis/i)).toBeInTheDocument();
    expect(screen.getAllByText(/5\. Guaranteed Monthly Gross/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/6\. Basic Salary/i)).toBeInTheDocument();
    expect(screen.getByText(/7\. Staff Welfare/i)).toBeInTheDocument();
    expect(screen.getByText(/8\. Other Fixed Components/i)).toBeInTheDocument();
    expect(screen.getByText(/9\. EPF Enrolment/i)).toBeInTheDocument();
    expect(screen.getByText(/10\. ESI Enrolment/i)).toBeInTheDocument();
    expect(screen.getByText(/11\. Pay Structure Status/i)).toBeInTheDocument();

    // Verify removed workbook fields do not appear
    expect(screen.queryByText(/Annual Package/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Salary Effective From/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Payment Method/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Payment Details Verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bank Account/i)).not.toBeInTheDocument();

    // Click "Create New Revision"
    const newRevBtn = screen.getByRole('button', { name: /Create New Revision/i });
    await user.click(newRevBtn);

    expect(screen.getByRole('heading', { name: /Configure Pay Structure Revision/i })).toBeInTheDocument();

    // Test component reconciliation: set gross to 20000 and basic to 25000
    const grossInput = screen.getByPlaceholderText(/e\.g\. 45000/i);
    const basicInput = screen.getByLabelText(/6\. Basic Salary/i);

    await user.clear(grossInput);
    await user.type(grossInput, '20000');

    await user.clear(basicInput);
    await user.type(basicInput, '25000');

    // Reconciliation warning should appear and submit button disabled
    await waitFor(() => {
      expect(screen.getByText(/Exceeds Gross by/i)).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /Save Pay Structure/i });
    expect(submitBtn).toBeDisabled();
  });

  it('handles employee deactivation and reactivation status updates', async () => {
    const user = userEvent.setup();
    renderWithClient(<EmployeeManagement />);

    await waitFor(() => {
      expect(screen.getByText('EMP-001')).toBeInTheDocument();
    });

    // Click on EMP-001 cell to open inspection modal
    await user.click(screen.getByText('EMP-001'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Employee Details — EMP-001/i })).toBeInTheDocument();
    });

    // Click Change Status button
    const changeStatusBtn = screen.getByRole('button', { name: /Change Status/i });
    await user.click(changeStatusBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Change Status — EMP-001/i })).toBeInTheDocument();
    });

    // Select Inactive and submit
    const statusModalHeading = screen.getByRole('heading', { name: /Change Status — EMP-001/i });
    const statusModal = statusModalHeading.closest('.glass-panel');
    const statusSelect = within(statusModal).getByRole('combobox');
    await user.selectOptions(statusSelect, 'Inactive');

    const updateBtn = within(statusModal).getByRole('button', { name: /Update Status/i });
    await user.click(updateBtn);

    await waitFor(() => {
      expect(authApi.patch).toHaveBeenCalledWith('/hr/employees/emp-1-uuid/status', {
        active_status: 'Inactive'
      });
    });
  });

  it('handles pay structure draft activation via API', async () => {
    const user = userEvent.setup();

    // Mock pay structure with an existing pending draft
    authApi.get.mockImplementation((url) => {
      if (url === '/hr/employees') {
        return Promise.resolve({
          data: {
            success: true,
            employees: mockEmployees,
            pagination: { page: 1, totalPages: 1, totalItems: 2, limit: 15 }
          }
        });
      }
      if (url.startsWith('/hr/pay-structures/employees/')) {
        return Promise.resolve({
          data: {
            success: true,
            employee: mockEmployees[0],
            active_structure: mockPayStructure.active_structure,
            revisions: [
              mockPayStructure.active_structure,
              {
                id: 'ps-draft-uuid',
                employee_id: 'emp-1-uuid',
                revision_number: 2,
                pay_basis: 'Monthly salary',
                guaranteed_monthly_gross: 55000,
                basic_salary: 32000,
                staff_welfare: 5000,
                other_fixed_components: 5000,
                epf_enrolment: true,
                esi_enrolment: false,
                status: 'Draft',
                updated_at: '2025-02-01T10:00:00.000Z'
              }
            ]
          }
        });
      }
      return Promise.resolve({ data: { success: true } });
    });

    renderWithClient(<EmployeeManagement />, ['/admin/employee-management?tab=pay-structure&employeeId=emp-1-uuid']);

    await waitFor(() => {
      expect(screen.getByText(/Pending Draft Revision #2/i)).toBeInTheDocument();
    });

    const activateBtn = screen.getByRole('button', { name: /Activate Revision/i });
    await user.click(activateBtn);

    await waitFor(() => {
      expect(authApi.post).toHaveBeenCalledWith('/hr/pay-structures/ps-draft-uuid/activate');
    });
  });

  it('displays clear warning when an ineligible employee category is encountered', async () => {
    // Return mockEmployees[1] (Local Daily-Wage Workers)
    authApi.get.mockImplementation((url) => {
      if (url.startsWith('/hr/pay-structures/employees/')) {
        return Promise.resolve({
          data: {
            success: true,
            employee: mockEmployees[1],
            active_structure: null,
            revisions: []
          }
        });
      }
      if (url === '/hr/employees') {
        return Promise.resolve({
          data: {
            success: true,
            employees: mockEmployees,
            pagination: { page: 1, totalPages: 1, totalItems: 2, limit: 15 }
          }
        });
      }
      return Promise.resolve({ data: { success: true } });
    });

    renderWithClient(<EmployeeManagement />, ['/admin/employee-management?tab=pay-structure&employeeId=emp-2-uuid']);

    await waitFor(() => {
      expect(screen.getByText(/Ineligible Category/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/cannot have a permanent employee pay structure/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create New Revision/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Configure Pay Structure/i })).not.toBeInTheDocument();
  });

  it('submits an edited draft without employee_id in the PATCH payload', async () => {
    const user = userEvent.setup();

    // Mock pay structure with an existing pending draft
    authApi.get.mockImplementation((url) => {
      if (url === '/hr/employees') {
        return Promise.resolve({
          data: {
            success: true,
            employees: mockEmployees,
            pagination: { page: 1, totalPages: 1, totalItems: 2, limit: 15 }
          }
        });
      }
      if (url.startsWith('/hr/pay-structures/employees/')) {
        return Promise.resolve({
          data: {
            success: true,
            employee: mockEmployees[0],
            active_structure: mockPayStructure.active_structure,
            revisions: [
              mockPayStructure.active_structure,
              {
                id: 'ps-draft-uuid',
                employee_id: 'emp-1-uuid',
                revision_number: 2,
                pay_basis: 'Monthly salary',
                guaranteed_monthly_gross: 55000,
                basic_salary: 32000,
                staff_welfare: 5000,
                other_fixed_components: 5000,
                epf_enrolment: true,
                esi_enrolment: false,
                status: 'Draft',
                updated_at: '2025-02-01T10:00:00.000Z'
              }
            ]
          }
        });
      }
      return Promise.resolve({ data: { success: true } });
    });

    renderWithClient(<EmployeeManagement />, ['/admin/employee-management?tab=pay-structure&employeeId=emp-1-uuid']);

    await waitFor(() => {
      expect(screen.getByText(/Pending Draft Revision #2/i)).toBeInTheDocument();
    });

    const editDraftBtn = screen.getByRole('button', { name: /Edit Draft/i });
    await user.click(editDraftBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Edit Draft Pay Structure/i })).toBeInTheDocument();
    });

    const basicSalaryInput = screen.getByLabelText(/6\. Basic Salary/i);
    await user.clear(basicSalaryInput);
    await user.type(basicSalaryInput, '34000');

    const updateDraftBtn = screen.getByRole('button', { name: /Update Draft/i });
    await user.click(updateDraftBtn);

    await waitFor(() => {
      expect(authApi.patch).toHaveBeenCalledWith('/hr/pay-structures/ps-draft-uuid', expect.any(Object));
    });

    const patchCall = authApi.patch.mock.calls.find((call) => call[0] === '/hr/pay-structures/ps-draft-uuid');
    expect(patchCall).toBeDefined();
    expect(patchCall[1]).not.toHaveProperty('employee_id');
    expect(patchCall[1]).toMatchObject({
      pay_basis: 'Monthly salary',
      guaranteed_monthly_gross: 55000,
      basic_salary: 34000,
      status: 'Draft'
    });
  });

  it('supports paged loading and selecting a permanent employee beyond the first page', async () => {
    const user = userEvent.setup();

    const page1Employee = {
      id: 'emp-page1-uuid',
      employee_code: 'EMP-P1-001',
      employee_name: 'Page One Worker',
      employee_category: 'HO Staff',
      active_status: 'Active'
    };
    const page2Employee = {
      id: 'emp-page2-uuid',
      employee_code: 'EMP-P2-002',
      employee_name: 'Page Two Worker',
      employee_category: 'Projects Department Employees',
      active_status: 'Active'
    };

    authApi.get.mockImplementation((url, config) => {
      if (url === '/hr/employees') {
        const page = config?.params?.page || 1;
        if (page === 2) {
          return Promise.resolve({
            data: {
              success: true,
              employees: [page2Employee],
              pagination: { page: 2, limit: 50, totalPages: 2, totalItems: 2 }
            }
          });
        }
        return Promise.resolve({
          data: {
            success: true,
            employees: [page1Employee],
            pagination: { page: 1, limit: 50, totalPages: 2, totalItems: 2 }
          }
        });
      }
      if (url.startsWith('/hr/pay-structures/employees/emp-page2-uuid')) {
        return Promise.resolve({
          data: {
            success: true,
            employee: page2Employee,
            active_structure: null,
            revisions: []
          }
        });
      }
      return Promise.resolve({ data: { success: true } });
    });

    renderWithClient(<EmployeeManagement />, ['/admin/employee-management?tab=pay-structure']);

    // Initially on page 1, only EMP-P1-001 is present
    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /EMP-P1-001/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: /EMP-P2-002/i })).not.toBeInTheDocument();

    // Click Next to load page 2
    const nextBtn = screen.getByRole('button', { name: /Next employee page/i });
    await user.click(nextBtn);

    // Now EMP-P2-002 from page 2 is available
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /EMP-P2-002/i })).toBeInTheDocument();
    });

    // Select the employee beyond the first page
    const selectElem = screen.getByRole('combobox');
    await user.selectOptions(selectElem, 'emp-page2-uuid');

    // Pay structure details for the page 2 employee are loaded
    await waitFor(() => {
      expect(authApi.get).toHaveBeenCalledWith('/hr/pay-structures/employees/emp-page2-uuid');
    });
    expect(screen.getByText('Page Two Worker')).toBeInTheDocument();
  });

  it('supports paged loading and selecting an ERP account beyond the first page in modal', async () => {
    const user = userEvent.setup();

    const page1User = {
      id: 'usr-je-page1',
      display_name: 'Priya Page 1',
      role: 'je',
      mobile_number: '1111111111',
      is_active: true
    };
    const page2User = {
      id: 'usr-je-page2',
      display_name: 'Rohan Page 2',
      role: 'je',
      mobile_number: '2222222222',
      is_active: true
    };

    authApi.get.mockImplementation((url, config) => {
      if (url === '/hr/employees') {
        return Promise.resolve({
          data: {
            success: true,
            employees: mockEmployees,
            pagination: { page: 1, totalPages: 1, totalItems: 2, limit: 15 }
          }
        });
      }
      if (url === '/hr/employees/erp-users') {
        const page = config?.params?.page || 1;
        if (page === 2) {
          return Promise.resolve({
            data: {
              success: true,
              users: [page2User],
              pagination: { page: 2, limit: 50, totalPages: 2, totalItems: 2 }
            }
          });
        }
        return Promise.resolve({
          data: {
            success: true,
            users: [page1User],
            pagination: { page: 1, limit: 50, totalPages: 2, totalItems: 2 }
          }
        });
      }
      return Promise.resolve({ data: { success: true } });
    });

    renderWithClient(<EmployeeManagement />);

    await waitFor(() => {
      expect(screen.getByText('EMP-001')).toBeInTheDocument();
    });

    const addBtn = screen.getByRole('button', { name: /Add Employee/i });
    await user.click(addBtn);

    // Filter by ERP role: 'je'
    const roleSelect = screen.getByLabelText(/Filter by ERP Role/i);
    await user.selectOptions(roleSelect, 'je');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Priya Page 1/i })).toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: /Rohan Page 2/i })).not.toBeInTheDocument();

    // Click Next to load page 2
    const nextBtn = screen.getByRole('button', { name: /Next ERP account page/i });
    await user.click(nextBtn);

    // Verify account beyond page 1 is now available and can be selected
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Rohan Page 2/i })).toBeInTheDocument();
    });

    const accountSelect = screen.getByLabelText(/Select ERP Account/i);
    await user.selectOptions(accountSelect, 'usr-je-page2');
    expect(accountSelect.value).toBe('usr-je-page2');
  });
});

