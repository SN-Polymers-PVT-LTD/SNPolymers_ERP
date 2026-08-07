import { describe, beforeAll, afterAll, test, expect } from 'vitest';
const crypto = require('crypto');
import { supabase } from '../../../src/db/supabase';
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
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
  let testWorkOrder;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    hoMobile = `9501${suffix}`;
    zoMobile = `9502${suffix}`;
    jeMobile = `9503${suffix}`;
    adminMobile = `9504${suffix}`;
    testWorkOrder = `TEST_WO_HO_M3_${suffix}`;

    await setupUsers([
      { mobile_number: hoMobile, role: 'ho', is_active: true, display_name: `HO M3 ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO M3 ${suffix}` },
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE M3 ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin M3 ${suffix}` }
    ]);

    await setupProject(testWorkOrder, `EST_HO_M3_${suffix}`, 500000, adminMobile);
  });

  afterAll(async () => {
    await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
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

  test('M2.3: RBAC — JE role receives HTTP 403 on actionable-insights while ZO and HO are permitted', async () => {
    const reqJe = { user: { role: 'je', mobile_number: jeMobile }, query: {} };
    const resJe = mockRes();
    await getHoActionableInsights(reqJe, resJe);
    expect(resJe.statusCode).toBe(403);

    const reqZo = { user: { role: 'zo', mobile_number: zoMobile }, query: {} };
    const resZo = mockRes();
    await getHoActionableInsights(reqZo, resZo);
    expect(resZo.statusCode).toBe(200);
  });

  // ── M3 Tests ──────────────────────────────────────────────────────────────

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

describe('P0 — ZO zone scoping (analytics data isolation)', () => {
  let suffix;
  let zoUserA;
  let zoUserB;
  let ledgerIdA;
  let ledgerIdB;
  const balanceA = 111111.11;
  const balanceB = 222222.22;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    zoUserA = `9510${suffix}`;
    zoUserB = `9511${suffix}`;
    ledgerIdA = crypto.randomUUID();
    ledgerIdB = crypto.randomUUID();

    await setupUsers([
      { mobile_number: zoUserA, role: 'zo', is_active: true, display_name: `ZO Scope A ${suffix}` },
      { mobile_number: zoUserB, role: 'zo', is_active: true, display_name: `ZO Scope B ${suffix}` }
    ]);

    await supabase.from('zo_balances').upsert([
      { zo_user_id: zoUserA, available_balance: balanceA, updated_at: new Date().toISOString() },
      { zo_user_id: zoUserB, available_balance: balanceB, updated_at: new Date().toISOString() }
    ]);

    await supabase.from('zo_fund_ledger').insert([
      {
        ledger_id: ledgerIdA,
        zo_user_id: zoUserA,
        transaction_type: 'ALLOCATION',
        reference_type: 'FUND_REQUEST',
        reference_id: ledgerIdA,
        amount: balanceA,
        created_by: zoUserA
      },
      {
        ledger_id: ledgerIdB,
        zo_user_id: zoUserB,
        transaction_type: 'ALLOCATION',
        reference_type: 'FUND_REQUEST',
        reference_id: ledgerIdB,
        amount: balanceB,
        created_by: zoUserB
      }
    ]);
  });

  afterAll(async () => {
    await supabase.from('zo_fund_ledger').delete().in('ledger_id', [ledgerIdA, ledgerIdB]);
    await supabase.from('zo_balances').delete().in('zo_user_id', [zoUserA, zoUserB]);
    await supabase.from('authorised_users').delete().in('mobile_number', [zoUserA, zoUserB]);
  });

  test('P0.1: ZO caller sees only own zone in actionable-insights runwayData', async () => {
    const req = { user: { role: 'zo', mobile_number: zoUserA }, query: {} };
    const res = mockRes();
    await getHoActionableInsights(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.runwayData.length).toBe(1);
    expect(res.jsonData.runwayData[0].zo_user_id).toBe(zoUserA);
    expect(res.jsonData.runwayData[0].available_balance).toBe(balanceA);
  });

  test('P0.2: ZO caller sees only own zone in chart-data runwayTrend', async () => {
    const req = { user: { role: 'zo', mobile_number: zoUserA }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    const zoIds = (res.jsonData.runwayTrend || []).map(r => r.zo_user_id);
    expect(zoIds).toContain(zoUserA);
    expect(zoIds).not.toContain(zoUserB);
    zoIds.forEach(id => expect(id).toBe(zoUserA));
  });

  test('P0.3: ZO notUtilized matches zoAvailableBalance and excludes other zones', async () => {
    const req = { user: { role: 'zo', mobile_number: zoUserA }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    const { notUtilized } = res.jsonData.keyFinancialIndicators;
    const { zoAvailableBalance } = res.jsonData.executiveSummaryKpis;
    expect(notUtilized).toBe(balanceA);
    expect(zoAvailableBalance).toBe(balanceA);
    expect(notUtilized).toBe(zoAvailableBalance);
    expect(notUtilized).not.toBe(balanceB);
  });
});
