import {beforeAll,afterAll,test,expect} from 'vitest';
const {Client}=require('pg'),crypto=require('crypto');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {createReviewUsers,q,one}=require('../../helpers/payrollReviewFixtures');
const {generateTokens}=require('../../../src/services/session.service');
const app=require('../../../src/app');
let db,users,server,base,year;const tokens={},employeeIds=[];
async function post(path,role='fm',body={}){const r=await fetch(base+'/api/v1/auth/hr/payroll'+path,{method:'POST',headers:{'Content-Type':'application/json',...(tokens[role]?{Cookie:`accessToken=${tokens[role]}`}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const period=()=>{year+=5;return {group_code:'SNP_CASUAL',department:'SNP Factory',period_from:`${year}-10-01`,period_to:`${year}-10-02`,cycle:'Custom'};};
async function employee(p,name='Synthetic generated employee',intervals){
 const e=await one(db,"INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING *",[name,p.department==='Head Office'?'HO Staff':'SNP Casual Factory Labour',p.department,p.period_from,users.admin.id]);employeeIds.push(e.id);
 if(intervals!==false)await history(e,p,intervals);return e;
}
async function history(e,p,intervals){await q(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[e.id,'ASSIGNMENT',JSON.stringify((intervals||[{effective_from:p.period_from,effective_to:p.period_to}]).map(i=>({group_code:p.group_code,employee_category:e.employee_category,department:p.department,employment_joined_on:p.period_from,...i}))),'SYNTHETIC generation evidence',users.admin.id]);}
const rows=id=>q(db,'SELECT * FROM payroll_run_employees WHERE run_id=$1 ORDER BY employee_id',[id]);
beforeAll(async()=>{
 await requireLocalSupabase();db=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await db.connect();users=await createReviewUsers(db);
 year=Math.max(5000,Number((await one(db,'SELECT coalesce(max(extract(year FROM effective_from)),4999) y FROM payroll_employee_assignments')).y)+10);
 for(const [role,u] of Object.entries(users)){const session=await one(db,'INSERT INTO sessions(user_id,is_active,jwt_jti) VALUES($1,true,$2) RETURNING id',[u.id,crypto.randomUUID()]);tokens[role]=generateTokens(u,session.id,crypto.randomUUID()).accessToken;}
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db){await q(db,"UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[users.admin.id,employeeIds]);await q(db,'UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(users).map(u=>u.id)]);await db.end();}});
test('populates beyond one page, calculates each employee without submission/posting, and refresh is idempotent',async()=>{
 const p=period();for(let i=0;i<21;i++)await employee(p,`Synthetic generation ${i}`);
 const generated=await post('/runs/generate','fm',p);expect(generated.status).toBe(201);expect(generated.body.generation.added).toBe(21);expect(generated.body.generation.results).toHaveLength(21);expect(generated.body.generation.results.every(r=>r.success)).toBe(true);
 const id=generated.body.run.id,records=await rows(id);expect(records.every(r=>r.status==='CALCULATED'&&r.review_revision===1&&r.submitted_by===null)).toBe(true);
 expect((await one(db,'SELECT count(*) count FROM payroll_financial_snapshots WHERE row_id=ANY($1::uuid[])',[records.map(r=>r.id)])).count).toBe('0');
 const report=(await one(db,'SELECT get_payroll_salary_register($1,$2,1,20) r',[users.fm.id,JSON.stringify({run_id:id})])).r;expect(report.total).toBe(21);expect(report.rows).toHaveLength(20);expect(report.rows.every(r=>r.net_salary===null&&r.blockers.length>0)).toBe(true);
 const again=await post(`/runs/${id}/generate`);expect(again.status).toBe(200);expect(again.body.generation.added).toBe(0);expect(again.body.generation.results).toEqual([]);expect((await rows(id)).every(r=>r.review_revision===1)).toBe(true);
 const first=records[0],fp=(await one(db,'SELECT source_fingerprint FROM payroll_review_revisions WHERE row_id=$1 AND revision=$2',[first.id,first.review_revision])).source_fingerprint;
 const submitted=await post(`/rows/${first.id}/review`,'fm',{action:'submit',expected_version:first.current_version,expected_review_version:first.review_version,source_fingerprint:fp});expect(submitted.status).toBe(200);
 const before=(await rows(id)).find(r=>r.id===first.id);await post(`/runs/${id}/generate`);expect((await rows(id)).find(r=>r.id===first.id)).toEqual(before);
});
test('missing and ambiguous assignments are visible issues while valid employees calculate',async()=>{
 const p=period(),good=await employee(p),missing=await employee(p,'Synthetic missing history',false),ambiguous=await employee(p,'Synthetic two intervals',[{effective_from:p.period_from,effective_to:p.period_from},{effective_from:p.period_to,effective_to:p.period_to}]);
 const r=await post('/runs/generate','fm',p);expect(r.status).toBe(201);expect(r.body.generation.added).toBe(1);
 expect(r.body.generation.issues).toEqual(expect.arrayContaining([expect.objectContaining({employee_id:missing.id,code:'ASSIGNMENT_HISTORY_REQUIRED'}),expect.objectContaining({employee_id:ambiguous.id,code:'MULTIPLE_ASSIGNMENT_INTERVALS'})]));expect((await rows(r.body.run.id))[0]).toMatchObject({employee_id:good.id,status:'CALCULATED'});
});
test('failed source resolution does not roll back peers and retries do not duplicate rows',async()=>{
 const p=period();p.period_to=`${year+3}-10-02`;const good=await employee(p,'Synthetic short interval',[{effective_from:p.period_from,effective_to:p.period_from}]),broken=await employee(p,'Synthetic oversized interval');
 const r=await post('/runs/generate','fm',p);expect(r.status).toBe(201);expect(r.body.generation.results.some(r=>r.success)).toBe(true);expect(r.body.generation.results.some(r=>!r.success&&r.code==='22023')).toBe(true);
 const records=await rows(r.body.run.id);expect(records.find(r=>r.employee_id===good.id).status).toBe('CALCULATED');expect(records.find(r=>r.employee_id===broken.id).status).toBe('DRAFT');
 const retry=await post(`/runs/${r.body.run.id}/generate`);expect(retry.body.generation.added).toBe(0);expect(retry.body.generation.results).toHaveLength(1);expect(await rows(r.body.run.id)).toHaveLength(2);
});
test('refresh detects changed sources and adds newcomers without overwriting saved/calculated or corrected work',async()=>{
 const p=period(),e=await employee(p),first=await post('/runs/generate','fm',p),id=first.body.run.id,original=(await rows(id))[0];await history(e,p);const newcomer=await employee(p,'Synthetic newcomer');
 const r=await post(`/runs/${id}/generate`);expect(r.body.generation.added).toBe(1);expect(r.body.generation.source_checks).toContainEqual({row_id:original.id,status:'CHANGED'});expect((await rows(id)).find(r=>r.id===original.id)).toEqual(original);expect((await rows(id)).find(r=>r.employee_id===newcomer.id).status).toBe('CALCULATED');
 const assignment=await one(db,"SELECT a.id FROM payroll_employee_assignments a JOIN payroll_source_history_revisions h ON h.id=a.revision_id WHERE a.employee_id=$1 ORDER BY h.version DESC LIMIT 1",[e.id]);
 const corrected=await post(`/rows/${original.id}/review`,'fm',{assignment_id:assignment.id,action:'correct',expected_version:original.current_version,expected_review_version:original.review_version,reason:'SYNTHETIC correction',note:'Do not auto-recalculate'});expect(corrected.status).toBe(200);
 const before=(await rows(id)).find(r=>r.id===original.id),again=await post(`/runs/${id}/generate`);expect(again.body.generation.results).toEqual([]);expect((await rows(id)).find(r=>r.id===original.id)).toEqual(before);
});
test('roles, ownership, strict inputs and service-only population remain enforced',async()=>{
 const p=period();await employee(p);const r=await post('/runs/generate','fm',p),id=r.body.run.id;
 for(const role of ['admin','ho','je','zo'])expect((await post('/runs/generate',role,p)).status).toBe(403);expect((await post('/runs/generate','anonymous',p)).status).toBe(401);
 expect((await post(`/runs/${id}/generate`,'otherFm')).status).toBe(403);expect((await post(`/runs/${id}/generate`,'fm',{net_salary:'100'})).status).toBe(400);expect((await post('/runs/generate','fm',{...p,actor_id:users.admin.id})).status).toBe(400);expect((await post('/runs/generate','fm',{...p,group_code:'HO_STAFF',department:'Head Office'})).status).toBe(403);
 expect(await one(db,"SELECT has_function_privilege('authenticated','populate_payroll_draft_run(uuid,uuid)','execute') browser,has_function_privilege('anon','populate_payroll_draft_run(uuid,uuid)','execute') anonymous")).toEqual({browser:false,anonymous:false});
});
test('concurrent population adds an employee only once',async()=>{
 const p=period();await employee(p);const created=await post('/runs','fm',p),id=created.body.run.id,a=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI}),b=new Client({connectionString:process.env.SUPABASE_TEST_DB_URI});await a.connect();await b.connect();
 try{const results=await Promise.all([a,b].map(c=>c.query('SELECT populate_payroll_draft_run($1,$2) r',[id,users.fm.id])));expect(results.map(r=>r.rows[0].r.added).sort()).toEqual([0,1]);expect(await rows(id)).toHaveLength(1);}finally{await a.end();await b.end();}
});

test('Accounts generates office rows through its own preparer workflow',async()=>{
 const p={...period(),group_code:'HO_STAFF',department:'Head Office'};const e=await employee(p,'Synthetic office generation');
 const r=await post('/runs/generate','accounts',p);expect(r.status).toBe(201);expect(r.body.run.created_by).toBe(users.accounts.id);expect(r.body.generation.added).toBe(1);
 expect((await rows(r.body.run.id))[0]).toMatchObject({employee_id:e.id,created_by:users.accounts.id,status:'CALCULATED',submitted_by:null});
 expect((await post(`/runs/${r.body.run.id}/generate`,'fm')).status).toBe(403);
});
