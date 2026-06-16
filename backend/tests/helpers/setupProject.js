const { supabase } = require('../../src/db/supabase');

async function setupProject(wo, estNo, value, mobileAdmin) {
  const { error } = await supabase.from('projects_master').insert({
    work_order_no: wo,
    estimate_no: estNo,
    work_order_value: value,
    site_details: 'Testing Site',
    state: 'West Bengal',
    district: 'Kolkata',
    zone: 'Kolkata Zone',
    department: 'PWD',
    status: 'Running',
    created_by: mobileAdmin,
    edited_by: mobileAdmin
  });
  if (error) throw error;
}

module.exports = setupProject;
