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

/** Create a new requisition */
export const createRequisition = (data) =>
  authApi.post('/requisitions', data);

/** Approve or Hold a requisition (ZO or HO only)
 * @param {string} id
 * @param {{ action: 'Approve'|'Hold', approved_amount?: number, remarks_approved_authority?: string }} data
 */
export const actOnRequisition = (id, data) =>
  authApi.patch(`/requisitions/${id}/action`, data);

/** Cancel a Pending requisition */
export const cancelRequisition = (id) =>
  authApi.patch(`/requisitions/${id}/cancel`);

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

/** Delete Requisition PDF
 * @param {string} requisitionNo
 */
export const deleteRequisitionPdf = (requisitionNo) =>
  authApi.delete('/requisitions/upload/requisition-pdf', { params: { requisition_no: requisitionNo } });

/** Delete GST Bill PDF
 * @param {string} requisitionNo
 */
export const deleteGstBillPdf = (requisitionNo) =>
  authApi.delete('/requisitions/upload/gst-bill', { params: { requisition_no: requisitionNo } });
