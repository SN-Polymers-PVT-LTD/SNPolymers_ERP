import {beforeAll,afterAll,describe,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');const {generateTokens}=require('../../../src/services/session.service');const {fingerprint}=require('../../../src/domain/payroll/sources');const app=require('../../../src/app');
let db,server,base,row,employee;const users={},tokens={};const q=async(sql,args=[])=>(await db.query(sql,args)).rows;const one=async(sql,args=[])=>(await q(sql,args))[0];
async function request(method,path,role='admin',body){const r=await fetch(base+'/api/v1/auth/hr/payroll'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
beforeAll(async()=>{
 if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Payroll preview HTTP fixtures require isolated Supabase');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();
 for(const role of ['admin','accounts','ho','factory_manager','je','zo']){const u=await one('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING *',[String(crypto.randomInt(7000000000,9999999999)),role,'Synthetic preview HTTP']);users[role]=u.id;const session=await one('INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[role]=generateTokens(u,session.id,crypto.randomUUID()).accessToken;}
 employee=await one("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Synthetic preview HTTP','HO Staff','Head Office','2700-01-01',$1,$1) RETURNING id",[users.admin]);
 const history=await one('SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[employee.id,'ASSIGNMENT',JSON.stringify([{group_code:'HO_STAFF',employee_category:'HO Staff',department:'Head Office',effective_from:'2700-10-01',effective_to:'2700-10-31',employment_joined_on:'2700-01-01'}]),'SYNTHETIC HTTP HISTORY',users.admin]);const a=await one('SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[history.id]);const run=await one("SELECT * FROM create_payroll_draft_run('HO_STAFF','Head Office','2700-10-01','2700-10-31','Monthly',$1)",[users.accounts]);row=await one('SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[run.id,a.id,'2700-10-01','2700-10-31',users.accounts]);
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){if(employee)await q("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=$2",[users.admin,employee.id]);await q('UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users)]);await db.end();}});
describe('authenticated read-only payroll previews',()=>{
 test('scoped roles can inspect sources; forged monetary/actor values and wrong roles are rejected',async()=>{
  for(const role of ['admin','accounts','ho'])expect((await request('POST',`/rows/${row.id}/preview`,role,{})).status).toBe(200);
  for(const role of ['factory_manager','je','zo'])expect((await request('POST',`/rows/${row.id}/preview`,role,{})).status).toBe(403);
  expect((await request('POST',`/rows/${row.id}/preview`,'anonymous',{})).status).toBe(401);
  for(const body of [{monthly_gross:'90000'},{epf_rate:'7'},{actor_id:users.admin},{expected_source_fingerprint:'invalid'}])expect((await request('POST',`/rows/${row.id}/preview`,'accounts',body)).status).toBe(400);
  expect((await request('POST',`/rows/${crypto.randomUUID()}/preview`,'admin',{})).status).toBe(404);
 });
 test('missing sources/statutory profiles are informative blockers with no invented final salary',async()=>{
  const r=(await request('POST',`/rows/${row.id}/preview`,'accounts',{})).body.preview;expect(r.blockers.map(b=>b.code)).toEqual(expect.arrayContaining(['MISSING_PAY_SOURCE','MISSING_POLICY','EMPLOYEE_STATUTORY_PROFILE_REQUIRED']));expect(r.final_net_salary).toBeNull();expect(r.gross_after_lop).toBeNull();expect(r.preview_persisted).toBe(false);
 });
 test('fingerprint checks detect note/source changes and require a fresh preview',async()=>{
  const first=(await request('POST',`/rows/${row.id}/preview`,'accounts',{})).body.preview;expect((await request('POST',`/rows/${row.id}/preview`,'accounts',{expected_source_fingerprint:first.source_fingerprint})).status).toBe(200);
  await q("SELECT revise_payroll_draft_note($1,1,'Refresh authoritative inputs',$2)",[row.id,users.accounts]);
  const stale=await request('POST',`/rows/${row.id}/preview`,'accounts',{expected_source_fingerprint:first.source_fingerprint});expect(stale.status).toBe(409);expect(stale.body.code).toBe('STALE_PAYROLL_PREVIEW');
  const fresh=(await request('POST',`/rows/${row.id}/preview`,'accounts',{})).body.preview;expect(fresh.source_fingerprint).not.toBe(first.source_fingerprint);
 });
 test('two PostgreSQL readers and concurrent HTTP previews are deterministic and do not post or persist',async()=>{
  const count=()=>q("SELECT (SELECT count(*) FROM payroll_row_versions WHERE row_id=$1) versions,(SELECT count(*) FROM payroll_month_allocations) allocations,(SELECT count(*) FROM payroll_employee_coverage) coverage,(SELECT sum(available_balance)::text FROM bank_balance_master) balance",[row.id]);const before=await count();
  const c1=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI}),c2=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await c1.connect();await c2.connect();try{const results=await Promise.all([c1,c2].map(c=>c.query('SELECT get_payroll_preview_sources($1,$2) s',[row.id,users.accounts])));expect(fingerprint(results[0].rows[0].s)).toBe(fingerprint(results[1].rows[0].s));}finally{await c1.end();await c2.end();}
  const results=await Promise.all([request('POST',`/rows/${row.id}/preview`,'accounts',{}),request('POST',`/rows/${row.id}/preview`,'accounts',{})]);expect(results.map(r=>r.status)).toEqual([200,200]);expect(results[0].body.preview.source_fingerprint).toBe(results[1].body.preview.source_fingerprint);expect(await count()).toEqual(before);
 });
 test('a concurrent history transaction is observed atomically and invalidates the prior preview after commit',async()=>{
  const c1=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI}),c2=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await c1.connect();await c2.connect();
  try{
   await c2.query('BEGIN');
   await c2.query('SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[employee.id,'ASSIGNMENT',JSON.stringify([{group_code:'HO_STAFF',employee_category:'HO Staff',department:'Head Office',effective_from:'2700-10-01',effective_to:'2700-10-31',employment_joined_on:'2700-01-01'}]),'SYNTHETIC concurrent history',users.admin]);
   const old=(await c1.query('SELECT get_payroll_preview_sources($1,$2) s',[row.id,users.accounts])).rows[0].s;
   expect(old.history.find(h=>h.source_kind==='ASSIGNMENT').version).toBe(1);
   await c2.query('COMMIT');
   const current=(await c1.query('SELECT get_payroll_preview_sources($1,$2) s',[row.id,users.accounts])).rows[0].s;
   const latest=current.history.find(h=>h.source_kind==='ASSIGNMENT');expect(latest.version).toBe(2);expect(current.assignments.every(a=>a.revision_id===latest.id)).toBe(true);
   expect((await request('POST',`/rows/${row.id}/preview`,'accounts',{expected_source_fingerprint:fingerprint(old)})).status).toBe(409);
  }finally{await c2.query('ROLLBACK');await c1.end();await c2.end();}
 });
 test('run listing is paginated and an existing session cannot retain a revoked account role',async()=>{
  expect((await request('GET','/runs?limit=101')).status).toBe(400);expect((await request('GET','/runs','factory_manager')).body.selection.runs).toEqual([]);
  await q("UPDATE authorised_users SET role='je' WHERE id=$1",[users.accounts]);expect([401,403]).toContain((await request('POST',`/rows/${row.id}/preview`,'accounts',{})).status);
 });
});
