import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const mockRes = require('../../helpers/mockRes');
const {
  createWorkOrderMapping,
  deactivateWorkOrderMapping,
  getWorkOrderMappings
} = require('../../../src/controllers/workOrderMappings.controller');

describe('Milestone P7-M3 — Work Order Mappings Controller Integration Tests', () => {
  let suffix;
  let jeMobile;
  let zoMobile1;
  let zoMobile2;
  let adminMobile;
  let fakeJeMobile;
  let workOrderNo1;
  let workOrderNo2;
  let closedWorkOrderNo;
  let noZoWorkOrderNo;
  let userMappingId;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9201${suffix}`;
    zoMobile1 = `9202${suffix}`;
    zoMobile2 = `9203${suffix}`;
    adminMobile = `9204${suffix}`;
    fakeJeMobile = `9205${suffix}`;
    workOrderNo1 = `WO-P7-M3-1-${suffix}`;
    workOrderNo2 = `WO-P7-M3-2-${suffix}`;
    closedWorkOrderNo = `WO-P7-M3-C-${suffix}`;
    noZoWorkOrderNo = `WO-P7-M3-N-${suffix}`;

    // Create test users
    await setupUsers([
      {
        mobile_number: jeMobile,
        role: 'je',
        is_active: true,
        display_name: `Test JE ${suffix}`
      },
      {
        mobile_number: zoMobile1,
        role: 'zo',
        is_active: true,
        display_name: `Test ZO 1 ${suffix}`
      },
      {
        mobile_number: zoMobile2,
        role: 'zo',
        is_active: true,
        display_name: `Test ZO 2 ${suffix}`
      },
      {
        mobile_number: adminMobile,
        role: 'admin',
        is_active: true,
        display_name: `Test Admin ${suffix}`
      },
      {
        mobile_number: fakeJeMobile,
        role: 'ho', // NOT a JE role
        is_active: true,
        display_name: `Fake JE ${suffix}`
      }
    ]);

    // Create active JE-ZO mapping to zoMobile1
    const { data: mapping, error: mapErr } = await supabase
      .from('je_zo_mappings')
      .insert({
        je_user_id: jeMobile,
        zo_user_id: zoMobile1,
        is_active: true,
        assigned_by: adminMobile
      })
      .select()
      .single();

    if (mapErr) throw mapErr;
    userMappingId = mapping.id;

    // Create projects
    const projects = [
      {
        work_order_no: workOrderNo1,
        estimate_no: `EST-M3-1-${suffix}`,
        site_details: `Site Details M3-1-${suffix}`,
        zo_user_id: zoMobile1,
        state: 'State',
        district: 'District',
        zone: 'Zone',
        department: 'Dept',
        created_by: adminMobile,
        edited_by: adminMobile,
        work_order_value: 500000.00,
        status: 'Running'
      },
      {
        work_order_no: workOrderNo2,
        estimate_no: `EST-M3-2-${suffix}`,
        site_details: `Site Details M3-2-${suffix}`,
        zo_user_id: zoMobile2, // Owned by ZO 2
        state: 'State',
        district: 'District',
        zone: 'Zone',
        department: 'Dept',
        created_by: adminMobile,
        edited_by: adminMobile,
        work_order_value: 500000.00,
        status: 'Running'
      },
      {
        work_order_no: closedWorkOrderNo,
        estimate_no: `EST-M3-C-${suffix}`,
        site_details: `Site Details M3-C-${suffix}`,
        zo_user_id: zoMobile1,
        state: 'State',
        district: 'District',
        zone: 'Zone',
        department: 'Dept',
        created_by: adminMobile,
        edited_by: adminMobile,
        work_order_value: 500000.00,
        status: 'Closed' // Closed project
      },
      {
        work_order_no: noZoWorkOrderNo,
        estimate_no: `EST-M3-N-${suffix}`,
        site_details: `Site Details M3-N-${suffix}`,
        zo_user_id: null, // No ZO owner
        state: 'State',
        district: 'District',
        zone: 'Zone',
        department: 'Dept',
        created_by: adminMobile,
        edited_by: adminMobile,
        work_order_value: 500000.00,
        status: 'Running'
      }
    ];

    const { error: projectErr } = await supabase
      .from('projects_master')
      .insert(projects);

    if (projectErr) {
      throw new Error(`Failed to set up test projects: ${projectErr.message}`);
    }
  });

  afterAll(async () => {
    // Clean up created records in reverse order
    await supabase.from('work_order_mappings').delete().eq('assigned_by', adminMobile);
    await supabase.from('je_zo_mappings').delete().eq('id', userMappingId);
    await supabase.from('projects_master').delete().in('work_order_no', [workOrderNo1, workOrderNo2, closedWorkOrderNo, noZoWorkOrderNo]);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile1, zoMobile2, adminMobile, fakeJeMobile]);
  });

  test('M3-TC-01: Rejects assignment if Work Order does not exist (404)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: `WO-NON-EXISTENT-${suffix}`,
        je_mobile_number: jeMobile
      }
    };
    const res = mockRes();
    await createWorkOrderMapping(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('Work Order not found.');
  });

  test('M3-TC-02: Rejects assignment if Work Order is Closed (403)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: closedWorkOrderNo,
        je_mobile_number: jeMobile
      }
    };
    const res = mockRes();
    await createWorkOrderMapping(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('Cannot assign to a closed Work Order.');
  });

  test('M3-TC-03: Rejects assignment if Junior Engineer does not exist or role incorrect (404)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: workOrderNo1,
        je_mobile_number: fakeJeMobile // role is ho
      }
    };
    const res = mockRes();
    await createWorkOrderMapping(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('Junior Engineer not found.');
  });

  test('M3-TC-04: Rejects assignment if JE has no active Zonal Office mapping (400)', async () => {
    // Deactivate mapping temporarily
    await supabase.from('je_zo_mappings').update({ is_active: false }).eq('id', userMappingId);

    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: workOrderNo1,
        je_mobile_number: jeMobile
      }
    };
    const res = mockRes();
    await createWorkOrderMapping(req, res);

    // Re-enable mapping
    await supabase.from('je_zo_mappings').update({ is_active: true }).eq('id', userMappingId);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('is not assigned to any active Zonal Office');
  });

  test('M3-TC-05: Rejects assignment if Work Order has no ZO owner (400)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: noZoWorkOrderNo,
        je_mobile_number: jeMobile
      }
    };
    const res = mockRes();
    await createWorkOrderMapping(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('Work Order has no assigned owning Zonal Office.');
  });

  test('M3-TC-06: Rejects assignment if JE belongs to a different ZO than the Work Order (400)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: workOrderNo2, // Owned by ZO 2
        je_mobile_number: jeMobile // Mapped to ZO 1
      }
    };
    const res = mockRes();
    await createWorkOrderMapping(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('Mismatched ZO assignment');
  });

  test('M3-TC-07: Successfully creates active Work Order mapping (201)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: workOrderNo1,
        je_mobile_number: jeMobile
      }
    };
    const res = mockRes();
    await createWorkOrderMapping(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.mapping).toBeDefined();
    expect(res.jsonData.mapping.work_order_no).toBe(workOrderNo1);
    expect(res.jsonData.mapping.je_user_id).toBe(jeMobile);
    expect(res.jsonData.mapping.is_active).toBe(true);
    expect(res.jsonData.mapping.reason).toBe('Assigned');
    expect(res.jsonData.mapping.assigned_by).toBe(adminMobile);
  });

  test('M3-TC-08: Rejects duplicate active assignment (400 / 409)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: workOrderNo1,
        je_mobile_number: jeMobile
      }
    };
    const res = mockRes();
    await createWorkOrderMapping(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toContain('already assigned');
  });

  test('M3-TC-09: Deactivating assignment works successfully and stores audit trail (200)', async () => {
    // 1. Fetch active mapping ID
    const { data, error } = await supabase
      .from('work_order_mappings')
      .select('id')
      .eq('work_order_no', workOrderNo1)
      .eq('je_user_id', jeMobile)
      .eq('is_active', true)
      .single();

    expect(error).toBeNull();
    const assignmentId = data.id;

    // 2. Deactivate
    const reqDeact = {
      user: { mobile_number: adminMobile, role: 'admin' },
      params: { id: assignmentId },
      body: { reason: 'Removed' }
    };
    const resDeact = mockRes();
    await deactivateWorkOrderMapping(reqDeact, resDeact);

    expect(resDeact.statusCode).toBe(200);
    expect(resDeact.jsonData.success).toBe(true);
    expect(resDeact.jsonData.mapping.is_active).toBe(false);
    expect(resDeact.jsonData.mapping.reason).toBe('Removed');
    expect(resDeact.jsonData.mapping.deactivated_by).toBe(adminMobile);

    // 3. Attempt deactivating again (should return 409 already inactive)
    const resDeactDup = mockRes();
    await deactivateWorkOrderMapping(reqDeact, resDeactDup);

    expect(resDeactDup.statusCode).toBe(409);
    expect(resDeactDup.jsonData.message).toContain('Mapping already inactive.');
  });

  test('M3-TC-10: Retrieve work order mappings filters for ZO role correctly', async () => {
    // Create an assignment again to test list
    const { error: insErr } = await supabase
      .from('work_order_mappings')
      .insert({
        work_order_no: workOrderNo1,
        je_user_id: jeMobile,
        is_active: true,
        reason: 'Assigned',
        assigned_by: adminMobile
      });
    expect(insErr).toBeNull();

    // 1. Retrieve as ZO 1 (should see assignments in ZO 1)
    const reqZo1 = {
      user: { mobile_number: zoMobile1, role: 'zo' }
    };
    const resZo1 = mockRes();
    await getWorkOrderMappings(reqZo1, resZo1);

    expect(resZo1.statusCode).toBe(200);
    expect(resZo1.jsonData.success).toBe(true);
    expect(resZo1.jsonData.mappings.length).toBeGreaterThan(0);

    // 2. Retrieve as ZO 2 (should see 0, since no assignments belong to projects owned by ZO 2)
    const reqZo2 = {
      user: { mobile_number: zoMobile2, role: 'zo' }
    };
    const resZo2 = mockRes();
    await getWorkOrderMappings(reqZo2, resZo2);

    expect(resZo2.statusCode).toBe(200);
    expect(resZo2.jsonData.success).toBe(true);
    expect(resZo2.jsonData.mappings.length).toBe(0);
  });
});
