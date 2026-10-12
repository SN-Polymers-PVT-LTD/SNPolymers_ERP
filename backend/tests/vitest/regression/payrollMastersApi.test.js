import {beforeAll,afterAll,describe,test,expect} from 'vitest';
const{Client}=require('pg'),crypto=require('crypto');
const{requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const{generateTokens}=require('../../../src/services/session.service');
const{policy,statutory}=require('../../helpers/payrollMasterFixtures');
const app=require('../../../src/app');let db,server,base;const users={},tokens={};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
async function request(method,path,role='admin',body){const response=await fetch(`${base}/api/v1/auth/hr/payroll/masters${path}`,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};}
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Phase 2 DB fixtures require test:payroll:local or test-local.sh --isolated');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();for(const role of ['admin','accounts','ho','factory_manager','je','zo']){const u=(await q('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING *',[String(crypto.randomInt(7000000000,9999999999)),role,'Synthetic masters HTTP']))[0];users[role]=u.id;const session=(await q('INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]))[0];tokens[role]=generateTokens(u,session.id,crypto.randomUUID()).accessToken;}
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q('UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users)]);await db.end();}});
describe('Phase 2 authenticated HTTP boundary',()=>{
 test('Admin policies and Accounts/Admin statutory reads/writes/publication, no forged actor or status accepted',async()=>{
  expect((await request('GET','/policies','anonymous')).status).toBe(401);
  for(const role of ['accounts','ho','factory_manager','je','zo'])for(const path of ['/policies','/statutory']){if(role==='accounts'&&path==='/statutory'){expect((await request('GET',path,role)).status).toBe(200);continue;}expect((await request('GET',path,role)).status).toBe(403);expect((await request('POST',`${path}/drafts`,role,{id:null,expected_version:0,data:policy()})).status).toBe(403);expect((await request('POST',`${path}/${crypto.randomUUID()}/publish`,role,{})).status).toBe(403);}
  expect((await request('POST','/policies/drafts','admin',{id:null,expected_version:0,data:policy(),actor_id:users.ho})).status).toBe(400);
  expect((await request('POST','/policies/drafts','admin',{id:null,expected_version:0,data:policy({status:'PUBLISHED'})})).status).toBe(400);
 });
 test('draft edit/read preview and CAS errors stay stable; invalid decimal returns 400',async()=>{
  const s=statutory({jurisdiction:`HTTP_TEST_${crypto.randomUUID()}`,verification_status:'UNVERIFIED',advisor_name:null,verification_reference:null,verified_on:null});
  const created=await request('POST','/statutory/drafts','admin',{id:null,expected_version:0,data:s});expect(created.status).toBe(201);const r=created.body.result;
  expect(r.created_by).toBe(users.admin);const p=await request('GET',`/statutory/${r.id}/preview`);expect(p.status).toBe(200);expect(p.body.result.publishable).toBe(false);expect(p.body.result.blockers.map(b=>b.code)).toContain('ADVISOR_VERIFICATION_REQUIRED');
  expect((await request('POST',`/statutory/${r.id}/publish`,'admin',{expected_version:1,preview_token:p.body.result.preview_token,approval_reference:'TEST'})).status).toBe(400);
  expect((await request('POST','/statutory/drafts','admin',{id:r.id,expected_version:1,data:{...s,reason:'Synthetic draft updated'}})).status).toBe(201);
  expect((await request('POST','/statutory/drafts','admin',{id:r.id,expected_version:1,data:s})).status).toBe(409);
  expect((await request('GET','/statutory?limit=101')).status).toBe(400);expect((await request('GET',`/statutory/${crypto.randomUUID()}/preview`)).status).toBe(404);
  const invalid=statutory();invalid.configuration.employee_rate='NaN';expect((await request('POST','/statutory/drafts','admin',{id:null,expected_version:0,data:invalid})).status).toBe(400);
  const resolved=await request('GET',`/statutory/resolve?date=2091-02-01&scheme=EPF&jurisdiction=${s.jurisdiction}&establishment=SYNTHETIC_TEST_ONLY`);expect(resolved.body.result.error).toBe('MISSING_POLICY');
 });
 test('verified synthetic statutory publication then historical resolution; rates not payroll payments',async()=>{
  const s=statutory({jurisdiction:`HTTP_VERIFIED_TEST_${crypto.randomUUID()}`});const bank=await q('SELECT id,available_balance FROM bank_balance_master ORDER BY id');
  const r=(await request('POST','/statutory/drafts','admin',{id:null,expected_version:0,data:s})).body.result;
  const p=(await request('GET',`/statutory/${r.id}/preview`)).body.result;
  const result=await request('POST',`/statutory/${r.id}/publish`,'admin',{expected_version:1,preview_token:p.preview_token,approval_reference:'SYNTHETIC ISOLATED TEST ONLY'});expect(result.status).toBe(200);
  expect((await request('GET',`/statutory/resolve?date=2091-02-01&scheme=EPF&jurisdiction=${s.jurisdiction}&establishment=SYNTHETIC_TEST_ONLY`)).body.result.revision_id).toBe(r.id);
  expect((await request('POST','/statutory/drafts','admin',{id:r.id,expected_version:2,data:s})).status).toBe(409);
  expect(await q('SELECT id,available_balance FROM bank_balance_master ORDER BY id')).toEqual(bank);
 });
 test('typed basis is strict at HTTP boundary and canonical ID lookup preserves warning/source separation',async()=>{
  const s=statutory({jurisdiction:`HTTP_CANONICAL_TEST_${crypto.randomUUID()}`});
  s.configuration.adjustment_basis={SALARY_ARREARS:'UNRESOLVED',BONUS:'EXCLUDE',REIMBURSEMENT:'UNRESOLVED',RECOVERY:'DEDUCTION_ONLY'};
  const bad=structuredClone(s);bad.configuration.adjustment_basis.RECOVERY='INCLUDE';
  expect((await request('POST','/statutory/drafts','admin',{id:null,expected_version:0,data:bad})).status).toBe(400);
  const r=(await request('POST','/statutory/drafts','admin',{id:null,expected_version:0,data:s})).body.result;
  const p=(await request('GET',`/statutory/${r.id}/preview`)).body.result;
  expect(p.blockers).toEqual([]);expect(p.configuration_warnings).toContainEqual({field:'adjustment_basis.SALARY_ARREARS',code:'ADJUSTMENT_CLASSIFICATION_REQUIRED'});
  expect((await request('POST',`/statutory/${r.id}/publish`,'admin',{expected_version:1,preview_token:p.preview_token,approval_reference:'SYNTHETIC ONLY'})).status).toBe(200);
  const scope=(await q('SELECT register_payroll_statutory_scope($1,$2,$3,$4) id',['TEST_'+crypto.randomUUID().replaceAll('-','').toUpperCase(),'HTTP','SYNTHETIC ONLY',users.admin]))[0].id;
  await q('SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[r.id,scope,'SYNTHETIC ONLY',users.admin]);
  const result=await request('GET',`/statutory/resolve?date=2091-02-01&scheme=EPF&statutory_scope_id=${scope}`);
  expect(result.status).toBe(200);expect(result.body.result).toMatchObject({revision_id:r.id,statutory_scope_id:scope,blockers:[],financial_workflows_enabled:false});
  expect((await request('GET','/statutory/resolve?date=2091-02-01&scheme=EPF&statutory_scope_id=forged')).status).toBe(400);
 });
 test('permanent pay API rejects manual contribution fields without losing enrolment and stale Admin loses access',async()=>{
  const e=(await q("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Synthetic masters pay','HO Staff','Head Office','2020-01-01',$1,$1) RETURNING id",[users.admin]))[0];
  const body={employee_id:e.id,pay_basis:'Monthly salary',guaranteed_monthly_gross:1000,epf_enrolment:true,esi_enrolment:true};
  async function pay(data){const r=await fetch(`${base}/api/v1/auth/hr/pay-structures`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`accessToken=${tokens.admin}`},body:JSON.stringify(data)});return{status:r.status,body:await r.json()};}
  for(const field of ['epf_amount','esi_amount','epf_rate','esi_rate'])expect((await pay({...body,[field]:1})).status).toBe(400);
  const saved=await pay(body);expect(saved.status).toBe(201);expect(saved.body.pay_structure).toMatchObject({epf_enrolment:true,esi_enrolment:true});
  await q("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=$2",[users.admin,e.id]);await q("UPDATE authorised_users SET role='accounts' WHERE id=$1",[users.admin]);expect([401,403]).toContain((await request('GET','/policies')).status);
 });
});
