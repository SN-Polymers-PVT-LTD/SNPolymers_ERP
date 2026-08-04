/**
 * Check if the active user can manage cash-flow forecasts / estimated bills for a project.
 * Enforces role checks, project status checks, and final bill existence checks.
 * Defaults to failing closed (returns false) if parameters are missing or invalid.
 *
 * @param {Object} params
 * @param {string} params.role - User's role ('zo', 'ho', 'admin', etc.)
 * @param {string} params.status - Project master status ('Running', 'Closed', etc.)
 * @param {boolean} params.finalBillExists - Whether a Final Bill is registered in ra_final_bills
 * @returns {boolean}
 */
export const canManageEstimatedBills = ({ role, status, finalBillExists } = {}) => {
  if (!role || status !== 'Running' || finalBillExists === true || finalBillExists === undefined) {
    return false;
  }
  return ['zo', 'ho', 'admin'].includes(role);
};
