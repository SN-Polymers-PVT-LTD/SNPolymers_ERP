import authApi from './authApi';
const base='/hr/payroll';
export const getSalaryRegister=params=>authApi.get(`${base}/reports/register`,{params});
export const exportSalaryReport=params=>authApi.get(`${base}/reports/export`,{params,responseType:'blob'});
export const getDiagnosticPayslip=id=>authApi.get(`${base}/rows/${id}/payslip`,{params:{mode:'diagnostic'}});
export const getOfficialPayslip=id=>authApi.get(`${base}/rows/${id}/payslip`,{params:{mode:'official'}});
