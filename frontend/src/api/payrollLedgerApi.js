import authApi from './authApi';
const base='/hr/payroll';
export const getEmployeeAdjustments=(employeeId,params)=>authApi.get(`${base}/employees/${employeeId}/adjustments`,{params});
export const createEmployeeAdjustment=(employeeId,data)=>authApi.post(`${base}/employees/${employeeId}/adjustments`,data);
export const actOnAdjustment=(id,data)=>authApi.post(`${base}/adjustments/${id}/actions`,data);
export const publishPayrollCalendar=data=>authApi.post(`${base}/calendar`,data);
export const setPayrollCutoff=(runId,data)=>authApi.post(`${base}/runs/${runId}/cutoff`,data);
