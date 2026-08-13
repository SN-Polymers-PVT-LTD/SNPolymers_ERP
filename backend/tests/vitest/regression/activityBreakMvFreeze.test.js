import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const setupUsers = require('../../helpers/setupUsers');
const {
  seedDashboardProject,
  refreshAnalyticsViews,
  cleanupDashboardProject
} = require('../../helpers/seedDashboardProject');

/**
 * Guards the review-caught bug in project_health_mv's active_breaks CTE:
 * the freeze must be gated on status = 'Active' alone, never on a date window.
 * Test 2 is the regression case — expected_end_date already in the past,
 * status still Active — the freeze must still hold.
 */
describe('activityBreakMvFreeze — project_health_mv freeze behavior', () => {
  const suffix = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
  const jeMobile = `9500${suffix}`.substring(0, 15);
  const zoMobile = `9600${suffix}`.substring(0, 15);
  const adminMobile = `9700${suffix}`.substring(0, 15);
  const workOrder = `TEST_WO_BRK_${suffix}`;

  function daysAgoDateString(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }

  const staleLoginDate = daysAgoDateString(20);

  async function fetchHealthRow() {
    const { data, error } = await supabase
      .from('project_health_mv')
      .select('*')
      .eq('work_order_no', workOrder)
      .single();
    if (error) throw error;
    return data;
  }

  beforeAll(async () => {
    await requireLocalSupabase();

    await setupUsers([
      {
        mobile_number: adminMobile,
        role: 'admin',
        is_active: true,
        display_name: `Break Freeze Admin ${suffix}`,
        permissions: {}
      },
      {
        mobile_number: zoMobile,
        role: 'zo',
        is_active: true,
        display_name: `Break Freeze ZO ${suffix}`,
        permissions: {}
      },
      {
        mobile_number: jeMobile,
        role: 'je',
        is_active: true,
        display_name: `Break Freeze JE ${suffix}`,
        permissions: {}
      }
    ]);

    await seedDashboardProject({
      workOrderNo: workOrder,
      zoMobile,
      jeMobiles: [jeMobile],
      adminMobile,
      department: 'Civil',
      suffix
    });

    const { error: reportErr } = await supabase.from('daily_progress_reports').insert({
      created_by: jeMobile,
      login_date: staleLoginDate,
      work_order_no: workOrder,
      state: 'West Bengal',
      district: 'Kolkata',
      area_code: 'Kolkata Zone',
      department: 'Civil',
      site_details: `Dashboard test site ${suffix}`,
      site_visit_date: staleLoginDate,
      work_progress_details: 'Fixture progress entry',
      physical_work_progress: 10,
      daily_site_photo_url: 'fixtures/activity-break-freeze.jpg'
    });
    if (reportErr) throw reportErr;

    await refreshAnalyticsViews();
  }, 60000);

  afterAll(async () => {
    await supabase.from('work_order_activity_breaks').delete().eq('work_order_no', workOrder);
    await supabase.from('daily_progress_reports').delete().eq('work_order_no', workOrder);
    await cleanupDashboardProject({
      workOrderNo: workOrder,
      userMobiles: [adminMobile, zoMobile, jeMobile],
      jeMobiles: [jeMobile]
    });
  }, 60000);

  test('days_since_last_report is NOT frozen when no break exists', async () => {
    const row = await fetchHealthRow();

    expect(row.is_on_break).toBe(false);
    expect(row.break_overrun).toBe(false);
    expect(row.days_since_last_report).toBeGreaterThan(7);
    expect(row.reporting_score).toBe(0);
    expect(row.reporting_health_score).toBe(0);
  });

  test('freezes to 0 once status = Active, even when expected_end_date is already in the past', async () => {
    const { error: breakErr } = await supabase.from('work_order_activity_breaks').insert({
      work_order_no: workOrder,
      status: 'Active',
      start_date: daysAgoDateString(10),
      expected_end_date: daysAgoDateString(2),
      je_user_id: jeMobile,
      je_remarks: 'Monsoon season, site inaccessible'
    });
    if (breakErr) throw breakErr;

    await refreshAnalyticsViews();
    const row = await fetchHealthRow();

    // THE regression case: a date-window predicate on expected_end_date would
    // fail every assertion below, since expected_end_date is 2 days in the past.
    expect(row.is_on_break).toBe(true);
    expect(row.break_overrun).toBe(true);
    expect(row.days_since_last_report).toBe(0);
    expect(row.days_since_last_progress_report).toBe(0);
    expect(row.reporting_score).toBe(15);
    expect(row.reporting_health_score).toBe(100);
  });

  test('unfreezes once status = Ended', async () => {
    const { error: updErr } = await supabase
      .from('work_order_activity_breaks')
      .update({ status: 'Ended' })
      .eq('work_order_no', workOrder);
    if (updErr) throw updErr;

    await refreshAnalyticsViews();
    const row = await fetchHealthRow();

    expect(row.is_on_break).toBe(false);
    expect(row.break_overrun).toBe(false);
    expect(row.days_since_last_report).toBeGreaterThan(7);
    expect(row.reporting_score).toBe(0);
    expect(row.reporting_health_score).toBe(0);
  });

  test('cascaded views remain queryable', async () => {
    const [budgetLeakage, executiveKpi, zonePerformance] = await Promise.all([
      supabase.from('budget_leakage_mv').select('work_order_no', { count: 'exact', head: true }),
      supabase.from('executive_kpi_mv').select('id', { count: 'exact', head: true }),
      supabase.from('zone_performance_mv').select('zone', { count: 'exact', head: true })
    ]);

    expect(budgetLeakage.error).toBeNull();
    expect(executiveKpi.error).toBeNull();
    expect(zonePerformance.error).toBeNull();
  });
});
