import { describe, test, expect, beforeAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const mockRes = require('../../helpers/mockRes');
const requireRole = require('../../../src/middleware/requireRole');
const { requireCurrentAdmin } = require('../../../src/routes/hrEmployees.routes');
const employeeController = require('../../../src/controllers/hrEmployees.controller');
const payController = require('../../../src/controllers/hrPayStructures.controller');
const app = require('../../../src/app');
const { generateTokens } = require('../../../src/services/session.service');

async function requestRoute(method, path, token, body) {
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        ...(token ? { Cookie: `accessToken=${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function tokenFor(user) {
  const { data: session, error } = await supabase.from('sessions')
    .insert({ user_id: user.id, is_active: true }).select('id').single();
  if (error) throw error;
  return generateTokens(user, session.id, crypto.randomUUID()).accessToken;
}

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

  test('concurrent creations get distinct sequential revisions', async () => {
    const employeeRes = mockRes();
    await employeeController.createEmployee({ user: admin, body: {
      employee_name: `Concurrent Pay ${suffix}`,
      employee_category: 'HO Staff', department: 'Head Office',
      joining_date: '2026-01-15'
    } }, employeeRes);
    expect(employeeRes.statusCode).toBe(201);
    const employeeId = employeeRes.jsonData.employee.id;
    const args = {
      p_employee_id: employeeId,
      p_pay_basis: 'Monthly salary',
      p_guaranteed_monthly_gross: 10000,
      p_basic_salary: 10000,
      p_staff_welfare: null,
      p_other_fixed_components: null,
      p_epf_enrolment: false,
      p_esi_enrolment: false,
      p_status: 'Draft',
      p_actor_id: admin.id
    };
    const results = await Promise.all([
      supabase.rpc('create_hr_pay_structure', args),
      supabase.rpc('create_hr_pay_structure', args)
    ]);
    expect(results.map(r => r.error)).toEqual([null, null]);
    expect(results.map(r => r.data.revision_number).sort()).toEqual([1, 2]);
  });

  test('mounted pay and audit routes enforce roles without exposing HR values to HO', async () => {
    const employeeRes = mockRes();
    const secretName = `Private Worker ${suffix}`;
    const secretContact = `7777${suffix}`;
    await employeeController.createEmployee({ user: admin, body: {
      employee_name: secretName,
      employee_category: 'HO Staff', department: 'Head Office',
      contact_number: secretContact, joining_date: '2026-01-15'
    } }, employeeRes);
    expect(employeeRes.statusCode).toBe(201);
    const employeeId = employeeRes.jsonData.employee.id;
    const adminToken = await tokenFor(admin);
    const jeToken = await tokenFor(nonAdmin);
    const { data: hoUser, error: hoError } = await supabase.from('authorised_users')
      .insert({ mobile_number: `8613${suffix}`, role: 'ho', display_name: 'Pay HO' })
      .select('id,role,mobile_number').single();
    if (hoError) throw hoError;
    const hoToken = await tokenFor(hoUser);

    const path = `/api/v1/auth/hr/pay-structures/employees/${employeeId}`;
    expect((await requestRoute('GET', path)).status).toBe(401);
    expect((await requestRoute('GET', path, jeToken)).status).toBe(403);
    expect((await requestRoute('GET', path, hoToken)).status).toBe(403);
    expect((await requestRoute('GET', path, adminToken)).status).toBe(200);

    const created = await requestRoute('POST', '/api/v1/auth/hr/pay-structures/', adminToken, {
      employee_id: employeeId, pay_basis: 'Monthly salary',
      guaranteed_monthly_gross: 12000, basic_salary: 12000,
      epf_enrolment: true, esi_enrolment: false, status: 'Draft'
    });
    expect(created.status).toBe(201);

    const auditPath = '/api/v1/auth/analytics/audit-log?module_name=HR%20Employee%20Master';
    const hoAudit = await requestRoute('GET', auditPath, hoToken);
    expect(hoAudit.status).toBe(200);
    expect(hoAudit.body.data).toEqual([]);
    const adminAudit = await requestRoute('GET', auditPath, adminToken);
    expect(adminAudit.status).toBe(200);
    expect(adminAudit.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(adminAudit.body.data)).not.toContain(secretName);
    expect(JSON.stringify(adminAudit.body.data)).not.toContain(secretContact);

    const hoRecent = await requestRoute('GET', '/api/v1/auth/analytics/recent-activity', hoToken);
    expect(hoRecent.status).toBe(200);
    expect(hoRecent.body.activities.every(row => !String(row.module_name).startsWith('HR '))).toBe(true);
  });
});
