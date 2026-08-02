import authApi from './authApi';

// ──────────────────────────────────────────────
//  Estimated Bills API Client
//  Base URL → /api/v1/auth/estimated-bills (mounted in app.js)
// ──────────────────────────────────────────────

/** Fetch all estimated bills with filtering (role-scoped by backend) */
export const getEstimatedBills = (params = {}) =>
  authApi.get('/estimated-bills', { params });

/** Fetch single estimated bill by Work Order number */
export const getEstimatedBillByWO = (workOrderNo) =>
  authApi.get(`/estimated-bills/${encodeURIComponent(workOrderNo)}`);

/** Fetch Work Order picker options scoped by caller role */
export const getWorkOrderOptions = () =>
  authApi.get('/estimated-bills/work-orders');

/** Save / Upsert an estimated bill record */
export const saveEstimatedBill = (data) =>
  authApi.post('/estimated-bills', data);
