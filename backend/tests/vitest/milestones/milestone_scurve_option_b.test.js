import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const { getHoChartData } = require('../../../src/controllers/analytics.controller');

const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.jsonData = data; return res; };
  return res;
};

describe('S-Curve Option B — contract dates in chart payload', () => {
  let suffix;
  let adminMobile;
  let workOrderNo;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    adminMobile = `9530${suffix}`;
    workOrderNo = `WO_SCURVE_B_${suffix}`;

    await setupUsers([
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin SCurve ${suffix}` }
    ]);

    await setupProject(workOrderNo, `EST_SCURVE_${suffix}`, 400000, adminMobile);
    await supabase.from('projects_master').update({
      project_start_date: '2026-01-01',
      project_end_date: '2026-06-30'
    }).eq('work_order_no', workOrderNo);
  });

  afterAll(async () => {
    await supabase.from('projects_master').delete().eq('work_order_no', workOrderNo);
    await supabase.from('authorised_users').delete().eq('mobile_number', adminMobile);
  });

  test('TC-B.1: sCurveData entries expose schedule date fields', async () => {
    const req = { user: { role: 'admin', mobile_number: adminMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    (res.jsonData.sCurveData || []).forEach((entry) => {
      expect(entry).toHaveProperty('project_start_date');
      expect(entry).toHaveProperty('project_end_date');
    });
  });

  test('TC-B.2: projectsList includes project schedule dates', async () => {
    const req = { user: { role: 'admin', mobile_number: adminMobile }, query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    const project = (res.jsonData.projectsList || []).find((p) => p.work_order_no === workOrderNo);
    expect(project).toBeDefined();
    expect(project.project_start_date).toBe('2026-01-01');
    expect(project.project_end_date).toBe('2026-06-30');
  });
});
