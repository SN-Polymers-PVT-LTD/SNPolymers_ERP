import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from 'vitest';
const { Client } = require('pg');
const crypto = require('crypto');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const definitions = require('../../../../shared/hrEmployeeCategories.json');
let db, admin, fm, accounts, ho, je;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const day = '1600-10-10';
async function user(role) {
  return (await q('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING id', [String(crypto.randomInt(7000000000,9999999999)), role, `Payroll test ${role}`]))[0].id;
}
async function employee(category = 'HO Staff', department = 'Head Office') {
  return (await q(`INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by)
    VALUES('Payroll fixture',$1,$2,'1600-01-01',$3,$3) RETURNING *`, [category, department, admin]))[0];
}
async function history(e, kind, intervals, actor = admin) {
  return (await q('SELECT record_payroll_source_history($1,$2,$3,$4,$5) AS id', [e.id, kind, JSON.stringify(intervals), 'Synthetic test evidence', actor]))[0].id;
}
const assignment = (extra = {}) => ({ group_code: 'HO_STAFF', employee_category: 'HO Staff', department: 'Head Office', effective_from: '1600-10-01', effective_to: '1600-10-31', employment_joined_on: '1600-01-01', ...extra });
async function assign(e, intervals = [assignment()]) {
  const id = await history(e, 'ASSIGNMENT', intervals);
  return (await q('SELECT * FROM payroll_employee_assignments WHERE revision_id=$1 ORDER BY effective_from', [id]));
}
async function run(group = 'HO_STAFF', department = 'Head Office', actor = accounts, from = '1600-10-01', to = '1600-10-31') {
  return (await q("SELECT * FROM create_payroll_draft_run($1,$2,$3,$4,'Custom',$5)", [group, department, from, to, actor]))[0];
}
async function add(r, a, actor = accounts) {
  return (await q('SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)', [r.id, a.id, a.effective_from, a.effective_to, actor]))[0];
}
async function rejected(sql, args, code) {
  await q('SAVEPOINT invalid');
  await expect(q(sql, args)).rejects.toMatchObject({ code });
  await q('ROLLBACK TO SAVEPOINT invalid');
}
async function pay(e, gross = 1000) {
  return (await q("SELECT * FROM create_hr_pay_structure($1,'Monthly salary',$2,NULL,NULL,NULL,true,false,'Active',$3)", [e.id, gross, admin]))[0];
}
beforeAll(async () => {
  await requireLocalSupabase();
  db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI }); await db.connect();
});
afterAll(async () => { if (db) await db.end(); });
beforeEach(async () => {
  await q('BEGIN');
  admin = await user('admin'); fm = await user('factory_manager'); accounts = await user('accounts'); ho = await user('ho'); je = await user('je');
});
afterEach(async () => { await q('ROLLBACK'); });

describe('payroll Phase 1 database foundation', () => {
  test('canonical groups cover every current category/department and preserve legacy compatibility', async () => {
    const groups = await q('SELECT g.*,d.department FROM payroll_groups g JOIN payroll_group_departments d ON d.group_code=g.code');
    for (const definition of definitions) for (const department of definition.departments) {
      const group = groups.find(g => g.employee_category === definition.category && g.department === department);
      expect(group).toBeTruthy();
      const e = await employee(definition.category, department);
      const intervals = [assignment({ group_code: group.code, employee_category: definition.category, department })];
      expect((await assign(e, intervals))[0].employee_id).toBe(e.id);
    }
    expect(groups.filter(g => g.is_factory)).toHaveLength(6);
    expect(groups.find(g => g.code === 'LEGACY_PROJECTS').employee_category).toBe('Projects Department Employees');
    const e = await employee();
    for (const bad of [assignment({ department: 'SNP Factory' }), assignment({ group_code: 'SNP_PERMANENT' }), assignment({ employee_category: 'Junior Engineer' })]) {
      await rejected('SELECT record_payroll_source_history($1,$2,$3,$4,$5)', [e.id, 'ASSIGNMENT', JSON.stringify([bad]), 'Evidence', admin], '23503');
    }
  });
  test('FM has no implicit scope; grants, revocations, role changes and inactive users are current', async () => {
    await rejected("SELECT create_payroll_draft_run('SNP_LOCAL','SNP Factory',$1,$1,'Custom',$2)", [day, fm], '42501');
    await q("SELECT set_payroll_factory_scope($1,'SNP Factory',true,'Explicit factory grant',$2)", [fm, admin]);
    expect((await run('SNP_LOCAL', 'SNP Factory', fm)).created_by).toBe(fm);
    for (const [group, dept] of [['FABRIC_LOCAL', 'Fabric Factory'], ['HO_STAFF', 'Head Office']]) {
      await rejected('SELECT create_payroll_draft_run($1,$2,$3,$3,$4,$5)', [group, dept, day, 'Custom', fm], '42501');
    }
    const other = await run('FABRIC_LOCAL', 'Fabric Factory', admin);
    await rejected('SELECT get_payroll_draft_run($1,$2)', [other.id, fm], '42501');
    await rejected("SELECT set_payroll_factory_scope($1,'Fabric Factory',true,'Forged grant',$2)", [fm, accounts], '42501');
    await rejected("SELECT create_payroll_draft_run('SNP_LOCAL','SNP Factory',$1,$1,'Custom',$2)", [day, accounts], '42501');
    await rejected("SELECT create_payroll_draft_run('HO_STAFF','Head Office',$1,$1,'Custom',$2)", [day, ho], '42501');
    await q("SELECT set_payroll_factory_scope($1,'SNP Factory',false,'Revoke payroll access',$2)", [fm, admin]);
    await rejected("SELECT create_payroll_draft_run('SNP_LOCAL','SNP Factory',$1,$1,'Custom',$2)", [day, fm], '42501');
    expect((await q('SELECT get_payroll_foundation_context($1) AS data', [fm]))[0].data.groups).toHaveLength(0);
    await q('UPDATE authorised_users SET is_active=false WHERE id=$1', [accounts]);
    await rejected('SELECT get_payroll_foundation_context($1)', [accounts], '42501');
    await q("UPDATE authorised_users SET role='je' WHERE id=$1", [fm]);
    await rejected('SELECT get_payroll_foundation_context($1)', [fm], '42501');
  });
  test('historical employee UUID and dated transfers survive present-day exit; observations do not fabricate dates', async () => {
    const e = await employee('Local Daily-Wage Workers', 'SNP Factory');
    const a = await assign(e, [assignment({ group_code: 'SNP_LOCAL', employee_category: e.employee_category, department: 'SNP Factory', effective_to: '1600-10-15' }),
      assignment({ group_code: 'FABRIC_LOCAL', employee_category: e.employee_category, department: 'Fabric Factory', effective_from: '1600-10-16', employment_exited_on: '1600-10-31' })]);
    await q("UPDATE hr_employees SET department='Fabric Factory',active_status='Exited',updated_by=$1 WHERE id=$2", [admin, e.id]);
    const r = await run('SNP_LOCAL', 'SNP Factory', admin, '1600-10-01', '1600-10-15');
    const row = await add(r, a[0], admin);
    expect(row.employee_id).toBe(e.id);
    const observed = (await q('SELECT * FROM payroll_employee_observations WHERE employee_id=$1', [e.id]))[0];
    expect(observed.effective_date_known).toBe(false);
    expect(observed.old_values.department).toBe('SNP Factory');
    const candidates = (await q('SELECT get_payroll_draft_candidates($1,$2) AS data', [r.id, admin]))[0].data.candidates;
    expect(candidates[0].employee_id).toBe(e.id);
    await assign(e, [assignment({ group_code: 'FABRIC_LOCAL', employee_category: e.employee_category, department: 'Fabric Factory' })]);
    expect((await q('SELECT assignment_id FROM payroll_run_employees WHERE id=$1', [row.id]))[0].assignment_id).toBe(a[0].id);
    expect((await q('SELECT count(*) FROM payroll_employee_assignments WHERE employee_id=$1', [e.id]))[0].count).toBe('3');
    await rejected('SELECT add_payroll_draft_employee($1,$2,$3,$4,$5)', [(await run('SNP_LOCAL', 'SNP Factory', admin)).id, a[0].id, a[0].effective_from, a[0].effective_to, admin], 'PY409');
  });
  test('retired Projects history survives specific-category reclassification without replacing identity or pay', async () => {
    // Simulate a pre-103 employee within this rolled-back transaction.
    await q('ALTER TABLE hr_employees DISABLE TRIGGER hr_employee_department_guard');
    const e = await employee('Projects Department Employees', 'Projects');
    await q('ALTER TABLE hr_employees ENABLE TRIGGER hr_employee_department_guard');
    const salary = await pay(e);
    const legacy = (await assign(e, [assignment({ group_code: 'LEGACY_PROJECTS', employee_category: e.employee_category, department: 'Projects' })]))[0];
    await q("UPDATE hr_employees SET employee_category='Junior Engineer',updated_by=$1 WHERE id=$2", [admin, e.id]);
    const r = await run('LEGACY_PROJECTS', 'Projects');
    expect((await add(r, legacy)).employee_id).toBe(e.id);
    expect((await q('SELECT employee_code FROM hr_employees WHERE id=$1', [e.id]))[0].employee_code).toBe(e.employee_code);
    expect((await q('SELECT employee_id FROM hr_permanent_pay_structures WHERE id=$1', [salary.id]))[0].employee_id).toBe(e.id);
    expect((await q('SELECT employee_category FROM payroll_employee_assignments WHERE id=$1', [legacy.id]))[0].employee_category).toBe('Projects Department Employees');
  });
  test('salary revisions remain undated until evidenced; application timelines preserve old rates and enrolment flags', async () => {
    const e = await employee(); const old = await pay(e); const next = await pay(e, 1200);
    expect((await q('SELECT count(*) FROM payroll_permanent_pay_applicability WHERE employee_id=$1', [e.id]))[0].count).toBe('0');
    const intervals = [{ pay_structure_id: old.id, effective_from: '1600-10-01', effective_to: '1600-10-15' }, { pay_structure_id: next.id, effective_from: '1600-10-16', effective_to: '1600-10-31' }];
    const revision = await history(e, 'PERMANENT_PAY', intervals);
    expect((await q('SELECT count(*) FROM payroll_permanent_pay_applicability WHERE revision_id=$1', [revision]))[0].count).toBe('2');
    expect((await q('SELECT status,epf_enrolment,esi_enrolment FROM hr_permanent_pay_structures WHERE id=$1', [old.id]))[0]).toEqual({ status: 'Superseded', epf_enrolment: true, esi_enrolment: false });
    await rejected('SELECT record_payroll_source_history($1,$2,$3,$4,$5)', [e.id, 'PERMANENT_PAY', JSON.stringify([{ ...intervals[0], effective_to: '1600-09-30' }]), 'Evidence', admin], '23514');
    await rejected('SELECT record_payroll_source_history($1,$2,$3,$4,$5)', [e.id, 'PERMANENT_PAY', JSON.stringify([intervals[0], { ...intervals[1], effective_from: '1600-10-15' }]), 'Evidence', admin], '23P01');
    const different = await employee();
    await rejected('SELECT record_payroll_source_history($1,$2,$3,$4,$5)', [different.id, 'PERMANENT_PAY', JSON.stringify(intervals), 'Evidence', admin], '23503');
    await rejected('SELECT record_payroll_source_history($1,$2,$3,$4,$5)', [e.id, 'PERMANENT_PAY', JSON.stringify(intervals), 'Evidence', fm], '42501');
    await history(e, 'PERMANENT_PAY', intervals);
    expect((await q('SELECT count(*) FROM payroll_source_history_revisions WHERE employee_id=$1', [e.id]))[0].count).toBe('2');
  });
  test('invalid intervals, assignment overlaps, employee duplicates and cross-scope rows fail atomically', async () => {
    const e = await employee(); const a = (await assign(e))[0]; const r = await run();
    await rejected('SELECT record_payroll_source_history($1,$2,$3,$4,$5)', [e.id, 'ASSIGNMENT', JSON.stringify([assignment(), assignment()]), 'Evidence', admin], '23P01');
    expect((await q('SELECT count(*) FROM payroll_source_history_revisions WHERE employee_id=$1', [e.id]))[0].count).toBe('1');
    await rejected("SELECT create_payroll_draft_run('HO_STAFF','Head Office','1600-10-31','1600-10-01','Custom',$1)", [accounts], '23514');
    await rejected("SELECT create_payroll_draft_run('HO_STAFF','Projects',$1,$1,'Custom',$2)", [day, accounts], '23503');
    await rejected('SELECT add_payroll_draft_employee($1,$2,$3,$4,$5)', [r.id, a.id, '1600-09-30', a.effective_to, accounts], '23514');
    await add(r, a);
    await rejected('SELECT add_payroll_draft_employee($1,$2,$3,$4,$5)', [r.id, a.id, a.effective_from, a.effective_to, accounts], '23505');
    const b = await user('accounts');
    await rejected('SELECT add_payroll_draft_employee($1,$2,$3,$4,$5)', [r.id, a.id, a.effective_from, a.effective_to, b], '42501');
    const foreign = await run('FABRIC_LOCAL', 'Fabric Factory', admin);
    await rejected('SELECT add_payroll_draft_employee($1,$2,$3,$4,$5)', [foreign.id, a.id, a.effective_from, a.effective_to, admin], '23514');
  });
  test('row version compare-and-swap appends history and never accepts finalization or deletes', async () => {
    const e = await employee(); const a = (await assign(e))[0]; const r = await run(); const row = await add(r, a);
    const updated = (await q('SELECT * FROM revise_payroll_draft_note($1,1,$2,$3)', [row.id, 'Source requires review', accounts]))[0];
    expect(updated.current_version).toBe(2);
    await rejected('SELECT revise_payroll_draft_note($1,1,$2,$3)', [row.id, 'Stale note', accounts], 'PY409');
    const data = (await q('SELECT get_payroll_draft_run($1,$2) AS data', [r.id, ho]))[0].data;
    expect(data.rows[0].versions.map(v => v.version)).toEqual([1, 2]);
    expect(data.financial_workflows_enabled).toBe(false);
    for (const table of ['payroll_runs','payroll_run_employees','payroll_row_versions','payroll_source_history_revisions','payroll_employee_assignments','payroll_action_history']) {
      await rejected(`DELETE FROM ${table}`, [], '42501');
    }
    await rejected("UPDATE payroll_run_employees SET status='LOCKED' WHERE id=$1", [row.id], '42501');
    await rejected("UPDATE payroll_row_versions SET note='Rewritten' WHERE row_id=$1", [row.id], '42501');
    await rejected('INSERT INTO payroll_employee_coverage(employee_id,salary_row_id,period_from,period_to,finalized_at) VALUES($1,$2,$3,$3,now())', [e.id, row.id, day], '42501');
    await rejected("INSERT INTO payroll_employee_month_entitlements(employee_id,salary_month,contractual_gross) VALUES($1,'1600-10-01',1000)", [e.id], '42501');
    await rejected('INSERT INTO payroll_month_allocations(entitlement_id,salary_row_id,base_amount) VALUES($1,$2,1000)', [crypto.randomUUID(), row.id], '42501');
  });
  test('browser and service roles cannot directly access history or bypass payroll RPCs', async () => {
    const e = await employee(); await assign(e);
    for (const role of ['anon','authenticated','service_role']) {
      await q(`SET LOCAL ROLE ${role}`);
      await rejected('SELECT * FROM payroll_employee_assignments', [], '42501');
      await rejected('DELETE FROM payroll_action_history', [], '42501');
      await rejected('SELECT payroll_append_draft_version($1,$2,$3)', [crypto.randomUUID(), 'Forged source', admin], '42501');
      if (role !== 'service_role') await rejected('SELECT get_payroll_foundation_context($1)', [admin], '42501');
      await q('RESET ROLE');
    }
    await q('SET LOCAL ROLE service_role');
    expect((await q('SELECT get_payroll_foundation_context($1) AS data', [admin]))[0].data.groups).toHaveLength(13);
    await rejected('SELECT get_payroll_foundation_context($1)', [je], '42501');
    await q('RESET ROLE');
    const flags = await q("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'payroll_%' AND relkind='r'");
    expect(flags.every(f => f.relrowsecurity)).toBe(true);
  });
  test('draft source links consume only Locked scoped attendance and finalized leave without changing facts', async () => {
    await q("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'", [admin]);
    const e = await employee('SNP Casual Factory Labour', 'SNP Factory');
    const a = (await assign(e, [assignment({ group_code: 'SNP_CASUAL', employee_category: e.employee_category, department: e.department, effective_from: day, effective_to: day })]))[0];
    await q(`INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by) VALUES($1,'1600-01-01',400,$2)`, [e.employee_category, admin]);
    await q(`INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,holiday_pay_enabled,management_stoppage_treatment,created_by)
      VALUES($1,'1600-01-01',8,true,'Fixed Hourly',50,false,'Recorded policy',$2)`, [e.employee_category, admin]);
    const leave = (await q("SELECT * FROM save_hr_leave_request(NULL,$1,'FACTORY_MANAGER',$2,$2,'Medical Leave','Synthetic source','Pending',$3)", [e.id, day, admin]))[0];
    const sheet = (await q('SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)', [day, e.employee_category, admin, e.department]))[0];
    const r = await run('SNP_CASUAL', 'SNP Factory', admin, day, day); const row = await add(r, a, admin);
    expect((await q('SELECT count(*) FROM payroll_source_links WHERE row_id=$1', [row.id]))[0].count).toBe('0');
    await q("SELECT decide_hr_leave_request($1,'Approved','Paid',NULL,$2)", [leave.id, ho]);
    await q("SELECT transition_hr_attendance_sheet($1,'submit',NULL,$2)", [sheet.id, admin]);
    await q("SELECT transition_hr_attendance_sheet($1,'review',NULL,$2)", [sheet.id, ho]);
    const before = (await q('SELECT to_jsonb(s) AS value FROM hr_attendance_sheets s WHERE id=$1', [sheet.id]))[0].value;
    await q("SELECT revise_payroll_draft_note($1,1,'Final sources now available',$2)", [row.id, admin]);
    const sources = await q('SELECT * FROM payroll_source_links WHERE row_id=$1 AND row_version=2', [row.id]);
    expect(sources.filter(s => s.attendance_row_id)).toHaveLength(1);
    expect(sources.filter(s => s.leave_request_id)).toHaveLength(1);
    expect(sources.filter(s => s.wage_revision_id)).toHaveLength(1);
    expect((await q('SELECT to_jsonb(s) AS value FROM hr_attendance_sheets s WHERE id=$1', [sheet.id]))[0].value).toEqual(before);
    expect((await q('SELECT approval_status FROM hr_leave_requests WHERE id=$1', [leave.id]))[0].approval_status).toBe('Approved');
    await rejected('UPDATE payroll_source_links SET attendance_row_id=NULL WHERE row_id=$1', [row.id], '42501');
  });
  test('direct policy publication stays forbidden; invalid divisors and calendar activation remain blocked', async () => {
    // Phase 2 adds controlled master publication, while financial gates stay intact.
    const beforeCount = (await q('SELECT count(*) FROM payroll_policy_master_revisions'))[0].count;
    await rejected(`INSERT INTO payroll_policy_master_revisions(effective_from,effective_to,status,monthly_entitlement_method,lop_method,lop_fixed_divisor,reason,created_by)
      VALUES('1600-10-01','1600-10-31','PUBLISHED','CONTRACTUAL_MONTHLY_GROSS','FIXED_DIVISOR',30,'Not enabled',$1)`, [admin], '42501');
    await rejected(`INSERT INTO payroll_policy_master_revisions(effective_from,effective_to,monthly_entitlement_method,lop_method,lop_fixed_divisor,reason,created_by)
      VALUES('1600-10-01','1600-10-31','CONTRACTUAL_MONTHLY_GROSS','FIXED_DIVISOR',0,'Invalid divisor',$1)`, [admin], '22023');
    expect((await q('SELECT count(*) FROM payroll_policy_master_revisions'))[0].count).toBe(beforeCount);
    expect((await q("SELECT count(*) FROM payroll_work_calendar_days WHERE status<>'DRAFT'"))[0].count).toBe('0');
  });
});

// Exercise the exact production exclusion/unique indexes on an isolated LIKE
// copy. Phase 1 posting gates remain enabled on real tables throughout.
describe('future finalized coverage and month ledger constraints', () => {
  test('two PostgreSQL connections cannot commit overlapping employee coverage', async () => {
    const name = `payroll_test_${crypto.randomBytes(5).toString('hex')}`;
    const c1 = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI });
    const c2 = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI });
    await c1.connect(); await c2.connect();
    try {
      await c1.query(`CREATE SCHEMA ${name}`);
      await c1.query(`CREATE TABLE ${name}.coverage (LIKE public.payroll_employee_coverage INCLUDING ALL)`);
      await c1.query(`CREATE TABLE ${name}.months (LIKE public.payroll_employee_month_entitlements INCLUDING ALL)`);
      const employeeId = crypto.randomUUID();
      const insert = (c, from, to, e = employeeId) => c.query(`INSERT INTO ${name}.coverage(employee_id,salary_row_id,period_from,period_to,finalized_at) VALUES($1,$2,$3,$4,now())`, [e, crypto.randomUUID(), from, to]);
      await c1.query('BEGIN'); await c2.query('BEGIN');
      await insert(c1, '1600-10-01', '1600-10-15');
      const pid = (await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = insert(c2, '1600-10-15', '1600-10-31').then(() => ({ success: true }), error => ({ code: error.code }));
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        blocked = (await c1.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])).rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      await c1.query('COMMIT');
      expect(await pending).toEqual({ code: '23P01' });
      await c2.query('ROLLBACK');
      await insert(c2, '1600-10-16', '1600-10-31');
      await insert(c2, '1600-10-01', '1600-10-31', crypto.randomUUID());
      await c1.query(`INSERT INTO ${name}.months(employee_id,salary_month) VALUES($1,'1600-10-01')`, [employeeId]);
      await expect(c2.query(`INSERT INTO ${name}.months(employee_id,salary_month) VALUES($1,'1600-10-01')`, [employeeId])).rejects.toMatchObject({ code: '23505' });
      expect((await c1.query(`SELECT count(*) FROM ${name}.coverage`)).rows[0].count).toBe('3');
    } finally {
      await c1.query('ROLLBACK'); await c2.query('ROLLBACK');
      await c1.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
      await c1.end(); await c2.end();
    }
  });
});

describe('Phase 1 carryover hardening',()=>{
 test('ongoing history is explicit, remains nonoverlapping, and resolves finite draft periods',async()=>{
  const e=await employee(),a=(await assign(e,[assignment({effective_to:null})]))[0];expect(a.effective_to).toBeNull();
  const r=await run();const row=(await q('SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[r.id,a.id,r.period_from,r.period_to,accounts]))[0];expect(row.employee_id).toBe(e.id);
  const candidates=(await q('SELECT get_payroll_draft_candidates($1,$2) data',[r.id,accounts]))[0].data.candidates;expect(candidates.find(c=>c.employee_id===e.id).payable_to).toBe('1600-10-31');
  await rejected('SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[e.id,'ASSIGNMENT',JSON.stringify([assignment({effective_to:null}),assignment({effective_from:'1600-11-01',effective_to:null})]),'Synthetic overlap',admin],'23P01');
  await rejected('SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[e.id,'ASSIGNMENT',JSON.stringify([assignment({effective_to:null,employment_exited_on:'1600-10-31'})]),'Known exit',admin],'23514');
  const salary=await pay(e);await history(e,'PERMANENT_PAY',[{pay_structure_id:salary.id,effective_from:'1600-10-01',effective_to:null}]);
  expect((await q('SELECT effective_to FROM payroll_permanent_pay_applicability WHERE employee_id=$1',[e.id]))[0].effective_to).toBeNull();
 });
 test('both factory grants require explicit regrant after inactivity or a role round trip',async()=>{
  for(const department of ['SNP Factory','Fabric Factory'])await q('SELECT set_payroll_factory_scope($1,$2,true,$3,$4)',[fm,department,'Explicit synthetic grant',admin]);
  await q('UPDATE authorised_users SET is_active=false WHERE id=$1',[fm]);await q('UPDATE authorised_users SET is_active=true WHERE id=$1',[fm]);
  expect((await q('SELECT get_payroll_foundation_context($1) data',[fm]))[0].data.groups).toHaveLength(0);
  for(const department of ['SNP Factory','Fabric Factory'])await q('SELECT set_payroll_factory_scope($1,$2,true,$3,$4)',[fm,department,'Explicit regrant',admin]);
  await q("UPDATE authorised_users SET role='je' WHERE id=$1",[fm]);await q("UPDATE authorised_users SET role='factory_manager' WHERE id=$1",[fm]);
  expect((await q('SELECT get_payroll_foundation_context($1) data',[fm]))[0].data.groups).toHaveLength(0);
  expect((await q("SELECT count(*) FROM payroll_factory_scope_events WHERE user_id=$1 AND event_source='ACCOUNT_ACCESS_CHANGE'",[fm]))[0].count).toBe('4');
 });
 test('exact allocation ownership foreign keys reject cross-employee rows on a temporary copy while real posting stays disabled',async()=>{
  const e=await employee(),other=await employee(),a=(await assign(e))[0],b=(await assign(other))[0],r=await run(),one=await add(r,a),two=await add(r,b);
  await q('CREATE TEMP TABLE review_entitlements (LIKE payroll_employee_month_entitlements INCLUDING ALL)');
  await q('CREATE TEMP TABLE review_allocations (LIKE payroll_month_allocations INCLUDING ALL)');
  await q('CREATE TEMP TABLE review_rows (LIKE payroll_run_employees INCLUDING ALL)');
  await q('INSERT INTO review_rows SELECT * FROM payroll_run_employees WHERE id=ANY($1::uuid[])',[[one.id,two.id]]);
  const constraints=await q("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='payroll_month_allocations'::regclass AND conname IN ('payroll_allocation_entitlement_employee','payroll_allocation_row_employee')");expect(constraints).toHaveLength(2);
  for(const c of constraints)await q('ALTER TABLE review_allocations ADD '+c.definition.replace('payroll_employee_month_entitlements','review_entitlements').replace('payroll_run_employees','review_rows'));
  const month=(await q("INSERT INTO review_entitlements(employee_id,salary_month) VALUES($1,'1600-10-01') RETURNING id",[e.id]))[0].id;
  await q('INSERT INTO review_allocations(entitlement_id,salary_row_id,employee_id,base_amount) VALUES($1,$2,$3,0)',[month,one.id,e.id]);
  await rejected('INSERT INTO review_allocations(entitlement_id,salary_row_id,employee_id,base_amount) VALUES($1,$2,$3,0)',[month,two.id,e.id],'23503');
  await rejected('INSERT INTO review_allocations(entitlement_id,salary_row_id,employee_id,base_amount) VALUES($1,$2,$3,0)',[month,two.id,other.id],'23503');
  await rejected('INSERT INTO payroll_month_allocations(entitlement_id,salary_row_id,employee_id,base_amount) VALUES($1,$2,$3,0)',[month,one.id,e.id],'42501');
 });
});
