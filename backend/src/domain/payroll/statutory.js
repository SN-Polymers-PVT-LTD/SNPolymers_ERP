const {schemeApplies}=require('./statutoryPolicy');
// Applicable schemes require evidenced scope; category-excluded schemes need no profile.
function statutoryReadiness(source,date){
 return profileReadiness({...source,row:source.row||{period_from:date,period_to:date}});
}
// Identification is a diagnostic, not a contribution/eligibility formula. No
// monthly timing, continuity, recovery or exemption semantics are inferred.
function profileReadiness(source){
 const profiles=source.statutory_profiles||[],links=source.statutory_rule_links||[];
 const from=source.source_from||source.row.period_from,to=source.source_to||source.row.period_to;
 const blockers=[],rules=[];
 for(const scheme of ['EPF','ESI','PT']){
  const block=code=>blockers.push({kind:'statutory',scheme,code});
  const applies=schemeApplies(source,scheme,from,to);
  if(applies===false){rules.push({scheme,status:'NOT_APPLICABLE_BY_EMPLOYEE_RULE',employee_deduction:'0.00',employer_contribution:'0.00'});continue;}
  if(applies===null){block('EMPLOYEE_CATEGORY_OR_PAY_ENROLMENT_REQUIRED');continue;}
  const candidates=profiles.filter(p=>p.scheme===scheme&&p.effective_from<=from&&(!p.effective_to||p.effective_to>=to));
  const rule={scheme,status:'BLOCKED_PROFILE',profile_id:null,revision_id:null,statutory_scope_id:null,employee_deduction:null,employer_contribution:null};
  if(candidates.length!==1){block(candidates.length?'AMBIGUOUS_EMPLOYEE_STATUTORY_PROFILE':'STATUTORY_PROFILE_PERIOD_COVERAGE_REQUIRED');rules.push(rule);continue;}
  const p={...candidates[0],applicability:'APPLICABLE',enrolled:scheme==='PT'?null:true};rule.profile_id=p.id;rule.statutory_scope_id=p.statutory_scope_id;
  if(!['ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'].includes(p.verification_status))block('VERIFIED_EMPLOYEE_PROFILE_REQUIRED');
  if(!p.statutory_scope_id)block('EMPLOYEE_CANONICAL_SCOPE_REQUIRED');
  if(['ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'].includes(p.verification_status)&&p.statutory_scope_id&&p.applicability==='APPLICABLE'){
   const applicable=links.filter(l=>l.scheme===scheme&&l.statutory_scope_id===p.statutory_scope_id&&l.effective_from<=from&&l.effective_to>=to);
   if(applicable.length===1){rule.status='APPLICABLE_RULE_IDENTIFIED';rule.revision_id=applicable[0].id;}
   else {rule.status='BLOCKED_RULE';block(applicable.length?'AMBIGUOUS_EMPLOYEE_SCOPED_RULE':'STATUTORY_RULE_PERIOD_COVERAGE_REQUIRED');}
  }
  if(blockers.some(b=>b.scheme===scheme))rule.status='BLOCKED_PROFILE_OR_RULE';
  rules.push(rule);
 }
 if(rules.some(r=>r.status!=='NOT_APPLICABLE_BY_EMPLOYEE_RULE'))blockers.push({kind:'statutory',code:'STATUTORY_CALCULATION_NOT_ACTIVATED'},{kind:'statutory',code:'STATUTORY_MONTH_RECONCILIATION_NOT_IMPLEMENTED'});
 return {rules,blockers};
}
module.exports={statutoryReadiness};
