/** Statuses that count toward submitted FR totals in WO summary views */
export const FR_COMMITTED_STATUSES = new Set(['Pending', 'Hold', 'Approved']);

/**
 * Effective committed amount for a single fund request row.
 * Approved rows use approve_ho_amount; pending/hold use zo_fr_amount.
 */
export function getFundRequestCommittedAmount(request) {
  if (!request?.work_order_no || !FR_COMMITTED_STATUSES.has(request.request_status)) {
    return 0;
  }
  if (request.request_status === 'Approved') {
    return Number(request.approve_ho_amount || 0);
  }
  return Number(request.zo_fr_amount || 0);
}

/**
 * Sum of approved HO amounts only — matches backend funding capacity enforcement.
 */
export function buildApprovedFundRequestSumByWo(requests) {
  const frSumByWo = {};
  (requests || []).forEach((r) => {
    if (!r.work_order_no || r.request_status !== 'Approved') return;
    frSumByWo[r.work_order_no] = (frSumByWo[r.work_order_no] || 0) + Number(r.approve_ho_amount || 0);
  });
  return frSumByWo;
}

/**
 * Sum of effective committed amounts for display (pipeline + approved).
 */
export function buildSubmittedFrSumByWo(requests) {
  const frSumByWo = {};
  (requests || []).forEach((r) => {
    const amt = getFundRequestCommittedAmount(r);
    if (!r.work_order_no || amt === 0) return;
    frSumByWo[r.work_order_no] = (frSumByWo[r.work_order_no] || 0) + amt;
  });
  return frSumByWo;
}

/**
 * Remaining fund request capacity = estimate − Σ(approved approve_ho_amount).
 */
export function computeFundRequestRemaining(estimateAmount, approvedCommittedTotal) {
  if (estimateAmount == null) return null;
  return Number(estimateAmount) - Number(approvedCommittedTotal || 0);
}

/**
 * Filter fund requests approved in the current calendar month.
 */
export function filterApprovedThisMonth(requests, now = new Date()) {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return (requests || []).filter(
    (r) =>
      r.request_status === 'Approved' &&
      r.approve_ho_date &&
      new Date(r.approve_ho_date) >= startOfMonth
  );
}
