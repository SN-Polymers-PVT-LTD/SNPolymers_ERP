import {beforeAll,afterAll,test,expect} from 'vitest';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{Client}=require('pg');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {createReviewUsers,one,q}=require('../../helpers/payrollReviewFixtures');
const {pt}=require('../../helpers/payrollMasterFixtures');
const migration=n=>fs.readFileSync(path.join(__dirname,'../../../src/db/migrations',n),'utf8');
const original=migration('139_payroll_company_deduction_setup.sql');
const repair=migration('140_payroll_company_setup_forward_fixes.sql');
const supported=migration('142_payroll_company_supported_component_rules.sql');
let db;
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>{await db?.end();});

test('installed repair function bodies exactly match the checked-in migration',async()=>{
 const definitions=[...repair.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
 expect(definitions.map(m=>m[1]).sort()).toEqual(['payroll_guard_company_profile','save_payroll_company_deduction_setup']);
 for(const [,name,oldBody] of definitions){const latest=[...supported.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)].find(m=>m[1]===name);const body=latest?.[2]||oldBody;const row=await one(db,"SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",[name]);expect(row.prosrc.trim(),name).toBe(body.trim());}
});

test('exact migration 139 to 140 replay repairs the failed save without changing permissions',async()=>{
 // DDL and fixtures are transaction-local and always rolled back. The isolated
 // stack and its persistent records are restored, including original functions.
 await q(db,'BEGIN');
 try{
  await q(db,"SET LOCAL statement_timeout = '15s'");
  await q(db,'DROP TRIGGER z_payroll_company_profile ON public.payroll_employee_statutory_profiles');
  await q(db,'DROP FUNCTION public.payroll_guard_company_profile()');
  await q(db,'DROP FUNCTION public.get_payroll_company_deduction_setups(uuid,text,integer,integer), public.get_payroll_company_deduction_options(uuid,date,uuid,integer,integer), public.save_payroll_company_deduction_setup(uuid,text,date,jsonb,text,uuid), public.apply_payroll_company_deduction_setup(uuid,date,jsonb,text,uuid)');
  await q(db,'DROP TABLE public.payroll_company_deduction_setups');
  await q(db,original);
  const users=await createReviewUsers(db);
  const state=(await one(db,"SELECT register_payroll_statutory_state('Synthetic Migration State',$1) r",[users.accounts.id])).r;
  const data=pt({state_id:state.id,jurisdiction:state.name,establishment:'MIGRATION '+crypto.randomUUID(),effective_from:'8900-01-01',effective_to:'8900-12-31'});
  const draft=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify(data),users.accounts.id])).r;
  const preview=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[draft.id,users.accounts.id])).r;
  await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC migration test',$3)",[draft.id,preview.preview_token,users.accounts.id]);
  const args=[state.id,'Synthetic migration company','8900-01-01',JSON.stringify({PT:draft.id}),'SYNTHETIC migration test',users.accounts.id];
  const save='SELECT save_payroll_company_deduction_setup($1,$2,$3,$4,$5,$6) r';
  await q(db,'SAVEPOINT broken_139');await expect(q(db,save,args)).rejects.toMatchObject({code:'42P01'});await q(db,'ROLLBACK TO SAVEPOINT broken_139');
  await q(db,repair);
  const result=(await one(db,save,args)).r;
  expect(result).toMatchObject({establishment_name:'Synthetic migration company',effective_from:'8900-01-01',pt_revision_id:draft.id,created_by:users.accounts.id});
  expect((await q(db,'SELECT * FROM payroll_statutory_scope_bindings WHERE revision_id=$1',[draft.id]))).toHaveLength(1);
  await q(db,repair);
  await q(db,'SAVEPOINT admin_denied');await expect(q(db,save,[...args.slice(0,-1),users.admin.id])).rejects.toMatchObject({code:'42501'});await q(db,'ROLLBACK TO SAVEPOINT admin_denied');
  const access=await one(db,"SELECT has_function_privilege('authenticated','save_payroll_company_deduction_setup(uuid,text,date,jsonb,text,uuid)','EXECUTE') browser, has_function_privilege('service_role','save_payroll_company_deduction_setup(uuid,text,date,jsonb,text,uuid)','EXECUTE') service");
  expect(access).toEqual({browser:false,service:true});
 }finally{await q(db,'ROLLBACK');}
});
