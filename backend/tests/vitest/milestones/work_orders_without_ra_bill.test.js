import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupProject = require('../../helpers/setupProject');
const setupUsers = require('../../helpers/setupUsers');
const { getWorkOrdersWithoutRaBill } = require('../../../src/controllers/raFinalBill.controller');

describe('Work Orders Without RA Bill View Scale & Scoping Tests', () => {
  let suffix;
  let wo1, wo2, wo3;
  let est1, est2, est3;
  const adminMobile = '+918276071111';
  const zoMobile = '+918276072222';
  const otherZoMobile = '+918276073333';

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    wo1 = `TEST_WO_NORABILL_1_${suffix}`;
    wo2 = `TEST_WO_NORABILL_2_${suffix}`;
    wo3 = `TEST_WO_NORABILL_3_${suffix}`;
    est1 = `EST_NORABILL_1_${suffix}`;
    est2 = `EST_NORABILL_2_${suffix}`;
    est3 = `EST_NORABILL_3_${suffix}`;

    // 1. Setup users (Admin, ZO 1, ZO 2)
    await setupUsers([
      { mobile_number: adminMobile, display_name: 'Test Admin', role: 'admin', is_active: true },
      { mobile_number: zoMobile, display_name: 'Test ZO 1', role: 'zo', is_active: true },
      { mobile_number: otherZoMobile, display_name: 'Test ZO 2', role: 'zo', is_active: true }
    ]);

    // 2. Setup projects (WO 1: ZO 1, WO 2: ZO 1, WO 3: ZO 2)
    await setupProject(wo1, est1, 100000.00, adminMobile);
    await setupProject(wo2, est2, 120000.00, adminMobile);
    await setupProject(wo3, est3, 150000.00, adminMobile);

    // Update zo_user_id for scoping tests
    await supabase.from('projects_master').update({ zo_user_id: zoMobile }).eq('work_order_no', wo1);
    await supabase.from('projects_master').update({ zo_user_id: zoMobile }).eq('work_order_no', wo2);
    await supabase.from('projects_master').update({ zo_user_id: otherZoMobile }).eq('work_order_no', wo3);
  });

  afterAll(async () => {
    // Cleanup
    await supabase.from('ra_final_bills').delete().in('work_order_no', [wo1, wo2, wo3]);
    await supabase.from('projects_master').delete().in('work_order_no', [wo1, wo2, wo3]);
    await supabase.from('authorised_users').delete().in('mobile_number', [adminMobile, zoMobile, otherZoMobile]);
  });

  test('Test 1: Admin/HO retrieves all active (non-closed) projects with no RA bills', async () => {
    const req = {
      query: {},
      user: { role: 'admin', mobile_number: adminMobile }
    };
    const res = mockRes();

    await getWorkOrdersWithoutRaBill(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);

    const wos = res.jsonData.projects.map(p => p.work_order_no);
    expect(wos).toContain(wo1);
    expect(wos).toContain(wo2);
    expect(wos).toContain(wo3);
  });

  test('Test 2: ZO user receives only their own projects with no RA bills', async () => {
    const req = {
      query: {},
      user: { role: 'zo', mobile_number: zoMobile }
    };
    const res = mockRes();

    await getWorkOrdersWithoutRaBill(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);

    const wos = res.jsonData.projects.map(p => p.work_order_no);
    expect(wos).toContain(wo1);
    expect(wos).toContain(wo2);
    expect(wos).not.toContain(wo3); // scoped out (belongs to otherZoMobile)
  });

  test('Test 3: Anti-join successfully filters out project when an RA Bill is inserted', async () => {
    // 1. Insert an RA Bill for WO 1
    const { error: billErr } = await supabase
      .from('ra_final_bills')
      .insert({
        work_order_no: wo1,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        payment_type: 'RA Bill 1',
        bill_date: '2026-08-01',
        bill_no: `BILL_NORABILL_1_${suffix}`,
        gross_bill: 20000.00,
        bill_copy_url: 'http://test.com/bill1.pdf',
        original_bill_filename: 'bill1.pdf',
        created_by: adminMobile
      });

    expect(billErr).toBeNull();

    // 2. Query as Admin/HO again
    const req = {
      query: {},
      user: { role: 'admin', mobile_number: adminMobile }
    };
    const res = mockRes();

    await getWorkOrdersWithoutRaBill(req, res);

    expect(res.statusCode).toBe(200);
    
    const wos = res.jsonData.projects.map(p => p.work_order_no);
    expect(wos).not.toContain(wo1); // Excluded because it has an RA bill
    expect(wos).toContain(wo2); // Still present
    expect(wos).toContain(wo3); // Still present
  });

  test('Test 4: Final Bills do not trigger exclusion (only RA Bills trigger exclusion)', async () => {
    // 1. Insert a Final Bill for WO 2 (without any preceding RA Bill)
    const { error: billErr } = await supabase
      .from('ra_final_bills')
      .insert({
        work_order_no: wo2,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        payment_type: 'Final Bill',
        bill_date: '2026-08-05',
        bill_no: `BILL_NORABILL_2_${suffix}`,
        gross_bill: 50000.00,
        bill_copy_url: 'http://test.com/bill2.pdf',
        original_bill_filename: 'bill2.pdf',
        created_by: adminMobile
      });

    expect(billErr).toBeNull();

    // 2. Query as Admin/HO again
    const req = {
      query: {},
      user: { role: 'admin', mobile_number: adminMobile }
    };
    const res = mockRes();

    await getWorkOrdersWithoutRaBill(req, res);

    expect(res.statusCode).toBe(200);
    
    const wos = res.jsonData.projects.map(p => p.work_order_no);
    expect(wos).toContain(wo2); // Still present because it only has a "Final Bill", not an "RA Bill"
  });

  test('Test 5: Status filtering includes Running and excludes Closed / Complete Under Maintenance', async () => {
    let req = { query: {}, user: { role: 'admin', mobile_number: adminMobile } };
    let res = mockRes();
    await getWorkOrdersWithoutRaBill(req, res);
    expect(res.jsonData.projects.map(p => p.work_order_no)).toContain(wo2);

    const { error: closedErr } = await supabase
      .from('projects_master')
      .update({ status: 'Closed' })
      .eq('work_order_no', wo2);
    expect(closedErr).toBeNull();

    req = { query: {}, user: { role: 'admin', mobile_number: adminMobile } };
    res = mockRes();
    await getWorkOrdersWithoutRaBill(req, res);
    expect(res.jsonData.projects.map(p => p.work_order_no)).not.toContain(wo2);

    const { error: runningErr } = await supabase
      .from('projects_master')
      .update({ status: 'Running' })
      .eq('work_order_no', wo2);
    expect(runningErr).toBeNull();

    req = { query: {}, user: { role: 'admin', mobile_number: adminMobile } };
    res = mockRes();
    await getWorkOrdersWithoutRaBill(req, res);
    expect(res.jsonData.projects.map(p => p.work_order_no)).toContain(wo2);

    const { error: maintenanceErr } = await supabase
      .from('projects_master')
      .update({ status: 'Complete Under Maintenance' })
      .eq('work_order_no', wo2);
    expect(maintenanceErr).toBeNull();

    req = { query: {}, user: { role: 'admin', mobile_number: adminMobile } };
    res = mockRes();
    await getWorkOrdersWithoutRaBill(req, res);
    expect(res.jsonData.projects.map(p => p.work_order_no)).not.toContain(wo2);
  });

  test('Test 6: work_order_no query param filters results server-side', async () => {
    const req = {
      query: { work_order_no: wo3 },
      user: { role: 'admin', mobile_number: adminMobile }
    };
    const res = mockRes();

    await getWorkOrdersWithoutRaBill(req, res);

    expect(res.statusCode).toBe(200);
    const wos = res.jsonData.projects.map(p => p.work_order_no);
    expect(wos).toContain(wo3);
    expect(wos).not.toContain(wo2);
  });
});
