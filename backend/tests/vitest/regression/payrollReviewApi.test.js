import {beforeAll,afterAll,afterEach,describe,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture}=require('../../helpers/payrollReviewFixtures');const {generateTokens}=require('../../../src/services/session.service');const app=require('../../../src/app');
let db,users,server,base;const tokens={},employees=[];
async function request(method,path,role='admin',body){const response=await fetch(base+'/api/v1/auth/hr/payroll'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
const inspect=async(id,role='admin')=>(await request('GET',`/rows/${id}/review`,role)).body.review;
async function fixture(options){const f=await createReviewFixture(db,users,options);employees.push(...f.employees.map(e=>e.id));return f;}
async function act(id,action,role,extra={}){const d=await inspect(id),row=d.row;return request('POST',`/rows/${id}/review`,role,{action,expected_version:row.current_version,expected_review_version:row.review_version,...(['calculate','correct','return','cancel'].includes(action)?{reason:'SYNTHETIC '+action}:{}),...(['submit','forward','approve_lock'].includes(action)?{source_fingerprint:d.revisions.at(-1)?.source_fingerprint}:{}),...extra});}
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);
 for(const [key,u] of Object.entries(users)){const s=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[key]=generateTokens(u,s.id,crypto.randomUUID()).accessToken;}
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
afterEach(async()=>{if(employees.length)await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employees]);});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
describe('payroll per-employee review HTTP API',()=>{
 test('automatic draft calculation is scoped, idempotent and preserves submitted revisions',async()=>{
  const f=await fixture({factory:true}),id=f.rows[0].id;
  const body={run_id:f.run.id,page:1,limit:20};
  expect((await request('POST','/review/auto-recalculate','admin',body)).status).toBe(403);
  expect((await request('POST','/review/auto-recalculate','otherFm',body)).status).toBe(403);
  const concurrent=await Promise.all([request('POST','/review/auto-recalculate','fm',body),request('POST','/review/auto-recalculate','fm',body)]);expect(concurrent.every(result=>result.status===200)).toBe(true);expect(concurrent.flatMap(result=>result.body.automatic.results)).toContainEqual(expect.objectContaining({row_id:id,status:'UPDATED'}));
  expect((await one(db,'SELECT count(*) n FROM payroll_review_revisions WHERE row_id=$1',[id])).n).toBe('1');
  let before=(await one(db,'SELECT count(*) n FROM payroll_review_revisions WHERE row_id=$1',[id])).n;
  const second=await request('POST','/review/auto-recalculate','fm',body);expect(second.body.automatic.results[0].status).toBe('CURRENT');
  expect((await one(db,'SELECT count(*) n FROM payroll_review_revisions WHERE row_id=$1',[id])).n).toBe(before);
  const previous=(await one(db,'SELECT calculation_snapshot FROM payroll_review_revisions WHERE row_id=$1 AND revision=1',[id])).calculation_snapshot;
  await q(db,"SELECT record_payroll_source_history($1,'ASSIGNMENT',$2,'Updated assignment evidence',$3)",[f.employees[0].id,JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:f.from,effective_to:f.to,employment_joined_on:f.from}]),users.admin.id]);
  const updated=await request('POST','/review/auto-recalculate','fm',body);expect(updated.body.automatic.results[0].status).toBe('UPDATED');
  expect((await one(db,'SELECT calculation_snapshot FROM payroll_review_revisions WHERE row_id=$1 AND revision=1',[id])).calculation_snapshot).toEqual(previous);
  const latest=(await one(db,'SELECT calculation_snapshot FROM payroll_review_revisions WHERE row_id=$1 ORDER BY revision DESC LIMIT 1',[id])).calculation_snapshot;
  expect(latest.source_fingerprint).not.toBe(previous.source_fingerprint);expect(latest.blockers.length).toBeGreaterThan(0);
  before=(await one(db,'SELECT count(*) n FROM payroll_review_revisions WHERE row_id=$1',[id])).n;
  await act(id,'submit','fm');
  const submitted=await request('POST','/review/auto-recalculate','fm',body);expect(submitted.body.automatic.results[0].status).toBe('PRESERVED');
  expect((await one(db,'SELECT count(*) n FROM payroll_review_revisions WHERE row_id=$1',[id])).n).toBe(before);
 });
 test('freshness is read-only, page bounded and detects source changes',async()=>{
  const f=await fixture({factory:true}),id=f.rows[0].id;
  await act(id,'calculate','fm');
  const before=await one(db,'SELECT count(*) n FROM payroll_review_revisions WHERE row_id=$1',[id]);
  const path=`/review/freshness?run_id=${f.run.id}&page=1&limit=20`;
  const current=await request('GET',path,'fm');expect(current.status).toBe(200);expect(current.body.freshness.checks[0]).toMatchObject({row_id:id,status:'CURRENT'});
  await q(db,"SELECT record_payroll_source_history($1,'ASSIGNMENT',$2,'Confirmed updated dates',$3)",[f.employees[0].id,JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:f.from,effective_to:f.to,employment_joined_on:f.from}]),users.admin.id]);
  const changed=await request('GET',path,'admin');expect(changed.body.freshness.checks[0].status).toBe('CHANGED');expect(changed.body.freshness.checks[0].reasons.length).toBeGreaterThan(0);
  expect(await one(db,'SELECT count(*) n FROM payroll_review_revisions WHERE row_id=$1',[id])).toEqual(before);
  expect((await request('GET',path.replace('limit=20','limit=21'),'fm')).status).toBe(400);
  expect((await request('GET',path,'je')).status).toBe(403);
 });
 test('authentication, current roles, scoped queues, pagination and strict server-derived calculation requests',async()=>{
  const f=await fixture({factory:true}),id=f.rows[0].id;
  expect((await request('GET','/review/queue','anonymous')).status).toBe(401);
  for(const role of ['je','zo'])expect((await request('GET','/review/queue',role)).status).toBe(403);
  expect((await request('GET',`/rows/${id}/review`,'otherFm')).status).toBe(200);expect((await request('GET',`/rows/${id}/review`,'otherFm')).body.review.available_actions).toEqual([]);expect((await request('GET',`/review/queue?run_id=${f.run.id}`,'otherFm')).body.queue.rows.some(r=>r.id===id)).toBe(true);
  expect((await request('GET','/review/queue?limit=101')).status).toBe(400);expect((await request('GET','/review/queue?status=REJECTED')).status).toBe(400);
  expect((await request('GET',`/rows/${crypto.randomUUID()}/review`)).status).toBe(404);
  const row=(await inspect(id)).row,body={action:'calculate',expected_version:row.current_version,expected_review_version:row.review_version,reason:'Test'};
  for(const data of [{...body,calculation:{}},{...body,source:{}},{...body,net_salary:'100'},{...body,actor_id:users.admin.id},{...body,reason:''},{...body,action:'reject'}])expect((await request('POST',`/rows/${id}/review`,'fm',data)).status).toBe(400);
  expect((await request('POST',`/rows/${id}/review`,'accounts',body)).status).toBe(403);
  expect((await request('POST',`/rows/${id}/review`,'otherFm',body)).status).toBe(403);
 });
 test('oversized legacy detail retains corrections, withdrawal and history without bypassing scope or preview guards',async()=>{
  const f=await fixture({factory:true}),employee=f.employees[0],to=`${Number(f.from.slice(0,4))+3}-10-01`;
  const history=(await one(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[employee.id,'ASSIGNMENT',JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:f.from,effective_to:to,employment_joined_on:f.from}]),'SYNTHETIC oversized source',users.admin.id])).id;
  const assignment=await one(db,'SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[history]);
  const run=await one(db,"SELECT * FROM create_payroll_draft_run($1,$2,$3,$4,'Custom',$5)",[f.group,f.department,f.from,to,users.fm.id]);
  const row=await one(db,'SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[run.id,assignment.id,f.from,to,users.fm.id]);
  const response=await request('GET',`/rows/${row.id}/review`,'fm');expect(response.status).toBe(200);
  const view=response.body.review;expect(view.row.id).toBe(row.id);expect(view.current_preview).toBeNull();expect(view.source_stale).toBeNull();expect(view.changes_since_saved).toEqual([]);
  expect(view.source_error).toEqual({code:'PAYROLL_SOURCE_UNAVAILABLE',sqlstate:'22023',message:'Preview at most 24 months at a time'});
  expect(view.available_actions).toEqual(['correct','cancel']);expect(view.assignment_candidates).toEqual([]);expect(view.content_versions).toHaveLength(1);expect(view).not.toHaveProperty('source');
  const otherView=await request('GET',`/rows/${row.id}/review`,'otherFm');expect(otherView.status).toBe(200);expect(otherView.body.review.available_actions).toEqual([]);
  expect((await act(row.id,'calculate','fm')).status).toBe(400);
  expect((await act(row.id,'correct','fm',{reason:'Record unsupported period for recovery',note:'Withdraw and recreate the proper interval'})).status).toBe(200);
  const corrected=await inspect(row.id,'fm');expect(corrected.content_versions).toHaveLength(2);expect(corrected.content_versions[1].note).toBe('Withdraw and recreate the proper interval');expect(corrected.actions.map(a=>a.action)).toContain('CORRECTED');
  expect((await act(row.id,'cancel','fm')).body.result.row.status).toBe('CANCELLED_DRAFT');
  const withdrawn=await inspect(row.id,'fm');expect(withdrawn.available_actions).toEqual([]);expect(withdrawn.content_versions).toHaveLength(2);expect(withdrawn.actions.map(a=>a.action)).toContain('CANCELLED_DRAFT');expect(withdrawn.payment_status).toBe('NOT_ELIGIBLE');
 });
 test.each(['SNP Factory','Fabric Factory'])('same active FM completes %s review/return cycle and HO lock reports prerequisites',async department=>{
  const f=await fixture({factory:true,department}),id=f.rows[0].id;
  expect((await act(id,'calculate','fm')).status).toBe(200);expect((await act(id,'submit','fm')).body.result.row.status).toBe('PENDING_ACCOUNTS_REVIEW');
  expect((await act(id,'forward','reviewer')).body.result.row.status).toBe('PENDING_HO_APPROVAL');
  const blocked=await act(id,'approve_lock','ho');expect(blocked.status).toBe(422);expect(blocked.body.success).toBe(false);expect(blocked.body.result.blockers.map(b=>b.code)).toContain('FINANCIAL_FINALIZATION_DISABLED');
  expect((await act(id,'return','ho',{reason:'Recheck dates'})).body.result.row.last_return_stage).toBe('HO');expect((await act(id,'correct','fm',{reason:'Confirmed source correction',note:'Corrected documented input'})).status).toBe(200);
  await act(id,'calculate','fm');expect((await act(id,'submit','fm')).body.result.row.status).toBe('PENDING_ACCOUNTS_REVIEW');const d=await inspect(id);expect(d.revisions).toHaveLength(2);expect(d.revisions[1].changes).toBeInstanceOf(Array);expect(d.payment_status).toBe('NOT_ELIGIBLE');expect(d).not.toHaveProperty('source');
 });
 test('office direct submission, stale approvals, reasoned return and saved revision differences',async()=>{
  const f=await fixture({}),id=f.rows[0].id;await act(id,'calculate','accounts');const before=await inspect(id);expect(before.current_preview.gross_after_lop).toBe('30000.00');await act(id,'submit','accounts');
  expect((await act(id,'forward','reviewer')).status).toBe(409);expect((await inspect(id)).row.status).toBe('PENDING_HO_APPROVAL');
  // A finalized authoritative pay history correction invalidates the saved source.
  const pay=await one(db,"SELECT * FROM create_hr_pay_structure($1,'Monthly salary',31000,true,false,'Active',$2)",[f.employees[0].id,users.admin.id]);
  await q(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[f.employees[0].id,'PERMANENT_PAY',JSON.stringify([{pay_structure_id:pay.id,effective_from:f.from,effective_to:f.to}]),'SYNTHETIC dated correction',users.admin.id]);
  expect((await inspect(id)).source_stale).toBe(true);expect((await act(id,'approve_lock','ho')).status).toBe(409);expect((await act(id,'return','ho',{reason:'Refresh pay history'})).status).toBe(200);
  await act(id,'correct','accounts',{note:'Authoritative pay-history refresh'});await act(id,'calculate','accounts');const after=await inspect(id);expect(after.revisions[0].calculation_snapshot.gross_after_lop).toBe('30000.00');expect(after.current_preview.gross_after_lop).toBe('31000.00');expect(after.revisions[1].changes.map(c=>c.field)).toEqual(expect.arrayContaining(['earnings','correction_note']));
 });
 test('bulk submissions report an independent stale failure without reverting the successful employee',async()=>{
  const f=await fixture({count:2});for(const row of f.rows)await act(row.id,'calculate','accounts');const reviews=await Promise.all(f.rows.map(r=>inspect(r.id)));
  const actions=reviews.map((d,i)=>({row_id:d.row.id,request:{action:'submit',expected_version:d.row.current_version,expected_review_version:d.row.review_version-(i===1?1:0),source_fingerprint:d.revisions.at(-1).source_fingerprint}}));
  const result=await request('POST','/review/bulk','accounts',{actions});expect(result.status).toBe(200);expect(result.body.success).toBe(false);expect(result.body.results.map(r=>[r.success,r.status])).toEqual([[true,200],[false,409]]);
  expect((await inspect(f.rows[0].id)).row.status).toBe('PENDING_HO_APPROVAL');expect((await inspect(f.rows[1].id)).row.status).toBe('CALCULATED');
  const queue=(await request('GET',`/review/queue?run_id=${f.run.id}`)).body.queue;expect(queue.sheets[0].progress.ho).toBe(1);expect(queue.sheets[0].progress.draft).toBe(1);expect(queue.sheets[0].progress.locked).toBe(0);
 });
 test('concurrent requests do not duplicate submissions and simultaneous final checks remain nonfinancial',async()=>{
  const f=await fixture({}),id=f.rows[0].id;await act(id,'calculate','accounts');const d=await inspect(id),body={action:'submit',expected_version:d.row.current_version,expected_review_version:d.row.review_version,source_fingerprint:d.revisions.at(-1).source_fingerprint};
  const submitted=await Promise.all([request('POST',`/rows/${id}/review`,'accounts',body),request('POST',`/rows/${id}/review`,'accounts',body)]);expect(submitted.map(r=>r.status).sort()).toEqual([200,409]);
  const before=await q(db,'SELECT (SELECT count(*) FROM payroll_employee_coverage) coverage,(SELECT count(*) FROM payroll_month_allocations) allocations,(SELECT sum(available_balance)::text FROM bank_balance_master) bank');
  const locks=await Promise.all([act(id,'approve_lock','ho'),act(id,'approve_lock','admin')]);expect(locks.map(r=>r.status)).toEqual([422,422]);expect((await inspect(id)).row.status).toBe('PENDING_HO_APPROVAL');expect(await q(db,'SELECT (SELECT count(*) FROM payroll_employee_coverage) coverage,(SELECT count(*) FROM payroll_month_allocations) allocations,(SELECT sum(available_balance)::text FROM bank_balance_master) bank')).toEqual(before);
 });
 test('an existing token cannot preserve inactive access or allow creator self-approval after a role change',async()=>{
  const f=await fixture({factory:true}),id=f.rows[0].id;await act(id,'calculate','fm');await act(id,'submit','fm');await q(db,'UPDATE authorised_users SET is_active=false WHERE id=$1',[users.fm.id]);expect([401,403]).toContain((await request('GET',`/rows/${id}/review`,'fm')).status);await q(db,'UPDATE authorised_users SET is_active=true WHERE id=$1',[users.fm.id]);
  const office=await fixture({}),officeId=office.rows[0].id;await act(officeId,'calculate','accounts');await act(officeId,'submit','accounts');
  const changed=await one(db,"UPDATE authorised_users SET role='admin' WHERE id=$1 RETURNING *",[users.accounts.id]);expect([401,403]).toContain((await act(officeId,'approve_lock','accounts')).status);
  const session=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[changed.id,crypto.randomUUID()]);tokens.accounts=generateTokens(changed,session.id,crypto.randomUUID()).accessToken;
  expect((await act(officeId,'approve_lock','accounts')).status).toBe(403);
 });
});
