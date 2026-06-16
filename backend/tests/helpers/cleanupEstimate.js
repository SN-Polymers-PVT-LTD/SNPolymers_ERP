const { supabase } = require('../../src/db/supabase');

async function cleanupEstimate(id, wo) {
  if (id) {
    await supabase.from('estimate_revision_log').delete().eq('estimate_id', id);
    await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', id);
    await supabase.from('audit_log').delete().eq('record_identifier', id.toString());
    await supabase.from('project_cost_estimates').delete().eq('estimate_id', id);
  }
  if (wo) {
    await supabase.from('projects_master').delete().eq('work_order_no', wo);
  }
}

module.exports = cleanupEstimate;
