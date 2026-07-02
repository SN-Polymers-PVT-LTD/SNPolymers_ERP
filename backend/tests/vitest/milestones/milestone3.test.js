import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  createEstimate,
  saveDraftItems,
  getEstimates,
  getEstimateById
} = require('../../../src/controllers/estimates.controller');

describe('Milestone 3 — Cost Estimates CRUD API', () => {
  let suffix;
  let activeWorkOrder;
  let activeWorkOrder2;
  let closedWorkOrder;
  let mobileJE_A;
  let mobileJE_B;
  let mobileZO;
  let mobileAdmin;
  let createdEstimateId = null;
  let createdEstimateId2 = null;
  const insertedMaterialIds = [];

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    activeWorkOrder = `TEST_WO_M3_ACTIVE_${suffix}`;
    activeWorkOrder2 = `TEST_WO_M3_ACTIVE2_${suffix}`;
    closedWorkOrder = `TEST_WO_M3_CLOSED_${suffix}`;

    mobileJE_A = `+91900000_${suffix.substring(0, 4)}`;
    mobileJE_B = `+91911111_${suffix.substring(0, 4)}`;
    mobileZO = `+91922222_${suffix.substring(0, 4)}`;
    mobileAdmin = `+91933333_${suffix.substring(0, 4)}`;

    // Clean up users first
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_A, mobileJE_B, mobileZO, mobileAdmin]);

    // Insert Users
    const { error: userError } = await supabase.from('authorised_users').insert([
      { mobile_number: mobileJE_A, display_name: 'JE User A', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileJE_B, display_name: 'JE User B', role: 'je', is_active: true, permissions: {} },
      { mobile_number: mobileZO, display_name: 'ZO User', role: 'zo', is_active: true, permissions: {} },
      { mobile_number: mobileAdmin, display_name: 'Admin User', role: 'admin', is_active: true, permissions: {} }
    ]);
    if (userError) throw userError;

    // Insert Projects
    const { error: projError } = await supabase.from('projects_master').insert([
      {
        work_order_no: activeWorkOrder,
        estimate_no: `EST_M3_A_${suffix}`,
        work_order_value: 1000000.00,
        site_details: 'Staging Site A',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      },
      {
        work_order_no: activeWorkOrder2,
        estimate_no: `EST_M3_A2_${suffix}`,
        work_order_value: 1200000.00,
        site_details: 'Staging Site A2',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Running',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      },
      {
        work_order_no: closedWorkOrder,
        estimate_no: `EST_M3_B_${suffix}`,
        work_order_value: 2000000.00,
        site_details: 'Staging Site B',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'Kolkata Zone',
        department: 'PWD',
        status: 'Closed',
        created_by: mobileAdmin,
        edited_by: mobileAdmin
      }
    ]);
    if (projError) throw projError;

    // Insert 4 test materials
    const { data: testMats, error: matsError } = await supabase.from('material_master').insert([
      { Material_Main_Head: 'Raw Materials', Material_Sub_Head: 'Cement', Material_Details: `Test Cement ${suffix}`, M_Unit: 'Bag', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Labour', Material_Sub_Head: 'Skilled', Material_Details: `Test Labour ${suffix}`, M_Unit: 'Day', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Transport', Material_Sub_Head: 'Local', Material_Details: `Test Transport ${suffix}`, M_Unit: 'Nos', is_active: true, created_by: mobileAdmin },
      { Material_Main_Head: 'Miscellaneous', Material_Sub_Head: 'Misc', Material_Details: `Test Misc ${suffix}`, M_Unit: 'Nos', is_active: true, created_by: mobileAdmin }
    ]).select();

    if (matsError) throw matsError;
    if (testMats) {
      testMats.forEach(m => insertedMaterialIds.push(m.id));
    }
  });

  afterAll(async () => {
    if (createdEstimateId) {
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
    await supabase.from('projects_master').delete().in('work_order_no', [activeWorkOrder, activeWorkOrder2, closedWorkOrder]);
    await supabase.from('authorised_users').delete().in('mobile_number', [mobileJE_A, mobileJE_B, mobileZO, mobileAdmin]);
  });

  describe('Estimate Creation and Validation', () => {
    test('Test 1a: Blocks createEstimate on a Closed project with 403', async () => {
      const req = {
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: { work_order_no: closedWorkOrder, zonal_office_no: 'ZO-10' }
      };
      const res = mockRes();
      await createEstimate(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.jsonData.message).toContain('Closed');
    });

    test('Test 1b: Blocks createEstimate on a non-existent project with 404', async () => {
      const req = {
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: { work_order_no: `NON_EXISTENT_WO_${suffix}`, zonal_office_no: 'ZO-10' }
      };
      const res = mockRes();
      await createEstimate(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.jsonData.message).toContain('Project not found');
    });

    test('Test 2: Blocks createEstimate with blank zonal_office_no with 400', async () => {
      const req = {
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: { work_order_no: activeWorkOrder, zonal_office_no: '   ' }
      };
      const res = mockRes();
      await createEstimate(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.message).toContain('zonal_office_no');
    });

    test('Test 3: Creates valid estimate with auto-populated fields (Draft status)', async () => {
      const req = {
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: { work_order_no: activeWorkOrder, zonal_office_no: 'ZO-10', je_remarks: 'First draft remarks' }
      };
      const res = mockRes();
      await createEstimate(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.estimate).toBeDefined();

      const est = res.jsonData.estimate;
      expect(est.estimate_no).toBe(`EST_M3_A_${suffix}`);
      expect(est.area_code).toBe('Kolkata Zone');
      expect(est.estimate_revision).toBe(0);
      expect(est.estimate_status).toBe('Draft');

      createdEstimateId = est.estimate_id;

      // Seed second estimate
      const req3b = {
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: { work_order_no: activeWorkOrder2, zonal_office_no: 'ZO-10', je_remarks: 'Second draft remarks' }
      };
      const res3b = mockRes();
      await createEstimate(req3b, res3b);
      createdEstimateId2 = res3b.jsonData.estimate.estimate_id;
    });

    test('Test 4: Blocks duplicate active estimate for same work order with 409', async () => {
      const req = {
        user: { mobile_number: mobileJE_B, role: 'je' },
        body: { work_order_no: activeWorkOrder, zonal_office_no: 'ZO-12' }
      };
      const res = mockRes();
      await createEstimate(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.jsonData.message).toContain('estimate already exists');
    });
  });

  describe('Draft Items Handling & Validation', () => {
    test('Test 5a: Blocks saveDraftItems on unit mismatch with 400', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: {
          items: [
            {
              material_main_head: 'Raw Materials',
              material_sub_head: 'Cement',
              material_details: `Test Cement ${suffix}`,
              unit: 'Kg', // should be Bag
              qty: 10,
              rate: 450,
              rate_reference: 'Contract Price'
            }
          ]
        }
      };
      const res = mockRes();
      await saveDraftItems(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.message).toContain('Unit mismatch');
    });

    test('Test 5b: Blocks negative quantity and rate in saveDraftItems with 400', async () => {
      expect(createdEstimateId).not.toBeNull();

      const reqQty = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: {
          items: [
            {
              material_main_head: 'Raw Materials',
              material_sub_head: 'Cement',
              material_details: `Test Cement ${suffix}`,
              unit: 'Bag',
              qty: -1,
              rate: 450,
              rate_reference: 'Contract Price'
            }
          ]
        }
      };
      const resQty = mockRes();
      await saveDraftItems(reqQty, resQty);
      expect(resQty.statusCode).toBe(400);

      const reqRate = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: {
          items: [
            {
              material_main_head: 'Raw Materials',
              material_sub_head: 'Cement',
              material_details: `Test Cement ${suffix}`,
              unit: 'Bag',
              qty: 1,
              rate: -450,
              rate_reference: 'Contract Price'
            }
          ]
        }
      };
      const resRate = mockRes();
      await saveDraftItems(reqRate, resRate);
      expect(resRate.statusCode).toBe(400);
    });

    test('Test 6: Saves valid items, overrides amount, and checks UUID generation', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: {
          items: [
            {
              material_main_head: 'Raw Materials',
              material_sub_head: 'Cement',
              material_details: `Test Cement ${suffix}`,
              unit: 'Bag',
              qty: 10,
              rate: 450,
              rate_reference: 'Contract Price',
              amount: 9999.00 // Mismatched (should be 4500)
            },
            {
              material_main_head: 'Labour',
              material_sub_head: 'Skilled',
              material_details: `Test Labour ${suffix}`,
              unit: 'Day',
              qty: 5,
              rate: 500,
              rate_reference: 'Rate Contract'
            }
          ]
        }
      };
      const res = mockRes();
      await saveDraftItems(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.items.length).toBe(2);

      const savedItems = res.jsonData.items;
      expect(Number(savedItems[0].amount)).toBe(4500.00);
      expect(Number(savedItems[1].amount)).toBe(2500.00);
      expect(savedItems[0].item_id).toBeDefined();
      expect(savedItems[1].item_id).toBeDefined();
      expect(savedItems[0].item_id).not.toBe(savedItems[1].item_id);
    });

    test('Test 7: Blocks unauthorized JEs from modifying estimate with 403', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_B, role: 'je' },
        body: { items: [] }
      };
      const res = mockRes();
      await saveDraftItems(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.jsonData.message).toContain('Access denied');
    });
  });

  describe('Estimate Gating, Sorting, and Summary Category Mapping', () => {
    test('Test 8: Verifies role gating rules for retrieving single estimate details by ID', async () => {
      expect(createdEstimateId).not.toBeNull();

      const resA = mockRes();
      await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileJE_A, role: 'je' } }, resA);

      const resB = mockRes();
      await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileJE_B, role: 'je' } }, resB);

      const resZO = mockRes();
      await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileZO, role: 'zo' } }, resZO);

      const resAdmin = mockRes();
      await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileAdmin, role: 'admin' } }, resAdmin);

      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(404);
      expect(resZO.statusCode).toBe(404);
      expect(resAdmin.statusCode).toBe(200);
    });

    test('Test 9a: Filters lists per role and verifies sorting order (most recently updated first)', async () => {
      expect(createdEstimateId).not.toBeNull();
      expect(createdEstimateId2).not.toBeNull();

      const resA = mockRes();
      await getEstimates({ query: {}, user: { mobile_number: mobileJE_A, role: 'je' } }, resA);

      const resB = mockRes();
      await getEstimates({ query: {}, user: { mobile_number: mobileJE_B, role: 'je' } }, resB);

      const resZO = mockRes();
      await getEstimates({ query: {}, user: { mobile_number: mobileZO, role: 'zo' } }, resZO);

      const resAdmin = mockRes();
      await getEstimates({ query: {}, user: { mobile_number: mobileAdmin, role: 'admin' } }, resAdmin);

      const hasA = resA.jsonData.estimates.some(e => e.estimate_id === createdEstimateId);
      const hasA2 = resA.jsonData.estimates.some(e => e.estimate_id === createdEstimateId2);
      const hasB = resB.jsonData.estimates.some(e => e.estimate_id === createdEstimateId);
      const hasZO = resZO.jsonData.estimates.some(e => e.estimate_id === createdEstimateId);
      const hasAdmin = resAdmin.jsonData.estimates.some(e => e.estimate_id === createdEstimateId);

      expect(hasA).toBe(true);
      expect(hasA2).toBe(true);
      expect(hasB).toBe(false);
      expect(hasZO).toBe(false);
      expect(hasAdmin).toBe(true);

      const idx1 = resA.jsonData.estimates.findIndex(e => e.estimate_id === createdEstimateId);
      const idx2 = resA.jsonData.estimates.findIndex(e => e.estimate_id === createdEstimateId2);
      expect(idx1).toBeLessThan(idx2);
    });

    test('Test 9b: Limits pagination cap to 100', async () => {
      const res = mockRes();
      await getEstimates({ query: { limit: 105 }, user: { mobile_number: mobileAdmin, role: 'admin' } }, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.pagination.limit).toBe(100);
    });

    test('Test 10: Dynamic summary categories mapping aggregates cost categories correctly', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: {
          items: [
            {
              material_main_head: 'Labour',
              material_sub_head: 'Skilled',
              material_details: `Test Labour ${suffix}`,
              unit: 'Day',
              qty: 2,
              rate: 200
            },
            {
              material_main_head: 'Transport',
              material_sub_head: 'Local',
              material_details: `Test Transport ${suffix}`,
              unit: 'Nos',
              qty: 1,
              rate: 150
            },
            {
              material_main_head: 'Miscellaneous',
              material_sub_head: 'Misc',
              material_details: `Test Misc ${suffix}`,
              unit: 'Nos',
              qty: 1,
              rate: 250
            },
            {
              material_main_head: 'Raw Materials',
              material_sub_head: 'Cement',
              material_details: `Test Cement ${suffix}`,
              unit: 'Bag',
              qty: 10,
              rate: 100
            }
          ]
        }
      };
      const resSave = mockRes();
      await saveDraftItems(req, resSave);
      expect(resSave.statusCode).toBe(200);

      const resGet = mockRes();
      await getEstimateById({ params: { id: createdEstimateId }, user: { mobile_number: mobileJE_A, role: 'je' } }, resGet);

      expect(resGet.statusCode).toBe(200);
      expect(resGet.jsonData.success).toBe(true);

      const summary = resGet.jsonData.summary;
      expect(Number(summary.gross_labour_cost)).toBe(400);
      expect(Number(summary.gross_transport_cost)).toBe(150);
      expect(Number(summary.gross_misc_cost)).toBe(250);
      expect(Number(summary.gross_material_cost)).toBe(1000);
      expect(Number(summary.gross_total)).toBe(1800);
      expect(Number(summary.approved_grand_total)).toBe(1800);
    });

    test('Test 11: Empty payload items array recalculates estimate total to 0 successfully', async () => {
      expect(createdEstimateId).not.toBeNull();

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: { items: [] }
      };
      const res = mockRes();
      await saveDraftItems(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.items.length).toBe(0);

      const { data: finalHeader } = await supabase
        .from('project_cost_estimates')
        .select('estimate_amount')
        .eq('estimate_id', createdEstimateId)
        .single();

      expect(finalHeader).not.toBeNull();
      expect(Number(finalHeader.estimate_amount)).toBe(0);
    });

    test('Test 12: Blocks saveDraftItems editing when estimate is in Submitted status with 403', async () => {
      expect(createdEstimateId).not.toBeNull();

      // Lock to Submitted
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Submitted' })
        .eq('estimate_id', createdEstimateId);

      const req = {
        params: { id: createdEstimateId },
        user: { mobile_number: mobileJE_A, role: 'je' },
        body: {
          items: [
            {
              material_main_head: 'Raw Materials',
              material_sub_head: 'Cement',
              material_details: `Test Cement ${suffix}`,
              unit: 'Bag',
              qty: 5,
              rate: 400,
              rate_reference: 'Ref'
            }
          ]
        }
      };
      const res = mockRes();
      await saveDraftItems(req, res);

      // Revert lock
      await supabase.from('project_cost_estimates')
        .update({ estimate_status: 'Draft' })
        .eq('estimate_id', createdEstimateId);

      expect(res.statusCode).toBe(403);
      expect(res.jsonData.message).toContain('edited in its current status');
    });
  });
});
