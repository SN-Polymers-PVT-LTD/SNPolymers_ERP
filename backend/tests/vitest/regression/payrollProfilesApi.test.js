import {beforeAll,afterAll,describe,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture,reviewAction}=require('../../helpers/payrollReviewFixtures');
const {interval,scope,save,rule}=require('../../helpers/payrollProfileFixtures');
const {generateTokens}=require('../../../src/services/session.service'),app=require('../../../src/app');
const {calculatePreview}=require('../../../src/domain/payroll/preview');
let db,users,server,base;const tokens={},employees=[];
async function request(method,path,role='admin',body){const r=await fetch(base+'/api/v1/auth/hr/payroll'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
async function fixture(options={}){const f=await createReviewFixture(db,users,options);employees.push(...f.employees.map(e=>e.id));return f;}
const source=async(id)=>(await one(db,'SELECT get_payroll_review_sources($1,$2) r',[id,users.accounts.id])).r;
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);
 for(const [key,u] of Object.entries(users)){const s=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[key]=generateTokens(u,s.id,crypto.randomUUID()).accessToken;}
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employees]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
describe('statutory profiles PostgreSQL/API safe Phase 6A',()=>{
 test('Accounts/Admin authoring/context/history preserve dated versions and explicit canonical bindings',async()=>{
  const f=await fixture(),employee=f.employees[0].id,scopeId=await scope(db,users.admin.id),data=interval(scopeId,f.from,f.to);
  for(const role of ['ho','fm','je','zo']){expect((await request('GET','/statutory-profiles/context',role)).status).toBe(403);expect((await request('GET',`/employees/${employee}/statutory-profile`,role)).status).toBe(403);expect((await request('POST',`/employees/${employee}/statutory-profile`,role,{expected_version:0,intervals:[data],evidence_reference:'Test'})).status).toBe(403);}
  expect((await request('GET','/statutory-profiles/context','anonymous')).status).toBe(401);
  const created=await request('POST',`/employees/${employee}/statutory-profile`,'admin',{expected_version:0,intervals:[data],evidence_reference:'Synthetic complete history'});expect(created.status).toBe(201);expect(created.body.result.version).toBe(1);
  const endNext=`${Number(f.from.slice(0,4))+1}-10-31`;expect((await request('POST',`/employees/${employee}/statutory-profile`,'admin',{expected_version:1,intervals:[{...data,effective_to:endNext}],evidence_reference:'Synthetic corrected complete history'})).status).toBe(201);
  const history=(await request('GET',`/employees/${employee}/statutory-profile`)).body.result;expect(history.version).toBe(2);expect(history.revisions[0].intervals[0].effective_to).toBe(f.to);expect(history.revisions[1].intervals[0].effective_to).toBe(endNext);
  expect((await request('POST',`/employees/${employee}/statutory-profile`,'admin',{expected_version:1,intervals:[data],evidence_reference:'Stale correction'})).status).toBe(409);
  expect((await request('GET','/statutory-profiles/context?search=TEST_')).body.result.scopes.length).toBeGreaterThan(0);
 });
 test('scope registration and binding APIs reuse the protected canonical registry without guessing labels',async()=>{
  const f=await fixture(),code='TEST_'+crypto.randomUUID().replaceAll('-','').toUpperCase();
  const payload={jurisdiction_code:code,establishment_code:'TEST_API_ESTABLISHMENT',evidence_reference:'SYNTHETIC registry identity'};
  expect((await request('POST','/statutory-scopes','fm',payload)).status).toBe(403);const created=await request('POST','/statutory-scopes','admin',payload);expect(created.status).toBe(201);const scopeId=created.body.result;
  const revision=await rule(db,users.admin.id,scopeId,f.from,f.to,false),binding={revision_id:revision,statutory_scope_id:scopeId,evidence_reference:'SYNTHETIC explicit mapping'};
  expect((await request('POST','/statutory-scopes/bind','ho',binding)).status).toBe(403);expect((await request('POST','/statutory-scopes/bind','admin',binding)).status).toBe(201);expect((await request('POST','/statutory-scopes/bind','admin',binding)).status).toBe(409);
  const ctx=(await request('GET','/statutory-profiles/context?search='+code)).body.result;expect(ctx.scopes[0].id).toBe(scopeId);expect(ctx.bindings[0].revision_id).toBe(revision);
 });
 test('invalid mappings, overlaps, verification metadata and missing schemes roll back all profile history writes',async()=>{
  const f=await fixture(),employee=f.employees[0].id,scopeId=await scope(db,users.admin.id),data=interval(scopeId,f.from,f.to);
  const invalid=structuredClone(data);invalid.schemes.PT.statutory_scope_id=crypto.randomUUID();
  const endpoint=`/employees/${employee}/statutory-profile`,body=intervals=>({expected_version:0,intervals,evidence_reference:'Synthetic rollback test'});
  expect((await request('POST',endpoint,'admin',body([invalid]))).status).toBe(400);expect((await request('GET',endpoint)).body.result.version).toBe(0);
  expect((await request('POST',endpoint,'admin',body([data,data]))).status).toBe(409);expect((await request('GET',endpoint)).body.result.revisions).toEqual([]);
  expect((await request('POST',endpoint,'admin',body([{...data,verified_on:'9999-01-01'}]))).status).toBe(400);
  expect((await request('POST',endpoint,'admin',{...body([data]),employee_rate:'12'})).status).toBe(400);
  expect((await one(db,"SELECT count(*)::int n FROM payroll_source_history_revisions WHERE employee_id=$1 AND source_kind='STATUTORY_PROFILE'",[employee])).n).toBe(0);
 });
 test('two actual connections serialize profile updates; history remains immutable and API/database permissions agree',async()=>{
  const f=await fixture(),employee=f.employees[0].id,scopeId=await scope(db,users.admin.id),data=interval(scopeId,f.from,null),other=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await other.connect();
  try{const results=await Promise.allSettled([save(db,employee,users.admin.id,0,[data]),save(other,employee,users.admin.id,0,[data])]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected').reason.code).toBe('PY409');}finally{await other.end();}
  await expect(q(db,'UPDATE payroll_employee_statutory_profiles SET enrolled=false WHERE employee_id=$1',[employee])).rejects.toMatchObject({code:'42501'});
  await expect(q(db,'DELETE FROM payroll_employee_statutory_profiles WHERE employee_id=$1',[employee])).rejects.toMatchObject({code:'42501'});
  const permissions=await one(db,"SELECT has_table_privilege('service_role','payroll_employee_statutory_profiles','select') service_read,has_function_privilege('authenticated','record_payroll_statutory_profiles(uuid,integer,jsonb,text,uuid)','execute') authenticated");expect(permissions).toEqual({service_read:false,authenticated:false});
  expect((await save(db,employee,users.accounts.id,1,[data])).version).toBe(2);
 });
 test('preview sources select only employee scope/rule links, exclude private evidence and do not fabricate deductions or net',async()=>{
  const f=await fixture(),employee=f.employees[0].id,scopeId=await scope(db,users.admin.id),unrelatedScope=await scope(db,users.admin.id);
  const before=await source(f.rows[0].id);expect(before).not.toHaveProperty('statutory_profile_history');
  const selected=await rule(db,users.admin.id,scopeId,f.from,f.to),unrelated=await rule(db,users.admin.id,unrelatedScope,f.from,f.to);
  expect(await source(f.rows[0].id)).toEqual(before); // Unrelated/master-only changes preserve old source fingerprints.
  await save(db,employee,users.admin.id,0,[interval(scopeId,f.from,f.to)]);
  const after=await source(f.rows[0].id);expect(after.statutory_rule_links.map(r=>r.id)).toEqual([selected]);expect(JSON.stringify(after)).not.toContain(unrelated);expect(after.statutory_rules).toEqual([]);
  expect(after.statutory_profiles).toHaveLength(3);for(const p of after.statutory_profiles){expect(p).not.toHaveProperty('basis_reference');expect(p).not.toHaveProperty('advisor_name');expect(p).not.toHaveProperty('verification_reference');}
  const calculation=calculatePreview(after);expect(calculation.statutory[0].status).toBe('BLOCKED');expect(calculation.blockers.map(b=>b.code)).toContain('STATUTORY_COLLECTION_TIMING_REQUIRED');expect(calculation.statutory[0].employee_deduction).toBeNull();expect(calculation.statutory.slice(1).every(r=>r.status==='DOCUMENTED_NOT_APPLICABLE'&&r.employee_deduction==='0.00')).toBe(true);expect(calculation.final_net_salary).toBeNull();expect(calculation.source_fingerprint).not.toBe(calculatePreview(before).source_fingerprint);
  expect((await request('POST',`/rows/${f.rows[0].id}/preview`,'accounts',{})).body.preview.source_references.statutory_profiles).toHaveLength(3);
 });
 test('the granted Factory Manager sees only diagnostic identifiers in both factories, while other managers are denied',async()=>{
  for(const department of ['SNP Factory','Fabric Factory']){
   const f=await fixture({factory:true,department}),scopeId=await scope(db,users.admin.id);
   const revision=await rule(db,users.admin.id,scopeId,f.from,f.to);
   await save(db,f.employees[0].id,users.admin.id,0,[interval(scopeId,f.from,f.to)]);
   const endpoint=`/rows/${f.rows[0].id}/preview`,response=await request('POST',endpoint,'fm',{});
   expect(response.status).toBe(200);expect(response.body.preview.source_references.statutory_rule_links.map(r=>r.id)).toContain(revision);
   const payload=JSON.stringify(response.body);
   for(const privateField of ['SYNTHETIC advisor','ISOLATED TEST ONLY','SYNTHETIC EPF enrolment','employee_rate','establishment'])expect(payload).not.toContain(privateField);
   expect((await request('POST',endpoint,'otherFm',{})).status).toBe(403);
  }
 });
 test('source changes prevent stale approval; even verified profiles leave final locking and all postings blocked',async()=>{
  const f=await fixture(),id=f.rows[0].id,employee=f.employees[0].id,scopeId=await scope(db,users.admin.id);
  await reviewAction(db,id,'calculate',users.accounts.id);await reviewAction(db,id,'submit',users.accounts.id);
  await save(db,employee,users.admin.id,0,[interval(scopeId,f.from,f.to)]);
  await expect(reviewAction(db,id,'approve_lock',users.ho.id)).rejects.toMatchObject({code:'PY409'});
  await reviewAction(db,id,'return',users.ho.id);await reviewAction(db,id,'correct',users.accounts.id,{note:'Refresh evidenced profile'});await reviewAction(db,id,'calculate',users.accounts.id);await reviewAction(db,id,'submit',users.accounts.id);
  const before=await q(db,'SELECT (SELECT count(*) FROM payroll_employee_coverage) coverage,(SELECT count(*) FROM payroll_month_allocations) allocations');
  const result=await reviewAction(db,id,'approve_lock',users.ho.id);expect(result.applied).toBe(false);expect(result.row.status).toBe('PENDING_HO_APPROVAL');expect(result.blockers.map(b=>b.code)).toContain('FINANCIAL_FINALIZATION_DISABLED');
  expect(await q(db,'SELECT (SELECT count(*) FROM payroll_employee_coverage) coverage,(SELECT count(*) FROM payroll_month_allocations) allocations')).toEqual(before);
  const gates=await q(db,"SELECT tgenabled FROM pg_trigger WHERE tgname IN ('payroll_coverage_phase1_gate','payroll_entitlement_phase1_gate','payroll_allocation_phase1_gate')");expect(gates).toHaveLength(3);expect(gates.every(g=>g.tgenabled==='O')).toBe(true);
 });
});
