import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const setupUsers = require('../helpers/setupUsers');
const mockRes = require('../helpers/mockRes');
const {
  seedDashboardProject,
  refreshAnalyticsViews,
  cleanupDashboardProject
} = require('../helpers/seedDashboardProject');
const { getProjectsHealth } = require('../../src/controllers/analytics.controller');

describe('getProjectsHealth — local Supabase integration', () => {
  let suffix;
  let adminMobile;
  let zoMobile;
  let otherZoMobile;
  let je1Mobile;
  let je2Mobile;
  let workOrderNo;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    adminMobile = `97A1${suffix}`;
    zoMobile = `97Z1${suffix}`;
    otherZoMobile = `97Z2${suffix}`;
    je1Mobile = `97J1${suffix}`;
    je2Mobile = `97J2${suffix}`;
    workOrderNo = `WO-DASH-${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO One ${suffix}` },
      { mobile_number: otherZoMobile, role: 'zo', is_active: true, display_name: `ZO Two ${suffix}` },
      { mobile_number: je1Mobile, role: 'je', is_active: true, display_name: `JE One ${suffix}` },
      { mobile_number: je2Mobile, role: 'je', is_active: true, display_name: `JE Two ${suffix}` }
    ]);

    await seedDashboardProject({
      workOrderNo,
      zoMobile,
      jeMobiles: [je1Mobile, je2Mobile],
      adminMobile,
      department: 'Roads',
      suffix
    });

    await refreshAnalyticsViews();
  }, 60000);

  afterAll(async () => {
    await cleanupDashboardProject({
      workOrderNo,
      userMobiles: [adminMobile, zoMobile, otherZoMobile, je1Mobile, je2Mobile],
      jeMobiles: [je1Mobile, je2Mobile]
    });
  }, 60000);

  it('enriches assigned_jes with both mapped JEs on the same work order', async () => {
    const req = { user: { role: 'ho', mobile_number: adminMobile } };
    const res = mockRes();
    await getProjectsHealth(req, res);

    expect(res.statusCode).toBe(200);
    const row = res.jsonData.data.find(p => p.work_order_no === workOrderNo);
    expect(row).toBeDefined();
    expect(row.assigned_jes).toHaveLength(2);
    expect(row.assigned_jes.map(j => j.mobile_number).sort()).toEqual([je1Mobile, je2Mobile].sort());
    expect(row.assigned_jes.find(j => j.mobile_number === je1Mobile).name).toBe(`JE One ${suffix}`);
    expect(row.department).toBe('Roads');
  });

  it('scopes ZO callers to their zo_user_id only', async () => {
    const reqZo = { user: { role: 'zo', mobile_number: zoMobile } };
    const resZo = mockRes();
    await getProjectsHealth(reqZo, resZo);

    expect(resZo.statusCode).toBe(200);
    const woNos = resZo.jsonData.data.map(p => p.work_order_no);
    expect(woNos).toContain(workOrderNo);
    resZo.jsonData.data.forEach(p => {
      expect(p.zo_user_id).toBe(zoMobile);
    });

    const reqOther = { user: { role: 'zo', mobile_number: otherZoMobile } };
    const resOther = mockRes();
    await getProjectsHealth(reqOther, resOther);

    expect(resOther.statusCode).toBe(200);
    expect(resOther.jsonData.data.find(p => p.work_order_no === workOrderNo)).toBeUndefined();
  });

  it('returns only work orders mapped to the JE caller', async () => {
    const reqJe = { user: { role: 'je', mobile_number: je1Mobile } };
    const resJe = mockRes();
    await getProjectsHealth(reqJe, resJe);

    expect(resJe.statusCode).toBe(200);
    const woNos = resJe.jsonData.data.map(p => p.work_order_no);
    expect(woNos).toContain(workOrderNo);
    expect(resJe.jsonData.data[0].assigned_jes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getProjectsHealth — enrichment error surfacing (mocked)', () => {
  let req, res;

  beforeAll(() => {
    req = { user: { role: 'ho', mobile_number: '919000000000' } };
    res = mockRes();
  });

  it('returns 500 when work_order_mappings enrichment query fails', async () => {
    const mockHealthData = [
      { work_order_no: 'WO-001', health_score: 80, physical_progress: 50, zo_user_id: '919000000099' }
    ];

    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'project_health_mv') {
        const builder = {
          select: () => builder,
          order: () => Promise.resolve({ data: mockHealthData, error: null })
        };
        return builder;
      }
      if (table === 'projects_master') {
        const builder = {
          select: () => builder,
          in: () => Promise.resolve({
            data: [{ work_order_no: 'WO-001', department: 'Roads' }],
            error: null
          })
        };
        return builder;
      }
      if (table === 'work_order_mappings') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => Promise.resolve({
            data: null,
            error: { message: 'mapping query failed', code: 'PGRST500' }
          })
        };
        return builder;
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    });

    await getProjectsHealth(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.jsonData.success).toBe(false);

    vi.restoreAllMocks();
  });
});
