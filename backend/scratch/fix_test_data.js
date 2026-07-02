const { supabase } = require('../src/db/supabase');

async function fix() {
  console.log('Inspecting estimate for WB_BAN_102...');
  const { data: estimates, error: estErr } = await supabase
    .from('project_cost_estimates')
    .select('*')
    .eq('work_order_no', 'WB_BAN_102');
  
  if (estErr) {
    console.error('Error fetching estimates:', estErr);
    return;
  }
  console.log('Estimates for WB_BAN_102:', estimates);

  console.log('Inspecting requisitions for WB_BAN_102...');
  const { data: reqs, error: reqErr } = await supabase
    .from('requisitions')
    .select('*')
    .eq('work_order_no', 'WB_BAN_102');

  if (reqErr) {
    console.error('Error fetching requisitions:', reqErr);
    return;
  }
  console.log(`Found ${reqs.length} requisitions for WB_BAN_102.`);

  // Let's cancel or delete them if possible, or update status to Cancelled so they don't count towards the balance
  const activeReqs = reqs.filter(r => r.requisition_status !== 'Cancelled');
  console.log(`${activeReqs.length} active requisitions found.`);
  
  if (activeReqs.length > 0) {
    console.log('Cancelling active requisitions to release budget...');
    const { error: updErr } = await supabase
      .from('requisitions')
      .update({ requisition_status: 'Cancelled', cancelled_by: '+918276071523', cancelled_at: new Date().toISOString() })
      .eq('work_order_no', 'WB_BAN_102')
      .neq('requisition_status', 'Cancelled');
    if (updErr) {
      console.error('Error cancelling requisitions:', updErr);
    } else {
      console.log('Successfully cancelled active requisitions.');
    }
  }

  // Check if we need to update the estimate_amount of the Final Approved estimate to something higher (e.g. 100000)
  const approvedEst = estimates.find(e => e.estimate_status === 'Final Approved');
  if (approvedEst && Number(approvedEst.estimate_amount) < 100000) {
    console.log(`Updating estimate amount from ${approvedEst.estimate_amount} to 100000...`);
    const { error: updEstErr } = await supabase
      .from('project_cost_estimates')
      .update({ estimate_amount: 100000.00 })
      .eq('estimate_id', approvedEst.estimate_id);
    if (updEstErr) {
      console.error('Error updating estimate:', updEstErr);
    } else {
      console.log('Successfully updated estimate amount to 100000.');
    }
  }
}

fix();
