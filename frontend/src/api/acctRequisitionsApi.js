import authApi from './authApi';

const BASE = '/acct-requisitions';

// ── Bank balances ────────────────────────────────────────────────────────
export const getBankBalances = () => authApi.get(`${BASE}/bank-balances`);
export const upsertBankBalance = (data) => authApi.put(`${BASE}/bank-balances`, data);
export const getBankLedger = (params) => authApi.get(`${BASE}/bank-ledger`, { params });

// ── Account sub-titles ───────────────────────────────────────────────────
export const getAccountSubTitles = () => authApi.get(`${BASE}/account-sub-titles`);
export const upsertAccountSubTitle = (data) => authApi.put(`${BASE}/account-sub-titles`, data);

// ── Particulars ──────────────────────────────────────────────────────────
export const getParticulars = () => authApi.get(`${BASE}/particulars`);
export const upsertParticular = (data) => authApi.put(`${BASE}/particulars`, data);

// ── Beneficiary ──────────────────────────────────────────────────────────
export const lookupBeneficiary = (params) => authApi.get(`${BASE}/beneficiary`, { params });
export const searchBeneficiariesByAcNo = (prefix, limit = 8) =>
  authApi.get(`${BASE}/beneficiary-suggestions`, { params: { prefix, limit } });
export const upsertBeneficiary = (data) => authApi.put(`${BASE}/beneficiary`, data);
export const getBeneficiaries = (params) => authApi.get(`${BASE}/beneficiary-master`, { params });

// ── Indian banks ─────────────────────────────────────────────────────────
export const getIndianBanks = () => authApi.get(`${BASE}/indian-banks`);
export const upsertIndianBank = (data) => authApi.put(`${BASE}/indian-banks`, data);

// ── Sheets ───────────────────────────────────────────────────────────────
export const getSheets = (params) => authApi.get(`${BASE}/sheets`, { params });
// Flattened, cross-sheet line-item search for the "Requisition Details"
// filter view (Account Sub-title / Beneficiary A/c No. / Debit Bank Account /
// date range) — pass { export: true } to fetch all matching rows (no page
// window, capped server-side at 5000) for the Excel export button.
export const getLineItems = (params) => authApi.get(`${BASE}/line-items`, { params });
export const getSheetById = (id) => authApi.get(`${BASE}/sheets/${id}`);
export const createSheet = (data) => authApi.post(`${BASE}/sheets`, data);
// Best-effort cleanup — deletes the sheet only if it's still Open with zero
// line items; a no-op (still 200) otherwise. Called when leaving an empty
// sheet so its number isn't permanently burned for nothing.
export const deleteSheetIfEmpty = (id) => authApi.delete(`${BASE}/sheets/${id}`);
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

// ── Import On Hold/Rejected items into a new sheet ──────────────────────
// Accumulating, cross-sheet list of On Hold/Rejected items that haven't
// been imported or dismissed yet (034_add_line_item_import.sql).
export const getImportEligibleItems = (params) => authApi.get(`${BASE}/import-eligible-items`, { params });
export const importLineItem = (itemId, targetSheetId) => authApi.post(`${BASE}/import-eligible-items/${itemId}/import`, { target_sheet_id: targetSheetId });
export const dismissImportEligibleItem = (itemId) => authApi.post(`${BASE}/import-eligible-items/${itemId}/dismiss`);

export const actOnLineItem = (itemId, data) => authApi.patch(`${BASE}/items/${itemId}/action`, data);
// One request carrying every staged HO decision for a sheet, instead of one
// PATCH per line item — actions: [{ line_item_id, action, ho_pass_amount?, ho_remarks? }]
export const actOnLineItemsBatch = (sheetId, actions) => authApi.post(`${BASE}/sheets/${sheetId}/items/batch-action`, { actions });
export const resubmitLineItem = (itemId, data) => authApi.post(`${BASE}/items/${itemId}/resubmit`, data);
