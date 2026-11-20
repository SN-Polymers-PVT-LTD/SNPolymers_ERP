import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture}=require('../../helpers/payrollReviewFixtures');
let db,users,rule;
const category='SNP Permanent Factory Labour';
const body=from=>({employee_category:category,effective_from:from,standard_duty_hours:8,ot_enabled:true,ot_method:'Salary-derived hourly',ot_rate:null,ot_multiplier:1,holiday_pay_enabled:true,holiday_multiplier:1.5,management_stoppage_treatment:'Retain normal pay',short_hours_treatment:'Only missing hours',comp_off_rule:null,double_duty_multiplier:null});
async function reject(sql,args,code){await q(db,'SAVEPOINT invalid');await expect(q(db,sql,args)).rejects.toMatchObject({code});await q(db,'ROLLBACK TO SAVEPOINT invalid');}
const complete=(days='26',actor=users.admin.id)=>one(db,"SELECT complete_factory_treatment($1,$2,'Confirmed v1.4 and client decisions',$3) r",[rule.id,days,actor]);
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);
 const from=(await one(db,"SELECT d::date::text d FROM generate_series('2096-02-01'::date,'9990-02-01'::date,'1 year') d WHERE NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_revisions WHERE employee_category=$1 AND effective_from=d::date) LIMIT 1",[category])).d;
 rule=await one(db,"INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_multiplier,holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,created_by) VALUES($1,$3,8,true,'Salary-derived hourly',1,true,1.5,'Retain pay',$2) RETURNING *",[category,users.admin.id,from]);
});
afterAll(async()=>db?.end());beforeEach(async()=>q(db,'BEGIN'));afterEach(async()=>q(db,'ROLLBACK'));
test('certificate workflow is completely absent after forward cleanup',async()=>{
 expect((await one(db,"SELECT to_regclass('public.hr_leave_medical_evidence') AS id")).id).toBeNull();
 expect((await one(db,"SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('record_hr_medical_evidence','save_hr_factory_leave_evidenced','decide_hr_factory_leave_evidenced')")).n).toBe(0);
});
test('structured treatment is immutable, audited and has explicit holiday conversion days',async()=>{
 const t=(await complete()).r;expect(t.holiday_salary_days).toBe('26.0000');expect(t.short_hours_method).toBe('MISSING_HOURS');expect(t.holiday_method).toBe('TOTAL_DAILY_ENTITLEMENT');
 expect((await one(db,"SELECT count(*)::int n FROM audit_log WHERE record_identifier=$1 AND module_name='HR Factory Attendance Pay'",[t.id])).n).toBe(1);
 await reject("UPDATE hr_factory_pay_rule_treatments SET holiday_salary_days=30 WHERE id=$1",[t.id],'23514');
 await reject('DELETE FROM hr_factory_pay_rule_treatments WHERE id=$1',[t.id],'23514');
 await reject("SELECT complete_factory_treatment($1,26,'duplicate',$2)",[rule.id,users.admin.id],'23505');
});
test.each(['accounts','ho','je'])('%s cannot author attendance pay treatment',async role=>{await reject("SELECT complete_factory_treatment($1,26,'unauthorized',$2)",[rule.id,users[role].id],'42501');});
test('invalid/missing holiday basis rejects the entire atomic rule/config/treatment operation',async()=>{
 const b=body('2096-03-01');await reject('SELECT create_factory_rule($1,$2,$3,$4)',[JSON.stringify(b),JSON.stringify({salary_days:26,reason:'Synthetic OT'}),users.admin.id,JSON.stringify({holiday_salary_days:null,reason:'Synthetic missing holiday basis'})],'23514');
 expect((await one(db,"SELECT count(*)::int n FROM hr_factory_pay_rule_revisions WHERE employee_category=$1 AND effective_from='2096-03-01'",[category])).n).toBe(0);
 const r=(await one(db,'SELECT create_factory_rule($1,$2,$3,$4) r',[JSON.stringify(b),JSON.stringify({salary_days:26,reason:'Synthetic OT'}),users.admin.id,JSON.stringify({holiday_salary_days:26,reason:'Synthetic treatment'})])).r;
 expect(r.treatment.rule_revision_id).toBe(r.id);expect(r.calculation.rule_revision_id).toBe(r.id);
});
test('source snapshots expose confirmed treatment while preserving original rule revision',async()=>{
 const f=await createReviewFixture(db,users,{factory:true});const r=await one(db,"INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,holiday_pay_enabled,management_stoppage_treatment,created_by) VALUES($1,$2,8,false,'Fixed Hourly',0,false,'Retain pay',$3) RETURNING *",[f.category,f.from,users.admin.id]);
 const t=(await one(db,"SELECT complete_factory_treatment($1,NULL,'Approved wage treatment',$2) r",[r.id,users.fm.id])).r;
 for(const name of ['get_payroll_preview_sources','get_payroll_review_sources']){
 const src=(await one(db,`SELECT ${name}($1,$2) r`,[f.rows[0].id,users.accounts.id])).r;
 expect(src.factory_rules.find(x=>x.id===r.id).treatment.id).toBe(t.id);
 }
});
test('a concurrent finalization fence rejects treatment completion',async()=>{
 const peer=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await peer.connect();
 try{await q(peer,'BEGIN');await q(peer,'SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',['payroll_source:factory:'+category]);
 await reject("SELECT complete_factory_treatment($1,26,'concurrent',$2)",[rule.id,users.admin.id],'PY409');
 }finally{await q(peer,'ROLLBACK');await peer.end();}
});

test('unified completion saves both missing settings atomically and rejects repeat completion',async()=>{
 const impact=(await one(db,'SELECT factory_setup_impact($1,$2) r',[rule.id,users.admin.id])).r;
 expect(impact.calculation_configured).toBe(false);expect(impact.treatment_configured).toBe(false);
 await reject("SELECT complete_factory_setup($1,30,NULL,'invalid holiday basis',$2)",[rule.id,users.admin.id],'23514');
 expect((await one(db,'SELECT count(*)::int n FROM hr_factory_pay_rule_calculations WHERE rule_revision_id=$1',[rule.id])).n).toBe(0);
 const saved=(await one(db,"SELECT complete_factory_setup($1,30,26,'Confirmed separate divisors',$2) r",[rule.id,users.admin.id])).r;
 expect(saved.calculation.salary_days).toBe('30.0000');expect(saved.treatment.holiday_salary_days).toBe('26.0000');
 await reject("SELECT complete_factory_setup($1,NULL,NULL,'duplicate',$2)",[rule.id,users.admin.id],'23505');
});
test('unified completion preserves existing configuration and its audit identity',async()=>{
 const c=(await one(db,"SELECT complete_factory_calculation($1,30,'Already approved OT',$2) r",[rule.id,users.admin.id])).r;
 await reject("SELECT complete_factory_setup($1,26,26,'Must not overwrite',$2)",[rule.id,users.admin.id],'23514');
 const saved=(await one(db,"SELECT complete_factory_setup($1,NULL,26,'Complete attendance only',$2) r",[rule.id,users.admin.id])).r;
 expect(saved.calculation).toBeNull();expect(saved.treatment.holiday_salary_days).toBe('26.0000');
 expect((await one(db,'SELECT id,salary_days::text FROM hr_factory_pay_rule_calculations WHERE rule_revision_id=$1',[rule.id]))).toEqual({id:c.id,salary_days:'30.0000'});
});
test.each(['accounts','ho','je'])('unified completion denies %s',async role=>{
 await reject("SELECT complete_factory_setup($1,26,26,'Denied',$2)",[rule.id,users[role].id],'42501');
});
test('unified completion respects the finalization fence',async()=>{
 const peer=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await peer.connect();
 try{await q(peer,'BEGIN');await q(peer,'SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',['payroll_source:factory:'+category]);
 await reject("SELECT complete_factory_setup($1,26,26,'concurrent',$2)",[rule.id,users.admin.id],'PY409');
 }finally{await q(peer,'ROLLBACK');await peer.end();}
});
