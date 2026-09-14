import authApi from './authApi';

export const getSubcontractWorks = (params) => authApi.get('/subcontract-works', { params });
export const getSubcontractWork = (id) => authApi.get(`/subcontract-works/${id}`);
export const createSubcontractWork = (data) => authApi.post('/subcontract-works', data);
export const updateSubcontractWork = (id, data) => authApi.put(`/subcontract-works/${id}`, data);
export const updateSubcontractWorkStatus = (id, is_active) => authApi.patch(`/subcontract-works/${id}/status`, { is_active });

export const getSubcontractors = (params) => authApi.get('/subcontractors', { params });
export const getSubcontractor = (id) => authApi.get(`/subcontractors/${id}`);
export const createSubcontractor = (data) => authApi.post('/subcontractors', data);
export const updateSubcontractor = (id, data) => authApi.put(`/subcontractors/${id}`, data);
export const updateSubcontractorStatus = (id, is_active) => authApi.patch(`/subcontractors/${id}/status`, { is_active });
