const { supabase } = require('../src/db/supabase');

async function checkTriggers() {
  console.log('Checking trigger status on database...');
  // We can query pg_trigger view using sql RPC or raw query if available.
  // Wait, does the supabase client support raw SQL execution? Usually no, unless there is a custom RPC.
  // Let's see if there is any RPC for running SQL, or we can check what functions exist.
  const { data, error } = await supabase.rpc('execute_sql_query', {
    query_text: `
      SELECT 
        tgname AS trigger_name, 
        relname AS table_name,
        CASE tgenabled
          WHEN 'O' THEN 'Enabled (Origin)'
          WHEN 'D' THEN 'Disabled'
          WHEN 'A' THEN 'Always Enabled'
          WHEN 'R' THEN 'Replica Only'
          ELSE tgenabled::text
        END AS status
      FROM pg_trigger
      JOIN pg_class ON pg_class.oid = tgrelid
      WHERE relname IN ('project_cost_estimates', 'material_master', 'authorised_users', 'projects_master')
        AND NOT tgisinternal;
    `
  });

  if (error) {
    // If execute_sql_query RPC doesn't exist, we can try to see what we can do or just inform the user.
    console.error('Error querying triggers:', error);
    
    // Let's fallback to checking if we can query some other tables or if we should just guide the user.
    console.log('Falling back to a query to try executing basic info...');
  } else {
    console.log('Trigger Statuses:');
    console.table(data);
  }
}

checkTriggers();
