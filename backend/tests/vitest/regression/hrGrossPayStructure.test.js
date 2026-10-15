import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
let db,admin,employee;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>{if(db)await db.end();});
beforeEach(async()=>{
 await q('BEGIN');
 admin=(await one("INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,'admin','Synthetic gross setup',true) RETURNING id",[String(crypto.randomInt(7000000000,9999999999))])).id;
 employee=(await one("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Synthetic gross employee','HO Staff','Head Office','2020-01-01',$1,$1) RETURNING id",[admin])).id;
});
afterEach(async()=>{await q('ROLLBACK');});
test('gross-only authoring preserves historical components and prevents public legacy authoring',async()=>{
 const old=await one("SELECT * FROM hr_create_legacy_pay_structure($1,'Monthly salary',30000,10000,2000,3000,true,false,'Active',$2)",[employee,admin]);
 await q('SET LOCAL ROLE service_role');
 const current=await one("SELECT * FROM create_hr_pay_structure($1,'Monthly salary',32000,true,false,'Active',$2)",[employee,admin]);
 expect(current).toMatchObject({revision_number:2,status:'Active',guaranteed_monthly_gross:'32000.00',basic_salary:null,staff_welfare:null,other_fixed_components:null});
 const permissions=await one("SELECT has_function_privilege('service_role','hr_create_legacy_pay_structure(uuid,text,numeric,numeric,numeric,numeric,boolean,boolean,text,uuid)','execute') legacy,has_function_privilege('authenticated','create_hr_pay_structure(uuid,text,numeric,boolean,boolean,text,uuid)','execute') browser");
 expect(permissions).toEqual({legacy:false,browser:false});
 await q('SAVEPOINT forbidden');
 await expect(q("SELECT hr_create_legacy_pay_structure($1,'Monthly salary',32000,1,2,3,true,false,'Active',$2)",[employee,admin])).rejects.toMatchObject({code:'42501'});
 await q('ROLLBACK TO SAVEPOINT forbidden');await q('RESET ROLE');
 expect(await one('SELECT basic_salary,staff_welfare,other_fixed_components,status FROM hr_permanent_pay_structures WHERE id=$1',[old.id])).toEqual({basic_salary:'10000.00',staff_welfare:'2000.00',other_fixed_components:'3000.00',status:'Superseded'});
});
test('inactive and non-Admin actors cannot author gross-only revisions',async()=>{
 await q('UPDATE authorised_users SET is_active=false WHERE id=$1',[admin]);
 await q('SAVEPOINT forbidden');
 await expect(q("SELECT create_hr_pay_structure($1,'Monthly salary',32000,true,false,'Active',$2)",[employee,admin])).rejects.toMatchObject({code:'42501'});
 await q('ROLLBACK TO SAVEPOINT forbidden');
 await q("UPDATE authorised_users SET is_active=true,role='accounts' WHERE id=$1",[admin]);
 await q('SAVEPOINT forbidden_role');
 await expect(q("SELECT create_hr_pay_structure($1,'Monthly salary',32000,true,false,'Active',$2)",[employee,admin])).rejects.toMatchObject({code:'42501'});
 await q('ROLLBACK TO SAVEPOINT forbidden_role');
});
