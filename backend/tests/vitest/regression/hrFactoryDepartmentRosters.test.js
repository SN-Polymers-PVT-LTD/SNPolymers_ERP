import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from 'vitest';
const { Client } = require('pg');
const crypto = require('crypto');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const definitions = require('../../../../shared/hrEmployeeCategories.json');
let db, actor, ho;
const day = '1899-10-10';
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const employee = async (category, department) => (await q(`INSERT INTO hr_employees
  (employee_name,employee_category,department,joining_date,created_by,updated_by)
  VALUES ('Roster mapping test',$1,$2,'1899-01-01',$3,$3) RETURNING *`, [category, department, actor]))[0];
const sheet = async (category, department, date = day) => (await q('SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)', [date, category, actor, department]))[0];
const members = async id => (await q('SELECT employee_id FROM hr_attendance_rows WHERE sheet_id=$1', [id])).map(row => row.employee_id);
async function rejected(sql, args, code) {
  await q('SAVEPOINT invalid');
  await expect(q(sql, args)).rejects.toMatchObject({ code });
  await q('ROLLBACK TO SAVEPOINT invalid');
}
async function rule(category, local = false) {
  return (await q(`INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,
    ot_enabled,ot_method,ot_rate,holiday_pay_enabled,holiday_multiplier,double_duty_multiplier,management_stoppage_treatment,created_by)
    VALUES ($1,'1899-01-01',$2,true,'Fixed Hourly',50,$3,$4,$5,'Recorded policy',$6) RETURNING *`,
  [category,local ? 12 : 8,!local,local ? null : 1.5,local ? 2 : null,actor]))[0];
}
async function save(sheetId, employeeId, patch) {
  return (await q('SELECT * FROM save_hr_attendance_rows($1,$2,$3)', [sheetId, JSON.stringify([{ employee_id: employeeId, ...patch }]), actor]))[0];
}
beforeAll(async () => {
  await requireLocalSupabase();
  db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI });
  await db.connect();
});
afterAll(async () => { if (db) await db.end(); });
beforeEach(async () => {
  await q('BEGIN');
  actor = (await q("INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,'admin','Factory mapping test',true) RETURNING id", [String(crypto.randomInt(7000000000,9999999999))]))[0].id;
  await q("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'",[actor]);
  ho = (await q("INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,'ho','Factory mapping reviewer',true) RETURNING id", [String(crypto.randomInt(7000000000,9999999999))]))[0].id;
});
afterEach(async () => { await q('ROLLBACK'); });

describe('category and department mapping with six factory rosters', () => {
  test('accepts the complete mapping and rejects wrong departments and legacy onboarding', async () => {
    for (const item of definitions) {
      for (const department of item.departments) {
        const e = await employee(item.category,department);
        expect(e.department).toBe(department);
      }
    }
    await rejected(`INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by)
      VALUES ('Invalid mapping','HO Staff','SNP Factory','1899-01-01',$1,$1)`, [actor], '23514');
    const e = await employee('SNP Casual Factory Labour','SNP Factory');
    await rejected("UPDATE hr_employees SET department='Projects',updated_by=$1 WHERE id=$2", [actor,e.id], '23514');
  });
  test('new employees cannot use the retired Projects category', async () => {
    await rejected(`INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by)
      VALUES ('Legacy','Projects Department Employees','Projects','1899-01-01',$1,$1)`, [actor], '23514');
  });
  test('specific Projects categories cannot move back to the retired category', async () => {
    const e = await employee('Junior Engineer','Projects');
    await rejected("UPDATE hr_employees SET employee_category='Projects Department Employees',updated_by=$1 WHERE id=$2",[actor,e.id],'23514');
    expect((await q('SELECT employee_category FROM hr_employees WHERE id=$1',[e.id]))[0].employee_category).toBe('Junior Engineer');
  });
  async function legacyEmployee() {
    // Simulate a pre-102 employee; trigger changes and fixtures are rolled back after the test.
    await q('ALTER TABLE hr_employees DISABLE TRIGGER hr_employee_department_guard');
    const e = await employee('Projects Department Employees','Projects');
    await q('ALTER TABLE hr_employees ENABLE TRIGGER hr_employee_department_guard');
    return e;
  }
  test('existing legacy Projects employees can move to a specific category', async () => {
    const e = await legacyEmployee();
    const updated = (await q("UPDATE hr_employees SET employee_category='Junior Engineer',updated_by=$1 WHERE id=$2 RETURNING *",[actor,e.id]))[0];
    expect(updated.employee_category).toBe('Junior Engineer');
    expect(updated.id).toBe(e.id);
    expect(updated.employee_code).toBe(e.employee_code);
  });
  test('existing legacy Projects employees retain unrelated edits, including full-form category payloads', async () => {
    const e = await legacyEmployee();
    const updated = (await q("UPDATE hr_employees SET employee_name='Confirmed name',employee_category='Projects Department Employees',updated_by=$1 WHERE id=$2 RETURNING *",[actor,e.id]))[0];
    expect(updated.employee_name).toBe('Confirmed name');
    expect(updated.employee_category).toBe('Projects Department Employees');
  });
  test('creates six distinct rosters and refreshes only the selected factory', async () => {
    const groups = definitions.filter(item => item.type !== 'office').flatMap(item => item.departments.map(department => ({ category: item.category, department })));
    const ids = [];
    for (const group of groups) {
      const e = await employee(group.category,group.department);
      const s = await sheet(group.category,group.department);
      ids.push(s.id);
      expect(s.department).toBe(group.department);
      expect(await members(s.id)).toContain(e.id);
      expect((await sheet(group.category,group.department)).id).toBe(s.id);
    }
    expect(new Set(ids).size).toBe(6);
    const fabric = await sheet('Local Daily-Wage Workers','Fabric Factory');
    const snp = await sheet('Local Daily-Wage Workers','SNP Factory');
    const later = await employee('Local Daily-Wage Workers','Fabric Factory');
    await sheet('Local Daily-Wage Workers','Fabric Factory');
    expect(await members(fabric.id)).toContain(later.id);
    expect(await members(snp.id)).not.toContain(later.id);
    await rejected('SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)', [day,'Fabric Factory Casual Factory Labour',actor,'SNP Factory'], '22023');
    await rejected(`INSERT INTO hr_attendance_rows(sheet_id,employee_id,created_by,updated_by) VALUES($1,$2,$3,$3)`, [snp.id,later.id,actor], '23505');
  });
  test('both Casual categories resolve wages, compute OT, and enforce the same leave behavior', async () => {
    for (const [category,department] of [['Fabric Factory Casual Factory Labour','Fabric Factory'],['SNP Casual Factory Labour','SNP Factory']]) {
      const r = await rule(category);
      const w = (await q(`INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by)
        VALUES($1,'1899-01-01',400,$2) RETURNING *`, [category,actor]))[0];
      const e = await employee(category,department);
      const s = await sheet(category,department);
      const row = await save(s.id,e.id,{ attendance_status:'Present',entry_timestamp:`${day}T08:00:00+05:30`,exit_timestamp:`${day}T18:00:00+05:30`,holiday_pay_eligible:true });
      expect(Number(row.actual_hours)).toBe(10);
      expect(Number(row.ot_hours)).toBe(2);
      expect(row.pay_rule_revision_id).toBe(r.id);
      expect(row.wage_revision_id).toBe(w.id);
      await rejected('SELECT * FROM save_hr_attendance_rows($1,$2,$3)', [s.id,JSON.stringify([{ employee_id:e.id,duty_type:'Double Duty' }]),actor], 'P0001');
      const l = (await q('SELECT * FROM save_hr_factory_attendance_leave($1,$2,NULL,$3,$3,$4,$5,$6,$7)', [s.id,e.id,day,'Paid Leave','Leave parity','Pending',actor]))[0];
      expect(l.employee_category).toBe(category);
    }
  });
  test('both Permanent categories calculate attendance without a daily wage and preserve holiday eligibility', async () => {
    for (const [category,department] of [['Fabric Factory Permanent Employees','Fabric Factory'],['SNP Permanent Factory Labour','SNP Factory']]) {
      await rule(category);
      const e = await employee(category,department);
      const s = await sheet(category,department);
      const row = await save(s.id,e.id,{ attendance_status:'Present',entry_timestamp:`${day}T08:00:00+05:30`,exit_timestamp:`${day}T18:00:00+05:30`,holiday_pay_eligible:true });
      expect(Number(row.ot_hours)).toBe(2);
      expect(row.wage_revision_id).toBeNull();
      expect(row.holiday_pay_eligible).toBe(true);
    }
  });
  test('both Local rosters share Local rules and can submit without requiring the other factory', async () => {
    await rule('Local Daily-Wage Workers',true);
    await q("INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by) VALUES('Local Daily-Wage Workers','1899-01-01',350,$1)", [actor]);
    for (const department of ['Fabric Factory','SNP Factory']) {
      const e = await employee('Local Daily-Wage Workers',department);
      const s = await sheet('Local Daily-Wage Workers',department);
      const row = await save(s.id,e.id,{ attendance_status:'Present',entry_timestamp:`${day}T08:00:00+05:30`,exit_timestamp:'1899-10-11T08:00:00+05:30',duty_type:'Double Duty' });
      expect(Number(row.ot_hours)).toBe(0);
      await rejected('SELECT * FROM save_hr_attendance_rows($1,$2,$3)', [s.id,JSON.stringify([{ employee_id:e.id,holiday_pay_eligible:true }]),actor], 'P0001');
      // Only this transaction's employees are active on the isolated date in this test.
      const rows = await members(s.id);
      if (rows.length > 1) await q('SELECT * FROM save_hr_attendance_rows($1,$2,$3)',[s.id,JSON.stringify(rows.filter(id=>id!==e.id).map(employee_id=>({ employee_id,attendance_status:'Absent' }))),actor]);
      const submitted = (await q("SELECT * FROM transition_hr_attendance_sheet($1,'submit',NULL,$2)",[s.id,actor]))[0];
      expect(submitted.status).toBe('Submitted');
      const queue = (await q('SELECT get_hr_attendance_review_queue($1,$2,$2,$3,NULL,1,100,$4) AS data',[ho,day,'Local Daily-Wage Workers',department]))[0].data;
      expect(queue.sheets.some(item=>item.id===s.id && item.department===department)).toBe(true);
      expect(queue.sheets.every(item=>item.department===department)).toBe(true);
    }
  });
  test('retains a pre-migration combined Local sheet without splitting its identity or roster', async () => {
    const snp = await employee('Local Daily-Wage Workers','SNP Factory');
    const fabric = await employee('Local Daily-Wage Workers','Fabric Factory');
    const original = await sheet('Local Daily-Wage Workers','SNP Factory');
    await q('SET CONSTRAINTS ALL IMMEDIATE');
    // Simulate a pre-102 sheet; these trigger changes are transaction-local and rolled back.
    await q('ALTER TABLE hr_attendance_sheets DISABLE TRIGGER hr_attendance_sheet_guard');
    await q('UPDATE hr_attendance_sheets SET department=NULL WHERE id=$1',[original.id]);
    await q('ALTER TABLE hr_attendance_sheets ENABLE TRIGGER hr_attendance_sheet_guard');
    const refreshed = await sheet('Local Daily-Wage Workers','Fabric Factory');
    expect(refreshed.id).toBe(original.id);
    expect(refreshed.department).toBeNull();
    expect((await members(original.id)).sort()).toEqual([snp.id,fabric.id].sort());
    expect((await sheet('Local Daily-Wage Workers','SNP Factory')).id).toBe(original.id);
    await rejected(`INSERT INTO hr_attendance_sheets(attendance_date,employee_category,department,created_by,updated_by)
      VALUES($1,'Local Daily-Wage Workers','Fabric Factory',$2,$2)`,[day,actor],'P0001');
  });
  test('specific Projects categories retain permanent pay and self-service leave eligibility', async () => {
    for (const category of ['Zonal Office','Junior Engineer','Local project supervisor','Head office']) {
      const e = await employee(category,'Projects');
      await q('UPDATE hr_employees SET erp_user_id=$1,updated_by=$1 WHERE id=$2',[actor,e.id]);
      const pay = (await q("SELECT * FROM create_hr_pay_structure($1,'Monthly salary',1000,false,false,'Active',$2)",[e.id,actor]))[0];
      expect(pay.employee_id).toBe(e.id);
      const leave = (await q("SELECT * FROM save_hr_leave_request(NULL,$1,'SELF_SERVICE',$2,$2,'Other Leave','Personal','Pending',$3)",[e.id,day,actor]))[0];
      expect(leave.employee_category).toBe(category);
      await q('UPDATE hr_employees SET erp_user_id=NULL,updated_by=$1 WHERE id=$2',[actor,e.id]);
    }
  });
});
