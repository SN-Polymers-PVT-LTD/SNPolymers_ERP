import authApi from './authApi';

const BASE = '/acct-requisitions';

// ── Bank balances ────────────────────────────────────────────────────────
export const getBankBalances = () => authApi.get(`${BASE}/bank-balances`);
export const upsertBankBalance = (data) => authApi.put(`${BASE}/bank-balances`, data);

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

// exportBulkNeft: the backend currently returns a JSON placeholder
// (`{ success, exportedItemIds, message }`), not a binary file — no
// responseType: 'blob' here. See design-doc deviation note (Session 3 plan).
export const exportBulkNeft = (sheetId, data) => authApi.post(`${BASE}/sheets/${sheetId}/export-neft`, data);

// ── Line items ───────────────────────────────────────────────────────────
export const addLineItem = (sheetId, data) => authApi.post(`${BASE}/sheets/${sheetId}/items`, data);
export const updateLineItem = (sheetId, itemId, data) => authApi.patch(`${BASE}/sheets/${sheetId}/items/${itemId}`, data);
export const deleteLineItem = (sheetId, itemId) => authApi.delete(`${BASE}/sheets/${sheetId}/items/${itemId}`);

export const actOnLineItem = (itemId, data) => authApi.patch(`${BASE}/items/${itemId}/action`, data);
export const resubmitLineItem = (itemId, data) => authApi.post(`${BASE}/items/${itemId}/resubmit`, data);
export const reopenLineItem = (itemId, data) => authApi.post(`${BASE}/items/${itemId}/reopen`, data);
