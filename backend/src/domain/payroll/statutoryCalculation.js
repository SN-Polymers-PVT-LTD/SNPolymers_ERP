const D=require('./exact');const {month,dates}=require('./sources');const {configuration,slab}=require('../../validation/payrollMasters.schema');const {signed}=require('./adjustments');
const schemes=['EPF','ESI','PT'],confirmed=p=>['ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'].includes(p?.verification_status);
const ref=r=>D.fraction(BigInt(r.numerator),BigInt(r.denominator));
const sum=lines=>D.sum(lines.map(l=>signed(l.amount)));
function statutoryCalculation(source,earnings,deductions){
 const rules=[],entries=[],blockers=[];
 const starts=[...new Set(dates(source.row.period_from,source.row.period_to).map(d=>d.slice(0,7)+'-01'))];
 for(const start of starts)for(const scheme of schemes){
  const bounds=month(start),from=source.row.period_from>bounds.from?source.row.period_from:bounds.from,to=source.row.period_to<bounds.to?source.row.period_to:bounds.to;
  const block=code=>blockers.push({kind:'statutory',code,scheme,date:start});
  const ps=(source.statutory_profiles||[]).filter(p=>p.scheme===scheme&&p.effective_from<=from&&(!p.effective_to||p.effective_to>=to));
  const result={scheme,contribution_month:start,status:'BLOCKED',employee_deduction:null,employer_contribution:null,revision_id:null,statutory_scope_id:null};rules.push(result);
  if(ps.length!==1){block(ps.length?'AMBIGUOUS_EMPLOYEE_STATUTORY_PROFILE':'STATUTORY_PROFILE_PERIOD_COVERAGE_REQUIRED');continue;}
  const p=ps[0];result.profile_id=p.id;result.statutory_scope_id=p.statutory_scope_id;
  if(!confirmed(p)||!p.statutory_scope_id||p.applicability==='UNRESOLVED'){block('CONFIRMED_EMPLOYEE_PROFILE_REQUIRED');continue;}
  if(scheme!=='PT'&&(typeof p.enrolled!=='boolean'||(source.pay_structures||[]).some(pay=>typeof pay[scheme==='EPF'?'epf_enrolment':'esi_enrolment']==='boolean'&&pay[scheme==='EPF'?'epf_enrolment':'esi_enrolment']!==p.enrolled))){block('ENROLMENT_EVIDENCE_CONFLICT');continue;}
  const prior=(source.statutory_entries||[]).filter(e=>e.scheme===scheme&&e.contribution_month===start);
  if(prior.some(e=>e.statutory_scope_id!==p.statutory_scope_id)){block('STATUTORY_SCOPE_CHANGE_REQUIRES_ADJUSTMENT');continue;}
  const employeeCollected=D.sum(prior.map(e=>D.decimal(e.employee_amount))),employerAccrued=D.sum(prior.map(e=>D.decimal(e.employer_amount)));
  if(p.applicability==='NOT_APPLICABLE'){
   if(employeeCollected.n||employerAccrued.n){block('STATUTORY_APPLICABILITY_CHANGE_REQUIRES_ADJUSTMENT');continue;}
   Object.assign(result,{status:'DOCUMENTED_NOT_APPLICABLE',employee_deduction:'0.00',employer_contribution:'0.00',eligible_wage:'0.00'});
   entries.push({salary_month:start,scheme,statutory_scope_id:p.statutory_scope_id,rule_revision_id:null,source_profile_id:p.id,eligible_wage:D.reference(D.zero()),employee_amount:'0.00',employer_amount:'0.00',monthly_employee_liability:'0.00',monthly_employer_liability:'0.00',previous_employee_collected:'0.00',previous_employer_accrued:'0.00'});continue;
  }
  const masters=(source.statutory_calculation_rules||[]).filter(r=>r.scheme===scheme&&r.statutory_scope_id===p.statutory_scope_id&&r.effective_from<=start&&(!r.effective_to||r.effective_to>=start));
  if(masters.length!==1){block(masters.length?'AMBIGUOUS_EMPLOYEE_SCOPED_RULE':'STATUTORY_MONTH_START_RULE_REQUIRED');continue;}
  const rule=masters[0],parsed=configuration.safeParse(rule.configuration);result.revision_id=rule.id;
  if(!parsed.success){block('INVALID_STATUTORY_CONFIGURATION');continue;}
  const c=parsed.data;
  if(!['INCREMENTAL_MONTHLY','MONTH_CLOSE'].includes(c.collection_timing)){block('STATUTORY_COLLECTION_TIMING_REQUIRED');continue;}
  if(c.conditions!=='NONE'||!['ENROLLED','WAGE_CEILING','ENROLLED_AND_WAGE_CEILING','JURISDICTION_PROFILE'].includes(c.eligibility)||c.calculation_method==='UNRESOLVED'){block('STATUTORY_ELIGIBILITY_RULE_REQUIRED');continue;}
  if(c.rounding.method==='UNRESOLVED'||!['MONTH','AGGREGATE'].includes(c.rounding.stage)){block('STATUTORY_MONTH_ROUNDING_REQUIRED');continue;}
  if(c.contribution_minimum!==null||c.contribution_cap!==null){block('CONTRIBUTION_LIMIT_SHARE_RULE_REQUIRED');continue;}
  if(c.collection_timing==='MONTH_CLOSE'&&to!==bounds.to){block('STATUTORY_MONTH_CLOSE_REQUIRED');continue;}
  const es=earnings.filter(l=>(l.salary_month||l.date?.slice(0,7)+'-01')===start),ds=deductions.filter(l=>l.salary_month===start);
  const base=es.find(l=>l.code==='CONTRACTUAL_BASE'),lop=sum(ds.filter(l=>l.code==='LOP'));let current=D.zero();
  if(base){
   const components=base.contract_components,monthInfo=source.pay_structures.find(pay=>base.source_ids.includes(pay.id));
   if(!components||!monthInfo){block('STATUTORY_COMPONENT_EVIDENCE_REQUIRED');continue;}
   if(lop.n&&c.lop_wage_basis!=='PROPORTIONAL_COMPONENTS'){block('STATUTORY_LOP_COMPONENT_RULE_REQUIRED');continue;}
   const gross=D.decimal(monthInfo.guaranteed_monthly_gross),paidBase=D.sub(signed(base.amount),lop);
   if(paidBase.n<0n){block('NEGATIVE_STATUTORY_WAGE');continue;}
   for(const name of c.included_components.filter(name=>Object.hasOwn(components,name))){
    if(components[name]===null||components[name]===undefined){block('STATUTORY_COMPONENT_EVIDENCE_REQUIRED');continue;}
    if(gross.n!==0n)current=D.add(current,D.mul(D.decimal(components[name]),D.div(paidBase,gross)));
   }
  }
  for(const l of es.filter(l=>l.code!=='CONTRACTUAL_BASE')){
   const name=l.code==='DOUBLE_DUTY'?'DAILY_WAGE':l.code;
   if(l.adjustment_type){
    const treatment=c.adjustment_basis?.[l.adjustment_type];
    if(!['INCLUDE','EXCLUDE'].includes(treatment)){block('ADJUSTMENT_CLASSIFICATION_REQUIRED');continue;}
    if(treatment==='INCLUDE'){
     if(l.adjustment_type==='SALARY_ARREARS'&&c.arrears_period!=='CURRENT_RUN_MONTH'){block('STATUTORY_ARREARS_PERIOD_REQUIRED');continue;}
     current=D.add(current,signed(l.amount));
    }
   }else if(c.included_components.includes(name))current=D.add(current,signed(l.amount));
  }
  if(ds.some(l=>l.adjustment_type==='RECOVERY')&&c.adjustment_basis?.RECOVERY!=='DEDUCTION_ONLY'){block('RECOVERY_CLASSIFICATION_REQUIRED');continue;}
  if(blockers.some(b=>b.scheme===scheme&&b.date===start))continue;
  if(current.n<0n){block('NEGATIVE_STATUTORY_WAGE');continue;}
  const combined=D.add(current,D.sum(prior.map(e=>ref(e.eligible_wage))));let eligible=true,employee=D.zero(),employer=D.zero();
  if(['ENROLLED','ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility))eligible=p.enrolled;
  if(['WAGE_CEILING','ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility)){
   if(c.eligibility_ceiling===null){block('STATUTORY_ELIGIBILITY_CEILING_REQUIRED');continue;}
   eligible=eligible&&D.compare(combined,D.decimal(c.eligibility_ceiling))<=0n;
  }
  if(scheme==='PT'){
   const slabs=(rule.slabs||[]).filter(s=>s.month===Number(start.slice(5,7))&&slab.safeParse(s).success&&D.compare(combined,D.decimal(s.lower_bound))>=0n&&(s.upper_bound===null||D.compare(combined,D.decimal(s.upper_bound))<0n));
   if(c.calculation_method!=='SLABS'||c.eligibility!=='JURISDICTION_PROFILE'||slabs.length!==1){block('STATUTORY_PT_SLAB_REQUIRED');continue;}
   employee=D.decimal(slabs[0].deduction_amount);
  }else if(eligible){
   if(c.employee_rate===null||c.employer_rate===null||!['QUALIFYING_WAGE_PERCENTAGE','CAPPED_WAGE_PERCENTAGE'].includes(c.calculation_method)){block('STATUTORY_RATE_REQUIRED');continue;}
   let wage=combined;
   if(c.calculation_method==='CAPPED_WAGE_PERCENTAGE'){
    if(c.wage_ceiling===null){block('STATUTORY_WAGE_CEILING_REQUIRED');continue;}
    if(D.compare(wage,D.decimal(c.wage_ceiling))>0n)wage=D.decimal(c.wage_ceiling);
   }
   employee=D.round(D.mul(wage,D.div(D.decimal(c.employee_rate),D.decimal('100'))),c.rounding);
   employer=D.round(D.mul(wage,D.div(D.decimal(c.employer_rate),D.decimal('100'))),c.rounding);
  }
  const employeeDelta=D.sub(employee,employeeCollected),employerDelta=D.sub(employer,employerAccrued);
  if(employeeDelta.n<0n||employerDelta.n<0n){block('NEGATIVE_STATUTORY_RESIDUAL_REQUIRES_APPROVED_ADJUSTMENT');continue;}
  Object.assign(result,{status:'CALCULATED',eligible,eligible_wage:D.format(current,6)||D.reference(current),monthly_eligible_wage:D.reference(combined),employee_deduction:D.format(employeeDelta,Math.max(2,c.rounding.precision)),employer_contribution:D.format(employerDelta,Math.max(2,c.rounding.precision)),monthly_employee_liability:D.format(employee,Math.max(2,c.rounding.precision)),monthly_employer_liability:D.format(employer,Math.max(2,c.rounding.precision)),previous_employee_collected:D.format(employeeCollected,6),previous_employer_accrued:D.format(employerAccrued,6)});
  entries.push({salary_month:start,scheme,statutory_scope_id:p.statutory_scope_id,rule_revision_id:rule.id,source_profile_id:p.id,eligible_wage:D.reference(current),employee_amount:result.employee_deduction,employer_amount:result.employer_contribution,monthly_employee_liability:result.monthly_employee_liability,monthly_employer_liability:result.monthly_employer_liability,previous_employee_collected:result.previous_employee_collected,previous_employer_accrued:result.previous_employer_accrued});
 }
 return {rules,entries,blockers};
}
module.exports={statutoryCalculation};
