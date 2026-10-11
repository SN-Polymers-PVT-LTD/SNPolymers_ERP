import { beforeAll, afterAll, describe, test, expect } from 'vitest';
const { Client } = require('pg');
const crypto = require('crypto');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { generateTokens } = require('../../../src/services/session.service');
const app = require('../../../src/app');
let db, server, base, employeeId, assignmentId, officeRun, row, factoryRun;
const users = {}, tokens = {};
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const prefix = '/api/v1/auth/hr/payroll';
async function request(method, path, role = 'admin', body) {
  const res = await fetch(`${base}${prefix}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(tokens[role] ? { Cookie: `accessToken=${tokens[role]}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
}
const office = { group_code: 'HO_STAFF', department: 'Head Office', period_from: '1700-10-01', period_to: '1700-10-31', cycle: 'Custom' };
beforeAll(async () => {
  await requireLocalSupabase(); db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI }); await db.connect();
  for (const role of ['admin','accounts','ho','factory_manager','je','zo']) {
    const u = (await q('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING *', [String(crypto.randomInt(7000000000,9999999999)), role, `Payroll HTTP ${role}`]))[0];
    users[role] = u.id;
    const session = (await q('INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id', [u.id, crypto.randomUUID()]))[0];
    tokens[role] = generateTokens(u, session.id, crypto.randomUUID()).accessToken;
  }
  employeeId = (await q(`INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by)
    VALUES('Payroll HTTP employee','HO Staff','Head Office','1700-01-01',$1,$1) RETURNING id`, [users.admin]))[0].id;
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) {
    if (employeeId) await q("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=$2", [users.admin, employeeId]);
    await q('UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])', [Object.values(users)]); await db.end();
  }
});
describe('payroll foundation HTTP and PostgreSQL boundary', () => {
  test('current roles and explicit factory grants control reads and draft creation', async () => {
    expect((await request('GET', '/context', 'anonymous')).status).toBe(401);
    for (const role of ['je','zo']) expect((await request('GET','/context',role)).status).toBe(403);
    expect((await request('GET','/context','factory_manager')).body.context.groups).toHaveLength(0);
    const scope = { user_id: users.factory_manager, department: 'SNP Factory', allowed: true, reason: 'Synthetic payroll authorization' };
    expect((await request('POST','/factory-scopes','accounts',scope)).status).toBe(403);
    expect((await request('POST','/factory-scopes','admin',scope)).status).toBe(201);
    const factory = { ...office, group_code: 'SNP_LOCAL', department: 'SNP Factory' };
    const created = await request('POST','/runs','factory_manager',factory); expect(created.status).toBe(201); factoryRun = created.body.run;
    expect((await request('POST','/runs','factory_manager',{ ...factory, group_code: 'FABRIC_LOCAL', department: 'Fabric Factory' })).status).toBe(403);
    expect((await request('POST','/runs','factory_manager',office)).status).toBe(403);
    expect((await request('POST','/runs','ho',office)).status).toBe(403);
    expect((await request('POST','/runs','accounts',factory)).status).toBe(403);
    officeRun = (await request('POST','/runs','accounts',office)).body.run;
    expect(officeRun.created_by).toBe(users.accounts);
    expect((await request('GET',`/runs/${officeRun.id}`,'factory_manager')).status).toBe(403);
    expect((await request('GET',`/runs/${factoryRun.id}`,'accounts')).status).toBe(200);
  });
  test('Admin records historical dates; unknown sources remain empty and monetary/actor overrides are rejected', async () => {
    const history = { employee_id: employeeId, kind: 'ASSIGNMENT', evidence_reference: 'Synthetic dated personnel evidence', intervals: [{ group_code: 'HO_STAFF', employee_category: 'HO Staff', department: 'Head Office', effective_from: office.period_from, effective_to: office.period_to, employment_joined_on: '1700-01-01' }] };
    expect((await request('POST','/source-history','accounts',history)).status).toBe(403);
    expect((await request('POST','/source-history','admin',{ ...history, actor_id: users.ho })).status).toBe(400);
    const result = await request('POST','/source-history','admin',history); expect(result.status).toBe(201);
    const source = await request('GET',`/employees/${employeeId}/source-history`);
    assignmentId = source.body.history.revisions[0].assignments[0].id;
    expect(source.body.history.revisions[0].created_by).toBe(users.admin);
    const selected = await request('GET',`/runs/${officeRun.id}/candidates`,'accounts');
    expect(selected.body.selection.candidates[0].pay_applicability).toEqual([]);
    expect(selected.body.selection.candidates[0].readiness).toBe('NOT_CALCULATED');
    for (const extra of [{ status: 'LOCKED' }, { created_by: users.ho }, { epf_amount: 100 }, { net_salary: 1000 }]) {
      expect((await request('POST','/runs','accounts',{ ...office, ...extra })).status).toBe(400);
    }
    const payload = { assignment_id: assignmentId, period_from: office.period_from, period_to: office.period_to };
    const added = await request('POST',`/runs/${officeRun.id}/employees`,'accounts',payload); expect(added.status).toBe(201); row = added.body.row;
    expect((await request('POST',`/runs/${officeRun.id}/employees`,'accounts',payload)).status).toBe(409);
    expect((await request('GET',`/runs/${officeRun.id}?limit=1&page=1`,'ho')).body.draft.rows).toHaveLength(1);
    expect((await request('GET',`/runs/${officeRun.id}?page=100001`,'ho')).status).toBe(400);
  });
  test('concurrent note updates use compare-and-swap; persisted audit and bank state remain consistent', async () => {
    const banks = await q('SELECT id,available_balance FROM bank_balance_master ORDER BY id');
    const beforeAccounts = (await q('SELECT count(*) FROM acct_requisition_line_items'))[0].count;
    const updates = await Promise.all(['A','B'].map(note => request('PATCH',`/rows/${row.id}/note`,'accounts',{ expected_version: 1, note })));
    expect(updates.map(r => r.status).sort()).toEqual([200,409]);
    const data = (await request('GET',`/runs/${officeRun.id}`,'ho')).body.draft;
    expect(data.rows[0].versions).toHaveLength(2);
    expect(data.financial_workflows_enabled).toBe(false);
    expect((await q('SELECT count(*) FROM payroll_action_history WHERE row_id=$1',[row.id]))[0].count).toBe('2');
    expect((await q('SELECT count(*) FROM payroll_employee_coverage WHERE salary_row_id=$1',[row.id]))[0].count).toBe('0');
    expect(await q('SELECT id,available_balance FROM bank_balance_master ORDER BY id')).toEqual(banks);
    expect((await q('SELECT count(*) FROM acct_requisition_line_items'))[0].count).toBe(beforeAccounts);
    expect((await request('PATCH',`/rows/${row.id}/note`,'accounts',{ expected_version: 2, note: '', esi_amount: 100 })).status).toBe(400);
    const response = await fetch(`${base}${prefix}/rows/${row.id}/lock`,{method:'POST',headers:{Cookie:`accessToken=${tokens.ho}`,'Content-Type':'application/json'},body:'{}'});
    expect(response.status).toBe(404);
  });
  test('revoking a factory grant and changing an account role invalidate live access', async () => {
    expect((await request('POST','/factory-scopes','admin',{ user_id: users.factory_manager, department: 'SNP Factory', allowed: false, reason: 'Synthetic grant revoked' })).status).toBe(201);
    expect((await request('GET',`/runs/${factoryRun.id}`,'factory_manager')).status).toBe(403);
    await q("UPDATE authorised_users SET role='je' WHERE id=$1",[users.accounts]);
    expect([401,403]).toContain((await request('GET',`/runs/${officeRun.id}`,'accounts')).status);
  });
});
