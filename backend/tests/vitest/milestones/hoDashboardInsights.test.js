import { describe, beforeAll, afterAll, test, expect } from 'vitest';
const crypto = require('crypto');
import { supabase } from '../../../src/db/supabase';
const setupUsers = require('../../helpers/setupUsers');
import { getHoActionableInsights, getHoChartData } from '../../../src/controllers/analytics.controller';

const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.jsonData = data; return res; };
  return res;
};

describe('HO Executive Analytics — Actionable Insights & Chart Data', () => {
  let suffix;
  let hoMobile;
  let zoMobile;
  let jeMobile;
  let adminMobile;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    hoMobile = `9501${suffix}`;
    zoMobile = `9502${suffix}`;
    jeMobile = `9503${suffix}`;
    adminMobile = `9504${suffix}`;

    await setupUsers([
      { mobile_number: hoMobile, role: 'ho', is_active: true, display_name: `HO M3 ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO M3 ${suffix}` },
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE M3 ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin M3 ${suffix}` }
    ]);
  });

  afterAll(async () => {
    await supabase.from('authorised_users').delete().in('mobile_number', [hoMobile, zoMobile, jeMobile, adminMobile]);
  });

  // ── M1 Tests ──────────────────────────────────────────────────────────────

  test('M1.1: requisitions table can be queried using payment_date range filter', async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('requisitions')
      .select('requisition_id, approved_amount, payment_date')
      .eq('requisition_status', 'Approved')
      .gte('payment_date', thirtyDaysAgo)
      .limit(10);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  // ── M2 Tests ──────────────────────────────────────────────────────────────

  test('M2.1: Runway data returns correct structure and handles zero-burn ZOs', async () => {
    const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
    const res = mockRes();
    await getHoActionableInsights(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(Array.isArray(res.jsonData.runwayData)).toBe(true);
    expect(Array.isArray(res.jsonData.stalledProjects)).toBe(true);
    expect(Array.isArray(res.jsonData.highRevisionProjects)).toBe(true);

    res.jsonData.runwayData.forEach(r => {
      expect(r).toHaveProperty('zo_user_id');
      expect(r).toHaveProperty('available_balance');
      expect(r).toHaveProperty('monthly_burn');
      expect(r).toHaveProperty('daily_burn');
      expect(r).toHaveProperty('runway_days'); // null or integer — both valid
    });

    const zeroBurnZO = res.jsonData.runwayData.find(r => r.monthly_burn === 0);
    if (zeroBurnZO) {
      expect(zeroBurnZO.runway_days).toBeNull();
    }
  });

  test('M2.2: Stalled projects only contain projects with progress < 100% and DPR gap > 7 days', async () => {
    const req = { user: { role: 'admin', mobile_number: adminMobile }, query: {} };
    const res = mockRes();
    await getHoActionableInsights(req, res);

    expect(res.statusCode).toBe(200);
    res.jsonData.stalledProjects.forEach(p => {
      expect(Number(p.physical_progress)).toBeLessThan(100);
      expect(Number(p.days_since_last_progress_report)).toBeGreaterThan(7);
    });
  });

  test('M2.3: RBAC — ZO and JE roles receive HTTP 403 on actionable-insights', async () => {
    const roles = [
      { role: 'zo', mobile_number: zoMobile },
      { role: 'je', mobile_number: jeMobile }
    ];
    for (const user of roles) {
      const req = { user, query: {} };
      const res = mockRes();
      await getHoActionableInsights(req, res);
      expect(res.statusCode).toBe(403);
    }
  });

  // ── M3 Tests ──────────────────────────────────────────────────────────────

  test('M3.1: Chart data returns all 6 dataset keys as arrays', async () => {
    const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    const keys = ['bubbleMatrix', 'waterfallData', 'zonalHeatmap', 'runwayTrend', 'sCurveData', 'revisionHeatmap'];
    keys.forEach(k => {
      expect(res.jsonData).toHaveProperty(k);
      expect(Array.isArray(res.jsonData[k])).toBe(true);
    });
  });

  test('M3.2: Waterfall stages are in correct order and amounts are non-negative numbers', async () => {
    const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    const wf = res.jsonData.waterfallData;
    expect(wf).toHaveLength(5);
    expect(wf[0].stage).toBe('Final Approved Estimate');
    expect(wf[1].stage).toBe('HO Allocated');
    expect(wf[2].stage).toBe('Requisitions Approved');
    expect(wf[3].stage).toBe('Gross Billed');
    expect(wf[4].stage).toBe('Agency Paid');
    wf.forEach(w => expect(Number(w.amount)).toBeGreaterThanOrEqual(0));
  });

  test('M3.3: bubbleMatrix items have finite numeric fields and no NaN values', async () => {
    const req = { user: { role: 'admin', mobile_number: adminMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    res.jsonData.bubbleMatrix.forEach(item => {
      expect(typeof item.work_order_no).toBe('string');
      expect(Number.isFinite(item.physical_progress)).toBe(true);
      expect(Number.isFinite(item.budget_utilization_pct)).toBe(true);
      expect(Number.isFinite(item.days_since_dpr)).toBe(true);
      expect(Number.isFinite(item.health_score)).toBe(true);
    });
  });

  test('M3.4: RBAC — ZO and JE roles receive HTTP 403 on chart-data', async () => {
    const roles = [
      { role: 'zo', mobile_number: zoMobile },
      { role: 'je', mobile_number: jeMobile }
    ];
    for (const user of roles) {
      const req = { user, query: {} };
      const res = mockRes();
      await getHoChartData(req, res);
      expect(res.statusCode).toBe(403);
    }
  });

  test('M3.5: Zone filter narrows bubbleMatrix to matching zone only', async () => {
    const { data: zoneData } = await supabase
      .from('project_health_mv').select('zone').limit(1).maybeSingle();
    if (!zoneData?.zone) return;

    const req = { user: { role: 'admin', mobile_number: adminMobile }, query: { zone: zoneData.zone } };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    res.jsonData.bubbleMatrix.forEach(item => {
      expect(item.zone).toBe(zoneData.zone);
    });
  });

  test('M3.6: getHoChartData returns departmentWiseEstimate array with valid structure', async () => {
    const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(Array.isArray(res.jsonData.departmentWiseEstimate)).toBe(true);
    expect(res.jsonData.departmentWiseEstimate.length).toBeGreaterThan(0);
    res.jsonData.departmentWiseEstimate.forEach(item => {
      expect(typeof item.department).toBe('string');
      expect(typeof item.amount).toBe('number');
      expect(typeof item.percentage).toBe('number');
      expect(item.amount).toBeGreaterThanOrEqual(0);
      expect(item.percentage).toBeGreaterThanOrEqual(0);
    });
  });

  test('M3.7: getHoChartData returns physicalProgressMetrics and jeVisitFrequencyMetrics with work order lists', async () => {
    const req = { user: { role: 'ho', mobile_number: hoMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    
    // Check physicalProgressMetrics
    const phys = res.jsonData.physicalProgressMetrics;
    expect(phys).toBeDefined();
    expect(typeof phys.avgProgress).toBe('string');
    expect(Array.isArray(phys.buckets)).toBe(true);
    expect(phys.buckets.length).toBe(4);
    phys.buckets.forEach(b => {
      expect(typeof b.label).toBe('string');
      expect(typeof b.count).toBe('number');
      expect(Array.isArray(b.workOrders)).toBe(true);
    });

    // Check jeVisitFrequencyMetrics
    const visit = res.jsonData.jeVisitFrequencyMetrics;
    expect(visit).toBeDefined();
    expect(typeof visit.avgVisit).toBe('string');
    expect(Array.isArray(visit.buckets)).toBe(true);
    expect(visit.buckets.length).toBe(4);
    visit.buckets.forEach(b => {
      expect(typeof b.label).toBe('string');
      expect(typeof b.count).toBe('number');
      expect(Array.isArray(b.workOrders)).toBe(true);
    });
  });
});
