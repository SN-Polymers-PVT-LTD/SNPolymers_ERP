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
  return {status:response.status,body:await response.json().catch(()=>({}))};
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
    const u = (await db.query('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING *',[String(crypto.randomInt(7000000000,9999999999)),role,`Attendance Review API ${role}`])).rows[0];
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
async function submitted(day,category=casual) { const s=await create(day,category);await absent(s);expect((await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{})).status).toBe(200);return s; }
async function withLeave(day,extra={},category=casual) {
  const s=await create(day,category);await absent(s);
  const l=await request('POST',`/sheets/${s.id}/leave`,'factory_manager',leaveBody(day,extra));expect(l.status).toBe(200);
  expect((await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{})).status).toBe(200);return {s,l:l.body.leave};
}
const decision=(s,l,body,role='ho')=>request('POST',`/sheets/${s.id}/leaves/${l.id}/decision`,role,body);
const review=(s,role='ho')=>request('POST',`/sheets/${s.id}/review`,role,{remarks:'Reviewed all facts'});
describe('Phase 6 HO attendance review HTTP/DB transactions',()=>{
  test('HO/Admin access; FM/JE/ZO/Accounts denial on every HO endpoint',async()=>{
    const {s,l}=await withLeave(2);
    const paths=[['GET','/review-queue'],['GET',`/sheets/${s.id}/review-detail`],['POST',`/sheets/${s.id}/review`,{}],['POST',`/sheets/${s.id}/return`,{remarks:'Correction'}],['POST',`/sheets/${s.id}/leaves/${l.id}/decision`,{decision:'Approved',pay_treatment:'Paid'}]];
    for(const [method,path,body] of paths) {
      for(const role of ['anonymous','factory_manager','je','zo','accounts'])expect((await request(method,path,role,body)).status).toBe(role==='anonymous'?401:403);
    }
    for(const role of ['ho','admin']) {
      expect((await request('GET','/review-queue',role)).status).toBe(200);
      const detail=await request('GET',`/sheets/${s.id}/review-detail`,role);expect(detail.status).toBe(200);expect(detail.body.review.can_review).toBe(false);expect(detail.body.actors[actors.factory_manager]).toBe('Attendance Review API factory_manager');
      expect((await review(s,role)).status).toBe(409);
    }
    expect((await decision(s,l,{decision:'Approved',pay_treatment:'Paid'},'admin')).status).toBe(200);
    expect((await review(s,'admin')).body.sheet.status).toBe('Locked');
  });
  test('queue date/category/state filters, pagination and persisted summary counts exclude Draft',async()=>{
    const s=await create(3);await absent(s);
    expect((await request('PUT',`/sheets/${s.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual,attendance_status:'Present',entry_timestamp:stamp(3,'20:00'),exit_timestamp:stamp(4,'06:00'),holiday_pay_eligible:true}]})).status).toBe(200);
    await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{});
    const localSheet=await submitted(3,local);await create(4);
    const filters=new URLSearchParams({from_date:date(3),to_date:date(3),employee_category:casual,status:'Submitted',limit:1});
    const q=await request('GET',`/review-queue?${filters}`,'ho');expect(q.status).toBe(200);expect(q.body.pagination.totalItems).toBe(1);
    expect(q.body.sheets[0]).toMatchObject({id:s.id,roster:2,present:1,absent:1,leave_medical:0,comp_off:0,management_issue:0,holiday_pay_eligible:1,total_ot_hours:2,submitted_by:actors.factory_manager,submitted_by_name:'Attendance Review API factory_manager',status:'Submitted'});
    const all=await request('GET',`/review-queue?from_date=${date(3)}&to_date=${date(4)}&limit=1`,'ho');expect(all.body.pagination.totalItems).toBe(2);expect(all.body.pagination.totalPages).toBe(2);
    const next=await request('GET',`/review-queue?from_date=${date(3)}&to_date=${date(4)}&limit=1&page=2`,'ho');expect(next.body.sheets).toHaveLength(1);expect(next.body.sheets[0].id).not.toBe(all.body.sheets[0].id);
    await request('POST',`/sheets/${localSheet.id}/return`,'ho',{remarks:'Local correction'});
    const returned=await request('GET',`/review-queue?status=Returned%20for%20Correction&from_date=${date(3)}&to_date=${date(3)}`,'ho');expect(returned.body.sheets[0].ho_remarks).toBe('Local correction');
    for(const query of ['status=Draft','employee_category=HO%20Staff','page=100001','from_date=2026-10-02&to_date=2026-10-01','sort=mobile_number'])expect((await request('GET',`/review-queue?${query}`,'ho')).status).toBe(400);
  });
  test('leave/medical, comp off and management issue counts reflect stored facts',async()=>{
    const {s}=await withLeave(5);
    await request('POST',`/sheets/${s.id}/return`,'ho',{remarks:'Add recorded Comp Off'});
    await request('PUT',`/sheets/${s.id}/rows`,'factory_manager',{rows:[{employee_id:employees.second,attendance_status:'Compensatory Off'}]});await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{});
    const q=await request('GET',`/review-queue?from_date=${date(5)}&to_date=${date(5)}`,'ho');expect(q.body.sheets[0]).toMatchObject({roster:2,present:0,absent:0,leave_medical:1,comp_off:1,total_ot_hours:0});
    const other=await create(6);await absent(other);await request('PUT',`/sheets/${other.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual,attendance_status:'Management Issue'}]});await request('POST',`/sheets/${other.id}/submit`,'factory_manager',{});
    expect((await request('GET',`/review-queue?from_date=${date(6)}&to_date=${date(6)}`,'ho')).body.sheets[0].management_issue).toBe(1);
  });
  test('strict validation, scope, nonexistent IDs and Draft/Returned decision conflicts',async()=>{
    const {s,l}=await withLeave(7);
    expect((await decision(s,l,{decision:'Rejected',pay_treatment:'Unpaid',remarks:' '})).status).toBe(400);
    expect((await decision(s,l,{decision:'Rejected',pay_treatment:'Paid',remarks:'Rejection cannot be paid'})).status).toBe(400);
    expect((await decision(s,l,{decision:'Approved',pay_treatment:'Pending'})).status).toBe(400);
    expect((await decision(s,l,{decision:'Approved',pay_treatment:'Paid',p_actor_id:actors.admin})).status).toBe(400);
    expect((await decision(s,{id:crypto.randomUUID()},{decision:'Approved',pay_treatment:'Paid'})).status).toBe(404);
    expect((await request('POST',`/sheets/${s.id}/return`,'ho',{remarks:' '})).status).toBe(400);
    const unrelated=await submitted(17);expect((await decision(unrelated,l,{decision:'Approved',pay_treatment:'Paid'})).status).toBe(404);
    const draft=await create(8);expect((await request('GET',`/sheets/${draft.id}/review-detail`,'ho')).status).toBe(409);
    expect((await decision(draft,l,{decision:'Approved',pay_treatment:'Paid'})).status).toBe(409);
    await request('POST',`/sheets/${s.id}/return`,'ho',{remarks:'Correction required'});
    expect((await decision(s,l,{decision:'Approved',pay_treatment:'Paid'})).status).toBe(409);
  });
  test('approval preserves facts and resolves readiness; Local forced Unpaid',async()=>{
    const {s,l}=await withLeave(9,{employee_id:employees.local,leave_type:'Leave / Not Working',pay_treatment:'Unpaid'},local);
    const r=await decision(s,l,{decision:'Approved',pay_treatment:'Paid'});expect(r.status).toBe(200);expect(r.body.leave.pay_treatment).toBe('Unpaid');expect(r.body.leave.decided_by).toBe(actors.ho);
    const d=await request('GET',`/sheets/${s.id}/review-detail`,'ho');expect(d.body.review.can_review).toBe(true);expect(d.body.rows[0].attendance_status).toBe('Unpaid Leave');
    expect((await review(s)).body.sheet.status).toBe('Locked');expect((await decision(s,l,{decision:'Rejected',pay_treatment:'Unpaid',remarks:'No'})).status).toBe(409);
  });
  test('rejection returns every affected submitted sheet without auto-Absent, then FM correction/resubmit/HO lock',async()=>{
    const {s,l}=await withLeave(10,{to_date:date(11)});const second=await create(11);
    expect((await request('PUT',`/sheets/${second.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual,attendance_status:'Medical Leave',leave_request_id:l.id},{employee_id:employees.second,attendance_status:'Absent'}]})).status).toBe(200);expect((await request('POST',`/sheets/${second.id}/submit`,'factory_manager',{})).status).toBe(200);
    const rejRes = await decision(s,l,{decision:'Rejected',pay_treatment:'Unpaid',remarks:'Clarify this leave'});
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.leave.approval_status).toBe('Rejected');
    expect(rejRes.body.leave.pay_treatment).toBe('Unpaid');
    for(const sh of [s,second]) {
      const d=await detail(sh.id);expect(d.sheet.status).toBe('Returned for Correction');expect(d.rows.find(r=>r.employee_id===employees.casual).attendance_status).toBe('Medical Leave');
      expect((await request('POST',`/sheets/${sh.id}/submit`,'factory_manager',{})).status).toBe(409);
      await request('PUT',`/sheets/${sh.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual,attendance_status:'Absent',leave_request_id:null}]});
      expect((await request('POST',`/sheets/${sh.id}/submit`,'factory_manager',{})).body.sheet.submission_count).toBe(2);
      expect((await review(sh)).body.sheet.status).toBe('Locked');
    }
    const h=await request('GET',`/sheets/${s.id}/history?limit=100`,'ho');
    for(const action of ['LEAVE_REJECTED','SHEET_RETURNED','SHEET_RESUBMITTED','SHEET_HO_REVIEWED','SHEET_LOCKED'])expect(h.body.history.some(a=>a.action===action)).toBe(true);
    expect(h.body.history.filter(a=>['LEAVE_REJECTED','SHEET_RETURNED','SHEET_LOCKED'].includes(a.action)).every(a=>a.user_id===actors.ho&&a.user_name==='Attendance Review API ho')).toBe(true);
  });
  test('changed approval treatment atomically returns all linked submitted sheets and preserves requested type',async()=>{
    const {s,l}=await withLeave(12,{leave_type:'Paid Leave',pay_treatment:'Paid',to_date:date(13)});
    const second=await create(13);await request('PUT',`/sheets/${second.id}/rows`,'factory_manager',{rows:[{employee_id:employees.second,attendance_status:'Absent'}]});await request('POST',`/sheets/${second.id}/submit`,'factory_manager',{});
    const decided=await decision(s,l,{decision:'Approved',pay_treatment:'Unpaid',remarks:'Approved unpaid'});expect(decided.status).toBe(200);expect(decided.body.leave.leave_type).toBe('Paid Leave');
    for(const sh of [s,second]) {
      const d=await detail(sh.id);expect(d.sheet.status).toBe('Returned for Correction');expect(d.rows.find(r=>r.employee_id===employees.casual).attendance_status).toBe('Paid Leave');
      expect((await review(sh)).status).toBe(409);
      await request('PUT',`/sheets/${sh.id}/rows`,'factory_manager',{rows:[{employee_id:employees.casual,attendance_status:'Unpaid Leave'}]});
      await request('POST',`/sheets/${sh.id}/submit`,'factory_manager',{});expect((await review(sh)).body.sheet.status).toBe('Locked');
    }
  });
  test('concurrent return versus review has one winner; locked state and both audit events commit atomically',async()=>{
    const s=await submitted(14);
    const results=await Promise.all([review(s),request('POST',`/sheets/${s.id}/return`,'ho',{remarks:'Return race'})]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    const d=await detail(s.id);expect(['Locked','Returned for Correction']).toContain(d.sheet.status);
    if(d.sheet.status==='Returned for Correction'){await request('POST',`/sheets/${s.id}/submit`,'factory_manager',{});expect((await review(s)).status).toBe(200);}
    const h=await request('GET',`/sheets/${s.id}/history?limit=100`,'ho');const reviewed=h.body.history.find(a=>a.action==='SHEET_HO_REVIEWED');const locked=h.body.history.find(a=>a.action==='SHEET_LOCKED');
    expect(reviewed.timestamp).toBe(locked.timestamp);expect(locked.old_value.status).toBe('HO Reviewed');
    expect((await db.query("SELECT count(*) FROM hr_attendance_sheets WHERE status='HO Reviewed'")).rows[0].count).toBe('0');
    for(const action of ['return','review','submit','lock','unlock','reopen']) {
      const r=await request('POST',`/sheets/${s.id}/${action}`,action==='submit'?'factory_manager':'ho',action==='return'?{remarks:'Impossible'}:{});
      expect([404,409]).toContain(r.status);
    }
    expect((await absent(s)).status).toBe(409);
  });
  test('approval/correction audit failure rolls back leave, sheet transitions and audit',async()=>{
    await db.query('BEGIN');
    try {
      const s=(await db.query('SELECT * FROM populate_hr_attendance_sheet($1,$2,$3)',[date(15),casual,actors.factory_manager])).rows[0];
      const l=(await db.query("SELECT * FROM save_hr_factory_attendance_leave($1,$2,NULL,$3,$3,'Paid Leave','Audit case','Paid',$4)",[s.id,employees.casual,date(15),actors.factory_manager])).rows[0];
      await db.query('SELECT * FROM save_hr_attendance_rows($1,$2,$3)',[s.id,JSON.stringify([{employee_id:employees.second,attendance_status:'Absent'}]),actors.factory_manager]);
      await db.query("SELECT * FROM transition_hr_attendance_sheet($1,'submit',NULL,$2)",[s.id,actors.factory_manager]);
      const count=(await db.query('SELECT count(*) FROM audit_log')).rows[0].count;
      await db.query('SAVEPOINT attempt');
      await db.query(`CREATE FUNCTION pg_temp.fail_approval_return() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='SHEET_RETURNED' THEN RAISE EXCEPTION 'Forced approval audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER fail_approval_return BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_approval_return()`);
      await expect(db.query("SELECT * FROM decide_hr_factory_sheet_leave($1,$2,'Approved','Unpaid',NULL,$3)",[s.id,l.id,actors.ho])).rejects.toMatchObject({code:'23514'});
      await db.query('ROLLBACK TO SAVEPOINT attempt');
      expect((await db.query('SELECT approval_status FROM hr_leave_requests WHERE id=$1',[l.id])).rows[0].approval_status).toBe('Pending');
      expect((await db.query('SELECT status FROM hr_attendance_sheets WHERE id=$1',[s.id])).rows[0].status).toBe('Submitted');expect((await db.query('SELECT count(*) FROM audit_log')).rows[0].count).toBe(count);
    }finally{await db.query('ROLLBACK');}
  });
  test('new RPCs are service-only and database checks live actor role',async()=>{
    const s=await submitted(16);
    for(const role of ['anon','authenticated']) {
      for(const sql of ['SELECT get_hr_attendance_review_state($1,$2)','SELECT get_hr_attendance_review_queue($1)','SELECT decide_hr_factory_sheet_leave($1,NULL,\'Approved\',\'Paid\',NULL,$2)']) {
        await db.query('BEGIN');try {await db.query(`SET LOCAL ROLE ${role}`);await expect(db.query(sql,sql.includes('$2')?[s.id,actors.ho]:[actors.ho])).rejects.toMatchObject({code:'42501'});}finally{await db.query('ROLLBACK');}
      }
    }
    const {error}=await supabase.rpc('get_hr_attendance_review_state',{p_sheet_id:s.id,p_actor_id:actors.factory_manager});expect(error.code).toBe('42501');
    await db.query("UPDATE authorised_users SET role='accounts' WHERE id=$1",[actors.ho]);
    expect((await request('GET','/review-queue','ho')).status).toBe(401);
    const changed=await supabase.rpc('get_hr_attendance_review_state',{p_sheet_id:s.id,p_actor_id:actors.ho});expect(changed.error.code).toBe('42501');
  });
});
