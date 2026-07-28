const ESTIMATE_STATUS = require('../constants/estimate-status');
const APPROVAL_STATUS = require('../constants/approval-status');

const EDITABLE_STATUSES = [
  ESTIMATE_STATUS.DRAFT,
  ESTIMATE_STATUS.ZO_REVISION_REQUESTED,
  ESTIMATE_STATUS.HO_REVISION_REQUESTED,
  ESTIMATE_STATUS.ESTIMATE_REOPENED
];

const SUBMITTABLE_STATUSES = [
  ESTIMATE_STATUS.DRAFT,
  ESTIMATE_STATUS.ZO_REVISION_REQUESTED,
  ESTIMATE_STATUS.HO_REVISION_REQUESTED,
  ESTIMATE_STATUS.ESTIMATE_REOPENED
];

/**
 * Checks if any item in a review session has a decision of APPROVAL_STATUS.REJECTED ('Not Approve').
 *
 * @param {Array<Object>} items - List of cost estimate line items (or row decision payloads).
 * @param {string} stage - Current estimate status ('Under ZO Review' | 'Under HO Review').
 * @returns {boolean} True if at least one item is marked Not Approve.
 */
function hasRejectedItems(items, stage) {
  if (!Array.isArray(items) || items.length === 0) return false;

  const approvalColumn = stage === ESTIMATE_STATUS.UNDER_ZO_REVIEW
    ? 'zo_office_approve'
    : 'ho_office_approve';

  return items.some(item => {
    const status = item[approvalColumn] || item.approve_status;
    return status === APPROVAL_STATUS.REJECTED;
  });
}

module.exports = {
  EDITABLE_STATUSES,
  SUBMITTABLE_STATUSES,
  hasRejectedItems
};

