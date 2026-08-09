import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { getEstimateSummary } = require('../../../src/controllers/estimates.core.controller');

describe('getEstimateSummary — unpaginated Final Approved summary', () => {
  let suffix;
  let workOrderA;
  let workOrderB;
  let workOrderC;
  let mobileJE;
  let mobileJEOther;
  let mobileZO;
  let mobileZOOther;
  let mobileAdmin;
  let approvedEstimateId;
  let draftEstimateId;
  let otherZoApprovedEstimateId;

  beforeAll(async () => {
    await requireLocalSupabase();

    suffix = crypto.randomUUID().substring(0, 8);
    workOrderA = `TEST_WO_ESUM_A_${suffix}`;
    workOrderB = `TEST_WO_ESUM_B_${suffix}`;
    workOrderC = `TEST_WO_ESUM_C_${suffix}`;
    mobileJE = `9501${suffix}`;
    mobileJEOther = `9502${suffix}`;
    mobileZO = `9503${suffix}`;
    mobileZOOther = `9504${suffix}`;
    mobileAdmin = `9505${suffix}`;

    await supabase.from('authorised_users').delete().in('mobile_number', [
      mobileJE, mobileJEOther, mobileZO, mobileZOOther, mobileAdmin
    ]);

    const { error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: mobileJE, display_name: 'JE Summary', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileJEOther, display_name: 'JE Other', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileZO, display_name: 'ZO Summary', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: mobileZOOther, display_name: 'ZO Other', role: 'zo', is_active: true, permissions: {} },
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
      },
      {
        work_order_no: workOrderC,
        estimate_no: `EST_ESUM_C_${suffix}`,
        work_order_value: 900000,
        site_details: 'Summary Site C',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        zo_user_id: mobileZOOther,
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);
    if (projError) throw projError;

    await supabase.from('je_zo_mappings').insert([
      { je_user_id: mobileJE, zo_user_id: mobileZO, is_active: true, assigned_by: mobileAdmin },
      { je_user_id: mobileJEOther, zo_user_id: mobileZOOther, is_active: true, assigned_by: mobileAdmin }
    ]);

    const { error: woMapErr } = await supabase.from('work_order_mappings').insert([
      { work_order_no: workOrderA, je_user_id: mobileJE, is_active: true, assigned_by: mobileAdmin, reason: 'Assigned' },
      { work_order_no: workOrderB, je_user_id: mobileJE, is_active: true, assigned_by: mobileAdmin, reason: 'Assigned' },
      { work_order_no: workOrderC, je_user_id: mobileJEOther, is_active: true, assigned_by: mobileAdmin, reason: 'Assigned' }
    ]);
    if (woMapErr) throw woMapErr;

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

    const { data: otherZoEst, error: otherZoErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: workOrderC,
        estimate_no: `EST_ESUM_C_${suffix}`,
        area_code: 'Kolkata Zone',
        zonal_office_no: 'ZO-2',
        estimate_status: 'Final Approved',
        estimate_amount: 880000,
        created_by: mobileJEOther,
        last_modified_by: mobileJEOther,
        je_user_id: mobileJEOther
      })
      .select('estimate_id')
      .single();
    if (otherZoErr) throw otherZoErr;
    otherZoApprovedEstimateId = otherZoEst.estimate_id;
  });

  afterAll(async () => {
    if (approvedEstimateId) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', approvedEstimateId);
    }
    if (draftEstimateId) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', draftEstimateId);
    }
    if (otherZoApprovedEstimateId) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', otherZoApprovedEstimateId);
    }
    await supabase.from('work_order_mappings').delete().in('work_order_no', [workOrderA, workOrderB, workOrderC]);
    await supabase.from('je_zo_mappings').delete().in('je_user_id', [mobileJE, mobileJEOther]);
    await supabase.from('projects_master').delete().in('work_order_no', [workOrderA, workOrderB, workOrderC]);
    await supabase.from('authorised_users').delete().in('mobile_number', [
      mobileJE, mobileJEOther, mobileZO, mobileZOOther, mobileAdmin
    ]);
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

    const seeded = res.jsonData.estimates.filter((e) =>
      [workOrderA, workOrderC].includes(e.work_order_no)
    );
    expect(seeded).toHaveLength(2);

    const match = res.jsonData.estimates.find((e) => e.work_order_no === workOrderA);
    expect(match).toEqual({
      work_order_no: workOrderA,
      estimate_amount: 420000
    });
    expect(Object.keys(match)).toEqual(['work_order_no', 'estimate_amount']);
  });

  test('filters by status=Final Approved and excludes Draft rows', async () => {
    const res = mockRes();
    await getEstimateSummary(
      { query: { status: 'Final Approved' }, user: { mobile_number: mobileAdmin, role: 'admin' } },
      res
    );

    expect(res.statusCode).toBe(200);
    const woNos = res.jsonData.estimates.map((e) => e.work_order_no);
    expect(woNos).toContain(workOrderA);
    expect(woNos).toContain(workOrderC);
    expect(woNos).not.toContain(workOrderB);
  });

  test('without status filter returns all statuses for admin (unpaginated)', async () => {
    const res = mockRes();
    await getEstimateSummary(
      { query: {}, user: { mobile_number: mobileAdmin, role: 'admin' } },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.pagination).toBeUndefined();

    const woNos = res.jsonData.estimates.map((e) => e.work_order_no);
    expect(woNos).toContain(workOrderA);
    expect(woNos).toContain(workOrderB);
    expect(woNos).toContain(workOrderC);
  });

  test('scopes mapped JE and ZO to their work orders', async () => {
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
    expect(jeWoNos).not.toContain(workOrderC);
    expect(zoWoNos).toContain(workOrderA);
    expect(zoWoNos).not.toContain(workOrderC);
  });

  test('excludes work orders outside JE/ZO mappings', async () => {
    const resJeOther = mockRes();
    await getEstimateSummary(
      { query: { status: 'Final Approved' }, user: { mobile_number: mobileJEOther, role: 'je' } },
      resJeOther
    );

    const resZoOther = mockRes();
    await getEstimateSummary(
      { query: { status: 'Final Approved' }, user: { mobile_number: mobileZOOther, role: 'zo' } },
      resZoOther
    );

    expect(resJeOther.statusCode).toBe(200);
    expect(resZoOther.statusCode).toBe(200);

    const jeOtherWoNos = resJeOther.jsonData.estimates.map((e) => e.work_order_no);
    const zoOtherWoNos = resZoOther.jsonData.estimates.map((e) => e.work_order_no);

    expect(jeOtherWoNos).toContain(workOrderC);
    expect(jeOtherWoNos).not.toContain(workOrderA);
    expect(zoOtherWoNos).toContain(workOrderC);
    expect(zoOtherWoNos).not.toContain(workOrderA);
  });
});
