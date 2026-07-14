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
});
