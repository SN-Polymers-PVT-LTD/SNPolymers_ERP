const D=require('./exact');const {resolveSources,fingerprint}=require('./sources');const {factoryDay}=require('./factory');const {permanentCalculation}=require('./permanent');const {statutoryReadiness}=require('./statutory');
function calculatePreview(source){
 source={...source,month_rows:source.month_rows.filter(r=>r.status!=='CANCELLED_DRAFT')};
 const resolution=resolveSources(source),blockers=[...resolution.blockers];let earnings=[],deductions=[],months=[],warnings=[];
 if(source.is_permanent){const permanent=permanentCalculation(source,resolution.days);({earnings,deductions,months,warnings}=permanent);blockers.push(...permanent.blockers);}
 for(const day of resolution.days.filter(d=>d.factory&&d.date>=source.row.period_from&&d.date<=source.row.period_to)){
  const result=factoryDay(day,source.is_permanent);earnings.push(...result.lines);blockers.push(...result.blockers);
 }
 const overlaps=source.coverage.filter(c=>c.period_from<=source.row.period_to&&source.row.period_from<=c.period_to);
 if(overlaps.length)blockers.push({kind:'reconciliation',code:'FINALIZED_COVERAGE_EXISTS',reference:overlaps.map(c=>c.id)});
 if(!source.is_permanent){const others=source.month_rows.filter(r=>r.id!==source.row.id&&r.period_from<=source.row.period_to&&source.row.period_from<=r.period_to);if(others.length)blockers.push({kind:'reconciliation',code:'OVERLAPPING_PAYROLL_PERIODS',reference:others.map(r=>r.id)});}
 const earningsReady=blockers.length===0&&earnings.every(l=>l.amount!==null)&&deductions.every(l=>l.amount!==null);
 const total=lines=>D.sum(lines.filter(l=>l.amount!==null).map(l=>{const sign=l.amount.startsWith('-')?-1n:1n;const v=D.decimal(l.amount.replace('-',''));return D.mul(v,D.fraction(sign));}));
 const known=total(earnings),lop=total(deductions),gross=D.sub(known,lop);
 if(gross.n<0n)blockers.push({kind:'policy',code:'NEGATIVE_GROSS_FORBIDDEN'});
 // No employee statutory profile exists through 108; enrolment is not a profile.
 const stat=statutoryReadiness(source,source.row.period_from),statutory=stat.rules;blockers.push(...stat.blockers);
 const unique=[...new Map(blockers.map(b=>[JSON.stringify(b),b])).values()].map(b=>({...b,employee_id:source.row.employee_id,group_code:source.run.group_code,responsible_team:b.kind==='statutory'?'Admin / statutory advisor':b.kind==='policy'?'Admin / policy approver':b.kind==='reconciliation'?'Accounts / payroll preparer':b.code.includes('LEAVE')?'HO / leave reviewer':b.code.includes('ATTENDANCE')||b.code.includes('DUTY')?'Factory Manager / HO':'Admin / HR source owner'}));
 return {engine_version:'PAYROLL_PREVIEW_V1',row_id:source.row.id,row_version:source.row.current_version,employee:source.employee,period_from:source.row.period_from,period_to:source.row.period_to,source_fingerprint:fingerprint(source),status:unique.some(b=>b.kind!=='statutory')?'BLOCKED_CALCULATION':'BLOCKED_STATUTORY',earnings,deductions,known_earnings_total:D.format(known)||D.format(known,6),gross_after_lop:earningsReady&&gross.n>=0n?(D.format(gross)||D.format(gross,6)):null,final_net_salary:null,statutory,enrolment:source.pay_structures.map(p=>({pay_structure_id:p.id,epf_enrolment:p.epf_enrolment,esi_enrolment:p.esi_enrolment})),monthly_reconciliation:months,configuration_warnings:warnings,blockers:unique,source_references:{history:source.history.map(h=>({id:h.id,source_kind:h.source_kind,version:h.version})),assignments:source.assignments.map(a=>a.id),pay_applicability:source.pay_applicability.map(a=>a.id),attendance:source.attendance.map(a=>({id:a.id,date:a.attendance_date,status:a.sheet_status})),leave:source.leave.map(l=>({id:l.id,status:l.approval_status,pay_treatment:l.pay_treatment})),policies:source.policies.map(p=>({id:p.id,revision_number:p.revision_number}))},financial_workflows_enabled:false,preview_persisted:false};
}
module.exports={calculatePreview};
