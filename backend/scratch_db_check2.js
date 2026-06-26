const { supabase } = require('./src/db/supabase');
async function run() {
  const { data: estimates, error } = await supabase.from('project_cost_estimates').select('estimate_id, estimate_status, created_by, work_order_no');
  const counts = {};
  estimates.forEach(e => {
    counts[e.estimate_status] = (counts[e.estimate_status] || 0) + 1;
  });
  console.log('Status counts:', counts);
  console.log('Sample estimates:', estimates.slice(0, 10));
}
run();
