import authApi from './authApi';

/**
 * Fetch all work order mappings (Admin, HO, and ZO roles)
 * ZO users only see mappings for projects owned by their ZO (enforced on the backend)
 */
export const getWorkOrderMappings = () => authApi.get('/work-order-mappings');

/**
 * Map a Junior Engineer to a Work Order (Admin and HO only)
 * @param {Object} data – { work_order_no, je_mobile_number }
 */
export const createWorkOrderMapping = (data) => authApi.post('/work-order-mappings', data);

/**
 * Deactivate an active Work Order assignment (Admin and HO only)
 * @param {string} id
 * @param {string} reason – 'Removed' | 'Project Closed'
 */
export const deactivateWorkOrderMapping = (id, reason) =>
  authApi.patch(`/work-order-mappings/${encodeURIComponent(id)}/deactivate`, { reason });
