import authApi from './authApi';

// ──────────────────────────────────────────────
//  Requisitions API
//  Base URL → /api/v1/auth/requisitions (mounted in app.js)
// ──────────────────────────────────────────────

/** Fetch all requisitions with filtering/pagination (role-filtered by backend) */
export const getRequisitions = (params = {}) =>
  authApi.get('/requisitions', { params });

/** Fetch single requisition by ID (contains display names & signed URLs) */
export const getRequisitionById = (id) =>
  authApi.get(`/requisitions/${id}`);

/** Fetch Main Head Capacity metrics */
export const getMainHeadCapacity = (work_order_no, material_main_head) =>
  authApi.get('/requisitions/capacity', { params: { work_order_no, material_main_head } });

/** Fetch Subcontractor Ledger capacity metrics */
export const getSubcontractorCapacity = (work_order_no, material_sub_head, material_details) =>
  authApi.get('/requisitions/subcontractor-capacity', { params: { work_order_no, material_sub_head, material_details } });

/** Browse Subcontractor Ledger balances (optionally filtered by work order / search text) */
export const getSubcontractorLedger = (params = {}) =>
  authApi.get('/requisitions/subcontractor-ledger', { params });

/** Fetch the transaction trail for subcontractor balance(s) (supports object params or positional args) */
export const getSubcontractorLedgerEntries = (paramsOrWo, material_sub_head, material_details) => {
  const params = typeof paramsOrWo === 'object' && paramsOrWo !== null
    ? paramsOrWo
    : {
        work_order_no: paramsOrWo || undefined,
        material_sub_head: material_sub_head || undefined,
        material_details: material_details || undefined
      };
  return authApi.get('/requisitions/subcontractor-ledger/entries', { params });
};

/** Fetch every Requisition raised against a Sub Contractor, across all work orders (filterable) */
export const getSubcontractorRequisitions = (params = {}) =>
  authApi.get('/requisitions/subcontractor-ledger/requisitions', { params });

/** Admin balance adjustment for a subcontractor ledger entry (HO or Admin only) */
export const adjustSubcontractorBalance = (data) =>
  authApi.post('/requisitions/subcontractor-ledger/adjust', data);

/** Create a new requisition */
export const createRequisition = (data) =>
  authApi.post('/requisitions', data);

/** Approve or Hold a requisition (ZO or HO only)
 * @param {string} id
 * @param {{ action: 'Approve'|'Hold', approved_amount?: number, remarks_approved_authority?: string }} data
 */
export const actOnRequisition = (id, data) =>
  authApi.patch(`/requisitions/${id}/action`, data);

/** Select the ZO Balance payment route for an Approved requisition (ZO or Admin only) */
export const payFromZoBalance = (id) =>
  authApi.post(`/requisitions/${id}/pay-from-zo-balance`);

/** Send an Approved requisition to Accounts (ZO or Admin only) — creates an
 * Accounts line item immediately; response includes { requisition, accounts } */
export const sendRequisitionToAccounts = (id) =>
  authApi.post(`/requisitions/${id}/send-to-accounts`);

/** Cancel a Pending requisition */
export const cancelRequisition = (id) =>
  authApi.patch(`/requisitions/${id}/cancel`);

export const retryCancelledRequisitionAttachmentCleanup = (id) =>
  authApi.post(`/requisitions/${id}/retry-attachment-cleanup`);

/** Upload Requisition PDF
 * @param {File} file
 * @param {string} requisitionNo
 */
export const uploadRequisitionPdf = (file, requisitionNo) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('requisition_no', requisitionNo);
  return authApi.post('/requisitions/upload/requisition-pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

/** Upload GST Bill PDF
 * @param {File} file
 * @param {string} requisitionNo
 */
export const uploadGstBillPdf = (file, requisitionNo) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('requisition_no', requisitionNo);
  return authApi.post('/requisitions/upload/gst-bill', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

/** Delete a pending (not-yet-submitted) Requisition PDF attachment
 * @param {string} attachmentId
 */
export const deleteRequisitionPdf = (attachmentId) =>
  authApi.delete('/requisitions/upload/requisition-pdf', { params: { attachment_id: attachmentId } });

/** Delete a pending (not-yet-submitted) GST Bill PDF attachment
 * @param {string} attachmentId
 */
export const deleteGstBillPdf = (attachmentId) =>
  authApi.delete('/requisitions/upload/gst-bill', { params: { attachment_id: attachmentId } });

/** Live typeahead search for project payment requisition beneficiary suggestions */
export const searchProjectsBeneficiaries = (prefix, limit = 8) =>
  authApi.get('/requisitions/beneficiary-suggestions', { params: { prefix, limit } });

/** Paginated/searchable list backing the Beneficiary Master page */
export const getProjectsBeneficiaries = (params) =>
  authApi.get('/requisitions/beneficiary-master', { params });

/** Manual add/edit entry point for the Beneficiary Master page */
export const upsertProjectsBeneficiary = (data) =>
  authApi.put('/requisitions/beneficiary-master', data);

/** Add/deactivate an Indian bank (shared indian_bank_master table) */
export const upsertIndianBank = (data) =>
  authApi.put('/requisitions/indian-banks', data);

/** Fetch active Indian banks list */
export const getIndianBanks = () =>
  authApi.get('/requisitions/indian-banks');
