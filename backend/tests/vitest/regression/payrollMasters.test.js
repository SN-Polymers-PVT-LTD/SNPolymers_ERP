import {beforeAll,afterAll,beforeEach,afterEach,describe,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {policy,statutory,pt}=require('../../helpers/payrollMasterFixtures');
let db,admin,accounts;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const actor=async role => (await q('INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING id',[String(crypto.randomInt(7000000000,9999999999)),role,'Synthetic master fixture']))[0].id;
const save=async(kind,data,id=null,version=0,who=(kind==='statutory'?accounts:admin))=>(await q('SELECT save_payroll_master_draft($1,$2,$3,$4,$5) r',[kind,id,version,JSON.stringify(data),who]))[0].r;
const preview=async(kind,id)=>(await q('SELECT preview_payroll_master_publication($1,$2,$3) r',[kind,id,kind==='statutory'?accounts:admin]))[0].r;
const publish=async(kind,r)=>{const p=await preview(kind,r.id);return (await q('SELECT publish_payroll_master($1,$2,$3,$4,$5,$6) r',[kind,r.id,r.version,p.preview_token,'Synthetic approval only',kind==='statutory'?accounts:admin]))[0].r;};
const resolve=async(kind,scope,date)=>(await q('SELECT resolve_payroll_master($1,$2,$3,$4) r',[kind,JSON.stringify(scope),date,kind==='statutory'?accounts:admin]))[0].r;
const rejected=async(sql,args,code)=>{await q('SAVEPOINT bad');await expect(q(sql,args)).rejects.toMatchObject({code});await q('ROLLBACK TO SAVEPOINT bad');};
beforeAll(async()=>{if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Phase 2 DB fixtures require test:payroll:local or test-local.sh --isolated');await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();});
afterAll(async()=>{await db?.end();});
beforeEach(async()=>{await q('BEGIN');admin=await actor('admin');accounts=await actor('accounts');});
afterEach(async()=>{await q('ROLLBACK');});
describe('Phase 2 actual PostgreSQL master integrity',()=>{
 test('draft CAS edit, publication audit, future supersession and historical resolution',async()=>{
  const previousRevision=Number((await q("SELECT coalesce(max(revision_number),0) number FROM payroll_policy_master_revisions WHERE group_code IS NULL"))[0].number);
  const old=await save('policies',policy());expect((await resolve('policies',{group_code:'HO_STAFF'},'2091-01-01')).error).toBe('MISSING_POLICY');
  const edit=await save('policies',policy({reason:'Updated synthetic evidence'}),old.id,1);expect(edit.version).toBe(2);
  await rejected('SELECT save_payroll_master_draft($1,$2,$3,$4,$5)',['policies',old.id,1,JSON.stringify(policy()),admin],'PY409');
  const pub=await publish('policies',edit);expect(pub.revision_number).toBe(previousRevision+1);expect(pub.published_by).toBe(admin);
  const next=await save('policies',policy({effective_from:'2092-01-01',lop_method:'ACTUAL_CALENDAR_DAYS',lop_fixed_divisor:null}));
  const check=await preview('policies',next.id);expect(check.supersedes[0].id).toBe(old.id);expect(check.diff.some(d=>d.field==='lop_method')).toBe(true);
  await publish('policies',next);
  const historical=await resolve('policies',{group_code:'HO_STAFF'},'2091-02-01');expect(historical.revision_id).toBe(old.id);expect(historical.data.lop_fixed_divisor).toBe('30');
  expect((await resolve('policies',{group_code:'HO_STAFF'},'2093-02-01')).revision_id).toBe(next.id);
  const row=(await q('SELECT effective_to::text,published_effective_to::text,lop_method FROM payroll_policy_master_revisions WHERE id=$1',[old.id]))[0];expect(row).toEqual({effective_to:'2091-12-31',published_effective_to:'2099-12-31',lop_method:'FIXED_DIVISOR'});
  expect((await q("SELECT count(*) FROM payroll_master_events WHERE action='SUPERSEDED_FUTURE' AND policy_revision_id=$1",[old.id]))[0].count).toBe('1');
  await rejected("UPDATE payroll_policy_master_revisions SET lop_fixed_divisor=31 WHERE id=$1",[old.id],'42501');
  await rejected("UPDATE payroll_policy_master_revisions SET effective_to='2020-01-01' WHERE id=$1",[old.id],'42501');
  await rejected('DELETE FROM payroll_policy_master_revisions WHERE id=$1',[old.id],'42501');
 });
 test('global/specific precedence, known groups, blockers and conflict preview',async()=>{
  const global=await publish('policies',await save('policies',policy()));const group=await publish('policies',await save('policies',policy({group_code:'HO_STAFF',lop_fixed_divisor:'31'})));
  expect((await resolve('policies',{group_code:'HO_STAFF'},'2091-10-01')).revision_id).toBe(group.id);expect((await resolve('policies',{group_code:'PROJECTS_JE'},'2091-10-01')).revision_id).toBe(global.id);
  const dup=await save('policies',policy());const p=await preview('policies',dup.id);expect(p.publishable).toBe(false);expect(p.conflicts.length).toBeGreaterThan(0);
  await rejected('SELECT publish_payroll_master($1,$2,$3,$4,$5,$6)',['policies',dup.id,1,p.preview_token,'Test',admin],'22023');
  expect(p.configuration_warnings.map(b=>b.field)).toContain('full_month_unpaid_treatment');
  expect((await resolve('policies',{group_code:'SNP_LOCAL'},'2091-10-01')).error).toBe('DAILY_WAGE_MASTER_REQUIRED');
  await rejected("SELECT resolve_payroll_master('policies','{\"group_code\":\"FORGED\"}','2091-10-01',$1)",[admin],'22023');
 });
 test('strict direct RPC validation rejects forged inputs, zero/negative/nonfinite divisors and midmonth/backdated publication',async()=>{
  for(const data of [policy({lop_fixed_divisor:'0'}),policy({lop_fixed_divisor:'-1'}),policy({lop_fixed_divisor:'NaN'}),policy({sandwich_enabled:true}),policy({epf_rate:'10'}),policy({partial_month_proration_method:'FIXED_DIVISOR',partial_month_fixed_divisor:null})])await rejected('SELECT save_payroll_master_draft($1,NULL,0,$2,$3)',['policies',JSON.stringify(data),admin],'22023');
  for(const date of ['2090-01-15','2020-01-01'])expect((await preview('policies',(await save('policies',policy({effective_from:date}))).id)).publishable).toBe(false);
 });
 test('preview CAS rejects edited draft or conflicting later publication',async()=>{
  const a=await save('policies',policy());const p=await preview('policies',a.id);await save('policies',policy({lop_fixed_divisor:'31'}),a.id,1);
  await rejected('SELECT publish_payroll_master($1,$2,$3,$4,$5,$6)',['policies',a.id,1,p.preview_token,'Test',admin],'PY409');
  const b=await save('policies',policy());const before=await preview('policies',b.id);await publish('policies',await save('policies',policy()));
  await rejected('SELECT publish_payroll_master($1,$2,$3,$4,$5,$6)',['policies',b.id,1,before.preview_token,'Test',admin],'PY409');
 });
 test('statutory revisions retain separate shares/bases, historical scope and advisor evidence',async()=>{
  const s=statutory();const first=await publish('statutory',await save('statutory',s));
  const next=statutory({effective_from:'2092-01-01',configuration:{...s.configuration,employee_rate:'8.125'}});await publish('statutory',await save('statutory',next));
  const resolved=await resolve('statutory',s,'2091-02-01');expect(resolved.revision_id).toBe(first.id);expect(resolved.data.configuration).toEqual(s.configuration);expect(resolved.blockers).toEqual([]);
  expect((await resolve('statutory',{scheme:'EPF'},'2091-02-01')).error).toBe('STATUTORY_SCOPE_REQUIRED');
  expect((await resolve('statutory',{...s,jurisdiction:'OTHER'},'2091-02-01')).error).toBe('MISSING_POLICY');
  await rejected("UPDATE payroll_statutory_rule_revisions SET configuration=jsonb_set(configuration,'{employee_rate}','\"10\"') WHERE id=$1",[first.id],'42501');
 });
 test('missing rates/ceilings and unsupported conditions cannot publish via RPC or owner SQL',async()=>{
  for(const s of [statutory({configuration:{...statutory().configuration,employee_rate:null}}),statutory({configuration:{...statutory().configuration,conditions:'PROFILE_EXEMPTIONS'}}),statutory({configuration:{...statutory().configuration,wage_ceiling:null}})]){
   const r=await save('statutory',s),p=await preview('statutory',r.id);expect(p.publishable).toBe(false);
   await rejected('SELECT publish_payroll_master($1,$2,$3,$4,$5,$6)',['statutory',r.id,1,p.preview_token,'Test',accounts],'22023');
   await rejected("UPDATE payroll_statutory_rule_revisions SET status='PUBLISHED',published_by=$2,published_at=now(),revision_number=1,approval_reference='Test',published_effective_to=effective_to,version=version+1 WHERE id=$1",[r.id,accounts],'22023');
  }
 });
 test('PT monthly complete half-open slabs; overlaps/gaps/negative values rejected and published slabs immutable',async()=>{
  const data=pt(),r=await publish('statutory',await save('statutory',data));expect((await resolve('statutory',data,'2091-02-01')).data.slabs).toHaveLength(24);
  expect((await q('SELECT deduction_amount::text FROM payroll_professional_tax_slabs WHERE revision_id=$1 AND month=2 AND numrange(lower_bound,upper_bound,\'[)\') @> 10000::numeric',[r.id]))[0].deduction_amount).toBe('137.00');
  await rejected('UPDATE payroll_professional_tax_slabs SET deduction_amount=99 WHERE revision_id=$1',[r.id],'42501');
  for(const mutate of [s=>s[0].upper_bound='10001',s=>s.splice(0,1),s=>s[0].deduction_amount='-1']){const bad=pt();mutate(bad.slabs);await rejected('SELECT save_payroll_master_draft($1,NULL,0,$2,$3)',['statutory',JSON.stringify(bad),accounts],'22023');}
  const empty=await save('statutory',pt({slabs:[]}));expect((await preview('statutory',empty.id)).publishable).toBe(false);
 });
 test('PT draft changes schemes atomically and Accounts saves record fresh ownership',async()=>{
  const first=await save('statutory',pt({verification_status:'UNVERIFIED',advisor_name:null,verification_reference:null,verified_on:null}));
  const changed=await save('statutory',statutory(),first.id,1);expect(changed.scheme).toBe('EPF');expect((await q('SELECT count(*) FROM payroll_professional_tax_slabs WHERE revision_id=$1',[first.id]))[0].count).toBe('0');
  const newRules=statutory({configuration:{...statutory().configuration,employee_rate:'8.125'}});
  const reverified=await save('statutory',newRules,first.id,2);expect(reverified.configuration.employee_rate).toBe('8.125');expect(reverified.verification_status).toBe('ACCOUNTS_CONFIRMED');expect(reverified.verification_reference).toBe(newRules.reason);
  expect((await resolve('statutory',{jurisdiction:'J',establishment:'E'},'2091-02-01')).error).toBe('STATUTORY_SCOPE_REQUIRED');
 });
 test('another current Admin can maintain a draft after its historical creator becomes inactive',async()=>{
  const creator=admin,r=await save('policies',policy());const nextAdmin=await actor('admin');
  await q('UPDATE authorised_users SET is_active=false WHERE id=$1',[creator]);
  const edit=await save('policies',policy({reason:'Current Admin reviewed the inherited draft'}),r.id,1,nextAdmin);expect(edit.created_by).toBe(creator);
  admin=nextAdmin;const pub=await publish('policies',edit);expect(pub.created_by).toBe(creator);expect(pub.published_by).toBe(nextAdmin);
 });
 test('current Admin check and revoked direct access on all master tables/helpers',async()=>{
  await rejected('SELECT save_payroll_master_draft($1,NULL,0,$2,$3)',['policies',JSON.stringify(policy()),accounts],'42501');
  for(const role of ['anon','authenticated','service_role']){
   for(const table of ['payroll_policy_master_revisions','payroll_statutory_rule_revisions','payroll_professional_tax_slabs','payroll_master_events'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])expect((await q('SELECT has_table_privilege($1,$2,$3) allowed',[role,table,privilege]))[0].allowed).toBe(false);
   await q(`SET LOCAL ROLE ${role}`);await rejected('SELECT * FROM payroll_policy_master_revisions',[],'42501');await rejected('INSERT INTO payroll_master_events(action,actor_id,after_snapshot) VALUES(\'PUBLISHED\',$1,\'{}\')',[admin],'42501');await rejected("SELECT payroll_validate_master('policies','{}')",[],'42501');await q('RESET ROLE');
  }
  await q('UPDATE authorised_users SET is_active=false WHERE id=$1',[admin]);await rejected('SELECT get_payroll_master_revisions($1,$2)',['policies',admin],'42501');
 });
 test('publication leaves HR enrolment, factory facts, bank balances and all Phase 1 posting gates intact',async()=>{
  const before=await q('SELECT id,available_balance FROM bank_balance_master ORDER BY id');const counts=await q('SELECT (SELECT count(*) FROM hr_attendance_rows) attendance,(SELECT count(*) FROM hr_leave_requests) leaves,(SELECT count(*) FROM acct_requisition_line_items) accounts');
  await publish('statutory',await save('statutory',statutory()));await publish('policies',await save('policies',policy()));
  expect(await q('SELECT id,available_balance FROM bank_balance_master ORDER BY id')).toEqual(before);expect(await q('SELECT (SELECT count(*) FROM hr_attendance_rows) attendance,(SELECT count(*) FROM hr_leave_requests) leaves,(SELECT count(*) FROM acct_requisition_line_items) accounts')).toEqual(counts);
  const triggers=await q("SELECT tgname FROM pg_trigger WHERE tgname IN ('payroll_coverage_phase1_gate','payroll_entitlement_phase1_gate','payroll_allocation_phase1_gate') AND tgenabled='O'");expect(triggers).toHaveLength(3);
 });
 test.each(['statutory','policies'])('two real connections concurrently publishing the same %s draft have one winner',async kind=>{
  // Persistent synthetic fixture only in isolated DB; never clean up shared data.
  if(process.env.LOCAL_SUPABASE_TEST_PROFILE!=='payroll')throw new Error('Concurrency requires isolated payroll profile');
  const year=Math.max(3000,Number((await q("SELECT coalesce(max(extract(year FROM effective_to)),2999) AS cycle_year FROM payroll_policy_master_revisions WHERE status='PUBLISHED'"))[0].cycle_year)+1);
  const s=kind==='statutory'?statutory({jurisdiction:`TEST_CONCURRENCY_${crypto.randomUUID()}`}):policy({effective_from:`${year}-01-01`,effective_to:`${year}-01-31`});const r=await save(kind,s);const p=await preview(kind,r.id);await q('COMMIT');
  const c1=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI}),c2=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await c1.connect();await c2.connect();
  const sql='SELECT publish_payroll_master($1,$2,$3,$4,$5,$6)';const args=[kind,r.id,1,p.preview_token,'Synthetic concurrency',kind==='statutory'?accounts:admin];
  try{await c1.query('BEGIN');await c1.query(sql,args);let completed=false;const contender=c2.query(sql,args).then(()=>({ok:true}),e=>({code:e.code})).finally(()=>{completed=true;});await new Promise(resolve=>setTimeout(resolve,80));expect(completed).toBe(false);await c1.query('COMMIT');expect((await contender).code).toBe('PY409');expect((await q("SELECT count(*) FROM payroll_master_events WHERE coalesce(statutory_revision_id,policy_revision_id)=$1 AND action='PUBLISHED'",[r.id]))[0].count).toBe('1');}
  finally{await c1.query('ROLLBACK');await c1.end();await c2.end();await q('BEGIN');}
 });
});

describe('Phase 2 review database protections',()=>{
 test('typed configurations round-trip, unresolved classifications warn, malformed or dual aggregate bases fail',async()=>{
  const s=statutory({jurisdiction:crypto.randomUUID()});s.configuration.adjustment_basis={SALARY_ARREARS:'INCLUDE',BONUS:'EXCLUDE',REIMBURSEMENT:'UNRESOLVED',RECOVERY:'DEDUCTION_ONLY'};
  const r=await save('statutory',s),p=await preview('statutory',r.id);
  expect(r.configuration.adjustment_basis).toEqual(s.configuration.adjustment_basis);expect(p.publishable).toBe(true);
  expect(p.configuration_warnings).toContainEqual({field:'adjustment_basis.REIMBURSEMENT',code:'ADJUSTMENT_CLASSIFICATION_REQUIRED'});
  for(const basis of [{...s.configuration.adjustment_basis,RECOVERY:'INCLUDE'},{BONUS:'INCLUDE'}]){
   await q('SAVEPOINT bad_basis');await expect(save('statutory',{...s,configuration:{...s.configuration,adjustment_basis:basis}})).rejects.toMatchObject({code:'22023'});await q('ROLLBACK TO SAVEPOINT bad_basis');
  }
  const legacy=statutory();expect((await preview('statutory',(await save('statutory',legacy)).id)).configuration_warnings).toContainEqual({field:'adjustment_basis.BONUS',code:'ADJUSTMENT_CLASSIFICATION_REQUIRED'});
 });
 test('explicit canonical mappings preserve labels/history, reject aliases with overlapping dates and deny unauthorized mapping',async()=>{
  const code='TEST_'+crypto.randomUUID().replaceAll('-','').toUpperCase();
  const scope=(await q('SELECT register_payroll_statutory_scope($1,$2,$3,$4) id',[code,'ESTABLISHMENT','SYNTHETIC ONLY - explicitly registered',accounts]))[0].id;
  const data=statutory({jurisdiction:crypto.randomUUID()}),first=await publish('statutory',await save('statutory',data));
  await q('SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[first.id,scope,'SYNTHETIC ONLY - approved mapping',accounts]);
  const r=await resolve('statutory',{scheme:'EPF',statutory_scope_id:scope},'2091-02-01');expect(r.revision_id).toBe(first.id);expect(r.statutory_scope_id).toBe(scope);expect(r.data.jurisdiction).toBe(data.jurisdiction);
  const alias=await publish('statutory',await save('statutory',{...data,jurisdiction:crypto.randomUUID()}));
  for(const [who,code] of [[await actor('ho'),'42501'],[accounts,'23P01'],[admin,'42501']]){
   await q('SAVEPOINT binding_failure');await expect(q('SELECT bind_payroll_statutory_scope($1,$2,$3,$4)',[alias.id,scope,'Synthetic alias',who])).rejects.toMatchObject({code});await q('ROLLBACK TO SAVEPOINT binding_failure');
  }
  await q('SAVEPOINT mapping_immutable');await expect(q('DELETE FROM payroll_statutory_scope_bindings WHERE revision_id=$1',[first.id])).rejects.toMatchObject({code:'42501'});await q('ROLLBACK TO SAVEPOINT mapping_immutable');
  await q('SET LOCAL ROLE service_role');await q('SAVEPOINT direct_scope');await expect(q('SELECT * FROM payroll_statutory_scopes')).rejects.toMatchObject({code:'42501'});await q('ROLLBACK TO SAVEPOINT direct_scope');await q('RESET ROLE');
 });
});
