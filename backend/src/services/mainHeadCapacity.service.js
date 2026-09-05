'use strict';

const { supabase } = require('../db/supabase');

/**
 * Main Head capacity for a work order + material main head.
 * RPC enforcement uses approved-only; this matches getMainHeadCapacity display.
 */
async function computeMainHeadCapacity(workOrderNo, materialMainHead) {
  const trimmedHead = materialMainHead.trim();
  const trimmedWo = workOrderNo.trim();

  const { data: estimateData, error: estError } = await supabase
    .from('project_cost_estimates')
    .select('estimate_id')
    .eq('work_order_no', trimmedWo)
    .eq('estimate_status', 'Final Approved')
    .order('estimate_revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (estError) throw estError;

  let mainHeadEstimate = 0;
  let cumulativeApproved = 0;

  if (estimateData) {
    const { data: itemData, error: itemError } = await supabase
      .from('project_cost_estimate_items')
      .select('amount')
      .eq('estimate_id', estimateData.estimate_id)
      .eq('material_main_head', trimmedHead);

    if (itemError) throw itemError;

    mainHeadEstimate = (itemData || []).reduce((sum, item) => sum + Number(item.amount), 0);

    const { data: approvedReqs, error: approvedError } = await supabase
      .from('requisitions')
      .select('approved_amount')
      .eq('work_order_no', trimmedWo)
      .eq('material_main_head', trimmedHead)
      .eq('requisition_status', 'Approved');

    if (approvedError) throw approvedError;

    cumulativeApproved = (approvedReqs || []).reduce((sum, r) => sum + Number(r.approved_amount), 0);
  }

  return {
    mainHeadEstimate,
    cumulativeApproved,
    remainingCapacity: mainHeadEstimate - cumulativeApproved
  };
}

/**
 * Subcontractor Ledger capacity for a (work_order_no, material_sub_head,
 * material_details) triple. Unlike computeMainHeadCapacity, this reads a
 * persisted running balance (subcontractor_balances) rather than summing
 * live — the balance must survive an estimate reopen cycle, during which
 * there's briefly no 'Final Approved' estimate for the work order at all.
 */
async function computeSubcontractorCapacity(workOrderNo, materialSubHead, materialDetails) {
  const { data, error } = await supabase
    .from('subcontractor_balances')
    .select('estimated_total, paid_total, available_balance')
    .eq('work_order_no', workOrderNo.trim())
    .eq('material_sub_head', materialSubHead.trim())
    .eq('material_details', materialDetails.trim())
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return { estimatedTotal: 0, paidTotal: 0, availableBalance: 0 };
  }

  return {
    estimatedTotal: Number(data.estimated_total),
    paidTotal: Number(data.paid_total),
    availableBalance: Number(data.available_balance)
  };
}

module.exports = {
  computeMainHeadCapacity,
  computeSubcontractorCapacity
};
