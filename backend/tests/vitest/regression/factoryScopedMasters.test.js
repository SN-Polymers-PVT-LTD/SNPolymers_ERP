import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture}=require('../../helpers/payrollReviewFixtures');
const {calculatePreview}=require('../../../src/domain/payroll/preview');
let db,users;const category='Local Daily-Wage Workers';
async function reject(sql,args,code){await q(db,'SAVEPOINT invalid');await expect(q(db,sql,args)).rejects.toMatchObject({code});await q(db,'ROLLBACK TO SAVEPOINT invalid');}
const wage=(department,amount='400',date='8801-01-01')=>one(db,"INSERT INTO hr_factory_wage_revisions(employee_category,department,effective_from,daily_wage,setup_reason,created_by) VALUES($1,$2,$3,$4,'Synthetic factory adoption',$5) RETURNING *",[category,department,date,amount,users.admin.id]);
const rule=(department,date='8801-01-01')=>one(db,"INSERT INTO hr_factory_pay_rule_revisions(employee_category,department,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,holiday_pay_enabled,management_stoppage_treatment,double_duty_multiplier,setup_reason,created_by) VALUES($1,$2,$3,12,false,'Fixed Hourly',0,false,'Retain normal pay',2,'Synthetic adoption',$4) RETURNING *",[category,department,date,users.admin.id]);
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});afterAll(async()=>db?.end());beforeEach(async()=>{await q(db,'BEGIN');users=await createReviewUsers(db);});afterEach(async()=>q(db,'ROLLBACK'));
test('same Local category and date have independent factory wages and revision sequences',async()=>{
 const prior=await q(db,"SELECT department,max(revision_number)::int n FROM hr_factory_wage_revisions WHERE employee_category=$1 GROUP BY department",[category]);
 const next=dept=>(prior.find(r=>r.department===dept)?.n||0)+1;
 const a=await wage('SNP Factory'),b=await wage('Fabric Factory','500');expect(a.revision_number).toBe(next('SNP Factory'));expect(b.revision_number).toBe(next('Fabric Factory'));
 expect((await wage('SNP Factory','450','8801-02-01')).revision_number).toBe(a.revision_number+1);
 await reject("INSERT INTO hr_factory_wage_revisions(employee_category,department,effective_from,daily_wage,setup_reason,created_by) VALUES($1,$2,'8801-01-01',999,'duplicate',$3)",[category,'SNP Factory',users.admin.id],'23505');
});
test('ambiguous Local, invalid pairs, inactive and unauthorized authors are rejected',async()=>{
 await reject("INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by) VALUES($1,'8801-01-01',400,$2)",[category,users.admin.id],'23514');
 await reject("INSERT INTO hr_factory_wage_revisions(employee_category,department,effective_from,daily_wage,created_by) VALUES('SNP Casual Factory Labour','Fabric Factory','8801-01-01',400,$1)",[users.admin.id],'23514');
 await reject("INSERT INTO hr_factory_wage_revisions(employee_category,department,effective_from,daily_wage,setup_reason,created_by) VALUES($1,'SNP Factory','8801-01-01',400,'Denied',$2)",[category,users.accounts.id],'42501');
 await q(db,'UPDATE authorised_users SET is_active=false WHERE id=$1',[users.fm.id]);
 await reject("INSERT INTO hr_factory_wage_revisions(employee_category,department,effective_from,daily_wage,setup_reason,created_by) VALUES($1,'SNP Factory','8801-01-01',400,'Inactive',$2)",[category,users.fm.id],'42501');
});
test('legacy locked attendance retains recorded shared revision IDs after factory adoption',async()=>{
 await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'",[users.admin.id]);
 const f=await createReviewFixture(db,users,{factory:true,local:true});
 const prior=new Date(Date.parse(f.from+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const w=await wage(f.department,'400',prior),r=await rule(f.department,prior);
 await q(db,"SELECT complete_factory_setup($1,NULL,NULL,'Synthetic legacy setup',$2)",[r.id,users.admin.id]);
 const s=await one(db,'SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)',[f.from,category,users.admin.id,f.department]);
 await q(db,'SELECT save_hr_attendance_rows($1,$2,$3)',[s.id,JSON.stringify([{employee_id:f.employees[0].id,attendance_status:'Present',duty_type:'Single Duty',entry_timestamp:f.from+'T00:00:00+05:30',exit_timestamp:f.from+'T12:00:00+05:30'}]),users.admin.id]);
 await q(db,"SELECT transition_hr_attendance_sheet($1,'submit',NULL,$2)",[s.id,users.admin.id]);await q(db,"SELECT transition_hr_attendance_sheet($1,'review',NULL,$2)",[s.id,users.ho.id]);
 // Reconstruct a pre-migration shared row in this rollback-only fixture.
 for(const table of ['hr_factory_wage_revisions','hr_factory_pay_rule_revisions','hr_attendance_rows'])await q(db,`ALTER TABLE ${table} DISABLE TRIGGER USER`);
 await q(db,'UPDATE hr_factory_wage_revisions SET department=NULL,revision_number=(SELECT coalesce(max(revision_number),0)+1 FROM hr_factory_wage_revisions WHERE employee_category=$2 AND department IS NULL) WHERE id=$1',[w.id,category]);await q(db,'UPDATE hr_factory_pay_rule_revisions SET department=NULL,revision_number=(SELECT coalesce(max(revision_number),0)+1 FROM hr_factory_pay_rule_revisions WHERE employee_category=$2 AND department IS NULL) WHERE id=$1',[r.id,category]);await q(db,'UPDATE hr_attendance_rows SET master_scope_version=0 WHERE sheet_id=$1',[s.id]);
 for(const table of ['hr_factory_wage_revisions','hr_factory_pay_rule_revisions','hr_attendance_rows'])await q(db,`ALTER TABLE ${table} ENABLE TRIGGER USER`);
 const before=await q(db,'SELECT * FROM hr_attendance_rows WHERE sheet_id=$1',[s.id]);
 await wage(f.department,'900',f.from);await rule(f.department,f.from);
 const src=(await one(db,'SELECT get_payroll_review_sources($1,$2) s',[f.rows[0].id,users.accounts.id])).s;
 expect(calculatePreview(src).gross_after_lop).toBe('400.00');
 expect(src.attendance[0].wage_revision_id).toBe(w.id);expect(src.attendance[0].pay_rule_revision_id).toBe(r.id);
 expect(await q(db,'SELECT * FROM hr_attendance_rows WHERE sheet_id=$1',[s.id])).toEqual(before);
});
test('attendance and source RPC calculate each factory rate and double duty with shared logic',async()=>{
 await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'",[users.admin.id]);
 for(const [department,amount,expected] of [['SNP Factory','400','800.00'],['Fabric Factory','500','1000.00']]){
 const f=await createReviewFixture(db,users,{factory:true,local:true,department});await wage(department,amount,f.from);const r=await rule(department,f.from);
 await q(db,"SELECT complete_factory_setup($1,NULL,NULL,'Confirmed factory settings',$2)",[r.id,users.admin.id]);
 const sheet=await one(db,'SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)',[f.from,category,users.admin.id,department]);
 const next=new Date(Date.parse(f.from+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 await q(db,'SELECT save_hr_attendance_rows($1,$2,$3)',[sheet.id,JSON.stringify([{employee_id:f.employees[0].id,attendance_status:'Present',duty_type:'Double Duty',entry_timestamp:f.from+'T00:00:00+05:30',exit_timestamp:next+'T00:00:00+05:30'}]),users.admin.id]);
 await q(db,"SELECT transition_hr_attendance_sheet($1,'submit',NULL,$2)",[sheet.id,users.admin.id]);await q(db,"SELECT transition_hr_attendance_sheet($1,'review',NULL,$2)",[sheet.id,users.ho.id]);
 const src=(await one(db,'SELECT get_payroll_review_sources($1,$2) s',[f.rows[0].id,users.accounts.id])).s;
 expect(src.attendance[0].master_scope_version).toBe(1);expect(src.wages.every(w=>!w.department||w.department===department)).toBe(true);
 const calc=calculatePreview(src);expect(calc.gross_after_lop).toBe(expected);expect(calc.earnings.some(l=>l.code==='OVERTIME')).toBe(false);
 }
});
test('new Local attendance blocks without factory-specific setup',async()=>{
 await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'",[users.admin.id]);
 await q(db,"INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Synthetic missing setup',$1,'Fabric Factory','0001-01-01',$2,$2)",[category,users.admin.id]);
 await reject('SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)',['0001-01-01',category,users.admin.id,'Fabric Factory'],'23514');
});
test('locked payroll rejects same-factory revisions but does not block the other factory',async()=>{
 const f=await createReviewFixture(db,users,{factory:true,local:true});
 // Synthetic locked row only, rolled back with this test; deployment financial gate remains closed.
 await q(db,'SET CONSTRAINTS ALL IMMEDIATE');await q(db,'ALTER TABLE payroll_run_employees DISABLE TRIGGER USER');
 await q(db,"UPDATE payroll_run_employees SET status='LOCKED' WHERE id=$1",[f.rows[0].id]);await q(db,'ALTER TABLE payroll_run_employees ENABLE TRIGGER USER');
 for(const table of ['hr_factory_wage_revisions','hr_factory_pay_rule_revisions']){
  if(table==='hr_factory_wage_revisions')await reject("INSERT INTO hr_factory_wage_revisions(employee_category,department,effective_from,daily_wage,setup_reason,created_by) VALUES($1,'SNP Factory',$2,400,'locked',$3)",[category,f.from,users.admin.id],'PY409');
  else await reject("INSERT INTO hr_factory_pay_rule_revisions(employee_category,department,effective_from,standard_duty_hours,setup_reason,created_by) VALUES($1,'SNP Factory',$2,12,'locked',$3)",[category,f.from,users.admin.id],'PY409');
 }
 expect((await wage('Fabric Factory','500',f.from)).department).toBe('Fabric Factory');
 expect((await rule('Fabric Factory',f.from)).department).toBe('Fabric Factory');
 expect((await wage('SNP Factory','450',f.from.slice(0,4)+'-11-01')).id).toBeTruthy();
});
test('another factory revision does not shorten rule impact',async()=>{
 const a=await rule('SNP Factory','8801-01-01');await rule('Fabric Factory','8801-02-01');await rule('SNP Factory','8801-03-01');
 const impact=(await one(db,'SELECT factory_calculation_impact($1,$2) r',[a.id,users.admin.id])).r;
 expect(impact.department).toBe('SNP Factory');expect(JSON.stringify(impact)).toContain('8801-02-28');
});
test('master writes serialize with a concurrent finalization fence',async()=>{
 const peer=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await peer.connect();
 let pending;
 try{await q(peer,'BEGIN');const rootPid=(await one(db,'SELECT pg_backend_pid() pid')).pid;
 await q(peer,"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",['payroll_source:factory:'+category]);
 await q(db,"SET LOCAL statement_timeout='5s'");pending=wage('SNP Factory');
 await new Promise(resolve=>setTimeout(resolve,50));
 expect((await one(peer,'SELECT cardinality(pg_blocking_pids($1)) n',[rootPid])).n).toBeGreaterThan(0);
 await q(peer,'ROLLBACK');expect((await pending).id).toBeTruthy();
 // Once the writer owns the fence, finalization must retry instead of waiting.
 await q(peer,'BEGIN');expect((await one(peer,"SELECT pg_try_advisory_xact_lock_shared(hashtextextended($1,0)) acquired",['payroll_source:factory:'+category])).acquired).toBe(false);
 }finally{await q(peer,'ROLLBACK');if(pending)await pending.catch(()=>{});await peer.end();}
});
