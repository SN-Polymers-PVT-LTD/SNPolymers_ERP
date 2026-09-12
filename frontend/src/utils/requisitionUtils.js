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

const PAYMENT_STATUS_LABELS = {
  AWAITING_PAYMENT_ROUTE: 'Awaiting Payment Route',
  PENDING_ACCOUNTS_IMPORT: 'Pending Accounts Import',
  ACCOUNTS_DRAFT: 'Accounts Draft',
  PENDING_HO_REVIEW: 'Pending HO Review',
  PENDING_REVIEW: 'Pending Review',
  ON_HOLD: 'On Hold',
  RETURNED_FOR_CORRECTION: 'Returned for Correction',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  REJECTED: 'Released'
};

/** Project the current financial exposure from the authorization and payment lifecycle. */
export function getRequisitionFinancialState(requisition = {}) {
  const approvedAmount = Math.max(Number(requisition.approved_amount || 0), 0);
  const rawPaid = Number(requisition.paid_amount);
  const paymentStatus = String(requisition.payment_status || '').trim().toUpperCase();
  const paidAmount = Number.isFinite(rawPaid) && rawPaid >= 0
    ? Math.min(rawPaid, approvedAmount)
    : (paymentStatus === 'PAID' ? approvedAmount : 0);

  if (requisition.requisition_status === 'Cancelled') {
    return { status: 'Cancelled', effectiveLiability: 0, paidAmount: 0, reservedAmount: 0, financiallyActive: false };
  }
  if (requisition.requisition_status === 'Rejected' || paymentStatus === 'REJECTED') {
    return { status: paymentStatus === 'REJECTED' ? 'Released' : 'Rejected', effectiveLiability: 0, paidAmount: 0, reservedAmount: 0, financiallyActive: false };
  }
  if (paymentStatus === 'PARTIALLY_PAID') {
    return { status: 'Partially Paid', effectiveLiability: paidAmount, paidAmount, reservedAmount: 0, financiallyActive: paidAmount > 0 };
  }
  if (paymentStatus === 'PAID' || requisition.payment_destination === 'ZO_BALANCE') {
    return { status: 'Paid', effectiveLiability: paidAmount, paidAmount, reservedAmount: 0, financiallyActive: paidAmount > 0 };
  }
  if (paymentStatus && PAYMENT_STATUS_LABELS[paymentStatus]) {
    return { status: PAYMENT_STATUS_LABELS[paymentStatus], effectiveLiability: approvedAmount, paidAmount: 0, reservedAmount: approvedAmount, financiallyActive: approvedAmount > 0 };
  }
  if (requisition.requisition_status === 'Approved') {
    return { status: 'Approved', effectiveLiability: approvedAmount, paidAmount: 0, reservedAmount: approvedAmount, financiallyActive: approvedAmount > 0 };
  }
  const active = isFinanciallyActiveRequisition(requisition.requisition_status);
  return { status: requisition.requisition_status || '—', effectiveLiability: active ? approvedAmount : 0, paidAmount: 0, reservedAmount: active ? approvedAmount : 0, financiallyActive: active && approvedAmount > 0 };
}

export function formatPaymentOffice(paymentDestination, emptyValue = '—') {
  if (paymentDestination === 'ZO_BALANCE') return 'ZO Office';
  if (paymentDestination === 'ACCOUNTS') return 'HO Office';
  return emptyValue;
}
