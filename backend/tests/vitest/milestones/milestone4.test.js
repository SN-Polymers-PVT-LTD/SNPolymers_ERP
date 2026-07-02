import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  createEstimate,
  saveDraftItems,
  submitEstimate
} = require('../../../src/controllers/estimates.controller');

describe('Milestone 4 — Cost Estimates Submission & Revision Workflow API', () => {
  let suffix;
  let activeWorkOrder;
  let activeWorkOrder2 = null;
  let mobileJE_Owner;
  let mobileJE_Other;
  let mobileZO;
  let mobileAdmin;
  let createdEstimateId = null;
  let createdEstimateId2 = null;
  const insertedMaterialIds = [];
  let deadlineZO;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    activeWorkOrder = `TEST_WO_M4_ACTIVE_${suffix}`;
    mobileJE_Owner = `+91900000_${suffix.substring(0, 4)}`;
    mobileJE_Other = `+91911111_${suffix.substring(0, 4)}`;
    mobileZO = `+91922222_${suffix.substring(0, 4)}`;
    mobileAdmin = `+91933333_${suffix.substring(0, 4)}`;
    deadlineZO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Setup: Clean up and insert test records
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_Owner, mobileJE_Other, mobileZO, mobileAdmin]);

    // Insert Users
    const { error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: mobileJE_Owner, display_name: 'JE Owner', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileJE_Other, display_name: 'JE Other', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true, permissions: {} }
    ]);
    if (userError) throw userError;

    // Insert Project
    const { error: projError } = await supabase.from('projects_master').insert([
      {
        work_order_no: activeWorkOrder,
        estimate_no: `EST_M4_${suffix}`,
        work_order_value: 1000000.00,
        site_details: 'Staging Site M4',
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

    // Insert Material
    const { data: testMats, error: matsError } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin }
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
    } else {
      throw new Error(`Failed to create test estimate: ${resCreate.jsonData.message}`);
    }
  });

  afterAll(async () => {
    if (createdEstimateId) {
      await supabase.from('estimate_revision_log').delete().eq('estimate_id', createdEstimateId);
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId);
      await supabase.from('project_cost_estimates').update({
        work_order_no: 'WB_BAN_102',
        created_by: '+918276071523',
        last_modified_by: '+918276071523',
        je_user_id: '+918276071523',
        zo_approved_by: null,
        ho_approved_by: null
      }).eq('estimate_id', createdEstimateId);
    }
    if (createdEstimateId2) {
      await supabase.from('estimate_revision_log').delete().eq('estimate_id', createdEstimateId2);
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId2);
      await supabase.from('project_cost_estimates').update({
        work_order_no: 'WB_BAN_102',
        created_by: '+918276071523',
        last_modified_by: '+918276071523',
        je_user_id: '+918276071523',
        zo_approved_by: null,
        ho_approved_by: null
      }).eq('estimate_id', createdEstimateId2);
    }
    if (insertedMaterialIds.length > 0) {
      await supabase.from('material_master').delete().in('id', insertedMaterialIds);
    }
    await supabase.from('projects_master').delete().eq('work_order_no', activeWorkOrder);
    if (activeWorkOrder2) {
      await supabase.from('projects_master').delete().eq('work_order_no', activeWorkOrder2);
    }
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_Owner, mobileJE_Other, mobileZO, mobileAdmin]);
  });

  describe('Validation & Ownership Gating', () => {
    test('Test 1: Blocks submitEstimate on non-existent estimate ID with 404', async () => {
      const req = {
        params: { id: '00000000-0000-0000-0000-000000000000' },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      };
      const res = mockRes();
      await submitEstimate(req, res);

      expect(res.statusCode).toBe(404);
    });

    test('Test 2: Blocks submitEstimate with zero line items with 422', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      };
      const res = mockRes();
      await submitEstimate(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('at least one line item');
    });

    test('Test 3a: Blocks submitEstimate with incomplete item (qty = 0) with 422', async () => {
      expect(createdEstimateId).not.toBeNull();

      const resSave = mockRes();
      await saveDraftItems({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: {
          items: [{
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 0,
            rate: 450,
            rate_reference: 'Ref'
          }]
        }
      }, resSave);

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      }, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('incomplete');
      expect(res.jsonData.errors[0]?.missing_fields).toContain('qty');
    });

    test('Test 3b: Blocks submitEstimate with incomplete item (rate = 0) with 422', async () => {
      expect(createdEstimateId).not.toBeNull();

      const resSave = mockRes();
      await saveDraftItems({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: {
          items: [{
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 10,
            rate: 0,
            rate_reference: 'Ref'
          }]
        }
      }, resSave);

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      }, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('incomplete');
      expect(res.jsonData.errors[0]?.missing_fields).toContain('rate');
    });

    test('Test 4a: Blocks submitEstimate with incomplete item (blank rate_reference) with 422', async () => {
      expect(createdEstimateId).not.toBeNull();

      const resSave = mockRes();
      await saveDraftItems({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: {
          items: [{
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 10,
            rate: 450,
            rate_reference: '   '
          }]
        }
      }, resSave);

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      }, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('incomplete');
      expect(res.jsonData.errors[0]?.missing_fields).toContain('rate_reference');
    });

    test('Test 4b: Blocks submitEstimate with incomplete item (blank unit) with 422', async () => {
      expect(createdEstimateId).not.toBeNull();

      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId);

      const customItemId = crypto.randomUUID();
      const { error } = await supabase.from('project_cost_estimate_items').insert({
        item_id: customItemId,
        estimate_id: createdEstimateId,
        material_main_head: 'Raw Materials',
        material_sub_head: 'Cement',
        material_details: `Test Cement ${suffix}`,
        unit: '', // empty unit
        qty: 10,
        rate: 450,
        amount: 4500.00,
        rate_reference: 'Ref'
      });
      if (error) throw error;

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      }, res);

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toContain('incomplete');
      expect(res.jsonData.errors[0]?.missing_fields).toContain('unit');
    });

    test('Test 5: Blocks submitEstimate ownership gating with 403', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Other, role: 'je' }
      };
      const res = mockRes();
      await submitEstimate(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.jsonData.message).toContain('Access denied');
    });
  });

  describe('Submit Cycles & Revision Gating', () => {
    test('Test 6: First submit as Owner JE successfully transitions Draft -> Submitted', async () => {
      expect(createdEstimateId).not.toBeNull();

      // Setup a valid item
      await supabase.from('project_cost_estimate_items').delete().eq('estimate_id', createdEstimateId);
      await saveDraftItems({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' },
        body: {
          items: [{
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 10,
            rate: 450,
            rate_reference: 'Ref'
          }]
        }
      }, mockRes());

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      }, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const est = res.jsonData.estimate;
      expect(est.estimate_status).toBe('Submitted');
      expect(est.estimate_revision).toBe(1);
      expect(Number(est.estimate_amount)).toBe(4500.00);
      expect(est.je_user_id).toBe(mobileJE_Owner);
      expect(est.je_date).not.toBeNull();
    });

    test('Test 7a: Blocks submit on an already Submitted estimate with 403', async () => {
      expect(createdEstimateId).not.toBeNull();

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      }, res);

      expect(res.statusCode).toBe(403);
      expect(res.jsonData.message).toContain('cannot be submitted');
    });

    test('Test 7b: Telegram failures are non-blocking on submit', async () => {
      expect(createdEstimateId).not.toBeNull();

      const telegramService = require('../../../src/services/telegram.service');
      const originalNotify = telegramService.notifyZoEstimateSubmitted;

      telegramService.notifyZoEstimateSubmitted = async () => {
        throw new Error('Simulated Telegram Bot failure');
      };

      // Reset estimate back to Draft
      await supabase
        .from('project_cost_estimates')
        .update({ estimate_status: 'Draft', estimate_revision: 0 })
        .eq('estimate_id', createdEstimateId);

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      }, res);

      // Restore service method
      telegramService.notifyZoEstimateSubmitted = originalNotify;

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
    });

    test('Test 8: ZO Resubmission Flow (resets unapproved items, closes open log)', async () => {
      expect(createdEstimateId).not.toBeNull();

      const { data: beforeZoEst } = await supabase
        .from('project_cost_estimates')
        .select('je_date')
        .eq('estimate_id', createdEstimateId)
        .single();

      // Transition to ZO Revision Requested
      await supabase
        .from('project_cost_estimates')
        .update({ estimate_status: 'ZO Revision Requested' })
        .eq('estimate_id', createdEstimateId);

      // Add log
      const logIdZO = crypto.randomUUID();
      const deadlineZO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('estimate_revision_log').insert({
        id: logIdZO,
        estimate_id: createdEstimateId,
        revision_cycle: 1,
        stage: 'ZO',
        requested_by: mobileZO,
        revision_deadline: deadlineZO
      });

      // Mark item Not Approve
      const { data: itemsZo } = await supabase
        .from('project_cost_estimate_items')
        .select('item_id')
        .eq('estimate_id', createdEstimateId);
      const itemId = itemsZo[0].item_id;

      await supabase
        .from('project_cost_estimate_items')
        .update({ zo_office_approve: 'Not Approve' })
        .eq('item_id', itemId);

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_Owner, role: 'je' }
      }, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const est = res.jsonData.estimate;
      expect(est.estimate_status).toBe('Submitted');
      expect(est.estimate_revision).toBe(2);

      const { data: updatedItems } = await supabase
        .from('project_cost_estimate_items')
        .select('*')
        .eq('estimate_id', createdEstimateId);
      expect(updatedItems[0].zo_office_approve).toBeNull();

      const { data: updatedLog } = await supabase
        .from('estimate_revision_log')
        .select('*')
        .eq('id', logIdZO)
        .single();
      expect(updatedLog.resubmitted_at).not.toBeNull();
      expect(updatedLog.resubmitted_by).toBe(mobileJE_Owner);
      expect(updatedLog.modified_item_ids[0]).toBe(itemId);

      expect(new Date(est.je_date).getTime()).toBe(new Date(beforeZoEst.je_date).getTime());
    });

    test('Test 9a: HO Resubmission Flow (resets unapproved items, Admin resubmits)', async () => {
      expect(createdEstimateId).not.toBeNull();

      const { data: beforeHoEst } = await supabase
        .from('project_cost_estimates')
        .select('je_date')
        .eq('estimate_id', createdEstimateId)
        .single();

      // Transition to HO Revision Requested
      await supabase
        .from('project_cost_estimates')
        .update({ estimate_status: 'HO Revision Requested' })
        .eq('estimate_id', createdEstimateId);

      // Add log
      const logIdHO = crypto.randomUUID();
      const deadlineHO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('estimate_revision_log').insert({
        id: logIdHO,
        estimate_id: createdEstimateId,
        revision_cycle: 2,
        stage: 'HO',
        requested_by: mobileAdmin,
        revision_deadline: deadlineHO
      });

      // Set items
      const { data: items } = await supabase
        .from('project_cost_estimate_items')
        .select('item_id')
        .eq('estimate_id', createdEstimateId);
      const itemId = items[0].item_id;

      await supabase
        .from('project_cost_estimate_items')
        .update({ zo_office_approve: 'Approve', ho_office_approve: 'Not Approve' })
        .eq('item_id', itemId);

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId },
        user: { mobile_number: mobileAdmin, role: 'admin' }
      }, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const est = res.jsonData.estimate;
      expect(est.estimate_status).toBe('Submitted');
      expect(est.estimate_revision).toBe(3);

      const { data: updatedItems } = await supabase
        .from('project_cost_estimate_items')
        .select('*')
        .eq('estimate_id', createdEstimateId);
      expect(updatedItems[0].ho_office_approve).toBeNull();
      expect(updatedItems[0].zo_office_approve).toBe('Approve');

      const { data: updatedLog } = await supabase
        .from('estimate_revision_log')
        .select('*')
        .eq('id', logIdHO)
        .single();
      expect(updatedLog.resubmitted_at).not.toBeNull();
      expect(updatedLog.resubmitted_by).toBe(mobileAdmin);

      expect(new Date(est.je_date).getTime()).toBe(new Date(beforeHoEst.je_date).getTime());
    });

    test('Test 9b: First submit by an Admin user (Draft -> Submitted)', async () => {
      activeWorkOrder2 = `TEST_WO_M4_ACTIVE2_${suffix}`;

      // Insert active project 2
      const { error: projError2 } = await supabase.from('projects_master').insert([
        {
          work_order_no: activeWorkOrder2,
          estimate_no: `EST_M4_2_${suffix}`,
          work_order_value: 1200000.00,
          site_details: 'Staging Site M4 2',
          state: 'West Bengal',
          district: 'Kolkata',
          zone: 'Kolkata Zone',
          department: 'PWD',
          status: 'Running',
          created_by: mobileAdmin,
          edited_by: mobileAdmin
        }
      ]);
      if (projError2) throw projError2;

      // Create estimate 2
      const resCreate2 = mockRes();
      await createEstimate({
        user: { mobile_number: mobileAdmin, role: 'admin' },
        body: { work_order_no: activeWorkOrder2, zonal_office_no: 'ZO-10' }
      }, resCreate2);
      expect(resCreate2.statusCode).toBe(201);
      createdEstimateId2 = resCreate2.jsonData.estimate.estimate_id;

      // Save draft items
      await saveDraftItems({
        params: { id: createdEstimateId2 },
        user: { mobile_number: mobileAdmin, role: 'admin' },
        body: {
          items: [{
            material_main_head: 'Raw Materials',
            material_sub_head: 'Cement',
            material_details: `Test Cement ${suffix}`,
            unit: 'Bag',
            qty: 5,
            rate: 500,
            rate_reference: 'Ref_Admin'
          }]
        }
      }, mockRes());

      const res = mockRes();
      await submitEstimate({
        params: { id: createdEstimateId2 },
        user: { mobile_number: mobileAdmin, role: 'admin' }
      }, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      const est2 = res.jsonData.estimate;
      expect(est2.estimate_status).toBe('Submitted');
      expect(est2.estimate_revision).toBe(1);
      expect(est2.je_user_id).toBe(mobileAdmin);
    });
  });

  describe('Defensive RPC Gating Checks', () => {
    test('Test 10: Blocks ZO submit RPC from incorrect workflow state (Submitted) with custom message', async () => {
      expect(createdEstimateId).not.toBeNull();

      const { error } = await supabase.rpc('submit_estimate', {
        p_estimate_id: createdEstimateId,
        p_stage: 'ZO',
        p_mobile_number: mobileJE_Owner,
        p_new_revision: 4
      });

      expect(error).not.toBeNull();
      expect(error.message).toContain('Expected ZO Revision Requested');
    });

    test('Test 11: Blocks ZO submit RPC when no open logs exist', async () => {
      expect(createdEstimateId).not.toBeNull();

      // Transition to ZO Revision Requested but close logs
      await supabase
        .from('project_cost_estimates')
        .update({ estimate_status: 'ZO Revision Requested' })
        .eq('estimate_id', createdEstimateId);

      const { error } = await supabase.rpc('submit_estimate', {
        p_estimate_id: createdEstimateId,
        p_stage: 'ZO',
        p_mobile_number: mobileJE_Owner,
        p_new_revision: 4
      });

      expect(error).not.toBeNull();
      expect(error.message).toContain('Expected exactly one open revision log, found 0');
    });

    test('Test 12: Blocks inserting duplicate open logs via database constraint', async () => {
      expect(createdEstimateId).not.toBeNull();

      const dupLog1 = crypto.randomUUID();
      await supabase.from('estimate_revision_log').insert({
        id: dupLog1,
        estimate_id: createdEstimateId,
        revision_cycle: 3,
        stage: 'ZO',
        requested_by: mobileZO,
        revision_deadline: deadlineZO
      });

      const dupLog2 = crypto.randomUUID();
      const { error } = await supabase.from('estimate_revision_log').insert({
        id: dupLog2,
        estimate_id: createdEstimateId,
        revision_cycle: 3,
        stage: 'ZO',
        requested_by: mobileZO,
        revision_deadline: deadlineZO
      });

      expect(error).not.toBeNull();
      expect(error.code).toBe('23505');

      // Reset to Draft for clean deletions
      await supabase
        .from('project_cost_estimates')
        .update({ estimate_status: 'Draft' })
        .eq('estimate_id', createdEstimateId);
    });
  });
});
