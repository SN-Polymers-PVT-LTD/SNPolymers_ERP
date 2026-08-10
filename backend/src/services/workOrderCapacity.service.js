'use strict';

const { supabase } = require('../db/supabase');

/**
 * Returns Final Approved estimate_amount for a work order, or null if none.
 */
async function getApprovedEstimateAmount(workOrderNo) {
  const { data, error } = await supabase
    .from('project_cost_estimates')
    .select('estimate_amount')
    .eq('work_order_no', workOrderNo)
    .eq('estimate_status', 'Final Approved')
    .order('estimate_revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? Number(data.estimate_amount || 0) : null;
}

const FR_COMMITTED_STATUSES = ['Pending', 'Hold', 'Approved'];

/**
 * Effective committed amount for a single fund request row (client spec 4c).
 */
function getFundRequestCommittedAmount(row) {
  if (!row || !FR_COMMITTED_STATUSES.includes(row.request_status)) {
    return 0;
  }
  if (row.request_status === 'Approved') {
    return Number(row.approve_ho_amount || 0);
  }
  return Number(row.zo_fr_amount || 0);
}

/**
 * Sum of approve_ho_amount for Approved fund requests on a work order.
 */
async function getFundRequestApprovedTotal(workOrderNo) {
  const { data, error } = await supabase
    .from('fund_requests')
    .select('approve_ho_amount')
    .eq('work_order_no', workOrderNo)
    .eq('request_status', 'Approved');

  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + Number(r.approve_ho_amount || 0), 0);
}

/**
 * Sum of submitted/approved FR amounts (Pending + Hold + Approved) per client spec 4(c).
 */
async function getFundRequestSubmittedTotal(workOrderNo) {
  const { data, error } = await supabase
    .from('fund_requests')
    .select('request_status, zo_fr_amount, approve_ho_amount')
    .eq('work_order_no', workOrderNo)
    .in('request_status', FR_COMMITTED_STATUSES);

  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + getFundRequestCommittedAmount(r), 0);
}

/**
 * Sum of gross_bill for all RA/final bills on a work order.
 */
async function getBillingTotal(workOrderNo) {
  const { data, error } = await supabase
    .from('ra_final_bills')
    .select('gross_bill')
    .eq('work_order_no', workOrderNo);

  if (error) throw error;
  return (data || []).reduce((sum, b) => sum + Number(b.gross_bill || 0), 0);
}

/**
 * Billing cap enforced by create_ra_final_bill_secure: Final Approved estimate_amount.
 */
function resolveBillingCap(estimateAmount) {
  return estimateAmount != null ? Number(estimateAmount) : null;
}

/**
 * Fund request funding cap: Final Approved estimate, else work order value fallback.
 */
function resolveFundingCap(estimateAmount, workOrderValue) {
  if (estimateAmount != null) return Number(estimateAmount);
  return workOrderValue != null ? Number(workOrderValue) : null;
}

/**
 * Full capacity snapshot for a work order.
 */
async function getWorkOrderCapacity(workOrderNo) {
  const { data: project, error: projErr } = await supabase
    .from('projects_master')
    .select('work_order_value, status, zo_user_id')
    .eq('work_order_no', workOrderNo)
    .maybeSingle();

  if (projErr) throw projErr;
  if (!project) {
    return null;
  }

  const [estimateAmount, frSubmittedTotal, frApprovedTotal, billingTotal] = await Promise.all([
    getApprovedEstimateAmount(workOrderNo),
    getFundRequestSubmittedTotal(workOrderNo),
    getFundRequestApprovedTotal(workOrderNo),
    getBillingTotal(workOrderNo)
  ]);

  const workOrderValue = project.work_order_value != null ? Number(project.work_order_value) : null;
  const fundingCap = resolveFundingCap(estimateAmount, workOrderValue);
  const billingCap = resolveBillingCap(estimateAmount);
  const frRemaining = fundingCap != null ? fundingCap - frSubmittedTotal : null;
  const billingRemaining = billingCap != null ? Math.max(0, billingCap - billingTotal) : null;

  return {
    work_order_no: workOrderNo,
    work_order_value: workOrderValue,
    estimate_amount: estimateAmount,
    has_final_approved_estimate: estimateAmount != null,
    funding_cap: fundingCap,
    funding_cap_source: estimateAmount != null ? 'estimate' : (workOrderValue != null ? 'work_order_value' : null),
    fr_submitted_total: frSubmittedTotal,
    fr_approved_total: frApprovedTotal,
    fr_remaining: frRemaining,
    billing_cap: billingCap,
    billing_cap_source: estimateAmount != null ? 'estimate' : null,
    billing_total: billingTotal,
    billing_remaining: billingRemaining,
    status: project.status,
    zo_user_id: project.zo_user_id
  };
}

/**
 * Capacity snapshots for multiple work orders (skips missing WOs).
 */
async function getBulkWorkOrderCapacity(workOrderNos = []) {
  const unique = [...new Set((workOrderNos || []).filter(Boolean))];
  const capacities = await Promise.all(unique.map((wo) => getWorkOrderCapacity(wo)));
  const byWorkOrder = {};
  unique.forEach((wo, index) => {
    if (capacities[index]) {
      byWorkOrder[wo] = capacities[index];
    }
  });
  return byWorkOrder;
}

module.exports = {
  getApprovedEstimateAmount,
  getFundRequestCommittedAmount,
  getFundRequestApprovedTotal,
  getFundRequestSubmittedTotal,
  getBillingTotal,
  resolveBillingCap,
  resolveFundingCap,
  getWorkOrderCapacity,
  getBulkWorkOrderCapacity
};
