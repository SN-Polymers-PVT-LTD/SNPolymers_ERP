import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');
const setupUsers = require('../helpers/setupUsers');
const mockRes = require('../helpers/mockRes');
const {
  createOrUpdateUserMapping,
  deactivateUserMapping,
  getUserMappings
} = require('../../src/controllers/userMappings.controller');
const { createWorkOrderMapping } = require('../../src/controllers/workOrderMappings.controller');

describe('JE-ZO Mappings — transactional transfer, snapshot, unmap regression tests', () => {
  let suffix;
  let jeMobile, zoMobile1, zoMobile2, zoMobile3, adminMobile;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9301${suffix}`;
    zoMobile1 = `9302${suffix}`;
    zoMobile2 = `9303${suffix}`;
    zoMobile3 = `9304${suffix}`;
    adminMobile = `9305${suffix}`;

    await setupUsers([
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE ${suffix}` },
      { mobile_number: zoMobile1, role: 'zo', is_active: true, display_name: `ZO1 ${suffix}` },
      { mobile_number: zoMobile2, role: 'zo', is_active: true, display_name: `ZO2 ${suffix}` },
      { mobile_number: zoMobile3, role: 'zo', is_active: true, display_name: `ZO3 ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin ${suffix}` }
    ]);
  });

  afterAll(async () => {
    await supabase.from('work_order_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().ilike('work_order_no', `WO-UM-%${suffix}`);
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile1, zoMobile2, zoMobile3, adminMobile]);
  });

  test('UM-01: two concurrent transfers for the same JE never orphan the JE (Bugs 6, 7)', async () => {
    // Seed an initial mapping so both concurrent calls hit the "deactivate old, insert new" path.
    const seedReq = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { je_mobile_number: jeMobile, zo_mobile_number: zoMobile1 }
    };
    const seedRes = mockRes();
    await createOrUpdateUserMapping(seedReq, seedRes);
    expect(seedRes.statusCode).toBe(201);

    const req2 = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { je_mobile_number: jeMobile, zo_mobile_number: zoMobile2 }
    };
    const req3 = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { je_mobile_number: jeMobile, zo_mobile_number: zoMobile3 }
    };
    const res2 = mockRes();
    const res3 = mockRes();

    await Promise.all([
      createOrUpdateUserMapping(req2, res2),
      createOrUpdateUserMapping(req3, res3)
    ]);

    // The per-JE advisory lock in transfer_je_to_zo_transact fully serializes concurrent
    // transfers for the same JE, so both legitimately succeed in sequence (last one to
    // acquire the lock wins and deactivates the other's freshly-inserted mapping) - neither
    // request gets a spurious failure, and critically, neither leaves the JE orphaned.
    // (A 500/409 is still acceptable here in principle, just not what the fix produces.)
    expect([res2.statusCode, res3.statusCode]).toEqual([201, 201]);

    const { data: activeMappings, error } = await supabase
      .from('je_zo_mappings')
      .select('*')
      .eq('je_user_id', jeMobile)
      .eq('is_active', true);

    expect(error).toBeNull();
    // No orphan: the JE has exactly one active mapping, not zero, after the race.
    expect(activeMappings.length).toBe(1);
    expect([zoMobile2, zoMobile3]).toContain(activeMappings[0].zo_user_id);
  });

  test('UM-02: pending/hold requisitions block transfer even when checked only at the RPC level (Bug 8)', async () => {
    const workOrderNo = `WO-UM-REQ-${suffix}`;
    const { data: activeMapping } = await supabase
      .from('je_zo_mappings')
      .select('zo_user_id')
      .eq('je_user_id', jeMobile)
      .eq('is_active', true)
      .maybeSingle();

    await supabase.from('projects_master').insert([{
      work_order_no: workOrderNo,
      estimate_no: `EST-UM-REQ-${suffix}`,
      site_details: `Site UM-REQ-${suffix}`,
      zo_user_id: activeMapping.zo_user_id,
      state: 'State',
      district: 'District',
      zone: 'Zone',
      department: 'Dept',
      created_by: adminMobile,
      edited_by: adminMobile,
      work_order_value: 50000.00
    }]);

    const reqId = crypto.randomUUID();
    await supabase.from('requisitions').insert([{
      requisition_id: reqId,
      work_order_no: workOrderNo,
      estimate_no: `EST-UM-REQ-${suffix}`,
      requisition_no: `REQ-UM-${suffix}`,
      material_main_head: 'CEMENT',
      requisition_pdf_url: `http://example.com/req-${suffix}.pdf`,
      requisition_amount: 500.00,
      gst_bill: 'No',
      bank_details: 'Mock Bank',
      requisition_status: 'Pending',
      requester_user_id: jeMobile,
      created_by: jeMobile,
      state: 'State',
      district: 'District',
      area_code: 'Zone',
      department: 'Dept',
      site_details: `Site UM-REQ-${suffix}`
    }]);

    // Call the RPC directly, bypassing the Node-side fast pre-check in the controller,
    // to prove the guard is authoritative at the transaction level (closes the old TOCTOU gap).
    const { error: rpcErr } = await supabase.rpc('transfer_je_to_zo_transact', {
      p_je: jeMobile,
      p_zo: zoMobile1,
      p_actor: adminMobile
    });

    expect(rpcErr).not.toBeNull();
    expect(rpcErr.code).toBe('REQ01');

    // requisitions is append-only (hard deletes are DB-blocked) - transition to a
    // terminal status instead so it stops blocking subsequent tests' transfers.
    await supabase.from('requisitions').update({ requisition_status: 'Cancelled' }).eq('requisition_id', reqId);
    await supabase.from('work_order_mappings').delete().eq('work_order_no', workOrderNo);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrderNo);
  });

  test('UM-03: transfer deactivates the JE\'s active work orders directly, even if their project moved to a different ZO (Bug 9)', async () => {
    // Establish JE on zoMobile1 with a project owned by zoMobile1, then drift the project's
    // ZO to zoMobile2 *after* the work order mapping exists (the old code derived the
    // deallocation set from the old ZO's *current* project list, missing this case).
    const { data: mappingBefore } = await supabase
      .from('je_zo_mappings')
      .select('*')
      .eq('je_user_id', jeMobile)
      .eq('is_active', true)
      .maybeSingle();

    // Ensure JE is on zoMobile1 to start this test in a known state.
    if (mappingBefore.zo_user_id !== zoMobile1) {
      const resetReq = {
        user: { mobile_number: adminMobile, role: 'admin' },
        body: { je_mobile_number: jeMobile, zo_mobile_number: zoMobile1 }
      };
      const resetRes = mockRes();
      await createOrUpdateUserMapping(resetReq, resetRes);
      expect(resetRes.statusCode).toBe(201);
    }

    const workOrderNo = `WO-UM-DRIFT-${suffix}`;
    await supabase.from('projects_master').insert([{
      work_order_no: workOrderNo,
      estimate_no: `EST-UM-DRIFT-${suffix}`,
      site_details: `Site UM-DRIFT-${suffix}`,
      zo_user_id: zoMobile1,
      state: 'State',
      district: 'District',
      zone: 'Zone',
      department: 'Dept',
      created_by: adminMobile,
      edited_by: adminMobile,
      work_order_value: 50000.00
    }]);

    const assignRes = mockRes();
    await createWorkOrderMapping({
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { work_order_no: workOrderNo, je_mobile_number: jeMobile }
    }, assignRes);
    expect(assignRes.statusCode).toBe(201);

    // Drift the project to a different ZO without touching the work order mapping.
    await supabase.from('projects_master').update({ zo_user_id: zoMobile3 }).eq('work_order_no', workOrderNo);

    const transferRes = mockRes();
    await createOrUpdateUserMapping({
      user: { mobile_number: adminMobile, role: 'admin' },
      body: { je_mobile_number: jeMobile, zo_mobile_number: zoMobile2 }
    }, transferRes);
    expect(transferRes.statusCode).toBe(201);

    const { data: woMapping } = await supabase
      .from('work_order_mappings')
      .select('is_active')
      .eq('work_order_no', workOrderNo)
      .eq('je_user_id', jeMobile)
      .maybeSingle();

    expect(woMapping.is_active).toBe(false);

    await supabase.from('work_order_mappings').delete().eq('work_order_no', workOrderNo);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrderNo);
  });

  test('UM-04: JE-ZO mapping snapshot survives a later user rename (Bug 10)', async () => {
    const { data: mapping } = await supabase
      .from('je_zo_mappings')
      .select('*')
      .eq('je_user_id', jeMobile)
      .eq('is_active', true)
      .maybeSingle();

    await supabase.from('authorised_users').update({ display_name: 'Renamed JE UM04' }).eq('mobile_number', jeMobile);

    const listRes = mockRes();
    await getUserMappings({ user: { mobile_number: adminMobile, role: 'admin' }, query: {} }, listRes);
    const row = listRes.jsonData.mappings.find(m => m.id === mapping.id);
    expect(row).toBeDefined();
    expect(row.je_name).toBe(mapping.je_name);
    expect(row.je_name).not.toBe('Renamed JE UM04');
  });

  test('UM-05: unmap endpoint deactivates a mapping without requiring a replacement ZO (Bug 11)', async () => {
    const { data: mapping } = await supabase
      .from('je_zo_mappings')
      .select('*')
      .eq('je_user_id', jeMobile)
      .eq('is_active', true)
      .maybeSingle();
    expect(mapping).toBeDefined();

    const unmapRes = mockRes();
    await deactivateUserMapping({
      user: { mobile_number: adminMobile, role: 'admin' },
      params: { id: mapping.id }
    }, unmapRes);

    expect(unmapRes.statusCode).toBe(200);
    expect(unmapRes.jsonData.mapping.is_active).toBe(false);
    expect(unmapRes.jsonData.mapping.deactivated_by_name).toBe(`Admin ${suffix}`);

    const { data: stillNoActive } = await supabase
      .from('je_zo_mappings')
      .select('id')
      .eq('je_user_id', jeMobile)
      .eq('is_active', true);
    expect(stillNoActive.length).toBe(0);
  });
});
