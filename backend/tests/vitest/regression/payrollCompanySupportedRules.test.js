import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {createReviewUsers,createReviewFixture,q,one}=require('../../helpers/payrollReviewFixtures');
const {pt}=require('../../helpers/payrollMasterFixtures');
const {interval}=require('../../helpers/payrollProfileFixtures');
let db,users,state;
const migration=n=>fs.readFileSync(path.join(__dirname,'../../../src/db/migrations',n),'utf8');
const replacement=migration('142_payroll_company_supported_component_rules.sql');
const functionSql=(sql,name)=>sql.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?END; \\$\\$;'))[0];
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>{await db?.end();});
beforeEach(async()=>{await q(db,'BEGIN');users=await createReviewUsers(db);state=(await one(db,"SELECT register_payroll_statutory_state($1,$2) r",['Synthetic Review '+crypto.randomUUID().replace(/[0-9-]/g,'a'),users.accounts.id])).r;});
afterEach(async()=>{await q(db,'ROLLBACK');});
async function publish(data){const d=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify(data),users.accounts.id])).r;const p=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[d.id,users.accounts.id])).r;await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC ONLY',$3)",[d.id,p.preview_token,users.accounts.id]);return d.id;}
async function oldRule(component='BASIC'){
 await q(db,functionSql(migration('116_payroll_accounts_setup_policies.sql'),'payroll_validate_master_106'));
 const data=pt({state_id:state.id,jurisdiction:state.name,establishment:'Legacy fixture',effective_from:'6800-01-01',effective_to:'6899-12-31'});
 data.configuration.included_components=[component];data.configuration.excluded_components=['BASIC','STAFF_WELFARE','OTHER_FIXED','PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'].filter(x=>x!==component);
 const id=await publish(data);
 await q(db,functionSql(migration('141_payroll_gross_basis_accounts_confirmation.sql'),'payroll_validate_master_106'));
 return id;
}
async function oldSetup(){const id=await oldRule();await q(db,functionSql(migration('140_payroll_company_setup_forward_fixes.sql'),'save_payroll_company_deduction_setup'));
 const setup=(await one(db,'SELECT save_payroll_company_deduction_setup($1,$2,$3,$4,$5,$6) r',[state.id,'Legacy fixture','6800-01-01',JSON.stringify({PT:id}),'Synthetic legacy setup',users.accounts.id])).r;
 await q(db,replacement);return {id,setup};}
const counts=()=>one(db,'SELECT (SELECT count(*) FROM payroll_company_deduction_setups)::int setups,(SELECT count(*) FROM payroll_statutory_scopes)::int scopes,(SELECT count(*) FROM payroll_statutory_scope_bindings)::int bindings,(SELECT count(*) FROM payroll_source_history_revisions)::int histories');
async function rejects(sql,args,message){await q(db,'SAVEPOINT rejected');await expect(q(db,sql,args)).rejects.toMatchObject({code:'22023',...(message?{message:expect.stringContaining(message)}:{})});await q(db,'ROLLBACK TO SAVEPOINT rejected');}

test.each(['BASIC','STAFF_WELFARE','OTHER_FIXED'])('retired %s rules are excluded before pagination and cannot be saved via the company RPC',async component=>{
 const retired=await oldRule(component);const beforeRule=await one(db,'SELECT to_jsonb(r) r FROM payroll_statutory_rule_revisions r WHERE id=$1',[retired]);
 const valid=await publish(pt({state_id:state.id,jurisdiction:state.name,establishment:'Supported fixture',effective_from:'6800-01-01',effective_to:'6899-12-31'}));
 const result=(await one(db,'SELECT get_payroll_company_deduction_options($1,$2,$3,1,1) r',[state.id,'6800-01-01',users.accounts.id])).r;
 expect(result.total).toBe(1);expect(result.rules.map(r=>r.id)).toEqual([valid]);
 const before=await counts();await rejects('SELECT save_payroll_company_deduction_setup($1,$2,$3,$4,$5,$6)',[state.id,'Rejected fixture','6800-01-01',JSON.stringify({PT:retired}),'Synthetic',users.accounts.id]);expect(await counts()).toEqual(before);
 expect(await one(db,'SELECT to_jsonb(r) r FROM payroll_statutory_rule_revisions r WHERE id=$1',[retired])).toEqual(beforeRule);
});
test('applying a stored legacy setup or assigning its scope individually cannot create employee profiles',async()=>{
 const {setup}=await oldSetup();const f=await createReviewFixture(db,users,{factory:true,count:1});const employee=f.employees[0].id;const before=await counts();
 await rejects('SELECT apply_payroll_company_deduction_setup($1,$2,$3,$4,$5)',[setup.id,'6800-01-01',JSON.stringify([{employee_id:employee,expected_version:0}]),'Synthetic',users.accounts.id],'retired or unsupported wage components');
 expect(await counts()).toEqual(before);
 const data=interval(setup.statutory_scope_id,'6800-01-01','6899-12-31',{verification_status:'ACCOUNTS_CONFIRMED'});
 await rejects('SELECT record_payroll_statutory_profiles($1,0,$2,$3,$4)',[employee,JSON.stringify([data]),'Synthetic',users.accounts.id],'published PT rule');expect(await counts()).toEqual(before);
});
test('supported rule predicate rejects malformed partitions and remains private',async()=>{
 for(const value of [null,{}, {included_components:['PACKAGE_BALANCE'],excluded_components:['DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','PACKAGE_BALANCE']}, {included_components:[],excluded_components:['PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS']}])expect((await one(db,'SELECT payroll_statutory_components_supported($1::jsonb) ok',[JSON.stringify(value)])).ok).toBe(false);
 expect((await one(db,"SELECT has_function_privilege('service_role','payroll_statutory_components_supported(jsonb)','EXECUTE') service,has_function_privilege('authenticated','payroll_statutory_components_supported(jsonb)','EXECUTE') browser"))).toEqual({service:false,browser:false});
});
test('installed supported-rule functions match the exact forward migration',async()=>{
 const definitions=[...replacement.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];expect(definitions).toHaveLength(5);
 for(const [,name,body]of definitions)expect((await one(db,"SELECT prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1",[name])).prosrc.trim()).toBe(body.trim());
});
