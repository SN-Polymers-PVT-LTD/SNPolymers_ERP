import authApi from './authApi';

// ──────────────────────────────────────────────
//  Fund Requests API
//  Base URL → /api/v1/auth/fund-requests (via authApi)
// ──────────────────────────────────────────────

/** Fetch role-filtered fund requests with optional status and pagination */
export const getFundRequests = (params = {}) => {
  const { page, limit, status } = params;
  return authApi.get('/fund-requests', {
    params: { page, limit, status }
  });
};

/** Fetch a single fund request by ID */
export const getFundRequestById = (id) =>
  authApi.get(`/fund-requests/${id}`);

/** Create a new fund request (ZO only) */
export const createFundRequest = (data) =>
  authApi.post('/fund-requests', data);

/** Approve or Hold a pending fund request (HO only) */
export const actOnFundRequest = (id, data) =>
  authApi.patch(`/fund-requests/${id}/action`, data);

/** Cancel a pending fund request (ZO only) */
export const cancelFundRequest = (id) =>
  authApi.patch(`/fund-requests/${id}/cancel`);
