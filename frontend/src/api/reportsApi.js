import authApi from './authApi';

// ──────────────────────────────────────────────
//  Fund Reports API
//  Base URL → /api/v1/auth/reports
// ──────────────────────────────────────────────

/** Fetch all active (non-deleted) reports with live project join */
export const getReports = () => authApi.get('/reports');

/** Fetch a single report by ID */
export const getReportById = (id) => authApi.get(`/reports/${id}`);

/** Fetch soft-deleted reports (admin only) */
export const getDeletedReports = () => authApi.get('/reports/admin/deleted');

/** Create a new fund report
 *  @param {{ work_order_no: string, amount: number, remarks?: string }} data
 */
export const createReport = (data) => authApi.post('/reports', data);

/** Update an existing fund report
 *  @param {string} id
 *  @param {{ amount: number, remarks?: string }} data
 */
export const updateReport = (id, data) => authApi.put(`/reports/${id}`, data);

/** Soft-delete a fund report (admin only) */
export const deleteReport = (id) => authApi.delete(`/reports/${id}`);

/** Restore a soft-deleted report (admin only) */
export const restoreReport = (id) => authApi.patch(`/reports/${id}/restore`);
