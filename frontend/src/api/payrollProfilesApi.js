import authApi from './authApi';
const base='/hr/payroll';
export const getStatutoryProfileContext=params=>authApi.get(`${base}/statutory-profiles/context`,{params});
export const getEmployeeStatutoryProfiles=id=>authApi.get(`${base}/employees/${id}/statutory-profile`);
export const recordEmployeeStatutoryProfiles=(id,body)=>authApi.post(`${base}/employees/${id}/statutory-profile`,body);
export const registerStatutoryScope=body=>authApi.post(`${base}/statutory-scopes`,body);
export const bindStatutoryScope=body=>authApi.post(`${base}/statutory-scopes/bind`,body);
export const getStatutoryEmployees=params=>authApi.get(`${base}/statutory-profiles/employees`,{params});

export const getStatutorySetupCandidates=params=>authApi.get(`${base}/statutory-profiles/setup-candidates`,{params});
export const bulkRecordStatutoryProfiles=body=>authApi.post(`${base}/statutory-profiles/bulk`,body);

export const getStatutoryStates=()=>authApi.get(`${base}/statutory-states`);
export const registerStatutoryState=body=>authApi.post(`${base}/statutory-states`,body);

export const getCompanyDeductionSetups=params=>authApi.get(`${base}/company-deduction-setups`,{params});
export const getCompanyDeductionOptions=params=>authApi.get(`${base}/company-deduction-setups/options`,{params});
export const saveCompanyDeductionSetup=body=>authApi.post(`${base}/company-deduction-setups`,body);
export const applyCompanyDeductionSetup=body=>authApi.post(`${base}/company-deduction-setups/apply`,body);

const guidedDrafts = `${base}/company-deduction-setups/guided-drafts`;
export const listGuidedDeductionDrafts = params => authApi.get(guidedDrafts, { params });
export const getGuidedDeductionDraft = id => authApi.get(`${guidedDrafts}/${id}`);
export const saveGuidedDeductionDraft = body => authApi.post(guidedDrafts, body);
export const reviewGuidedDeductionDraft = (id, body) => authApi.post(`${guidedDrafts}/${id}/review`, body);
export const publishGuidedDeductionDraft = (id, body) => authApi.post(`${guidedDrafts}/${id}/publish`, body);

export const getEpfWageBases = employeeId => authApi.get(`${base}/employees/${employeeId}/epf-wage-bases`);
export const recordEpfWageBasis = (employeeId, body) => authApi.post(`${base}/employees/${employeeId}/epf-wage-bases`, body);
export const confirmEpfWageBasis = (employeeId, body) => authApi.post(`${base}/employees/${employeeId}/epf-wage-bases/confirm`, body);
