const { supabase } = require('../db/supabase');
const ESTIMATE_STATUS = require('../constants/estimate-status');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ZO_VISIBLE_STATUSES = [
  ESTIMATE_STATUS.SUBMITTED,
  ESTIMATE_STATUS.UNDER_ZO_REVIEW,
  ESTIMATE_STATUS.ZO_REVISION_REQUESTED,
  ESTIMATE_STATUS.ZO_APPROVED,
  ESTIMATE_STATUS.REJECTED_BY_ZO
];

const HO_ACTIVE_STATUSES = [
  ESTIMATE_STATUS.ZO_APPROVED,
  ESTIMATE_STATUS.UNDER_HO_REVIEW,
  ESTIMATE_STATUS.HO_REVISION_REQUESTED,
  ESTIMATE_STATUS.ESTIMATE_REOPENED
];

const HO_HISTORY_STATUSES = [
  ESTIMATE_STATUS.FINAL_APPROVED,
  ESTIMATE_STATUS.REJECTED_BY_HO
];

const HO_ALL_STATUSES = [...HO_ACTIVE_STATUSES, ...HO_HISTORY_STATUSES];

/**
 * Shared Helper: Fetches an estimate by ID.
 * Returns the estimate object if successful, or null on failure/invalid ID.
 */
async function getEstimateById(id, selectStr = '*') {
  if (!uuidRegex.test(id)) {
    return null;
  }

  const { data: estimate, error } = await supabase
    .from('project_cost_estimates')
    .select(selectStr)
    .eq('estimate_id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return estimate || null;
}

function getEffectiveRole(role) {
  return role;
}

/**
 * Checks if the user is authorized to view the given estimate.
 */
async function canViewEstimate(estimate, user) {
  const effectiveRole = getEffectiveRole(user.role);
  if (effectiveRole === 'admin' || effectiveRole === 'ho') {
    return true;
  }
  if (effectiveRole === 'zo') {
    // 1. Find all JEs currently mapped to this work order
    const { data: woMappings, error: woError } = await supabase
      .from('work_order_mappings')
      .select('je_user_id')
      .eq('work_order_no', estimate.work_order_no)
      .eq('is_active', true);

    if (woError) return false;

    let jeIds = [];
    if (woMappings && woMappings.length > 0) {
      jeIds = woMappings.map(m => m.je_user_id);
    } else if (estimate.created_by) {
      // Fallback for legacy tests: use creator JE
      jeIds = [estimate.created_by];
    }

    if (jeIds.length === 0) return false;

    // 2. Check if any of those JEs are mapped to this ZO
    const { data: mapping, error: mapErr } = await supabase
      .from('je_zo_mappings')
      .select('id')
      .in('je_user_id', jeIds)
      .eq('zo_user_id', user.mobile_number)
      .eq('is_active', true)
      .limit(1);

    if (mapErr) return false;
    return mapping && mapping.length > 0;
  }
  if (effectiveRole === 'je') {
    const { data: activeMappings, error: mapError } = await supabase
      .from('work_order_mappings')
      .select('je_user_id')
      .eq('work_order_no', estimate.work_order_no)
      .eq('is_active', true);

    if (mapError) throw mapError;

    if (activeMappings && activeMappings.length > 0) {
      // Only currently mapped JEs have access
      return activeMappings.some(m => m.je_user_id === user.mobile_number);
    } else {
      // Fallback for legacy tests: allow creator JE if no mappings are registered
      return estimate.created_by === user.mobile_number;
    }
  }
  return false;
}

/**
 * Checks if the user is authorized to edit/submit the estimate (owned by work order).
 * Admin and HO users always have edit access.
 * JEs only have edit access if they are currently mapped to the estimate's work order.
 */
async function isOwnerOrAdmin(estimate, user) {
  const effectiveRole = getEffectiveRole(user.role);
  if (effectiveRole === 'admin' || effectiveRole === 'ho') {
    return true;
  }
  if (effectiveRole === 'je') {
    try {
      const { data: activeMappings, error } = await supabase
        .from('work_order_mappings')
        .select('je_user_id')
        .eq('work_order_no', estimate.work_order_no)
        .eq('is_active', true);

      if (error) throw error;

      if (activeMappings && activeMappings.length > 0) {
        // Only currently mapped JEs have edit access
        return activeMappings.some(m => m.je_user_id === user.mobile_number);
      } else {
        // Fallback for legacy tests: allow creator JE if no mappings are registered
        return estimate.created_by === user.mobile_number;
      }
    } catch (err) {
      console.error(`[AUTH] isOwnerOrAdmin mapping check failed: ${err.message}`);
      return false;
    }
  }
  return false;
}

/**
 * Batches display name resolution for a list of mobile numbers.
 */
async function resolveDisplayNames(mobiles) {
  const uniqueMobiles = Array.from(new Set(mobiles.filter(Boolean)));
  const userMap = {};

  if (uniqueMobiles.length > 0) {
    const { data: users, error } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .in('mobile_number', uniqueMobiles);

    if (!error && users) {
      users.forEach(u => {
        userMap[u.mobile_number] = u.display_name;
      });
    }
  }

  return userMap;
}

/**
 * Checks if key fields on a line item have changed.
 */
function hasItemFieldChanged(prevItem, item) {
  return (
    String(prevItem.qty) !== String(item.qty) ||
    String(prevItem.rate) !== String(item.rate) ||
    prevItem.material_main_head !== item.material_main_head ||
    prevItem.material_sub_head !== item.material_sub_head ||
    prevItem.material_details !== item.material_details ||
    prevItem.unit !== item.unit ||
    (prevItem.source_of_purchase || null) !== (item.source_of_purchase || null)
  );
}

module.exports = {
  uuidRegex,
  ZO_VISIBLE_STATUSES,
  HO_ACTIVE_STATUSES,
  HO_HISTORY_STATUSES,
  HO_ALL_STATUSES,
  getEstimateById,
  getEffectiveRole,
  canViewEstimate,
  isOwnerOrAdmin,
  resolveDisplayNames,
  hasItemFieldChanged
};
