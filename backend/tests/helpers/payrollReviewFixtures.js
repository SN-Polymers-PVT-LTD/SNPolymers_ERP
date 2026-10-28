// Synthetic isolated fixtures only. No statutory profiles/rates or money postings.
const crypto=require('crypto');
const {policy}=require('./payrollMasterFixtures');
const {calculatePreview}=require('../../src/domain/payroll/preview');
const q=async(db,sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(db,sql,args=[])=>(await q(db,sql,args))[0];
async function createReviewUsers(db){
 const users={};for(const key of ['admin','ho','accounts','reviewer','fm','otherFm','je','zo']){
  const role=key==='reviewer'?'accounts':key==='fm'||key==='otherFm'?'factory_manager':key;
  users[key]=await one(db,'INSERT INTO authorised_users(mobile_number,role,display_name,is_active) VALUES($1,$2,$3,true) RETURNING *',[String(crypto.randomInt(7000000000,9999999999)),role,'Synthetic Phase 4 '+key]);
 }return users;
}
async function createReviewFixture(db,users,{factory=false,department=factory?'SNP Factory':'Head Office',count=1,policyOverrides={},local=false,epfEnrolment=true,esiEnrolment=false}={}){
 const year=Math.max(2800,Number((await one(db,"SELECT coalesce(max(extract(year FROM effective_to)),2799) y FROM payroll_policy_master_revisions WHERE status='PUBLISHED'")).y)+2);
 const from=`${year}-10-01`,to=factory?from:`${year}-10-31`,creator=factory?users.fm:users.accounts;
 const group=factory?(department==='SNP Factory'?(local?'SNP_LOCAL':'SNP_CASUAL'):(local?'FABRIC_LOCAL':'FABRIC_CASUAL')):'HO_STAFF';
 const category=factory?(local?'Local Daily-Wage Workers':department==='SNP Factory'?'SNP Casual Factory Labour':'Fabric Factory Casual Factory Labour'):'HO Staff';
 if(!factory){
  const data=policy({group_code:group,effective_from:from,effective_to:to,rounding:{lop:{method:'HALF_UP',precision:2,stage:'MONTH'},proration:{method:'UNRESOLVED',precision:null,stage:'UNRESOLVED'},allocation:{method:'UNRESOLVED',precision:null,stage:'UNRESOLVED'}},...policyOverrides});
  const d=(await one(db,"SELECT save_payroll_master_draft('policies',NULL,0,$1,$2) r",[JSON.stringify(data),users.admin.id])).r;
  const p=(await one(db,"SELECT preview_payroll_master_publication('policies',$1,$2) r",[d.id,users.admin.id])).r;
  await q(db,"SELECT publish_payroll_master('policies',$1,1,$2,'SYNTHETIC ONLY',$3)",[d.id,p.preview_token,users.admin.id]);
 }
 const run=await one(db,"SELECT * FROM create_payroll_draft_run($1,$2,$3,$4,'Custom',$5)",[group,department,from,to,creator.id]),rows=[],employees=[];
 for(let i=0;i<count;i++){
  const employee=await one(db,"INSERT INTO hr_employees(employee_name,employee_category,department,joining_date,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING *",['Synthetic review '+crypto.randomUUID().slice(0,8),category,department,from,users.admin.id]);employees.push(employee);
  const history=(await one(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5) id',[employee.id,'ASSIGNMENT',JSON.stringify([{group_code:group,employee_category:category,department,effective_from:from,effective_to:to,employment_joined_on:from}]),'SYNTHETIC ONLY',users.admin.id])).id;
  const assignment=await one(db,'SELECT id FROM payroll_employee_assignments WHERE revision_id=$1',[history]);
  if(!factory){const pay=await one(db,"SELECT * FROM create_hr_pay_structure($1,'Monthly salary',30000,$3,$4,'Active',$2)",[employee.id,users.admin.id,epfEnrolment,esiEnrolment]);await q(db,'SELECT record_payroll_source_history($1,$2,$3,$4,$5)',[employee.id,'PERMANENT_PAY',JSON.stringify([{pay_structure_id:pay.id,effective_from:from,effective_to:to}]),'SYNTHETIC ONLY',users.admin.id]);}
  rows.push(await one(db,'SELECT * FROM add_payroll_draft_employee($1,$2,$3,$4,$5)',[run.id,assignment.id,from,to,creator.id]));
 }return {run,rows,employees,creator,from,to,group,category,department};
}
async function reviewAction(db,id,action,actor,extra={},expected){
 const row=await one(db,'SELECT * FROM payroll_run_employees WHERE id=$1',[id]),data={...extra};
 if(['calculate','correct','return','cancel'].includes(action)&&!Object.hasOwn(data,'reason'))data.reason='SYNTHETIC '+action;
 if(['submit','forward','approve_lock'].includes(action)&&!Object.hasOwn(data,'source_fingerprint'))data.source_fingerprint=(await one(db,'SELECT source_fingerprint FROM payroll_review_revisions WHERE row_id=$1 AND revision=$2',[id,row.review_revision])).source_fingerprint;
 if(['calculate','approve_lock'].includes(action)){
  data.source=(await one(db,'SELECT get_payroll_review_sources($1,$2) r',[id,actor])).r;data.calculation=calculatePreview(data.source);
 }
 return (await one(db,'SELECT transition_payroll_employee_review($1,$2,$3,$4,$5,$6) r',[id,expected?.current_version??row.current_version,expected?.review_version??row.review_version,action,JSON.stringify(data),actor])).r;
}
module.exports={q,one,createReviewUsers,createReviewFixture,reviewAction};
