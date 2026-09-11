/**
 * Shared financial status predicate for Requisitions.
 * Cancelled and Rejected requisitions have no financial liability on the project.
 * Only non-cancelled, non-rejected requisitions represent active or approved liabilities.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function isFinanciallyActiveRequisition(status) {
  if (!status) return false;
  const s = String(status).trim();
  return s !== 'Cancelled' && s !== 'Rejected';
}
