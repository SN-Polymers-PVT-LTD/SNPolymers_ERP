import authApi from './authApi';

// ──────────────────────────────────────────────
//  Estimated Bills API Client
//  Base URL → /api/v1/auth/estimated-bills (mounted in app.js)
// ──────────────────────────────────────────────

/** Fetch all estimated bills grouped summary with filtering (role-scoped by backend) */
export const getEstimatedBills = (params = {}) =>
  authApi.get('/estimated-bills', { params });

/** Fetch complete timeline ledger of estimate entries for a Work Order */
export const getEstimatedBillLedger = (workOrderNo) =>
  authApi.get(`/estimated-bills/${encodeURIComponent(workOrderNo)}`);

/** Fetch Work Order picker options scoped by caller role */
export const getWorkOrderOptions = () =>
  authApi.get('/estimated-bills/work-orders');

/** Create a new append-only estimated bill ledger entry */
export const createEstimatedBillEntry = (data) =>
  authApi.post('/estimated-bills', data);
