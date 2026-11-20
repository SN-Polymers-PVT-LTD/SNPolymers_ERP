import {beforeAll,afterAll,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture}=require('../../helpers/payrollReviewFixtures');
const controller=require('../../../src/controllers/hrEmployees.controller'),mockRes=require('../../helpers/mockRes');
const {calculatePreview}=require('../../../src/domain/payroll/preview');
const schema=require('../../../src/validation/hrEmployees.schema');
let db,users,bank,beneficiary;const employees=[];
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);
 bank=await one(db,'INSERT INTO indian_bank_master(bank_name,created_by) VALUES($1,$2) RETURNING *',['SYNTHETIC BANK '+crypto.randomUUID(),users.admin.mobile_number]);
 beneficiary=await one(db,'INSERT INTO beneficiary_master(account_number,ifsc,beneficiary_name,beneficiary_bank_id,beneficiary_bank_name,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[String(crypto.randomInt(100000000000,999999999999)),'TEST0000001','Synthetic employee beneficiary',bank.id,bank.bank_name,users.admin.mobile_number]);
});
afterAll(async()=>{if(db){await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employees]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
async function fixture(factory=false,department){const f=await createReviewFixture(db,users,{factory,...(department?{department}:{})});employees.push(...f.employees.map(e=>e.id));return f;}
test('Employee Management links canonical beneficiaries for permanent, casual and daily-wage employees without duplicate tables',async()=>{
 for(const [category,department] of [['HO Staff','Head Office'],['SNP Casual Factory Labour','SNP Factory'],['Local Daily-Wage Workers','Fabric Factory']]){
  const body={employee_name:'Synthetic linked '+crypto.randomUUID(),employee_category:category,department,joining_date:'2026-01-01',beneficiary_id:beneficiary.id};expect(schema.create.body.safeParse(body).success).toBe(true);
  const result=mockRes();await controller.createEmployee({user:users.admin,body},result);expect(result.statusCode).toBe(201);employees.push(result.jsonData.employee.id);expect(result.jsonData.employee.beneficiary).toMatchObject({id:beneficiary.id,account_number:beneficiary.account_number,beneficiary_bank_id:bank.id});
 }
 expect(schema.update.body.safeParse({beneficiary_id:'invalid'}).success).toBe(false);expect(schema.update.body.safeParse({account_number:'123456789'}).success).toBe(false);
});
test('database rejects missing/incomplete/inactive mappings and non-Admin writers, with no partial change',async()=>{
 const f=await fixture(),id=f.employees[0].id;
 await expect(q(db,'UPDATE hr_employees SET beneficiary_id=$1,updated_by=$2 WHERE id=$3',[beneficiary.id,users.fm.id,id])).rejects.toMatchObject({code:'42501'});
 await expect(q(db,'UPDATE hr_employees SET beneficiary_id=$1,updated_by=$2 WHERE id=$3',[crypto.randomUUID(),users.admin.id,id])).rejects.toMatchObject({code:'22023'});
 await q(db,'UPDATE indian_bank_master SET is_active=false WHERE id=$1',[bank.id]);
 await expect(q(db,'UPDATE hr_employees SET beneficiary_id=$1,updated_by=$2 WHERE id=$3',[beneficiary.id,users.admin.id,id])).rejects.toMatchObject({code:'22023'});await q(db,'UPDATE indian_bank_master SET is_active=true WHERE id=$1',[bank.id]);
 expect((await one(db,'SELECT beneficiary_id FROM hr_employees WHERE id=$1',[id])).beneficiary_id).toBeNull();
});
test('payroll sources mask accounts, identify missing details and detect even same-last-four beneficiary changes',async()=>{
 const f=await fixture(),id=f.employees[0].id,row=f.rows[0].id;
 const resolve=async()=>(await one(db,'SELECT get_payroll_review_sources($1,$2) s',[row,users.accounts.id])).s;
 expect((await resolve()).beneficiary).toEqual({status:'MISSING'});
 await q(db,'UPDATE hr_employees SET beneficiary_id=$1,updated_by=$2 WHERE id=$3',[beneficiary.id,users.admin.id,id]);const before=await resolve();expect(before.beneficiary).toMatchObject({status:'RECORDED',id:beneficiary.id,masked_account_number:'****'+beneficiary.account_number.slice(-4),bank_id:bank.id});expect(JSON.stringify(before)).not.toContain(beneficiary.account_number);
 const changed=(beneficiary.account_number[0]==='1'?'2':'1')+beneficiary.account_number.slice(1);await q(db,'UPDATE beneficiary_master SET account_number=$1 WHERE id=$2',[changed,beneficiary.id]);const after=await resolve();expect(after.beneficiary.masked_account_number).toBe(before.beneficiary.masked_account_number);expect(calculatePreview(after).source_fingerprint).not.toBe(calculatePreview(before).source_fingerprint);expect(calculatePreview(after).final_net_salary).toBeNull();expect(calculatePreview(after).financial_workflows_enabled).toBe(false);
 await q(db,'UPDATE indian_bank_master SET is_active=false WHERE id=$1',[bank.id]);expect((await resolve()).beneficiary.status).toBe('INCOMPLETE');await q(db,'UPDATE indian_bank_master SET is_active=true WHERE id=$1',[bank.id]);
 await q(db,'UPDATE hr_employees SET beneficiary_id=NULL,updated_by=$1 WHERE id=$2',[users.admin.id,id]);expect((await resolve()).beneficiary.status).toBe('MISSING');
 const audit=await q(db,"SELECT old_value,new_value FROM audit_log WHERE action='EMPLOYEE_BENEFICIARY_LINK' AND record_identifier=$1",[f.employees[0].employee_code]);expect(audit.length).toBe(2);expect(JSON.stringify(audit)).not.toContain(changed);
});
test('active Factory Managers see masked setup in both factories, without office payroll access',async()=>{
 for(const department of ['SNP Factory','Fabric Factory']){const f=await fixture(true,department);await q(db,'UPDATE hr_employees SET beneficiary_id=$1,updated_by=$2 WHERE id=$3',[beneficiary.id,users.admin.id,f.employees[0].id]);const result=await one(db,'SELECT get_payroll_review_sources($1,$2) s',[f.rows[0].id,users.fm.id]);expect(result.s.beneficiary.status).toBe('RECORDED');expect(result.s.beneficiary).not.toHaveProperty('account_number');expect((await one(db,'SELECT get_payroll_review_sources($1,$2) s',[f.rows[0].id,users.otherFm.id])).s.beneficiary).not.toHaveProperty('account_number');}
 const office=await fixture();await expect(q(db,'SELECT get_payroll_review_sources($1,$2)',[office.rows[0].id,users.fm.id])).rejects.toMatchObject({code:'42501'});
});
