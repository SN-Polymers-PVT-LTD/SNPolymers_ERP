import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
let db,admin,employee;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const context=async()=>(await one('SELECT get_hr_payroll_salary_context($1,$2) r',[employee,admin])).r;
const terms={pay_basis:'Monthly salary',guaranteed_monthly_gross:'18000',epf_enrolment:true,esi_enrolment:true};
const save=async({existing=null,from='2025-01-01',version=0,pay=terms,actor=admin}={})=>(await one('SELECT save_hr_payroll_salary($1,$2,$3,$4,$5,$6,$7) r',[employee,existing,from,version,pay&&JSON.stringify(pay),'Confirmed salary evidence',actor])).r;
const reject=async(fn,code)=>{await q('SAVEPOINT bad');await expect(fn()).rejects.toMatchObject({code});await q('ROLLBACK TO SAVEPOINT bad');};
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});afterAll(async()=>db?.end());
beforeEach(async()=>{await q('BEGIN');admin=(await one("INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,'admin','Salary dates test',true) RETURNING id",[String(crypto.randomInt(7000000000,9999999999))])).id;employee=(await one("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Salary test','SNP Permanent Factory Labour','SNP Factory','2025-01-01',$1,$1) RETURNING id",[admin])).id;});afterEach(async()=>q('ROLLBACK'));
test('new salary and full dated timeline save atomically with append-only prior history',async()=>{
 const a=await save();expect(a.context).toMatchObject({version:1,intervals:[{pay_structure_id:a.pay_structure_id,effective_from:'2025-01-01',effective_to:null}]});
 const b=await save({from:'2025-08-01',version:1,pay:{...terms,guaranteed_monthly_gross:'19500'}});
 expect(b.context.version).toBe(2);expect(b.context.intervals).toEqual([{pay_structure_id:a.pay_structure_id,effective_from:'2025-01-01',effective_to:'2025-07-31'},{pay_structure_id:b.pay_structure_id,effective_from:'2025-08-01',effective_to:null}]);
 expect((await one('SELECT count(*) n FROM payroll_permanent_pay_applicability WHERE employee_id=$1',[employee])).n).toBe('3');
 await reject(()=>save({from:'2025-09-01',version:1}),'PY409');
});
test('existing salary initialization reuses identity and never duplicates HR pay revisions',async()=>{
 const salary=await one("SELECT * FROM create_hr_pay_structure($1,'Monthly salary',18000,true,true,'Active',$2)",[employee,admin]);
 await reject(()=>save(),'22023');const a=await save({existing:salary.id,pay:null});expect(a.pay_structure_id).toBe(salary.id);expect((await one('SELECT count(*) n FROM hr_permanent_pay_structures WHERE employee_id=$1',[employee])).n).toBe('1');
 await reject(()=>save({existing:salary.id,pay:null,version:1}),'PY409');
});
test('invalid dates, midmonth changes, future scheduling and invalid amounts leave salary/history untouched',async()=>{
 for(const input of [{from:'2024-01-01'},{from:'2099-01-01'},{from:'2025-01-15'},{pay:{...terms,guaranteed_monthly_gross:'NaN'}}])await reject(()=>save(input),'22023');
 expect((await one('SELECT count(*) n FROM hr_permanent_pay_structures WHERE employee_id=$1',[employee])).n).toBe('0');expect((await context()).version).toBe(0);
 await save();await reject(()=>save({from:'2025-08-15',version:1}),'22023');
});
test('salary creation rolls back if dated history persistence fails',async()=>{
 await q("CREATE FUNCTION pg_temp.reject_salary_dates() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic history failure' USING ERRCODE='23514'; END $$");
 await q("CREATE TRIGGER z_salary_failure BEFORE INSERT ON payroll_permanent_pay_applicability FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_salary_dates()");
 await reject(()=>save(),'23514');expect((await one('SELECT count(*) n FROM hr_permanent_pay_structures WHERE employee_id=$1',[employee])).n).toBe('0');expect((await context()).version).toBe(0);
});
test('Admin confirms initial category assignment explicitly; repeat and non-Admin actors are rejected',async()=>{
 const r=(await one('SELECT initialize_hr_payroll_assignment($1,$2,$3,$4) r',[employee,'2025-01-01','Confirmed category and department',admin])).r;
 expect(r.assignments).toEqual([{group_code:'SNP_PERMANENT',employee_category:'SNP Permanent Factory Labour',department:'SNP Factory',effective_from:'2025-01-01',effective_to:null}]);
 await reject(()=>q('SELECT initialize_hr_payroll_assignment($1,$2,$3,$4)',[employee,'2025-01-01','Repeat',admin]),'PY409');
 await q("UPDATE authorised_users SET role='accounts' WHERE id=$1",[admin]);await reject(()=>save(),'42501');
});
test('new salary source operations are service-only and installed bodies match migration 145',async()=>{
 const fs=require('fs'),path=require('path');const sql=fs.readFileSync(path.join(__dirname,'../../../src/db/migrations/145_payroll_salary_effective_dates.sql'),'utf8');const defs=[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];expect(defs).toHaveLength(3);
 for(const [,name,body] of defs){const row=await one("SELECT p.prosrc,has_function_privilege('authenticated',p.oid,'EXECUTE') browser,has_function_privilege('service_role',p.oid,'EXECUTE') service FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",[name]);expect(row.prosrc.trim(),name).toBe(body.trim());expect(row).toMatchObject({browser:false,service:true});}
});
test('a concurrent source reader prevents changing salary dates until its review transaction ends',async()=>{
 const other=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await other.connect();
 try{await other.query('BEGIN');await other.query("SELECT payroll_source_fence('employee:'||$1::text,true)",[employee]);
  await reject(()=>save(),'PY409');expect((await context()).version).toBe(0);
 }finally{await other.query('ROLLBACK');await other.end();}
 expect((await save()).context.version).toBe(1);
});
test('foreign salary identities, missing terms and enrolment payload forgery are rejected without history',async()=>{
 await reject(()=>save({existing:crypto.randomUUID(),pay:null}),'22023');await reject(()=>save({pay:null}),'22023');await reject(()=>save({pay:{...terms,epf_enrolment:'true'}}),'22023');await reject(()=>save({pay:{...terms,unexpected:'field'}}),'22023');expect((await context()).version).toBe(0);
});
test('mapped salary suspension is rejected through RPC and direct status update without changing history',async()=>{
 const saved=await save(),before=await context();
 await reject(()=>q('SELECT suspend_hr_pay_structure($1,$2)',[saved.pay_structure_id,admin]),'PY409');
 await reject(()=>q("UPDATE hr_permanent_pay_structures SET status='Suspended',updated_by=$2 WHERE id=$1",[saved.pay_structure_id,admin]),'PY409');
 expect((await one('SELECT status FROM hr_permanent_pay_structures WHERE id=$1',[saved.pay_structure_id])).status).toBe('Active');expect(await context()).toEqual(before);
});
test('unmapped suspension remains idempotent but cannot subsequently be linked as a payroll source',async()=>{
 const salary=await one("SELECT * FROM create_hr_pay_structure($1,'Monthly salary',18000,true,true,'Active',$2)",[employee,admin]);
 await q('SET LOCAL ROLE service_role');
 expect((await one('SELECT * FROM suspend_hr_pay_structure($1,$2)',[salary.id,admin])).status).toBe('Suspended');expect((await one('SELECT * FROM suspend_hr_pay_structure($1,$2)',[salary.id,admin])).status).toBe('Suspended');
 await q('RESET ROLE');
 await reject(()=>q("SELECT record_payroll_source_history($1,'PERMANENT_PAY',$2,'Cannot use suspended source',$3)",[employee,JSON.stringify([{pay_structure_id:salary.id,effective_from:'2025-01-01',effective_to:null}]),admin]),'22023');
 expect((await context()).version).toBe(0);
});
test('suspension verifies current Admin and preserves salary when a source fence rejects the operation',async()=>{
 const salary=await one("SELECT * FROM create_hr_pay_structure($1,'Monthly salary',18000,true,true,'Active',$2)",[employee,admin]);
 await q('SAVEPOINT fence_fixture');
 await q("CREATE OR REPLACE FUNCTION payroll_source_fence(p_key text,p_shared boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic busy source' USING ERRCODE='PY409'; END $$");
 await reject(()=>q('SELECT suspend_hr_pay_structure($1,$2)',[salary.id,admin]),'PY409');
 await q('ROLLBACK TO SAVEPOINT fence_fixture');
 expect((await one('SELECT status FROM hr_permanent_pay_structures WHERE id=$1',[salary.id])).status).toBe('Active');
 await q("UPDATE authorised_users SET role='accounts' WHERE id=$1",[admin]);await reject(()=>q('SELECT suspend_hr_pay_structure($1,$2)',[salary.id,admin]),'42501');
});
test('suspension guards match migration 147 and private trigger functions are not callable by application roles',async()=>{
 const fs=require('fs'),path=require('path');const sql=fs.readFileSync(path.join(__dirname,'../../../src/db/migrations/147_guard_dated_salary_suspension.sql'),'utf8');const defs=[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];expect(defs).toHaveLength(3);
 for(const [,name,body] of defs){const row=await one("SELECT p.prosrc,has_function_privilege('authenticated',p.oid,'EXECUTE') browser,has_function_privilege('service_role',p.oid,'EXECUTE') service FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",[name]);expect(row.prosrc.trim(),name).toBe(body.trim());expect(row.browser).toBe(false);expect(row.service).toBe(name==='suspend_hr_pay_structure');}
});
