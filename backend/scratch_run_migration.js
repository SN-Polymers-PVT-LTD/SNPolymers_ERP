const { supabase } = require('./src/db/supabase');
const fs = require('fs');
const path = require('path');

async function applyMigration() {
  console.log('Reading migration file...');
  const sqlPath = path.join(__dirname, 'src/db/migrations/36_analytics_dashboard_views.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  console.log('Sending SQL migration to Supabase via run_sql RPC...');
  const { data, error } = await supabase.rpc('run_sql', { query: sqlContent });

  if (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } else {
    console.log('Migration successfully applied!', data);
    process.exit(0);
  }
}

applyMigration();
