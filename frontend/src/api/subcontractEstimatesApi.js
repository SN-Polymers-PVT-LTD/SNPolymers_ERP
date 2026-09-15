import authApi from './authApi';
export const getSubcontractEstimates = (params) => authApi.get('/subcontract-estimates', { params });
export const getSubcontractEstimateInit = () => authApi.get('/subcontract-estimates/init');
export const createSubcontractEstimate = (data) => authApi.post('/subcontract-estimates', data);
export const getSubcontractEstimate = (id) => authApi.get(`/subcontract-estimates/${id}`);
export const saveSubcontractEstimateLines = (id, data) => authApi.put(`/subcontract-estimates/${id}/lines`, data);
