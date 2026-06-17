const { supabase } = require('../src/db/supabase');

const keepMobiles = [
  '+919876543210', // JE USER
  '+919000000001', // Zonal Head
  '+919000000002', // Head Office Admin
  '+919999999999', // Master Admin
  '+917980526576'  // Aryak Pal
];

async function clean() {
  console.log('Initiating database cleanup...');

  try {
    // 1. Delete all revisions
    const { error: revErr } = await supabase
      .from('estimate_revision_log')
      .delete()
      .neq('revision_cycle', -1); // Deletes all rows safely
    if (revErr) throw revErr;
    console.log('- Cleared all project cost estimate revisions.');

    // 2. Delete all estimate items
    const { error: itemErr } = await supabase
      .from('project_cost_estimate_items')
      .delete()
      .neq('qty', -9999);
    if (itemErr) throw itemErr;
    console.log('- Cleared all project cost estimate items.');

    // 3. Delete all test estimate sheets (catch trigger restrictions safely)
    try {
      const { error: estErr } = await supabase
        .from('project_cost_estimates')
        .delete()
        .like('work_order_no', 'TEST_WO_%');
      if (estErr) throw estErr;
      console.log('- Cleared all project cost test estimate sheets.');
    } catch (err) {
      console.log('- Skipping estimate sheets deletion due to database immutability trigger constraints.');
    }

    // 4. Delete whitelisted test users (except standard seeds)
    const { error: userErr } = await supabase
      .from('authorised_users')
      .delete()
      .not('mobile_number', 'in', `(${keepMobiles.join(',')})`);
    if (userErr) throw userErr;
    console.log('- Cleared all test and temporary whitelisted user accounts.');

    console.log('Database cleanup completed successfully!');
  } catch (error) {
    console.error('Cleanup failed with error:', error);
  }
}

clean();
