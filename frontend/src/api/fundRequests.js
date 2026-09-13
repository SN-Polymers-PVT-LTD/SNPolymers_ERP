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

/** Create a new Fund Request draft (ZO only) */
export const createFundRequestDraft = (data) =>
  authApi.post('/fund-requests', data);

/** Update an unsubmitted Fund Request draft */
export const updateFundRequestDraft = (id, data) =>
  authApi.patch(`/fund-requests/${id}`, data);

/** Reserve capacity and submit a draft to Accounts */
export const submitFundRequest = (id) =>
  authApi.post(`/fund-requests/${id}/submit`);

/** Cancel a pending fund request (ZO only) */
export const cancelFundRequest = (id) =>
  authApi.patch(`/fund-requests/${id}/cancel`);
