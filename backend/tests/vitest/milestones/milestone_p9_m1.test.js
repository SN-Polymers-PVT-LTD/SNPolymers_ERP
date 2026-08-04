import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupUsers = require('../../helpers/setupUsers');
const setupProject = require('../../helpers/setupProject');
const {
  listEstimatedBills,
  getEstimatedBill,
  listWorkOrderOptions,
  upsertEstimatedBill
} = require('../../../src/controllers/estimatedBills.controller');

describe('Milestone P9-M1/M2 — Estimated Bills Database Layer & Backend API', () => {
  let suffix;
  let testZoUserA;
  let testZoUserB;
  let testHoUser;
  let testWoA;
  let testWoB;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testZoUserA = `9800${suffix}`;
    testZoUserB = `9801${suffix}`;
    testHoUser  = `9802${suffix}`;

    testWoA = `WO_EST_A_${suffix}`;
    testWoB = `WO_EST_B_${suffix}`;

    // Setup active users
    await setupUsers([
      { mobile_number: testZoUserA, role: 'zo', is_active: true, display_name: `ZO User A ${suffix}` },
      { mobile_number: testZoUserB, role: 'zo', is_active: true, display_name: `ZO User B ${suffix}` },
      { mobile_number: testHoUser,  role: 'ho', is_active: true, display_name: `HO User ${suffix}` }
    ]);

    // Setup projects mapped to ZO User A and ZO User B
    await setupProject(testWoA, `EST_A_${suffix}`, 500000.00, testZoUserA);
    await supabase.from('projects_master').update({ zo_user_id: testZoUserA }).eq('work_order_no', testWoA);

    await setupProject(testWoB, `EST_B_${suffix}`, 800000.00, testZoUserB);
    await supabase.from('projects_master').update({ zo_user_id: testZoUserB }).eq('work_order_no', testWoB);
  });

  afterAll(async () => {
    // Clean up test records
    await supabase.from('estimated_bills').delete().in('work_order_no', [testWoA, testWoB]);
    await supabase.from('projects_master').delete().in('work_order_no', [testWoA, testWoB]);
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoUserA, testZoUserB, testHoUser]);
  });

  describe('Milestone 1 — RPC & Database Constraints', () => {
    test('TC-1.1: RPC inserts a new estimated bill successfully', async () => {
      const { data, error } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoA,
        p_amount: 200000.00,
        p_estimated_date: '2026-09-15',
        p_surety_pct: 85,
        p_remarks: 'Initial estimate A',
        p_actor: testZoUserA
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.work_order_no).toBe(testWoA);
      expect(Number(data.estimated_bill_amount)).toBe(200000.00);
      expect(data.surety_pct).toBe(85);
      expect(data.created_by).toBe(testZoUserA);
      expect(data.updated_by).toBe(testZoUserA);
    });

    test('TC-1.2: RPC inserts a second timeline entry for the same WO', async () => {
      await new Promise(r => setTimeout(r, 100));

      const { data, error } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoA,
        p_amount: 350000.00,
        p_estimated_date: '2026-10-01',
        p_surety_pct: 90,
        p_remarks: 'Updated estimate A',
        p_actor: testHoUser
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(Number(data.estimated_bill_amount)).toBe(350000.00);
      expect(data.surety_pct).toBe(90);
      expect(data.updated_by).toBe(testHoUser);

      // Verify total count for testWoA is now 2 (append-only timeline entries)
      const { count } = await supabase
        .from('estimated_bills')
        .select('*', { count: 'exact', head: true })
        .eq('work_order_no', testWoA);
      expect(count).toBe(2);
    });

    test('TC-1.3: RPC blocks estimated amount exceeding work order value', async () => {
      const { error } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoA, // Value is 500,000.00
        p_amount: 600000.00,       // Exceeds 500,000.00
        p_estimated_date: '2026-09-15',
        p_surety_pct: 80,
        p_remarks: null,
        p_actor: testZoUserA
      });

      expect(error).not.toBeNull();
      expect(error.message).toContain('cannot exceed work order value');
    });

    test('TC-1.4: RPC blocks invalid surety percentage (< 0 or > 100)', async () => {
      const { error: errLow } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoA,
        p_amount: 100000.00,
        p_estimated_date: '2026-09-15',
        p_surety_pct: -5,
        p_remarks: null,
        p_actor: testZoUserA
      });
      expect(errLow).not.toBeNull();
      expect(errLow.message).toContain('between 0 and 100');

      const { error: errHigh } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoA,
        p_amount: 100000.00,
        p_estimated_date: '2026-09-15',
        p_surety_pct: 105,
        p_remarks: null,
        p_actor: testZoUserA
      });
      expect(errHigh).not.toBeNull();
      expect(errHigh.message).toContain('between 0 and 100');
    });

    test('TC-1.5: RPC blocks non-existent work order', async () => {
      const { error } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: 'NON_EXISTENT_WO_9999',
        p_amount: 100000.00,
        p_estimated_date: '2026-09-15',
        p_surety_pct: 80,
        p_remarks: null,
        p_actor: testZoUserA
      });

      expect(error).not.toBeNull();
      expect(error.message).toContain('not found');
    });
  });

  describe('Milestone 2 — Controller Logic & Authorization Scoping', () => {
    test('TC-2.1: listEstimatedBills scopes ZO user to own zone', async () => {
      // Also insert an estimate for ZO User B's work order
      await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoB,
        p_amount: 400000.00,
        p_estimated_date: '2026-11-01',
        p_surety_pct: 75,
        p_remarks: 'Estimate B',
        p_actor: testZoUserB
      });

      // Call list as ZO User A
      const reqA = { user: { role: 'zo', mobile_number: testZoUserA }, query: {} };
      const resA = mockRes();
      await listEstimatedBills(reqA, resA);

      expect(resA.statusCode).toBe(200);
      expect(resA.jsonData.success).toBe(true);
      const dataA = resA.jsonData.data;
      expect(dataA.some(r => r.work_order_no === testWoA)).toBe(true);
      expect(dataA.some(r => r.work_order_no === testWoB)).toBe(false);

      // Call list as HO User (sees both)
      const reqHo = { user: { role: 'ho', mobile_number: testHoUser }, query: {} };
      const resHo = mockRes();
      await listEstimatedBills(reqHo, resHo);

      expect(resHo.statusCode).toBe(200);
      const dataHo = resHo.jsonData.data;
      expect(dataHo.some(r => r.work_order_no === testWoA)).toBe(true);
      expect(dataHo.some(r => r.work_order_no === testWoB)).toBe(true);
    });

    test('TC-2.2: getEstimatedBill scopes single WO lookup for ZO user', async () => {
      // ZO A fetches own WO A -> 200
      const reqOwn = { params: { work_order_no: testWoA }, user: { role: 'zo', mobile_number: testZoUserA } };
      const resOwn = mockRes();
      await getEstimatedBill(reqOwn, resOwn);

      expect(resOwn.statusCode).toBe(200);
      expect(resOwn.jsonData.success).toBe(true);
      expect(resOwn.jsonData.data[0].work_order_no).toBe(testWoA);

      // ZO A fetches ZO B's WO B -> 404 (read scoping)
      const reqOther = { params: { work_order_no: testWoB }, user: { role: 'zo', mobile_number: testZoUserA } };
      const resOther = mockRes();
      await getEstimatedBill(reqOther, resOther);

      expect(resOther.statusCode).toBe(404);
      expect(resOther.jsonData.success).toBe(false);

      // HO fetches WO B -> 200
      const reqHo = { params: { work_order_no: testWoB }, user: { role: 'ho', mobile_number: testHoUser } };
      const resHo = mockRes();
      await getEstimatedBill(reqHo, resHo);

      expect(resHo.statusCode).toBe(200);
      expect(resHo.jsonData.data[0].work_order_no).toBe(testWoB);
    });

    test('TC-2.3: listWorkOrderOptions returns role-scoped dropdown options', async () => {
      const reqZo = { user: { role: 'zo', mobile_number: testZoUserA } };
      const resZo = mockRes();
      await listWorkOrderOptions(reqZo, resZo);

      expect(resZo.statusCode).toBe(200);
      expect(resZo.jsonData.success).toBe(true);
      const wosZo = resZo.jsonData.workOrders;
      expect(wosZo.some(w => w.work_order_no === testWoA)).toBe(true);
      expect(wosZo.some(w => w.work_order_no === testWoB)).toBe(false);
    });

    test('TC-2.4: upsertEstimatedBill enforces ZO write scoping', async () => {
      // ZO A tries to write to ZO B's Work Order B -> 403
      const reqForbidden = {
        user: { role: 'zo', mobile_number: testZoUserA },
        body: {
          work_order_no: testWoB,
          estimated_bill_amount: 100000.00,
          estimated_payment_date: '2026-10-10',
          surety_pct: 80,
          remarks: 'Hacking attempt'
        }
      };
      const resForbidden = mockRes();
      await upsertEstimatedBill(reqForbidden, resForbidden);

      expect(resForbidden.statusCode).toBe(403);
      expect(resForbidden.jsonData.success).toBe(false);
      expect(resForbidden.jsonData.message).toContain('not in your zone');
    });

    test('TC-2.5: upsertEstimatedBill handles valid upsert from HO', async () => {
      const reqHo = {
        user: { role: 'ho', mobile_number: testHoUser },
        body: {
          work_order_no: testWoA,
          estimated_bill_amount: 450000.00,
          estimated_payment_date: '2026-12-01',
          surety_pct: 95,
          remarks: 'HO override'
        }
      };
      const resHo = mockRes();
      await upsertEstimatedBill(reqHo, resHo);

      expect(resHo.statusCode).toBe(200);
      expect(resHo.jsonData.success).toBe(true);
      expect(resHo.jsonData.message).toContain('saved successfully');
    });

    test('TC-2.6: listEstimatedBills and listWorkOrderOptions strictly exclude closed work orders', async () => {
      const testWoClosed = `WO_CLOSED_${suffix}`;
      await setupProject(testWoClosed, `EST_CLOSED_${suffix}`, 600000.00, testZoUserA);

      // Insert estimated bill for WO while it is Running (as required by RPC status validation)
      const { error: insErr } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoClosed,
        p_amount: 100000.00,
        p_estimated_date: '2026-11-01',
        p_surety_pct: 75,
        p_remarks: 'Closed project estimate',
        p_actor: testZoUserA
      });
      expect(insErr).toBeNull();

      // Now set the status to Closed
      await supabase.from('projects_master').update({ status: 'Closed' }).eq('work_order_no', testWoClosed);

      // 1. Verify listWorkOrderOptions excludes testWoClosed
      const reqOpt = { user: { role: 'ho', mobile_number: testHoUser } };
      const resOpt = mockRes();
      await listWorkOrderOptions(reqOpt, resOpt);
      expect(resOpt.statusCode).toBe(200);
      const wos = resOpt.jsonData.workOrders;
      expect(wos.some(w => w.work_order_no === testWoClosed)).toBe(false);

      // 2. Verify listEstimatedBills excludes testWoClosed
      const reqList = { user: { role: 'ho', mobile_number: testHoUser }, query: {} };
      const resList = mockRes();
      await listEstimatedBills(reqList, resList);
      expect(resList.statusCode).toBe(200);
      const bills = resList.jsonData.data;
      expect(bills.some(b => b.work_order_no === testWoClosed)).toBe(false);

      // Cleanup closed project
      await supabase.from('estimated_bills').delete().eq('work_order_no', testWoClosed);
      await supabase.from('projects_master').delete().eq('work_order_no', testWoClosed);
    });

    test('TC-2.7: RPC and Controller block inserts for non-Running work orders', async () => {
      const testWoNonRunning = `WO_NON_RUN_${suffix}`;
      await setupProject(testWoNonRunning, `EST_NON_RUN_${suffix}`, 600000.00, testZoUserA);
      await supabase.from('projects_master').update({ zo_user_id: testZoUserA, status: 'Complete Under Maintenance' }).eq('work_order_no', testWoNonRunning);

      // 1. Verify RPC block
      const { error: rpcErr } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoNonRunning,
        p_amount: 100000.00,
        p_estimated_date: '2026-11-01',
        p_surety_pct: 75,
        p_remarks: 'Non-Running project estimate',
        p_actor: testZoUserA
      });
      expect(rpcErr).not.toBeNull();
      expect(rpcErr.message).toContain('only be created for Running');

      // 2. Verify Controller block (400 Bad Request)
      const req = {
        user: { role: 'zo', mobile_number: testZoUserA },
        body: {
          work_order_no: testWoNonRunning,
          estimated_bill_amount: 100000.00,
          estimated_payment_date: '2026-11-01',
          surety_pct: 75,
          remarks: 'Non-Running project estimate'
        }
      };
      const res = mockRes();
      await upsertEstimatedBill(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toContain('only be created for Running');

      // Cleanup
      await supabase.from('projects_master').delete().eq('work_order_no', testWoNonRunning);
    });

    test('TC-2.8: RPC and Controller block inserts if a Final Bill exists', async () => {
      const testWoFinal = `WO_FINAL_${suffix}`;
      await setupProject(testWoFinal, `EST_FINAL_${suffix}`, 600000.00, testZoUserA);
      await supabase.from('projects_master').update({ zo_user_id: testZoUserA }).eq('work_order_no', testWoFinal);

      // Create a Final Bill in ra_final_bills
      const { error: fbErr } = await supabase.from('ra_final_bills').insert({
        created_by: testZoUserA,
        work_order_no: testWoFinal,
        payment_type: 'Final Bill',
        bill_date: '2026-09-20',
        bill_no: `B-FINAL-${suffix}`,
        gross_bill: 100000.00,
        state: 'West Bengal',
        district: 'Kolkata',
        area_code: 'Kolkata Zone',
        department: 'PWD',
        site_details: 'Testing Site',
        bill_copy_url: 'dummy-url-placeholder'
      });
      expect(fbErr).toBeNull();

      // 1. Verify RPC block
      const { error: rpcErr } = await supabase.rpc('insert_estimated_bill', {
        p_work_order_no: testWoFinal,
        p_amount: 100000.00,
        p_estimated_date: '2026-11-01',
        p_surety_pct: 75,
        p_remarks: 'Estimate post final bill',
        p_actor: testZoUserA
      });
      expect(rpcErr).not.toBeNull();
      expect(rpcErr.message).toContain('after a Final Bill has been submitted');

      // 2. Verify Controller block (400 Bad Request)
      const req = {
        user: { role: 'zo', mobile_number: testZoUserA },
        body: {
          work_order_no: testWoFinal,
          estimated_bill_amount: 100000.00,
          estimated_payment_date: '2026-11-01',
          surety_pct: 75,
          remarks: 'Estimate post final bill'
        }
      };
      const res = mockRes();
      await upsertEstimatedBill(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toContain('after a Final Bill has been submitted');

      // 3. Verify listWorkOrderOptions excludes testWoFinal
      const reqOpt = { user: { role: 'ho', mobile_number: testHoUser } };
      const resOpt = mockRes();
      await listWorkOrderOptions(reqOpt, resOpt);
      expect(resOpt.statusCode).toBe(200);
      const wos = resOpt.jsonData.workOrders;
      expect(wos.some(w => w.work_order_no === testWoFinal)).toBe(false);

      // Cleanup
      await supabase.from('ra_final_bills').delete().eq('work_order_no', testWoFinal);
      await supabase.from('projects_master').delete().eq('work_order_no', testWoFinal);
    });
  });
});
