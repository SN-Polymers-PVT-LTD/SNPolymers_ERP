import {beforeAll,afterAll,beforeEach,afterEach,describe,test,expect} from 'vitest';
const {Client}=require('pg');const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {q,one,createReviewUsers,createReviewFixture,reviewAction}=require('../../helpers/payrollReviewFixtures');
let db,users;
async function reject(fn,code){await db.query('SAVEPOINT denied');await expect(fn()).rejects.toMatchObject({code});await db.query('ROLLBACK TO SAVEPOINT denied');}
const detail=id=>one(db,'SELECT get_payroll_employee_review($1,$2) r',[id,users.admin.id]).then(v=>v.r);
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Isolated payroll profile required');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>db?.end());beforeEach(async()=>{await db.query('BEGIN');users=await createReviewUsers(db);});afterEach(async()=>db.query('ROLLBACK'));
describe('employee review transactions',()=>{
 test.each(['SNP Factory','Fabric Factory'])('%s FM → Accounts → HO guarded lock, independent return/resubmission and audit',async department=>{
  const fixture=await createReviewFixture(db,users,{factory:true,department,count:2}),[a,b]=fixture.rows;
  for(const row of [a,b]){expect((await reviewAction(db,row.id,'calculate',users.fm.id)).row.status).toBe('CALCULATED');expect((await reviewAction(db,row.id,'submit',users.fm.id)).row.status).toBe('PENDING_ACCOUNTS_REVIEW');}
  await reviewAction(db,a.id,'forward',users.reviewer.id);await reviewAction(db,b.id,'return',users.reviewer.id,{reason:'Correct only B'});
  const aBefore=await detail(a.id);expect(aBefore.row.status).toBe('PENDING_HO_APPROVAL');expect((await detail(b.id)).row.last_return_stage).toBe('ACCOUNTS');
  const blocked=await reviewAction(db,a.id,'approve_lock',users.ho.id);expect(blocked.applied).toBe(false);expect(blocked.row.status).toBe('PENDING_HO_APPROVAL');expect(blocked.blockers.map(b=>b.code)).toContain('FINANCIAL_FINALIZATION_DISABLED');
  await reviewAction(db,b.id,'correct',users.fm.id,{note:'Documented correction'});await reviewAction(db,b.id,'calculate',users.fm.id);await reviewAction(db,b.id,'submit',users.fm.id);await reviewAction(db,b.id,'forward',users.reviewer.id);
  await reviewAction(db,b.id,'return',users.ho.id,{reason:'HO source query'});expect((await detail(b.id)).row.last_return_stage).toBe('HO');await reviewAction(db,b.id,'calculate',users.fm.id);expect((await reviewAction(db,b.id,'submit',users.fm.id)).row.status).toBe('PENDING_ACCOUNTS_REVIEW');
  const audit=await detail(b.id);expect(audit.revisions.map(v=>v.revision)).toEqual([1,2,3]);expect(audit.content_versions.map(v=>v.version)).toEqual([1,2]);expect(audit.actions.filter(a=>a.action==='RETURNED').map(a=>[a.actor_role,a.reason])).toEqual([['accounts','Correct only B'],['ho','HO source query']]);
  expect((await detail(a.id)).revisions).toEqual(aBefore.revisions);expect(audit.progress.returned).toBe(0);expect(audit.progress.status).toBe('IN_REVIEW');
 });
 test('office Accounts submits directly to HO; blocked locking cannot change balances or financial tables',async()=>{
  const {rows:[row]}=await createReviewFixture(db,users);await reviewAction(db,row.id,'calculate',users.accounts.id);const calculated=await detail(row.id);expect(calculated.revisions[0].calculation_snapshot.gross_after_lop).toBe('30000.00');
  await reviewAction(db,row.id,'submit',users.accounts.id);expect((await detail(row.id)).row.status).toBe('PENDING_HO_APPROVAL');expect((await detail(row.id)).row.accounts_verified_by).toBeNull();
  const counts=()=>q(db,"SELECT (SELECT count(*) FROM payroll_employee_coverage) coverage,(SELECT count(*) FROM payroll_employee_month_entitlements) entitlements,(SELECT count(*) FROM payroll_month_allocations) allocations,(SELECT sum(available_balance)::text FROM bank_balance_master) bank");const before=await counts();
  const result=await reviewAction(db,row.id,'approve_lock',users.admin.id);expect(result.blockers.map(b=>b.code)).toEqual(expect.arrayContaining(['STATUTORY_PROFILE_PERIOD_COVERAGE_REQUIRED','FINANCIAL_FINALIZATION_DISABLED']));expect(await counts()).toEqual(before);expect((await detail(row.id)).actions.at(-1).action).toBe('LOCK_BLOCKED');
 });
 test('role, scope, self-review, mandatory reason, stale version and duplicate submission guards',async()=>{
  const {rows:[row]}=await createReviewFixture(db,users,{factory:true});await reject(()=>reviewAction(db,row.id,'calculate',users.otherFm.id),'42501');await reject(()=>reviewAction(db,row.id,'calculate',users.accounts.id),'42501');
  await reviewAction(db,row.id,'calculate',users.fm.id);await reject(()=>reviewAction(db,row.id,'submit',users.fm.id,{source_fingerprint:'0'.repeat(64)}),'PY409');await reviewAction(db,row.id,'submit',users.fm.id);
  await reject(()=>reviewAction(db,row.id,'submit',users.fm.id),'PY409');await reject(()=>reviewAction(db,row.id,'return',users.reviewer.id,{reason:' '}),'22023');await reject(()=>reviewAction(db,row.id,'forward',users.ho.id),'42501');
  await q(db,"UPDATE authorised_users SET role='accounts' WHERE id=$1",[users.fm.id]);await reject(()=>reviewAction(db,row.id,'forward',users.fm.id),'42501');
  await reviewAction(db,row.id,'forward',users.reviewer.id);await q(db,"UPDATE authorised_users SET role='admin' WHERE id=$1",[users.reviewer.id]);await reject(()=>reviewAction(db,row.id,'approve_lock',users.reviewer.id),'42501');
  await reject(()=>reviewAction(db,row.id,'return',users.reviewer.id,{reason:'Cannot review own verification'}),'42501');
  const current=(await detail(row.id)).row;await reject(()=>reviewAction(db,row.id,'return',users.ho.id,{reason:'stale'}, {...current,review_version:current.review_version-1}),'PY409');
 });
 test('source changes block approval, allow return, and require a new evidenced assignment/content/calculation version',async()=>{
  const f=await createReviewFixture(db,users,{factory:true}),row=f.rows[0];await reviewAction(db,row.id,'calculate',users.fm.id);await reviewAction(db,row.id,'submit',users.fm.id);
  const h=(await one(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[row.employee_id,'ASSIGNMENT',JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:f.from,effective_to:f.to,employment_joined_on:f.from}]),'SYNTHETIC refreshed evidence',users.admin.id])).id;
  await reject(()=>reviewAction(db,row.id,'forward',users.reviewer.id),'PY409');await reviewAction(db,row.id,'return',users.reviewer.id,{reason:'Refresh assignment reference'});
  const a=await one(db,'SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[h]);await reviewAction(db,row.id,'correct',users.fm.id,{note:'Authoritative new assignment',assignment_id:a.id});await reviewAction(db,row.id,'calculate',users.fm.id);await reviewAction(db,row.id,'submit',users.fm.id);expect((await reviewAction(db,row.id,'forward',users.reviewer.id)).row.status).toBe('PENDING_HO_APPROVAL');
  const revisions=(await detail(row.id)).revisions;expect(revisions[0].source_fingerprint).not.toBe(revisions[1].source_fingerprint);expect(revisions.map(v=>v.content_version)).toEqual([1,2]);
 });
 test('history, calculated snapshots, submitted salary edits and direct financial finalization are protected',async()=>{
  const {rows:[row]}=await createReviewFixture(db,users);await reviewAction(db,row.id,'calculate',users.accounts.id);await reviewAction(db,row.id,'submit',users.accounts.id);
  await reject(()=>q(db,"UPDATE payroll_review_revisions SET calculation_snapshot='{}' WHERE row_id=$1",[row.id]),'42501');await reject(()=>q(db,'DELETE FROM payroll_action_history WHERE row_id=$1',[row.id]),'42501');
  await reject(()=>q(db,"INSERT INTO payroll_review_revisions(row_id,revision,content_version,source_snapshot,source_token,source_fingerprint,calculation_snapshot,reason,created_by) SELECT row_id,revision+1,content_version,source_snapshot,source_token,source_fingerprint,'{}'::jsonb,'Malformed snapshot',$2 FROM payroll_review_revisions WHERE row_id=$1",[row.id,users.accounts.id]),'23514');
  await reject(()=>q(db,"SELECT revise_payroll_draft_note($1,1,'bypass',$2)",[row.id,users.accounts.id]),'42501');await reject(()=>q(db,"UPDATE payroll_run_employees SET status='LOCKED',review_version=review_version+1 WHERE id=$1",[row.id]),'42501');
  for(const role of ['anon','authenticated','service_role']){await q(db,`SET LOCAL ROLE ${role}`);await reject(()=>q(db,'SELECT * FROM payroll_review_revisions'),'42501');await q(db,'RESET ROLE');}
 });
 test('withdrawal is employee-only, terminal, audited and excluded from monthly plans',async()=>{
  const {rows:[a,b]}=await createReviewFixture(db,users,{count:2});await reviewAction(db,a.id,'calculate',users.accounts.id);await reviewAction(db,a.id,'cancel',users.accounts.id,{reason:'Withdraw unapproved draft'});
  const d=await detail(a.id);expect(d.row.status).toBe('CANCELLED_DRAFT');expect(d.progress.cancelled).toBe(1);expect((await detail(b.id)).row.status).toBe('DRAFT');await reject(()=>reviewAction(db,a.id,'calculate',users.accounts.id),'PY409');
  expect((await one(db,'SELECT get_payroll_review_sources($1,$2) r',[a.id,users.accounts.id])).r.month_rows).toEqual([]);
 });
});

test('two real connections: unrelated employee can advance while one row is held; duplicate approval has one winner',async()=>{
 const f=await createReviewFixture(db,users,{factory:true,count:2}),[a,b]=f.rows;
 for(const row of [a,b]){await reviewAction(db,row.id,'calculate',users.fm.id);await reviewAction(db,row.id,'submit',users.fm.id);}
 const expected=(await detail(a.id)).row,fp=(await detail(a.id)).revisions.at(-1).source_fingerprint;
 await db.query('COMMIT');
 const c1=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI}),c2=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await c1.connect();await c2.connect();
 try{
  await c1.query('BEGIN');await c2.query("SET lock_timeout='5s'");
  expect((await reviewAction(c1,a.id,'forward',users.reviewer.id)).row.status).toBe('PENDING_HO_APPROVAL');
  // A different reviewer/employee does not wait for A's row transaction.
  expect((await reviewAction(c2,b.id,'forward',users.accounts.id)).row.status).toBe('PENDING_HO_APPROVAL');
  const pending=c2.query('SELECT transition_payroll_employee_review($1,$2,$3,$4,$5,$6) r',[a.id,expected.current_version,expected.review_version,'forward',JSON.stringify({source_fingerprint:fp}),users.accounts.id]).then(()=>({ok:true}),e=>({code:e.code}));
  await c1.query('COMMIT');expect(await pending).toEqual({code:'PY409'});
  expect((await q(db,"SELECT * FROM payroll_action_history WHERE row_id=$1 AND action='ACCOUNTS_FORWARDED'",[a.id]))).toHaveLength(1);
 }finally{
  await c1.query('ROLLBACK');await c1.end();await c2.end();
  await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,f.employees.map(e=>e.id)]);
  await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);
 }
});

test('even forged service-only calculation readiness cannot activate finalization',async()=>{
 const {rows:[row]}=await createReviewFixture(db,users);await reviewAction(db,row.id,'calculate',users.accounts.id);await reviewAction(db,row.id,'submit',users.accounts.id);
 const e=(await detail(row.id)).row,s=(await one(db,'SELECT get_payroll_review_sources($1,$2) r',[row.id,users.admin.id])).r;
 const {calculatePreview}=require('../../../src/domain/payroll/preview'),calc=calculatePreview(s);calc.blockers=[];calc.final_net_salary='30000.00';calc.financial_workflows_enabled=true;
 const result=(await one(db,'SELECT transition_payroll_employee_review($1,$2,$3,$4,$5,$6) r',[row.id,e.current_version,e.review_version,'approve_lock',JSON.stringify({source_fingerprint:calc.source_fingerprint,source:s,calculation:calc}),users.admin.id])).r;
 expect(result.applied).toBe(false);expect(result.blockers.map(b=>b.code)).toContain('FINANCIAL_FINALIZATION_DISABLED');expect(result.row.status).toBe('PENDING_HO_APPROVAL');
});

test('source changes between backend calculation and database save cannot create a stale revision',async()=>{
 const f=await createReviewFixture(db,users,{factory:true}),row=f.rows[0],src=(await one(db,'SELECT get_payroll_review_sources($1,$2) r',[row.id,users.fm.id])).r;
 const {calculatePreview}=require('../../../src/domain/payroll/preview'),calculation=calculatePreview(src);
 await q(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[row.employee_id,'ASSIGNMENT',JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:f.from,effective_to:f.to,employment_joined_on:f.from}]),'SYNTHETIC concurrent source replacement',users.admin.id]);
 await reject(()=>q(db,'SELECT transition_payroll_employee_review($1,1,0,$2,$3,$4)',[row.id,'calculate',JSON.stringify({reason:'Stale backend result',source:src,calculation}),users.fm.id]),'PY409');
 expect((await q(db,'SELECT * FROM payroll_review_revisions WHERE row_id=$1',[row.id]))).toEqual([]);expect((await one(db,'SELECT status FROM payroll_run_employees WHERE id=$1',[row.id])).status).toBe('DRAFT');
});

test('source-resolution failures do not prevent withdrawing an unapproved oversized legacy interval',async()=>{
 const f=await createReviewFixture(db,users,{factory:true}),e=f.employees[0],to=`${Number(f.from.slice(0,4))+3}-10-01`;
 const h=(await one(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[e.id,'ASSIGNMENT',JSON.stringify([{group_code:f.group,employee_category:f.category,department:f.department,effective_from:f.from,effective_to:to,employment_joined_on:f.from}]),'SYNTHETIC long interval',users.admin.id])).id;
 const a=await one(db,'SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[h]),run=await one(db,"SELECT * FROM create_payroll_draft_run($1,$2,$3,$4,'Custom',$5)",[f.group,f.department,f.from,to,users.fm.id]);
 const row=await one(db,'SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[run.id,a.id,f.from,to,users.fm.id]);
 await reject(()=>one(db,'SELECT get_payroll_review_sources($1,$2)',[row.id,users.fm.id]),'22023');
 const detail=(await one(db,'SELECT get_payroll_employee_review($1,$2) r',[row.id,users.fm.id])).r;
 expect(detail.row.id).toBe(row.id);expect(detail.source).toBeNull();expect(detail.source_error.sqlstate).toBe('22023');expect(detail.content_versions).toHaveLength(1);
 expect((await one(db,'SELECT get_payroll_employee_review($1,$2) r',[row.id,users.otherFm.id])).r.row.id).toBe(row.id);
 await reject(()=>reviewAction(db,row.id,'cancel',users.otherFm.id,{reason:'Cannot take over another preparer'}),'42501');
 expect((await reviewAction(db,row.id,'cancel',users.fm.id,{reason:'Withdraw unsupported interval'})).row.status).toBe('CANCELLED_DRAFT');
});

test('a linked employee cannot review their own salary even when another preparer submitted it',async()=>{
 const {rows:[row],employees:[employee]}=await createReviewFixture(db,users);await reviewAction(db,row.id,'calculate',users.accounts.id);await reviewAction(db,row.id,'submit',users.accounts.id);
 await q(db,'UPDATE hr_employees SET erp_user_id=$1,updated_by=$2 WHERE id=$3',[users.ho.id,users.admin.id,employee.id]);
 await reject(()=>reviewAction(db,row.id,'approve_lock',users.ho.id),'42501');await reject(()=>reviewAction(db,row.id,'return',users.ho.id,{reason:'Own salary'}),'42501');
 const view=(await one(db,'SELECT get_payroll_employee_review($1,$2) r',[row.id,users.ho.id])).r;expect(view.employee_self).toBe(true);
 const queue=(await one(db,'SELECT get_payroll_review_queue($1,$2,NULL,1,20) r',[users.ho.id,row.run_id])).r;expect(queue.rows[0].employee_self).toBe(true);
 expect((await reviewAction(db,row.id,'approve_lock',users.admin.id)).applied).toBe(false);
});
