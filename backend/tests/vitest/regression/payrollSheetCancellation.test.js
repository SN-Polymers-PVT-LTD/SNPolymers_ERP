import {beforeAll,afterAll,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture,reviewAction}=require('../../helpers/payrollReviewFixtures');
const {generateTokens}=require('../../../src/services/session.service');const app=require('../../../src/app');
let db,users,server,base;const tokens={},employeeIds=[];
async function request(method,path,role='fm',body){const r=await fetch(base+'/api/v1/auth/hr/payroll'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
async function fixture(options={factory:true}){const f=await createReviewFixture(db,users,options);employeeIds.push(...f.employees.map(e=>e.id));return f;}
const cancel=(id,role='fm',body={reason:'Synthetic draft sheet cleanup'})=>request('DELETE',`/runs/${id}`,role,body);
beforeAll(async()=>{
 await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);
 for(const [role,u] of Object.entries(users)){const s=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[role]=generateTokens(u,s.id,crypto.randomUUID()).accessToken;}
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employeeIds]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
test('creator cancels an empty sheet once with an audited reason',async()=>{
 const f=await fixture({factory:true,count:0});const r=await cancel(f.run.id);expect(r.status).toBe(200);expect(r.body.result).toMatchObject({cancelled_rows:0,already_cancelled:false,run:{status:'CANCELLED_DRAFT',cancelled_by:users.fm.id,cancellation_reason:'Synthetic draft sheet cleanup'}});
 expect((await q(db,"SELECT * FROM audit_log WHERE record_identifier=$1 AND action='PAYROLL_SHEET_CANCELLED'",[f.run.id]))).toHaveLength(1);
 expect((await cancel(f.run.id)).body.result.already_cancelled).toBe(true);
 expect((await q(db,"SELECT * FROM audit_log WHERE record_identifier=$1 AND action='PAYROLL_SHEET_CANCELLED'",[f.run.id]))).toHaveLength(1);
});
test('cancels the complete sheet beyond one page, preserves saved revisions, hides every active read surface and blocks regeneration',async()=>{
 const f=await fixture({factory:true,count:21});await reviewAction(db,f.rows[0].id,'calculate',users.fm.id);await reviewAction(db,f.rows[1].id,'cancel',users.fm.id);
 const saved=await q(db,'SELECT * FROM payroll_review_revisions WHERE row_id=$1',[f.rows[0].id]);const result=await cancel(f.run.id);expect(result.status).toBe(200);expect(result.body.result.cancelled_rows).toBe(20);
 expect((await q(db,'SELECT status FROM payroll_run_employees WHERE run_id=$1',[f.run.id])).every(e=>e.status==='CANCELLED_DRAFT')).toBe(true);
 expect(await q(db,'SELECT * FROM payroll_review_revisions WHERE row_id=$1',[f.rows[0].id])).toEqual(saved);
 const activeQueue=(await request('GET','/review/queue')).body.queue;expect(activeQueue.rows.some(e=>e.run_id===f.run.id)).toBe(false);
 const list=(await request('GET','/runs?page=1&limit=100')).body.selection;expect(list.runs.some(r=>r.id===f.run.id)).toBe(false);
 const register=(await request('GET','/reports/register?limit=100')).body.register;expect(register.rows.some(e=>e.run_id===f.run.id)).toBe(false);
 for(const path of [`/runs/${f.run.id}`,`/runs/${f.run.id}/candidates`,`/review/queue?run_id=${f.run.id}`,`/reports/register?run_id=${f.run.id}`])expect((await request('GET',path)).status).toBe(404);
 expect((await request('POST',`/runs/${f.run.id}/generate`,'fm',{})).status).toBe(409);
 const detail=await request('GET',`/rows/${f.rows[0].id}/review`);expect(detail.status).toBe(200);expect(detail.body.review.available_actions).toEqual([]);expect(detail.body.review.revisions).toHaveLength(1);
 expect((await request('POST',`/rows/${f.rows[0].id}/preview`,'fm',{})).status).toBe(404);
 const e=f.rows[0];expect((await request('POST',`/runs/${f.run.id}/employees`,'fm',{assignment_id:e.assignment_id,period_from:f.from,period_to:f.to})).status).toBe(409);
 await expect(q(db,"UPDATE payroll_runs SET cancellation_reason='changed' WHERE id=$1",[f.run.id])).rejects.toMatchObject({code:'42501'});
});
test('submitted and HO-review rows reject whole-sheet deletion atomically',async()=>{
 const f=await fixture({factory:true,count:2});const row=f.rows[1];await reviewAction(db,row.id,'calculate',users.fm.id);await reviewAction(db,row.id,'submit',users.fm.id);
 const before=await q(db,'SELECT * FROM payroll_run_employees WHERE run_id=$1 ORDER BY id',[f.run.id]);expect((await cancel(f.run.id)).status).toBe(409);expect(await q(db,'SELECT * FROM payroll_run_employees WHERE run_id=$1 ORDER BY id',[f.run.id])).toEqual(before);
 await reviewAction(db,row.id,'forward',users.accounts.id);expect((await cancel(f.run.id)).status).toBe(409);
 await reviewAction(db,row.id,'return',users.ho.id);expect((await cancel(f.run.id)).status).toBe(200);
});
test('authorization, strict body and SQL grants reject other owners and actor/money overrides',async()=>{
 const f=await fixture();for(const role of ['anonymous','otherFm','accounts','admin','ho','je','zo'])expect((await cancel(f.run.id,role)).status).toBe(role==='anonymous'?401:403);
 for(const body of [{},{reason:' '},{reason:'Synthetic',actor_id:users.fm.id},{reason:'Synthetic',amount:'100'},{reason:'x'.repeat(2001)}])expect((await cancel(f.run.id,'fm',body)).status).toBe(400);
 expect((await cancel(crypto.randomUUID())).status).toBe(404);
 const privileges=(await one(db,"SELECT has_function_privilege('service_role','cancel_payroll_draft_run(uuid,text,uuid)','EXECUTE') service,has_function_privilege('authenticated','cancel_payroll_draft_run(uuid,text,uuid)','EXECUTE') browser"));expect(privileges).toEqual({service:true,browser:false});
});
test('Accounts can delete its office sheet and other Accounts cannot',async()=>{
 const f=await fixture({factory:false});expect((await cancel(f.run.id,'reviewer')).status).toBe(403);expect((await cancel(f.run.id,'accounts')).status).toBe(200);
});
test('direct service writes cannot resurrect a cancelled sheet or insert new rows',async()=>{
 const f=await fixture();await cancel(f.run.id);await expect(q(db,"UPDATE payroll_runs SET status='DRAFT',cancelled_at=NULL,cancelled_by=NULL,cancellation_reason=NULL WHERE id=$1",[f.run.id])).rejects.toMatchObject({code:'42501'});
 const other=await fixture();await expect(q(db,'INSERT INTO payroll_run_employees(run_id,employee_id,assignment_id,period_from,period_to,created_by) VALUES($1,$2,$3,$4,$5,$6)',[f.run.id,other.rows[0].employee_id,other.rows[0].assignment_id,f.from,f.to,users.fm.id])).rejects.toMatchObject({code:'PY409'});
 await expect(q(db,"UPDATE payroll_runs SET status='CANCELLED_DRAFT',cancelled_by=$2,cancelled_at=now(),cancellation_reason='Bypass' WHERE id=$1",[other.run.id,users.fm.id])).rejects.toMatchObject({code:'PY409'});
});
test('concurrent submit winning the sheet lock prevents deletion, without cancelling peers',async()=>{
 const f=await fixture({factory:true,count:2});await reviewAction(db,f.rows[0].id,'calculate',users.fm.id);
 const c=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await c.connect();
 try{await q(c,'BEGIN');await reviewAction(c,f.rows[0].id,'submit',users.fm.id);
  const pending=cancel(f.run.id);await new Promise(resolve=>setTimeout(resolve,40));await q(c,'COMMIT');expect((await pending).status).toBe(409);
  expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[f.rows[1].id])).status).toBe('DRAFT');
 }finally{await q(c,'ROLLBACK');await c.end();}
});
test('concurrent deletion winning the sheet lock prevents a stale submit',async()=>{
 const f=await fixture();await reviewAction(db,f.rows[0].id,'calculate',users.fm.id);const row=await one(db,'SELECT * FROM payroll_run_employees WHERE id=$1',[f.rows[0].id]);const fp=(await one(db,'SELECT source_fingerprint FROM payroll_review_revisions WHERE row_id=$1',[row.id])).source_fingerprint;
 const c=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await c.connect();
 try{await q(c,'BEGIN');await q(c,'SELECT cancel_payroll_draft_run($1,$2,$3)',[f.run.id,'Synthetic concurrent deletion',users.fm.id]);
  const pending=request('POST',`/rows/${row.id}/review`,'fm',{action:'submit',expected_version:row.current_version,expected_review_version:row.review_version,source_fingerprint:fp});await new Promise(resolve=>setTimeout(resolve,40));await q(c,'COMMIT');expect((await pending).status).toBe(409);
 }finally{await q(c,'ROLLBACK');await c.end();}
});
