import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  reviewEstimate,
  submitRowApprovals,
  submitReview
} = require('../../../src/controllers/estimates.controller');

describe('Milestone 7 — Cost Estimates HO Review API', () => {
  let suffix;
  let testZoMobile;
  let testJeMobile;
  let testOtherMobile;
  let testHoMobile;
  let testAdminMobile;
  let testWorkOrder;
  let testEstimateId = null;
  let testEstimateIdZeroItems = null;
  let testItemId = null;
  let testItemId2 = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testZoMobile = `+91800000_${suffix.substring(0, 4)}`;
    testJeMobile = `+91800001_${suffix.substring(0, 4)}`;
    testOtherMobile = `+91800002_${suffix.substring(0, 4)}`;
    testHoMobile = `+91800003_${suffix.substring(0, 4)}`;
    testAdminMobile = '+918276071523';
    testWorkOrder = 'WB_BAN_102'; // Running work order

    // Setup test users and estimate
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);

    // Insert Users
    await supabase.from('authorised_users').insert([
      { mobile_number: testZoMobile, display_name: 'Test ZO User', role: 'zo', is_active: true },
      { mobile_number: testJeMobile, display_name: 'Test JE User', role: 'je', is_active: true },
      { mobile_number: testOtherMobile, display_name: 'Other JE User', role: 'je', is_active: true },
      { mobile_number: testHoMobile, display_name: 'Test HO User', role: 'ho', is_active: true }
    ]);

    // Clear active estimates for this work order to bypass unique checks
    await supabase.from('project_cost_estimates')
      .update({ estimate_status: 'Rejected by ZO', last_modified_by: testAdminMobile })
      .eq('work_order_no', testWorkOrder);

    // Insert test estimate
    const { data: estimate, error: estErr } = await supabase
      .from('project_cost_estimates')
      .insert({
        work_order_no: testWorkOrder,
        estimate_no: `EST-M7-${suffix}`,
        area_code: 'South Bengal',
        estimate_revision: 0,
        zonal_office_no: 'ZO-01',
        estimate_amount: 150000,
        estimate_status: 'ZO Approved',
        created_by: testJeMobile,
        last_modified_by: testZoMobile,
        zo_approved_by: testZoMobile,
        zo_approval_date: new Date().toISOString()
      })
      .select()
      .single();

    if (estErr) throw estErr;
    testEstimateId = estimate.estimate_id;

    // Create two line items for it, approved by ZO
    const { data: items, error: itemsErr } = await supabase
      .from('project_cost_estimate_items')
      .insert([
        {
          estimate_id: testEstimateId,
          material_main_head: 'Labour',
          material_sub_head: 'Unskilled',
          material_details: 'Unskilled Worker',
          unit: 'Nos',
          qty: 100,
          rate: 500,
          amount: 50000,
          zo_office_approve: 'Approve'
        },
        {
          estimate_id: testEstimateId,
          material_main_head: 'Raw Materials',
          material_sub_head: 'Cement',
          material_details: 'Cement Bags',
          unit: 'Bag',
          qty: 200,
          rate: 500,
          amount: 100000,
          zo_office_approve: 'Approve'
        }
      ])
      .select();

    if (itemsErr) throw itemsErr;
    testItemId = items[0].item_id;
    testItemId2 = items[1].item_id;
  });

  afterAll(async () => {
    if (testEstimateIdZeroItems) {
      await supabase.from('project_cost_estimates').update({
        work_order_no: 'WB_BAN_102',
        created_by: '+918276071523',
        last_modified_by: '+918276071523',
        je_user_id: '+918276071523',
        zo_approved_by: null,
        ho_approved_by: null
      }).eq('estimate_id', testEstimateIdZeroItems);
    }
    if (testEstimateId) {
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', testEstimateId);
      await supabase.from('project_cost_estimates')
        .update({
          estimate_status: 'Rejected by ZO',
          created_by: '+918276071523',
          last_modified_by: '+918276071523',
          je_user_id: '+918276071523',
          zo_approved_by: null,
          ho_approved_by: null
        })
        .eq('estimate_id', testEstimateId);
      await supabase.from('estimate_revision_log').delete().eq('estimate_id', testEstimateId);
    }
    await supabase.from('authorised_users').delete().in('mobile_number', [testZoMobile, testJeMobile, testOtherMobile, testHoMobile]);
  });

  describe('HO Start Review & Gating', () => {
    test('Test 1: HO successfully opens estimate, transitions status to Under HO Review', async () => {
      expect(testEstimateId).not.toBeNull();

      const req = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile }
      };
      const res = mockRes();
      await reviewEstimate(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.estimate.estimate_status).toBe('Under HO Review');
    });

    test('Test 2: Blocks JE and ZO from opening HO review with 403', async () => {
      expect(testEstimateId).not.toBeNull();

      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'ZO Approved', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      const checkBlock = async (role, mobile) => {
        const req = {
          params: { id: testEstimateId },
          user: { role, mobile_number: mobile }
        };
        const res = mockRes();
        await reviewEstimate(req, res);
        return res.statusCode === 403;
      };

      expect(await checkBlock('je', testJeMobile)).toBe(true);
      expect(await checkBlock('zo', testZoMobile)).toBe(true);

      // Restore Under HO Review status
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);
    });
  });

  describe('HO Row approvals & Field Isolation', () => {
    test('Test 3: Saves HO row approvals without modifying ZO office decisions', async () => {
      expect(testEstimateId).not.toBeNull();

      const req = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: {
          approvals: [
            { item_id: testItemId, approve_status: 'Approve' },
            { item_id: testItemId2, approve_status: 'Approve' }
          ]
        }
      };
      const res = mockRes();
      await submitRowApprovals(req, res);

      expect(res.statusCode).toBe(200);

      const { data: dbItems } = await supabase
        .from('project_cost_estimate_items')
        .select('*')
        .eq('estimate_id', testEstimateId)
        .order('created_at', { ascending: true });

      expect(dbItems[0].ho_office_approve).toBe('Approve');
      expect(dbItems[0].zo_office_approve).toBe('Approve');
      expect(dbItems[1].ho_office_approve).toBe('Approve');
      expect(dbItems[1].zo_office_approve).toBe('Approve');
    });

    test('Test 4: Blocks submitReview when undecided HO rows exist with 422', async () => {
      expect(testEstimateId).not.toBeNull();

      // Reset one row
      await supabase.from('project_cost_estimate_items')
        .update({ ho_office_approve: null })
        .eq('item_id', testItemId2);

      const req = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: { remarks: 'My HO review comments' }
      };
      const res = mockRes();
      await submitReview(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('must be decided');
    });

    test('Test 5: Blocks submitReview for zero items estimate with 422', async () => {
      const { data: estZero, error } = await supabase
        .from('project_cost_estimates')
        .insert({
          work_order_no: testWorkOrder,
          estimate_no: `EST-M7-ZERO-${suffix}`,
          area_code: 'South Bengal',
          estimate_revision: 0,
          zonal_office_no: 'ZO-01',
          estimate_amount: 0,
          estimate_status: 'Under HO Review',
          created_by: testJeMobile,
          last_modified_by: testZoMobile,
          zo_approved_by: testZoMobile,
          zo_approval_date: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      testEstimateIdZeroItems = estZero.estimate_id;

      const req = {
        params: { id: testEstimateIdZeroItems },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: { remarks: 'HO Zero Items Review' }
      };
      const res = mockRes();
      await submitReview(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('no line items');

      await supabase.from('project_cost_estimates').delete().eq('estimate_id', testEstimateIdZeroItems);
      testEstimateIdZeroItems = null;
    });

    test('Test 6: Blocks HO submitReview when ZO approvals are inconsistent with 400', async () => {
      expect(testEstimateId).not.toBeNull();

      // Reset approvals
      await supabase.from('project_cost_estimate_items')
        .update({ zo_office_approve: 'Approve', ho_office_approve: 'Approve' })
        .eq('estimate_id', testEstimateId);

      // Make ZO approval inconsistent
      await supabase.from('project_cost_estimate_items')
        .update({ zo_office_approve: 'Not Approve' })
        .eq('item_id', testItemId2);

      const req = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: { remarks: 'My HO review comments' }
      };
      const res = mockRes();
      await submitReview(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.message).toContain('Inconsistent review state');

      // Revert ZO approval
      await supabase.from('project_cost_estimate_items')
        .update({ zo_office_approve: 'Approve' })
        .eq('item_id', testItemId2);
    });
  });

  describe('Submit Review Outputs & Audit Stamps', () => {
    test('Test 7: Transitions to Final Approved successfully (when all rows Approve)', async () => {
      expect(testEstimateId).not.toBeNull();

      const req = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: { remarks: 'My HO review comments' }
      };
      const res = mockRes();
      await submitReview(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const est = res.jsonData.estimate;
      expect(est.estimate_status).toBe('Final Approved');
      expect(Number(est.estimate_amount)).toBe(150000);
      expect(est.ho_approved_by).toBe(testHoMobile);
      expect(est.ho_remarks).toBe('My HO review comments');
      expect(est.ho_approval_date).not.toBeNull();
    });

    test('Test 8: Transitions to Rejected by HO (retains total amount, sets stamps)', async () => {
      expect(testEstimateId).not.toBeNull();

      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      await supabase.from('project_cost_estimate_items')
        .update({ ho_office_approve: 'Not Approve', ho_remarks: 'Rejected item' })
        .eq('item_id', testItemId2);

      const req = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: { remarks: 'HO Reject Remarks' }
      };
      const res = mockRes();
      await submitReview(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const est = res.jsonData.estimate;
      expect(est.estimate_status).toBe('Rejected by HO');
      expect(est.ho_approved_by).toBe(testHoMobile);
      expect(est.ho_remarks).toBe('HO Reject Remarks');
      expect(est.ho_approval_date).not.toBeNull();
      expect(Number(est.estimate_amount)).toBe(150000);
    });

    test('Test 9: Verifies Admin actor successfully executes the full HO review sequence', async () => {
      expect(testEstimateId).not.toBeNull();

      // Reset status to ZO Approved
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'ZO Approved', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      // Admin opens review
      const reqOpen = {
        params: { id: testEstimateId },
        user: { role: 'admin', mobile_number: testAdminMobile }
      };
      const resOpen = mockRes();
      await reviewEstimate(reqOpen, resOpen);
      expect(resOpen.statusCode).toBe(200);
      expect(resOpen.jsonData.estimate.estimate_status).toBe('Under HO Review');

      // Admin approves rows
      const reqRows = {
        params: { id: testEstimateId },
        user: { role: 'admin', mobile_number: testAdminMobile },
        body: {
          approvals: [
            { item_id: testItemId, approve_status: 'Approve' },
            { item_id: testItemId2, approve_status: 'Approve' }
          ]
        }
      };
      const resRows = mockRes();
      await submitRowApprovals(reqRows, resRows);
      expect(resRows.statusCode).toBe(200);

      // Reset items to Approve in DB for consistency
      await supabase.from('project_cost_estimate_items')
        .update({ zo_office_approve: 'Approve', ho_office_approve: 'Approve' })
        .eq('estimate_id', testEstimateId);

      // Admin submits review
      const reqSubmit = {
        params: { id: testEstimateId },
        user: { role: 'admin', mobile_number: testAdminMobile },
        body: { remarks: 'Admin HO Review' }
      };
      const resSubmit = mockRes();
      await submitReview(reqSubmit, resSubmit);

      expect(resSubmit.statusCode).toBe(200);
      expect(resSubmit.jsonData.estimate.estimate_status).toBe('Final Approved');
    });

    test('Test 10: Prevents concurrent review submissions safely via optimistic locking', async () => {
      expect(testEstimateId).not.toBeNull();

      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Under HO Review', last_modified_by: testAdminMobile })
        .eq('estimate_id', testEstimateId);

      const reqC1 = {
        params: { id: testEstimateId },
        user: { role: 'ho', mobile_number: testHoMobile },
        body: { remarks: 'Concurrent Review 1' }
      };
      const resC1 = mockRes();
      const resC2 = mockRes();

      await Promise.all([
        submitReview(reqC1, resC1),
        submitReview(reqC1, resC2)
      ]);

      const codes = [resC1.statusCode, resC2.statusCode];
      expect(codes.includes(200)).toBe(true);
      expect(codes.includes(409)).toBe(true);

      const { data: dbEst } = await supabase
        .from('project_cost_estimates')
        .select('*')
        .eq('estimate_id', testEstimateId)
        .single();

      expect(dbEst.estimate_status).toBe('Final Approved');
      expect(dbEst.ho_approved_by).toBe(testHoMobile);
      expect(dbEst.ho_approval_date).not.toBeNull();
      expect(Number(dbEst.estimate_amount)).toBe(150000);
    });
  });
});
