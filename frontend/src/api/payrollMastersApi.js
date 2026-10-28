import authApi from './authApi';
const base = '/hr/payroll/masters';
export const listPayrollMasters = (kind, params) => authApi.get(`${base}/${kind}`, { params });
export const savePayrollMaster = (kind, body) => authApi.post(`${base}/${kind}/drafts`, body);
export const previewPayrollPublication = (kind, id, initialSetup = false) => authApi.get(`${base}/${kind}/${id}/preview`, { params: initialSetup ? { initial_setup: true } : {} });
export const publishPayrollMaster = (kind, id, body) => authApi.post(`${base}/${kind}/${id}/publish`, body);
export const resolvePayrollMaster = (kind, params) => authApi.get(`${base}/${kind}/resolve`, { params });
