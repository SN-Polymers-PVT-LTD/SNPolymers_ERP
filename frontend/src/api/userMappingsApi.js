import authApi from './authApi';

/**
 * Fetch all user mappings (Admin, HO, and ZO roles)
 * ZO users only see JEs mapped to their own ZO (enforced on the backend)
 */
export const getUserMappings = () => authApi.get('/user-mappings');

/**
 * Assign or transfer a Junior Engineer to a Zonal Office (Admin and HO only)
 * @param {Object} data – { je_mobile_number, zo_mobile_number }
 */
export const createUserMapping = (data) => authApi.post('/user-mappings', data);

/**
 * Get JEs eligible for mapping along with their current active ZO mapping status (Admin and HO only)
 */
export const getEligibleJEs = () => authApi.get('/user-mappings/eligible-jes');

/**
 * Get active ZOs eligible for mappings (Admin and HO only)
 */
export const getEligibleZOs = () => authApi.get('/user-mappings/eligible-zos');
