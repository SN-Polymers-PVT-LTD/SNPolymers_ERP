import authApi from './authApi';

const BASE = '/acct-requisitions';

// ── Bank balances ────────────────────────────────────────────────────────
export const getBankBalances = () => authApi.get(`${BASE}/bank-balances`);
export const upsertBankBalance = (data) => authApi.put(`${BASE}/bank-balances`, data);
export const getBankLedger = (params) => authApi.get(`${BASE}/bank-ledger`, { params });

// ── Account sub-titles ───────────────────────────────────────────────────
export const getAccountSubTitles = () => authApi.get(`${BASE}/account-sub-titles`);
export const upsertAccountSubTitle = (data) => authApi.put(`${BASE}/account-sub-titles`, data);

// ── Beneficiary ──────────────────────────────────────────────────────────
export const lookupBeneficiary = (params) => authApi.get(`${BASE}/beneficiary`, { params });
export const upsertBeneficiary = (data) => authApi.put(`${BASE}/beneficiary`, data);

// ── Sheets ───────────────────────────────────────────────────────────────
export const getSheets = (params) => authApi.get(`${BASE}/sheets`, { params });
export const getSheetById = (id) => authApi.get(`${BASE}/sheets/${id}`);
export const createSheet = (data) => authApi.post(`${BASE}/sheets`, data);
export const submitSheet = (id) => authApi.post(`${BASE}/sheets/${id}/submit`);

// exportBulkNeft: returns the real 'Bulk Sheet 1'-format .xlsx as bytes, not
// JSON — responseType: 'blob' is required so axios doesn't try to JSON-parse
// the binary body. A non-2xx response still arrives as a Blob under this
// setting (axios applies responseType to error bodies too); callers must
// read it via Blob.text() + JSON.parse to get at { message }, not
// err.response?.data?.message directly.
export const exportBulkNeft = (sheetId, data) => authApi.post(`${BASE}/sheets/${sheetId}/export-neft`, data, { responseType: 'blob' });

// ── Line items ───────────────────────────────────────────────────────────
export const addLineItem = (sheetId, data) => authApi.post(`${BASE}/sheets/${sheetId}/items`, data);
export const updateLineItem = (sheetId, itemId, data) => authApi.patch(`${BASE}/sheets/${sheetId}/items/${itemId}`, data);
export const deleteLineItem = (sheetId, itemId) => authApi.delete(`${BASE}/sheets/${sheetId}/items/${itemId}`);

export const actOnLineItem = (itemId, data) => authApi.patch(`${BASE}/items/${itemId}/action`, data);
export const resubmitLineItem = (itemId, data) => authApi.post(`${BASE}/items/${itemId}/resubmit`, data);
export const reopenLineItem = (itemId, data) => authApi.post(`${BASE}/items/${itemId}/reopen`, data);
