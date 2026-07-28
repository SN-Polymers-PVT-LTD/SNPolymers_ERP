'use strict';

const { supabase } = require('../db/supabase');

/**
 * CRITICAL ARCHITECTURAL GUARANTEE:
 * getAllActiveZOs returns ALL active Zonal Office users without any financial/balance filtering.
 * Do NOT add balance/financial filters (e.g. available_balance > 0) to this function.
 * General UI dropdowns (Master Data, User Mappings, Dashboards) depend on receiving all active ZOs.
 *
 * @returns {Promise<Array<{mobile_number: string, display_name: string}>>}
 */
async function getAllActiveZOs() {
  const { data: zos, error } = await supabase
    .from('authorised_users')
    .select('mobile_number, display_name')
    .eq('role', 'zo')
    .eq('is_active', true)
    .order('display_name', { ascending: true });

  if (error) {
    console.error(`zoService.getAllActiveZOs failed: ${error.message}`);
    throw error;
  }

  return (zos || []).map(z => ({
    mobile_number: z.mobile_number,
    display_name: z.display_name || z.mobile_number
  }));
}

/**
 * Returns Zonal Office users that have a positive available balance (> 0) for excess fund return requests.
 * Used exclusively by the Excess Fund Returns module.
 *
 * @returns {Promise<Array<{mobile_number: string, display_name: string, available_balance: number}>>}
 */
async function getTargetZOsForExcessReturns() {
  // 1. Fetch ZOs with positive available balance (> 0)
  const { data: positiveBalances, error: balErr } = await supabase
    .from('zo_balances')
    .select('zo_user_id, available_balance')
    .gt('available_balance', 0);

  if (balErr) {
    console.error(`zoService.getTargetZOsForExcessReturns (balance query) failed: ${balErr.message}`);
    throw balErr;
  }

  const positiveZoMobiles = (positiveBalances || []).map(b => b.zo_user_id);

  if (positiveZoMobiles.length === 0) {
    return [];
  }

  // 2. Fetch active ZO user profiles
  const { data: zos, error: userErr } = await supabase
    .from('authorised_users')
    .select('mobile_number, display_name')
    .eq('role', 'zo')
    .eq('is_active', true)
    .in('mobile_number', positiveZoMobiles)
    .order('display_name', { ascending: true });

  if (userErr) {
    console.error(`zoService.getTargetZOsForExcessReturns (users query) failed: ${userErr.message}`);
    throw userErr;
  }

  const balMap = {};
  positiveBalances.forEach(b => {
    balMap[b.zo_user_id] = Number(b.available_balance || 0);
  });

  return (zos || []).map(z => ({
    mobile_number: z.mobile_number,
    display_name: z.display_name || z.mobile_number,
    available_balance: balMap[z.mobile_number] || 0
  }));
}

module.exports = {
  getAllActiveZOs,
  getTargetZOsForExcessReturns
};
