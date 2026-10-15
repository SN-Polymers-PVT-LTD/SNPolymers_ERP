import authApi from './authApi';
export const getFactoryRevisions = (kind, params) => authApi.get(`/hr/factory-masters/${kind}`, { params });
export const createFactoryRevision = (kind, body) => authApi.post(`/hr/factory-masters/${kind}`, body);
export const getEffectiveFactoryMasters = (params) => authApi.get('/hr/factory-masters/effective', { params });
