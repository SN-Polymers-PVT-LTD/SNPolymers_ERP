import { describe, test, expect, beforeAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const mockRes = require('../../helpers/mockRes');
const requireRole = require('../../../src/middleware/requireRole');
const { requireCurrentAdmin } = require('../../../src/routes/hrEmployees.routes');
const employeeController = require('../../../src/controllers/hrEmployees.controller');
const payController = require('../../../src/controllers/hrPayStructures.controller');

describe('HR permanent pay structures (Stage 2)', () => {
  let admin;
  let nonAdmin;
  let permanentEmp;
  let casualEmp;
  const suffix = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    await requireLocalSupabase();

    // Create users
    const { data: users, error: userErr } = await supabase.from('authorised_users').insert([
      { mobile_number: `8611${suffix}`, role: 'admin', display_name: 'Pay Admin' },
      { mobile_number: `8612${suffix}`, role: 'je', display_name: 'Pay JE' }
    ]).select('id,role,mobile_number');
    if (userErr) throw userErr;

    admin = users.find(u => u.role === 'admin');
    nonAdmin = users.find(u => u.role === 'je');

    // Create a permanent employee
    const resPerm = mockRes();
    await employeeController.createEmployee({
      user: admin,
      body: {
        employee_name: `Perm Worker ${suffix}`,
        employee_category: 'SNP Permanent Factory Labour',
        department: 'Manufacturing Factory',
        joining_date: '2026-01-15',
        active_status: 'Active'
      }
    }, resPerm);
    expect(resPerm.statusCode).toBe(201);
    permanentEmp = resPerm.jsonData.employee;

    // Create a casual worker
    const resCasual = mockRes();
    await employeeController.createEmployee({
      user: admin,
      body: {
        employee_name: `Casual Worker ${suffix}`,
        employee_category: 'SNP Casual Factory Labour',
        department: 'Manufacturing Factory',
        joining_date: '2026-02-01',
        active_status: 'Active'
      }
    }, resCasual);
    expect(resCasual.statusCode).toBe(201);
    casualEmp = resCasual.jsonData.employee;
  });

  test('role gate rejects non-admin users', () => {
    const res = mockRes();
    let passed = false;
    requireRole(['admin'])({ user: nonAdmin }, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test('live role check blocks stale admin tokens', async () => {
    const res = mockRes();
    let passed = false;
    await requireCurrentAdmin({ user: { id: nonAdmin.id, role: 'admin' } }, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test('rejects pay structure creation for non-permanent categories', async () => {
    const res = mockRes();
    await payController.createPayStructure({
      user: admin,
      body: {
        employee_id: casualEmp.id,
        pay_basis: 'Monthly salary',
        guaranteed_monthly_gross: 25000,
        status: 'Draft'
      }
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.message).toContain('permanent employee categories');
  });

  test('creates draft pay structure, validates reconciliation, and activates atomically', async () => {
    // 1. Create Draft with valid component reconciliation
    const draftRes = mockRes();
    await payController.createPayStructure({
      user: admin,
      body: {
        employee_id: permanentEmp.id,
        pay_basis: 'Monthly salary',
        guaranteed_monthly_gross: 35000,
        basic_salary: 20000,
        staff_welfare: 5000,
        other_fixed_components: 10000,
        epf_enrolment: true,
        esi_enrolment: false,
        status: 'Draft'
      }
    }, draftRes);

    expect(draftRes.statusCode).toBe(201);
    expect(draftRes.jsonData.pay_structure.revision_number).toBe(1);
    expect(draftRes.jsonData.pay_structure.status).toBe('Draft');
    const rev1Id = draftRes.jsonData.pay_structure.id;

    // 2. Fetch employee pay structures
    const fetchRes = mockRes();
    await payController.getEmployeePayStructures({
      params: { employeeId: permanentEmp.id }
    }, fetchRes);
    expect(fetchRes.statusCode).toBe(200);
    expect(fetchRes.jsonData.active_structure).toBeNull();
    expect(fetchRes.jsonData.revisions).toHaveLength(1);

    // 3. Activate revision 1
    const actRes = mockRes();
    await payController.activatePayStructure({
      user: admin,
      params: { id: rev1Id }
    }, actRes);
    expect(actRes.statusCode).toBe(200);
    expect(actRes.jsonData.pay_structure.status).toBe('Active');

    // 4. Create revision 2 directly as Active -> revision 1 must become Superseded
    const rev2Res = mockRes();
    await payController.createPayStructure({
      user: admin,
      body: {
        employee_id: permanentEmp.id,
        pay_basis: 'Special package',
        guaranteed_monthly_gross: 40000,
        basic_salary: 25000,
        staff_welfare: 5000,
        other_fixed_components: 10000,
        epf_enrolment: true,
        esi_enrolment: true,
        status: 'Active'
      }
    }, rev2Res);

    expect(rev2Res.statusCode).toBe(201);
    expect(rev2Res.jsonData.pay_structure.revision_number).toBe(2);
    expect(rev2Res.jsonData.pay_structure.status).toBe('Active');

    // 5. Verify revision 1 was superseded
    const fetchAfter = mockRes();
    await payController.getEmployeePayStructures({
      params: { employeeId: permanentEmp.id }
    }, fetchAfter);
    expect(fetchAfter.jsonData.active_structure.id).toBe(rev2Res.jsonData.pay_structure.id);
    expect(fetchAfter.jsonData.revisions).toHaveLength(2);
    const rev1Reloaded = fetchAfter.jsonData.revisions.find(r => r.id === rev1Id);
    expect(rev1Reloaded.status).toBe('Superseded');

    // 6. Attempting to update superseded revision returns 409
    const editSuperseded = mockRes();
    await payController.updateDraftPayStructure({
      user: admin,
      params: { id: rev1Id },
      body: { guaranteed_monthly_gross: 50000 }
    }, editSuperseded);
    expect(editSuperseded.statusCode).toBe(409);

    // 7. Attempting to update active revision directly returns 409
    const editActive = mockRes();
    await payController.updateDraftPayStructure({
      user: admin,
      params: { id: rev2Res.jsonData.pay_structure.id },
      body: { guaranteed_monthly_gross: 50000 }
    }, editActive);
    expect(editActive.statusCode).toBe(409);
  });

  test('directory endpoint preserves privacy and does not expose compensation fields', async () => {
    const listRes = mockRes();
    await employeeController.listEmployees({
      query: { page: 1, limit: 20, search: permanentEmp.employee_code }
    }, listRes);

    expect(listRes.statusCode).toBe(200);
    const emp = listRes.jsonData.employees.find(e => e.id === permanentEmp.id);
    expect(emp).toBeDefined();
    expect(emp.salary).toBeUndefined();
    expect(emp.guaranteed_monthly_gross).toBeUndefined();
    expect(emp.basic_salary).toBeUndefined();
    expect(emp.epf_enrolment).toBeUndefined();
    expect(emp.esi_enrolment).toBeUndefined();
  });

  test('blocks employee category change to casual when pay structure exists', async () => {
    const res = mockRes();
    await employeeController.updateEmployee({
      user: admin,
      params: { id: permanentEmp.id },
      body: { employee_category: 'SNP Casual Factory Labour' }
    }, res);

    expect(res.statusCode).toBe(400);
  });
});
