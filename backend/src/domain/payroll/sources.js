const crypto=require('crypto');
const {resolveMaster}=require('../payrollMasters');
const D=require('./exact');
const next=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
function dates(from,to){const result=[];for(let d=from;d<=to;d=next(d)){if(result.length>732)throw new Error('PREVIEW_PERIOD_TOO_LONG');result.push(d);}return result;}
const monthBounds=date=>{const from=date.slice(0,7)+'-01';return {from,to:new Date(Date.parse(from+'T00:00:00Z')+32*86400000).toISOString().slice(0,7)+'-01'};};
function month(date){const {from,to}=monthBounds(date);return {from,to:new Date(Date.parse(to+'T00:00:00Z')-86400000).toISOString().slice(0,10)};}
const covers=(r,d)=>r.effective_from<=d&&(!r.effective_to||d<=r.effective_to);
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
function fingerprint(source){return crypto.createHash('sha256').update(JSON.stringify(canonical({engine_version:'PAYROLL_PREVIEW_V1',calculation_revision:'PHASE6_SALARY_STATUS_GUARD_V1',source}))).digest('hex');}
function resolveSources(source){
 const blockers=[],days=[];const block=(code,date,reference)=>blockers.push({code,date,reference,kind:'source'});
 const selected=source.assignments.find(a=>a.id===source.row.assignment_id);
 if(!selected)block('ASSIGNMENT_HISTORY_OUTDATED',source.row.period_from,source.row.assignment_id);
 const currentPay=source.history.find(h=>h.source_kind==='PERMANENT_PAY');
 if(source.is_permanent&&(source.draft_snapshot?.pay_history_revision_id??null)!==(currentPay?.id??null))block('PAY_HISTORY_OUTDATED',source.row.period_from,currentPay?.id);
 for(const date of dates(source.source_from,source.source_to)){
  if(source.assignments.length && (source.assignments.every(a=>date<a.employment_joined_on)||source.assignments.every(a=>a.employment_exited_on&&date>a.employment_exited_on)))continue;
  const applicable=source.assignments.filter(a=>covers(a,date));
  if(applicable.length!==1){block(applicable.length?'AMBIGUOUS_ASSIGNMENT':'MISSING_ASSIGNMENT',date);continue;}
  const assignment=applicable[0],factory=['SNP Factory','Fabric Factory'].includes(assignment.department);
  const item={date,assignment,factory};
  if(source.is_permanent){
   const pay=source.pay_applicability.filter(a=>covers(a,date));
   if(pay.length!==1)block(pay.length?'AMBIGUOUS_PAY_SOURCE':'MISSING_PAY_SOURCE',date);
   else {item.pay=source.pay_structures.find(p=>p.id===pay[0].pay_structure_id);item.pay_applicability=pay[0];if(!item.pay||['Draft','Suspended'].includes(item.pay.status))block('INVALID_PAY_SOURCE',date,pay[0].pay_structure_id);}
   item.policy=resolveMaster('policies',source.policies,{group_code:assignment.group_code},date);
   if(item.policy.error)block(item.policy.error,date);
  }
  const leave=source.leave.filter(l=>l.from_date<=date&&date<=l.to_date);
  item.leave=leave;
  if(leave.length>1)block('OVERLAPPING_LEAVE',date,leave.map(l=>l.id));
  if(leave.some(l=>l.approval_status==='Pending'||!['Paid','Unpaid'].includes(l.pay_treatment)||!l.decided_at))block('UNFINALIZED_LEAVE',date,leave.map(l=>l.id));
  if(factory){
   // Include legacy and other-factory facts when detecting duplicates; never attribute them.
   const rows=source.attendance.filter(a=>a.attendance_date===date);
   if(rows.length!==1)block(rows.length?'DUPLICATE_ATTENDANCE':'MISSING_LOCKED_ATTENDANCE',date,rows.map(a=>a.id));
   else {
    const row=rows[0];item.attendance=row;
    if(row.sheet_status!=='Locked')block('ATTENDANCE_NOT_LOCKED',date,row.sheet_id);
    if(row.department!==assignment.department||row.employee_category!==assignment.employee_category)block('ATTENDANCE_ASSIGNMENT_MISMATCH',date,row.id);
    item.rule=source.factory_rules.filter(r=>r.employee_category===assignment.employee_category&&r.effective_from<=date).at(-1);
    item.wage=source.wages.filter(r=>r.employee_category===assignment.employee_category&&r.effective_from<=date).at(-1);
    if(!item.rule||item.rule.id!==row.pay_rule_revision_id)block('MISSING_OR_OUTDATED_FACTORY_RULE',date,row.pay_rule_revision_id);
    if(!source.is_permanent&&(!item.wage||item.wage.id!==row.wage_revision_id))block('MISSING_OR_OUTDATED_WAGE',date,row.wage_revision_id);
    if(leave.length&&row.leave_request_id!==leave[0].id)block('ATTENDANCE_LEAVE_CONFLICT',date,row.id);
    if(row.leave_request_id&&!leave.some(l=>l.id===row.leave_request_id))block('MISSING_LEAVE_SOURCE',date,row.leave_request_id);
    if(['Medical Leave','Paid Leave','Unpaid Leave'].includes(row.attendance_status)&&!row.leave_request_id)block('MISSING_LEAVE_SOURCE',date,row.id);
    if(row.attendance_status==='Compensatory Off'){
     const previous=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
     const evidence=source.attendance.filter(a=>a.attendance_date===previous&&a.sheet_status==='Locked'&&D.compare(D.decimal(a.actual_hours),D.decimal('24'))>=0n);
     if(evidence.length!==1)block('COMP_OFF_EVIDENCE_REQUIRED',date,row.id);else item.comp_off_source=evidence[0].id;
    }
   }
  }
  days.push(item);
 }
 const worked=source.attendance.filter(a=>a.entry_timestamp&&a.exit_timestamp&&a.sheet_status==='Locked');
 for(let i=0;i<worked.length;i++)for(let j=i+1;j<worked.length;j++)if(Date.parse(worked[i].entry_timestamp)<Date.parse(worked[j].exit_timestamp)&&Date.parse(worked[j].entry_timestamp)<Date.parse(worked[i].exit_timestamp))block('OVERLAPPING_DUTY_TIMESTAMPS',worked[j].attendance_date,[worked[i].id,worked[j].id]);
 return {days,blockers};
}
module.exports={dates,month,covers,canonical,fingerprint,resolveSources};
