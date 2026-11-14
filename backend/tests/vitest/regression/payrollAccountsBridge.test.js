import {beforeAll,afterAll,beforeEach,afterEach,describe,test,expect} from 'vitest';
const {Client}=require('pg');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture,reviewAction}=require('../../helpers/payrollReviewFixtures');
let db,users;
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>db?.end());beforeEach(async()=>{await db.query('BEGIN');await q(db,'CREATE OR REPLACE FUNCTION payroll_financial_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$');await q(db,'CREATE OR REPLACE FUNCTION payroll_financial_clock() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() $$');users=await createReviewUsers(db);});afterEach(async()=>db.query('ROLLBACK'));
async function reject(fn,code){await q(db,'SAVEPOINT invalid');await expect(fn()).rejects.toMatchObject({code});await q(db,'ROLLBACK TO SAVEPOINT invalid');}
const {prepareFinancialReview}=require('../../helpers/payrollFinancialFixtures');
const prepared=options=>prepareFinancialReview(db,users,options);
const crypto=require('crypto');
const {calculatePreview}=require('../../../src/domain/payroll/preview');
async function recipient(){
 const name='SYNTHETIC bridge '+crypto.randomUUID();
 const bank=await one(db,'INSERT INTO indian_bank_master(bank_name,created_by) VALUES($1,$2) RETURNING *',[name,users.admin.mobile_number]);
 const b=await one(db,"INSERT INTO beneficiary_master(account_number,ifsc,beneficiary_name,beneficiary_bank_id,beneficiary_bank_name,created_by) VALUES($1,'TEST0000001','Synthetic employee',$2,$3,$4) RETURNING *",[String(crypto.randomInt(100000000000,999999999999)),bank.id,name,users.admin.mobile_number]);
 await q(db,"INSERT INTO bank_balance_master(bank_name,balance_date,available_balance,account_number,created_by,updated_by) VALUES($1,CURRENT_DATE,100000,'123456789012',$2,$2)",[name,users.accounts.mobile_number]);return {bank:name,b};
}
async function deliver(f){
 const row=f.rows[0];await reviewAction(db,row.id,'calculate',f.creator.id);
 const r=await one(db,'SELECT r.*,v.source_fingerprint FROM payroll_run_employees r JOIN payroll_review_revisions v ON v.row_id=r.id AND v.revision=r.review_revision WHERE r.id=$1',[row.id]);
 return (await one(db,'SELECT deliver_payroll_to_accounts($1,$2,$3,$4,$5) r',[r.id,r.current_version,r.review_version,r.source_fingerprint,f.creator.id])).r;
}
async function details(d,r){return (await one(db,"SELECT save_payroll_payment_details($1,$2,$3,'NEFT',$4,NULL,NULL,$5) r",[d.delivery_id,(await one(db,'SELECT version FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id])).version,r.bank,r.b.id,users.accounts.id])).r;}
async function send(d){return one(db,'SELECT submit_payroll_accounts_sheet($1,$2) r',[d.accounts_sheet_id,users.accounts.id]);}
async function act(d,action='Approve',actor=users.ho.id){
 const link=await one(db,'SELECT * FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id]);
 let src=null,calc=null;if(action==='Approve'){src=(await one(db,'SELECT get_payroll_review_sources($1,$2) r',[link.row_id,actor])).r;calc=calculatePreview(src);}
 return (await one(db,'SELECT act_payroll_accounts_item($1,$2,$3,$4,$5,$6,$7) r',[link.id,link.version,action,action==='Approve'?null:'SYNTHETIC decision',src&&JSON.stringify(src),calc&&JSON.stringify(calc),actor])).r;
}
test('office salary travels through a real Accounts sheet; approval posts once and payment is separate',async()=>{
 const f=await prepared({gate:true}),d=await deliver(f),r=await recipient();
 expect(d.row.status).toBe('IN_ACCOUNTS_SHEET');expect((await one(db,'SELECT payroll_run_id FROM acct_requisition_sheets WHERE id=$1',[d.accounts_sheet_id])).payroll_run_id).toBe(f.run.id);
 await details(d,r);await send(d);expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[f.rows[0].id])).status).toBe('PENDING_HO_APPROVAL');
 expect((await act(d)).applied).toBe(true);
 expect((await one(db,'SELECT available_balance::text FROM bank_balance_master WHERE bank_name=$1',[r.bank])).available_balance).toBe('70703.70');
 await act(d);expect((await one(db,'SELECT available_balance::text FROM bank_balance_master WHERE bank_name=$1',[r.bank])).available_balance).toBe('70703.70');
 expect((await one(db,'SELECT count(*) n FROM payroll_payment_confirmations WHERE delivery_id=$1',[d.delivery_id])).n).toBe('0');
 const slip=(await one(db,'SELECT get_payroll_official_payslip($1,$2) r',[f.rows[0].id,users.accounts.id])).r;
 expect(slip.cycle).toBe(f.run.cycle);
 expect(slip.payment_recipient).toMatchObject({status:'RECORDED',beneficiary_name:'Synthetic employee',masked_account_number:'****'+r.b.account_number.slice(-4)});
 expect(slip.payment_recipient).not.toHaveProperty('account_number');
 const frozen=(await one(db,'SELECT calculation_snapshot FROM payroll_financial_snapshots WHERE row_id=$1',[f.rows[0].id])).calculation_snapshot;
 expect(slip.calculation).toEqual(frozen);
 await q(db,"UPDATE beneficiary_master SET beneficiary_name='Changed master name' WHERE id=$1",[r.b.id]);
 const historical=(await one(db,'SELECT get_payroll_official_payslip($1,$2) r',[f.rows[0].id,users.accounts.id])).r;
 expect(historical.payment_recipient).toEqual(slip.payment_recipient);

 await reject(()=>one(db,'SELECT get_payroll_official_payslip($1,$2)',[f.rows[0].id,users.fm.id]),'42501');

 await q(db,"SELECT confirm_payroll_payment($1,CURRENT_DATE,'SYNTHETIC bank reference',$2)",[d.delivery_id,users.accounts.id]);
 await q(db,"SELECT confirm_payroll_payment($1,CURRENT_DATE,'SYNTHETIC bank reference',$2)",[d.delivery_id,users.accounts.id]);
 expect((await one(db,'SELECT count(*) n FROM payroll_payment_confirmations WHERE delivery_id=$1',[d.delivery_id])).n).toBe('1');
 expect((await one(db,'SELECT available_balance::text FROM bank_balance_master WHERE bank_name=$1',[r.bank])).available_balance).toBe('70703.70');
});
test('generic edits and approvals cannot bypass salary workflow; missing recipient and gate fail closed',async()=>{
 const f=await prepared(),d=await deliver(f),r=await recipient();
 const link=await one(db,'SELECT * FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id]);
 await reject(()=>q(db,'UPDATE acct_requisition_line_items SET req_amount=1 WHERE id=$1',[link.item_id]),'PY409');
 await reject(()=>send(d),'22023');await details(d,r);await send(d);
 await reject(()=>q(db,"SELECT approve_acct_line_item_transact($1,'Approved',NULL,$2,NULL)",[link.item_id,users.ho.mobile_number]),'PY409');
 await reject(()=>act(d),'42501');expect((await one(db,'SELECT count(*) n FROM payroll_financial_snapshots WHERE row_id=$1',[f.rows[0].id])).n).toBe('0');
 await reject(()=>one(db,'SELECT get_payroll_accounts_sheet($1,$2)',[d.accounts_sheet_id,users.fm.id]),'42501');
});
test('payment returns preserve salary; salary returns release the claim for a revised delivery',async()=>{
 const f=await prepared(),d=await deliver(f),r=await recipient();await details(d,r);await send(d);await act(d,'ReturnPayment');
 expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[f.rows[0].id])).status).toBe('PENDING_HO_APPROVAL');
 await details(d,r);const v=await one(db,'SELECT version FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id]);await q(db,'SELECT resubmit_payroll_payment($1,$2,$3)',[d.delivery_id,v.version,users.accounts.id]);
 await act(d,'ReturnSalary');expect((await one(db,'SELECT active FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id])).active).toBe(false);
 const next=await deliver(f);expect(next.delivery_id).not.toBe(d.delivery_id);expect(next.accounts_sheet_id).not.toBe(d.accounts_sheet_id);
});
async function factoryReady({zero=false,count=1}={}){
 await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE active_status='Active'",[users.admin.id]);
 const f=await prepared({gate:true,factory:true,count});
 await q(db,'INSERT INTO hr_factory_wage_revisions(employee_category,effective_from,daily_wage,created_by) VALUES($1,$2,400,$3)',[f.category,f.from,users.admin.id]);
 await q(db,"INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,created_by) VALUES($1,$2,8,true,'Fixed Hourly',50,true,1.5,'Not executable',$3)",[f.category,f.from,users.admin.id]);
 const sheet=await one(db,'SELECT * FROM populate_hr_attendance_sheet($1,$2,$3,$4)',[f.from,f.category,users.fm.id,f.department]);
 await q(db,'SELECT save_hr_attendance_rows($1,$2,$3)',[sheet.id,JSON.stringify(f.employees.map(e=>({employee_id:e.id,attendance_status:zero?'Absent':'Present',...(zero?{}:{entry_timestamp:f.from+'T08:00:00+05:30',exit_timestamp:f.from+'T16:00:00+05:30'})}))),users.fm.id]);
 await q(db,"SELECT transition_hr_attendance_sheet($1,'submit',NULL,$2)",[sheet.id,users.fm.id]);await q(db,"SELECT transition_hr_attendance_sheet($1,'review',NULL,$2)",[sheet.id,users.ho.id]);return f;
}
test('factory FM hands off three employees; HO approves, returns salary and holds independently',async()=>{
 const f=await factoryReady({count:3}),ds=[];
 for(const row of f.rows)ds.push(await deliver({...f,rows:[row]}));
 expect(new Set(ds.map(d=>d.accounts_sheet_id)).size).toBe(1);
 const r=await recipient();for(const d of ds)await details(d,r);await send(ds[0]);
 await act(ds[0]);await act(ds[1],'ReturnSalary');await act(ds[2],'Hold');
 expect((await q(db,'SELECT status FROM payroll_run_employees WHERE id=ANY($1::uuid[]) ORDER BY status',[f.rows.map(r=>r.id)])).map(r=>r.status)).toEqual(['LOCKED','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR']);
 expect((await one(db,'SELECT count(*) n FROM payroll_financial_snapshots WHERE row_id=ANY($1::uuid[])',[f.rows.map(r=>r.id)])).n).toBe('1');
 const redelivered=await deliver({...f,rows:[f.rows[1]]});expect(redelivered.accounts_sheet_id).not.toBe(ds[1].accounts_sheet_id);
 await act(ds[2]);expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[f.rows[2].id])).status).toBe('LOCKED');
});
test('zero-net factory salary is approved with coverage and no bank details or payout',async()=>{
 const f=await factoryReady({zero:true}),d=await deliver(f);expect((await one(db,'SELECT req_amount::text FROM acct_requisition_line_items WHERE payroll_row_id=$1',[f.rows[0].id])).req_amount).toBe('0.00');
 await send(d);await act(d);expect((await one(db,'SELECT count(*) n FROM payroll_employee_coverage WHERE salary_row_id=$1',[f.rows[0].id])).n).toBe('1');
 await reject(()=>q(db,"SELECT confirm_payroll_payment($1,CURRENT_DATE,'no payout',$2)",[d.delivery_id,users.accounts.id]),'22023');
});
test('automatic cutoff proposal and HO acceptance do not invalidate a salary',async()=>{
 const f=await prepared({gate:true,cutoffReady:false}),d=await deliver(f),r=await recipient();await details(d,r);await send(d);
 const review=(await one(db,'SELECT get_payroll_employee_review($1,$2) r',[f.rows[0].id,users.accounts.id])).r;expect(review.delivery_source_current).toBe(true);
 expect(require('../../../src/domain/payroll/freshness').sourceCheck(review).status).toBe('CURRENT');
 await act(d);expect((await one(db,'SELECT status FROM payroll_period_cutoffs WHERE run_id=$1 ORDER BY version DESC LIMIT 1',[f.run.id])).status).toBe('APPROVED');
 expect((await one(db,'SELECT sheet_status FROM acct_requisition_sheets WHERE id=$1',[d.accounts_sheet_id])).sheet_status).toBe('Reviewed');
});
test('insufficient funds rolls back salary lock, statutory postings, approval and cutoff acceptance',async()=>{
 const f=await prepared({gate:true,cutoffReady:false}),d=await deliver(f),r=await recipient();await details(d,r);await send(d);
 await q(db,'UPDATE bank_balance_master SET available_balance=1 WHERE bank_name=$1',[r.bank]);await reject(()=>act(d),'BAL01');
 expect((await one(db,'SELECT count(*) n FROM payroll_financial_snapshots WHERE row_id=$1',[f.rows[0].id])).n).toBe('0');
 expect((await one(db,'SELECT count(*) n FROM payroll_statutory_entries WHERE salary_row_id=$1',[f.rows[0].id])).n).toBe('0');
 expect((await one(db,'SELECT count(*) n FROM payroll_employee_coverage WHERE salary_row_id=$1',[f.rows[0].id])).n).toBe('0');
 expect((await one(db,'SELECT disposition FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id])).disposition).toBe('WITH_HO');
 expect((await one(db,'SELECT status FROM payroll_period_cutoffs WHERE run_id=$1 ORDER BY version DESC LIMIT 1',[f.run.id])).status).toBe('PROPOSED');
});
test('changed pay and beneficiary block approval; payment correction does not alter salary',async()=>{
 const f=await prepared({gate:true}),d=await deliver(f),r=await recipient();await details(d,r);await send(d);
 await q(db,"UPDATE beneficiary_master SET beneficiary_name='SYNTHETIC changed recipient' WHERE id=$1",[r.b.id]);expect((await one(db,'SELECT get_payroll_accounts_sheet($1,$2) r',[d.accounts_sheet_id,users.ho.id])).r.rows[0].payment_details_current).toBe(false);await reject(()=>act(d),'PY409');
 await act(d,'ReturnPayment');await details(d,r);let v=await one(db,'SELECT version FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id]);await q(db,'SELECT resubmit_payroll_payment($1,$2,$3)',[d.delivery_id,v.version,users.accounts.id]);
 const pay=await one(db,'SELECT id FROM hr_permanent_pay_structures WHERE employee_id=$1',[f.employees[0].id]);await q(db,"SELECT record_payroll_source_history($1,'PERMANENT_PAY',$2,'SYNTHETIC source change',$3)",[f.employees[0].id,JSON.stringify([{pay_structure_id:pay.id,effective_from:f.from,effective_to:f.to}]),users.admin.id]);await reject(()=>act(d),'PY409');
 expect((await one(db,'SELECT count(*) n FROM payroll_financial_snapshots WHERE row_id=$1',[f.rows[0].id])).n).toBe('0');
});
test('Accounts preparer can return an office salary for correction without another Accounts reviewer',async()=>{
 const f=await prepared(),d=await deliver(f);await act(d,'ReturnSalary',users.accounts.id);
 expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[f.rows[0].id])).status).toBe('RETURNED_TO_CREATOR');
});
test('duplicate delivery retries reuse receipts, and generic actions cannot reopen, copy or delete claims',async()=>{
 const f=await prepared(),d=await deliver(f),row=await one(db,'SELECT * FROM payroll_run_employees WHERE id=$1',[f.rows[0].id]);
 const again=(await one(db,'SELECT deliver_payroll_to_accounts($1,1,0,$2,$3) r',[row.id,'0'.repeat(64),f.creator.id])).r;expect(again.delivery_id).toBe(d.delivery_id);
 await reject(()=>reviewAction(db,row.id,'calculate',users.accounts.id),'PY409');
 const item=await one(db,'SELECT * FROM acct_requisition_line_items WHERE payroll_row_id=$1',[row.id]);
 await reject(()=>q(db,'DELETE FROM acct_requisition_line_items WHERE id=$1',[item.id]),'PY409');
 await reject(()=>q(db,"UPDATE acct_requisition_sheets SET sheet_status='Reviewed' WHERE id=$1",[item.sheet_id]),'PY409');
 const other=await one(db,'SELECT * FROM create_acct_sheet_transact($1)',[users.accounts.mobile_number]);
 await reject(()=>q(db,'INSERT INTO acct_requisition_line_items(sheet_id,created_by,req_amount,imported_from_item_id) VALUES($1,$2,10,$3)',[other.id,users.accounts.mobile_number,item.id]),'PY409');
 for(const role of ['anon','authenticated','service_role'])expect((await one(db,"SELECT has_table_privilege($1,'payroll_accounts_deliveries','UPDATE') ok",[role])).ok).toBe(false);
});
test('inactive actors, factory preparer role changes, and employee self-approval are rejected',async()=>{
 const f=await prepared({gate:true}),d=await deliver(f),r=await recipient();await details(d,r);await send(d);
 await q(db,'UPDATE hr_employees SET erp_user_id=$2,updated_by=$3 WHERE id=$1',[f.employees[0].id,users.ho.id,users.admin.id]);await reject(()=>act(d),'42501');
 await q(db,'UPDATE authorised_users SET is_active=false WHERE id=$1',[users.admin.id]);await reject(()=>act(d,'Approve',users.admin.id),'42501');
});
test('cutover is explicit, preserves original submission ownership and is idempotent',async()=>{
 const f=await prepared();await reviewAction(db,f.rows[0].id,'calculate',users.accounts.id);await reviewAction(db,f.rows[0].id,'submit',users.accounts.id);
 const before=await one(db,'SELECT count(*) n FROM payroll_accounts_deliveries');await q(db,'SELECT get_payroll_accounts_cutover($1,1,20)',[users.admin.id]);expect(await one(db,'SELECT count(*) n FROM payroll_accounts_deliveries')).toEqual(before);
 const row=await one(db,'SELECT r.*,v.source_fingerprint FROM payroll_run_employees r JOIN payroll_review_revisions v ON v.row_id=r.id AND v.revision=r.review_revision WHERE r.id=$1',[f.rows[0].id]);
 const d=(await one(db,'SELECT deliver_payroll_to_accounts($1,$2,$3,$4,$5,true) r',[row.id,row.current_version,row.review_version,row.source_fingerprint,users.admin.id])).r;
 expect((await one(db,'SELECT submitted_by FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id])).submitted_by).toBe(users.accounts.id);
 const repeat=(await one(db,'SELECT deliver_payroll_to_accounts($1,$2,$3,$4,$5,true) r',[row.id,row.current_version,row.review_version,row.source_fingerprint,users.admin.id])).r;expect(repeat.delivery_id).toBe(d.delivery_id);
 expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[row.id])).status).toBe('IN_ACCOUNTS_SHEET');
});
test('null concurrency versions and null actions cannot bypass raw database guards',async()=>{
 const f=await prepared(),d=await deliver(f),r=await recipient();
 await reject(()=>q(db,"SELECT save_payroll_payment_details($1,NULL,$2,'NEFT',$3,NULL,NULL,$4)",[d.delivery_id,r.bank,r.b.id,users.accounts.id]),'PY409');
 await details(d,r);await send(d);const v=await one(db,'SELECT version FROM payroll_accounts_deliveries WHERE id=$1',[d.delivery_id]);
 await reject(()=>q(db,"SELECT act_payroll_accounts_item($1,NULL,'Hold','reason',NULL,NULL,$2)",[d.delivery_id,users.ho.id]),'PY409');
 await reject(()=>q(db,'SELECT act_payroll_accounts_item($1,$2,NULL,NULL,NULL,NULL,$3)',[d.delivery_id,v.version,users.ho.id]),'22023');
 await act(d,'Hold');expect((await one(db,'SELECT sheet_status FROM acct_requisition_sheets WHERE id=$1',[d.accounts_sheet_id])).sheet_status).toBe('Submitted');
});
test.each([['PROJECTS_JE','Junior Engineer'],['PROJECTS_ZO','Zonal Office'],['PROJECTS_SUPERVISOR','Local project supervisor'],['PROJECTS_HEAD_OFFICE','Head office']])('Accounts prepares %s payroll through the same sheet without FM or peer verification',async(officeGroup,officeCategory)=>{
 const f=await prepared({gate:true,department:'Projects',officeGroup,officeCategory}),d=await deliver(f),r=await recipient();
 expect(f.creator.id).toBe(users.accounts.id);await details(d,r);await send(d);await act(d);
 expect((await one(db,'SELECT status,accounts_verified_by FROM payroll_run_employees WHERE id=$1',[f.rows[0].id]))).toEqual({status:'LOCKED',accounts_verified_by:null});
 expect((await one(db,'SELECT available_balance::text FROM bank_balance_master WHERE bank_name=$1',[r.bank])).available_balance).toBe('70703.70');
});
test('Accounts and HO sheet visibility reflects the same independent-review checks as mutations',async()=>{
 const f=await prepared(),d=await deliver(f);
 const own=(await one(db,'SELECT get_payroll_accounts_sheet($1,$2) r',[d.accounts_sheet_id,users.accounts.id])).r;expect(own.rows[0].independent_reviewer).toBe(false);expect(own.rows[0].independent_accounts).toBe(true);
 const independent=(await one(db,'SELECT get_payroll_accounts_sheet($1,$2) r',[d.accounts_sheet_id,users.ho.id])).r;expect(independent.rows[0].independent_reviewer).toBe(true);
 await q(db,'UPDATE hr_employees SET erp_user_id=$2,updated_by=$3 WHERE id=$1',[f.employees[0].id,users.ho.id,users.admin.id]);expect((await one(db,'SELECT get_payroll_accounts_sheet($1,$2) r',[d.accounts_sheet_id,users.ho.id])).r.rows[0].independent_reviewer).toBe(false);
});
