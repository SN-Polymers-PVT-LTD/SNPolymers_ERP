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

  const { data: capData, error: capError } = await supabase.rpc('get_main_head_capacity', {
    p_work_order_no: trimmedWo,
    p_material_main_head: trimmedHead,
    p_exclude_requisition_id: null
  });

  if (capError) throw capError;

  const cap = Array.isArray(capData) ? capData[0] : capData;
  const mainHeadEstimate = Number(cap?.main_head_estimate || 0);
  const cumulativeApproved = Number(cap?.cumulative_approved || 0);
  const remainingCapacity = Number(cap?.remaining_capacity || 0);

  return {
    mainHeadEstimate,
    cumulativeApproved,
    remainingCapacity,
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

/** Canonical Phase 6 capacity. The database RPC is the only formula owner. */
async function computeSubcontractFinanceCapacity(workOrderNo, subcontractorId, subcontractWorkId) {
  const { data, error } = await supabase.rpc('get_subcontract_finance_capacity', {
    p_work_order_no: workOrderNo,
    p_subcontractor_id: subcontractorId,
    p_subcontract_work_id: subcontractWorkId
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || {
    approved_capacity: 0,
    reserved_amount: 0,
    paid_or_settled_amount: 0,
    consumed_amount: 0,
    available_contractor_capacity: 0,
    available_cost_estimate_capacity: 0,
    effective_available_capacity: 0
  };
}

module.exports = {
  computeMainHeadCapacity,
  computeSubcontractorCapacity,
  computeSubcontractFinanceCapacity
};
