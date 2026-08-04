const { supabase } = require('../../src/db/supabase');

/**
 * Seed a project with JE mappings for dashboard / getProjectsHealth integration tests.
 * Caller must run setupUsers() first and refresh_analytics_views() after.
 */
async function seedDashboardProject({
  workOrderNo,
  zoMobile,
  jeMobiles = [],
  adminMobile,
  department = 'Civil',
  status = 'Running',
  workOrderValue = 250000,
  suffix = ''
}) {
  const { error: projErr } = await supabase.from('projects_master').insert([
    {
      work_order_no: workOrderNo,
      estimate_no: `EST-${suffix || workOrderNo}`,
      site_details: `Dashboard test site ${suffix}`,
      zo_user_id: zoMobile,
      state: 'West Bengal',
      district: 'Kolkata',
      zone: `Zone ${suffix}`,
      department,
      status,
      created_by: adminMobile,
      edited_by: adminMobile,
      work_order_value: workOrderValue,
      project_start_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      project_end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }
  ]);

  if (projErr) throw new Error(`seedDashboardProject: project insert failed — ${projErr.message}`);

  for (const jeMobile of jeMobiles) {
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);

    const { error: jeZoErr } = await supabase.from('je_zo_mappings').insert({
      je_user_id: jeMobile,
      zo_user_id: zoMobile,
      assigned_by: adminMobile,
      is_active: true
    });

    if (jeZoErr) throw new Error(`seedDashboardProject: je_zo_mappings insert failed — ${jeZoErr.message}`);

    const { error: mapErr } = await supabase.from('work_order_mappings').insert({
      work_order_no: workOrderNo,
      je_user_id: jeMobile,
      assigned_by: adminMobile,
      is_active: true,
      reason: 'Assigned'
    });

    if (mapErr) throw new Error(`seedDashboardProject: mapping insert failed — ${mapErr.message}`);
  }
}

async function refreshAnalyticsViews() {
  const { error } = await supabase.rpc('refresh_analytics_views');
  if (error) throw new Error(`refresh_analytics_views failed — ${error.message}`);
}

async function cleanupDashboardProject({ workOrderNo, userMobiles = [], jeMobiles = [] }) {
  if (workOrderNo) {
    await supabase.from('work_order_mappings').delete().eq('work_order_no', workOrderNo);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrderNo);
  }
  if (jeMobiles.length > 0) {
    await supabase.from('je_zo_mappings').delete().in('je_user_id', jeMobiles);
  }
  if (userMobiles.length > 0) {
    await supabase.from('authorised_users').delete().in('mobile_number', userMobiles);
  }
  await refreshAnalyticsViews();
}

module.exports = {
  seedDashboardProject,
  refreshAnalyticsViews,
  cleanupDashboardProject
};
