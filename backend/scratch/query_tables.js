const { supabase } = require('../src/db/supabase');

const tables = [
  'authorised_users',
  'projects_master',
  'audit_log',
  'fund_reports',
  'material_master',
  'purchase_data',
  'project_cost_estimates',
  'project_cost_estimate_items',
  'estimate_revision_log',
  'fund_requests'
];

async function checkAllTables() {
  console.log('Checking expected database tables:');
  for (const tableName of tables) {
    const { count, error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log(`❌ ${tableName}: Failed (Error: ${error.message})`);
    } else {
      console.log(`✅ ${tableName}: ${count} rows`);
    }
  }
}

checkAllTables();
