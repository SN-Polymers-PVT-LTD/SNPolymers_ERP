import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { Client } = require('pg');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const app = require('../../../src/app');
const { generateTokens } = require('../../../src/services/session.service');
const { requireCurrentAdmin } = require('../../../src/routes/hrEmployees.routes');
const mockRes = require('../../helpers/mockRes');

const casual = 'SNP Casual Factory Labour';
const local = 'Local Daily-Wage Workers';
const permanent = 'Fabric Factory Permanent Employees';
let year;
const prefix = '/api/v1/auth/hr/factory-masters';
const rule = (employee_category = casual, effective_from = `${year}-01-01`) => ({
  employee_category, effective_from, standard_duty_hours: 8, ot_enabled: true,
  ot_method: 'Fixed Hourly', ot_rate: 50, ot_multiplier: null,
  holiday_pay_enabled: employee_category !== local, holiday_multiplier: employee_category === local ? null : 1.5,
  management_stoppage_treatment: 'Full daily wage', short_hours_treatment: null,
  comp_off_rule: null, double_duty_multiplier: employee_category === local ? 2 : null
});
describe('FM role and effective-dated factory masters — local HTTP/DB integration', () => {
  let server; let base; let admin; let fm; let ho; let je; let accounts; let zo;
  const tokens = new Map();
  const suffix = crypto.randomUUID().slice(0, 8);
  async function tokenFor(user) {
    const { data, error } = await supabase.from('sessions').insert({ user_id: user.id, is_active: true, jwt_jti: crypto.randomUUID() }).select('id').single();
    if (error) throw error;
    return generateTokens(user, data.id, crypto.randomUUID());
  }
  async function request(method, path, token, body) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(token ? { Cookie: `accessToken=${token.accessToken}; refreshToken=${token.refreshToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    await requireLocalSupabase();
    // Preserve immutable test history while avoiding date collisions on reruns.
    const db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI });
    await db.connect();
    try {
      const { rows } = await db.query(`SELECT candidate AS year FROM generate_series(2200, 9996) candidate
        WHERE NOT EXISTS (
          SELECT 1 FROM (
            SELECT effective_from FROM hr_factory_wage_revisions
            UNION ALL SELECT effective_from FROM hr_factory_pay_rule_revisions
          ) revisions WHERE extract(year FROM effective_from) BETWEEN candidate AND candidate + 2
        ) LIMIT 1`);
      if (!rows.length) throw new Error('No unused test date range remains in the local factory masters.');
      year = Number(rows[0].year);
    } finally { await db.end(); }
    const roles = ['admin', 'factory_manager', 'ho', 'je', 'accounts', 'zo'];
    const { data, error } = await supabase.from('authorised_users').insert(roles.map((role, index) => ({
      mobile_number: `877${index}${suffix}`, role, display_name: `Factory Test ${role} ${suffix}`, is_active: true
    }))).select('*');
    if (error) throw error;
    [admin, fm, ho, je, accounts, zo] = roles.map(role => data.find(user => user.role === role));
    for (const user of data) tokens.set(user.role, await tokenFor(user));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    // Append-only HR/audit test records intentionally remain in the local stack.
  });

  test('canonical FM is accepted; display-label/unknown roles are rejected by the database', async () => {
    expect(fm.role).toBe('factory_manager');
    const { error } = await supabase.from('authorised_users').insert({ mobile_number: `878${suffix}`, role: 'Factory Manager' });
    expect(error.code).toBe('23514');
  });
  test('existing Admin API creates FM accounts and employee linking uses the same UUID', async () => {
    const number = `91${Date.now().toString().slice(-10)}`;
    const created = await request('POST', '/api/v1/auth/admin/users', tokens.get('admin'), { mobileNumber: number, displayName: 'Created FM', role: 'factory_manager' });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe('factory_manager');
    const id = created.body.user.id;
    const lookup = await request('GET', '/api/v1/auth/hr/employees/erp-users?role=factory_manager&limit=100', tokens.get('admin'));
    expect(lookup.status).toBe(200);
    expect(lookup.body.users.some(user => user.id === id)).toBe(true);
    const employee = await request('POST', '/api/v1/auth/hr/employees', tokens.get('admin'), {
      employee_name: `Linked FM ${suffix}`, employee_category: 'HO Staff', department: 'Head Office',
      joining_date: '2026-01-01', erp_user_id: id
    });
    expect(employee.status).toBe(201);
    expect(employee.body.employee.erp_user_id).toBe(id);
    expect(employee.body.employee.erp_user.role).toBe('factory_manager');
  });
  test('HTTP access matrix denies unauthenticated/JE/ZO/Accounts and makes HO read-only', async () => {
    const path = `${prefix}/wages?as_of=${year}-01-01`;
    expect((await request('GET', path)).status).toBe(401);
    for (const role of ['je', 'zo', 'accounts']) expect((await request('GET', path, tokens.get(role))).status).toBe(403);
    for (const role of ['admin', 'factory_manager', 'ho']) expect((await request('GET', path, tokens.get(role))).status).toBe(200);
    expect((await request('POST', `${prefix}/wages`, tokens.get('ho'), { employee_category: casual, effective_from: `${year}-02-01`, daily_wage: 400 })).status).toBe(403);
    for (const path of ['/admin/users', '/hr/employees', '/hr/pay-structures', '/analytics/ho/kpis', '/materials', '/estimates', '/projects']) {
      expect((await request('GET', `/api/v1/auth${path}`, tokens.get('factory_manager'))).status).toBe(403);
    }
    expect((await request('GET', '/api/v1/auth/me', tokens.get('factory_manager'))).status).toBe(200);
  });
  test('role changes revoke old access AND refresh sessions; unchanged roles preserve sessions', async () => {
    const hoToken = tokens.get('ho');
    const changed = await request('PATCH', `/api/v1/auth/admin/users/${ho.id}`, tokens.get('admin'), { role: 'factory_manager' });
    expect(changed.status).toBe(200);
    expect((await request('GET', '/api/v1/auth/analytics/ho/kpis', hoToken)).status).toBe(401);
    expect((await request('POST', '/api/v1/auth/refresh', hoToken)).status).toBe(401);
    const next = await tokenFor({ ...ho, role: 'factory_manager' });
    expect((await request('GET', `${prefix}/wages?as_of=${year}-01-01`, next)).status).toBe(200);
    expect((await request('PATCH', `/api/v1/auth/admin/users/${ho.id}`, tokens.get('admin'), { role: 'factory_manager', displayName: 'Unchanged Role' })).status).toBe(200);
    expect((await request('GET', '/api/v1/auth/me', next)).status).toBe(200);
    expect((await request('PATCH', `/api/v1/auth/admin/users/${ho.id}`, tokens.get('admin'), { isActive: false })).status).toBe(200);
    expect((await request('GET', '/api/v1/auth/me', next)).status).toBe(401);
  });
  test('failed session revocation rolls back role update atomically', async () => {
    const db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query(`CREATE FUNCTION pg_temp.reject_test_session_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test revocation failure'; END; $$`);
      await db.query(`CREATE TRIGGER test_reject_session_update BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_test_session_update()`);
      await db.query('SAVEPOINT attempted_change');
      await expect(db.query('UPDATE authorised_users SET role = $1 WHERE id = $2', ['ho', fm.id])).rejects.toThrow('test revocation failure');
      await db.query('ROLLBACK TO SAVEPOINT attempted_change');
      const { rows } = await db.query('SELECT role FROM authorised_users WHERE id = $1', [fm.id]);
      expect(rows[0].role).toBe('factory_manager');
    } finally { await db.query('ROLLBACK'); await db.end(); }
    expect((await request('GET', '/api/v1/auth/me', tokens.get('factory_manager'))).status).toBe(200);
  });
  test('live HR guard rejects stale Admin identity', async () => {
    const res = mockRes(); let passed = false;
    await requireCurrentAdmin({ user: { id: fm.id, role: 'admin' } }, res, () => { passed = true; });
    expect(passed).toBe(false); expect(res.statusCode).toBe(403);
  });
  test('masters resolve dates independently; future revisions preserve earlier IDs and derived statuses', async () => {
    const dates = [`${year}-01-01`, `${year}-07-01`];
    for (const [index, effective_from] of dates.entries()) {
      const wage = await request('POST', `${prefix}/wages`, tokens.get('factory_manager'), { employee_category: casual, effective_from, daily_wage: 400 + index * 50 });
      expect(wage.status).toBe(201);
    }
    const first = await request('POST', `${prefix}/rules`, tokens.get('factory_manager'), rule());
    expect(first.status).toBe(201);
    const second = await request('POST', `${prefix}/rules`, tokens.get('admin'), { ...rule(casual, `${year}-08-01`), standard_duty_hours: 9 });
    expect(second.status).toBe(201);
    const before = await request('GET', `${prefix}/effective?employee_category=${encodeURIComponent(casual)}&date=${year - 1}-12-31`, tokens.get('factory_manager'));
    expect(before.body.rule_revision?.effective_from === `${year}-01-01`).toBe(false);
    const current = await request('GET', `${prefix}/effective?employee_category=${encodeURIComponent(casual)}&date=${year}-07-01`, tokens.get('factory_manager'));
    expect(current.body.wage_revision.daily_wage).toBe(450);
    expect(current.body.rule_revision.id).toBe(first.body.revision.id);
    const boundary = await request('GET', `${prefix}/effective?employee_category=${encodeURIComponent(casual)}&date=${year}-08-01`, tokens.get('factory_manager'));
    expect(boundary.body.rule_revision.id).toBe(second.body.revision.id);
    const list = await request('GET', `${prefix}/rules?employee_category=${encodeURIComponent(casual)}&as_of=${year}-07-01&limit=1`, tokens.get('factory_manager'));
    expect(list.body.revisions[0].display_status).toBe('Future');
    const { count: laterRows } = await supabase.from('hr_factory_pay_rule_revisions').select('id', { count: 'exact', head: true }).eq('employee_category', casual).gt('effective_from', `${year}-01-01`);
    const page2 = await request('GET', `${prefix}/rules?employee_category=${encodeURIComponent(casual)}&as_of=${year}-07-01&limit=1&page=${laterRows + 1}`, tokens.get('factory_manager'));
    expect(page2.body.revisions[0].display_status).toBe('Current');
  });
  test('category/date uniqueness is race-safe and distinct concurrent dates get sequential revisions', async () => {
    const body = { employee_category: local, effective_from: `${year + 1}-01-01`, daily_wage: 350 };
    const attempts = await Promise.all([1, 2].map(() => request('POST', `${prefix}/wages`, tokens.get('factory_manager'), body)));
    expect(attempts.map(result => result.status).sort()).toEqual([201, 409]);
    const revisions = await Promise.all([`${year + 1}-02-01`, `${year + 1}-03-01`].map(effective_from => request('POST', `${prefix}/wages`, tokens.get('factory_manager'), { ...body, effective_from })));
    expect(revisions.every(result => result.status === 201)).toBe(true);
    expect(new Set(revisions.map(result => result.body.revision.revision_number)).size).toBe(2);
    const ruleAttempts = await Promise.all([1, 2].map(() => request('POST', `${prefix}/rules`, tokens.get('factory_manager'), rule(local, `${year + 1}-01-01`))));
    expect(ruleAttempts.map(result => result.status).sort()).toEqual([201, 409]);
  });
  test('API and DB reject invalid category/rules, forged audit fields, and duplicate sources', async () => {
    const invalid = [
      { ...rule(local, `${year + 2}-01-01`), holiday_pay_enabled: true, holiday_multiplier: 1.5 },
      { ...rule(casual, `${year + 2}-01-01`), double_duty_multiplier: 2 },
      { ...rule(), standard_duty_hours: 0 }, { ...rule(), ot_rate: null },
      { ...rule(), ot_method: 'Salary-derived hourly', ot_rate: null, ot_multiplier: 1 }
    ];
    for (const body of invalid) {
      expect((await request('POST', `${prefix}/rules`, tokens.get('factory_manager'), body)).status).toBe(400);
      const { error } = await supabase.from('hr_factory_pay_rule_revisions').insert({ ...body, created_by: fm.id });
      expect(error.code).toBe('23514');
    }
    const body = { employee_category: casual, effective_from: `${year + 2}-01-01`, daily_wage: 400 };
    for (const extra of [{ created_by: admin.id }, { standard_duty_hours: 8 }, { status: 'Active' }]) {
      expect((await request('POST', `${prefix}/wages`, tokens.get('factory_manager'), { ...body, ...extra })).status).toBe(400);
    }
    expect((await request('POST', `${prefix}/wages`, tokens.get('factory_manager'), { ...body, employee_category: permanent })).status).toBe(400);
    const { error } = await supabase.from('hr_factory_wage_revisions').insert({ ...body, created_by: je.id });
    expect(error.code).toBe('42501');
  });
  test('direct SQL rejects nonfinite wages, hours, and multipliers', async () => {
    const db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI }); await db.connect();
    try {
      await expect(db.query(`INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by)
        VALUES($1,$2,'NaN',$3)`, [casual, `${year + 2}-01-01`, fm.id])).rejects.toMatchObject({ code: '23514', constraint: 'factory_wage_finite' });
      for (const field of ['standard_duty_hours', 'ot_rate', 'ot_multiplier', 'holiday_multiplier', 'double_duty_multiplier']) {
        const body = { ...rule(field === 'double_duty_multiplier' ? local : casual, `${year + 2}-01-01`), created_by: fm.id };
        if (field === 'ot_multiplier') Object.assign(body, { ot_method: 'Derived from daily wage', ot_rate: null, ot_multiplier: 1 });
        body[field] = 'NaN';
        const { error } = await supabase.from('hr_factory_pay_rule_revisions').insert(body);
        expect(error.code).toBe('23514');
        expect(error.message).toContain('factory_rule_numbers_finite');
      }
    } finally { await db.end(); }
  });
  test('revision immutability and transactional audit; UUID and mobile actors both display names', async () => {
    const { data } = await supabase.from('hr_factory_wage_revisions').select('*').eq('created_by', fm.id).limit(1).single();
    const db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI }); await db.connect();
    try {
      await expect(db.query('UPDATE hr_factory_wage_revisions SET daily_wage = 999 WHERE id=$1', [data.id])).rejects.toThrow('immutable');
      await expect(db.query('DELETE FROM hr_factory_wage_revisions WHERE id=$1', [data.id])).rejects.toThrow('immutable');
    } finally { await db.end(); }
    const { data: audits } = await supabase.from('audit_log').select('*').eq('record_identifier', data.id);
    expect(audits).toHaveLength(1); expect(audits[0].new_value.daily_wage).toBe(Number(data.daily_wage));
    const legacyId = crypto.randomUUID();
    await supabase.from('audit_log').insert({ user_id: admin.mobile_number, action: 'TEST', module_name: 'HR Factory Wage Master', record_identifier: legacyId });
    for (const [id, name] of [[data.id, fm.display_name], [legacyId, admin.display_name]]) {
      const response = await request('GET', `/api/v1/auth/analytics/audit-log?record_identifier=${id}`, tokens.get('admin'));
      expect(response.body.data[0].user_name).toBe(name);
    }
    // HO access is through the factory masters endpoints, not the generic audit log.
    const hoRead = await tokenFor({ ...je, role: 'ho' });
    expect((await request('GET', '/api/v1/auth/analytics/ho/kpis', hoRead)).status).toBe(403);
    const guarded = await request('GET', `${prefix}/rules?as_of=${year}-01-01`, hoRead);
    expect(guarded.status).toBe(403);
  });
});
