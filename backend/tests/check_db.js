const { supabase } = require('../src/db/supabase');

async function main() {
  const workOrder = 'WB_BAN_102';

  // 1. Delete all requisitions for WB_BAN_102 to clear previous test accumulations
  const { data: delData, error: delError } = await supabase
    .from('requisitions')
    .delete()
    .eq('work_order_no', workOrder);
  console.log('Deleted requisitions:', delData, delError);

  // 2. Fetch all Final Approved estimates for WB_BAN_102
  const { data: approvedEstimates, error: fetchError } = await supabase
    .from('project_cost_estimates')
    .select('estimate_id, estimate_amount, estimate_revision')
    .eq('work_order_no', workOrder)
    .eq('estimate_status', 'Final Approved');
  console.log('Current Final Approved estimates:', approvedEstimates, fetchError);

  if (approvedEstimates && approvedEstimates.length > 0) {
    // Update all of them to have a large estimate_amount (e.g., 1,000,000)
    for (const est of approvedEstimates) {
      const { data: updData, error: updError } = await supabase
        .from('project_cost_estimates')
        .update({ estimate_amount: 1000000.00 })
        .eq('estimate_id', est.estimate_id);
      console.log(`Updated estimate ${est.estimate_id} to 1,000,000:`, updData, updError);
    }
  } else {
    // If no Final Approved estimate exists, insert one
    const { data: insData, error: insError } = await supabase
      .from('project_cost_estimates')
      .insert([{
        work_order_no: workOrder,
        estimate_no: 'EST_P4_MOCK_FINAL',
        estimate_amount: 1000000.00,
        estimate_status: 'Final Approved',
        estimate_revision: 99,
        created_by: '+918276071523',
        je_user_id: '+918276071523',
        area_code: 'South Bengal',
        zonal_office_no: 'ZO-01'
      }])
      .select();
    console.log('Inserted a new Final Approved estimate:', insData, insError);
  }
}

main();
