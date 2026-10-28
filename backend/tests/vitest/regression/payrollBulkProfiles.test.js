import {beforeAll,afterAll,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture}=require('../../helpers/payrollReviewFixtures');const {interval,scope,save}=require('../../helpers/payrollProfileFixtures');
const {generateTokens}=require('../../../src/services/session.service'),app=require('../../../src/app');let db,users,server,base;const tokens={},employees=[];
async function request(method,path,role='accounts',body){const r=await fetch(base+'/api/v1/auth/hr/payroll'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
async function fixture(options={factory:true}){const f=await createReviewFixture(db,users,options);employees.push(...f.employees.map(e=>e.id));return f;}
async function template(f){return interval(await scope(db,users.accounts.id),f.from,f.to,{verification_status:'ACCOUNTS_CONFIRMED'});}
const body=(f,data)=>({employees:f.employees.map(e=>({employee_id:e.id,expected_version:0})),interval:data,evidence_reference:'SYNTHETIC common setup, exceptions excluded'});
const bulk=(data,role='accounts')=>request('POST','/statutory-profiles/bulk',role,data);
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);
 for(const [role,u] of Object.entries(users)){const s=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[role]=generateTokens(u,s.id,crypto.randomUUID()).accessToken;}
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employees]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
test('group candidates filter safely, paginate and expose protected existing profiles and pay enrolment',async()=>{
 const f=await fixture({factory:true,count:21}),data=await template(f),tag='BULK_'+crypto.randomUUID();await q(db,'UPDATE hr_employees SET employee_name=$2,updated_by=$3 WHERE id=ANY($1::uuid[])',[f.employees.map(e=>e.id),tag,users.admin.id]);await save(db,f.employees[0].id,users.accounts.id,0,[data]);
 const url='/statutory-profiles/setup-candidates?search='+tag+'&department=SNP%20Factory&employee_category=SNP%20Casual%20Factory%20Labour';
 const first=await request('GET',url);expect(first.status).toBe(200);expect(first.body.result.total).toBe(20);expect(first.body.result.employees.every(e=>e.profile_version===0&&e.department==='SNP Factory')).toBe(true);
 const all=await request('GET',url+'&unconfigured_only=false&limit=10&page=2');expect(all.body.result.total).toBe(21);expect(all.body.result.employees).toHaveLength(10);
 const other=await request('GET',url.replace('SNP%20Factory','Fabric%20Factory'));expect(other.body.result.total).toBe(0);
 const literal=await request('GET','/statutory-profiles/setup-candidates?search='+encodeURIComponent('%,(employee_name.ilike.*)'));expect(literal.status).toBe(200);expect(literal.body.result.total).toBe(0);
});
test('one confirmed template creates 21 audited profiles without copying deduction rates',async()=>{
 const f=await fixture({factory:true,count:21}),data=await template(f),response=await bulk(body(f,data));expect(response.status).toBe(200);expect(response.body.result.success).toBe(true);expect(response.body.result.results).toHaveLength(21);
 expect((await one(db,"SELECT count(*) count FROM payroll_source_history_revisions WHERE employee_id=ANY($1::uuid[]) AND source_kind='STATUTORY_PROFILE'",[f.employees.map(e=>e.id)])).count).toBe('21');
 expect((await one(db,"SELECT count(*) count FROM payroll_source_history_revisions WHERE employee_id=ANY($1::uuid[]) AND source_kind='STATUTORY_PROFILE' AND created_by=$2",[f.employees.map(e=>e.id),users.accounts.id])).count).toBe('21');
 const rows=await q(db,'SELECT * FROM payroll_employee_statutory_profiles WHERE employee_id=ANY($1::uuid[])',[f.employees.map(e=>e.id)]);expect(rows).toHaveLength(63);expect(rows.every(p=>p.verification_status==='ACCOUNTS_CONFIRMED')).toBe(true);
});
test('existing timelines are preserved; new peer succeeds and rerun cannot create another version',async()=>{
 const f=await fixture({factory:true,count:2}),data=await template(f);await save(db,f.employees[0].id,users.accounts.id,0,[data]);const before=await q(db,'SELECT * FROM payroll_employee_statutory_profiles WHERE employee_id=$1',[f.employees[0].id]);
 const result=(await bulk(body(f,data))).body.result;expect(result.success).toBe(false);expect(result.results.find(r=>r.employee_id===f.employees[0].id)).toMatchObject({success:false,status:409});expect(result.results.find(r=>r.employee_id===f.employees[1].id).success).toBe(true);
 expect(await q(db,'SELECT * FROM payroll_employee_statutory_profiles WHERE employee_id=$1',[f.employees[0].id])).toEqual(before);
 expect((await bulk(body(f,data))).body.result.results.every(r=>!r.success&&r.status===409)).toBe(true);
});
test('joining dates clip the common interval; employees outside it fail without blocking peers',async()=>{
 const f=await fixture({factory:true,count:2}),data=await template(f);data.effective_from=f.from.slice(0,4)+'-09-01';
 await q(db,'UPDATE hr_employees SET joining_date=$2,updated_by=$3 WHERE id=$1',[f.employees[1].id,`${Number(f.from.slice(0,4))+1}-01-01`,users.admin.id]);
 const results=(await bulk(body(f,data))).body.result.results;expect(results.find(r=>r.employee_id===f.employees[0].id)).toMatchObject({success:true,effective_from:f.from});expect(results.find(r=>r.employee_id===f.employees[1].id)).toMatchObject({success:false,status:400});
});
test('permanent enrolment is derived from Employee Management while inactive employees remain protected',async()=>{
 const f=await fixture({factory:false,count:2}),data=await template(f);data.schemes.EPF.enrolled=false;await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$2 WHERE id=$1",[f.employees[1].id,users.admin.id]);
 const result=(await bulk(body(f,data))).body.result;expect(result.results.find(r=>r.employee_id===f.employees[0].id).success).toBe(true);
 expect((await one(db,"SELECT enrolled FROM payroll_employee_statutory_profiles WHERE employee_id=$1 AND scheme='EPF'",[f.employees[0].id])).enrolled).toBe(true);expect(result.results.some(r=>r.status===409&&/no longer active/.test(r.message))).toBe(true);
 expect((await one(db,"SELECT count(*) count FROM payroll_source_history_revisions WHERE employee_id=ANY($1::uuid[]) AND source_kind='STATUTORY_PROFILE'",[f.employees.map(e=>e.id)])).count).toBe('1');
});
test('strict schema, roles and RPC privileges prevent actor/rate/version overrides',async()=>{
 const f=await fixture(),data=await template(f),payload=body(f,data);
 for(const role of ['anonymous','fm','ho','je','zo']){expect((await bulk(payload,role)).status).toBe(role==='anonymous'?401:403);expect((await request('GET','/statutory-profiles/setup-candidates',role)).status).toBe(role==='anonymous'?401:403);}
 for(const bad of [{...payload,p_actor_id:users.admin.id},{...payload,employees:[...payload.employees,...payload.employees]},{...payload,employees:[{employee_id:f.employees[0].id,expected_version:1}]},{...payload,interval:{...data,employee_rate:'12'}}])expect((await bulk(bad)).status).toBe(400);
 const grants=await one(db,"SELECT has_function_privilege('service_role','bulk_record_payroll_statutory_profiles(jsonb,jsonb,text,uuid)','EXECUTE') service,has_function_privilege('authenticated','bulk_record_payroll_statutory_profiles(jsonb,jsonb,text,uuid)','EXECUTE') browser");expect(grants).toEqual({service:true,browser:false});
});
test('missing scope rolls back each failed profile and concurrent initial setup creates only one version',async()=>{
 const f=await fixture(),data=await template(f),bad=structuredClone(data);bad.schemes.PT.statutory_scope_id=crypto.randomUUID();expect((await bulk(body(f,bad))).body.result.results[0]).toMatchObject({success:false,status:400});
 const outcomes=await Promise.all([bulk(body(f,data)),bulk(body(f,data))]);expect(outcomes.map(r=>r.body.result.results[0].success).sort()).toEqual([false,true]);
 expect((await one(db,"SELECT count(*) count FROM payroll_source_history_revisions WHERE employee_id=$1 AND source_kind='STATUTORY_PROFILE'",[f.employees[0].id])).count).toBe('1');
});

test('individual permanent setup ignores duplicate enrolment input and exposes automatic source ownership',async()=>{
 const f=await fixture({factory:false}),data=await template(f);data.schemes.EPF.enrolled=null;data.schemes.ESI.enrolled=true;
 const response=await request('POST',`/employees/${f.employees[0].id}/statutory-profile`,'accounts',{expected_version:0,intervals:[data],evidence_reference:'SYNTHETIC auto enrolment'});expect(response.status).toBe(201);
 const history=await request('GET',`/employees/${f.employees[0].id}/statutory-profile`);expect(history.body.result.enrolment_managed_by_pay_structure).toBe(true);
 expect(history.body.result.revisions[0].intervals[0].schemes).toMatchObject({EPF:{enrolled:true},ESI:{enrolled:false}});
});
test('permanent setup rejects a profile starting outside its dated pay source without writing history',async()=>{
 const f=await fixture({factory:false}),data=await template(f);data.effective_from=f.from.slice(0,4)+'-09-01';
 await expect(save(db,f.employees[0].id,users.accounts.id,0,[data])).rejects.toThrow(/pay source does not cover/);
 expect((await one(db,"SELECT count(*) count FROM payroll_source_history_revisions WHERE employee_id=$1 AND source_kind='STATUTORY_PROFILE'",[f.employees[0].id])).count).toBe('0');
});
test('dated enrolment changes require split profiles and preserve the historical pay flags',async()=>{
 const f=await fixture({factory:false}),id=f.employees[0].id,data=await template(f);
 const old=await one(db,"SELECT id FROM hr_permanent_pay_structures WHERE employee_id=$1 AND status='Active'",[id]);
 const next=await one(db,"SELECT (create_hr_pay_structure($1,'Monthly salary',30000,false,true,'Active',$2)).*",[id,users.admin.id]);
 const year=f.from.slice(0,4),middle=year+'-10-15',last=year+'-10-14';
 await q(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[id,'PERMANENT_PAY',JSON.stringify([{pay_structure_id:old.id,effective_from:f.from,effective_to:last},{pay_structure_id:next.id,effective_from:middle,effective_to:f.to}]),'SYNTHETIC dated enrolment change',users.admin.id]);
 await expect(save(db,id,users.accounts.id,0,[data])).rejects.toThrow(/split the statutory interval/);
 await save(db,id,users.accounts.id,0,[{...data,effective_to:last},{...data,effective_from:middle}]);
 const rows=await q(db,"SELECT effective_from::text,enrolled FROM payroll_employee_statutory_profiles WHERE employee_id=$1 AND scheme='EPF' ORDER BY effective_from",[id]);expect(rows).toEqual([{effective_from:f.from,enrolled:true},{effective_from:middle,enrolled:false}]);
});

// Salary setup creates NULL end dates; both entry points must accept them.
async function ongoingSalary(f) {
 const id=f.employees[0].id;
 const pay=await one(db,"SELECT id FROM hr_permanent_pay_structures WHERE employee_id=$1 AND status='Active'",[id]);
 await q(db,"SELECT record_payroll_source_history($1,'PERMANENT_PAY',$2,'SYNTHETIC ongoing salary',$3)",[id,JSON.stringify([{pay_structure_id:pay.id,effective_from:f.from,effective_to:null}]),users.admin.id]);
}
test.each(['individual','bulk'])('ongoing salary supports %s statutory assignment with enrolment and audit retained',async path=>{
 const f=await fixture({factory:false}),data=await template(f);await ongoingSalary(f);
 const response=path==='bulk'?await bulk(body(f,data)):await request('POST',`/employees/${f.employees[0].id}/statutory-profile`,'accounts',{expected_version:0,intervals:[data],evidence_reference:'SYNTHETIC ongoing salary assignment'});
 expect(response.status).toBe(path==='bulk'?200:201);if(path==='bulk')expect(response.body.result.results[0].success).toBe(true);
 const records=await q(db,"SELECT p.scheme,p.enrolled,h.created_by FROM payroll_employee_statutory_profiles p JOIN payroll_source_history_revisions h ON h.id=p.revision_id WHERE p.employee_id=$1",[f.employees[0].id]);
 expect(records).toHaveLength(3);expect(records.every(r=>r.created_by===users.accounts.id)).toBe(true);
 expect(records.find(r=>r.scheme==='EPF').enrolled).toBe(true);expect(records.find(r=>r.scheme==='ESI').enrolled).toBe(false);
});
test.each(['start','end'])('finite salary includes its exact %s boundary',async boundary=>{
 const f=await fixture({factory:false}),data=await template(f);if(boundary==='end')data.effective_from=f.to;
 await expect(save(db,f.employees[0].id,users.accounts.id,0,[data])).resolves.toMatchObject({version:1});
});
test('profile after finite salary end is rejected without history writes',async()=>{
 const f=await fixture({factory:false}),data=await template(f);const next=new Date(f.to+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);data.effective_from=next.toISOString().slice(0,10);data.effective_to=null;
 await expect(save(db,f.employees[0].id,users.accounts.id,0,[data])).rejects.toThrow(/pay source does not cover/);
 expect((await one(db,"SELECT count(*) count FROM payroll_source_history_revisions WHERE employee_id=$1 AND source_kind='STATUTORY_PROFILE'",[f.employees[0].id])).count).toBe('0');
});
