import authApi from './authApi';

// ──────────────────────────────────────────────
//  Activity Breaks API
//  Base URL → /api/v1/auth/activity-breaks (via authApi)
// ──────────────────────────────────────────────

/** Fetch activity breaks with optional filters: work_order_no, status, page, limit */
export const getActivityBreaks = (params = {}) =>
  authApi.get('/activity-breaks', { params });

/** Fetch a single activity break by ID */
export const getActivityBreakById = (id) =>
  authApi.get(`/activity-breaks/${id}`);

/** Create a new activity break request (JE only) */
export const createActivityBreak = (data) =>
  authApi.post('/activity-breaks', data);

/** Act on an activity break — Cancel, Accept, Reject, Approve, RequestReopen, ApproveReopen */
export const actOnActivityBreak = (id, data) =>
  authApi.patch(`/activity-breaks/${id}/action`, data);
