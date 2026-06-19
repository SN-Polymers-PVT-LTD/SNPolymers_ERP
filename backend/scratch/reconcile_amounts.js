const { supabase } = require('../src/db/supabase');

async function reconcile() {
  console.log('Starting estimate amount reconciliation...');

  try {
    // 1. Fetch all estimates
    const { data: estimates, error: estErr } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id, estimate_status');
    
    if (estErr) throw estErr;
    console.log(`Fetched ${estimates.length} estimates.`);

    for (const est of estimates) {
      // 2. Fetch all items for this estimate
      const { data: items, error: itemsErr } = await supabase
        .from('project_cost_estimate_items')
        .select('amount, zo_office_approve, ho_office_approve')
        .eq('estimate_id', est.estimate_id);

      if (itemsErr) throw itemsErr;

      // 3. Recalculate amount using the database workflow logic
      // - Pre-review/Draft/Submitted/Under ZO/Revision/Rejected: Sum all items
      // - ZO Approved / Under HO Review / HO Revision: Sum ZO-approved rows
      // - Final Approved: Sum rows approved by both ZO and HO
      let sum = 0;
      const status = est.estimate_status;

      if (status === 'Draft' || status === 'Submitted' || status === 'Under ZO Review' ||
          status === 'ZO Revision Requested' || status === 'Rejected by ZO' || status === 'Rejected by HO') {
        sum = items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
      } else if (status === 'ZO Approved' || status === 'Under HO Review' || status === 'HO Revision Requested') {
        sum = items
          .filter(item => item.zo_office_approve === 'Approve')
          .reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
      } else if (status === 'Final Approved') {
        sum = items
          .filter(item => item.zo_office_approve === 'Approve' && item.ho_office_approve === 'Approve')
          .reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
      } else {
        sum = items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
      }

      // 4. Update estimate header amount in DB
      const { error: updErr } = await supabase
        .from('project_cost_estimates')
        .update({ estimate_amount: sum })
        .eq('estimate_id', est.estimate_id);

      if (updErr) throw updErr;
      console.log(`Reconciled estimate ID ${est.estimate_id}: Status = ${status}, Items Count = ${items.length}, New Amount = ${sum}`);
    }

    console.log('Reconciliation completed successfully!');
  } catch (error) {
    console.error('Reconciliation failed with error:', error);
  }
}

reconcile();
