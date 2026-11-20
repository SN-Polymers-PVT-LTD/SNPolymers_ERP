import {beforeAll,afterAll,beforeEach,afterEach,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
let db,admin,employee;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const reject=async(fn,code)=>{await q('SAVEPOINT bad');await expect(fn()).rejects.toMatchObject({code});await q('ROLLBACK TO SAVEPOINT bad');};
beforeAll(async()=>{await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});afterAll(async()=>db?.end());
beforeEach(async()=>{await q('BEGIN');admin=(await one("INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,'admin','Exit test',true) RETURNING id",[String(crypto.randomInt(7000000000,9999999999))])).id;employee=(await one("INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES('Exit test','SNP Permanent Factory Labour','SNP Factory','2025-01-01',$1,$1) RETURNING id",[admin])).id;await q("SAVEPOINT before_assignment");await q("SELECT initialize_hr_payroll_assignment($1,'2025-01-01','Initial assignment',$2)",[employee,admin]);});afterEach(async()=>q('ROLLBACK'));
const exit=()=>q("UPDATE hr_employees SET active_status='Exited',last_working_date='2025-08-15',exit_reason='UAT resignation',updated_by=$2 WHERE id=$1",[employee,admin]);
test('exit closes assignment inclusively and preserves immutable prior history',async()=>{await exit();expect((await one("SELECT new_value FROM audit_log WHERE action='EMPLOYEE_EXIT_RECORDED' AND record_identifier=(SELECT employee_code FROM hr_employees WHERE id=$1)",[employee])).new_value).toMatchObject({last_working_date:'2025-08-15',exit_reason:'UAT resignation'});const rows=await q("SELECT a.effective_to::text,a.employment_exited_on::text,h.version FROM payroll_employee_assignments a JOIN payroll_source_history_revisions h ON h.id=a.revision_id WHERE a.employee_id=$1 ORDER BY h.version",[employee]);expect(rows).toEqual([{effective_to:null,employment_exited_on:null,version:1},{effective_to:'2025-08-15',employment_exited_on:'2025-08-15',version:2}]);await reject(()=>q("UPDATE hr_employees SET active_status='Active' WHERE id=$1",[employee]),'22023');await reject(()=>q("UPDATE hr_employees SET last_working_date='2025-08-16' WHERE id=$1",[employee]),'22023');});
test('missing, invalid and future exit dates fail without recording history',async()=>{for(const sql of ["active_status='Exited'","active_status='Exited',last_working_date='2024-12-31',exit_reason='Reason'","active_status='Exited',last_working_date='2099-01-01',exit_reason='Reason'"])await reject(()=>q('UPDATE hr_employees SET '+sql+' WHERE id=$1',[employee]),'22023');expect((await one("SELECT count(*) n FROM payroll_source_history_revisions WHERE employee_id=$1",[employee])).n).toBe('1');});
test('non-admin cannot record exit and later history cannot reopen it',async()=>{await q("UPDATE authorised_users SET role='accounts' WHERE id=$1",[admin]);await reject(exit,'42501');await q("UPDATE authorised_users SET role='admin' WHERE id=$1",[admin]);await exit();await reject(()=>q("SELECT record_payroll_source_history($1,'ASSIGNMENT',$2,'Invalid reopening',$3)",[employee,JSON.stringify([{group_code:'SNP_PERMANENT',employee_category:'SNP Permanent Factory Labour',department:'SNP Factory',effective_from:'2025-01-01',effective_to:null,employment_joined_on:'2025-01-01'}]),admin]),'22023');});
test('an active payroll reader blocks exit without changing employee status',async()=>{
 await q('ROLLBACK TO SAVEPOINT before_assignment');
 const other=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await other.connect();
 try{await other.query('BEGIN');await other.query("SELECT payroll_source_fence('employee:'||$1::text,true)",[employee]);await reject(exit,'PY409');expect((await one('SELECT active_status FROM hr_employees WHERE id=$1',[employee])).active_status).toBe('Active');}finally{await other.query('ROLLBACK');await other.end();}
});
test('assignment persistence failure rolls back employee status and exit date',async()=>{
 await q("CREATE FUNCTION pg_temp.reject_exit_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic history failure' USING ERRCODE='23514'; END $$");
 await q('CREATE TRIGGER z_reject_exit_history BEFORE INSERT ON payroll_employee_assignments FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_exit_history()');
 await reject(exit,'23514');expect(await one('SELECT active_status,last_working_date FROM hr_employees WHERE id=$1',[employee])).toEqual({active_status:'Active',last_working_date:null});
});
test('exit rejects finalized coverage after the last working date',async()=>{
 const assignment=(await one("SELECT id FROM payroll_employee_assignments WHERE employee_id=$1",[employee])).id;
 const run=(await one("INSERT INTO payroll_runs(group_code,department,period_from,period_to,cycle,created_by) VALUES('SNP_PERMANENT','SNP Factory','2025-08-01','2025-08-31','Monthly',$1) RETURNING id",[admin])).id;
 const row=(await one("INSERT INTO payroll_run_employees(run_id,employee_id,assignment_id,period_from,period_to,created_by) VALUES($1,$2,$3,'2025-08-01','2025-08-31',$4) RETURNING id",[run,employee,assignment,admin])).id;
 // Fixture only: install an existing finalized coverage record without invoking financial posting.
 await q('ALTER TABLE payroll_employee_coverage DISABLE TRIGGER payroll_coverage_phase1_gate');
 await q("INSERT INTO payroll_employee_coverage(employee_id,salary_row_id,period_from,period_to,finalized_at) VALUES($1,$2,'2025-08-01','2025-08-31',now())",[employee,row]);
 await q('ALTER TABLE payroll_employee_coverage ENABLE TRIGGER payroll_coverage_phase1_gate');
 await reject(exit,'PY409');expect((await one('SELECT active_status FROM hr_employees WHERE id=$1',[employee])).active_status).toBe('Active');
});
test('exit without prior assignment still records evidence and prevents open initialization',async()=>{
 await q('ROLLBACK TO SAVEPOINT before_assignment');await exit();
 expect(await one('SELECT last_working_date::text,exit_reason FROM hr_employees WHERE id=$1',[employee])).toEqual({last_working_date:'2025-08-15',exit_reason:'UAT resignation'});
 await reject(()=>q("SELECT initialize_hr_payroll_assignment($1,'2025-01-01','Would reopen exit',$2)",[employee,admin]),'22023');
});
