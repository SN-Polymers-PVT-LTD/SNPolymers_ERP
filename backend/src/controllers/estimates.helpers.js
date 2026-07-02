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
  ESTIMATE_STATUS.HO_REVISION_REQUESTED
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
function canViewEstimate(estimate, user) {
  const effectiveRole = getEffectiveRole(user.role);
  if (effectiveRole === 'admin') {
    return true;
  }
  if (effectiveRole === 'je') {
    return estimate.created_by === user.mobile_number;
  }
  if (effectiveRole === 'zo') {
    return ZO_VISIBLE_STATUSES.includes(estimate.estimate_status);
  }
  if (effectiveRole === 'ho') {
    return HO_ALL_STATUSES.includes(estimate.estimate_status);
  }
  return false;
}

/**
 * Checks if the user is the creator of the estimate or an admin.
 * Returns a boolean.
 */
function isOwnerOrAdmin(estimate, user) {
  const isOwner = estimate.created_by === user.mobile_number;
  const isAdmin = user.role === 'admin';
  return isOwner || isAdmin;
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
