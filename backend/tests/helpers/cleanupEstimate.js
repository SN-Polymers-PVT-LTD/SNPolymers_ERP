const { supabase } = require('../../src/db/supabase');

async function cleanupEstimate(id, wo) {
  if (id) {
    await supabase.from('estimate_revision_log').delete().eq('estimate_id', id);
    await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', id);
    // Dissociate estimate from test project and test users to allow deleting them
    await supabase.from('project_cost_estimates').update({
      work_order_no: 'WB_BAN_102',
      created_by: '+918276071523',
      last_modified_by: '+918276071523',
      je_user_id: '+918276071523',
      zo_approved_by: null,
      ho_approved_by: null
    }).eq('estimate_id', id);
  }
  if (wo) {
    await supabase.from('projects_master').delete().eq('work_order_no', wo);
  }
}

module.exports = cleanupEstimate;
