import {beforeAll,afterAll,beforeEach,afterEach,describe,test,expect} from 'vitest';
const {Client}=require('pg');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture,reviewAction}=require('../../helpers/payrollReviewFixtures');
const {fingerprint}=require('../../../src/domain/payroll/sources');
let db,users,legacy;
const category='SNP Permanent Factory Labour';
const data=(from,extra={})=>({employee_category:category,effective_from:from,standard_duty_hours:8,ot_enabled:true,ot_method:'Salary-derived hourly',ot_rate:null,ot_multiplier:1,holiday_pay_enabled:false,holiday_multiplier:null,management_stoppage_treatment:'No deduction',short_hours_treatment:null,comp_off_rule:null,double_duty_multiplier:null,...extra});
const complete=(rule,days='26',actor=users.admin.id)=>one(db,"SELECT complete_factory_calculation($1,$2,'Synthetic OT setup',$3) r",[rule,days,actor]);
async function rejected(sql,args,code){await q(db,'SAVEPOINT invalid');await expect(q(db,sql,args)).rejects.toMatchObject({code});await q(db,'ROLLBACK TO SAVEPOINT invalid');}
async function legacyRule(employeeCategory=category,from){
 from=from||(await one(db,"SELECT d::date::text d FROM generate_series('2100-01-01'::date,'9990-01-01'::date,'1 year') d WHERE NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_revisions WHERE employee_category=$1 AND effective_from=d::date) LIMIT 1",[employeeCategory])).d;
 return one(db,"INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_multiplier,holiday_pay_enabled,management_stoppage_treatment,created_by,revision_number) VALUES($1,$2,8,true,$3,1,false,'Synthetic no deduction',$4,1) RETURNING *",[employeeCategory,from,employeeCategory.includes('Permanent')?'Salary-derived hourly':'Derived from daily wage',users.admin.id]);
}
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);legacy=await legacyRule();});
afterAll(async()=>db?.end());beforeEach(async()=>q(db,'BEGIN'));afterEach(async()=>q(db,'ROLLBACK'));
describe('factory OT configuration database invariants',()=>{
 test('existing rule completion retains rule identity, stores decimal strings and is audited once',async()=>{
 const before=await one(db,'SELECT * FROM hr_factory_pay_rule_revisions WHERE id=$1',[legacy.id]);
 const c=(await complete(legacy.id)).r;expect(c.salary_days).toBe('26.0000');expect(c.wage_basis).toBe('MONTHLY_GROSS');
 expect(await one(db,'SELECT * FROM hr_factory_pay_rule_revisions WHERE id=$1',[legacy.id])).toEqual(before);
 expect((await one(db,"SELECT count(*)::int n FROM audit_log WHERE record_identifier=$1 AND module_name='HR Factory OT Calculation'",[c.id])).n).toBe(1);
 await rejected("SELECT complete_factory_calculation($1,26,'duplicate',$2)",[legacy.id,users.admin.id],'23505');
 await rejected("UPDATE hr_factory_pay_rule_calculations SET salary_days=30 WHERE id=$1",[c.id],'23514');
 await rejected('DELETE FROM hr_factory_pay_rule_calculations WHERE id=$1',[c.id],'23514');
 });
 test.each(['accounts','ho','je'])('%s cannot author calculation settings',async role=>{await rejected("SELECT complete_factory_calculation($1,26,'bad actor',$2)",[legacy.id,users[role].id],'42501');});
 test('FM may complete, inactive authors and invalid divisors are rejected',async()=>{
 await rejected("SELECT complete_factory_calculation($1,0,'bad divisor',$2)",[legacy.id,users.admin.id],'23514');
 await rejected("SELECT complete_factory_calculation($1,'NaN'::numeric,'bad divisor',$2)",[legacy.id,users.admin.id],'23514');
 await q(db,'UPDATE authorised_users SET is_active=false WHERE id=$1',[users.fm.id]);
 await rejected("SELECT complete_factory_calculation($1,26,'inactive',$2)",[legacy.id,users.fm.id],'42501');
 await q(db,'UPDATE authorised_users SET is_active=true WHERE id=$1',[users.fm.id]);expect((await complete(legacy.id,'26',users.fm.id)).r.id).toBeTruthy();
 });
 test('rule/config creation is atomic and rejects missing or incompatible configuration',async()=>{
 const from='2099-09-09';const body=data(from);
 await rejected('SELECT create_factory_rule($1,NULL,$2)',[body,users.admin.id],'23514');
 await rejected('SELECT create_factory_rule($1,$2,$3)',[body,{salary_days:null,reason:'Synthetic incompatible'},users.admin.id],'23514');
 expect((await one(db,'SELECT count(*)::int n FROM hr_factory_pay_rule_revisions WHERE employee_category=$1 AND effective_from=$2',[category,from])).n).toBe(0);
 const r=(await one(db,'SELECT create_factory_rule($1,$2,$3) r',[body,{salary_days:26,reason:'Synthetic complete'},users.admin.id])).r;
 expect(r.calculation.salary_days).toBe('26.0000');expect(r.calculation.rule_revision_id).toBe(r.id);
 });
 test('service role has only read access to configuration; anonymous RPC execution is denied',async()=>{
 await q(db,'SET LOCAL ROLE service_role');
 await rejected("INSERT INTO hr_factory_pay_rule_calculations(rule_revision_id) VALUES($1)",[legacy.id],'42501');
 expect((await complete(legacy.id)).r.id).toBeTruthy();await q(db,'RESET ROLE');
 await q(db,'SET LOCAL ROLE anon');await rejected('SELECT factory_calculation_impact($1,$2)',[legacy.id,users.admin.id],'42501');await q(db,'RESET ROLE');
 });
 test('both source RPCs include configuration in the same snapshot and preserve protected review calculations',async()=>{
 const f=await createReviewFixture(db,users,{factory:true});const rule=await legacyRule(f.category,f.from);
 const row=f.rows[0];await reviewAction(db,row.id,'calculate',users.fm.id);
 const before=await q(db,'SELECT * FROM payroll_review_revisions WHERE row_id=$1',[row.id]);
 const prior=(await one(db,'SELECT get_payroll_review_sources($1,$2) r',[row.id,users.accounts.id])).r;
 const c=(await complete(rule.id,null)).r;
 for(const fn of ['get_payroll_preview_sources','get_payroll_review_sources']){
 const s=(await one(db,`SELECT ${fn}($1,$2) r`,[row.id,users.accounts.id])).r;
 expect(s.factory_rules.find(r=>r.id===rule.id).calculation.id).toBe(c.id);expect(fingerprint(s)).not.toBe(fingerprint(prior));
 }
 expect(await q(db,'SELECT * FROM payroll_review_revisions WHERE row_id=$1',[row.id])).toEqual(before);
 const impact=(await one(db,'SELECT factory_calculation_impact($1,$2) r',[rule.id,users.ho.id])).r;expect(impact.already_configured).toBe(true);expect(impact.draft_rows).toBeGreaterThan(0);
 });
 test.each([['SNP Permanent Factory Labour','SNP Factory','SNP_PERMANENT'],['Fabric Factory Permanent Employees','Fabric Factory','FABRIC_PERMANENT']])('Locked %s attendance uses completed settings without rebinding',async(employeeCategory,department,group)=>{
 const year=(await one(db,"SELECT y FROM generate_series(2200,9000) y WHERE NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_revisions WHERE employee_category=$1 AND extract(year FROM effective_from)=y) LIMIT 1",[employeeCategory])).y;
 const start=`${year}-02-01`,finish=`${year}-02-28`,date=`${year}-02-02`;
 await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'",[users.admin.id]);
 const employee=await one(db,"INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Synthetic permanent OT',$1,$2,$4,$3,$3) RETURNING *",[employeeCategory,department,users.admin.id,start]);
 const rule=await legacyRule(employeeCategory,start);

 const pay=await one(db,"SELECT * FROM create_hr_pay_structure($1,'Monthly salary',10000,true,false,'Active',$2)",[employee.id,users.admin.id]);
 await q(db,"SELECT record_payroll_source_history($1,'PERMANENT_PAY',$2,'Synthetic permanent OT pay',$3)",[employee.id,JSON.stringify([{pay_structure_id:pay.id,effective_from:start,effective_to:null}]),users.admin.id]);
 const h=(await one(db,"SELECT record_payroll_source_history($1,'ASSIGNMENT',$2,'Synthetic permanent OT assignment',$3) id",[employee.id,JSON.stringify([{group_code:group,employee_category:employeeCategory,department,effective_from:start,effective_to:finish,employment_joined_on:start}]),users.admin.id])).id;
 const assignment=await one(db,'SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[h]);
 const sheet=await one(db,'SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)',[date,employeeCategory,users.admin.id,department]);
 await q(db,'SELECT save_hr_attendance_rows($1,$2,$3)',[sheet.id,JSON.stringify([{employee_id:employee.id,attendance_status:'Present',entry_timestamp:date+'T08:00:00+05:30',exit_timestamp:date+'T18:00:00+05:30'}]),users.admin.id]);
 await q(db,"SELECT transition_hr_attendance_sheet($1,'submit',NULL,$2)",[sheet.id,users.admin.id]);await q(db,"SELECT transition_hr_attendance_sheet($1,'review',NULL,$2)",[sheet.id,users.ho.id]);
 const run=await one(db,"SELECT * FROM create_payroll_draft_run($1,$2,$3,$3,'Custom',$4)",[group,department,date,users.admin.id]);
 const row=await one(db,'SELECT * FROM add_payroll_draft_employee($1,$2,$3,$3,$4)',[run.id,assignment.id,date,users.admin.id]);
 const attendanceBefore=await q(db,'SELECT * FROM hr_attendance_rows WHERE sheet_id=$1',[sheet.id]);
 await complete(rule.id);
 const src=(await one(db,'SELECT get_payroll_review_sources($1,$2) r',[row.id,users.accounts.id])).r;
 const result=require('../../../src/domain/payroll/preview').calculatePreview(src);
 expect(result.earnings.find(l=>l.code==='OVERTIME').amount).toBe('96.16');
 expect(result.blockers.some(b=>b.code==='MISSING_OR_OUTDATED_FACTORY_RULE'||b.code==='SALARY_DERIVED_OT_BASIS_REQUIRED')).toBe(false);
 expect(await q(db,'SELECT * FROM hr_attendance_rows WHERE sheet_id=$1',[sheet.id])).toEqual(attendanceBefore);
 });
 test('locked payroll rejects completion while a nonoverlapping later rule is allowed',async()=>{
 const f=await createReviewFixture(db,users,{factory:true});const rule=await legacyRule(f.category,f.from);
 // Fixture-only bypass of the closed financial gate, rolled back with this test.
 await q(db,'SET CONSTRAINTS ALL IMMEDIATE');
 await q(db,'ALTER TABLE payroll_run_employees DISABLE TRIGGER USER');
 await q(db,"UPDATE payroll_run_employees SET status='LOCKED' WHERE id=$1",[f.rows[0].id]);
 await q(db,'ALTER TABLE payroll_run_employees ENABLE TRIGGER USER');
 await rejected("SELECT complete_factory_calculation($1,NULL,'blocked',$2)",[rule.id,users.admin.id],'PY409');
 await rejected("SELECT complete_factory_setup($1,NULL,NULL,'blocked unified setup',$2)",[rule.id,users.admin.id],'PY409');
 const later=await legacyRule(f.category,f.from.slice(0,4)+'-11-01');expect((await complete(later.id,null)).r.id).toBeTruthy();
 });
 test('frozen cross-category rule evidence is protected even when the run heading differs',async()=>{
 const f=await createReviewFixture(db,users,{factory:true});
 const foreign=await legacyRule('Fabric Factory Permanent Employees',f.from);
 await reviewAction(db,f.rows[0].id,'calculate',users.fm.id);
 const row=await one(db,'SELECT * FROM payroll_run_employees WHERE id=$1',[f.rows[0].id]);
 // Build a transaction-local frozen transfer fixture without enabling deployment finalization.
 await q(db,'SET CONSTRAINTS ALL IMMEDIATE');await q(db,'ALTER TABLE payroll_financial_snapshots DISABLE TRIGGER USER');
 const hash='0'.repeat(64),calc={status:'READY_FOR_REVIEW',blockers:[],source_fingerprint:hash,final_net_salary:'0.00',financial_readiness:true,calculation_revision:'PHASE6_CATEGORY_RULES_V1'};
 await q(db,'INSERT INTO payroll_financial_snapshots(row_id,employee_id,review_revision,source_fingerprint,source_token,source_snapshot,calculation_snapshot,earnings_total,deductions_total,net_salary,locked_by) VALUES($1,$2,$3,$4,$4,$5,$6,0,0,0,$7)',[row.id,row.employee_id,row.review_revision,hash,JSON.stringify({factory_rules:[{id:foreign.id}]}),JSON.stringify(calc),users.ho.id]);
 await q(db,'ALTER TABLE payroll_financial_snapshots ENABLE TRIGGER USER');
 await q(db,'ALTER TABLE payroll_run_employees DISABLE TRIGGER USER');await q(db,"UPDATE payroll_run_employees SET status='LOCKED' WHERE id=$1",[row.id]);await q(db,'ALTER TABLE payroll_run_employees ENABLE TRIGGER USER');
 expect((await one(db,'SELECT factory_calculation_impact($1,$2) r',[foreign.id,users.admin.id])).r.locked_rows).toBeGreaterThan(0);
 await rejected("SELECT complete_factory_calculation($1,26,'unsafe transfer edit',$2)",[foreign.id,users.admin.id],'PY409');
 });
 test('configuration writer conflicts with a concurrent finalization source fence',async()=>{
 const peer=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await peer.connect();
 try{
 await q(peer,'BEGIN');await q(peer,"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",['payroll_source:factory:'+category]);
 await rejected("SELECT complete_factory_calculation($1,26,'concurrent',$2)",[legacy.id,users.admin.id],'PY409');
 await q(peer,'ROLLBACK');expect((await complete(legacy.id)).r.id).toBeTruthy();
 await q(peer,'BEGIN');expect((await one(peer,'SELECT pg_try_advisory_xact_lock_shared(hashtextextended($1,0)) acquired',['payroll_source:factory:'+category])).acquired).toBe(false);await q(peer,'ROLLBACK');
 }finally{await peer.end();}
 });
 test('rule periods do not affect the day before their start and impact ends before the next rule',async()=>{
 const year=(await one(db,"SELECT y FROM generate_series(2300,9000) y WHERE NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_revisions WHERE employee_category=$1 AND extract(year FROM effective_from)=y) LIMIT 1",[category])).y;
 const r=await legacyRule(category,`${year}-01-01`);await legacyRule(category,`${year}-02-01`);
 expect((await one(db,'SELECT factory_calculation_impact($1,$2) r',[r.id,users.admin.id])).r.effective_to).toBe(`${year}-01-31`);
 });
});
