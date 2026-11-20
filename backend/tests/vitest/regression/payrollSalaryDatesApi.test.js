import {beforeAll,afterAll,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto'),{requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {generateTokens}=require('../../../src/services/session.service'),app=require('../../../src/app');
let db,server,url,employee;const users={},tokens={};
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const request=async(method,path,role='admin',body)=>{const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',Cookie:`accessToken=${tokens[role]}`},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();for(const role of ['admin','accounts']){users[role]=await one("INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,'Dated salary HTTP',true) RETURNING *",[String(crypto.randomInt(7000000000,9999999999)),role]);const session=await one('INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[users[role].id,crypto.randomUUID()]);tokens[role]=generateTokens(users[role],session.id,crypto.randomUUID()).accessToken;}employee=(await one("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Dated HTTP employee','HO Staff','Head Office','2025-01-01',$1,$1) RETURNING id",[users.admin.id])).id;server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));url=`http://127.0.0.1:${server.address().port}/api/v1/auth/hr/pay-structures`;});
afterAll(async()=>{if(server)await new Promise(r=>server.close(r));if(db){
 const hasAssignment=await one("SELECT count(*)::int n FROM payroll_source_history_revisions WHERE employee_id=$1 AND source_kind='ASSIGNMENT'",[employee]);
 if(hasAssignment.n)await db.query("SELECT record_payroll_source_history($1,'ASSIGNMENT',$2,'Close synthetic HTTP fixture applicability',$3)",[employee,JSON.stringify([{group_code:'HO_STAFF',employee_category:'HO Staff',department:'Head Office',effective_from:'2025-01-01',effective_to:'2025-12-31',employment_joined_on:'2025-01-01'}]),users.admin.id]);
 await db.query("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=$2",[users.admin.id,employee]);await db.query('UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
test('dated salary and context endpoints enforce Admin ownership, exact requests and version conflicts',async()=>{
 const path=`/employees/${employee}/payroll-context`;expect((await request('GET',path,'accounts')).status).toBe(403);expect((await request('GET',path)).body.result.version).toBe(0);
 const input={employee_id:employee,existing_id:null,effective_from:'2025-01-01',expected_version:0,pay:{pay_basis:'Monthly salary',guaranteed_monthly_gross:18000,epf_enrolment:true,esi_enrolment:false},reason:'Confirmed starting terms'};
 expect((await request('POST','/payroll-salary','accounts',input)).status).toBe(403);expect((await request('POST','/payroll-salary','admin',{...input,actor_id:users.accounts.id})).status).toBe(400);
 const saved=await request('POST','/payroll-salary','admin',input);expect(saved.status).toBe(200);expect(saved.body.result.context.version).toBe(1);expect((await request('POST','/payroll-salary','admin',input)).status).toBe(409);
 const assignment={employee_id:employee,effective_from:'2025-01-01',reason:'Confirmed initial category'};expect((await request('POST','/initial-assignment','admin',assignment)).status).toBe(200);expect((await request('POST','/initial-assignment','admin',assignment)).status).toBe(409);
});

test('retired undated creation endpoint is gone and cannot change HR salary',async()=>{
 const input={employee_id:employee,pay_basis:'Monthly salary',guaranteed_monthly_gross:22000,epf_enrolment:true,esi_enrolment:true};
 expect((await request('POST','/','admin',input)).status).toBe(404);
 const blocked=await db.query("SELECT has_function_privilege('service_role','create_hr_pay_structure(uuid,text,numeric,boolean,boolean,text,uuid)','EXECUTE') service,has_function_privilege('authenticated','create_hr_pay_structure(uuid,text,numeric,boolean,boolean,text,uuid)','EXECUTE') browser");expect(blocked.rows[0]).toEqual({service:false,browser:false});
 const actual=await db.query("SELECT guaranteed_monthly_gross::text gross FROM hr_permanent_pay_structures WHERE employee_id=$1 AND status='Active'",[employee]);expect(actual.rows[0].gross).toBe('18000.00');
});
test('mapped salary suspension returns a stable conflict and preserves Active salary and its date coverage',async()=>{
 const current=await one("SELECT id FROM hr_permanent_pay_structures WHERE employee_id=$1 AND status='Active'",[employee]);
 const before=(await request('GET',`/employees/${employee}/payroll-context`)).body.result;
 const result=await request('POST',`/${current.id}/suspend`);expect(result.status).toBe(409);expect(result.body.message).toContain('payroll effective dates');
 expect((await one('SELECT status FROM hr_permanent_pay_structures WHERE id=$1',[current.id])).status).toBe('Active');expect((await request('GET',`/employees/${employee}/payroll-context`)).body.result).toEqual(before);
});
