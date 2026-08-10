/** Statuses that count toward advisory requisition totals */
export const REQ_COMMITTED_STATUSES = new Set(['Pending', 'Hold', 'Approved']);

/**
 * Effective committed amount for a single requisition row.
 * Approved rows use approved_amount (fallback requisition_amount); pending/hold use requisition_amount.
 */
export function getRequisitionCommittedAmount(requisition) {
  if (!requisition?.work_order_no || requisition.requisition_status === 'Cancelled') {
    return 0;
  }
  if (requisition.requisition_status === 'Approved') {
    return Number(
      requisition.approved_amount != null && requisition.approved_amount !== undefined
        ? requisition.approved_amount
        : requisition.requisition_amount || 0
    );
  }
  if (REQ_COMMITTED_STATUSES.has(requisition.requisition_status)) {
    return Number(requisition.requisition_amount || 0);
  }
  return 0;
}

/**
 * Sum committed requisition amounts for one work order (submitted + approved).
 */
export function buildSubmittedRequisitionSumByWo(requisitions) {
  const sumByWo = {};
  (requisitions || []).forEach((r) => {
    const amt = getRequisitionCommittedAmount(r);
    if (!r.work_order_no || amt === 0) return;
    sumByWo[r.work_order_no] = (sumByWo[r.work_order_no] || 0) + amt;
  });
  return sumByWo;
}

/**
 * Advisory remaining estimate balance after submitted/approved requisitions.
 */
export function computeRequisitionAdvisoryRemaining(estimateAmount, requisitions, workOrderNo) {
  if (estimateAmount == null) return null;
  const committed = buildSubmittedRequisitionSumByWo(requisitions)[workOrderNo] || 0;
  return Number(estimateAmount) - committed;
}
