const { supabase } = require('../db/supabase');

/**
 * Service: ReconciliationService
 * Executes the database-level reconciliation RPC.
 */
async function executeReconciliation(zoUserId = null, actionedBy = 'SYSTEM') {
  const { data, error } = await supabase.rpc('reconcile_zonal_balances', {
    p_zo_user_id: zoUserId || null,
    p_actioned_by: actionedBy
  });
  if (error) throw error;
  return data;
}

module.exports = {
  executeReconciliation
};
