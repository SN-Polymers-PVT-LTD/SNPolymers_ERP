import {beforeAll,afterAll,beforeEach,afterEach,describe,test,expect} from 'vitest';
const {Client}=require('pg');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture,reviewAction}=require('../../helpers/payrollReviewFixtures');
const {interval,scope,save}=require('../../helpers/payrollProfileFixtures');const {statutory,pt}=require('../../helpers/payrollMasterFixtures');
let db,users;
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>db?.end());beforeEach(async()=>{await db.query('BEGIN');users=await createReviewUsers(db);});afterEach(async()=>db.query('ROLLBACK'));
async function reject(fn,code){await q(db,'SAVEPOINT invalid');await expect(fn()).rejects.toMatchObject({code});await q(db,'ROLLBACK TO SAVEPOINT invalid');}
async function prepared({gate=false,count=1,split=false,factory=false}={}){
 const f=await createReviewFixture(db,users,{count,factory,...(split?{policyOverrides:{split_period_allocation_method:'CALENDAR_WEIGHTED_WITH_RESIDUAL',rounding:{lop:{method:'HALF_UP',precision:2,stage:'MONTH'},proration:{method:'UNRESOLVED',precision:null,stage:'UNRESOLVED'},allocation:{method:'HALF_UP',precision:2,stage:'LINE'}}}}:{})}),scopeId=await scope(db,users.accounts.id);
 for(const employee of f.employees)await save(db,employee.id,users.accounts.id,0,[interval(scopeId,f.from,f.to,{verification_status:'ACCOUNTS_CONFIRMED',advisor_name:'SYNTHETIC Accounts setup'})]);
 const d=statutory({jurisdiction:'SYNTHETIC_'+scopeId,establishment:'SYNTHETIC',effective_from:f.from,effective_to:f.to,verification_status:'ACCOUNTS_CONFIRMED',advisor_name:'SYNTHETIC Accounts setup'});
 Object.assign(d.configuration,{collection_timing:'INCREMENTAL_MONTHLY',lop_wage_basis:'PROPORTIONAL_COMPONENTS',arrears_period:'CURRENT_RUN_MONTH',eligibility:'ENROLLED',rounding:{method:'HALF_UP',precision:2,stage:'MONTH'},adjustment_basis:{BONUS:'EXCLUDE',SALARY_ARREARS:'EXCLUDE',REIMBURSEMENT:'EXCLUDE',RECOVERY:'DEDUCTION_ONLY'}});
 if(factory){d.configuration.included_components=['DAILY_WAGE'];d.configuration.excluded_components=['BASIC','STAFF_WELFARE','OTHER_FIXED','PACKAGE_BALANCE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'];}
 const draft=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify(d),users.accounts.id])).r;
 const p=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[draft.id,users.accounts.id])).r;
 await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC setup',$3)",[draft.id,p.preview_token,users.accounts.id]);await q(db,'SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[draft.id,scopeId,'SYNTHETIC explicit binding',users.accounts.id]);
 // Synthetic zero PT slab preserves the focus of unrelated financial invariants.
 const tax=pt({...d,scheme:'PT',configuration:{...d.configuration,employee_rate:null,employer_rate:null,eligibility:'JURISDICTION_PROFILE',eligibility_ceiling:null,wage_ceiling:null,calculation_method:'SLABS'},slabs:Array.from({length:12},(_,i)=>({month:i+1,lower_bound:'0',upper_bound:null,deduction_amount:'0'}))});
 const td=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify(tax),users.accounts.id])).r;
 const tp=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[td.id,users.accounts.id])).r;
 await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC zero PT slab',$3)",[td.id,tp.preview_token,users.accounts.id]);await q(db,'SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[td.id,scopeId,'SYNTHETIC PT binding',users.accounts.id]);
 const cutoff=`${Number(f.to.slice(0,4))+1}-01-01T00:00:00+05:30`;
 await q(db,"SELECT set_payroll_period_cutoff($1,0,'propose',$2,'SYNTHETIC cutoff',$3)",[f.run.id,cutoff,users.accounts.id]);await q(db,"SELECT set_payroll_period_cutoff($1,1,'approve',NULL,'SYNTHETIC HO cutoff',$2)",[f.run.id,users.ho.id]);
 // Owner-only test substitutions are transaction-scoped and rolled back.
 if(gate){await q(db,'CREATE OR REPLACE FUNCTION payroll_financial_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$');await q(db,`CREATE OR REPLACE FUNCTION payroll_financial_clock() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT '${cutoff}'::timestamptz $$`);}
 return {...f,scopeId,cutoff};
}
async function submit(f,id=f.rows[0].id){await reviewAction(db,id,'calculate',users.accounts.id);await reviewAction(db,id,'submit',users.accounts.id);}
describe('guarded payroll financial transactions',()=>{
 test('Accounts confirms and publishes rules, while deployment activation remains off',async()=>{
  const f=await prepared();await submit(f);const r=await reviewAction(db,f.rows[0].id,'approve_lock',users.ho.id);expect(r.applied).toBe(false);expect(r.blockers.map(b=>b.code)).toContain('FINANCIAL_FINALIZATION_DISABLED');expect((await one(db,'SELECT count(*) n FROM payroll_financial_snapshots WHERE row_id=$1',[f.rows[0].id])).n).toBe('0');
 });
 test('lock atomically freezes snapshot, coverage, statutory month and entitlement; all remain immutable',async()=>{
  const f=await prepared({gate:true});await submit(f);const r=await reviewAction(db,f.rows[0].id,'approve_lock',users.ho.id);expect(r.row.status).toBe('LOCKED');expect((await one(db,'SELECT net_salary::text FROM payroll_financial_snapshots WHERE row_id=$1',[r.row.id])).net_salary).toBe('29296.30');expect((await q(db,'SELECT * FROM payroll_statutory_entries WHERE salary_row_id=$1',[r.row.id]))).toHaveLength(2);
  await reject(()=>q(db,'SELECT cancel_payroll_draft_run($1,$2,$3)',[f.run.id,'Synthetic locked-sheet deletion',users.accounts.id]),'PY409');
  const refresh=(await one(db,'SELECT populate_payroll_draft_run($1,$2) r',[f.run.id,users.accounts.id])).r;
  expect(refresh.added).toBe(0);expect(refresh.rows).toEqual([]);expect(refresh.saved_rows).toEqual([]);
  expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[r.row.id])).status).toBe('LOCKED');
  await reject(()=>reviewAction(db,r.row.id,'approve_lock',users.ho.id),'PY409');await reject(()=>q(db,'UPDATE payroll_financial_snapshots SET net_salary=0 WHERE row_id=$1',[r.row.id]),'42501');await reject(()=>q(db,'DELETE FROM payroll_employee_coverage WHERE salary_row_id=$1',[r.row.id]),'42501');
  const register=(await one(db,'SELECT get_payroll_salary_register($1,$2,1,20) r',[users.accounts.id,JSON.stringify({run_id:f.run.id})])).r;expect(register.rows[0]).toMatchObject({evidence_status:'IMMUTABLE_LOCKED',net_salary:'29296.30',payment_status:'NOT_RECORDED'});expect((await one(db,'SELECT get_payroll_official_payslip($1,$2) r',[r.row.id,users.accounts.id])).r.official).toBe(true);await q(db,'UPDATE hr_employees SET erp_user_id=$2,updated_by=$3 WHERE id=$1',[r.row.employee_id,users.je.id,users.admin.id]);expect((await one(db,'SELECT get_payroll_official_payslip($1,$2) r',[r.row.id,users.je.id])).r.official).toBe(true);await reject(()=>q(db,'SELECT get_payroll_official_payslip($1,$2)',[r.row.id,users.fm.id]),'42501');
 });
 test('bonus needs independent HO approval and is applied once at locking',async()=>{
  const f=await prepared({gate:true}),data={kind:'BONUS',amount:'1000.00',effective_date:f.from,target_row_id:f.rows[0].id,installment:null,recovery_start_month:null,original_period_from:null,original_period_to:null,evidence_reference:'SYNTHETIC bonus'};
  const a=(await one(db,'SELECT create_payroll_adjustment($1,$2,$3) r',[f.employees[0].id,JSON.stringify(data),users.accounts.id])).r;
  await reject(()=>q(db,"SELECT act_payroll_adjustment($1,1,'approve','not independent','{}',$2)",[a.id,users.accounts.id]),'42501');await q(db,"SELECT act_payroll_adjustment($1,1,'approve','SYNTHETIC HO approval','{}',$2)",[a.id,users.ho.id]);await submit(f);await reviewAction(db,f.rows[0].id,'approve_lock',users.ho.id);expect((await one(db,'SELECT count(*) n FROM payroll_adjustment_applications WHERE adjustment_id=$1',[a.id])).n).toBe('1');await reject(()=>q(db,'UPDATE payroll_adjustments SET amount=2000,version=version+1 WHERE id=$1',[a.id]),'42501');await reject(()=>q(db,'DELETE FROM payroll_adjustment_events WHERE adjustment_id=$1',[a.id]),'42501');
 });
 test('failure after snapshot insert rolls back every financial record and leaves review pending',async()=>{
  const f=await prepared({gate:true});await submit(f);await q(db,"CREATE FUNCTION pg_temp.fail_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC failure' USING ERRCODE='23514'; END $$");await q(db,'CREATE TRIGGER synthetic_fail_allocation BEFORE INSERT ON payroll_month_allocations FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_allocation()');await reject(()=>reviewAction(db,f.rows[0].id,'approve_lock',users.ho.id),'23514');
  for(const table of ['payroll_financial_snapshots','payroll_employee_coverage','payroll_employee_month_entitlements'])expect((await one(db,`SELECT count(*) n FROM ${table} WHERE employee_id=$1`,[f.employees[0].id])).n).toBe('0');expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[f.rows[0].id])).status).toBe('PENDING_HO_APPROVAL');
 });
 test('cutoff is independently approved, CAS protected and reached before locking',async()=>{
  const f=await prepared({gate:true});await reject(()=>q(db,"SELECT set_payroll_period_cutoff($1,1,'approve',NULL,'stale',$2)",[f.run.id,users.ho.id]),'PY409');await q(db,'CREATE OR REPLACE FUNCTION payroll_financial_clock() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() $$');await submit(f);await reject(()=>reviewAction(db,f.rows[0].id,'approve_lock',users.ho.id),'PY409');expect((await one(db,'SELECT count(*) n FROM payroll_financial_snapshots WHERE row_id=$1',[f.rows[0].id])).n).toBe('0');
 });
 test('calendar evidence changes stale a submitted review and cannot be edited',async()=>{
  const f=await prepared();await submit(f);const days=[{calendar_date:f.from,day_type:'Weekly Off',compensation_treatment:'PAID'}];await reject(()=>q(db,'SELECT publish_payroll_calendar_days($1,$2,$3,$4,$5)',[f.group,f.department,JSON.stringify(days),'SYNTHETIC',users.accounts.id]),'42501');await q(db,'SELECT publish_payroll_calendar_days($1,$2,$3,$4,$5)',[f.group,f.department,JSON.stringify(days),'SYNTHETIC',users.ho.id]);await reject(()=>reviewAction(db,f.rows[0].id,'approve_lock',users.ho.id),'PY409');await reject(()=>q(db,"UPDATE payroll_work_calendar_days SET compensation_treatment='UNPAID' WHERE group_code=$1 AND calendar_date=$2",[f.group,f.from]),'42501');
 });
 test('financial writes and private finalizer are unavailable to ordinary/API roles',async()=>{
  for(const role of ['authenticated','anon','service_role'])expect((await one(db,"SELECT has_table_privilege($1,'payroll_financial_snapshots','INSERT') can_write,has_function_privilege($1,'payroll_finalize_employee(uuid,jsonb,jsonb,uuid)','EXECUTE') can_finalize",[role]))).toEqual({can_write:false,can_finalize:false});
  for(const role of ['authenticated','anon','service_role'])for(const signature of ['payroll_source_fence(text,boolean)','payroll_source_write_fence()','payroll_lock_review_sources(uuid,uuid)'])expect((await one(db,'SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).allowed).toBe(false);
 });
 test('effective finalization uses scoped fences and every source writer participates',async()=>{
  const fn=(await one(db,"SELECT pg_get_functiondef('transition_payroll_employee_review(uuid,integer,integer,text,jsonb,uuid)'::regprocedure) definition")).definition;
  expect(fn).not.toContain('LOCK TABLE');expect(fn).toContain('payroll_lock_review_sources');
  const tables=await q(db,"SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='a00_payroll_source_fence' AND t.tgenabled='O' ORDER BY c.relname");
  expect(tables.map(r=>r.relname)).toEqual(['beneficiary_master','hr_attendance_rows','hr_attendance_sheets','hr_factory_pay_rule_revisions','hr_factory_wage_revisions','hr_leave_requests','hr_permanent_pay_structures','indian_bank_master','payroll_adjustments','payroll_employee_assignments','payroll_employee_statutory_profiles','payroll_permanent_pay_applicability','payroll_policy_master_revisions','payroll_professional_tax_slabs','payroll_run_employees','payroll_runs','payroll_source_history_revisions','payroll_statutory_rule_revisions','payroll_statutory_scope_bindings','payroll_work_calendar_days']);
 });
});

test('split locking accumulates schemes once and freezes a single monthly entitlement',async()=>{
 const f=await prepared({gate:true,split:true}),original=f.rows[0];await reviewAction(db,original.id,'cancel',users.accounts.id);
 const parts=[[f.from,f.from.slice(0,8)+'15'],[f.from.slice(0,8)+'16',f.to]],rows=[];
 for(const [from,to] of parts){const run=await one(db,"SELECT * FROM create_payroll_draft_run($1,$2,$3,$4,'Custom',$5)",[f.group,f.department,from,to,users.accounts.id]);await q(db,"SELECT set_payroll_period_cutoff($1,0,'propose',$2,'SYNTHETIC cutoff',$3)",[run.id,f.cutoff,users.accounts.id]);await q(db,"SELECT set_payroll_period_cutoff($1,1,'approve',NULL,'SYNTHETIC HO cutoff',$2)",[run.id,users.ho.id]);rows.push(await one(db,'SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[run.id,original.assignment_id,from,to,users.accounts.id]));}
 const [first,second]=rows;
 await submit(f,first.id);await reviewAction(db,first.id,'approve_lock',users.ho.id);await submit(f,second.id);await reviewAction(db,second.id,'approve_lock',users.ho.id);
 expect((await one(db,'SELECT allocated_base::text FROM payroll_employee_month_entitlements WHERE employee_id=$1',[original.employee_id])).allocated_base).toBe('30000.000000');expect((await one(db,"SELECT sum(employee_amount)::text n FROM payroll_statutory_entries WHERE employee_id=$1 AND scheme='EPF'",[original.employee_id])).n).toBe('703.700000');expect((await one(db,'SELECT sum(net_salary)::text n FROM payroll_financial_snapshots WHERE employee_id=$1',[original.employee_id])).n).toBe('29296.30');
});

test('independent salaries lock concurrently; sources and duplicate locks stay protected; gate and clock are restored',async()=>{
 const f=await prepared({gate:true,count:2});await submit(f);const row=await one(db,'SELECT * FROM payroll_run_employees WHERE id=$1',[f.rows[0].id]);const saved=(await one(db,'SELECT source_fingerprint FROM payroll_review_revisions WHERE row_id=$1',[row.id])).source_fingerprint;
 await q(db,'UPDATE hr_employees SET erp_user_id=$2,updated_by=$3 WHERE id=$1',[f.employees[1].id,users.je.id,users.admin.id]);
 await submit(f,f.rows[1].id);
 const worker=await one(db,"INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('SYNTHETIC concurrent attendance','SNP Casual Factory Labour','SNP Factory',$1,$2,$2) RETURNING id",[f.from,users.admin.id]);
 await q(db,'COMMIT');const c1=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI}),c2=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await c1.connect();await c2.connect();
 try{
  await q(c1,'BEGIN');expect((await reviewAction(c1,row.id,'approve_lock',users.ho.id)).row.status).toBe('LOCKED');
  // Keep the actual finalization transaction open: unrelated operational writes
  // must finish without relying on a payroll commit to release table locks.
  expect((await one(c1,"SELECT count(*) n FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='relation' AND mode='ShareLock'")).n).toBe('0');
  await q(c2,'BEGIN');await q(c2,"SET LOCAL lock_timeout='500ms'");
  expect((await one(c2,"SELECT pg_try_advisory_xact_lock(hashtextextended('payroll_cutoff:'||$1::text,0)) acquired",[f.run.id])).acquired).toBe(false);
  await q(c2,"SELECT save_hr_leave_request(NULL,$1,'SELF_SERVICE',$2,$2,'Medical Leave','SYNTHETIC unrelated leave','Pending',$3)",[f.employees[1].id,f.from,users.je.id]);
  const sheet=await one(c2,"INSERT INTO hr_attendance_sheets(attendance_date,employee_category,department,created_by,updated_by) VALUES($1,'SNP Casual Factory Labour','SNP Factory',$2,$2) RETURNING id",[f.from,users.admin.id]);
  await q(c2,'INSERT INTO hr_attendance_rows(sheet_id,employee_id,created_by,updated_by) VALUES($1,$2,$3,$3)',[sheet.id,worker.id,users.admin.id]);
  await q(c2,'SELECT save_hr_attendance_rows($1,$2,$3)',[sheet.id,JSON.stringify([{employee_id:worker.id,attendance_status:'Absent'}]),users.admin.id]);
  // An in-flight source writer makes finalization fail closed, rather than
  // waiting with an employee lock and creating a source-lock inversion.
  await q(c1,'SAVEPOINT active_writer');
  await expect(c1.query('SELECT payroll_lock_review_sources($1,$2)',[f.employees[1].id,f.run.id])).rejects.toMatchObject({code:'PY409'});
  await q(c1,'ROLLBACK TO SAVEPOINT active_writer');
  await q(c2,'SAVEPOINT related_write');
  await expect(c2.query("UPDATE hr_permanent_pay_structures SET guaranteed_monthly_gross=31000 WHERE employee_id=$1 AND status='Active'",[row.employee_id])).rejects.toMatchObject({code:'PY409'});
  await q(c2,'ROLLBACK TO SAVEPOINT related_write');
  // INSERT phantoms are fenced too; existing-row locks alone cannot do this.
  await expect(c2.query('SELECT publish_payroll_calendar_days($1,$2,$3,$4,$5)',[f.group,f.department,JSON.stringify([{calendar_date:f.from,day_type:'Scheduled Workday',compensation_treatment:'PAID'}]),'SYNTHETIC new source',users.admin.id])).rejects.toMatchObject({code:'PY409'});
  await q(c2,'ROLLBACK TO SAVEPOINT related_write');
  const unrelatedPolicy=require('../../helpers/payrollMasterFixtures').policy({group_code:'PROJECTS_JE',effective_from:f.from,effective_to:f.to});
  await q(c2,"SELECT save_payroll_master_draft('policies',NULL,0,$1,$2)",[JSON.stringify(unrelatedPolicy),users.admin.id]);
  await q(c2,'ROLLBACK');await q(c2,"SET lock_timeout='500ms'");
  // Different employees can finalize concurrently against the same policy,
  // calendar, statutory configuration and parent sheet (distinct reviewers).
  expect((await reviewAction(c2,f.rows[1].id,'approve_lock',users.admin.id)).row.status).toBe('LOCKED');
  await q(c2,"SET lock_timeout='5s'");
  const pending=c2.query('SELECT transition_payroll_employee_review($1,$2,$3,$4,$5,$6)',[row.id,row.current_version,row.review_version,'approve_lock',JSON.stringify({source_fingerprint:saved}),users.ho.id]).then(()=>({ok:true}),e=>({code:e.code}));await q(c1,'COMMIT');expect(await pending).toEqual({code:'PY409'});expect((await one(db,'SELECT count(*) n FROM payroll_financial_snapshots WHERE row_id=$1',[row.id])).n).toBe('1');
 }finally{
  await q(c1,'ROLLBACK');await c1.end();await q(c2,'ROLLBACK');await c2.end();await q(db,'CREATE OR REPLACE FUNCTION payroll_financial_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$');await q(db,'CREATE OR REPLACE FUNCTION payroll_financial_clock() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() $$');await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,[...f.employees.map(e=>e.id),worker.id]]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await q(db,'BEGIN');
 }
});

test('issued advance balance is recovered only on successful salary lock, with HO-approved pause/replan',async()=>{
 const f=await prepared({gate:true}),employee=f.employees[0].id;
 await q(db,"UPDATE hr_employees SET joining_date='2020-01-01',updated_by=$2 WHERE id=$1",[employee,users.admin.id]);
 const history=(await one(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[employee,'ASSIGNMENT',JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:'2020-01-01',effective_to:f.to,employment_joined_on:'2020-01-01'}]),'SYNTHETIC historical employment evidence',users.admin.id])).id;
 const assignment=(await one(db,'SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[history])).id;await reviewAction(db,f.rows[0].id,'correct',users.accounts.id,{note:'SYNTHETIC dated assignment',assignment_id:assignment});
 const issued=(await one(db,"SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text d")).d;
 const data={kind:'ADVANCE',amount:'1000.00',effective_date:issued,target_row_id:null,installment:'333.33',recovery_start_month:f.from,original_period_from:null,original_period_to:null,evidence_reference:'SYNTHETIC external advance issue'};
 let a=(await one(db,'SELECT create_payroll_adjustment($1,$2,$3) r',[employee,JSON.stringify(data),users.accounts.id])).r;
 a=(await one(db,"SELECT act_payroll_adjustment($1,$2,'approve','SYNTHETIC HO plan','{}',$3) r",[a.id,a.version,users.ho.id])).r;
 a=(await one(db,"SELECT act_payroll_adjustment($1,$2,'pause','SYNTHETIC HO pause','{}',$3) r",[a.id,a.version,users.ho.id])).r;
 expect((await one(db,'SELECT get_payroll_review_sources($1,$2) r',[f.rows[0].id,users.accounts.id])).r.adjustments[0].status).toBe('PAUSED');
 a=(await one(db,"SELECT act_payroll_adjustment($1,$2,'resume','SYNTHETIC HO resume','{}',$3) r",[a.id,a.version,users.ho.id])).r;
 await submit(f);expect((await one(db,'SELECT count(*) n FROM payroll_adjustment_applications WHERE adjustment_id=$1',[a.id])).n).toBe('0');await reviewAction(db,f.rows[0].id,'approve_lock',users.ho.id);
 const ledger=(await one(db,'SELECT get_payroll_adjustments($1,$2,1,20) r',[employee,users.accounts.id])).r;expect(ledger.rows[0].outstanding_balance).toBe('666.67');expect(ledger.rows[0].recovered_amount).toBe('333.33');expect(ledger.rows[0].history).toHaveLength(4);
});

test('verified zero-net Casual salary locks without creating any payment obligation',async()=>{
 // Roster isolation is transaction-local; rollback restores all prior fixtures.
 await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'",[users.admin.id]);const f=await prepared({gate:true,factory:true});
 await q(db,'INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by) VALUES($1,$2,400,$3)',[f.category,f.from,users.admin.id]);
 await q(db,"INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,created_by) VALUES($1,$2,8,true,'Fixed Hourly',50,true,1.5,'Not executable',$3)",[f.category,f.from,users.admin.id]);
 const sheet=await one(db,'SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)',[f.from,f.category,users.admin.id,f.department]);await q(db,'SELECT save_hr_attendance_rows($1,$2,$3)',[sheet.id,JSON.stringify([{employee_id:f.employees[0].id,attendance_status:'Absent'}]),users.admin.id]);await q(db,"SELECT transition_hr_attendance_sheet($1,'submit',NULL,$2)",[sheet.id,users.admin.id]);await q(db,"SELECT transition_hr_attendance_sheet($1,'review',NULL,$2)",[sheet.id,users.ho.id]);
 await reviewAction(db,f.rows[0].id,'calculate',users.fm.id);await reviewAction(db,f.rows[0].id,'submit',users.fm.id);await reviewAction(db,f.rows[0].id,'forward',users.accounts.id);await reviewAction(db,f.rows[0].id,'approve_lock',users.ho.id);
 const payslip=(await one(db,'SELECT get_payroll_official_payslip($1,$2) r',[f.rows[0].id,users.accounts.id])).r;expect(payslip.calculation.final_net_salary).toBe('0.00');expect(payslip.payment_status).toBe('NOT_REQUIRED');expect((await one(db,'SELECT count(*) n FROM payroll_month_allocations WHERE salary_row_id=$1',[f.rows[0].id])).n).toBe('0');
});

test('factory mid-month source resolves the employee-scoped master applicable at statutory month start',async()=>{
 const f=await prepared({factory:true}),to=f.from.slice(0,8)+'31',date=f.from.slice(0,8)+'15';
 const history=(await one(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[f.employees[0].id,'ASSIGNMENT',JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:f.from,effective_to:to,employment_joined_on:f.from}]),'SYNTHETIC complete monthly assignment',users.admin.id])).id;
 await save(db,f.employees[0].id,users.accounts.id,1,[interval(f.scopeId,f.from,to,{verification_status:'ACCOUNTS_CONFIRMED',advisor_name:'SYNTHETIC Accounts setup',verification_reference:'SYNTHETIC revised monthly profile'})]);
 const assignment=(await one(db,'SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[history])).id,run=await one(db,"SELECT * FROM create_payroll_draft_run($1,$2,$3,$3,'Custom',$4)",[f.group,f.department,date,users.fm.id]);const row=await one(db,'SELECT * FROM add_payroll_draft_employee($1,$2,$3,$3,$4)',[run.id,assignment,date,users.fm.id]);const src=(await one(db,'SELECT get_payroll_review_sources($1,$2) r',[row.id,users.accounts.id])).r;
 expect(src.statutory_calculation_rules).toHaveLength(1);expect(src.statutory_calculation_rules[0].effective_to).toBe(f.from);expect(src.statutory_rules).toEqual([]);
});

test('open-ended statutory revisions resolve without guessed end dates, supersede future tails and cannot reopen history',async()=>{
 const f=await prepared(),from=`${Number(f.from.slice(0,4))+1}-01-01`,d=statutory({jurisdiction:'SYNTHETIC_OPEN_'+f.scopeId,establishment:'SYNTHETIC',effective_from:from,effective_to:null,verification_status:'ACCOUNTS_CONFIRMED',advisor_name:'SYNTHETIC Accounts setup'});
 const publish=async data=>{const draft=(await one(db,"SELECT save_payroll_master_draft('statutory',NULL,0,$1,$2) r",[JSON.stringify(data),users.accounts.id])).r,p=(await one(db,"SELECT preview_payroll_master_publication('statutory',$1,$2) r",[draft.id,users.accounts.id])).r;expect(p.publishable).toBe(true);await q(db,"SELECT publish_payroll_master('statutory',$1,1,$2,'SYNTHETIC confirmed setup',$3)",[draft.id,p.preview_token,users.accounts.id]);return draft.id;};
 const first=await publish(d),scopeId=await scope(db,users.accounts.id);await q(db,'SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[first,scopeId,'SYNTHETIC binding',users.accounts.id]);
 expect((await one(db,"SELECT resolve_payroll_master('statutory',$1,$2,$3) r",[JSON.stringify({scheme:'EPF',statutory_scope_id:scopeId}),`${Number(from.slice(0,4))+3}-02-01`,users.accounts.id])).r.revision_id).toBe(first);
 const nextFrom=`${Number(from.slice(0,4))+1}-01-01`;await publish({...d,effective_from:nextFrom,verification_reference:'SYNTHETIC new revision evidence'});const old=await one(db,'SELECT effective_to::text,published_effective_to FROM payroll_statutory_rule_revisions WHERE id=$1',[first]);expect(old.effective_to).toBe(`${Number(from.slice(0,4))}-12-31`);expect(old.published_effective_to).toBeNull();await reject(()=>q(db,'UPDATE payroll_statutory_rule_revisions SET effective_to=NULL WHERE id=$1',[first]),'42501');
});

test('contradictory calendar batch rolls back all days instead of charging a named paid holiday',async()=>{const f=await prepared();const days=[{calendar_date:f.from,day_type:'Scheduled Workday',compensation_treatment:'PAID'},{calendar_date:f.from.slice(0,8)+'02',day_type:'Paid Holiday',compensation_treatment:'UNPAID'}];await reject(()=>q(db,'SELECT publish_payroll_calendar_days($1,$2,$3,$4,$5)',[f.group,f.department,JSON.stringify(days),'SYNTHETIC contradictory calendar',users.ho.id]),'23514');expect((await one(db,'SELECT count(*) n FROM payroll_work_calendar_days WHERE group_code=$1 AND calendar_date=$2',[f.group,f.from])).n).toBe('0');});
