import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  createEstimate,
  saveDraftItems,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview
} = require('../../../src/controllers/estimates.controller');

describe('Milestone 5 — Cost Estimates Review & Approvals API', () => {
  let suffix;
  let activeWorkOrder;
  let mobileJE_Owner;
  let mobileJE_Other;
  let mobileZO;
  let mobileHO;
  let mobileAdmin;
  let createdEstimateId = null;
  const insertedMaterialIds = [];
  let itemIdA;
  let itemIdB;
  let itemIdC;
  const cleanUpEstimates = [];

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    activeWorkOrder = `TEST_WO_M5_ACTIVE_${suffix}`;
    mobileJE_Owner = `+91900000_${suffix.substring(0, 4)}`;
    mobileJE_Other = `+91911111_${suffix.substring(0, 4)}`;
    mobileZO = `+91922222_${suffix.substring(0, 4)}`;
    mobileHO = `+91933333_${suffix.substring(0, 4)}`;
    mobileAdmin = `+91944444_${suffix.substring(0, 4)}`;

    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_Owner, mobileJE_Other, mobileZO, mobileHO, mobileAdmin]);

    // Insert Users
    const { error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: mobileJE_Owner, display_name: 'JE Owner', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileJE_Other, display_name: 'JE Other', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: mobileHO, display_name: 'HO User', role: 'ho', is_active: true, permissions: {} },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true, permissions: {} }
    ]);
    if (userError) throw userError;

    // Insert Project
    const { error: projError } = await supabase.from('projects_master').insert([
      {
        work_order_no: activeWorkOrder,
        estimate_no: `EST_M5_${suffix}`,
        work_order_value: 1000000.00,
        site_details: 'Staging Site M5',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);
    if (projError) throw projError;

    // Insert Materials
    const { data: testMats, error: matsError } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement A ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement B ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement C ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
    ]).select();

    if (matsError) throw matsError;
    if (testMats) {
      testMats.forEach(m => insertedMaterialIds.push(m.id));
    }

    // Create Estimate
    const resCreate = mockRes();
    await createEstimate({
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: { work_order_no: activeWorkOrder, zonal_office_no: 'ZO-10' }
    }, resCreate);

    if (resCreate.statusCode === 201) {
      createdEstimateId = resCreate.jsonData.estimate.estimate_id;
      cleanUpEstimates.push(createdEstimateId);
    } else {
      throw new Error(`Failed to create test estimate: ${resCreate.jsonData.message}`);
    }

    // Save 3 valid items
    await saveDraftItems({
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' },
      body: {
        items: [
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement B ${suffix}`, unit: 'Bag', qty: 10, rate: 200, rate_reference: 'Ref' },
          { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement C ${suffix}`, unit: 'Bag', qty: 10, rate: 300, rate_reference: 'Ref' }
        ]
      }
    }, mockRes());

    // Submit Estimate to start review
    await submitEstimate({
      params: { id: createdEstimateId },
      user: { mobile_number: mobileJE_Owner, role: 'je' }
    }, mockRes());

    // Retrieve saved items database IDs
    const { data: currentItems } = await supabase
      .from('project_cost_estimate_items')
      .select('*')
      .eq('estimate_id', createdEstimateId)
      .order('created_at', { ascending: true });

    itemIdA = currentItems[0].item_id;
    itemIdB = currentItems[1].item_id;
    itemIdC = currentItems[2].item_id;
  });

  afterAll(async () => {
    // -------------------------------------------------------------
    // Cleanup: Remove test estimates and master records to prevent pollution
    // -------------------------------------------------------------
    const { data: testEsts } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id')
      .like('work_order_no', 'TEST_WO_M5_%');

    const testEstIds = (testEsts || []).map(e => e.estimate_id);
    cleanUpEstimates.forEach(id => {
      if (!testEstIds.includes(id)) testEstIds.push(id);
    });

    if (testEstIds.length > 0) {
      await supabase.from('estimate_revision_log').delete().in('estimate_id', testEstIds);
      await supabase.from('project_cost_estimate_items').delete().in('estimate_id', testEstIds);

      // Dissociate estimate headers
      await supabase.from('project_cost_estimates').update({
        work_order_no: 'WB_BAN_102',
        created_by: '+918276071523',
        last_modified_by: '+918276071523',
        je_user_id: '+918276071523',
        zo_approved_by: null,
        ho_approved_by: null
      }).in('estimate_id', testEstIds);
    }

    await supabase.from('projects_master').delete().like('work_order_no', 'TEST_WO_M5_%');
    if (insertedMaterialIds.length > 0) {
      await supabase.from('material_master').delete().in('id', insertedMaterialIds);
    }
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_Owner, mobileJE_Other, mobileZO, mobileHO, mobileAdmin]);
  });

  describe('Review State Transitions & Gating', () => {
    test('Test 1: Transitions Submitted -> Under ZO Review successfully', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' }
      };
      const res = mockRes();
      await reviewEstimate(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.estimate.estimate_status).toBe('Under ZO Review');
    });

    test('Test 2: Blocks JE from starting a review with 403', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      };
      const res = mockRes();
      await reviewEstimate(req, res);

      expect(res.statusCode).toBe(403);
    });

    test('Test 3: Blocks starting review on ZO Approved status with 403', async () => {
      expect(createdEstimateId).not.toBeNull();

      await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Approved' }).eq('estimate_id', createdEstimateId);

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' }
      };
      const res = mockRes();
      await reviewEstimate(req, res);

      // Revert status
      await supabase.from('project_cost_estimates').update({ estimate_status: 'Under ZO Review' }).eq('estimate_id', createdEstimateId);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('Row Level Approvals', () => {
    test('Test 4: Applies valid row approvals (Approve A, Approve B, Reject C with remarks)', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: {
          approvals: [
            { item_id: itemIdA, approve_status: 'Approve' },
            { item_id: itemIdB, approve_status: 'Approve' },
            { item_id: itemIdC, approve_status: 'Not Approve', remarks: 'Needs revision' }
          ]
        }
      };
      const res = mockRes();
      await submitRowApprovals(req, res);

      expect(res.statusCode).toBe(200);
      const items = res.jsonData.items;
      const approvedA = items.find(i => i.item_id === itemIdA);
      const approvedB = items.find(i => i.item_id === itemIdB);
      const rejectedC = items.find(i => i.item_id === itemIdC);

      expect(approvedA.zo_office_approve).toBe('Approve');
      expect(approvedB.zo_office_approve).toBe('Approve');
      expect(rejectedC.zo_office_approve).toBe('Not Approve');
      expect(rejectedC.zo_remarks).toBe('Needs revision');
    });

    test('Test 5: Blocks row approval for non-existent item ID with 404', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: {
          approvals: [
            { item_id: '00000000-0000-0000-0000-000000000000', approve_status: 'Approve' }
          ]
        }
      };
      const res = mockRes();
      await submitRowApprovals(req, res);

      expect(res.statusCode).toBe(404);
    });

    test('Test 6: Blocks row approval with invalid approve_status with 400', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: {
          approvals: [
            { item_id: itemIdA, approve_status: 'Maybe' }
          ]
        }
      };
      const res = mockRes();
      await submitRowApprovals(req, res);

      expect(res.statusCode).toBe(400);
    });

    test('Test 7: Blocks row approval request containing duplicate item IDs with 400', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: {
          approvals: [
            { item_id: itemIdA, approve_status: 'Approve' },
            { item_id: itemIdA, approve_status: 'Not Approve', remarks: 'Duplicate entry' }
          ]
        }
      };
      const res = mockRes();
      await submitRowApprovals(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.message).toContain('Duplicate item_id');
    });

    test('Test 8: Blocks Not Approve decision without remarks with 400', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: {
          approvals: [
            { item_id: itemIdC, approve_status: 'Not Approve', remarks: '   ' }
          ]
        }
      };
      const res = mockRes();
      await submitRowApprovals(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.message).toContain('Remarks are required');
    });
  });

  describe('Review Submissions & Recalculation', () => {
    test('Test 9: Blocks submitReview when undecided rows exist with 422', async () => {
      expect(createdEstimateId).not.toBeNull();

      // Reset itemIdA's decision
      await supabase.from('project_cost_estimate_items').update({ zo_office_approve: null }).eq('item_id', itemIdA);

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: { remarks: 'Final Review Comments' }
      };
      const res = mockRes();
      await submitReview(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('All rows must be decided');

      // Revert item A to Approve
      await supabase.from('project_cost_estimate_items').update({ zo_office_approve: 'Approve' }).eq('item_id', itemIdA);
    });

    test('Test 10: Transitions to ZO Approved successfully (when all rows Approve)', async () => {
      expect(createdEstimateId).not.toBeNull();

      // Approve all
      await supabase.from('project_cost_estimate_items').update({ zo_office_approve: 'Approve' }).eq('estimate_id', createdEstimateId);

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: { remarks: 'Final Review Comments' }
      };
      const res = mockRes();
      await submitReview(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.estimate.estimate_status).toBe('ZO Approved');

      const est = res.jsonData.estimate;
      expect(est.zo_approved_by).toBe(mobileZO);
      expect(est.zo_remarks).toBe('Final Review Comments');
      expect(est.zo_approval_date).not.toBeNull();
    });

    test('Test 11: Transitions to Rejected by ZO when at least one row is Not Approve', async () => {
      const suffix2 = crypto.randomUUID().substring(0, 8);
      const activeWorkOrder2 = `TEST_WO_M5_REJ_${suffix2}`;

      await supabase.from('projects_master').insert([
        {
          work_order_no: activeWorkOrder2,
          estimate_no: `EST_M5_R_${suffix2}`,
          work_order_value: 500000.00,
          site_details: 'Staging Site M5 Rej',
          state: 'West Bengal',
          district: 'Kolkata',
          zone: 'Kolkata Zone',
          department: 'PWD',
          status: 'Running',
          created_by: mobileAdmin,
          edited_by: mobileAdmin
        }
      ]);

      const resCreate = mockRes();
      await createEstimate({
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: { work_order_no: activeWorkOrder2, zonal_office_no: 'ZO-10' }
      }, resCreate);
      const rejEstimateId = resCreate.jsonData.estimate.estimate_id;
      cleanUpEstimates.push(rejEstimateId);

      await saveDraftItems({
        params: { id: rejEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: {
          items: [
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement B ${suffix}`, unit: 'Bag', qty: 10, rate: 200, rate_reference: 'Ref' }
          ]
        }
      }, mockRes());

      await submitEstimate({ params: { id: rejEstimateId }, user: { mobile_number: mobileJE_Owner, role: 'je' } }, mockRes());
      await reviewEstimate({ params: { id: rejEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

      const { data: rejItems } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', rejEstimateId).order('created_at', { ascending: true });
      await submitRowApprovals({
        params: { id: rejEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: {
          approvals: [
            { item_id: rejItems[0].item_id, approve_status: 'Approve' },
            { item_id: rejItems[1].item_id, approve_status: 'Not Approve', remarks: 'Bad choice' }
          ]
        }
      }, mockRes());

      const res = mockRes();
      await submitReview({
        params: { id: rejEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: { remarks: 'Rejection remarks' }
      }, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.estimate.estimate_status).toBe('Rejected by ZO');

      const est = res.jsonData.estimate;
      expect(est.zo_approved_by).toBe(mobileZO);
      expect(est.zo_remarks).toBe('Rejection remarks');
      expect(est.zo_approval_date).not.toBeNull();
    });

    test('Test 12: Verified mixed approval amount calculations (Approved sums active, Rejection retains total)', async () => {
      // Fetch the Rejected by ZO estimate
      const { data: rejEst } = await supabase
        .from('project_cost_estimates')
        .select('estimate_amount')
        .like('work_order_no', 'TEST_WO_M5_REJ_%')
        .single();

      // Fetch the ZO Approved estimate
      const { data: appEst } = await supabase
        .from('project_cost_estimates')
        .select('estimate_amount')
        .eq('estimate_id', createdEstimateId)
        .single();

      expect(Number(rejEst.estimate_amount)).toBe(3000.00); // 10*100 + 10*200
      expect(Number(appEst.estimate_amount)).toBe(6000.00); // 10*100 + 10*200 + 10*300
    });
  });

  describe('Auto Resubmission Mechanics', () => {
    test('Test 13: Auto-resubmits expired ZO Revision Requested on review attempt', async () => {
      const suffix3 = crypto.randomUUID().substring(0, 8);
      const activeWorkOrder3 = `TEST_WO_M5_ZO_AR_${suffix3}`;
      await supabase.from('projects_master').insert([
        { work_order_no: activeWorkOrder3, estimate_no: `EST_M5_ZAR_${suffix3}`, work_order_value: 500000.00, site_details: 'Staging ZAR', state: 'West Bengal', district: 'Kolkata', zone: 'Kolkata Zone', department: 'PWD', status: 'Running', created_by: mobileAdmin, edited_by: mobileAdmin }
      ]);

      const resCreate = mockRes();
      await createEstimate({
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: { work_order_no: activeWorkOrder3, zonal_office_no: 'ZO-10' }
      }, resCreate);
      const zarEstimateId = resCreate.jsonData.estimate.estimate_id;
      cleanUpEstimates.push(zarEstimateId);

      await saveDraftItems({
        params: { id: zarEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: {
          items: [
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement B ${suffix}`, unit: 'Bag', qty: 10, rate: 200, rate_reference: 'Ref' }
          ]
        }
      }, mockRes());

      await submitEstimate({ params: { id: zarEstimateId }, user: { mobile_number: mobileJE_Owner, role: 'je' } }, mockRes());
      await reviewEstimate({ params: { id: zarEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

      const { data: zarItems } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', zarEstimateId).order('created_at', { ascending: true });
      await submitRowApprovals({
        params: { id: zarEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: {
          approvals: [
            { item_id: zarItems[0].item_id, approve_status: 'Approve' },
            { item_id: zarItems[1].item_id, approve_status: 'Not Approve', remarks: 'Bad' }
          ]
        }
      }, mockRes());

      await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Revision Requested', estimate_revision: 1 }).eq('estimate_id', zarEstimateId);

      const expiredDate = new Date();
      expiredDate.setMinutes(expiredDate.getMinutes() - 10);

      await supabase.from('estimate_revision_log').insert({
        estimate_id: zarEstimateId,
        revision_cycle: 1,
        stage: 'ZO',
        requested_by: mobileZO,
        revision_deadline: expiredDate.toISOString(),
        created_at: expiredDate.toISOString()
      });

      const res = mockRes();
      await reviewEstimate({
        params: { id: zarEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' }
      }, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.estimate.estimate_status).toBe('Submitted');
      expect(res.jsonData.estimate.estimate_revision).toBe(2);

      const { data: itemsAfter, error } = await supabase
        .from('project_cost_estimate_items')
        .select('*')
        .eq('estimate_id', zarEstimateId)
        .order('created_at', { ascending: true });

      console.log("\n===== AFTER AUTO RESUBMIT =====");
      console.log(JSON.stringify(itemsAfter, null, 2));
      console.log("===============================\n");

      expect(error).toBeNull();
      expect(itemsAfter[0].zo_office_approve).toBe('Approve');
      expect(itemsAfter[1].zo_office_approve).toBeNull();

      const { data: auditLogs } = await supabase.from('audit_log').select('*').eq('record_identifier', zarEstimateId).eq('action', 'AUTO_RESUBMIT');
      expect(auditLogs.length).toBe(1);
    });

    test('Test 14: Auto-resubmits expired HO Revision Requested on review attempt', async () => {
      const suffix4 = crypto.randomUUID().substring(0, 8);
      const activeWorkOrder4 = `TEST_WO_M5_HO_AR_${suffix4}`;
      await supabase.from('projects_master').insert([
        { work_order_no: activeWorkOrder4, estimate_no: `EST_M5_HAR_${suffix4}`, work_order_value: 500000.00, site_details: 'Staging HAR', state: 'West Bengal', district: 'Kolkata', zone: 'Kolkata Zone', department: 'PWD', status: 'Running', created_by: mobileAdmin, edited_by: mobileAdmin }
      ]);

      const resCreate = mockRes();
      await createEstimate({
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: { work_order_no: activeWorkOrder4, zonal_office_no: 'ZO-10' }
      }, resCreate);
      const harEstimateId = resCreate.jsonData.estimate.estimate_id;
      cleanUpEstimates.push(harEstimateId);

      await saveDraftItems({
        params: { id: harEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: {
          items: [
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' },
            { material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement B ${suffix}`, unit: 'Bag', qty: 10, rate: 200, rate_reference: 'Ref' }
          ]
        }
      }, mockRes());

      await submitEstimate({ params: { id: harEstimateId }, user: { mobile_number: mobileJE_Owner, role: 'je' } }, mockRes());
      await reviewEstimate({ params: { id: harEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

      const { data: harItems } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', harEstimateId).order('created_at', { ascending: true });
      await submitRowApprovals({
        params: { id: harEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: {
          approvals: [
            { item_id: harItems[0].item_id, approve_status: 'Approve' },
            { item_id: harItems[1].item_id, approve_status: 'Approve' }
          ]
        }
      }, mockRes());
      await submitReview({ params: { id: harEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());

      await supabase.from('project_cost_estimates').update({ estimate_status: 'HO Revision Requested', estimate_revision: 2 }).eq('estimate_id', harEstimateId);

      await supabase.from('project_cost_estimate_items').update({ ho_office_approve: 'Approve' }).eq('item_id', harItems[0].item_id);
      await supabase.from('project_cost_estimate_items').update({ ho_office_approve: 'Not Approve', ho_remarks: 'Bad size' }).eq('item_id', harItems[1].item_id);

      const expiredDate = new Date();
      expiredDate.setMinutes(expiredDate.getMinutes() - 10);

      await supabase.from('estimate_revision_log').insert({
        estimate_id: harEstimateId,
        revision_cycle: 1,
        stage: 'HO',
        requested_by: mobileHO,
        revision_deadline: expiredDate.toISOString(),
        created_at: expiredDate.toISOString()
      });

      const res = mockRes();
      await reviewEstimate({
        params: { id: harEstimateId },
        user: { mobile_number: mobileHO, role: 'ho' }
      }, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.estimate.estimate_status).toBe('Under HO Review');
      expect(res.jsonData.estimate.estimate_revision).toBe(3);

      const { data: itemsAfter } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', harEstimateId).order('created_at', { ascending: true });
      expect(itemsAfter[0].zo_office_approve).toBe('Approve');
      expect(itemsAfter[1].zo_office_approve).toBe('Approve');
      expect(itemsAfter[0].ho_office_approve).toBe('Approve');
      expect(itemsAfter[1].ho_office_approve).toBeNull();
      expect(Number(res.jsonData.estimate.estimate_amount)).toBe(3000.00);
    });

    test('Test 15: Auto-resubmit blocks unauthorized stage review attempts with 403', async () => {
      const suffix5 = crypto.randomUUID().substring(0, 8);
      const activeWorkOrder5 = `TEST_WO_M5_GUARD_${suffix5}`;
      await supabase.from('projects_master').insert([
        { work_order_no: activeWorkOrder5, estimate_no: `EST_M5_G_${suffix5}`, work_order_value: 500000.00, site_details: 'Staging G', state: 'West Bengal', district: 'Kolkata', zone: 'Kolkata Zone', department: 'PWD', status: 'Running', created_by: mobileAdmin, edited_by: mobileAdmin }
      ]);

      const resCreate = mockRes();
      await createEstimate({
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: { work_order_no: activeWorkOrder5, zonal_office_no: 'ZO-10' }
      }, resCreate);
      const gEstimateId = resCreate.jsonData.estimate.estimate_id;
      cleanUpEstimates.push(gEstimateId);

      await saveDraftItems({
        params: { id: gEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: {
          items: [{ material_main_head: 'Raw Materials', material_sub_head: 'Cement', material_details: `Test Cement A ${suffix}`, unit: 'Bag', qty: 10, rate: 100, rate_reference: 'Ref' }]
        }
      }, mockRes());

      await submitEstimate({ params: { id: gEstimateId }, user: { mobile_number: mobileJE_Owner, role: 'je' } }, mockRes());
      await reviewEstimate({ params: { id: gEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, mockRes());
      const { data: gItems } = await supabase.from('project_cost_estimate_items').select('*').eq('estimate_id', gEstimateId);

      await submitRowApprovals({
        params: { id: gEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' },
        body: { approvals: [{ item_id: gItems[0].item_id, approve_status: 'Not Approve', remarks: 'Bad' }] }
      }, mockRes());

      await supabase.from('project_cost_estimates').update({ estimate_status: 'ZO Revision Requested' }).eq('estimate_id', gEstimateId);

      const expiredDate = new Date();
      expiredDate.setMinutes(expiredDate.getMinutes() - 10);

      await supabase.from('estimate_revision_log').insert({
        estimate_id: gEstimateId,
        revision_cycle: 1,
        stage: 'ZO',
        requested_by: mobileZO,
        revision_deadline: expiredDate.toISOString(),
        created_at: expiredDate.toISOString()
      });

      // Review attempt by HO actor (unauthorized for ZO stage)
      const resZOStage = mockRes();
      await reviewEstimate({
        params: { id: gEstimateId },
        user: { mobile_number: mobileHO, role: 'ho' }
      }, resZOStage);

      // Force status to HO stage
      await supabase.from('project_cost_estimates').update({ estimate_status: 'HO Revision Requested' }).eq('estimate_id', gEstimateId);
      await supabase.from('estimate_revision_log').update({ stage: 'HO', requested_by: mobileHO }).eq('estimate_id', gEstimateId);

      // Review attempt by ZO actor (unauthorized for HO stage)
      const resHOStage = mockRes();
      await reviewEstimate({
        params: { id: gEstimateId },
        user: { mobile_number: mobileZO, role: 'zo' }
      }, resHOStage);

      expect(resZOStage.statusCode).toBe(403);
      expect(resHOStage.statusCode).toBe(403);
    });
  });
});
