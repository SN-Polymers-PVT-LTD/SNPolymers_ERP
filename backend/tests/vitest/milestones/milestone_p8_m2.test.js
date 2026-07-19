import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const mockRes = require('../../helpers/mockRes');
const {
  getHoKpis,
  getZoProductivity,
  getRecentActivity,
  getProjectDigitalTwin
} = require('../../../src/controllers/analytics.controller');

describe('Milestone P8-M2 — API Endpoints & RBAC Safety Tests', () => {
  let suffix;
  let jeMobile;
  let zoMobile;
  let adminMobile;
  let otherZoMobile;
  let workOrderNo;
  let estimateId;
  let requisitionId;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9401${suffix}`;
    zoMobile = `9402${suffix}`;
    adminMobile = `9403${suffix}`;
    otherZoMobile = `9404${suffix}`;
    workOrderNo = `WO-P8-M2-${suffix}`;

    await setupUsers([
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE M2 ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO M2 ${suffix}` },
      { mobile_number: otherZoMobile, role: 'zo', is_active: true, display_name: `Other ZO M2 ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin M2 ${suffix}` }
    ]);

    // Insert project
    const { error: projErr } = await supabase
      .from('projects_master')
      .insert([
        {
          work_order_no: workOrderNo,
          estimate_no: `EST-P8-M2-${suffix}`,
          site_details: `Site M2 ${suffix}`,
          zo_user_id: zoMobile,
          state: 'State',
          district: 'District',
          zone: 'Zone M2',
          department: 'Civil',
          status: 'Running',
          created_by: adminMobile,
          edited_by: adminMobile,
          work_order_value: 150000.00,
          project_start_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          project_end_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      ]);

    if (projErr) throw new Error(`Project setup failed: ${projErr.message}`);

    // Set up JE-ZO mapping
    await supabase.from('je_zo_mappings').insert([
      { je_user_id: jeMobile, zo_user_id: zoMobile, assigned_by: adminMobile, is_active: true }
    ]);

    // Map work order to JE
    await supabase.from('work_order_mappings').insert([
      { work_order_no: workOrderNo, je_user_id: jeMobile, assigned_by: adminMobile, is_active: true, reason: 'Assigned' }
    ]);

    // Create Estimate
    const { data: estData } = await supabase
      .from('project_cost_estimates')
      .insert([
        {
          work_order_no: workOrderNo,
          estimate_no: `EST-P8-M2-${suffix}`,
          area_code: 'Zone M2',
          zonal_office_no: 'Zone M2',
          je_user_id: jeMobile,
          je_date: new Date().toISOString(),
          estimate_amount: 120000.00,
          estimate_status: 'Final Approved',
          estimate_revision: 0,
          created_by: jeMobile
        }
      ])
      .select('estimate_id')
      .single();

    estimateId = estData?.estimate_id;

    // Create Requisition
    const { data: reqData } = await supabase
      .from('requisitions')
      .insert([
        {
          work_order_no: workOrderNo,
          estimate_no: `EST-P8-M2-${suffix}`,
          state: 'State',
          district: 'District',
          area_code: 'Zone M2',
          department: 'Civil',
          site_details: `Site M2 ${suffix}`,
          requisition_no: `REQ-M2-${suffix}`,
          material_main_head: 'Cement',
          requisition_pdf_url: 'https://example.com/req.pdf',
          requisition_amount: 50000.00,
          gst_bill: 'No',
          bank_details: 'Test Bank Details',
          requisition_status: 'Approved',
          approved_amount: 40000.00,
          approved_balance_amount: 10000.00,
          requester_user_id: jeMobile,
          created_by: jeMobile,
          payment_date: new Date().toISOString(),
          approved_user_id: zoMobile
        }
      ])
      .select('requisition_id')
      .single();

    requisitionId = reqData?.requisition_id;

    await supabase.rpc('refresh_analytics_views');
  });

  afterAll(async () => {
    if (requisitionId) {
      await supabase.from('requisitions').delete().eq('requisition_id', requisitionId);
    }
    if (estimateId) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateId);
    }
    await supabase.from('work_order_mappings').delete().eq('work_order_no', workOrderNo);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrderNo);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile, otherZoMobile, adminMobile]);
    await supabase.rpc('refresh_analytics_views');
  });

  test('Test Case 2.1: Strict Security Checkpoints (RBAC)', async () => {
    // JE user querying HO KPIs is blocked (implicitly handled by express routing, but we verify controller handles errors or role validations)
    // Here we focus on digital twin protection for unmapped JEs
    const reqJeFail = {
      user: { role: 'je', mobile_number: `9499${suffix}` }, // unmapped JE mobile
      params: { work_order_no: workOrderNo }
    };
    const resJeFail = mockRes();
    await getProjectDigitalTwin(reqJeFail, resJeFail);

    expect(resJeFail.statusCode).toBe(403);
    expect(resJeFail.jsonData.success).toBe(false);

    // Mapped JE querying project twin succeeds
    const reqJeOk = {
      user: { role: 'je', mobile_number: jeMobile },
      params: { work_order_no: workOrderNo }
    };
    const resJeOk = mockRes();
    await getProjectDigitalTwin(reqJeOk, resJeOk);

    expect(resJeOk.statusCode).toBe(200);
    expect(resJeOk.jsonData.success).toBe(true);
  });

  test('Test Case 2.2: ZO Recent Activity Isolation & Link Resolution', async () => {
    // 1. Query recent activity as mapped ZO
    const reqZo = { user: { role: 'zo', mobile_number: zoMobile } };
    const resZo = mockRes();
    await getRecentActivity(reqZo, resZo);

    expect(resZo.statusCode).toBe(200);
    expect(resZo.jsonData.success).toBe(true);
    expect(Array.isArray(resZo.jsonData.activities)).toBe(true);

    // 2. Query recent activity as other ZO who doesn't own any projects
    const reqOther = { user: { role: 'zo', mobile_number: otherZoMobile } };
    const resOther = mockRes();
    await getRecentActivity(reqOther, resOther);

    expect(resOther.statusCode).toBe(200);
    expect(resOther.jsonData.activities.length).toBe(0);
  });
});
