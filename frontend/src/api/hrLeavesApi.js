import authApi from './authApi';

/**
 * Fetch linked employee context and self-service eligibility for the current user.
 */
export const getMyLeaveContext = () => authApi.get('/hr/leaves/context');

/**
 * List the current user's self-service leave requests.
 */
export const getMyLeaveRequests = () => authApi.get('/hr/leaves/my-requests');

/**
 * Create a new self-service leave request.
 * @param {{ from_date: string, to_date: string, leave_type: string, reason: string }} body
 */
export const submitSelfServiceLeave = body => authApi.post('/hr/leaves/self-service', body);

/**
 * Update an existing Pending self-service leave request.
 * @param {string} id
 * @param {{ from_date: string, to_date: string, leave_type: string, reason: string }} body
 */
export const updateSelfServiceLeave = (id, body) => authApi.put(`/hr/leaves/self-service/${id}`, body);

/**
 * HO / Admin review queue for self-service leave requests.
 * @param {Object} params
 */
export const getSelfServiceLeaveQueue = params => authApi.get('/hr/leaves/review-queue', { params });

/**
 * HO / Admin decision on a self-service leave request.
 * @param {string} id
 * @param {{ decision: 'Approved' | 'Rejected', pay_treatment: 'Paid' | 'Unpaid', remarks?: string }} body
 */
export const decideSelfServiceLeave = (id, body) => authApi.post(`/hr/leaves/${id}/decision`, body);
