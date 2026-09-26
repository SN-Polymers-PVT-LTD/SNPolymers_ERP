import authApi from './authApi';

/**
 * HR Permanent Pay Structures API wrapper.
 * Base path matches backend mount at /api/v1/auth/hr/pay-structures.
 */
export const getAllPayStructures = () =>
  authApi.get('/hr/pay-structures');

export const getEmployeePayStructures = (employeeId) =>
  authApi.get(`/hr/pay-structures/employees/${employeeId}`);

export const createPayStructure = (data) =>
  authApi.post('/hr/pay-structures', data);

export const activatePayStructure = (id) =>
  authApi.post(`/hr/pay-structures/${id}/activate`);

export const updateDraftPayStructure = (id, data) =>
  authApi.patch(`/hr/pay-structures/${id}`, data);

export const suspendPayStructure = (id) =>
  authApi.post(`/hr/pay-structures/${id}/suspend`);
