import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const schemas = require('../../../src/validation/subcontractMasters.schema');
const requireRole = require('../../../src/middleware/requireRole');
const mockRes = require('../../helpers/mockRes');
const {
  getSubcontractors,
  getSubcontractorById,
  createSubcontractor,
  updateSubcontractor,
  updateSubcontractorStatus,
  getSubcontractorAssignments,
  createSubcontractorAssignment
} = require('../../../src/controllers/subcontractors.controller');
const { getSubcontractWorks } = require('../../../src/controllers/subcontractWorks.controller');

describe('Subcontract master contracts', () => {
  let suffix;
  let actor;
  let work;
  let duplicateContractor;
  let contractor;
  let apiContractor;
  let estimate;
  let workOrder;
  let workOrderB;
  let assignments = [];
  let jeUserA;
  let jeUserB;
  let zoUser;
  let adminUser;

  beforeAll(async () => {
    await requireLocalSupabase();
    suffix = crypto.randomUUID().slice(0, 8);
    const { data: user, error: userError } = await supabase.from('authorised_users').select('mobile_number').limit(1).single();
    if (userError) throw userError;
    actor = user.mobile_number;

    // Test users for JE / ZO / Admin access isolation testing
    jeUserA = { mobile_number: `9511${suffix}`, role: 'je', display_name: `JE A ${suffix}`, is_active: true };
    jeUserB = { mobile_number: `9512${suffix}`, role: 'je', display_name: `JE B ${suffix}`, is_active: true };
    zoUser = { mobile_number: `9513${suffix}`, role: 'zo', display_name: `ZO ${suffix}`, is_active: true };
    adminUser = { mobile_number: `9514${suffix}`, role: 'admin', display_name: `Admin ${suffix}`, is_active: true };

    const { error: insertUsersError } = await supabase.from('authorised_users').insert([
      jeUserA,
      jeUserB,
      zoUser,
      adminUser
    ]);
    if (insertUsersError) throw insertUsersError;

    workOrder = `WO-MASTER-${suffix}`;
    workOrderB = `WO-MASTER-B-${suffix}`;

    const { error: projectErrorA } = await supabase.from('projects_master').insert({
      work_order_no: workOrder,
      estimate_no: `EST-MASTER-${suffix}`,
      site_details: 'Master test site A',
      state: 'Test',
      district: 'Test',
      zone: 'Test',
      department: 'Test',
      zo_user_id: zoUser.mobile_number,
      created_by: actor,
      edited_by: actor,
      work_order_value: 10000,
      status: 'Running'
    });
    if (projectErrorA) throw projectErrorA;

    const { error: projectErrorB } = await supabase.from('projects_master').insert({
      work_order_no: workOrderB,
      estimate_no: `EST-MASTER-B-${suffix}`,
      site_details: 'Master test site B',
      state: 'Test',
      district: 'Test',
      zone: 'Test',
      department: 'Test',
      zo_user_id: zoUser.mobile_number,
      created_by: actor,
      edited_by: actor,
      work_order_value: 20000,
      status: 'Running'
    });
    if (projectErrorB) throw projectErrorB;

    // JE-ZO mappings
    const { error: jeZoError } = await supabase.from('je_zo_mappings').insert([
      { je_user_id: jeUserA.mobile_number, zo_user_id: zoUser.mobile_number, is_active: true, assigned_by: adminUser.mobile_number },
      { je_user_id: jeUserB.mobile_number, zo_user_id: zoUser.mobile_number, is_active: true, assigned_by: adminUser.mobile_number }
    ]);
    if (jeZoError) throw jeZoError;

    // Work order mappings (JE-A -> workOrder, JE-B -> workOrderB)
    const { error: womError } = await supabase.from('work_order_mappings').insert([
      { work_order_no: workOrder, je_user_id: jeUserA.mobile_number, is_active: true, reason: 'Assigned', assigned_by: zoUser.mobile_number },
      { work_order_no: workOrderB, je_user_id: jeUserB.mobile_number, is_active: true, reason: 'Assigned', assigned_by: zoUser.mobile_number }
    ]);
    if (womError) throw womError;

    const { data: workRow, error: workError } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Master ${suffix}`,
      material_details: `Pipe ${suffix}`,
      unit: 'Mtr',
      created_by: actor
    }).select().single();
    if (workError) throw workError;
    work = workRow;

    const { data: contractorRow, error: contractorError } = await supabase.from('subcontractor_master').insert({
      subcontractor_name: `Contractor ${suffix}`,
      created_by: actor
    }).select().single();
    if (contractorError) throw contractorError;
    contractor = contractorRow;
  });

  afterAll(async () => {
    if (assignments.length) {
      await supabase.from('subcontractor_work_assignments').delete().in('assignment_id', assignments.map(row => row.assignment_id));
    }
    if (estimate?.subcontract_estimate_id) {
      await supabase.from('project_subcontract_estimate_lines').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
      await supabase.from('project_subcontract_estimates').delete().eq('subcontract_estimate_id', estimate.subcontract_estimate_id);
    }
    if (contractor?.id) await supabase.from('subcontractor_master').delete().eq('id', contractor.id);
    if (apiContractor?.id) await supabase.from('subcontractor_master').delete().eq('id', apiContractor.id);
    if (duplicateContractor?.id) await supabase.from('subcontractor_master').delete().eq('id', duplicateContractor.id);
    if (work?.id) await supabase.from('subcontract_work_master').delete().eq('id', work.id);

    if (workOrder || workOrderB) {
      await supabase.from('work_order_mappings').delete().in('work_order_no', [workOrder, workOrderB].filter(Boolean));
      await supabase.from('projects_master').delete().in('work_order_no', [workOrder, workOrderB].filter(Boolean));
    }
    if (jeUserA || jeUserB) {
      await supabase.from('je_zo_mappings').delete().in('je_user_id', [jeUserA?.mobile_number, jeUserB?.mobile_number].filter(Boolean));
    }
    const createdUsers = [jeUserA?.mobile_number, jeUserB?.mobile_number, zoUser?.mobile_number, adminUser?.mobile_number].filter(Boolean);
    if (createdUsers.length) {
      await supabase.from('authorised_users').delete().in('mobile_number', createdUsers);
    }
  });

  test('normalizes blank filters, optional strings, email, and invalid UUIDs', () => {
    const parsed = schemas.subcontractorListSchema.query.parse({ is_active: '' });
    expect(parsed.is_active).toBeUndefined();
    expect(schemas.subcontractorCreateSchema.body.parse({ subcontractor_name: 'X' })).toEqual({ subcontractor_name: 'X' });
    expect(schemas.subcontractorCreateSchema.body.parse({ subcontractor_name: 'X', work_ids: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'] })).toEqual({ subcontractor_name: 'X', work_ids: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'] });
    expect(schemas.subcontractorIdSchema.params.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  test('Accounts cannot read master data while Projects roles can', () => {
    const next = () => {};
    const denied = { user: { role: 'accounts' }, status: code => ({ json: () => code }) };
    let deniedCode;
    requireRole(['je', 'zo', 'ho', 'admin'])({ user: denied.user }, { status: code => ({ json: () => { deniedCode = code; } }) }, next);
    expect(deniedCode).toBe(403);
    expect(() => requireRole(['je', 'zo', 'ho', 'admin'])({ user: { role: 'je' } }, {}, next)).not.toThrow();
  });

  test('duplicate work is rejected after normalized identity, but duplicate contractor names are legal', async () => {
    const workDuplicate = await supabase.from('subcontract_work_master').insert({ sub_head: ` master ${suffix} `, material_details: ` PIPE ${suffix} `, unit: 'mtr', created_by: actor });
    expect(workDuplicate.error?.code).toBe('23505');
    const { data, error } = await supabase.from('subcontractor_master').insert({ subcontractor_name: `Contractor ${suffix}`, created_by: actor }).select().single();
    if (error) throw error;
    duplicateContractor = data;
  });

  test('inactive rows are hidden from active queries and can be explicitly selected', async () => {
    const { error } = await supabase.from('subcontractor_master').update({ is_active: false }).eq('id', duplicateContractor.id);
    if (error) throw error;
    const active = await supabase.from('subcontractor_master').select('id').eq('id', duplicateContractor.id).eq('is_active', true);
    expect(active.data).toHaveLength(0);
    const all = await supabase.from('subcontractor_master').select('id').eq('id', duplicateContractor.id).eq('is_active', false);
    expect(all.data).toHaveLength(1);
  });

  test('controller list returns subcontractors without master beneficiary or KYC fields', async () => {
    const req = { user: { role: 'admin' }, query: { search: `Contractor, ${suffix}`, page: 1, limit: 10 } };
    const res = mockRes();
    await getSubcontractors(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(Array.isArray(res.jsonData.subcontractors)).toBe(true);
    expect(res.jsonData.subcontractors.every(row => !Object.hasOwn(row, 'primary_beneficiary_id'))).toBe(true);
  });

  test('controller create/update/status contracts use only the Excel contractor identity fields', async () => {
    const createRes = mockRes();
    await createSubcontractor({ user: { mobile_number: actor }, body: { subcontractor_name: `API Contractor ${suffix}` } }, createRes);
    expect(createRes.statusCode).toBe(201);
    apiContractor = createRes.jsonData.subcontractor;
    expect(apiContractor).not.toHaveProperty('primary_beneficiary_id');

    const statusRes = mockRes();
    await updateSubcontractorStatus({ params: { id: apiContractor.id }, user: { mobile_number: actor }, body: { is_active: false } }, statusRes);
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.jsonData.subcontractor.is_active).toBe(false);
  });

  test('createSubcontractor associates multiple work capabilities without requiring Work Order or commercial fields', async () => {
    // Create two test works
    const { data: w1 } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Cap Head 1 ${suffix}`,
      material_details: `Cap Work 1 ${suffix}`,
      unit: 'mtr',
      created_by: actor
    }).select().single();
    const { data: w2 } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Cap Head 2 ${suffix}`,
      material_details: `Cap Work 2 ${suffix}`,
      unit: 'sqm',
      created_by: actor
    }).select().single();

    const createRes = mockRes();
    await createSubcontractor({
      user: { mobile_number: actor },
      body: {
        subcontractor_name: `Capability Contractor ${suffix}`,
        work_ids: [w1.id, w2.id]
      }
    }, createRes);

    expect(createRes.statusCode).toBe(201);
    const newContractor = createRes.jsonData.subcontractor;
    expect(newContractor.subcontractor_name).toBe(`Capability Contractor ${suffix}`);
    expect(newContractor.capabilities).toHaveLength(2);
    expect(newContractor.capabilities.map(c => c.subcontract_work_id).sort()).toEqual([w1.id, w2.id].sort());

    // Verify in database
    const { data: dbCaps } = await supabase
      .from('subcontractor_work_capabilities')
      .select('*')
      .eq('subcontractor_id', newContractor.id);
    expect(dbCaps).toHaveLength(2);

    // Filter works by subcontractor_id
    const filterRes = mockRes();
    await getSubcontractWorks({
      query: { subcontractor_id: newContractor.id }
    }, filterRes);
    expect(filterRes.statusCode).toBe(200);
    expect(filterRes.jsonData.subcontractWorks).toHaveLength(2);
    expect(filterRes.jsonData.subcontractWorks.map(w => w.id).sort()).toEqual([w1.id, w2.id].sort());

    // Update capabilities: remove w1, add w3
    const { data: w3 } = await supabase.from('subcontract_work_master').insert({
      sub_head: `Cap Head 3 ${suffix}`,
      material_details: `Cap Work 3 ${suffix}`,
      unit: 'nos',
      created_by: actor
    }).select().single();

    const updateRes = mockRes();
    await updateSubcontractor({
      params: { id: newContractor.id },
      user: { mobile_number: actor },
      body: {
        subcontractor_name: `Capability Contractor Updated ${suffix}`,
        work_ids: [w2.id, w3.id]
      }
    }, updateRes);
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.jsonData.subcontractor.capabilities).toHaveLength(2);
    expect(updateRes.jsonData.subcontractor.capabilities.map(c => c.subcontract_work_id).sort()).toEqual([w2.id, w3.id].sort());

    // Duplicate work_ids in request are deduplicated safely
    const dupRes = mockRes();
    await updateSubcontractor({
      params: { id: newContractor.id },
      user: { mobile_number: actor },
      body: {
        subcontractor_name: `Capability Contractor Updated ${suffix}`,
        work_ids: [w3.id, w3.id]
      }
    }, dupRes);
    expect(dupRes.statusCode).toBe(200);
    expect(dupRes.jsonData.subcontractor.capabilities).toHaveLength(1);
    expect(dupRes.jsonData.subcontractor.capabilities[0].subcontract_work_id).toBe(w3.id);

    // Shared capabilities: another subcontractor can also have w3 capability
    const sharedRes = mockRes();
    await createSubcontractor({
      user: { mobile_number: actor },
      body: {
        subcontractor_name: `Shared Contractor ${suffix}`,
        work_ids: [w3.id]
      }
    }, sharedRes);
    expect(sharedRes.statusCode).toBe(201);
    expect(sharedRes.jsonData.subcontractor.capabilities).toHaveLength(1);
  });

  test('non-permitted update is rejected by the route role contract', () => {
    let statusCode;
    requireRole(['admin', 'je'])({ user: { role: 'zo' } }, { status: code => ({ json: () => { statusCode = code; } }) }, () => {});
    expect(statusCode).toBe(403);
  });

  test('Works Undertaken stores Excel row values and permits repeated source rows', async () => {
    const rows = [
      { work_order_no: workOrder, subcontractor_id: contractor.id, subcontract_work_id: work.id, unit: work.unit, qty: 2, rate: 125.5, rate_reference: 'LOCAL', created_by: actor },
      { work_order_no: workOrder, subcontractor_id: contractor.id, subcontract_work_id: work.id, unit: work.unit, qty: 3, rate: 125.5, rate_reference: 'LOCAL', created_by: actor }
    ];
    const { data, error } = await supabase.from('subcontractor_work_assignments').insert(rows).select();
    if (error) throw error;
    assignments.push(...data);
    expect(data).toHaveLength(2);
    expect(Number(data[0].amount)).toBe(251);
    expect(Number(data[1].amount)).toBe(376.5);
  });

  test('referenced work identity cannot be changed at the database boundary', async () => {
    const { data: estimateRow, error: estimateError } = await supabase.from('project_subcontract_estimates').insert({ work_order_no: workOrder, created_by: actor }).select().single();
    if (estimateError) throw estimateError;
    estimate = estimateRow;
    const { error: lineError } = await supabase.from('project_subcontract_estimate_lines').insert({ subcontract_estimate_id: estimate.subcontract_estimate_id, subcontractor_id: contractor.id, subcontract_work_id: work.id, qty: 1, rate: 10, amount: 10, created_by: actor, entry_kind: 'BASE' });
    if (lineError) throw lineError;
    const update = await supabase.from('subcontract_work_master').update({ material_details: `Changed ${suffix}` }).eq('id', work.id);
    expect(update.error?.code).toBe('23514');
    const statusUpdate = await supabase.from('subcontract_work_master').update({ is_active: false }).eq('id', work.id);
    expect(statusUpdate.error).toBeNull();
  });

  describe('JE work-order isolation in subcontract assignments and masters', () => {
    let activeWork;

    beforeAll(async () => {
      const { data, error } = await supabase.from('subcontract_work_master').insert({
        sub_head: `Isolation Work ${suffix}`,
        material_details: `Excavation ${suffix}`,
        unit: 'Cum',
        created_by: actor
      }).select().single();
      if (error) throw error;
      activeWork = data;
    });

    afterAll(async () => {
      if (activeWork?.id) {
        await supabase.from('subcontract_work_master').delete().eq('id', activeWork.id);
      }
    });

    test('JE cannot create an assignment for an unassigned work order (HTTP 403)', async () => {
      const req = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        body: {
          work_order_no: workOrderB,
          subcontractor_id: contractor.id,
          subcontract_work_id: activeWork.id,
          unit: activeWork.unit,
          qty: 10,
          rate: 100,
          rate_reference: 'TEST-B-DENIED'
        }
      };
      const res = mockRes();
      await createSubcontractorAssignment(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toBe('You are not assigned to this Work Order.');
    });

    test('JE can create an assignment for their assigned work order', async () => {
      const req = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        body: {
          work_order_no: workOrder,
          subcontractor_id: contractor.id,
          subcontract_work_id: activeWork.id,
          unit: activeWork.unit,
          qty: 10,
          rate: 100,
          rate_reference: 'TEST-A-JE'
        }
      };
      const res = mockRes();
      await createSubcontractorAssignment(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.assignment.work_order_no).toBe(workOrder);
      assignments.push(res.jsonData.assignment);
    });

    test('Admin can create an assignment for any work order', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        body: {
          work_order_no: workOrderB,
          subcontractor_id: contractor.id,
          subcontract_work_id: activeWork.id,
          unit: activeWork.unit,
          qty: 15,
          rate: 120,
          rate_reference: 'TEST-B-ADMIN'
        }
      };
      const res = mockRes();
      await createSubcontractorAssignment(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.assignment.work_order_no).toBe(workOrderB);
      assignments.push(res.jsonData.assignment);
    });

    test('JE cannot query assignments specifically for an unassigned work order (HTTP 403)', async () => {
      const req = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        query: { work_order_no: workOrderB }
      };
      const res = mockRes();
      await getSubcontractorAssignments(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toBe('You are not assigned to this Work Order.');
    });

    test('JE querying assignments without work_order_no only receives assignments for their assigned work orders', async () => {
      const req = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        query: {}
      };
      const res = mockRes();
      await getSubcontractorAssignments(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      const list = res.jsonData.assignments;
      expect(list.some(a => a.work_order_no === workOrder)).toBe(true);
      expect(list.some(a => a.work_order_no === workOrderB)).toBe(false);
    });

    test('Admin querying assignments sees all work orders', async () => {
      const req = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: {}
      };
      const res = mockRes();
      await getSubcontractorAssignments(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);
      const list = res.jsonData.assignments;
      expect(list.some(a => a.work_order_no === workOrder)).toBe(true);
      expect(list.some(a => a.work_order_no === workOrderB)).toBe(true);
    });

    test('getSubcontractors sanitizes embedded assignments by caller work-order access', async () => {
      // JE-A should only see assignments for workOrder (WO-A), not workOrderB
      const jeReq = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        query: { search: `Contractor ${suffix}` }
      };
      const jeRes = mockRes();
      await getSubcontractors(jeReq, jeRes);
      expect(jeRes.statusCode).toBe(200);
      const jeContractor = jeRes.jsonData.subcontractors.find(s => s.id === contractor.id);
      expect(jeContractor).toBeDefined();
      expect(jeContractor.subcontractor_work_assignments.some(a => a.work_order_no === workOrder)).toBe(true);
      expect(jeContractor.subcontractor_work_assignments.some(a => a.work_order_no === workOrderB)).toBe(false);

      // Admin sees assignments for both work orders
      const adminReq = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        query: { search: `Contractor ${suffix}` }
      };
      const adminRes = mockRes();
      await getSubcontractors(adminReq, adminRes);
      expect(adminRes.statusCode).toBe(200);
      const adminContractor = adminRes.jsonData.subcontractors.find(s => s.id === contractor.id);
      expect(adminContractor).toBeDefined();
      expect(adminContractor.subcontractor_work_assignments.some(a => a.work_order_no === workOrder)).toBe(true);
      expect(adminContractor.subcontractor_work_assignments.some(a => a.work_order_no === workOrderB)).toBe(true);
    });

    test('getSubcontractorById sanitizes embedded assignments by caller work-order access', async () => {
      // JE-A
      const jeReq = {
        user: { role: 'je', mobile_number: jeUserA.mobile_number },
        params: { id: contractor.id }
      };
      const jeRes = mockRes();
      await getSubcontractorById(jeReq, jeRes);
      expect(jeRes.statusCode).toBe(200);
      expect(jeRes.jsonData.subcontractor.subcontractor_work_assignments.some(a => a.work_order_no === workOrder)).toBe(true);
      expect(jeRes.jsonData.subcontractor.subcontractor_work_assignments.some(a => a.work_order_no === workOrderB)).toBe(false);

      // Admin
      const adminReq = {
        user: { role: 'admin', mobile_number: adminUser.mobile_number },
        params: { id: contractor.id }
      };
      const adminRes = mockRes();
      await getSubcontractorById(adminReq, adminRes);
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.jsonData.subcontractor.subcontractor_work_assignments.some(a => a.work_order_no === workOrder)).toBe(true);
      expect(adminRes.jsonData.subcontractor.subcontractor_work_assignments.some(a => a.work_order_no === workOrderB)).toBe(true);
    });

    test('ZO supervising multiple JEs can access assignments across all supervised work orders', async () => {
      const zoReq = {
        user: { role: 'zo', mobile_number: zoUser.mobile_number },
        query: {}
      };
      const zoRes = mockRes();
      await getSubcontractorAssignments(zoReq, zoRes);
      expect(zoRes.statusCode).toBe(200);
      const list = zoRes.jsonData.assignments;
      expect(list.some(a => a.work_order_no === workOrder)).toBe(true);
      expect(list.some(a => a.work_order_no === workOrderB)).toBe(true);
    });
  });
});
