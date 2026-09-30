import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { Client } = require('pg');
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { generateTokens } = require('../../../src/services/session.service');
const app = require('../../../src/app');
const prefix = '/api/v1/auth/hr/attendance';
const casual = 'SNP Casual Factory Labour'; const local = 'Local Daily-Wage Workers';
let db,server,base,year; const actors = {}; const tokens = {}; const employees = {};
const date = day => `${year}-01-${String(day).padStart(2,'0')}`;
const stamp = (day,time) => `${date(day)}T${time}:00+05:30`;
async function request(method,path,role='factory_manager',body) {
  const response = await fetch(`${base}${prefix}${path}`,{method,headers:{...(tokens[role] ? {Cookie:`accessToken=${tokens[role].accessToken}`} : {}), 'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
  return {status:response.status,body:await response.json()};
}
const selection = (day,category=casual) => ({date:date(day),employee_category:category});
const query = (day,category=casual) => new URLSearchParams(selection(day,category));
async function create(day,category=casual) {
  const r = await request('POST','/sheets','factory_manager',selection(day,category)); expect(r.status).toBe(200); return r.body.sheet;
}
async function detail(id) { const r = await request('GET',`/sheets/${id}`); expect(r.status).toBe(200); return r.body; }
async function absent(sheet) { const r = await detail(sheet.id); return request('PUT',`/sheets/${sheet.id}/rows`,'factory_manager',{rows:r.rows.map(row => ({employee_id:row.employee_id,attendance_status:'Absent'}))}); }
function leaveBody(day,extra={}) { return {employee_id:employees.casual,from_date:date(day),to_date:date(day),leave_type:'Medical Leave',reason:'Factory leave test',pay_treatment:'Pending',...extra}; }
beforeAll(async () => {
  await requireLocalSupabase(); db = new Client({connectionString:process.env.SUPABASE_TEST_DB_URI}); await db.connect();
  year = Number((await db.query(`SELECT y FROM generate_series(1801,2190) y WHERE NOT EXISTS(SELECT 1 FROM hr_attendance_sheets WHERE extract(year FROM attendance_date)=y)
    AND NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_revisions WHERE extract(year FROM effective_from)=y) ORDER BY y LIMIT 1`)).rows[0].y);
  for (const role of ['admin','factory_manager','ho','je','zo','accounts']) {
    const u = (await db.query('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING *',[String(crypto.randomInt(7000000000,9999999999)),role,`Attendance API ${role}`])).rows[0];
    actors[role]=u.id;
    const session = (await db.query('INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()])).rows[0];
    tokens[role]=generateTokens(u,session.id,crypto.randomUUID());
  }
  for (const [key,category,status,joining] of [['casual',casual,'Active',date(1)],['second',casual,'Active',date(1)],['inactive',casual,'Inactive',date(1)],['future',casual,'Active',`${year}-12-01`],['local',local,'Active',date(1)]]) {
    employees[key]=(await db.query(`INSERT INTO hr_employees(employee_name,employee_category,department,active_status,joining_date,created_by,updated_by)
      VALUES($1,$2,'SNP Factory',$3,$4,$5,$5) RETURNING id`,[`API ${key}`,category,status,joining,actors.admin])).rows[0].id;
  }
  for (const category of [casual,local]) {
    await db.query(`INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,ot_multiplier,
      holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,double_duty_multiplier,created_by)
      VALUES($1,$2,$3,true,'Fixed Hourly',50,NULL,$4,$5,'Recorded policy',$6,$7)`,[category,date(1),category===local?12:8,category!==local,category===local?null:1.5,category===local?2:null,actors.factory_manager]);
    await db.query('INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by) VALUES($1,$2,400,$3)',[category,date(1),actors.factory_manager]);
  }
  server=app.listen(0); await new Promise(resolve=>server.once('listening',resolve)); base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  if (server) await new Promise(resolve=>server.close(resolve));
  if (db) {
    await db.query("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[actors.admin,Object.values(employees)]);
    await db.query('UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(actors)]); await db.end();
  }
});
describe('FM attendance HTTP/database integration', () => {
  test('read/write access matrix and narrow FM module boundary',async () => {
    const s=await create(2);
    for (const path of [`/roster?${query(2)}`,`/sheet?${query(2)}`,`/sheets/${s.id}`,`/sheets/${s.id}/history`]) {
      expect((await request('GET',path,'anonymous')).status).toBe(401);
      for (const role of ['je','zo','accounts']) expect((await request('GET',path,role)).status).toBe(403);
      for (const role of ['factory_manager','admin','ho']) expect((await request('GET',path,role)).status).toBe(200);
    }
    for (const [method,path,body] of [['POST','/sheets',selection(2)],['PUT',`/sheets/${s.id}/rows`,{rows:[{employee_id:employees.casual,attendance_status:'Absent'}]}],['POST',`/sheets/${s.id}/leave`,leaveBody(2)],['POST',`/sheets/${s.id}/submit`,{}]]) {
      for (const role of ['anonymous','je','zo','accounts','ho']) expect((await request(method,path,role,body)).status).toBe(role==='anonymous'?401:403);
    }
    for (const path of ['/hr/employees','/hr/pay-structures','/analytics/audit-log','/projects']) {
      const r=await fetch(`${base}/api/v1/auth${path}`,{headers:{Cookie:`accessToken=${tokens.factory_manager.accessToken}`}}); expect(r.status).toBe(403);
    }
  });
  test('side-effect-free load, eligible roster and concurrent idempotent population',async () => {
    const empty=await request('GET',`/sheet?${query(3)}`); expect(empty.body.sheet).toBeNull();
    const roster=await request('GET',`/roster?${query(3)}`);
    expect(roster.body.employees.map(e=>e.id).sort()).toEqual([employees.casual,employees.second].sort());
    expect(roster.body.employees[0]).not.toHaveProperty('erp_user_id');
    const attempts=await Promise.all([1,2].map(()=>request('POST','/sheets','factory_manager',selection(3))));
    expect(attempts.every(r=>r.status===200)).toBe(true); expect(attempts[0].body.sheet.id).toBe(attempts[1].body.sheet.id);
    const loaded=await detail(attempts[0].body.sheet.id); expect(loaded.rows).toHaveLength(2); expect(loaded.rows.every(r=>r.attendance_status===null)).toBe(true);
  });
  test('strict validation rejects forged fields, naive timestamps, duplicate employees and nonfactory reads',async () => {
    const s=await create(4);
    for (const patch of [{actual_hours:10},{p_actor_id:actors.ho},{entry_timestamp:`${date(4)}T08:00:00`},{employee_id:'bad'},{holiday_pay_eligible:'true'}]) {
      expect((await request('PUT',`/sheets/${s.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual,...patch}]})).status).toBe(400);
    }
    expect((await request('PUT',`/sheets/${s.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual},{employee_id:employees.casual}]})).status).toBe(400);
    expect((await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{action:'review'})).status).toBe(400);
    expect((await request('GET',`/roster?${query(4,'HO Staff')}`)).status).toBe(400);
    expect((await request('GET','/sheets/not-a-uuid')).status).toBe(400);
    expect((await request('GET',`/sheets/${crypto.randomUUID()}`)).status).toBe(404);
  });
  test('bulk save computes and pins revisions; invalid batch rolls back all edits',async () => {
    const s=await create(5); const path=`/sheets/${s.id}/rows`;
    const r=await request('PUT',path,'factory_manager',{rows:[{employee_id:employees.casual,attendance_status:'Present',entry_timestamp:stamp(5,'20:00'),exit_timestamp:stamp(6,'06:00')},{employee_id:employees.second,attendance_status:'Management Issue'}]});
    expect(r.status).toBe(200); const working=r.body.rows.find(a=>a.employee_id===employees.casual);
    expect(Number(working.actual_hours)).toBe(10); expect(Number(working.ot_hours)).toBe(2); expect(working.pay_rule_revision_id).toBeTruthy(); expect(working.wage_revision_id).toBeTruthy();
    const invalid=await request('PUT',path,'factory_manager',{rows:[{employee_id:employees.casual,remarks:'must roll back'},{employee_id:employees.inactive,attendance_status:'Absent'}]});
    expect(invalid.status).toBe(404); expect((await detail(s.id)).rows.find(a=>a.employee_id===employees.casual).remarks).toBeNull();
  });
  test('Local 24+ hour Double Duty has no OT, Single Duty has OT, no holiday or paid leave',async () => {
    const s=await create(6,local); const path=`/sheets/${s.id}/rows`;
    const patch={employee_id:employees.local,attendance_status:'Present',entry_timestamp:stamp(6,'08:00'),exit_timestamp:stamp(7,'10:00'),duty_type:'Double Duty'};
    const r=await request('PUT',path,'factory_manager',{rows:[patch]}); expect(r.status).toBe(200); expect(Number(r.body.rows[0].actual_hours)).toBe(26); expect(Number(r.body.rows[0].ot_hours)).toBe(0);
    const single=await request('PUT',path,'factory_manager',{rows:[{employee_id:employees.local,duty_type:'Single Duty'}]}); expect(Number(single.body.rows[0].ot_hours)).toBe(14);
    expect((await request('PUT',path,'factory_manager',{rows:[{employee_id:employees.local,holiday_pay_eligible:true}]})).status).toBe(409);
    expect((await request('POST',`/sheets/${s.id}/leave`,'factory_manager',leaveBody(6,{employee_id:employees.local,pay_treatment:'Paid'}))).status).toBe(409);
    const l=await request('POST',`/sheets/${s.id}/leave`,'factory_manager',leaveBody(6,{employee_id:employees.local,pay_treatment:'Unpaid',leave_type:'Leave / Not Working'}));
    expect(l.status).toBe(200); expect(l.body.leave.pay_treatment).toBe('Unpaid'); expect((await detail(s.id)).rows[0].actual_hours).toBe(0);
  });
  test('atomic leave create/edit links range, clears duty, preserves other rows, overlap rolls back',async () => {
    const s=await create(8); await absent(s);
    const body=leaveBody(8,{to_date:date(9)}); const first=await request('POST',`/sheets/${s.id}/leave`,'factory_manager',body); expect(first.status).toBe(200);
    const id=first.body.leave.id; const linked=(await detail(s.id)).rows.find(a=>a.employee_id===employees.casual); expect(linked.leave_request_id).toBe(id); expect(linked.attendance_status).toBe('Medical Leave');
    const conflict=await request('POST',`/sheets/${s.id}/leave`,'factory_manager',body); expect(conflict.status).toBe(409); expect(conflict.body.code).toBe('LEAVE_RANGE_CONFLICT');
    expect((await detail(s.id)).rows.find(a=>a.employee_id===employees.casual).leave_request_id).toBe(id);
    const changed=await request('POST',`/sheets/${s.id}/leave`,'factory_manager',{...body,leave_id:id,leave_type:'Unpaid Leave',reason:'Updated reason',pay_treatment:'Unpaid'});
    expect(changed.status).toBe(200); const loaded=await detail(s.id); expect(loaded.rows.find(a=>a.employee_id===employees.casual).attendance_status).toBe('Unpaid Leave'); expect(loaded.rows.find(a=>a.employee_id===employees.second).attendance_status).toBe('Absent');
    const next=await create(9); expect((await detail(next.id)).rows.find(a=>a.employee_id===employees.casual).leave_request_id).toBe(id);
    const invalid=await request('POST',`/sheets/${s.id}/leave`,'factory_manager',{...body,leave_id:id,to_date:date(8)}); expect(invalid.status).toBe(409);
    expect((await detail(s.id)).rows.find(a=>a.employee_id===employees.casual).leave.to_date).toBe(date(9));
  });
  test('leave failures leave no orphan or audit changes; request/source/actor are server-owned',async () => {
    const s=await create(10);
    const count=async () => Number((await db.query('SELECT count(*) FROM audit_log WHERE user_id=$1',[actors.factory_manager])).rows[0].count);
    const before=await count();
    for (const extra of [{from_date:date(11),to_date:date(11)},{employee_id:employees.inactive},{employee_id:employees.local},{created_by:actors.ho},{request_source:'SELF_SERVICE'}]) {
      const r=await request('POST',`/sheets/${s.id}/leave`,'factory_manager',leaveBody(10,extra)); expect([400,404,409]).toContain(r.status);
    }
    expect(await count()).toBe(before);
    expect((await db.query('SELECT count(*) FROM hr_leave_requests WHERE from_date=$1',[date(10)])).rows[0].count).toBe('0');
  });
  test('submission validation, frozen load/save/leave and return correction/resubmission',async () => {
    const s=await create(12);
    expect((await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{})).status).toBe(409);
    await absent(s); const l=await request('POST',`/sheets/${s.id}/leave`,'factory_manager',leaveBody(12)); expect(l.status).toBe(200);
    expect((await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{})).body.sheet.status).toBe('Submitted');
    expect((await request('GET',`/sheet?${query(12)}`)).status).toBe(200);
    expect((await absent(s)).status).toBe(409);
    expect((await request('POST',`/sheets/${s.id}/leave`,'factory_manager',leaveBody(12,{leave_id:l.body.leave.id}))).status).toBe(409);
    await db.query("SELECT * FROM decide_hr_leave_request($1,'Rejected','Unpaid','Correct rejected leave',$2)",[l.body.leave.id,actors.ho]);
    const returned=await detail(s.id); expect(returned.sheet.status).toBe('Returned for Correction'); expect(returned.rows.find(r=>r.employee_id===employees.casual).attendance_status).toBe('Medical Leave');
    const corrected=await request('PUT',`/sheets/${s.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual,attendance_status:'Absent',leave_request_id:null}]}); expect(corrected.status).toBe(200);
    const submitted=await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{}); expect(submitted.body.sheet.submission_count).toBe(2);
    await db.query("SELECT * FROM transition_hr_attendance_sheet($1,'review','Reviewed',$2)",[s.id,actors.ho]);
    expect((await detail(s.id)).sheet.status).toBe('Locked'); expect((await absent(s)).status).toBe(409);
    expect((await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{})).status).toBe(409);
  });
  test('scoped paginated history includes named actors and excludes employee/pay/other sheets',async () => {
    const sheet=(await request('GET',`/sheet?${query(12)}`)).body.sheet;
    const r=await request('GET',`/sheets/${sheet.id}/history?limit=100`); expect(r.status).toBe(200);
    expect(r.body.history.some(a=>a.action==='SHEET_RESUBMITTED')).toBe(true); expect(r.body.history.some(a=>a.action==='LEAVE_REJECTED')).toBe(true);
    expect(r.body.history.every(a=>['HR Attendance','HR Leave'].includes(a.module_name))).toBe(true);
    expect(r.body.history.every(a=>a.user_name.startsWith('Attendance API'))).toBe(true);
    const page=await request('GET',`/sheets/${sheet.id}/history?limit=1&page=2`); expect(page.body.history).toHaveLength(1); expect(page.body.pagination.page).toBe(2);
    expect((await request('GET',`/sheets/${sheet.id}/history?record_identifier=${actors.admin}`)).status).toBe(400);
  });
  test('history preserves previously linked leave after explicit unlink and later range correction',async () => {
    const first=await create(18);
    const saved=await request('POST',`/sheets/${first.id}/leave`,'factory_manager',leaveBody(18,{to_date:date(20)})); expect(saved.status).toBe(200);
    const id=saved.body.leave.id;
    expect((await request('PUT',`/sheets/${first.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual,attendance_status:'Absent',leave_request_id:null}]})).status).toBe(200);
    const second=await create(19);
    const changed=await request('POST',`/sheets/${second.id}/leave`,'factory_manager',leaveBody(19,{leave_id:id,to_date:date(20),reason:'Range corrected after unlink'})); expect(changed.status).toBe(200);
    const history=await request('GET',`/sheets/${first.id}/history?limit=100`); expect(history.status).toBe(200);
    expect(history.body.history.some(event=>event.action==='LEAVE_CHANGED' && event.record_identifier===id)).toBe(true);
    expect(history.body.history.some(event=>event.action==='LEAVE_CREATED' && event.record_identifier===id)).toBe(true);
  });
  test('concurrent leave save and submit serialize without orphan writes or editable submitted rows',async () => {
    const s=await create(14); await absent(s);
    const [leave,submit]=await Promise.all([request('POST',`/sheets/${s.id}/leave`,'factory_manager',leaveBody(14)),request('POST',`/sheets/${s.id}/submit`,'factory_manager',{})]);
    expect(submit.status).toBe(200); expect([200,409]).toContain(leave.status);
    const loaded=await detail(s.id); expect(loaded.sheet.status).toBe('Submitted');
    const records=(await db.query('SELECT id FROM hr_leave_requests WHERE employee_id=$1 AND from_date=$2',[employees.casual,date(14)])).rows;
    expect(records).toHaveLength(leave.status===200?1:0);
    expect(loaded.rows.find(a=>a.employee_id===employees.casual).leave_request_id).toBe(records[0]?.id || null);
  });
  test('composed leave entry rolls back row, request and audit on an audit insertion failure',async () => {
    await db.query('BEGIN');
    try {
      const s=(await db.query('SELECT * FROM populate_hr_attendance_sheet($1,$2,$3)',[date(15),casual,actors.factory_manager])).rows[0];
      const before=(await db.query('SELECT * FROM hr_attendance_rows WHERE sheet_id=$1 AND employee_id=$2',[s.id,employees.casual])).rows[0];
      const audits=(await db.query('SELECT count(*) FROM audit_log')).rows[0].count;
      await db.query('SAVEPOINT attempt');
      await db.query(`CREATE FUNCTION pg_temp.reject_factory_leave_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action='LEAVE_CREATED' THEN RAISE EXCEPTION 'Forced leave audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER reject_factory_leave_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_factory_leave_audit()`);
      await expect(db.query("SELECT * FROM save_hr_factory_attendance_leave($1,$2,NULL,$3,$3,'Medical Leave','Audit rollback','Pending',$4)",[s.id,employees.casual,date(15),actors.factory_manager])).rejects.toMatchObject({code:'23514'});
      await db.query('ROLLBACK TO SAVEPOINT attempt');
      expect((await db.query('SELECT * FROM hr_attendance_rows WHERE id=$1',[before.id])).rows[0]).toEqual(before);
      expect((await db.query('SELECT count(*) FROM audit_log')).rows[0].count).toBe(audits);
      expect((await db.query('SELECT count(*) FROM hr_leave_requests WHERE employee_id=$1 AND from_date=$2',[employees.casual,date(15)])).rows[0].count).toBe('0');
    } finally { await db.query('ROLLBACK'); }
  });
  test('new composed RPC is service-only and respects live role authorization',async () => {
    const s=await create(16);
    for (const role of ['anon','authenticated']) {
      await db.query('BEGIN');
      try {
        await db.query(`SET LOCAL ROLE ${role}`);
        await expect(db.query("SELECT * FROM save_hr_factory_attendance_leave($1,$2,NULL,$3,$3,'Medical Leave','Test','Pending',$4)",[s.id,employees.casual,date(16),actors.factory_manager])).rejects.toMatchObject({code:'42501'});
      } finally { await db.query('ROLLBACK'); }
    }
    const {error}=await supabase.rpc('save_hr_factory_attendance_leave',{p_sheet_id:s.id,p_employee_id:employees.casual,p_leave_id:null,p_from_date:date(16),p_to_date:date(16),p_leave_type:'Medical Leave',p_reason:'Test',p_pay_treatment:'Pending',p_actor_id:actors.ho});
    expect(error.code).toBe('42501');
  });
  test('detached row from active covering leave is rejected at submission with 409 ATTENDANCE_CONFLICT', async () => {
    const s = await create(22);
    await absent(s);
    const leaveRes = await request('POST', `/sheets/${s.id}/leave`, 'factory_manager', leaveBody(22));
    expect(leaveRes.status).toBe(200);
    const leaveId = leaveRes.body.leave.id;
    const detachRes = await request('PUT', `/sheets/${s.id}/rows`, 'factory_manager', {
      rows: [{ employee_id: employees.casual, attendance_status: 'Absent', leave_request_id: null }]
    });
    expect(detachRes.status).toBe(200);
    const submitFail = await request('POST', `/sheets/${s.id}/submit`, 'factory_manager', {});
    expect(submitFail.status).toBe(409);
    expect(submitFail.body.code).toBe('ATTENDANCE_CONFLICT');
    expect(submitFail.body.message).toMatch(/unresolved leave/);
    const relinkRes = await request('PUT', `/sheets/${s.id}/rows`, 'factory_manager', {
      rows: [{ employee_id: employees.casual, attendance_status: 'Medical Leave', leave_request_id: leaveId }]
    });
    expect(relinkRes.status).toBe(200);
    const submitOk = await request('POST', `/sheets/${s.id}/submit`, 'factory_manager', {});
    expect(submitOk.status).toBe(200);
    expect(submitOk.body.sheet.status).toBe('Submitted');
  });
  test('live role reassignment revokes attendance reads and old sessions',async () => {
    await db.query("UPDATE authorised_users SET role='accounts' WHERE id=$1",[actors.factory_manager]);
    expect((await request('GET',`/roster?${query(2)}`)).status).toBe(401);
  });
});
