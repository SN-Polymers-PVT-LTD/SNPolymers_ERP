import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const {
  createSubcontractor,
  updateSubcontractor,
  updateSubcontractorStatus
} = require('../../../src/controllers/subcontractors.controller');

const mockRes = () => {
  const res = {
    statusCode: 200,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonData = payload;
      return this;
    }
  };
  return res;
};

describe('Subcontractor Capability Atomic Transaction & Rollback Contracts', () => {
  const suffix = Date.now().toString().slice(-6);
  const actor = `99901${suffix}`;
  let adminUser;
  let workA;
  let workB;
  let workC;
  const createdContractorIds = [];

  beforeAll(async () => {
    await requireLocalSupabase();
    // 1. Create an active admin user
    const { data: user, error: userError } = await supabase.from('authorised_users').insert({
      mobile_number: actor,
      display_name: `Atomic Admin ${suffix}`,
      role: 'admin',
      is_active: true
    }).select().single();
    if (userError) throw userError;
    adminUser = user;

    // 2. Create sample subcontract works
    const { data: wA, error: errA } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Sub Head A ${suffix}`,
      material_details: `Pipe Laying A ${suffix}`,
      unit: 'Mtr',
      created_by: actor
    }).select().single();
    if (errA) throw errA;
    workA = wA;

    const { data: wB, error: errB } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Sub Head B ${suffix}`,
      material_details: `Trenching B ${suffix}`,
      unit: 'Rmt',
      created_by: actor
    }).select().single();
    if (errB) throw errB;
    workB = wB;

    const { data: wC, error: errC } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Sub Head C ${suffix}`,
      material_details: `Testing C ${suffix}`,
      unit: 'Nos',
      created_by: actor
    }).select().single();
    if (errC) throw errC;
    workC = wC;
  });

  afterAll(async () => {
    // Clean up contractors and their capabilities (cascade deletes capabilities)
    if (createdContractorIds.length > 0) {
      await supabase.from('subcontractor_master').delete().in('id', createdContractorIds);
    }
    // Clean up subcontract works
    const workIds = [workA?.id, workB?.id, workC?.id].filter(Boolean);
    if (workIds.length > 0) {
      await supabase.from('subcontract_work_master').delete().in('id', workIds);
    }
    // Clean up admin user
    if (adminUser?.mobile_number) {
      await supabase.from('authorised_users').delete().eq('mobile_number', adminUser.mobile_number);
    }
  });

  test('createSubcontractor rejects invalid work IDs with 400 and creates no contractor or capabilities', async () => {
    const invalidWorkId = '00000000-0000-0000-0000-000000000999';
    const req = {
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Failed Create Contractor ${suffix}`,
        work_ids: [workA.id, invalidWorkId]
      }
    };
    const res = mockRes();
    await createSubcontractor(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toMatch(/one or more subcontract work ids do not exist/i);

    // Verify nothing was persisted in database
    const { data: contractorCheck } = await supabase
      .from('subcontractor_master')
      .select('id')
      .eq('subcontractor_name', `Failed Create Contractor ${suffix}`);
    expect(contractorCheck).toHaveLength(0);
  });

  test('updateSubcontractor with an invalid work ID preserves 100% of existing capabilities without data loss', async () => {
    // 1. Create valid contractor with workA and workB
    const createReq = {
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Preserve Caps Contractor ${suffix}`,
        work_ids: [workA.id, workB.id]
      }
    };
    const createRes = mockRes();
    await createSubcontractor(createReq, createRes);
    expect(createRes.statusCode).toBe(201);
    const contractorId = createRes.jsonData.subcontractor.id;
    createdContractorIds.push(contractorId);

    // Check initial capabilities in DB
    const { data: initialCaps } = await supabase
      .from('subcontractor_work_capabilities')
      .select('subcontract_work_id')
      .eq('subcontractor_id', contractorId);
    expect(initialCaps).toHaveLength(2);
    expect(initialCaps.map(c => c.subcontract_work_id).sort()).toEqual([workA.id, workB.id].sort());

    // 2. Attempt update with an invalid work ID
    const invalidWorkId = '00000000-0000-0000-0000-000000000888';
    const updateReq = {
      params: { id: contractorId },
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Renamed Should Fail ${suffix}`,
        work_ids: [workA.id, invalidWorkId]
      }
    };
    const updateRes = mockRes();
    await updateSubcontractor(updateReq, updateRes);

    expect(updateRes.statusCode).toBe(400);
    expect(updateRes.jsonData.success).toBe(false);
    expect(updateRes.jsonData.message).toMatch(/one or more subcontract work ids do not exist/i);

    // 3. Verify that the contractor name was NOT changed
    const { data: contractorAfter } = await supabase
      .from('subcontractor_master')
      .select('subcontractor_name')
      .eq('id', contractorId)
      .single();
    expect(contractorAfter.subcontractor_name).toBe(`Preserve Caps Contractor ${suffix}`);

    // 4. CRITICAL: Verify that the capabilities were NOT deleted or wiped
    const { data: capsAfter } = await supabase
      .from('subcontractor_work_capabilities')
      .select('subcontract_work_id')
      .eq('subcontractor_id', contractorId);
    expect(capsAfter).toHaveLength(2);
    expect(capsAfter.map(c => c.subcontract_work_id).sort()).toEqual([workA.id, workB.id].sort());
  });

  test('direct save_subcontractor_transact RPC with invalid work ID raises P4B01 and rolls back atomically', async () => {
    // 1. Create a contractor with workA
    const { data: contractorId, error: createError } = await supabase.rpc('create_subcontractor_transact', {
      p_subcontractor_name: `RPC Direct Contractor ${suffix}`,
      p_work_ids: [workA.id],
      p_actor: actor
    });
    expect(createError).toBeNull();
    createdContractorIds.push(contractorId);

    // 2. Call update_subcontractor_transact with non-existent work ID
    const nonExistentWorkId = '11111111-2222-3333-4444-555555555555';
    const { error: rpcError } = await supabase.rpc('update_subcontractor_transact', {
      p_subcontractor_id: contractorId,
      p_subcontractor_name: 'Attempted RPC Rename',
      p_is_active: true,
      p_work_ids: [workB.id, nonExistentWorkId],
      p_update_work_ids: true,
      p_actor: actor
    });

    expect(rpcError).toBeDefined();
    expect(rpcError.message).toMatch(/one or more subcontract work ids do not exist/i);

    // 3. Verify original capability workA is still present and workB was not added
    const { data: remainingCaps } = await supabase
      .from('subcontractor_work_capabilities')
      .select('subcontract_work_id')
      .eq('subcontractor_id', contractorId);
    expect(remainingCaps).toHaveLength(1);
    expect(remainingCaps[0].subcontract_work_id).toBe(workA.id);
  });

  test('concurrent updates serialize cleanly under FOR UPDATE row locks without losing capabilities', async () => {
    // 1. Create a contractor with workA
    const createReq = {
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Concurrent Contractor ${suffix}`,
        work_ids: [workA.id]
      }
    };
    const createRes = mockRes();
    await createSubcontractor(createReq, createRes);
    expect(createRes.statusCode).toBe(201);
    const contractorId = createRes.jsonData.subcontractor.id;
    createdContractorIds.push(contractorId);

    // 2. Launch two concurrent updates targeting different capability sets
    const update1 = updateSubcontractor({
      params: { id: contractorId },
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Concurrent Name 1 ${suffix}`,
        work_ids: [workA.id, workB.id]
      }
    }, mockRes());

    const update2 = updateSubcontractor({
      params: { id: contractorId },
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Concurrent Name 2 ${suffix}`,
        work_ids: [workB.id, workC.id]
      }
    }, mockRes());

    const [res1, res2] = await Promise.all([update1, update2]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // 3. Verify the final database state is cohesive and matches the winner (either [workA, workB] or [workB, workC])
    const { data: finalCaps } = await supabase
      .from('subcontractor_work_capabilities')
      .select('subcontract_work_id')
      .eq('subcontractor_id', contractorId);

    const finalIds = finalCaps.map(c => c.subcontract_work_id).sort();
    const isSet1 = JSON.stringify(finalIds) === JSON.stringify([workA.id, workB.id].sort());
    const isSet2 = JSON.stringify(finalIds) === JSON.stringify([workB.id, workC.id].sort());

    expect(isSet1 || isSet2).toBe(true);
    expect(finalCaps.length).toBeGreaterThanOrEqual(2);
  });

  test('concurrent valid update and invalid update: invalid fails with 400 and valid succeeds', async () => {
    // 1. Create a contractor with workA and workB
    const createReq = {
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Mixed Concurrency Contractor ${suffix}`,
        work_ids: [workA.id, workB.id]
      }
    };
    const createRes = mockRes();
    await createSubcontractor(createReq, createRes);
    const contractorId = createRes.jsonData.subcontractor.id;
    createdContractorIds.push(contractorId);

    // 2. Fire valid update and invalid update concurrently
    const invalidWorkId = '00000000-0000-0000-0000-000000000777';
    const validUpdate = updateSubcontractor({
      params: { id: contractorId },
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Valid Update Winner ${suffix}`,
        work_ids: [workC.id]
      }
    }, mockRes());

    const invalidUpdate = updateSubcontractor({
      params: { id: contractorId },
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Invalid Loser ${suffix}`,
        work_ids: [workA.id, invalidWorkId]
      }
    }, mockRes());

    const [validRes, invalidRes] = await Promise.all([validUpdate, invalidUpdate]);

    expect(validRes.statusCode).toBe(200);
    expect(invalidRes.statusCode).toBe(400);

    // 3. Final state in database must be exactly workC, never empty or corrupt
    const { data: finalCaps } = await supabase
      .from('subcontractor_work_capabilities')
      .select('subcontract_work_id')
      .eq('subcontractor_id', contractorId);
    expect(finalCaps).toHaveLength(1);
    expect(finalCaps[0].subcontract_work_id).toBe(workC.id);
  });

  test('clearing capabilities with work_ids: [] vs preserving capabilities when work_ids is omitted', async () => {
    // 1. Create contractor with workA
    const createReq = {
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Omit Test Contractor ${suffix}`,
        work_ids: [workA.id]
      }
    };
    const createRes = mockRes();
    await createSubcontractor(createReq, createRes);
    const contractorId = createRes.jsonData.subcontractor.id;
    createdContractorIds.push(contractorId);

    // 2. Update without work_ids (only changing name)
    const renameRes = mockRes();
    await updateSubcontractor({
      params: { id: contractorId },
      user: { mobile_number: actor, role: 'admin' },
      body: { subcontractor_name: `Renamed Omit Test ${suffix}` }
    }, renameRes);
    expect(renameRes.statusCode).toBe(200);
    expect(renameRes.jsonData.subcontractor.capabilities).toHaveLength(1);
    expect(renameRes.jsonData.subcontractor.capabilities[0].subcontract_work_id).toBe(workA.id);

    // 3. Update with work_ids: [] explicitly clears capabilities
    const clearRes = mockRes();
    await updateSubcontractor({
      params: { id: contractorId },
      user: { mobile_number: actor, role: 'admin' },
      body: { work_ids: [] }
    }, clearRes);
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.jsonData.subcontractor.capabilities).toHaveLength(0);

    const { data: dbCaps } = await supabase
      .from('subcontractor_work_capabilities')
      .select('id')
      .eq('subcontractor_id', contractorId);
    expect(dbCaps).toHaveLength(0);
  });

  test('updateSubcontractorStatus updates active status while keeping capabilities intact', async () => {
    // 1. Create contractor with workB
    const createReq = {
      user: { mobile_number: actor, role: 'admin' },
      body: {
        subcontractor_name: `Status Test Contractor ${suffix}`,
        work_ids: [workB.id]
      }
    };
    const createRes = mockRes();
    await createSubcontractor(createReq, createRes);
    const contractorId = createRes.jsonData.subcontractor.id;
    createdContractorIds.push(contractorId);

    // 2. Deactivate contractor
    const statusRes = mockRes();
    await updateSubcontractorStatus({
      params: { id: contractorId },
      user: { mobile_number: actor, role: 'admin' },
      body: { is_active: false }
    }, statusRes);

    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.jsonData.subcontractor.is_active).toBe(false);

    // 3. Verify capabilities in DB are still workB
    const { data: capsAfterStatus } = await supabase
      .from('subcontractor_work_capabilities')
      .select('subcontract_work_id')
      .eq('subcontractor_id', contractorId);
    expect(capsAfterStatus).toHaveLength(1);
    expect(capsAfterStatus[0].subcontract_work_id).toBe(workB.id);
  });
});
