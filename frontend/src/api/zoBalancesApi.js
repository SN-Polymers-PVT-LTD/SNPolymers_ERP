import authApi from './authApi';

/**
 * Fetch available zonal balance(s) (Admin, HO, and ZO roles)
 * ZO users only see their own available balance (enforced on the backend)
 */
export const getZonalBalances = (params) => authApi.get('/zo-balances', { params });

/**
 * Fetch transaction ledger log entries (Admin, HO, and ZO roles)
 * ZO users only see their own transaction logs (enforced on the backend)
 * @param {number} page
 * @param {number} limit
 */
export const getZonalLedger = (page = 1, limit = 20) =>
  authApi.get(`/zo-balances/ledger?page=${page}&limit=${limit}`);

/**
 * Trigger manual reconciliation of zonal balances against transaction ledger (Admin and HO only)
 */
export const reconcileZonalBalances = () => authApi.post('/zo-balances/reconcile');
