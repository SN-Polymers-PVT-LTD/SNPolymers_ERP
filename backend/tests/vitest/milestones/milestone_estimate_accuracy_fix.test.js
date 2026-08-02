import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');

describe('Migration 004 — estimate_accuracy_mv accuracy_status fix', () => {
  let suffix;
  let adminMobile;
  const woUnreviewed = () => `WO_EST_UNREV_${suffix}`;
  const woModerate = () => `WO_EST_MOD_${suffix}`;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    adminMobile = `9520${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin EstAcc ${suffix}` }
    ]);

    await setupProject(woUnreviewed(), `EST_UNREV_${suffix}`, 250000, adminMobile);
    await setupProject(woModerate(), `EST_MOD_${suffix}`, 500000, adminMobile);

    const { error: unreviewedErr } = await supabase.from('project_cost_estimates').insert({
      estimate_id: crypto.randomUUID(),
      work_order_no: woUnreviewed(),
      estimate_no: `EST_UNREV_${suffix}`,
      area_code: 'Kolkata Zone',
      zonal_office_no: 'ZO-1',
      estimate_revision: 0,
      estimate_amount: 100000.00,
      estimate_status: 'Under ZO Review',
      created_by: adminMobile,
      last_modified_by: adminMobile
    });
    if (unreviewedErr) throw new Error(`Unreviewed estimate seed failed: ${unreviewedErr.message}`);

    const { error: moderateErr } = await supabase.from('project_cost_estimates').insert([
      {
        estimate_id: crypto.randomUUID(),
        work_order_no: woModerate(),
        estimate_no: `EST_MOD_${suffix}`,
        area_code: 'Kolkata Zone',
        zonal_office_no: 'ZO-1',
        estimate_revision: 0,
        estimate_amount: 100000.00,
        estimate_status: 'Draft',
        created_by: adminMobile,
        last_modified_by: adminMobile
      },
      {
        estimate_id: crypto.randomUUID(),
        work_order_no: woModerate(),
        estimate_no: `EST_MOD_${suffix}`,
        area_code: 'Kolkata Zone',
        zonal_office_no: 'ZO-1',
        estimate_revision: 1,
        estimate_amount: 110000.00,
        estimate_status: 'Final Approved',
        created_by: adminMobile,
        last_modified_by: adminMobile
      }
    ]);
    if (moderateErr) throw new Error(`Moderate variance estimate seed failed: ${moderateErr.message}`);

    const { error: refreshErr } = await supabase.rpc('refresh_analytics_views');
    if (refreshErr) throw new Error(`refresh_analytics_views failed: ${refreshErr.message}`);
  });

  afterAll(async () => {
    await supabase.from('project_cost_estimates').delete().in('work_order_no', [woUnreviewed(), woModerate()]);
    await supabase.from('projects_master').delete().in('work_order_no', [woUnreviewed(), woModerate()]);
    await supabase.from('authorised_users').delete().eq('mobile_number', adminMobile);
  });

  test('TC-4.1: no rows where variance_pct = 0 but accuracy_status is not Highly Accurate', async () => {
    const { data, error } = await supabase
      .from('estimate_accuracy_mv')
      .select('work_order_no, variance_pct, accuracy_status')
      .eq('variance_pct', 0)
      .neq('accuracy_status', 'Highly Accurate');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test('TC-4.2: unreviewed WO (no Final Approved row) is Highly Accurate at 0% variance', async () => {
    const { data, error } = await supabase
      .from('estimate_accuracy_mv')
      .select('work_order_no, variance_pct, accuracy_status')
      .eq('work_order_no', woUnreviewed())
      .single();

    expect(error).toBeNull();
    expect(Number(data.variance_pct)).toBe(0);
    expect(data.accuracy_status).toBe('Highly Accurate');
  });

  test('TC-4.3: Final Approved WO with 10% variance is Moderate Variance', async () => {
    const { data, error } = await supabase
      .from('estimate_accuracy_mv')
      .select('work_order_no, variance_pct, accuracy_status, original_estimate_amount, final_approved_estimate_amount')
      .eq('work_order_no', woModerate())
      .single();

    expect(error).toBeNull();
    expect(Number(data.original_estimate_amount)).toBe(100000);
    expect(Number(data.final_approved_estimate_amount)).toBe(110000);
    expect(Number(data.variance_pct)).toBe(10);
    expect(data.accuracy_status).toBe('Moderate Variance');
  });
});
