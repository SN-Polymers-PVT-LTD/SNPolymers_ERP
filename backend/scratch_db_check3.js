const { supabase } = require('./src/db/supabase');
async function run() {
  const { data, error } = await supabase
    .from('project_cost_estimates')
    .select('estimate_id, estimate_no, estimate_status, work_order_no')
    .not('estimate_no', 'like', 'EST_%');
  console.log('Non-EST_ estimates:', data);
}
run();
