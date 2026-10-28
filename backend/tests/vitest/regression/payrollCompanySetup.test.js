import {beforeAll,afterAll,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture}=require('../../helpers/payrollReviewFixtures');
const {pt,statutory}=require('../../helpers/payrollMasterFixtures');
const {generateTokens}=require('../../../src/services/session.service'),app=require('../../../src/app');
let db,users,server,base,state;const tokens={},employees=[];
const from='6800-01-01',to='6800-12-31';
async function request(method,path,role='accounts',body){const r=await fetch(base+'/api/v1/auth/hr/payroll'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
async function rule(scheme='PT',publish=true,extra={}){const data=(scheme==='PT'?pt:statutory)({state_id:state.id,jurisdiction:state.name,establishment:'SYNTHETIC '+crypto.randomUUID(),effective_from:from,effective_to:to,...(scheme!=='PT'?{scheme}:{}),...extra});const d=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify(data),users.accounts.id])).r;
 if(publish){const preview=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[d.id,users.accounts.id])).r;await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC ONLY',$3)",[d.id,preview.preview_token,users.accounts.id]);}return d.id;}
const payload=rules=>({state_id:state.id,establishment:'Synthetic establishment '+crypto.randomUUID(),effective_from:from,rules,evidence_reference:''});
async function fixture(){const f=await createReviewFixture(db,users,{factory:true,count:2});employees.push(...f.employees.map(e=>e.id));return f;}
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);for(const [key,u]of Object.entries(users)){const s=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[key]=generateTokens(u,s.id,crypto.randomUUID()).accessToken;}state=(await one(db,"SELECT register_payroll_statutory_state($1,$2) r",['Synthetic State '+crypto.randomUUID().replace(/[0-9-]/g,'a'),users.accounts.id])).r;server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
afterAll(async()=>{if(server)await new Promise(r=>server.close(r));if(db){await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employees]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
test('Accounts saves named setup and bindings atomically; lists/selects by state/date and preserves history',async()=>{const ptId=await rule(),epf=await rule('EPF');const data=payload({PT:ptId,EPF:epf});const r=await request('POST','/company-deduction-setups','accounts',data);expect(r.status).toBe(201);expect(r.body.result).toMatchObject({establishment_name:data.establishment,state_name:state.name,effective_from:from,effective_to:to,created_by:users.accounts.id});const c=r.body.result;expect((await q(db,'SELECT * FROM payroll_statutory_scope_bindings WHERE statutory_scope_id=$1',[c.statutory_scope_id])).map(b=>b.revision_id).sort()).toEqual([ptId,epf].sort());expect((await request('GET','/company-deduction-setups?search='+encodeURIComponent(data.establishment))).body.result.setups.map(s=>s.id)).toContain(c.id);
 const options=(await request('GET','/company-deduction-setups/options?'+new URLSearchParams({state_id:state.id,date:from,limit:100}))).body.result;expect(options.rules.map(r=>r.id)).toContain(ptId);expect((await request('GET','/company-deduction-setups/options?'+new URLSearchParams({state_id:state.id,date:'6799-01-01'}))).body.result.total).toBe(0);
 await expect(q(db,'UPDATE payroll_company_deduction_setups SET establishment_name=$2 WHERE id=$1',[c.id,'Override'])).rejects.toMatchObject({code:'42501'});
});
test('Admin and all other roles are denied setup writes at HTTP and PostgreSQL boundaries',async()=>{const data=payload({PT:crypto.randomUUID()});for(const role of ['admin','ho','fm','je','zo']){expect((await request('POST','/company-deduction-setups',role,data)).status).toBe(403);expect((await request('POST','/employees/'+crypto.randomUUID()+'/statutory-profile',role,{})).status).toBe(403);await expect(q(db,'SELECT save_payroll_company_deduction_setup($1,$2,$3,$4,$5,$6)',[state.id,data.establishment,from,JSON.stringify(data.rules),'',users[role].id])).rejects.toMatchObject({code:'42501'});}
 await expect(q(db,'SELECT register_payroll_statutory_scope($1,$2,$3,$4)',['TEST','TEST','Synthetic',users.admin.id])).rejects.toMatchObject({code:'42501'});
 await expect(q(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2)",[JSON.stringify(pt()),users.admin.id])).rejects.toMatchObject({code:'42501'});
 expect((await request('POST','/company-deduction-setups','anonymous',data)).status).toBe(401);
});
test('drafts, wrong schemes, wrong states and foreign bindings never leave partial setup/binding writes',async()=>{const draft=await rule('PT',false),epf=await rule('EPF');for(const rules of [{PT:draft},{PT:epf}])expect((await request('POST','/company-deduction-setups','accounts',payload(rules))).status).toBe(400);
 const ptId=await rule(),first=payload({PT:ptId});const c=(await request('POST','/company-deduction-setups','accounts',first)).body.result;const extra=await rule('EPF');const before=(await one(db,'SELECT count(*)::int n FROM payroll_statutory_scope_bindings')).n;
 expect((await request('POST','/company-deduction-setups','accounts',payload({EPF:extra,PT:ptId}))).status).toBe(409);expect((await one(db,'SELECT count(*)::int n FROM payroll_statutory_scope_bindings')).n).toBe(before);
 const wrongState=(await one(db,"SELECT id FROM payroll_statutory_states WHERE id<>$1 LIMIT 1",[state.id])).id;
 expect((await request('POST','/company-deduction-setups','accounts',{...payload({EPF:extra}),state_id:wrongState})).status).toBe(400);
 expect((await request('POST','/company-deduction-setups','accounts',{...first,p_actor_id:users.admin.id})).status).toBe(400);
 expect((await request('POST','/company-deduction-setups','accounts',first)).status).toBe(409);expect(c.id).toBeTruthy();
});
test('concurrent duplicate company saves produce one setup and a stable conflict',async()=>{const data=payload({PT:await rule()});const results=await Promise.all([request('POST','/company-deduction-setups','accounts',data),request('POST','/company-deduction-setups','accounts',data)]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);});
test('employee assignment derives confirmation, clips joining date and rejects existing profiles independently',async()=>{const f=await fixture(),data=payload({PT:await rule()});const c=(await request('POST','/company-deduction-setups','accounts',data)).body.result;
 const join='6800-02-01';await q(db,'UPDATE hr_employees SET joining_date=$2,updated_by=$3 WHERE id=ANY($1::uuid[])',[f.employees.map(e=>e.id),join,users.admin.id]);
 const body={setup_id:c.id,effective_from:from,employees:f.employees.map(e=>({employee_id:e.id,expected_version:0}))};const first=await request('POST','/company-deduction-setups/apply','accounts',body);expect(first.status).toBe(200);expect(first.body.result.results.every(r=>r.success)).toBe(true);expect(first.body.result.results[0].effective_from).toBe(join);
 const profiles=await q(db,'SELECT * FROM payroll_employee_statutory_profiles WHERE employee_id=$1',[f.employees[0].id]);expect(profiles).toHaveLength(3);expect(profiles.find(p=>p.scheme==='PT')).toMatchObject({statutory_scope_id:c.statutory_scope_id,verification_status:'ACCOUNTS_CONFIRMED',advisor_name:users.accounts.display_name});expect(profiles.find(p=>p.scheme==='EPF').applicability).toBe('NOT_APPLICABLE');
 const again=await request('POST','/company-deduction-setups/apply','accounts',body);expect(again.body.result.results.every(r=>!r.success&&r.status===409)).toBe(true);
 expect((await request('POST','/company-deduction-setups/apply','accounts',{...body,effective_from:'6799-01-01'})).status).toBe(400);
 expect((await request('POST','/company-deduction-setups/apply','admin',body)).status).toBe(403);
});
test('required PT and EPF rules cannot be silently omitted; no public table/RPC grants',async()=>{const f=await fixture(),data=payload({EPF:await rule('EPF')});const c=(await request('POST','/company-deduction-setups','accounts',data)).body.result;
 expect((await request('POST','/company-deduction-setups/apply','accounts',{setup_id:c.id,effective_from:from,employees:[{employee_id:f.employees[0].id,expected_version:0}]})).status).toBe(400);
 const access=await one(db,"SELECT has_table_privilege('service_role','payroll_company_deduction_setups','SELECT') table_access,has_function_privilege('authenticated','save_payroll_company_deduction_setup(uuid,text,date,jsonb,text,uuid)','EXECUTE') rpc_access");expect(access).toEqual({table_access:false,rpc_access:false});
});

test('permanent employees enrolled in EPF cannot receive a PT-only confirmed profile',async()=>{
 const f=await createReviewFixture(db,users);employees.push(...f.employees.map(e=>e.id));
 const ptId=await rule('PT',true,{effective_from:f.from,effective_to:f.to});
 const data={...payload({PT:ptId}),effective_from:f.from};
 const c=(await request('POST','/company-deduction-setups','accounts',data)).body.result;
 const r=await request('POST','/company-deduction-setups/apply','accounts',{setup_id:c.id,effective_from:f.from,employees:[{employee_id:f.employees[0].id,expected_version:0}]});
 expect(r.status).toBe(200);expect(r.body.result.results[0]).toMatchObject({success:false,status:400});
 expect(r.body.result.results[0].message).toMatch(/EPF/);
 expect((await one(db,"SELECT count(*)::int n FROM payroll_source_history_revisions WHERE employee_id=$1 AND source_kind='STATUTORY_PROFILE'",[f.employees[0].id])).n).toBe(0);
});

test.each([[false,false,201],[true,true,201],[true,false,400]])('individual HTTP setup derives EPF enrolment %s with EPF rule %s',async(enrolled,includeEpf,status)=>{
 const f=await createReviewFixture(db,users,{epfEnrolment:enrolled,esiEnrolment:false});employees.push(...f.employees.map(e=>e.id));const employee=f.employees[0].id;
 const ptId=await rule('PT',true,{effective_from:f.from,effective_to:f.to});
 const rules={PT:ptId,...(includeEpf?{EPF:await rule('EPF',true,{effective_from:f.from,effective_to:f.to})}:{})};
 const c=(await request('POST','/company-deduction-setups','accounts',{...payload(rules),effective_from:f.from})).body.result;
 const interval={effective_from:f.from,effective_to:f.to,verification_status:'ACCOUNTS_CONFIRMED',advisor_name:'Accounts',verification_reference:'SYNTHETIC individual setup',verified_on:'2020-01-01',schemes:Object.fromEntries(['EPF','ESI','PT'].map(s=>[s,{statutory_scope_id:s==='PT'||(s==='EPF'&&includeEpf)?c.statutory_scope_id:null,applicability:s==='PT'||(s==='EPF'&&includeEpf)?'APPLICABLE':'NOT_APPLICABLE',enrolled:null,basis_reference:'SYNTHETIC individual setup'}]))};
 const r=await request('POST',`/employees/${employee}/statutory-profile`,'accounts',{expected_version:0,intervals:[interval],evidence_reference:'SYNTHETIC individual setup'});
 expect(r.status).toBe(status);
 if(status===400){expect((await one(db,"SELECT count(*)::int n FROM payroll_source_history_revisions WHERE employee_id=$1 AND source_kind='STATUTORY_PROFILE'",[employee])).n).toBe(0);return;}
 const saved=await q(db,'SELECT scheme,applicability,enrolled,statutory_scope_id FROM payroll_employee_statutory_profiles WHERE employee_id=$1',[employee]);
 expect(saved.find(s=>s.scheme==='EPF')).toMatchObject({applicability:enrolled?'APPLICABLE':'NOT_APPLICABLE',enrolled,statutory_scope_id:enrolled?c.statutory_scope_id:null});
 expect(saved.find(s=>s.scheme==='ESI')).toMatchObject({applicability:'NOT_APPLICABLE',enrolled:false,statutory_scope_id:null});
 expect(saved.find(s=>s.scheme==='PT')).toMatchObject({applicability:'APPLICABLE',statutory_scope_id:c.statutory_scope_id});
});

test('legacy adoption preserves the immediately preceding history but rejects new backdating and resurrection',async()=>{
 const {scope,save,interval}=require('../../helpers/payrollProfileFixtures');
 const f=await createReviewFixture(db,users,{factory:true,count:3});employees.push(...f.employees.map(e=>e.id));const employee=f.employees[0].id,newEmployee=f.employees[1].id,unverifiedEmployee=f.employees[2].id,scopeId=await scope(db,users.accounts.id);
 const revision=await rule('PT');await q(db,"SELECT bind_payroll_statutory_scope($1,$2,'SYNTHETIC legacy binding',$3)",[revision,scopeId,users.accounts.id]);
 const old=interval(scopeId,from,to);await save(db,employee,users.accounts.id,0,[old]);
 const unverified={...old,verification_status:'UNVERIFIED',advisor_name:null,verification_reference:null,verified_on:null};await save(db,unverifiedEmployee,users.accounts.id,0,[unverified]);
 const c=await request('POST','/company-deduction-setups','accounts',{...payload({PT:revision}),effective_from:'6800-07-01'});expect(c.status).toBe(201);
 expect((await save(db,employee,users.accounts.id,1,[old])).version).toBe(2);
 // Narrowing the old interval is needed when adding a dated change.
 const narrowed=interval(scopeId,from,'6800-06-30');
 expect((await save(db,employee,users.accounts.id,2,[narrowed])).version).toBe(3);
 await expect(save(db,newEmployee,users.accounts.id,0,[old])).rejects.toMatchObject({code:'22023'});
 await expect(save(db,unverifiedEmployee,users.accounts.id,1,[old])).rejects.toMatchObject({code:'22023'});
 // A prior superseded revision cannot be used to resurrect removed coverage.
 await expect(save(db,employee,users.accounts.id,3,[old])).rejects.toMatchObject({code:'22023'});
 const history=(await one(db,'SELECT get_payroll_statutory_profiles($1,$2) r',[employee,users.accounts.id])).r;
 expect(history.version).toBe(3);expect(history.revisions[0].intervals[0].effective_to).toBe(to);
});
