import {beforeAll,afterAll,describe,test,expect} from 'vitest';
const{Client}=require('pg'),crypto=require('crypto');
const{requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const{generateTokens}=require('../../../src/services/session.service');
const{policy,statutory}=require('../../helpers/payrollMasterFixtures');
const app=require('../../../src/app');let db,server,base;const users={},tokens={};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
async function request(method,path,role=path.startsWith('/statutory')?'accounts':'admin',body){const response=await fetch(`${base}/api/v1/auth/hr/payroll/masters${path}`,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};}
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Phase 2 DB fixtures require test:payroll:local or test-local.sh --isolated');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();for(const role of ['admin','accounts','ho','factory_manager','je','zo']){const u=(await q('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING *',[String(crypto.randomInt(7000000000,9999999999)),role,'Synthetic masters HTTP']))[0];users[role]=u.id;const session=(await q('INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]))[0];tokens[role]=generateTokens(u,session.id,crypto.randomUUID()).accessToken;}
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q('UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users)]);await db.end();}});
describe('Phase 2 authenticated HTTP boundary',()=>{
 test('Admin policies and Accounts-only statutory reads/writes/publication, no forged actor or status accepted',async()=>{
  expect((await request('GET','/policies','anonymous')).status).toBe(401);
  for(const role of ['accounts','ho','factory_manager','je','zo'])for(const path of ['/policies','/statutory']){if(role==='accounts'&&path==='/statutory'){expect((await request('GET',path,role)).status).toBe(200);continue;}expect((await request('GET',path,role)).status).toBe(403);expect((await request('POST',`${path}/drafts`,role,{id:null,expected_version:0,data:policy()})).status).toBe(403);expect((await request('POST',`${path}/${crypto.randomUUID()}/publish`,role,{})).status).toBe(403);}
  expect((await request('POST','/policies/drafts','admin',{id:null,expected_version:0,data:policy(),actor_id:users.ho})).status).toBe(400);
  expect((await request('POST','/policies/drafts','admin',{id:null,expected_version:0,data:policy({status:'PUBLISHED'})})).status).toBe(400);
 });
 test('draft edit/read preview and CAS errors stay stable; invalid decimal returns 400',async()=>{
  const s=statutory({jurisdiction:`HTTP_TEST_${crypto.randomUUID()}`,verification_status:'UNVERIFIED',advisor_name:null,verification_reference:null,verified_on:null});
  const created=await request('POST','/statutory/drafts','accounts',{id:null,expected_version:0,data:s});expect(created.status).toBe(201);const r=created.body.result;
  expect(r.created_by).toBe(users.accounts);const p=await request('GET',`/statutory/${r.id}/preview`);expect(p.status).toBe(200);expect(p.body.result.publishable).toBe(true);expect(r.verification_status).toBe('ACCOUNTS_CONFIRMED');expect(r.verification_reference).toBe(s.reason);
  expect((await request('POST','/statutory/drafts','accounts',{id:r.id,expected_version:1,data:{...s,reason:'Synthetic draft updated'}})).status).toBe(201);
  expect((await request('POST','/statutory/drafts','accounts',{id:r.id,expected_version:1,data:s})).status).toBe(409);
  expect((await request('GET','/statutory?limit=101')).status).toBe(400);expect((await request('GET',`/statutory/${crypto.randomUUID()}/preview`)).status).toBe(404);
  const invalid=statutory();invalid.configuration.employee_rate='NaN';expect((await request('POST','/statutory/drafts','accounts',{id:null,expected_version:0,data:invalid})).status).toBe(400);
  const resolved=await request('GET',`/statutory/resolve?date=2091-02-01&scheme=EPF&jurisdiction=${s.jurisdiction}&establishment=SYNTHETIC_TEST_ONLY`);expect(resolved.body.result.error).toBe('MISSING_POLICY');
 });
 test('verified synthetic statutory publication then historical resolution; rates not payroll payments',async()=>{
  const s=statutory({jurisdiction:`HTTP_VERIFIED_TEST_${crypto.randomUUID()}`});const bank=await q('SELECT id,available_balance FROM bank_balance_master ORDER BY id');
  const r=(await request('POST','/statutory/drafts','accounts',{id:null,expected_version:0,data:s})).body.result;
  const p=(await request('GET',`/statutory/${r.id}/preview`)).body.result;
  const result=await request('POST',`/statutory/${r.id}/publish`,'accounts',{expected_version:1,preview_token:p.preview_token,approval_reference:'SYNTHETIC ISOLATED TEST ONLY'});expect(result.status).toBe(200);
  expect((await request('GET',`/statutory/resolve?date=2091-02-01&scheme=EPF&jurisdiction=${s.jurisdiction}&establishment=SYNTHETIC_TEST_ONLY`)).body.result.revision_id).toBe(r.id);
  expect((await request('POST','/statutory/drafts','accounts',{id:r.id,expected_version:2,data:s})).status).toBe(409);
  expect(await q('SELECT id,available_balance FROM bank_balance_master ORDER BY id')).toEqual(bank);
 });
 test('typed basis is strict at HTTP boundary and canonical ID lookup preserves warning/source separation',async()=>{
  const s=statutory({jurisdiction:`HTTP_CANONICAL_TEST_${crypto.randomUUID()}`});
  s.configuration.adjustment_basis={SALARY_ARREARS:'UNRESOLVED',BONUS:'EXCLUDE',REIMBURSEMENT:'UNRESOLVED',RECOVERY:'DEDUCTION_ONLY'};
  const bad=structuredClone(s);bad.configuration.adjustment_basis.RECOVERY='INCLUDE';
  expect((await request('POST','/statutory/drafts','accounts',{id:null,expected_version:0,data:bad})).status).toBe(400);
  const r=(await request('POST','/statutory/drafts','accounts',{id:null,expected_version:0,data:s})).body.result;
  const p=(await request('GET',`/statutory/${r.id}/preview`)).body.result;
  expect(p.blockers).toEqual([]);expect(p.configuration_warnings).toContainEqual({field:'adjustment_basis.SALARY_ARREARS',code:'ADJUSTMENT_CLASSIFICATION_REQUIRED'});
  expect((await request('POST',`/statutory/${r.id}/publish`,'accounts',{expected_version:1,preview_token:p.preview_token,approval_reference:'SYNTHETIC ONLY'})).status).toBe(200);
  const scope=(await q('SELECT register_payroll_statutory_scope($1,$2,$3,$4) id',['TEST_'+crypto.randomUUID().replaceAll('-','').toUpperCase(),'HTTP','SYNTHETIC ONLY',users.accounts]))[0].id;
  await q('SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[r.id,scope,'SYNTHETIC ONLY',users.accounts]);
  const result=await request('GET',`/statutory/resolve?date=2091-02-01&scheme=EPF&statutory_scope_id=${scope}`);
  expect(result.status).toBe(200);expect(result.body.result).toMatchObject({revision_id:r.id,statutory_scope_id:scope,blockers:[],financial_workflows_enabled:false});
  expect((await request('GET','/statutory/resolve?date=2091-02-01&scheme=EPF&statutory_scope_id=forged')).status).toBe(400);
 });
 test('permanent pay API rejects manual contribution fields without losing enrolment and stale Admin loses access',async()=>{
  const e=(await q("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Synthetic masters pay','HO Staff','Head Office','2020-01-01',$1,$1) RETURNING id",[users.admin]))[0];
  const body={pay_basis:'Monthly salary',guaranteed_monthly_gross:1000,epf_enrolment:true,esi_enrolment:true};
  async function pay(data){const r=await fetch(`${base}/api/v1/auth/hr/pay-structures/payroll-salary`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`accessToken=${tokens.admin}`},body:JSON.stringify({employee_id:e.id,existing_id:null,effective_from:'2020-01-01',expected_version:0,pay:data,reason:'Confirmed HTTP salary terms'})});return{status:r.status,body:await r.json()};}
  for(const field of ['epf_amount','esi_amount','epf_rate','esi_rate'])expect((await pay({...body,[field]:1})).status).toBe(400);
  const saved=await pay(body);expect(saved.status).toBe(200);expect(saved.body.result.context.version).toBe(1);
  await q("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=$2",[users.admin,e.id]);await q("UPDATE authorised_users SET role='accounts' WHERE id=$1",[users.admin]);expect([401,403]).toContain((await request('GET','/policies')).status);
 });
});

test('HTTP save needs no confirmation fields, rejects retired components and returns the authenticated Accounts confirmation',async()=>{
 const s=statutory({jurisdiction:`AUTO_TEST_${crypto.randomUUID()}`});for(const field of ['verification_status','advisor_name','verification_reference','verified_on'])delete s[field];
 const result=await request('POST','/statutory/drafts','accounts',{id:null,expected_version:0,data:s});
 expect(result.status).toBe(201);expect(result.body.result).toMatchObject({verification_status:'ACCOUNTS_CONFIRMED',advisor_name:'Synthetic masters HTTP',verification_reference:s.reason,created_by:users.accounts});
 for(const name of ['BASIC','STAFF_WELFARE','OTHER_FIXED']){
  const data={...s,configuration:{...s.configuration,included_components:[name]}};
  expect((await request('POST','/statutory/drafts','accounts',{id:null,expected_version:0,data})).status).toBe(400);
 }
 const pay=await request('POST','/statutory/drafts','accounts',{id:result.body.result.id,expected_version:1,data:{...s,advisor_name:'Forged',verified_on:'2099-01-01',verification_status:'ADVISOR_VERIFIED',verification_reference:'Forged'}});
 expect(pay.status).toBe(201);expect(pay.body.result.advisor_name).toBe('Synthetic masters HTTP');expect(pay.body.result.verified_on).not.toBe('2099-01-01');
});

test('historical initialization is an explicit Accounts-only HTTP path with a separate preview token',async()=>{
 const data=statutory({jurisdiction:'INITIAL HTTP',establishment:crypto.randomUUID(),effective_from:'2025-01-01',effective_to:'2025-12-31'});
 const saved=await request('POST','/statutory/drafts','accounts',{id:null,expected_version:0,data});expect(saved.status).toBe(201);const r=saved.body.result;
 const normal=await request('GET',`/statutory/${r.id}/preview`);expect(normal.body.result.publishable).toBe(false);
 expect((await request('GET',`/statutory/${r.id}/preview?initial_setup=true`,'ho')).status).toBe(403);
 const initial=await request('GET',`/statutory/${r.id}/preview?initial_setup=true`);expect(initial.status).toBe(200);expect(initial.body.result).toMatchObject({initial_setup:true,publishable:true});
 const input={expected_version:r.version,preview_token:initial.body.result.preview_token,approval_reference:'HTTP initial setup approval',initial_setup:true};
 expect((await request('POST',`/statutory/${r.id}/publish`,'accounts',{...input,initial_setup:'true'})).status).toBe(400);
 expect((await request('POST',`/statutory/${r.id}/publish`,'accounts',{...input,initial_setup:false})).status).toBe(409);
 expect((await request('POST',`/statutory/${r.id}/publish`,'accounts',input)).status).toBe(200);
});
