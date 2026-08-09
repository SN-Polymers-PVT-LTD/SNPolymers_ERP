import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const { getEstimateSummary } = require('../../../src/controllers/estimates.core.controller');

describe('getEstimateSummary — unpaginated Final Approved summary', () => {
  let suffix;
  let workOrderA;
  let workOrderB;
  let mobileJE;
  let mobileZO;
  let mobileAdmin;
  let approvedEstimateId;
  let draftEstimateId;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    workOrderA = `TEST_WO_ESUM_A_${suffix}`;
    workOrderB = `TEST_WO_ESUM_B_${suffix}`;
    mobileJE = `+91940000_${suffix.substring(0, 4)}`;
    mobileZO = `+91941111_${suffix.substring(0, 4)}`;
    mobileAdmin = `+91942222_${suffix.substring(0, 4)}`;

    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE, mobileZO, mobileAdmin]);

    const { error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: mobileJE, display_name: 'JE Summary', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileZO, display_name: 'ZO Summary', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: mobileAdmin, display_name: 'Admin Summary', role: 'admin', is_active: true, permissions: {} }
    ]);
    if (userError) throw userError;

    const { error: projError } = await supabase.from('projects_master').insert([
      {
        work_order_no: workOrderA,
        estimate_no: `EST_ESUM_A_${suffix}`,
        work_order_value: 500000,
        site_details: 'Summary Site A',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        zo_user_id: mobileZO,
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      },
      {
        work_order_no: workOrderB,
        estimate_no: `EST_ESUM_B_${suffix}`,
        work_order_value: 750000,
        site_details: 'Summary Site B',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        zo_user_id: mobileZO,
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);
    if (projError) throw projError;

    await supabase.from('je_zo_mappings').insert([
      { je_user_id: mobileJE, zo_user_id: mobileZO, is_active: true, assigned_by: mobileAdmin }
    ]);

    await supabase.from('work_order_mappings').insert([
      { work_order_no: workOrderA, je_user_id: mobileJE, is_active: true, assigned_by: mobileAdmin, reason: 'Assigned' },
      { work_order_no: workOrderB, je_user_id: mobileJE, is_active: true, assigned_by: mobileAdmin, reason: 'Assigned' }
    ]);

    const { data: approvedEst, error: approvedErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: workOrderA,
        estimate_no: `EST_ESUM_A_${suffix}`,
        area_code: 'Kolkata Zone',
        zonal_office_no: 'ZO-1',
        estimate_status: 'Final Approved',
        estimate_amount: 420000,
        created_by: mobileJE,
        last_modified_by: mobileJE,
        je_user_id: mobileJE
      })
      .select('estimate_id')
      .single();
    if (approvedErr) throw approvedErr;
    approvedEstimateId = approvedEst.estimate_id;

    const { data: draftEst, error: draftErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: workOrderB,
        estimate_no: `EST_ESUM_B_${suffix}`,
        area_code: 'Kolkata Zone',
        zonal_office_no: 'ZO-1',
        estimate_status: 'Draft',
        estimate_amount: 600000,
        created_by: mobileJE,
        last_modified_by: mobileJE,
        je_user_id: mobileJE
      })
      .select('estimate_id')
      .single();
    if (draftErr) throw draftErr;
    draftEstimateId = draftEst.estimate_id;
  });

  afterAll(async () => {
    if (approvedEstimateId) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', approvedEstimateId);
    }
    if (draftEstimateId) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', draftEstimateId);
    }
    await supabase.from('work_order_mappings').delete().in('work_order_no', [workOrderA, workOrderB]);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', mobileJE);
    await supabase.from('projects_master').delete().in('work_order_no', [workOrderA, workOrderB]);
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE, mobileZO, mobileAdmin]);
  });

  test('returns slim unpaginated rows with work_order_no and estimate_amount only', async () => {
    const res = mockRes();
    await getEstimateSummary(
      { query: { status: 'Final Approved' }, user: { mobile_number: mobileAdmin, role: 'admin' } },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.pagination).toBeUndefined();

    const match = res.jsonData.estimates.find((e) => e.work_order_no === workOrderA);
    expect(match).toBeDefined();
    expect(match).toEqual({
      work_order_no: workOrderA,
      estimate_amount: 420000
    });
    expect(Object.keys(match)).toEqual(['work_order_no', 'estimate_amount']);
  });

  test('filters by status=Final Approved', async () => {
    const res = mockRes();
    await getEstimateSummary(
      { query: { status: 'Final Approved' }, user: { mobile_number: mobileAdmin, role: 'admin' } },
      res
    );

    expect(res.statusCode).toBe(200);
    const woNos = res.jsonData.estimates.map((e) => e.work_order_no);
    expect(woNos).toContain(workOrderA);
    expect(woNos).not.toContain(workOrderB);
  });

  test('scopes JE and ZO users to mapped work orders', async () => {
    const resJe = mockRes();
    await getEstimateSummary(
      { query: { status: 'Final Approved' }, user: { mobile_number: mobileJE, role: 'je' } },
      resJe
    );

    const resZo = mockRes();
    await getEstimateSummary(
      { query: { status: 'Final Approved' }, user: { mobile_number: mobileZO, role: 'zo' } },
      resZo
    );

    expect(resJe.statusCode).toBe(200);
    expect(resZo.statusCode).toBe(200);

    const jeWoNos = resJe.jsonData.estimates.map((e) => e.work_order_no);
    const zoWoNos = resZo.jsonData.estimates.map((e) => e.work_order_no);

    expect(jeWoNos).toContain(workOrderA);
    expect(zoWoNos).toContain(workOrderA);
  });
});
