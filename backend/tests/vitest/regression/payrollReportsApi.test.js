import {beforeAll,afterAll,describe,test,expect,vi} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto'),ExcelJS=require('exceljs');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture,reviewAction}=require('../../helpers/payrollReviewFixtures');
const {generateTokens}=require('../../../src/services/session.service'),app=require('../../../src/app');
let db,users,server,base;const tokens={},employees=[];
async function request(path,role='admin',binary=false){const response=await fetch(base+'/api/v1/auth/hr/payroll'+path,{headers:tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{}});return {status:response.status,headers:response.headers,body:binary&&response.ok?Buffer.from(await response.arrayBuffer()):await response.json()};}
const query=filters=>new URLSearchParams(filters).toString();
const report=async(filters,role='admin')=>request('/reports/register?'+query(filters),role);
async function fixture(options={}){const f=await createReviewFixture(db,users,options);employees.push(...f.employees.map(e=>e.id));return f;}
beforeAll(async()=>{
 if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);
 for(const [key,u] of Object.entries(users)){const s=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[key]=generateTokens(u,s.id,crypto.randomUUID()).accessToken;}
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employees]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
describe('scoped saved payroll reporting API and PostgreSQL',()=>{
 test('summaries cover all matching pages, preserve exact gross and separate returned/submitted states and unknown amounts',async()=>{
  const f=await fixture({count:3});for(const r of f.rows.slice(0,2))await reviewAction(db,r.id,'calculate',users.accounts.id);
  await reviewAction(db,f.rows[0].id,'submit',users.accounts.id);await reviewAction(db,f.rows[0].id,'return',users.ho.id,{reason:'Verify unpaid dates'});
  const response=await report({run_id:f.run.id,limit:1});expect(response.status).toBe(200);const data=response.body.register;expect(data.total).toBe(3);expect(data.rows).toHaveLength(1);expect(data.summaries.map(s=>s.row_count).reduce((a,b)=>a+b,0)).toBe(3);
  const returned=data.summaries.find(s=>s.status==='RETURNED_TO_CREATOR');expect(returned.known_gross_total).toBe('30000.00');expect(returned.gross_total).toBe('30000.00');expect(data.summaries.find(s=>s.status==='DRAFT').gross_total).toBeNull();
  const all=(await report({run_id:f.run.id})).body.register;expect(all.rows.filter(r=>r.evidence_status==='SAVED_DIAGNOSTIC')).toHaveLength(2);for(const r of all.rows){expect(r.epf).toBeNull();expect(r.net_salary).toBeNull();expect(r.payment_status).toBe('NOT_ELIGIBLE');}
  const filtered=(await report({run_id:f.run.id,status:'RETURNED_TO_CREATOR'})).body.register;expect(filtered.rows[0].last_return_reason).toBe('Verify unpaid dates');
  await reviewAction(db,f.rows[0].id,'correct',users.accounts.id,{note:'Changed content',reason:'Correct source'});
  const corrected=(await report({run_id:f.run.id,status:'DRAFT'})).body.register;expect(corrected.rows.find(r=>r.id===f.rows[0].id).evidence_status).toBe('SUPERSEDED_CONTENT');expect(corrected.rows.find(r=>r.id===f.rows[0].id).gross_after_lop).toBeNull();
 });
 test('multi-period employee reports select whole saved rows by intersection; cancelled rows do not contribute amounts',async()=>{
  const f=await fixture({}),row=f.rows[0],employee=f.employees[0],year=Number(f.from.slice(0,4));await reviewAction(db,row.id,'calculate',users.accounts.id);
  const nextFrom=`${year+1}-10-01`,nextTo=`${year+1}-10-31`;
  const h=(await one(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[employee.id,'ASSIGNMENT',JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:f.from,effective_to:nextTo,employment_joined_on:f.from}]),'SYNTHETIC multi-period',users.admin.id])).id;
  const a=await one(db,'SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[h]),run=await one(db,"SELECT * FROM create_payroll_draft_run($1,$2,$3,$4,'Monthly',$5)",[f.group,f.department,nextFrom,nextTo,users.accounts.id]);
  const second=await one(db,'SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[run.id,a.id,nextFrom,nextTo,users.accounts.id]);
  const data=(await report({search:employee.employee_name,from:f.from,to:nextTo})).body.register;expect(data.total).toBe(2);expect(data.rows.map(r=>r.period_from)).toEqual([nextFrom,f.from]);expect(data.summaries.find(s=>s.status==='DRAFT').gross_total).toBeNull();
  expect((await report({search:employee.employee_name,from:f.from,to:f.to})).body.register.total).toBe(1);
  await reviewAction(db,second.id,'cancel',users.accounts.id);const cancelled=(await report({run_id:run.id})).body.register.rows[0];expect(cancelled.evidence_status).toBe('WITHDRAWN');expect(cancelled.earnings_total).toBeNull();
 });
 test('active FMs share both factory reports and diagnostic payslips but cannot access office payroll',async()=>{
  const snp=await fixture({factory:true}),fabric=await fixture({factory:true,department:'Fabric Factory'}),office=await fixture({});
  for(const f of [snp,fabric]){expect((await report({run_id:f.run.id},'fm')).status).toBe(200);expect((await request('/reports/export?'+query({run_id:f.run.id,format:'xlsx'}),'fm',true)).status).toBe(200);}
  expect((await report({run_id:office.run.id},'fm')).status).toBe(403);for(const role of ['accounts','ho','admin'])expect((await report({run_id:office.run.id},role)).status).toBe(200);
  for(const role of ['je','zo','anonymous']){const expected=role==='anonymous'?401:403;expect((await report({run_id:snp.run.id},role)).status).toBe(expected);expect((await request('/reports/export?'+query({run_id:snp.run.id}),role,true)).status).toBe(expected);expect((await request(`/rows/${snp.rows[0].id}/payslip`,role)).status).toBe(expected);}
  for(const f of [snp,fabric]){expect((await report({run_id:f.run.id},'otherFm')).status).toBe(200);expect((await request('/reports/export?'+query({run_id:f.run.id,format:'xlsx'}),'otherFm',true)).status).toBe(200);}
  await reviewAction(db,snp.rows[0].id,'calculate',users.fm.id);
  expect((await request(`/rows/${snp.rows[0].id}/payslip`,'otherFm')).status).toBe(200);
  expect((await report({},'fm')).body.register.rows.every(r=>['SNP Factory','Fabric Factory'].includes(r.department))).toBe(true);
  expect((await report({run_id:snp.run.id,search:"%' OR true --"},'fm')).body.register.total).toBe(0);
  expect((await report({limit:10001})).status).toBe(400);expect((await report({from:'2091-10-31',to:'2091-10-01'})).status).toBe(400);
  const permissions=await one(db,"SELECT has_function_privilege('anon','get_payroll_salary_register(uuid,jsonb,integer,integer)','execute') anon,has_function_privilege('authenticated','get_payroll_salary_register(uuid,jsonb,integer,integer)','execute') authenticated");expect(permissions).toEqual({anon:false,authenticated:false});
 });
 test('Excel and printable exports match the same saved rows/totals and protect injected identity text',async()=>{
  const f=await fixture({}),id=f.rows[0].id;await q(db,'UPDATE hr_employees SET employee_name=$1,updated_by=$2 WHERE id=$3',['=HYPERLINK("evil")',users.admin.id,f.employees[0].id]);await reviewAction(db,id,'calculate',users.accounts.id);
  const response=await request('/reports/export?'+query({run_id:f.run.id,format:'xlsx'}),'accounts',true);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');const book=new ExcelJS.Workbook();await book.xlsx.load(response.body);expect(book.getWorksheet('Salary Register').getCell('C3').value).toBe("'=HYPERLINK(\"evil\")");expect(book.getWorksheet('Salary Register').getCell('L3').value).toBe('30000.00');
  const printable=await request('/reports/export?'+query({run_id:f.run.id,format:'html'}),'accounts',true);expect(printable.body.toString()).toContain('30000.00');expect(printable.body.toString()).toContain('not approved liabilities');
  const empty=await request('/reports/export?'+query({run_id:f.run.id,search:'does not exist',format:'xlsx'}),'accounts',true);const blank=new ExcelJS.Workbook();await blank.xlsx.load(empty.body);expect(blank.getWorksheet('Salary Register').rowCount).toBe(2);
 });
 test('department-only HTML exports contain aggregate totals without individual names or salaries',async()=>{
  const f=await fixture({count:2});for(const row of f.rows)await reviewAction(db,row.id,'calculate',users.accounts.id);
  const summary=await request('/reports/export?'+query({run_id:f.run.id,format:'html',report:'departments'}),'accounts',true);
  const detailed=await request('/reports/export?'+query({run_id:f.run.id,format:'html',report:'register'}),'accounts',true);
  expect(summary.status).toBe(200);expect(detailed.status).toBe(200);const html=summary.body.toString(),register=detailed.body.toString();
  expect(html).toContain('60000.00');expect(html).not.toContain('30000.00');expect(html).not.toContain('<th>Employee Name</th>');
  for(const employee of f.employees){expect(html).not.toContain(employee.employee_name);expect(register).toContain(employee.employee_name);}
  expect(register).toContain('30000.00');expect(register).toContain('<th>Employee Name</th>');
 });
 test('oversized exports fail explicitly without partial bytes; legacy Admin ownership remains unchanged',async()=>{
  const {supabase}=require('../../../src/db/supabase');const original=supabase.rpc.bind(supabase);
  const spy=vi.spyOn(supabase,'rpc').mockImplementation((name,args)=>name==='get_payroll_salary_register'?Promise.resolve({data:{total:10001,rows:[],summaries:[]},error:null}):original(name,args));
  try{const result=await request('/reports/export?format=xlsx');expect(result.status).toBe(413);expect(result.body.code).toBe('PAYROLL_EXPORT_TOO_LARGE');expect(result.headers.get('content-disposition')).toBeNull();}finally{spy.mockRestore();}
  const details=vi.spyOn(supabase,'rpc').mockImplementation((name,args)=>name==='get_payroll_salary_register'?Promise.resolve({data:{total:1,rows:[{earnings:Array(100001).fill({code:'BASE',amount:'1.00'}),deductions:[],monthly_reconciliation:[]}],summaries:[]},error:null}):original(name,args));
  try{const result=await request('/reports/export?format=xlsx');expect(result.status).toBe(413);expect(result.body.code).toBe('PAYROLL_EXPORT_DETAILS_TOO_LARGE');expect(result.headers.get('content-disposition')).toBeNull();}finally{details.mockRestore();}
  const f=await fixture({}),assignment=f.rows[0].assignment_id;
  const run=await one(db,"SELECT * FROM create_payroll_draft_run($1,$2,$3,$4,'Custom',$5)",[f.group,f.department,f.from,f.to,users.admin.id]);
  const row=await one(db,'SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[run.id,assignment,f.from,f.to,users.admin.id]);
  expect((await report({run_id:run.id})).body.register.rows[0].evidence_status).toBe('NO_CALCULATION');
  for(const role of ['admin','accounts'])expect((await request(`/rows/${row.id}/review`,role)).body.review.available_actions).toEqual([]);
 });
 test('diagnostic payslips use immutable current calculation evidence; official output and missing/superseded evidence stay blocked',async()=>{
  const f=await fixture({}),id=f.rows[0].id;expect((await request(`/rows/${id}/payslip`,'accounts')).status).toBe(409);await reviewAction(db,id,'calculate',users.accounts.id);
  const diagnostic=await request(`/rows/${id}/payslip`,'accounts');expect(diagnostic.status).toBe(200);expect(diagnostic.body.payslip.official).toBe(false);expect(diagnostic.body.payslip.watermark).toContain('NOT AN OFFICIAL PAYSLIP');expect(diagnostic.body.payslip.calculation.final_net_salary).toBeNull();
  expect((await request(`/rows/${id}/payslip?mode=official`,'accounts')).body.code).toBe('OFFICIAL_PAYSLIP_UNAVAILABLE');
  await reviewAction(db,id,'correct',users.accounts.id,{note:'New content',reason:'Regenerate diagnostic'});expect((await request(`/rows/${id}/payslip`,'accounts')).body.code).toBe('DIAGNOSTIC_PAYSLIP_UNAVAILABLE');
  expect((await request(`/rows/${crypto.randomUUID()}/payslip`)).status).toBe(404);
  const gates=await q(db,"SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('payroll_coverage_phase1_gate','payroll_entitlement_phase1_gate','payroll_allocation_phase1_gate') ORDER BY tgname");expect(gates).toHaveLength(3);expect(gates.every(g=>g.tgenabled==='O')).toBe(true);
 });
});
