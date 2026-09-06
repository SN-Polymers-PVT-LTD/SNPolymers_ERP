'use strict';

const { supabase } = require('../db/supabase');

/**
 * Main Head capacity for a work order + material main head.
 * RPC enforcement uses approved-only; this matches getMainHeadCapacity display.
 */
async function computeMainHeadCapacity(workOrderNo, materialMainHead) {
  const trimmedHead = materialMainHead.trim();
  const trimmedWo = workOrderNo.trim();

  const { data: latestEstimate, error: estError } = await supabase
    .from('project_cost_estimates')
    .select('estimate_id, estimate_status')
    .eq('work_order_no', trimmedWo)
    .order('estimate_revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (estError) throw estError;

  const isReopened = [
    'Estimate Reopened',
    'Under ZO Review',
    'Under HO Review',
    'ZO Revision Requested',
    'HO Revision Requested'
  ].includes(latestEstimate?.estimate_status);

  const estimateLifecycle = {
    status: latestEstimate?.estimate_status || null,
    isReopened,
    requisitionsBlocked: isReopened,
    blockReason: isReopened
      ? `Estimate is currently undergoing revision (${latestEstimate.estimate_status}). New requisitions are paused until final approval.`
      : null
  };

  let mainHeadEstimate = 0;
  let cumulativeApproved = 0;

  if (latestEstimate && latestEstimate.estimate_status === 'Final Approved') {
    const { data: itemData, error: itemError } = await supabase
      .from('project_cost_estimate_items')
      .select('amount')
      .eq('estimate_id', latestEstimate.estimate_id)
      .eq('material_main_head', trimmedHead);

    if (itemError) throw itemError;

    mainHeadEstimate = (itemData || []).reduce((sum, item) => sum + Number(item.amount), 0);
  }

  const { data: approvedReqs, error: approvedError } = await supabase
    .from('requisitions')
    .select('approved_amount')
    .eq('work_order_no', trimmedWo)
    .eq('material_main_head', trimmedHead)
    .eq('requisition_status', 'Approved');

  if (approvedError) throw approvedError;

  cumulativeApproved = (approvedReqs || []).reduce((sum, r) => sum + Number(r.approved_amount), 0);

  return {
    mainHeadEstimate,
    cumulativeApproved,
    remainingCapacity: mainHeadEstimate - cumulativeApproved,
    estimateLifecycle
  };
}

/**
 * Subcontractor Ledger capacity for a (work_order_no, material_sub_head,
 * material_details) triple. Unlike computeMainHeadCapacity, this reads a
 * persisted running balance (subcontractor_balances) rather than summing
 * live — the balance survives an estimate reopen cycle.
 * Also returns estimateLifecycle metadata to inform the client if requisitions
 * are currently paused due to an ongoing estimate revision.
 */
async function computeSubcontractorCapacity(workOrderNo, materialSubHead, materialDetails) {
  const trimmedWo = workOrderNo.trim();
  const trimmedSub = materialSubHead.trim();
  const trimmedDet = materialDetails.trim();

  const { data: latestEstimate, error: estError } = await supabase
    .from('project_cost_estimates')
    .select('estimate_id, estimate_status')
    .eq('work_order_no', trimmedWo)
    .order('estimate_revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (estError) throw estError;

  const isReopened = [
    'Estimate Reopened',
    'Under ZO Review',
    'Under HO Review',
    'ZO Revision Requested',
    'HO Revision Requested'
  ].includes(latestEstimate?.estimate_status);

  const estimateLifecycle = {
    status: latestEstimate?.estimate_status || null,
    isReopened,
    requisitionsBlocked: isReopened,
    blockReason: isReopened
      ? `Estimate is currently undergoing revision (${latestEstimate.estimate_status}). New requisitions are paused until final approval.`
      : null
  };

  const { data, error } = await supabase
    .from('subcontractor_balances')
    .select('estimated_total, paid_total, available_balance')
    .eq('work_order_no', trimmedWo)
    .eq('material_sub_head', trimmedSub)
    .eq('material_details', trimmedDet)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      estimatedTotal: 0,
      paidTotal: 0,
      availableBalance: 0,
      estimateLifecycle
    };
  }

  return {
    estimatedTotal: Number(data.estimated_total),
    paidTotal: Number(data.paid_total),
    availableBalance: Number(data.available_balance),
    estimateLifecycle
  };
}

module.exports = {
  computeMainHeadCapacity,
  computeSubcontractorCapacity
};
