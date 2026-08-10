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
 * Client spec 4(c): Remaining FR = Estimated Value − Total FR Submitted/Approved.
 * @param committedTotal from buildSubmittedFrSumByWo[wo] or sum of getFundRequestCommittedAmount
 */
export function computeFundRequestRemaining(estimateAmount, committedTotal) {
  if (estimateAmount == null) return null;
  return Number(estimateAmount) - Number(committedTotal || 0);
}

/**
 * Remaining FR capacity for one work order from a fund request list.
 */
export function computeFrRemainingForWo(estimateAmount, requests, workOrderNo) {
  const committedTotal = buildSubmittedFrSumByWo(requests)[workOrderNo] || 0;
  return computeFundRequestRemaining(estimateAmount, committedTotal);
}

/**
 * HO approve headroom for one request: estimate minus all other committed FRs.
 * The request being approved is excluded — pending is not treated as already approved.
 */
export function computeHoApproveRemaining(estimateAmount, submittedTotal, currentRequest) {
  if (estimateAmount == null) return null;
  const selfCommitted = getFundRequestCommittedAmount(currentRequest);
  const othersCommitted = Number(submittedTotal || 0) - selfCommitted;
  return Number(estimateAmount) - othersCommitted;
}

/**
 * Preview WO pipeline remaining if HO approves approveAmount on the current FR.
 * Uses HO headroom (excl. this pending request) minus the typed approval amount.
 */
export function computePipelineRemainingAfterApprove(hoHeadroomExclSelf, approveAmount) {
  if (hoHeadroomExclSelf == null) return null;
  const amt = Number(approveAmount);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  return Number(hoHeadroomExclSelf) - amt;
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
