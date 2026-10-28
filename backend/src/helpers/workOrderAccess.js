const { supabase } = require('../db/supabase');

/**
 * Resolves the work orders visible to a user based on their role and active mappings.
 * - Admin and HO have global access (returns null).
 * - JE is restricted to work orders where je_user_id = user.mobile_number and is_active = true.
 * - ZO is restricted to work orders mapped to JEs under their zonal supervision.
 *
 * @param {object} user - Authenticated user object from req.user
 * @returns {Promise<string[]|null>} Array of allowed work_order_no strings, or null if unrestricted.
 */
async function visibleWorkOrders(user) {
  if (!user) return [];
  if (user.role === 'admin' || user.role === 'ho') return null;

  if (user.role === 'je') {
    const { data, error } = await supabase
      .from('work_order_mappings')
      .select('work_order_no')
      .eq('je_user_id', user.mobile_number)
      .eq('is_active', true);
    if (error) throw error;
    return (data || []).map(row => row.work_order_no);
  }

  if (user.role === 'zo') {
    const { data: jeRows, error: jeError } = await supabase
      .from('je_zo_mappings')
      .select('je_user_id')
      .eq('zo_user_id', user.mobile_number)
      .eq('is_active', true);
    if (jeError) throw jeError;
    const jeIds = (jeRows || []).map(row => row.je_user_id);
    if (!jeIds.length) return [];

    const { data, error } = await supabase
      .from('work_order_mappings')
      .select('work_order_no')
      .in('je_user_id', jeIds)
      .eq('is_active', true);
    if (error) throw error;
    return [...new Set((data || []).map(row => row.work_order_no))];
  }

  return [];
}

module.exports = { visibleWorkOrders };
