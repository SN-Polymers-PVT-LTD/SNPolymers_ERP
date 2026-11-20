import authApi from './authApi';

/**
 * HR Permanent Pay Structures API wrapper.
 * Base path matches backend mount at /api/v1/auth/hr/pay-structures.
 */
export const getAllPayStructures = () =>
  authApi.get('/hr/pay-structures');

export const getEmployeePayStructures = (employeeId) =>
  authApi.get(`/hr/pay-structures/employees/${employeeId}`);

export const suspendPayStructure = (id) =>
  authApi.post(`/hr/pay-structures/${id}/suspend`);

export const getPayrollSalaryContext = employeeId => authApi.get(`/hr/pay-structures/employees/${employeeId}/payroll-context`);
export const savePayrollSalary = data => authApi.post('/hr/pay-structures/payroll-salary',data);
export const initializePayrollAssignment = data => authApi.post('/hr/pay-structures/initial-assignment',data);
