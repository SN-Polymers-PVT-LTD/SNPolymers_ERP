import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const setupUsers = require('../helpers/setupUsers');
const mockRes = require('../helpers/mockRes');
const {
  createWorkOrderMapping,
  deactivateWorkOrderMapping,
  getWorkOrderMappings
} = require('../../src/controllers/workOrderMappings.controller');
const { getZonalBalances } = require('../../src/controllers/zoBalances.controller');

describe('Work Order Mappings — snapshot, zoBalances, pagination regression tests', () => {
  let suffix;
  let jeMobile, zoMobile, otherZoMobile, adminMobile;
  let workOrderNo;
  let mappingId;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9201${suffix}`;
    zoMobile = `9202${suffix}`;
    otherZoMobile = `9203${suffix}`;
    adminMobile = `9204${suffix}`;
    workOrderNo = `WO-WOM-${suffix}`;

    await setupUsers([
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO ${suffix}` },
      { mobile_number: otherZoMobile, role: 'zo', is_active: true, display_name: `Other ZO ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` }
    ]);

    const { error: projErr } = await supabase.from('projects_master').insert([{
      work_order_no: workOrderNo,
      estimate_no: `EST-WOM-${suffix}`,
      site_details: `Site WOM-${suffix}`,
      zo_user_id: zoMobile,
      state: 'State',
      district: 'District',
      zone: 'Zone',
      department: 'Dept',
      created_by: adminMobile,
      edited_by: adminMobile,
      work_order_value: 100000.00
    }]);
    if (projErr) throw new Error(`Failed to set up test project: ${projErr.message}`);

    // JE needs an active JE-ZO mapping matching the project's ZO before a work order can be assigned
    const { error: jeZoErr } = await supabase.from('je_zo_mappings').insert([{
      je_user_id: jeMobile,
      zo_user_id: zoMobile,
      is_active: true,
      assigned_by: adminMobile,
      je_name: `JE ${suffix}`,
      zo_name: `ZO ${suffix}`,
      assigned_by_name: `Admin ${suffix}`
    }]);
    if (jeZoErr) throw new Error(`Failed to set up JE-ZO mapping: ${jeZoErr.message}`);
  });

  afterAll(async () => {
    await supabase.from('work_order_mappings').delete().eq('work_order_no', workOrderNo);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrderNo);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile, otherZoMobile, adminMobile]);
  });

  test('WOM-01: create + deactivate snapshot survives later changes to the related project/user names (Bug 1)', async () => {
    const createReq = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { work_order_no: workOrderNo, je_mobile_number: jeMobile }
    };
    const createResRes = mockRes();
    await createWorkOrderMapping(createReq, createResRes);
    expect(createResRes.statusCode).toBe(201);
    mappingId = createResRes.jsonData.mapping.id;
    expect(createResRes.jsonData.mapping.zo_name).toBe(`ZO ${suffix}`);
    expect(createResRes.jsonData.mapping.je_name).toBe(`JE ${suffix}`);

    const deactReq = {
      user: { mobile_number: adminMobile, role: 'admin' },
      params: { id: mappingId },
      body: { reason: 'Removed' }
    };
    const deactRes = mockRes();
    await deactivateWorkOrderMapping(deactReq, deactRes);
    expect(deactRes.statusCode).toBe(200);
    expect(deactRes.jsonData.mapping.zo_name).toBe(`ZO ${suffix}`);

    // Mutate the related project's ZO and rename both users - a live-join implementation
    // would now show the wrong ZO/names for this already-deactivated historical row.
    await supabase.from('projects_master').update({ zo_user_id: otherZoMobile }).eq('work_order_no', workOrderNo);
    await supabase.from('authorised_users').update({ display_name: 'Renamed JE' }).eq('mobile_number', jeMobile);
    await supabase.from('authorised_users').update({ display_name: 'Renamed ZO' }).eq('mobile_number', zoMobile);

    const listReq = { user: { mobile_number: adminMobile, role: 'admin' }, query: { status: 'inactive' } };
    const listRes = mockRes();
    await getWorkOrderMappings(listReq, listRes);
    expect(listRes.statusCode).toBe(200);
    const row = listRes.jsonData.mappings.find(m => m.id === mappingId);
    expect(row).toBeDefined();
    expect(row.zo_name).toBe(`ZO ${suffix}`);
    expect(row.je_name).toBe(`JE ${suffix}`);
    expect(row.deactivated_by_name).toBe(`Admin ${suffix}`);
  });

  test('WOM-02: zoBalances includes a ZO whose only signal is an active work order mapping (Bug 2)', async () => {
    // At this point workOrderNo's mapping is inactive (deactivated in WOM-01); create a fresh
    // active one under otherZoMobile via a second JE so zoBalances has a live signal to find,
    // isolated from any other mapped source for otherZoMobile.
    const je2Mobile = `9205${suffix}`;
    await setupUsers([{ mobile_number: je2Mobile, role: 'je', is_active: true, display_name: `JE2 ${suffix}` }]);
    await supabase.from('je_zo_mappings').insert([{
      je_user_id: je2Mobile,
      zo_user_id: otherZoMobile,
      is_active: true,
      assigned_by: adminMobile,
      je_name: `JE2 ${suffix}`,
      zo_name: `Other ZO ${suffix}`,
      assigned_by_name: `Admin ${suffix}`
    }]);

    // Reset the project back so createWorkOrderMapping's zonal-match check passes for je2/otherZo
    await supabase.from('projects_master').update({ zo_user_id: otherZoMobile }).eq('work_order_no', workOrderNo);

    const createReq = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { work_order_no: workOrderNo, je_mobile_number: je2Mobile }
    };
    const createRes = mockRes();
    await createWorkOrderMapping(createReq, createRes);
    expect(createRes.statusCode).toBe(201);

    const balReq = { user: { mobile_number: adminMobile, role: 'admin' }, query: {} };
    const balRes = mockRes();
    await getZonalBalances(balReq, balRes);
    expect(balRes.statusCode).toBe(200);
    expect(balRes.jsonData.balances.some(b => b.zo_user_id === otherZoMobile)).toBe(true);

    await supabase.from('work_order_mappings').delete().eq('je_user_id', je2Mobile);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', je2Mobile);
    await supabase.from('authorised_users').delete().eq('mobile_number', je2Mobile);
  });

  test('WOM-03: status and sort query params scope and order results correctly (Bugs 4, 5)', async () => {
    const activeReq = { user: { mobile_number: adminMobile, role: 'admin' }, query: { status: 'active' } };
    const activeRes = mockRes();
    await getWorkOrderMappings(activeReq, activeRes);
    expect(activeRes.jsonData.mappings.every(m => m.is_active)).toBe(true);

    const inactiveReq = { user: { mobile_number: adminMobile, role: 'admin' }, query: { status: 'inactive', sort: 'deactivated_at' } };
    const inactiveRes = mockRes();
    await getWorkOrderMappings(inactiveReq, inactiveRes);
    expect(inactiveRes.jsonData.mappings.every(m => !m.is_active)).toBe(true);
    const deactivatedAts = inactiveRes.jsonData.mappings.map(m => new Date(m.deactivated_at).getTime());
    expect([...deactivatedAts]).toEqual([...deactivatedAts].sort((a, b) => b - a));
  });
});
