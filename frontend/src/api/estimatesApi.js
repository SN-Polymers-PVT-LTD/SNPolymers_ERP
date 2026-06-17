import authApi from './authApi';

// ──────────────────────────────────────────────
//  Cost Estimates API
//  Base URL → /api/v1/auth/estimates (mounted in app.js)
// ──────────────────────────────────────────────

/** Fetch all estimates with filtering/pagination (role-filtered by backend) */
export const getEstimates = (params) => authApi.get('/estimates', { params });

/** Fetch single estimate by ID (contains items + summary + name resolution) */
export const getEstimateById = (id) => authApi.get(`/estimates/${id}`);

/** Create estimate header */
export const createEstimate = (data) => authApi.post('/estimates', data);

/** Save draft line items (full replacement semantics) */
export const saveDraftItems = (id, items) => authApi.put(`/estimates/${id}/items`, { items });

/** Submit cost estimate for review */
export const submitEstimate = (id) => authApi.post(`/estimates/${id}/submit`);

/** Open estimate for review (Submitted -> Under ZO Review, or ZO Approved -> Under HO Review) */
export const reviewEstimate = (id) => authApi.patch(`/estimates/${id}/review`);

/** Save row-level decisions (Approve/Not Approve) atomically */
export const submitRowApprovals = (id, approvals) => authApi.post(`/estimates/${id}/row-approvals`, { approvals });

/** Submit final review decision (Approved or Rejected) for ZO or HO stage */
export const submitReview = (id, remarks) => authApi.post(`/estimates/${id}/submit-review`, { remarks });

/** Request line items revision from JE with optional deadline hours */
export const requestRevision = (id, deadline_hours) => authApi.post(`/estimates/${id}/request-revision`, { deadline_hours });

/** Retrieve revision log list for an estimate */
export const getRevisionLog = (id) => authApi.get(`/estimates/${id}/revisions`);


// ──────────────────────────────────────────────
//  Purchase Data API
//  Base URL → /api/v1/auth/purchase-data (mounted in app.js)
// ──────────────────────────────────────────────

/** Fetch all purchase options (filters active-only for non-admin on backend) */
export const getPurchaseOptions = () => authApi.get('/purchase-data');

/** Create a new purchase option (admin only) */
export const createPurchaseOption = (data) => authApi.post('/purchase-data', data);

/** Update purchase option name (admin only) */
export const updatePurchaseOption = (id, data) => authApi.put(`/purchase-data/${id}`, data);

/** Toggle purchase option is_active status (admin only) */
export const togglePurchaseOptionStatus = (id, is_active) => authApi.patch(`/purchase-data/${id}/status`, { is_active });
