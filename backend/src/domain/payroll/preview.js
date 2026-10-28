const D=require('./exact');const {resolveSources,fingerprint}=require('./sources');const {factoryDay}=require('./factory');const {permanentCalculation}=require('./permanent');const {statutoryReadiness}=require('./statutory');
const {adjustmentCalculation}=require('./adjustments');const {statutoryCalculation}=require('./statutoryCalculation');
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
 const adjustments=source.financial_context?adjustmentCalculation(source):{earnings:[],deductions:[],applications:[],blockers:[]};
 earnings.push(...adjustments.earnings);deductions.push(...adjustments.deductions);blockers.push(...adjustments.blockers);
 const earningsReady=blockers.length===0&&earnings.every(l=>l.amount!==null)&&deductions.every(l=>l.amount!==null);
 const total=lines=>D.sum(lines.filter(l=>l.amount!==null).map(l=>{const sign=l.amount.startsWith('-')?-1n:1n;const v=D.decimal(l.amount.replace('-',''));return D.mul(v,D.fraction(sign));}));
 const known=total(earnings),lop=total(deductions.filter(l=>l.code==='LOP')),gross=D.sub(known,lop);
 if(gross.n<0n)blockers.push({kind:'policy',code:'NEGATIVE_GROSS_FORBIDDEN'});
 // Enrolment flags alone do not establish statutory eligibility or deductions.
 const stat=source.financial_context?statutoryCalculation(source,earnings,deductions):statutoryReadiness(source,source.row.period_from);

 if(source.financial_context&&!earningsReady){stat.entries=[];stat.rules=stat.rules.map(r=>({...r,status:'BLOCKED',employee_deduction:null,employer_contribution:null}));stat.blockers.push({kind:'statutory',code:'COMPLETE_GROSS_REQUIRED'});}
 const statutory=stat.rules;blockers.push(...stat.blockers);
 const statEmployee=D.sum((stat.entries||[]).map(e=>D.decimal(e.employee_amount))),statEmployer=D.sum((stat.entries||[]).map(e=>D.decimal(e.employer_amount)));
 for(const entry of stat.entries||[])if(D.decimal(entry.employee_amount).n)deductions.push({code:entry.scheme,amount:entry.employee_amount,salary_month:entry.salary_month,source_ids:[entry.source_profile_id,...(entry.rule_revision_id?[entry.rule_revision_id]:[])]});
 const allDeductions=total(deductions),net=D.sub(known,allDeductions);
 if(source.financial_context&&earningsReady&&net.n<0n)blockers.push({kind:'financial',code:'NEGATIVE_NET_FORBIDDEN'});
 const financialReady=!!source.financial_context&&blockers.length===0&&stat.rules.length>0;
 const finalNet=financialReady?D.format(D.round(net,{method:'HALF_UP',precision:2}),2):null;
 const unique=[...new Map(blockers.map(b=>[JSON.stringify(b),b])).values()].map(b=>({...b,employee_id:source.row.employee_id,group_code:source.run.group_code,responsible_team:b.kind==='statutory'?'Accounts / statutory setup':b.kind==='adjustment'?'Accounts / HO adjustment approval':b.kind==='financial'?'Accounts / HO financial reviewer':b.kind==='policy'?'Admin / policy approver':b.kind==='reconciliation'?'Accounts / payroll preparer':b.code.includes('LEAVE')?'HO / leave reviewer':b.code.includes('ATTENDANCE')||b.code.includes('DUTY')?'Factory Manager / HO':'Admin / HR source owner'}));
 return {engine_version:'PAYROLL_PREVIEW_V1',row_id:source.row.id,row_version:source.row.current_version,employee:source.employee,...(source.beneficiary?{beneficiary:source.beneficiary}:{}),period_from:source.row.period_from,period_to:source.row.period_to,source_fingerprint:fingerprint(source),status:financialReady?'READY_FOR_REVIEW':unique.some(b=>b.kind!=='statutory')?'BLOCKED_CALCULATION':'BLOCKED_STATUTORY',earnings,deductions,known_earnings_total:D.format(known)||D.format(known,6),gross_after_lop:earningsReady&&gross.n>=0n?(D.format(gross)||D.format(gross,6)):null,final_net_salary:finalNet,...(source.financial_context?{calculation_revision:'PHASE6_CATEGORY_RULES_V1',earnings_total:D.format(known,6),deductions_total:D.format(allDeductions,6),employee_statutory_total:D.format(statEmployee,6),employer_contributions_total:D.format(statEmployer,6),statutory_entries:stat.entries||[],adjustment_applications:adjustments.applications,final_net_rounding:{method:'HALF_UP',precision:2,stage:'FINAL_NET'},financial_readiness:financialReady}:{}),statutory,enrolment:source.pay_structures.map(p=>({pay_structure_id:p.id,epf_enrolment:p.epf_enrolment,esi_enrolment:p.esi_enrolment})),monthly_reconciliation:months,configuration_warnings:warnings,blockers:unique,source_references:{...(source.statutory_profile_history?{statutory_profile_history:source.statutory_profile_history,statutory_profiles:source.statutory_profiles.map(p=>p.id),statutory_rule_links:source.statutory_rule_links}:{}),history:source.history.map(h=>({id:h.id,source_kind:h.source_kind,version:h.version})),assignments:source.assignments.map(a=>a.id),pay_applicability:source.pay_applicability.map(a=>a.id),attendance:source.attendance.map(a=>({id:a.id,date:a.attendance_date,status:a.sheet_status})),leave:source.leave.map(l=>({id:l.id,status:l.approval_status,pay_treatment:l.pay_treatment})),policies:source.policies.map(p=>({id:p.id,revision_number:p.revision_number}))},financial_workflows_enabled:false,preview_persisted:false};
}
module.exports={calculatePreview};
