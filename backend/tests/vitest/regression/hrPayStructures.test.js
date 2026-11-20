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
        department: 'SNP Factory',
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
        department: 'SNP Factory',
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

  async function dated(employee,from,version,gross=35000) {
    const res=mockRes();await payController.savePayrollSalary({user:admin,body:{employee_id:employee.id,existing_id:null,effective_from:from,expected_version:version,pay:{pay_basis:'Monthly salary',guaranteed_monthly_gross:gross,epf_enrolment:true,esi_enrolment:false},reason:'Confirmed dated HR salary'}},res);return res;
  }
  test('rejects dated salary creation for non-permanent categories',async()=>{
    const res=await dated(casualEmp,'2026-02-01',0);expect(res.statusCode).toBe(400);expect(res.jsonData.message).toContain('permanent employee category');
  });
  test('dated creation saves applicability and supersedes the prior HR revision atomically',async()=>{
    const first=await dated(permanentEmp,'2026-01-15',0);expect(first.statusCode).toBe(200);expect(first.jsonData.result.context.version).toBe(1);
    const firstId=first.jsonData.result.pay_structure_id;
    const second=await dated(permanentEmp,'2026-02-01',1,40000);expect(second.statusCode).toBe(200);
    const fetched=mockRes();await payController.getEmployeePayStructures({params:{employeeId:permanentEmp.id}},fetched);
    expect(fetched.jsonData.active_structure.id).toBe(second.jsonData.result.pay_structure_id);expect(fetched.jsonData.revisions.find(r=>r.id===firstId).status).toBe('Superseded');
    expect(second.jsonData.result.context.intervals).toEqual([{pay_structure_id:firstId,effective_from:'2026-01-15',effective_to:'2026-01-31'},{pay_structure_id:second.jsonData.result.pay_structure_id,effective_from:'2026-02-01',effective_to:null}]);
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

  test('undated RPC is private; concurrent dated saves cannot both claim the same timeline version',async()=>{
    const employeeRes=mockRes();await employeeController.createEmployee({user:admin,body:{employee_name:`Concurrent Pay ${suffix}`,employee_category:'HO Staff',department:'Head Office',joining_date:'2026-01-15'}},employeeRes);expect(employeeRes.statusCode).toBe(201);
    const args={p_employee_id:employeeRes.jsonData.employee.id,p_existing_id:null,p_from:'2026-01-15',p_expected_version:0,p_pay:{pay_basis:'Monthly salary',guaranteed_monthly_gross:'10000',epf_enrolment:false,esi_enrolment:false},p_reason:'Confirmed dated terms',p_actor_id:admin.id};
    const old=await supabase.rpc('create_hr_pay_structure',{p_employee_id:args.p_employee_id,p_pay_basis:'Monthly salary',p_guaranteed_monthly_gross:22000,p_epf_enrolment:false,p_esi_enrolment:false,p_status:'Active',p_actor_id:admin.id});expect(old.error?.code).toBe('42501');
    const results=await Promise.all([supabase.rpc('save_hr_payroll_salary',args),supabase.rpc('save_hr_payroll_salary',args)]);expect(results.filter(r=>!r.error)).toHaveLength(1);expect(results.find(r=>r.error).error.code).toBe('PY409');
  });

  test('mounted pay and audit routes enforce roles without exposing HR values to HO', async () => {
    const employeeRes = mockRes();
    const secretName = `Private Worker ${suffix}`;
    const secretContact = '+91 98765 43210';
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

    const old=await requestRoute('POST','/api/v1/auth/hr/pay-structures/',adminToken,{employee_id:employeeId,pay_basis:'Monthly salary',guaranteed_monthly_gross:12000});expect(old.status).toBe(404);
    const input={employee_id:employeeId,existing_id:null,effective_from:'2026-01-15',expected_version:0,pay:{pay_basis:'Monthly salary',guaranteed_monthly_gross:12000,epf_enrolment:true,esi_enrolment:false},reason:'Confirmed private salary'};
    const created=await requestRoute('POST','/api/v1/auth/hr/pay-structures/payroll-salary',adminToken,input);expect(created.status).toBe(200);
    for(const field of ['basic_salary','staff_welfare','other_fixed_components']){
      const bad=await requestRoute('POST','/api/v1/auth/hr/pay-structures/payroll-salary',adminToken,{...input,pay:{...input.pay,[field]:1000}});expect(bad.status).toBe(400);
    }
    const id=created.body.result.pay_structure_id;
    expect((await requestRoute('POST',`/api/v1/auth/hr/pay-structures/${id}/activate`,adminToken)).status).toBe(404);
    expect((await requestRoute('PATCH',`/api/v1/auth/hr/pay-structures/${id}`,adminToken,{guaranteed_monthly_gross:16000})).status).toBe(404);

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

  test('GET /api/v1/auth/hr/pay-structures lists permanent employees and their pay structures for admin only', async () => {
    const adminToken = await tokenFor(admin);
    const jeToken = await tokenFor(nonAdmin);

    const unauth = await requestRoute('GET', '/api/v1/auth/hr/pay-structures');
    expect(unauth.status).toBe(401);

    const forbidden = await requestRoute('GET', '/api/v1/auth/hr/pay-structures', jeToken);
    expect(forbidden.status).toBe(403);

    const res = await requestRoute('GET', '/api/v1/auth/hr/pay-structures', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.pay_structures)).toBe(true);
    expect(res.body.pay_structures.length).toBeGreaterThan(0);
    const item = res.body.pay_structures.find(p => p.id === permanentEmp.id);
    expect(item).toBeTruthy();
    expect(item.employee_name).toBe(permanentEmp.employee_name);
    expect(Array.isArray(item.pay_structures)).toBe(true);
  });
});
