const { supabase } = require('./src/db/supabase');

async function check() {
  const { data, error } = await supabase.rpc('reconcile_zonal_balances', {
    p_zo_user_id: null,
    p_actioned_by: 'TEST_RECONCILE'
  });

  if (error) {
    console.error('Error executing reconcile_zonal_balances RPC:', error);
  } else {
    console.log('Reconciliation result:', data);
  }
}
check();
