import authApi from './authApi';

/**
 * HR Employees API wrapper for Employee & Worker Master.
 * Base path matches backend mount at /api/v1/auth/hr/employees.
 */
export const getEmployees = (params) => authApi.get('/hr/employees', { params });

export const getEmployee = (id) => authApi.get(`/hr/employees/${id}`);

export const getErpUsers = (params) => authApi.get('/hr/employees/erp-users', { params });

export const createEmployee = (data) => authApi.post('/hr/employees', data);

export const updateEmployee = (id, data) => authApi.patch(`/hr/employees/${id}`, data);

export const updateEmployeeStatus = (id, active_status) =>
  authApi.patch(`/hr/employees/${id}/status`, { active_status });
