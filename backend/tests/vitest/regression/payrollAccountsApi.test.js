import {beforeAll,afterAll,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers}=require('../../helpers/payrollReviewFixtures');
const {prepareFinancialReview}=require('../../helpers/payrollFinancialFixtures');
const {generateTokens}=require('../../../src/services/session.service'),app=require('../../../src/app');
let db,users,server,base;const tokens={},employees=[];
async function request(method,path,role='accounts',body){const r=await fetch(base+path,{method,headers:{Cookie:`accessToken=${tokens[role]}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
async function fixture(){const f=await prepareFinancialReview(db,users);employees.push(...f.employees.map(e=>e.id));let d=(await request('GET',`/rows/${f.rows[0].id}/review`)).body.review;
 await request('POST',`/rows/${d.row.id}/review`,'accounts',{action:'calculate',expected_version:d.row.current_version,expected_review_version:d.row.review_version,reason:'SYNTHETIC HTTP calculation'});
 d=(await request('GET',`/rows/${f.rows[0].id}/review`)).body.review;
 const delivery=await request('POST',`/rows/${d.row.id}/review`,'accounts',{action:'submit',expected_version:d.row.current_version,expected_review_version:d.row.review_version,source_fingerprint:d.revisions.at(-1).source_fingerprint});expect(delivery.status).toBe(200);return {...f,delivery:delivery.body.result};}
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);for(const [key,u] of Object.entries(users)){const s=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[key]=generateTokens(u,s.id,crypto.randomUUID()).accessToken;}server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api/v1/auth/hr/payroll`;});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employees]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
test('ready salary submission exposes a safe receipt and Accounts sheet; FM cannot access finance data',async()=>{
 const f=await fixture(),d=f.delivery;
 const salary=(await request('GET',`/accounts/sheets/${d.accounts_sheet_id}`)).body.payroll;expect(salary.rows[0].salary.final_net_salary).toBe('29296.30');
 const review=(await request('GET',`/rows/${f.rows[0].id}/review`)).body.review;expect(review.accounts_delivery.sheet_id).toBe(d.accounts_sheet_id);expect(review.available_actions).toEqual([]);
 for(const role of ['fm','je','zo'])expect((await request('GET',`/accounts/sheets/${d.accounts_sheet_id}`,role)).status).toBe(403);
 expect((await request('POST',`/rows/${f.rows[0].id}/review`,'accounts',{action:'forward',expected_version:review.row.current_version,expected_review_version:review.row.review_version,source_fingerprint:review.revisions.at(-1).source_fingerprint})).status).toBe(409);
});
test('payment metadata, HO submission and server-only approval calculations are validated',async()=>{
 const f=await fixture(),d=f.delivery;
 const bank=await one(db,'INSERT INTO indian_bank_master(bank_name,created_by) VALUES($1,$2) RETURNING *',['SYNTHETIC API '+crypto.randomUUID(),users.admin.mobile_number]);
 const beneficiary=await one(db,"INSERT INTO beneficiary_master(account_number,ifsc,beneficiary_name,beneficiary_bank_id,beneficiary_bank_name,created_by) VALUES($1,'TEST0000001','SYNTHETIC API employee',$2,$3,$4) RETURNING *",[String(crypto.randomInt(100000000000,999999999999)),bank.id,bank.bank_name,users.accounts.mobile_number]);
 await q(db,"INSERT INTO bank_balance_master(bank_name,balance_date,available_balance,account_number,created_by,updated_by) VALUES($1,CURRENT_DATE,50000,'123456789012',$2,$2)",[bank.bank_name,users.accounts.mobile_number]);
 const payment={expected_version:1,bank:bank.bank_name,mode:'NEFT',beneficiary_id:beneficiary.id};
 expect((await request('PATCH',`/accounts/deliveries/${d.delivery_id}/payment`,'ho',payment)).status).toBe(403);
 expect((await request('PATCH',`/accounts/deliveries/${d.delivery_id}/payment`,'accounts',{...payment,amount:'1.00'})).status).toBe(400);
 expect((await request('PATCH',`/accounts/deliveries/${d.delivery_id}/payment`,'accounts',payment)).status).toBe(200);
 expect((await request('PATCH',`/accounts/deliveries/${d.delivery_id}/payment`,'accounts',payment)).status).toBe(409);
 expect((await request('POST',`/accounts/sheets/${d.accounts_sheet_id}/submit`,'accounts',{})).status).toBe(200);
 const row=(await request('GET',`/accounts/sheets/${d.accounts_sheet_id}`,'ho')).body.payroll.rows[0];
 expect((await request('POST',`/accounts/deliveries/${d.delivery_id}/action`,'ho',{expected_version:row.delivery_version,action:'Approve',calculation:{final_net_salary:'1.00'}})).status).toBe(400);
 expect((await request('POST',`/accounts/deliveries/${d.delivery_id}/action`,'ho',{expected_version:row.delivery_version,action:'ReturnSalary'})).status).toBe(400);
 // Global financial activation stays off in HTTP tests; no fixture enables it.
 const blocked=await request('POST',`/accounts/deliveries/${d.delivery_id}/action`,'ho',{expected_version:row.delivery_version,action:'Approve'});expect(blocked.status).toBe(403);expect(blocked.body.message).toContain('disabled');
 expect((await one(db,'SELECT available_balance::text FROM bank_balance_master WHERE bank_name=$1',[bank.bank_name])).available_balance).toBe('50000.00');
 expect((await request('POST',`/accounts/deliveries/${d.delivery_id}/paid`,'accounts',{paid_on:'2026-01-01',reference:'NOT APPROVED'})).status).toBe(409);
});
test('pending migration preview is Accounts/Admin-only and never writes delivery or bank data',async()=>{
 const before=await one(db,'SELECT count(*) n FROM payroll_accounts_deliveries');expect((await request('GET','/accounts/cutover','fm')).status).toBe(403);
 const r=await request('GET','/accounts/cutover?page=1&limit=20');expect(r.status).toBe(200);expect(r.body.preview.rows).toBeInstanceOf(Array);expect(await one(db,'SELECT count(*) n FROM payroll_accounts_deliveries')).toEqual(before);
 expect((await request('POST','/accounts/cutover','fm',{rows:[]})).status).toBe(403);expect((await request('POST','/accounts/cutover','accounts',{rows:[]})).status).toBe(400);
});
