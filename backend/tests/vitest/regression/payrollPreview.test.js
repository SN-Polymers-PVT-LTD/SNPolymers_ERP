import {beforeAll,afterAll,beforeEach,afterEach,describe,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');const {policy}=require('../../helpers/payrollMasterFixtures');const {calculatePreview}=require('../../../src/domain/payroll/preview');
let db,admin,accounts,fm,ho;const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const user=async role=>(await one('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING id',[String(crypto.randomInt(7000000000,9999999999)),role,'Synthetic preview test'])).id;
async function employee(category='HO Staff',department='Head Office'){return one("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Synthetic payroll preview',$1,$2,'2500-01-01',$3,$3) RETURNING *",[category,department,admin]);}
async function assignment(e,group,from,to){const h=(await one('SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[e.id,'ASSIGNMENT',JSON.stringify([{group_code:group,employee_category:e.employee_category,department:e.department,effective_from:from,effective_to:to,employment_joined_on:'2500-01-01'}]),'ISOLATED SYNTHETIC EVIDENCE',admin])).id;return (await one('SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[h])).id;}
async function runRow(e,group,from='2500-02-01',to='2500-02-28'){
 const a=await assignment(e,group,from,to),r=await one("SELECT * FROM create_payroll_draft_run($1,$2,$3,$4,'Custom',$5)",[group,e.department,from,to,admin]);
 return one('SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[r.id,a,from,to,admin]);
}
async function office(){const e=await employee(),p=await one("SELECT * FROM create_hr_pay_structure($1,'Monthly salary',30000,10000,2000,NULL,true,false,'Active',$2)",[e.id,admin]);
 await q('SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[e.id,'PERMANENT_PAY',JSON.stringify([{pay_structure_id:p.id,effective_from:'2500-01-01',effective_to:null}]),'SYNTHETIC PAY APPLICABILITY',admin]);
 const data=policy({group_code:'HO_STAFF',effective_from:'2500-01-01',effective_to:'2500-12-31',rounding:{lop:{method:'HALF_UP',precision:2,stage:'MONTH'},proration:{method:'UNRESOLVED',precision:null,stage:'UNRESOLVED'},allocation:{method:'UNRESOLVED',precision:null,stage:'UNRESOLVED'}}});
 const draft=(await one("SELECT save_payroll_master_draft('policies',NULL,0,$1,$2) r",[JSON.stringify(data),admin])).r,preview=(await one("SELECT preview_payroll_master_publication('policies',$1,$2) r",[draft.id,admin])).r;
 await q("SELECT publish_payroll_master('policies',$1,1,$2,'SYNTHETIC ONLY',$3)",[draft.id,preview.preview_token,admin]);return {e,p,row:await runRow(e,'HO_STAFF')};
}
const source=async(row,actor=admin)=>(await one('SELECT get_payroll_preview_sources($1,$2) r',[row.id,actor])).r;
async function rejected(sql,args,code){await q('SAVEPOINT reject');await expect(q(sql,args)).rejects.toMatchObject({code});await q('ROLLBACK TO SAVEPOINT reject');}
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Payroll previews require the isolated profile');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>{if(db)await db.end();});beforeEach(async()=>{await q('BEGIN');admin=await user('admin');accounts=await user('accounts');fm=await user('factory_manager');ho=await user('ho');});afterEach(async()=>{await q('ROLLBACK');});
describe('read-only preview database sources',()=>{
 test('one snapshot preserves exact strings, historical salary, source references, and no financial writes',async()=>{
  const {e,row}=await office();await q("UPDATE hr_employees SET active_status='Exited',updated_by=$1 WHERE id=$2",[admin,e.id]);
  const counts=await q("SELECT (SELECT count(*) FROM payroll_row_versions) versions,(SELECT count(*) FROM payroll_action_history) actions,(SELECT count(*) FROM payroll_month_allocations) allocations,(SELECT count(*) FROM payroll_employee_coverage) coverage");
  const s=await source(row),r=calculatePreview(s);expect(s.pay_structures[0].guaranteed_monthly_gross).toBe('30000.00');expect(r.gross_after_lop).toBe('30000.00');expect(r.source_references.pay_applicability.length).toBe(1);expect(r.final_net_salary).toBeNull();expect(s.statutory_profile).toBeNull();
  expect(await q("SELECT (SELECT count(*) FROM payroll_row_versions) versions,(SELECT count(*) FROM payroll_action_history) actions,(SELECT count(*) FROM payroll_month_allocations) allocations,(SELECT count(*) FROM payroll_employee_coverage) coverage")).toEqual(counts);
  await rejected('SELECT get_payroll_preview_sources($1,$2)',[row.id,fm],'42501');
 });
 test('new source history invalidates the draft instead of using present-day assignments/pay',async()=>{
  const {e,row}=await office();await assignment(e,'HO_STAFF','2500-02-01','2500-02-28');expect(calculatePreview(await source(row)).blockers.map(b=>b.code)).toContain('ASSIGNMENT_HISTORY_OUTDATED');
 });
 test.each([['SNP Casual Factory Labour','SNP Factory','SNP_CASUAL'],['Fabric Factory Casual Factory Labour','Fabric Factory','FABRIC_CASUAL'],['Local Daily-Wage Workers','SNP Factory','SNP_LOCAL'],['Local Daily-Wage Workers','Fabric Factory','FABRIC_LOCAL']])('actual Locked %s / %s resolves master revisions and calculates duty once',async(category,department,group)=>{
  // Transaction-local isolation of the existing active roster; rollback restores it.
  await q("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'",[admin]);const e=await employee(category,department),local=category==='Local Daily-Wage Workers',date='2500-10-02';
  await q('INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by) VALUES($1,$2,400,$3)',[category,'2500-10-01',admin]);
  await q("INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,double_duty_multiplier,created_by) VALUES($1,$2,$3,true,'Fixed Hourly',50,$4,$5,'Not executable',$6,$7)",[category,'2500-10-01',local?12:8,!local,local?null:1.5,local?2:null,admin]);
  const sheet=await one('SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)',[date,category,admin,department]);
  const patch={employee_id:e.id,attendance_status:'Present',entry_timestamp:date+'T00:00:00+05:30',exit_timestamp:local?'2500-10-03T00:00:00+05:30':date+'T10:00:00+05:30',holiday_pay_eligible:!local,duty_type:local?'Double Duty':null};
  await q('SELECT save_hr_attendance_rows($1,$2,$3)',[sheet.id,JSON.stringify([patch]),admin]);
  await q("SELECT transition_hr_attendance_sheet($1,'submit',NULL,$2)",[sheet.id,admin]);await q("SELECT transition_hr_attendance_sheet($1,'review',NULL,$2)",[sheet.id,ho]);
  const row=await runRow(e,group,date,date);const s=await source(row),r=calculatePreview(s);expect(s.attendance[0].sheet_status).toBe('Locked');expect(typeof s.attendance[0].actual_hours).toBe('string');expect(r.gross_after_lop).toBe(local?'800.00':'700.00');expect(r.source_references.attendance[0].id).toBe(s.attendance[0].id);
  await rejected('SELECT get_payroll_preview_sources($1,$2)',[row.id,fm],'42501');await q('SELECT set_payroll_factory_scope($1,$2,true,$3,$4)',[fm,department,'Synthetic scoped access',admin]);expect((await source(row,fm)).row.id).toBe(row.id);
 });
 test('run selection is scoped, current grants and private helpers cannot be bypassed',async()=>{
  const {row}=await office();expect((await one('SELECT list_payroll_preview_runs($1,1,100) r',[fm])).r.runs).toEqual([]);expect((await one('SELECT list_payroll_preview_runs($1,1,100) r',[accounts])).r.runs.some(r=>r.id===row.run_id)).toBe(true);
  await q('SET LOCAL ROLE service_role');await rejected("SELECT payroll_preview_decimals('{}','{}')",[],'42501');expect((await source(row,accounts)).row.id).toBe(row.id);await q('RESET ROLE');
 });
});

test('monthly source snapshot checks every evidenced factory scope, including a transfer outside the selected run dates',async()=>{
 const e=await employee('SNP Permanent Factory Labour','SNP Factory');
 const intervals=[{group_code:'SNP_PERMANENT',employee_category:'SNP Permanent Factory Labour',department:'SNP Factory',effective_from:'2500-02-01',effective_to:'2500-02-15',employment_joined_on:'2500-01-01'},{group_code:'FABRIC_PERMANENT',employee_category:'Fabric Factory Permanent Employees',department:'Fabric Factory',effective_from:'2500-02-16',effective_to:'2500-02-28',employment_joined_on:'2500-01-01'}];
 const h=(await one('SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[e.id,'ASSIGNMENT',JSON.stringify(intervals),'SYNTHETIC evidenced transfer',admin])).id;
 const a=await one("SELECT id FROM payroll_employee_assignments WHERE revision_id=$1 AND department='SNP Factory'",[h]);
 const run=await one("SELECT * FROM create_payroll_draft_run('SNP_PERMANENT','SNP Factory','2500-02-01','2500-02-15','Custom',$1)",[admin]);
 const row=await one("SELECT * FROM add_payroll_draft_employee($1,$2,'2500-02-01','2500-02-15',$3)",[run.id,a.id,admin]);
 await q("SELECT set_payroll_factory_scope($1,'SNP Factory',true,'Synthetic one-factory grant',$2)",[fm,admin]);
 await rejected('SELECT get_payroll_preview_sources($1,$2)',[row.id,fm],'42501');
 await q("SELECT set_payroll_factory_scope($1,'Fabric Factory',true,'Synthetic second-factory grant',$2)",[fm,admin]);
 expect((await source(row,fm)).assignments.map(a=>a.department)).toEqual(['SNP Factory','Fabric Factory']);
});
