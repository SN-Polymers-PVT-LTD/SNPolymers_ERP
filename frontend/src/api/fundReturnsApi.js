import authApi from './authApi';

/**
 * Fetch all excess fund return requests (Admin, HO, and ZO roles)
 * ZO users only see return requests associated with their ZO (enforced on the backend)
 */
export const getReturnRequests = () => authApi.get('/excess-fund-returns');

/**
 * Create a new excess fund return request for a Zonal Office (Admin and HO only)
 * @param {Object} data – { zo_user_id, work_order_no, requested_amount, remarks_ho }
 */
export const createReturnRequest = (data) => authApi.post('/excess-fund-returns', data);

/**
 * Accept a return request, locking the ZO balance and posting to the ledger (ZO only)
 * @param {string} id
 * @param {string} client_updated_at – ISO string of latest return request updated_at timestamp (for concurrency guard)
 */
export const acceptReturnRequest = (id, client_updated_at, breakdown) =>
  authApi.post(`/excess-fund-returns/${encodeURIComponent(id)}/accept`, { client_updated_at, breakdown });

/**
 * Reject a return request with mandatory remarks (ZO only)
 * @param {string} id
 * @param {string} remarks_zo
 */
export const rejectReturnRequest = (id, remarks_zo) =>
  authApi.patch(`/excess-fund-returns/${encodeURIComponent(id)}/reject`, { remarks_zo });

/**
 * Request modifications on a return request with mandatory remarks (ZO only)
 * @param {string} id
 * @param {string} remarks_zo
 */
export const modifyReturnRequest = (id, remarks_zo) =>
  authApi.patch(`/excess-fund-returns/${encodeURIComponent(id)}/modify`, { remarks_zo });

/**
 * Take administrative action (Cancel / Reissue) on a return request (Admin and HO only)
 * @param {string} id
 * @param {string} action – 'Cancel' | 'Reissue'
 * @param {string} remarks_ho
 */
export const actionOnReturnRequest = (id, action, remarks_ho, requested_amount) =>
  authApi.patch(`/excess-fund-returns/${encodeURIComponent(id)}/ho-action`, { action, remarks_ho, requested_amount });
