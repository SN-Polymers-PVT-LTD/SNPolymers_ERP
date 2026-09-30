import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
const { Client } = require('pg');
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { getAuditLog } = require('../../../src/controllers/analytics.controller');
const mockRes = require('../../helpers/mockRes');
const categories = ['Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour', 'SNP Casual Factory Labour', 'Local Daily-Wage Workers'];
const casual = categories[2]; const local = categories[3];
let year; let actors; let employees; let rules; let wages; let seed;
const connect = async () => { const c = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI }); await c.connect(); return c; };
const date = (month = 1, day = 2) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const stamp = (d, time) => `${d}T${time}:00+05:30`;
const one = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];
async function sheet(c, category = casual, d = date(), actor = actors.factory_manager) {
  return one(c, 'SELECT * FROM populate_hr_attendance_sheet($1,$2,$3)', [d, category, actor]);
}
async function rows(c, id) { return (await c.query('SELECT * FROM hr_attendance_rows WHERE sheet_id=$1 ORDER BY employee_id', [id])).rows; }
async function save(c, id, patches, actor = actors.factory_manager) {
  return (await c.query('SELECT * FROM save_hr_attendance_rows($1,$2,$3)', [id, JSON.stringify(patches), actor])).rows;
}
async function transition(c, id, action, actor = actors.factory_manager, remarks = 'Checked') {
  return one(c, 'SELECT * FROM transition_hr_attendance_sheet($1,$2,$3,$4)', [id, action, remarks, actor]);
}
async function ready(c, s) {
  const list = await rows(c, s.id);
  const unmarked = list.filter(a => !a.attendance_status);
  if (unmarked.length) await save(c, s.id, unmarked.map(a => ({ employee_id: a.employee_id, attendance_status: 'Absent' })));
  return s;
}
async function leave(c, emp = employees.casual, from = date(), to = from, options = {}) {
  return one(c, 'SELECT * FROM save_hr_leave_request($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    options.id || null, emp, options.source || 'FACTORY_MANAGER', from, to, options.type || 'Medical Leave',
    options.reason || 'Recorded leave', options.pay || (emp === employees.local ? 'Unpaid' : 'Pending'), options.actor || actors.factory_manager
  ]);
}
async function decide(c, id, decision = 'Approved', pay = 'Paid', actor = actors.ho) {
  return one(c, 'SELECT * FROM decide_hr_leave_request($1,$2,$3,$4,$5)', [id, decision, pay, 'HO decision', actor]);
}
async function addRule(c, category, effective, hours = 8, otEnabled = true) {
  return one(c, `INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,
    ot_rate,ot_multiplier,holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,short_hours_treatment,comp_off_rule,
    double_duty_multiplier,created_by) VALUES($1,$2,$3,$4,'Fixed Hourly',50,NULL,$5,$6,'Recorded policy',NULL,NULL,$7,$8) RETURNING *`,
  [category, effective, hours, otEnabled, category !== local, category === local ? null : 1.5, category === local ? 2 : null, actors.factory_manager]);
}
async function addWage(c, category, effective, wage = 400) {
  return one(c, 'INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by) VALUES($1,$2,$3,$4) RETURNING *', [category, effective, wage, actors.factory_manager]);
}
beforeAll(async () => {
  await requireLocalSupabase(); seed = await connect();
  const available = await one(seed, `SELECT y FROM generate_series(1000,1800) y WHERE NOT EXISTS(
    SELECT 1 FROM hr_attendance_sheets WHERE extract(year FROM attendance_date)=y
  ) AND NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_revisions WHERE extract(year FROM effective_from)=y) LIMIT 1`);
  year = Number(available.y); actors = {}; employees = {}; rules = {}; wages = {};
  for (const role of ['admin','factory_manager','ho','je','accounts','zo']) {
    const u = await one(seed, 'INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING id',
      [String(crypto.randomInt(7000000000,9999999999)),role,`Attendance test ${role}`]);
    actors[role] = u.id;
  }
  const specs = [ ['casual',casual,'Active',date(1,1),null], ['casual2',casual,'Active',date(1,1),null],
    ['inactive',casual,'Inactive',date(1,1),null], ['future',casual,'Active',date(12,1),null],
    ['local',local,'Active',date(1,1),null], ['permanent',categories[0],'Active',date(1,1),null],
    ['snp',categories[1],'Active',date(1,1),null], ['ho','HO Staff','Active',date(1,1),actors.ho],
    ['project','Projects Department Employees','Active',date(1,1),actors.je] ];
  for (const [key,category,status,joining,user] of specs) {
    const e = await one(seed, `INSERT INTO hr_employees(employee_name,employee_category,department,active_status,joining_date,erp_user_id,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`, [`Attendance test ${key}`,category,
      category === 'HO Staff' ? 'Head Office' : category === 'Projects Department Employees' ? 'Projects' : 'SNP Factory',status,joining,user,actors.admin]);
    employees[key] = e.id;
  }
  for (const category of categories) rules[category] = (await addRule(seed,category,date(1,1),category === local ? 12 : 8)).id;
  for (const category of [casual,local]) wages[category] = (await addWage(seed,category,date(1,1))).id;
});
afterAll(async () => {
  if (seed && employees) {
    await seed.query("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])", [actors.admin,Object.values(employees)]);
    await seed.query('UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])', [Object.values(actors)]);
  }
  if (seed) await seed.end();
});

describe('Phase 3 persistence and workflow — transactional local DB regression', () => {
  let db;
  beforeEach(async () => { db = await connect(); await db.query('BEGIN'); });
  afterEach(async () => { await db.query('ROLLBACK'); await db.end(); });
  async function fails(fn, message, code) {
    await db.query('SAVEPOINT rejected_operation');
    let error;
    try { await fn(); } catch (e) { error = e; }
    await db.query('ROLLBACK TO SAVEPOINT rejected_operation'); await db.query('RELEASE SAVEPOINT rejected_operation');
    expect(error).toBeDefined();
    if (message) expect(error.message).toMatch(message);
    if (code) expect(error.code).toBe(code);
  }
  test('roster uses Active/category/joining date; population is idempotent and never silently Present', async () => {
    const s = await sheet(db); const list = await rows(db,s.id);
    expect(list.map(a=>a.employee_id).sort()).toEqual([employees.casual,employees.casual2].sort());
    expect(list.every(a=>a.attendance_status === null && Number(a.actual_hours) === 0)).toBe(true);
    expect((await sheet(db)).id).toBe(s.id); expect(await rows(db,s.id)).toHaveLength(2);
    await fails(()=>db.query('INSERT INTO hr_attendance_rows(sheet_id,employee_id,created_by,updated_by) VALUES($1,$2,$3,$3)',[s.id,employees.casual,actors.factory_manager]),null,'23505');
    await fails(()=>db.query('INSERT INTO hr_attendance_sheets(attendance_date,employee_category,created_by,updated_by) VALUES($1,$2,$3,$3)', [date(),casual,actors.factory_manager]),null,'23505');
    await fails(()=>db.query('INSERT INTO hr_attendance_rows(sheet_id,employee_id,created_by,updated_by) VALUES($1,$2,$3,$3)',[s.id,employees.inactive,actors.factory_manager]),/eligible/);
    await fails(()=>db.query('INSERT INTO hr_attendance_rows(sheet_id,employee_id,created_by,updated_by) VALUES($1,$2,$3,$3)',[s.id,employees.future,actors.factory_manager]),/eligible/);
    await fails(()=>db.query('INSERT INTO hr_attendance_rows(sheet_id,employee_id,created_by,updated_by) VALUES($1,$2,$3,$3)',[s.id,employees.local,actors.factory_manager]),/eligible/);
    await fails(()=>sheet(db,'HO Staff'),null,'23514');
  });
  test('same-day, overnight, 24-hour and fractional duty calculate hours from timestamps without rounding facts', async () => {
    const s = await sheet(db);
    for (const [endDate,endTime,actual,ot] of [[date(),'16:00',8,0],[date(),'18:00',10,2],[date(1,3),'08:00',24,16]]) {
      const [a] = await save(db,s.id,[{employee_id:employees.casual,attendance_status:'Present',entry_timestamp:stamp(date(),'08:00'),exit_timestamp:stamp(endDate,endTime)}]);
      expect(Number(a.actual_hours)).toBe(actual); expect(Number(a.ot_hours)).toBe(ot);
    }
    const [night] = await save(db,s.id,[{employee_id:employees.casual,entry_timestamp:stamp(date(),'20:00'),exit_timestamp:stamp(date(1,3),'08:00')}]);
    expect(Number(night.actual_hours)).toBe(12); expect(Number(night.ot_hours)).toBe(4);
    const [part] = await save(db,s.id,[{employee_id:employees.casual,entry_timestamp:stamp(date(),'08:00'),exit_timestamp:`${date()}T16:00:01+05:30`}]);
    expect(Number(part.actual_hours)).toBeCloseTo(8+1/3600,10); expect(Number(part.ot_hours)).toBeCloseTo(1/3600,10);
  });
  test('computed hours and applicable master references are DB-owned; duty date uses India timezone', async () => {
    const s = await sheet(db);
    const [a] = await save(db,s.id,[{employee_id:employees.casual,attendance_status:'Present',entry_timestamp:`${date()}T02:30:00Z`,exit_timestamp:`${date()}T12:30:00Z`}]);
    expect(a.pay_rule_revision_id).toBe(rules[casual]); expect(a.wage_revision_id).toBe(wages[casual]);
    const direct = await one(db,'UPDATE hr_attendance_rows SET actual_hours=999,ot_hours=999,pay_rule_revision_id=NULL,wage_revision_id=NULL WHERE id=$1 RETURNING *',[a.id]);
    expect(Number(direct.actual_hours)).toBe(10); expect(Number(direct.ot_hours)).toBe(2); expect(direct.pay_rule_revision_id).toBe(rules[casual]);
    for (const field of ['actual_hours','ot_hours','pay_rule_revision_id','created_by']) await fails(()=>save(db,s.id,[{employee_id:employees.casual,[field]:null}]),/Unexpected/);
    await fails(()=>save(db,s.id,[{employee_id:employees.casual,entry_timestamp:`${date()}T20:00:00Z`,exit_timestamp:`${date(1,3)}T08:00:00Z`}]),/start date/);
  });
  test('invalid or partial working timestamps cannot be submitted; non-working timestamps cannot be retained', async () => {
    const s = await ready(db,await sheet(db));
    for (const patch of [
      {entry_timestamp:stamp(date(),'08:00'),exit_timestamp:stamp(date(),'07:00')},
      {entry_timestamp:stamp(date(1,3),'08:00'),exit_timestamp:stamp(date(1,3),'18:00')},
      {entry_timestamp:date(),exit_timestamp:stamp(date(),'18:00')},
      {entry_timestamp:'infinity',exit_timestamp:stamp(date(),'18:00')}
    ]) await fails(()=>save(db,s.id,[{employee_id:employees.casual,attendance_status:'Present',...patch}]));
    await save(db,s.id,[{employee_id:employees.casual,attendance_status:'Present',entry_timestamp:stamp(date(),'08:00')}]);
    await fails(()=>transition(db,s.id,'submit'),/incomplete/);
    await fails(()=>save(db,s.id,[{employee_id:employees.casual,attendance_status:'Absent'}]),/Non-working/);
    await save(db,s.id,[{employee_id:employees.casual,attendance_status:'Absent',entry_timestamp:null,exit_timestamp:null}]);
    expect((await transition(db,s.id,'submit')).status).toBe('Submitted');
  });
  test('non-working/CO/stoppage rows have zero hours; management issue can record reduced work without separate approval', async () => {
    const s = await ready(db,await sheet(db));
    for (const status of ['Absent','Compensatory Off','Management Issue']) {
      const [a] = await save(db,s.id,[{employee_id:employees.casual,attendance_status:status}]);
      expect(Number(a.actual_hours)).toBe(0); expect(Number(a.ot_hours)).toBe(0);
    }
    const [a] = await save(db,s.id,[{employee_id:employees.casual,attendance_status:'Management Issue',entry_timestamp:stamp(date(),'08:00'),exit_timestamp:stamp(date(),'12:00')}]);
    expect(Number(a.actual_hours)).toBe(4);
    await transition(db,s.id,'submit'); expect((await transition(db,s.id,'review',actors.ho)).status).toBe('Locked');
  });
  test('Local duty classification is explicit and local-only; leave is Unpaid and holiday eligibility forbidden', async () => {
    const s = await ready(db,await sheet(db,local));
    await save(db,s.id,[{employee_id:employees.local,attendance_status:'Present',entry_timestamp:stamp(date(),'08:00'),exit_timestamp:stamp(date(),'21:00')}]);
    await fails(()=>transition(db,s.id,'submit'),/incomplete/);
    for (const patch of [{holiday_pay_eligible:true},{attendance_status:'Paid Leave'},{duty_type:'Triple Duty'}]) await fails(()=>save(db,s.id,[{employee_id:employees.local,...patch}]));
    const [single] = await save(db,s.id,[{employee_id:employees.local,duty_type:'Single Duty'}]);
    expect(Number(single.actual_hours)).toBe(13); expect(Number(single.ot_hours)).toBe(1);
    const [double] = await save(db,s.id,[{employee_id:employees.local,duty_type:'Double Duty'}]);
    expect(Number(double.actual_hours)).toBe(13); expect(Number(double.ot_hours)).toBe(0);
    const [double24] = await save(db,s.id,[{employee_id:employees.local,duty_type:'Double Duty',entry_timestamp:stamp(date(),'08:00'),exit_timestamp:stamp(date(1,3),'08:00')}]);
    expect(Number(double24.actual_hours)).toBe(24); expect(Number(double24.ot_hours)).toBe(0);
    await save(db,s.id,[{employee_id:employees.local,duty_type:'Double Duty',entry_timestamp:stamp(date(),'08:00'),exit_timestamp:stamp(date(),'21:00')}]);
    expect((await transition(db,s.id,'submit')).status).toBe('Submitted');
    const cs = await sheet(db,casual,date(1,4));
    await fails(()=>save(db,cs.id,[{employee_id:employees.casual,attendance_status:'Present',duty_type:'Single Duty'}]),/only to Local/);
    await fails(()=>leave(db,employees.local,date(1,5),date(1,5),{pay:'Paid'}),/Unpaid/);
    const l = await leave(db,employees.local,date(1,5));
    await fails(()=>decide(db,l.id,'Approved','Paid'),/Unpaid/);
    expect((await decide(db,l.id,'Approved','Unpaid')).pay_treatment).toBe('Unpaid');
  });
  test('effective-date boundaries refresh at submission; future revisions do not displace current or alter locked facts', async () => {
    const s = await ready(db,await sheet(db));
    await save(db,s.id,[{employee_id:employees.casual,attendance_status:'Present',entry_timestamp:stamp(date(),'08:00'),exit_timestamp:stamp(date(),'18:00')}]);
    const future = await addRule(db,casual,date(2,1),6); await addWage(db,casual,date(2,1),500);
    const applicable = await addRule(db,casual,date(),9,false);
    await transition(db,s.id,'submit');
    let a = (await rows(db,s.id)).find(a=>a.employee_id===employees.casual);
    expect(a.pay_rule_revision_id).toBe(applicable.id); expect(a.pay_rule_revision_id).not.toBe(future.id);
    expect(a.wage_revision_id).toBe(wages[casual]); expect(Number(a.ot_hours)).toBe(1);
    await transition(db,s.id,'review',actors.ho);
    await addWage(db,casual,date(),450);
    a = (await rows(db,s.id)).find(a=>a.employee_id===employees.casual);
    expect(a.wage_revision_id).toBe(wages[casual]); expect(Number(a.ot_hours)).toBe(1);
    const ps = await sheet(db,categories[0]);
    expect((await rows(db,ps.id))[0].wage_revision_id).toBeNull();
  });
  test('missing configuration, unmarked rows, and incomplete roster block submission', async () => {
    const s = await sheet(db); await fails(()=>transition(db,s.id,'submit'),/incomplete/);
    await ready(db,s);
    await db.query(`INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by)
      VALUES('New roster worker',$1,'SNP Factory',$2,$3,$3)`, [casual,date(),actors.admin]);
    await fails(()=>transition(db,s.id,'submit'),/Populate all/);
    await sheet(db); await ready(db,s); await transition(db,s.id,'submit');
    await db.query(`INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by)
      VALUES('Ancient worker',$1,'SNP Factory','0001-01-01',$2,$2)`,[local,actors.admin]);
    const missing = await ready(db,await sheet(db,local,'0001-01-01'));
    await fails(()=>transition(db,missing.id,'submit'),/incomplete/);
  });
  test('submit/return/resubmit/review/lock preserve audit snapshots; submitted and locked sheets are immutable', async () => {
    const s = await ready(db,await sheet(db));
    expect((await transition(db,s.id,'submit')).submission_count).toBe(1);
    await fails(()=>save(db,s.id,[{employee_id:employees.casual,remarks:'Cannot edit'}]),/not editable/);
    await fails(()=>sheet(db),/after submission/);
    await fails(()=>transition(db,s.id,'return',actors.factory_manager),/denied/,'42501');
    await fails(()=>transition(db,s.id,'return',actors.ho,''),/remarks/);
    await transition(db,s.id,'return',actors.ho,'Correct worker facts');
    await save(db,s.id,[{employee_id:employees.casual,remarks:'Corrected'}]);
    expect((await transition(db,s.id,'submit')).submission_count).toBe(2);
    const locked = await transition(db,s.id,'review',actors.ho);
    expect(locked.status).toBe('Locked'); expect(locked.reviewed_by).toBe(actors.ho); expect(locked.locked_at).toBeTruthy();
    for (const action of ['review','return','submit','reopen']) await fails(()=>transition(db,s.id,action,actors.admin),/Invalid/);
    await fails(()=>save(db,s.id,[{employee_id:employees.casual,remarks:'Locked edit'}]),/not editable/);
    await fails(()=>db.query('DELETE FROM hr_attendance_rows WHERE sheet_id=$1',[s.id]),/cannot be deleted/);
    await fails(()=>db.query("UPDATE hr_attendance_rows SET remarks='Direct edit' WHERE sheet_id=$1",[s.id]),/cannot be edited/);
    await fails(()=>db.query('DELETE FROM hr_attendance_sheets WHERE id=$1',[s.id]),/cannot be deleted/);
    const audits = (await db.query('SELECT * FROM audit_log WHERE record_identifier=$1',[s.id])).rows;
    expect(audits.map(a=>a.action).sort()).toEqual(['SHEET_CREATED','SHEET_SUBMITTED','SHEET_RETURNED','SHEET_RESUBMITTED','SHEET_HO_REVIEWED','SHEET_LOCKED'].sort());
    const reviewed = audits.find(a=>a.action==='SHEET_HO_REVIEWED'); const lock = audits.find(a=>a.action==='SHEET_LOCKED');
    expect(reviewed.new_value.status).toBe('HO Reviewed'); expect(lock.old_value.status).toBe('HO Reviewed');
    expect(reviewed.timestamp.getTime()).toBe(lock.timestamp.getTime());
  });
  test('pending leave prevents review; approving once permits atomic review and lock', async () => {
    const l = await leave(db); const s = await ready(db,await sheet(db));
    const a = (await rows(db,s.id)).find(a=>a.employee_id===employees.casual);
    expect(a.leave_request_id).toBe(l.id); expect(a.attendance_status).toBe('Medical Leave');
    await transition(db,s.id,'submit');
    await fails(()=>transition(db,s.id,'review',actors.ho),/unresolved leave/);
    expect((await one(db,'SELECT status FROM hr_attendance_sheets WHERE id=$1',[s.id])).status).toBe('Submitted');
    await decide(db,l.id); await transition(db,s.id,'review',actors.ho);
    await fails(()=>leave(db,employees.casual,date(),date(),{id:l.id,reason:'Rewrite approved leave'}),/immutable/);
    await fails(()=>decide(db,l.id,'Rejected','Unpaid'),/immutable/);
  });
  test('rejection returns every submitted linked sheet atomically and never silently becomes Absent', async () => {
    const l = await leave(db,employees.casual,date(),date(1,4));
    const s1 = await ready(db,await sheet(db)); const s2 = await ready(db,await sheet(db,casual,date(1,3)));
    await transition(db,s1.id,'submit'); await transition(db,s2.id,'submit');
    await decide(db,l.id,'Rejected','Unpaid');
    for (const s of [s1,s2]) {
      expect((await one(db,'SELECT status FROM hr_attendance_sheets WHERE id=$1',[s.id])).status).toBe('Returned for Correction');
      const a = (await rows(db,s.id)).find(a=>a.employee_id===employees.casual);
      expect(a.attendance_status).toBe('Medical Leave'); expect(a.leave_request_id).toBe(l.id);
      await fails(()=>transition(db,s.id,'submit'),/unresolved leave/);
    }
    await save(db,s1.id,[{employee_id:employees.casual,attendance_status:'Present',leave_request_id:null,
      entry_timestamp:stamp(date(),'08:00'),exit_timestamp:stamp(date(),'16:00')}]);
    await transition(db,s1.id,'submit'); await transition(db,s1.id,'review',actors.ho);
    expect((await one(db,'SELECT approval_status FROM hr_leave_requests WHERE id=$1',[l.id])).approval_status).toBe('Rejected');
  });
  test('one range request can be approved before sheets exist and is reused during later population', async () => {
    const l = await leave(db,employees.casual,date(1,6),date(1,8)); await decide(db,l.id);
    for (const day of [6,7,8]) {
      const s = await ready(db,await sheet(db,casual,date(1,day)));
      expect((await rows(db,s.id)).find(a=>a.employee_id===employees.casual).leave_request_id).toBe(l.id);
      await transition(db,s.id,'submit'); await transition(db,s.id,'review',actors.ho);
    }
    expect((await one(db,'SELECT count(*)::int AS n FROM audit_log WHERE record_identifier=$1 AND action=$2',[l.id,'LEAVE_APPROVED'])).n).toBe(1);
  });
  test('linked leave must match employee/date/source/type and cannot shrink around linked rows', async () => {
    const l = await leave(db,employees.casual,date(),date(1,4)); const s = await ready(db,await sheet(db));
    await fails(()=>save(db,s.id,[{employee_id:employees.casual2,attendance_status:'Medical Leave',leave_request_id:l.id}]),/belong/);
    await fails(()=>save(db,s.id,[{employee_id:employees.casual,attendance_status:'Paid Leave',leave_request_id:l.id}]),/type/);
    await fails(()=>leave(db,employees.casual,date(1,3),date(1,4),{id:l.id}),/invalidate/);
    const out = await sheet(db,casual,date(1,5));
    await fails(()=>save(db,out.id,[{employee_id:employees.casual,attendance_status:'Medical Leave',leave_request_id:l.id}]),/cover/);
    await fails(()=>save(db,s.id,[{employee_id:employees.casual,leave_request_id:crypto.randomUUID()}]),/Linked/);
  });
  test('inclusive Pending/Approved overlaps are rejected; rejected ranges permit a new request', async () => {
    const l = await leave(db,employees.casual,date(),date(1,4));
    await fails(()=>leave(db,employees.casual,date(1,4),date(1,5)),null,'23P01');
    await decide(db,l.id); await fails(()=>leave(db,employees.casual,date(1,3)),null,'23P01');
    const other = await leave(db,employees.casual,date(1,5)); await decide(db,other.id,'Rejected','Unpaid');
    expect((await leave(db,employees.casual,date(1,5))).approval_status).toBe('Pending');
    await fails(()=>leave(db,employees.casual,date(1,8),date(1,7)),null,'23514');
  });
  test('Pending changes are audited; linked Submitted leave facts cannot change until return', async () => {
    const l = await leave(db); await leave(db,employees.casual,date(),date(),{id:l.id,reason:'Updated reason'});
    expect((await one(db,'SELECT old_value,new_value FROM audit_log WHERE record_identifier=$1 AND action=$2',[l.id,'LEAVE_CHANGED'])).new_value.reason).toBe('Updated reason');
    const s = await ready(db,await sheet(db)); await transition(db,s.id,'submit');
    await fails(()=>leave(db,employees.casual,date(),date(),{id:l.id,reason:'Submitted mutation'}),/protected/);
    await transition(db,s.id,'return',actors.ho); await leave(db,employees.casual,date(),date(),{id:l.id,reason:'Correction'});
    await fails(()=>leave(db,employees.casual,date(),date(),{id:l.id,actor:actors.ho}),/denied/,'42501');
  });
  test('self-service is restricted to the linked HO/Projects employee; HO decisions supply pay treatment', async () => {
    for (const [emp,actor] of [[employees.ho,actors.ho],[employees.project,actors.je]]) {
      const l = await leave(db,emp,date(),date(1,4),{source:'SELF_SERVICE',type:'Other Leave',actor});
      expect(l.request_source).toBe('SELF_SERVICE'); expect(l.created_by).toBe(actor);
      await fails(()=>decide(db,l.id,'Approved','Pending'),null,'23514');
      expect((await decide(db,l.id,'Approved','Unpaid')).pay_treatment).toBe('Unpaid');
    }
    await fails(()=>leave(db,employees.ho,date(1,6),date(1,6),{source:'SELF_SERVICE',type:'Other Leave',actor:actors.je}),/own request/,'42501');
    await fails(()=>leave(db,employees.casual,date(1,6),date(1,6),{source:'SELF_SERVICE',actor:actors.je}),/own request/,'42501');
    await fails(()=>leave(db,employees.ho),/factory employee/);
    await fails(()=>leave(db,employees.casual,date(),date(),{type:'Compensatory Off'}),null,'23514');
    await fails(()=>leave(db,employees.future,date()),/eligible/);
  });
  test('later employee inactivity does not prevent correcting an existing historical roster row', async () => {
    const s = await ready(db,await sheet(db));
    await db.query("UPDATE hr_employees SET active_status='Inactive',updated_by=$2 WHERE id=$1",[employees.casual,actors.admin]);
    const l = await leave(db);
    await save(db,s.id,[{employee_id:employees.casual,attendance_status:'Medical Leave',leave_request_id:l.id}]);
    await transition(db,s.id,'submit'); await decide(db,l.id);
    expect((await transition(db,s.id,'review',actors.ho)).status).toBe('Locked');
    expect((await rows(db,s.id)).some(a=>a.employee_id===employees.casual)).toBe(true);
  });
  test('HO pay treatment preserves original requested type and supports explicit attendance correction on the same link', async () => {
    const l = await leave(db,employees.casual,date(),date(1,3),{type:'Paid Leave'});
    const s = await ready(db,await sheet(db)); await transition(db,s.id,'submit');
    const approved = await decide(db,l.id,'Approved','Unpaid');
    expect(approved.leave_type).toBe('Paid Leave'); expect(approved.pay_treatment).toBe('Unpaid');
    await fails(()=>transition(db,s.id,'review',actors.ho),/unresolved leave/);
    await transition(db,s.id,'return',actors.ho,'Reflect approved Unpaid treatment');
    await save(db,s.id,[{employee_id:employees.casual,attendance_status:'Unpaid Leave'}]);
    await transition(db,s.id,'submit'); await transition(db,s.id,'review',actors.ho);
    const a = (await rows(db,s.id)).find(a=>a.employee_id===employees.casual);
    expect(a.leave_request_id).toBe(l.id); expect(a.attendance_status).toBe('Unpaid Leave');
    const later = await sheet(db,casual,date(1,3));
    expect((await rows(db,later.id)).find(a=>a.employee_id===employees.casual).attendance_status).toBe('Unpaid Leave');
  });
  test('RPC/table privileges and current role guards exclude client writes and inactive/wrong actors', async () => {
    for (const role of ['anon','authenticated','service_role']) {
      await fails(async()=>{await db.query(`SET LOCAL ROLE ${role}`); await db.query('UPDATE hr_attendance_sheets SET status=status');},/permission denied/,'42501');
      if (role !== 'service_role') await fails(async()=>{await db.query(`SET LOCAL ROLE ${role}`); await sheet(db);},/permission denied/,'42501');
    }
    for (const actor of [actors.ho,actors.je,actors.accounts,actors.zo,crypto.randomUUID()]) await fails(()=>sheet(db,casual,date(),actor),/denied/,'42501');
    const s = await ready(db,await sheet(db));
    await fails(()=>transition(db,s.id,'submit',actors.ho),/denied/,'42501');
    await db.query('UPDATE authorised_users SET role=$1 WHERE id=$2',['ho',actors.factory_manager]);
    await fails(()=>save(db,s.id,[{employee_id:employees.casual,remarks:'Stale FM'}]),/denied/,'42501');
    await db.query('UPDATE authorised_users SET role=$1 WHERE id=$2',['factory_manager',actors.factory_manager]);
    await db.query('UPDATE authorised_users SET is_active=false WHERE id=$1',[actors.factory_manager]);
    await fails(()=>sheet(db),/denied/,'42501');
    expect((await sheet(db,casual,date(1,6),actors.admin)).created_by).toBe(actors.admin);
  });
  test('HO Reviewed cannot commit without locking; audit insertion failure rolls back review and lock', async () => {
    const s = await ready(db,await sheet(db)); await transition(db,s.id,'submit');
    await fails(async()=>{
      await db.query("UPDATE hr_attendance_sheets SET status='HO Reviewed',updated_by=$2 WHERE id=$1",[s.id,actors.ho]);
      await db.query('SET CONSTRAINTS hr_sheet_review_must_lock IMMEDIATE');
    },/same transaction/);
    const before = await one(db,'SELECT count(*)::int AS n FROM audit_log WHERE record_identifier=$1',[s.id]);
    await db.query(`CREATE FUNCTION pg_temp.reject_lock_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SHEET_LOCKED' THEN RAISE EXCEPTION 'Forced audit failure'; END IF; RETURN NEW; END; $$`);
    await db.query('CREATE TRIGGER test_phase3_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_lock_audit()');
    await fails(()=>transition(db,s.id,'review',actors.ho),/Forced audit failure/);
    expect((await one(db,'SELECT status,reviewed_at,locked_at FROM hr_attendance_sheets WHERE id=$1',[s.id]))).toEqual({status:'Submitted',reviewed_at:null,locked_at:null});
    expect((await one(db,'SELECT count(*)::int AS n FROM audit_log WHERE record_identifier=$1',[s.id])).n).toBe(before.n);
  });
  test('batch edit failures roll back earlier rows and attendance audit events', async () => {
    const s = await sheet(db);
    const before = await one(db,"SELECT count(*)::int AS n FROM audit_log WHERE module_name='HR Attendance'");
    await fails(()=>save(db,s.id,[{employee_id:employees.casual,attendance_status:'Absent'},{employee_id:crypto.randomUUID(),attendance_status:'Absent'}]),/not found/);
    expect((await rows(db,s.id)).every(a=>a.attendance_status===null)).toBe(true);
    expect((await one(db,"SELECT count(*)::int AS n FROM audit_log WHERE module_name='HR Attendance'")).n).toBe(before.n);
    await fails(()=>save(db,s.id,[{employee_id:employees.casual},{employee_id:employees.casual}]),/more than once/);
  });
  test('failed return audit rolls back the leave rejection and every affected sheet', async () => {
    const l = await leave(db,employees.casual,date(),date(1,3));
    const s1 = await ready(db,await sheet(db)); const s2 = await ready(db,await sheet(db,casual,date(1,3)));
    await transition(db,s1.id,'submit'); await transition(db,s2.id,'submit');
    await db.query(`CREATE FUNCTION pg_temp.reject_return_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SHEET_RETURNED' THEN RAISE EXCEPTION 'Forced return audit failure'; END IF; RETURN NEW; END; $$`);
    await db.query('CREATE TRIGGER test_phase3_return_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_return_audit()');
    await fails(()=>decide(db,l.id,'Rejected','Unpaid'),/Forced return audit failure/);
    expect((await one(db,'SELECT approval_status FROM hr_leave_requests WHERE id=$1',[l.id])).approval_status).toBe('Pending');
    for (const s of [s1,s2]) expect((await one(db,'SELECT status FROM hr_attendance_sheets WHERE id=$1',[s.id])).status).toBe('Submitted');
  });
  test('service-only RPC works through Supabase REST without granting direct table DML', async () => {
    const response = await supabase.rpc('populate_hr_attendance_sheet',{p_date:date(3,1),p_category:local,p_actor_id:actors.factory_manager});
    expect(response.error).toBeNull(); expect(response.data.status).toBe('Draft');
    const denied = await supabase.from('hr_attendance_rows').update({remarks:'Bypass'}).eq('sheet_id',response.data.id);
    expect(denied.error.code).toBe('42501');
    const impersonated = await supabase.rpc('populate_hr_attendance_sheet',{p_date:date(3,2),p_category:local,p_actor_id:actors.je});
    expect(impersonated.error.code).toBe('42501');
    const createdLeave = await supabase.rpc('save_hr_leave_request',{
      p_leave_id:null,p_employee_id:employees.local,p_source:'FACTORY_MANAGER',p_from_date:date(3,1),p_to_date:date(3,1),
      p_leave_type:'Medical Leave',p_reason:'Private local test reason',p_pay_treatment:'Unpaid',p_actor_id:actors.factory_manager
    });
    expect(createdLeave.error).toBeNull();
    for (const record_identifier of [response.data.id,createdLeave.data.id]) {
      for (const role of ['admin','ho','je']) {
        const res = mockRes(); await getAuditLog({user:{role},query:{record_identifier}},res);
        expect(res.statusCode).toBe(200);
        if (role==='admin') {expect(res.jsonData.data).toHaveLength(1);expect(res.jsonData.data[0].user_name).toBe('Attendance test factory_manager');}
        else expect(res.jsonData.data).toEqual([]);
      }
    }
  });
});

describe('Phase 3 concurrency — separate committed DB connections', () => {
  async function parallel(fn1,fn2) {
    const a = await connect(); const b = await connect();
    try { return await Promise.allSettled([fn1(a),fn2(b)]); } finally {await a.end(); await b.end();}
  }
  test('simultaneous roster population produces one sheet and one row per eligible employee', async () => {
    const results = await parallel(c=>sheet(c,casual,date(4,1)),c=>sheet(c,casual,date(4,1)));
    expect(results.every(r=>r.status==='fulfilled')).toBe(true);
    expect(results[0].value.id).toBe(results[1].value.id);
    expect(await rows(seed,results[0].value.id)).toHaveLength(2);
  });
  test('overlapping self-service inserts race safely under the exclusion constraint', async () => {
    const options = {source:'SELF_SERVICE',type:'Other Leave',actor:actors.je};
    const results = await parallel(c=>leave(c,employees.project,date(4,2),date(4,4),options),c=>leave(c,employees.project,date(4,4),date(4,6),options));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected').reason.code).toBe('23P01');
  });
  test('concurrent review and return have a single winner with no intermediate HO Reviewed state', async () => {
    const s = await ready(seed,await sheet(seed,casual,date(4,7))); await transition(seed,s.id,'submit');
    const results = await parallel(c=>transition(c,s.id,'review',actors.ho),c=>transition(c,s.id,'return',actors.ho));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const final = await one(seed,'SELECT status,reviewed_at,locked_at FROM hr_attendance_sheets WHERE id=$1',[s.id]);
    expect(['Locked','Returned for Correction']).toContain(final.status);
    if (final.status==='Locked') {expect(final.reviewed_at).toBeTruthy();expect(final.locked_at).toBeTruthy();}
    else expect(final.locked_at).toBeNull();
  });
  test('concurrent approve/reject decide once and preserve correction state', async () => {
    const l = await leave(seed,employees.casual,date(4,8)); const s = await ready(seed,await sheet(seed,casual,date(4,8))); await transition(seed,s.id,'submit');
    const results = await parallel(c=>decide(c,l.id),c=>decide(c,l.id,'Rejected','Unpaid'));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const final = await one(seed,'SELECT approval_status FROM hr_leave_requests WHERE id=$1',[l.id]);
    const status = (await one(seed,'SELECT status FROM hr_attendance_sheets WHERE id=$1',[s.id])).status;
    expect(status).toBe(final.approval_status==='Rejected'?'Returned for Correction':'Submitted');
    expect((await rows(seed,s.id)).find(a=>a.employee_id===employees.casual).attendance_status).toBe('Medical Leave');
  });
  test('edit and submission serialize; submitted facts include a prior edit or reject a later edit', async () => {
    const s = await ready(seed,await sheet(seed,casual,date(4,9)));
    const results = await parallel(c=>save(c,s.id,[{employee_id:employees.casual,remarks:'Concurrent edit'}]),c=>transition(c,s.id,'submit'));
    expect(results[1].status).toBe('fulfilled');
    expect((await one(seed,'SELECT status FROM hr_attendance_sheets WHERE id=$1',[s.id])).status).toBe('Submitted');
    const a = (await rows(seed,s.id)).find(a=>a.employee_id===employees.casual);
    if (results[0].status==='fulfilled') expect(a.remarks).toBe('Concurrent edit');
    else {expect(results[0].reason.message).toMatch(/editable/);expect(a.remarks).toBeNull();}
  });
  test('leave date edits and attendance linking cannot leave a date outside the range', async () => {
    const s = await ready(seed,await sheet(seed,casual,date(4,10)));
    const l = await leave(seed,employees.casual,date(4,10),date(4,11));
    const results = await parallel(
      c=>save(c,s.id,[{employee_id:employees.casual,attendance_status:'Medical Leave',leave_request_id:l.id}]),
      c=>leave(c,employees.casual,date(4,11),date(4,11),{id:l.id}));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const invalid = await one(seed,`SELECT count(*)::int AS n FROM hr_attendance_rows a JOIN hr_attendance_sheets s ON s.id=a.sheet_id
      JOIN hr_leave_requests l ON l.id=a.leave_request_id WHERE a.sheet_id=$1 AND s.attendance_date NOT BETWEEN l.from_date AND l.to_date`,[s.id]);
    expect(invalid.n).toBe(0);
  });
  test('leave approval racing with review cannot lock a Pending leave', async () => {
    const l = await leave(seed,employees.casual,date(4,12));
    const s = await ready(seed,await sheet(seed,casual,date(4,12))); await transition(seed,s.id,'submit');
    const results = await parallel(c=>decide(c,l.id),c=>transition(c,s.id,'review',actors.ho));
    expect(results[0].status).toBe('fulfilled');
    const final = await one(seed,`SELECT s.status,l.approval_status FROM hr_attendance_sheets s
      JOIN hr_attendance_rows a ON a.sheet_id=s.id JOIN hr_leave_requests l ON l.id=a.leave_request_id WHERE s.id=$1`,[s.id]);
    expect(final.approval_status).toBe('Approved');
    if (results[1].status==='fulfilled') expect(final.status).toBe('Locked');
    else {expect(final.status).toBe('Submitted');expect(results[1].reason.message).toMatch(/unresolved leave/);}
  });
});
