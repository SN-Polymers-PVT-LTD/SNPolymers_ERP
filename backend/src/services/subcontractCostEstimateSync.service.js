'use strict';

const { supabase } = require('../db/supabase');

async function syncSubcontractContributionsToCostEstimate(costEstimateId, actor) {
  const { error } = await supabase.rpc('sync_subcontract_contributions_to_cost_estimate', {
    p_cost_estimate_id: costEstimateId,
    p_actor: actor || 'SYSTEM'
  });
  if (error) throw error;
}

async function syncEditableCostEstimateForWorkOrder(workOrderNo, actor) {
  const { data: estimate, error } = await supabase
    .from('project_cost_estimates')
    .select('estimate_id')
    .eq('work_order_no', workOrderNo)
    .in('estimate_status', ['Draft', 'Estimate Reopened'])
    .maybeSingle();
  if (error) throw error;
  if (!estimate) return false;
  await syncSubcontractContributionsToCostEstimate(estimate.estimate_id, actor);
  return true;
}

module.exports = {
  syncSubcontractContributionsToCostEstimate,
  syncEditableCostEstimateForWorkOrder
};
