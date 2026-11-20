import authApi from './authApi';
export const getSubcontractEstimates = (params) => authApi.get('/subcontract-estimates', { params });
export const getSubcontractEstimateSummary = () => authApi.get('/subcontract-estimates/summary');
export const getSubcontractEstimateInit = () => authApi.get('/subcontract-estimates/init');
export const createSubcontractEstimate = (data) => authApi.post('/subcontract-estimates', data);
export const getSubcontractEstimate = (id) => authApi.get(`/subcontract-estimates/${id}`);
export const reconcileSubcontractEstimateLines = (id, data) => authApi.put(`/subcontract-estimates/${id}/lines`, data);
export const transitionSubcontractEstimateWorkflow = (id, data) => authApi.post(`/subcontract-estimates/${id}/workflow`, data);
export const reviewSubcontractEstimateRows = (id, data) => authApi.post(`/subcontract-estimates/${id}/review-rows`, data);
