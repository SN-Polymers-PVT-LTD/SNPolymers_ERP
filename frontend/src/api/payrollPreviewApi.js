import authApi from './authApi';
const base='/hr/payroll';
export const listPayrollRuns=params=>authApi.get(`${base}/runs`,{params});
export const getPayrollRun=(id,params)=>authApi.get(`${base}/runs/${id}`,{params});
export const previewPayrollRow=(id,fingerprint)=>authApi.post(`${base}/rows/${id}/preview`,fingerprint?{expected_source_fingerprint:fingerprint}:{});
