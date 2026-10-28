import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {statutory,policy,pt}=require('../../helpers/payrollMasterFixtures');
let db,accounts,admin;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const actor=async role=>(await q('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING id',[String(crypto.randomInt(7000000000,9999999999)),role,'Initial fixture']))[0].id;
const save=async(kind,data)=>(await q('SELECT save_payroll_master_draft($1,NULL,0,$2,$3) r',[kind,JSON.stringify(data),kind==='statutory'?accounts:admin]))[0].r;
const preview=async(kind,r,initial=true)=>(await q(`SELECT ${initial?'preview_payroll_initial_master':'preview_payroll_master_publication'}($1,$2,$3) r`,[kind,r.id,kind==='statutory'?accounts:admin]))[0].r;
const publish=async(kind,r,p)=>(await q('SELECT publish_payroll_initial_master($1,$2,$3,$4,$5,$6) r',[kind,r.id,r.version,p.preview_token,'Initial rollout approval fixture',kind==='statutory'?accounts:admin]))[0].r;
const rejected=async(fn,code)=>{await q('SAVEPOINT bad');await expect(fn()).rejects.toMatchObject({code});await q('ROLLBACK TO SAVEPOINT bad');};
const data=(extra={})=>statutory({jurisdiction:'INITIAL TEST',establishment:crypto.randomUUID(),effective_from:'2025-01-01',effective_to:'2025-12-31',...extra});
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated stack required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>{await db?.end();});beforeEach(async()=>{await q('BEGIN');accounts=await actor('accounts');admin=await actor('admin');});afterEach(async()=>{await q('ROLLBACK');});
test('historical initialization is explicit, mode-bound, audited and immutable',async()=>{
 const r=await save('statutory',data()),ordinary=await preview('statutory',r,false);expect(ordinary.publishable).toBe(false);
 const p=await preview('statutory',r);expect(p.initial_setup).toBe(true);expect(p.conflicts).toEqual([]);expect(p.blockers).toEqual([]);expect(p.publishable).toBe(true);
 await rejected(()=>publish('statutory',r,ordinary),'PY409');
 expect((await publish('statutory',r,p)).status).toBe('PUBLISHED');
 const event=(await q("SELECT before_snapshot,actor_id,after_snapshot FROM payroll_master_events WHERE statutory_revision_id=$1 AND action='PUBLISHED'",[r.id]))[0];
 expect(event.before_snapshot.initial_setup).toBe(true);expect(event.actor_id).toBe(accounts);expect(event.after_snapshot.approval_reference).toBe('Initial rollout approval fixture');
 await rejected(()=>q("UPDATE payroll_statutory_rule_revisions SET effective_from='2024-01-01' WHERE id=$1",[r.id]),'42501');
 expect((await q("SELECT current_setting('payroll.initial_master',true) mode"))[0].mode).not.toBe('on');
});
test('any previous publication blocks initialization even outside its dates or with case variants',async()=>{
 const d=data(),first=await save('statutory',d);await publish('statutory',first,await preview('statutory',first));
 const next=await save('statutory',{...d,jurisdiction:d.jurisdiction.toLowerCase(),establishment:d.establishment.toUpperCase(),effective_from:'2024-01-01',effective_to:'2024-12-31'});
 const p=await preview('statutory',next);expect(p.conflicts).toContainEqual({code:'INITIAL_SETUP_ALREADY_PUBLISHED'});await rejected(()=>publish('statutory',next,p),'22023');
});
test('month boundaries, completeness, authorization and stale previews remain protected',async()=>{
 for(const date of ['2025-01-15','2099-01-01']){const r=await save('statutory',data({effective_from:date,effective_to:date.startsWith('2099')?'2099-12-31':'2025-12-31'}));expect((await preview('statutory',r)).conflicts).toContainEqual({code:'INITIAL_MONTH_START_REQUIRED'});}
 const broken=data();broken.configuration.employee_rate=null;const r=await save('statutory',broken);expect((await preview('statutory',r)).publishable).toBe(false);
 await rejected(()=>q("SELECT preview_payroll_initial_master('statutory',$1,$2)",[r.id,admin]),'42501');
 const good=await save('statutory',data()),p=await preview('statutory',good);
 await q('SELECT save_payroll_master_draft($1,$2,$3,$4,$5)',['statutory',good.id,good.version,JSON.stringify(data()),accounts]);await rejected(()=>publish('statutory',good,p),'PY409');
});
test('initial salary policies preserve Admin ownership',async()=>{
 const r=await save('policies',policy({group_code:'HO_STAFF',effective_from:'2025-01-01'}));expect((await preview('policies',r,false)).publishable).toBe(false);
 await rejected(()=>q("SELECT preview_payroll_initial_master('policies',$1,$2)",[r.id,accounts]),'42501');
 const p=await preview('policies',r);
 const existing=Number((await q("SELECT count(*) n FROM payroll_policy_master_revisions WHERE status='PUBLISHED' AND (group_code IS NULL OR group_code='HO_STAFF')"))[0].n);
 if(existing){expect(p.conflicts).toContainEqual({code:'INITIAL_SETUP_ALREADY_PUBLISHED'});await rejected(()=>publish('policies',r,p),'22023');}
 else {expect(p.publishable).toBe(true);expect((await publish('policies',r,p)).status).toBe('PUBLISHED');}
});
test('browser roles cannot invoke initialization or the private predicate',async()=>{
 const row=(await q("SELECT has_function_privilege('authenticated','preview_payroll_initial_master(text,uuid,uuid)','EXECUTE') preview,has_function_privilege('authenticated','publish_payroll_initial_master(text,uuid,integer,text,text,uuid)','EXECUTE') publish,has_function_privilege('service_role','payroll_initial_master_conflicts(text,jsonb)','EXECUTE') helper"))[0];expect(row).toEqual({preview:false,publish:false,helper:false});
});

test('a competing first publication invalidates the already reviewed initial preview',async()=>{
 const d=data(),a=await save('statutory',d),b=await save('statutory',d),old=await preview('statutory',b);
 await publish('statutory',a,await preview('statutory',a));
 await rejected(()=>publish('statutory',b,old),'PY409');
 expect((await preview('statutory',b)).conflicts).toContainEqual({code:'INITIAL_SETUP_ALREADY_PUBLISHED'});
});

test('historical initial rule can be used by company setup and employee profiles without backdating confirmation',async()=>{
 const state=(await q("SELECT register_payroll_statutory_state($1,$2) r",['Initial State '+crypto.randomUUID().replace(/[0-9-]/g,'a'),accounts]))[0].r;
 const input=pt({state_id:state.id,jurisdiction:state.name,establishment:crypto.randomUUID(),effective_from:'2025-01-01',effective_to:'2025-12-31'});
 const r=await save('statutory',input);await publish('statutory',r,await preview('statutory',r));
 const setup=(await q('SELECT save_payroll_company_deduction_setup($1,$2,$3,$4,$5,$6) r',[state.id,'Historical factory','2025-01-01',JSON.stringify({PT:r.id}),'Initial evidence',accounts]))[0].r;
 const employee=(await q("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Initial staff','HO Staff','Head Office','2024-01-01',$1,$1) RETURNING id",[admin]))[0];
 await q("SELECT create_hr_pay_structure($1,'Monthly salary',15000,false,false,'Active',$2)",[employee.id,admin]);
 const result=(await q('SELECT apply_payroll_company_deduction_setup($1,$2,$3,$4,$5) r',[setup.id,'2025-01-01',JSON.stringify([{employee_id:employee.id,expected_version:0}]),'Historical setup evidence',accounts]))[0].r;
 expect(result.results[0]).toMatchObject({success:true});
 const profile=(await q("SELECT effective_from::text,verified_on::text FROM payroll_employee_statutory_profiles WHERE employee_id=$1 AND scheme='PT'",[employee.id]))[0];
 expect(profile.effective_from).toBe('2025-01-01');expect(profile.verified_on).toBe((await q("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date)::text today"))[0].today);
});

test('installed initialization guards match the latest forward migrations',async()=>{
 const fs=require('fs'),path=require('path');
 const sql=fs.readFileSync(path.join(__dirname,'../../../src/db/migrations/143_payroll_initial_master_publication.sql'),'utf8');
 const definitions=[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];expect(definitions).toHaveLength(5);
 const forward=fs.readFileSync(path.join(__dirname,'../../../src/db/migrations/144_payroll_stable_publication_preview_token.sql'),'utf8');
 const replacements=[...forward.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];expect(replacements).toHaveLength(1);
 for(const [,name,originalBody] of definitions){const body=replacements.find(m=>m[1]===name)?.[2]||originalBody;const row=(await q("SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",[name]))[0];expect(row.prosrc.trim(),name).toBe(body.trim());}
});

test('initial preview holds a database lock against concurrent salary-row writes until transaction end',async()=>{
 const r=await save('statutory',data());await preview('statutory',r);
 const other=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await other.connect();
 try {await other.query('BEGIN');await other.query("SET LOCAL lock_timeout='150ms'");
  // Even a zero-row write acquires the same table lock as finalization, without mutating salary data.
  await expect(other.query('UPDATE payroll_run_employees SET status=status WHERE false')).rejects.toMatchObject({code:'55P03'});
 } finally {await other.query('ROLLBACK');await other.end();}
});

test('ordinary tokens normalize pooled-session mode spellings and still distinguish initial publication',async()=>{
 const r=await save('statutory',data()),tokens=[];
 for(const mode of ['off','','false','OFF']){
  await q("SELECT set_config('payroll.initial_master',$1,true)",[mode]);
  const p=await preview('statutory',r,false);expect(p.initial_setup).toBe(false);tokens.push(p.preview_token);
 }
 expect(new Set(tokens).size).toBe(1);
 const initial=await preview('statutory',r);expect(initial.initial_setup).toBe(true);expect(initial.preview_token).not.toBe(tokens[0]);
 await rejected(()=>publish('statutory',r,{preview_token:tokens[0]}),'PY409');
});

test('normal publication succeeds when preview and publish use different equivalent connection states',async()=>{
 const r=await save('statutory',data({effective_from:'2099-01-01',effective_to:'2099-12-31'}));
 await q("SELECT set_config('payroll.initial_master','off',true)");const p=await preview('statutory',r,false);expect(p.publishable).toBe(true);
 await q("SELECT set_config('payroll.initial_master','',true)");
 const result=(await q('SELECT publish_payroll_master($1,$2,$3,$4,$5,$6) r',['statutory',r.id,r.version,p.preview_token,'Normalized token regression',accounts]))[0].r;
 expect(result.status).toBe('PUBLISHED');
});
