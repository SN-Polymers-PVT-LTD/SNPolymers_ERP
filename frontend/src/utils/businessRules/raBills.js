/**
 * Billing cap enforced by create_ra_final_bill_secure RPC (Final Approved estimate).
 */
export function resolveBillingCap(estimateAmount, workOrderValue) {
  if (estimateAmount != null && Number(estimateAmount) > 0) {
    return Number(estimateAmount);
  }
  return Number(workOrderValue || 0);
}

/**
 * Returns true when previous + current gross would exceed the billing cap (±0.01 tolerance).
 */
export function wouldExceedBillingCap(previousBilled, grossBill, billingCap) {
  const cap = Number(billingCap || 0);
  if (cap <= 0) return false;
  const totalAfter = Number(previousBilled || 0) + Number(grossBill || 0);
  return totalAfter > cap + 0.01;
}

/**
 * Remaining billable amount under the billing cap.
 */
export function computeBillingRemaining(billingCap, previousBilled) {
  const cap = Number(billingCap || 0);
  if (cap <= 0) return 0;
  return Math.max(0, cap - Number(previousBilled || 0));
}
