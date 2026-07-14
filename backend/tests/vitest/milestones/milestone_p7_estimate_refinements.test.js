import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const setupUsers = require('../../helpers/setupUsers');
const {
  getEstimateInitData,
  createEstimate
} = require('../../../src/controllers/estimates.core.controller');

describe('Estimate Refinements — JE Work Order Mapping Restrictions', () => {
  let suffix;
  let jeMobile;
  let zoMobile;
  let adminMobile;
  let woMapped;
  let woUnmapped;
  let estimateIdCreated = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9501${suffix}`;
    zoMobile = `9502${suffix}`;
    adminMobile = `9503${suffix}`;
    woMapped = `WO_MAP_${suffix}`;
    woUnmapped = `WO_UNMAP_${suffix}`;

    // Setup active users
    await setupUsers([
      {
        mobile_number: jeMobile,
        role: 'je',
        is_active: true,
        display_name: `JE Refine ${suffix}`
      },
      {
        mobile_number: zoMobile,
        role: 'zo',
        is_active: true,
        display_name: `ZO Refine ${suffix}`
      },
      {
        mobile_number: adminMobile,
        role: 'admin',
        is_active: true,
        display_name: `Admin Refine ${suffix}`
      }
    ]);

    // Insert active JE-ZO mapping
    const { error: jeZoErr } = await supabase
      .from('je_zo_mappings')
      .insert([
        {
          je_user_id: jeMobile,
          zo_user_id: zoMobile,
          is_active: true,
          assigned_by: adminMobile
        }
      ]);
    if (jeZoErr) throw jeZoErr;

    // Create the two projects/work orders
    const { error: p1Err } = await supabase
      .from('projects_master')
      .insert([
        {
          work_order_no: woMapped,
          estimate_no: `EST_M_${suffix}`,
          site_details: 'Mapped site',
          zo_user_id: zoMobile,
          state: 'State',
          district: 'District',
          zone: 'Zone',
          department: 'Dept',
          created_by: adminMobile,
          edited_by: adminMobile,
          work_order_value: 100000.00
        },
        {
          work_order_no: woUnmapped,
          estimate_no: `EST_U_${suffix}`,
          site_details: 'Unmapped site',
          zo_user_id: zoMobile,
          state: 'State',
          district: 'District',
          zone: 'Zone',
          department: 'Dept',
          created_by: adminMobile,
          edited_by: adminMobile,
          work_order_value: 100000.00
        }
      ]);
    if (p1Err) throw p1Err;

    // Map JE to woMapped only
    const { error: woMapErr } = await supabase
      .from('work_order_mappings')
      .insert([
        {
          work_order_no: woMapped,
          je_user_id: jeMobile,
          is_active: true,
          reason: 'Assigned',
          assigned_by: adminMobile
        }
      ]);
    if (woMapErr) throw woMapErr;
  });

  afterAll(async () => {
    // Delete any cost estimates created during tests
    if (estimateIdCreated) {
      await supabase.from('project_cost_estimates').delete().eq('estimate_id', estimateIdCreated);
    }
    // Cleanup WO mappings
    await supabase.from('work_order_mappings').delete().eq('je_user_id', jeMobile);
    // Cleanup projects
    await supabase.from('projects_master').delete().in('work_order_no', [woMapped, woUnmapped]);
    // Cleanup JE-ZO mappings
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    // Cleanup users
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile, adminMobile]);
  });

  test('Test 1: JE availableWorkOrders dropdown only contains mapped work orders', async () => {
    const req = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      }
    };
    const res = mockRes();

    await getEstimateInitData(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    
    const wos = res.jsonData.availableWorkOrders.map(w => w.work_order_no);
    expect(wos).toContain(woMapped);
    expect(wos).not.toContain(woUnmapped);
  });

  test('Test 2: JE is blocked from creating cost estimate on unmapped work order', async () => {
    const req = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      },
      body: {
        work_order_no: woUnmapped,
        zonal_office_no: 'ZO-Refine',
        je_remarks: 'Attempting unmapped WO estimate'
      }
    };
    const res = mockRes();

    await createEstimate(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('You are not assigned to this Work Order');
  });

  test('Test 3: JE can successfully create cost estimate on mapped work order', async () => {
    const req = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      },
      body: {
        work_order_no: woMapped,
        zonal_office_no: 'ZO-Refine',
        je_remarks: 'Attempting mapped WO estimate'
      }
    };
    const res = mockRes();

    await createEstimate(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.estimate).toBeDefined();
    
    estimateIdCreated = res.jsonData.estimate.estimate_id;
  });

  test('Test 4: Mapped work order with Final Approved estimate is blocked and hidden', async () => {
    // 1. Update the existing estimate status to Final Approved
    expect(estimateIdCreated).not.toBeNull();
    const { error: updErr } = await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Final Approved' })
      .eq('estimate_id', estimateIdCreated);
    expect(updErr).toBeNull();

    // 2. Fetch dropdown available work orders
    const reqInit = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      }
    };
    const resInit = mockRes();
    await getEstimateInitData(reqInit, resInit);

    expect(resInit.statusCode).toBe(200);
    const wos = resInit.jsonData.availableWorkOrders.map(w => w.work_order_no);
    // Should be blocked and hidden
    expect(wos).not.toContain(woMapped);

    // 3. Verify backend create blocks it
    const reqCreate = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      },
      body: {
        work_order_no: woMapped,
        zonal_office_no: 'ZO-Refine',
        je_remarks: 'Attempting new estimate on final approved'
      }
    };
    const resCreate = mockRes();
    await createEstimate(reqCreate, resCreate);
    expect(resCreate.statusCode).toBe(409);
    expect(resCreate.jsonData.success).toBe(false);
  });

  test('Test 5: Mapped work order with ZO Revision Requested estimate is blocked and hidden', async () => {
    // 1. Update status to ZO Revision Requested
    const { error: updErr } = await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'ZO Revision Requested' })
      .eq('estimate_id', estimateIdCreated);
    expect(updErr).toBeNull();

    // 2. Fetch dropdown available work orders
    const reqInit = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      }
    };
    const resInit = mockRes();
    await getEstimateInitData(reqInit, resInit);

    expect(resInit.statusCode).toBe(200);
    const wos = resInit.jsonData.availableWorkOrders.map(w => w.work_order_no);
    // Should be blocked and hidden
    expect(wos).not.toContain(woMapped);

    // 3. Verify backend create blocks it
    const reqCreate = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      },
      body: {
        work_order_no: woMapped,
        zonal_office_no: 'ZO-Refine',
        je_remarks: 'Attempting new estimate on revision requested'
      }
    };
    const resCreate = mockRes();
    await createEstimate(reqCreate, resCreate);
    expect(resCreate.statusCode).toBe(409);
  });

  test('Test 6: Mapped work order with Rejected by ZO estimate is eligible and visible', async () => {
    // 1. Update status to Rejected by ZO
    const { error: updErr } = await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Rejected by ZO' })
      .eq('estimate_id', estimateIdCreated);
    expect(updErr).toBeNull();

    // 2. Fetch dropdown available work orders
    const reqInit = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      }
    };
    const resInit = mockRes();
    await getEstimateInitData(reqInit, resInit);

    expect(resInit.statusCode).toBe(200);
    const wos = resInit.jsonData.availableWorkOrders.map(w => w.work_order_no);
    // Should show up in the dropdown since the existing estimate is terminal rejected!
    expect(wos).toContain(woMapped);

    // 3. Verify backend create allows starting a new draft
    const reqCreate = {
      user: {
        mobile_number: jeMobile,
        role: 'je'
      },
      body: {
        work_order_no: woMapped,
        zonal_office_no: 'ZO-Refine',
        je_remarks: 'Draft 2'
      }
    };
    const resCreate = mockRes();
    await createEstimate(reqCreate, resCreate);
    expect(resCreate.statusCode).toBe(201);
    expect(resCreate.jsonData.success).toBe(true);

    // Delete the second estimate immediately to clean up
    if (resCreate.jsonData.estimate?.estimate_id) {
      await supabase
        .from('project_cost_estimates')
        .delete()
        .eq('estimate_id', resCreate.jsonData.estimate.estimate_id);
    }
  });
});
