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

module.exports = {
  computeMainHeadCapacity
};
