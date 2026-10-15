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

async function syncEditableCostEstimateForWorkOrderBestEffort(workOrderNo, actor, context) {
  try {
    return await syncEditableCostEstimateForWorkOrder(workOrderNo, actor);
  } catch (error) {
    console.error(`Deferred subcontract Cost Estimate sync${context ? ` after ${context}` : ''}: ${error.message}`);
    return false;
  }
}

async function syncSubcontractContributionsToCostEstimateBestEffort(costEstimateId, actor, context) {
  try {
    await syncSubcontractContributionsToCostEstimate(costEstimateId, actor);
    return true;
  } catch (error) {
    console.error(`Deferred subcontract Cost Estimate sync${context ? ` after ${context}` : ''}: ${error.message}`);
    return false;
  }
}

module.exports = {
  syncSubcontractContributionsToCostEstimate,
  syncEditableCostEstimateForWorkOrder,
  syncEditableCostEstimateForWorkOrderBestEffort,
  syncSubcontractContributionsToCostEstimateBestEffort
};
