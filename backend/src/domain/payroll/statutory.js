const {resolveMaster,calculationReadiness}=require('../payrollMasters');
// A canonical rule is selectable only from an independently evidenced employee
// profile. Migration 109 deliberately returns null; enrolment alone never fills it.
function statutoryReadiness(source,date){
 if(source.statutory_profile_history)return profileReadiness(source);
 const profile=source.statutory_profile;
 if(!profile)return {rules:['EPF','ESI','PT'].map(scheme=>({scheme,status:'BLOCKED_PROFILE',revision_id:null,statutory_scope_id:null,employee_deduction:null,employer_contribution:null})),blockers:[{kind:'statutory',code:'EMPLOYEE_STATUTORY_PROFILE_REQUIRED'},{kind:'statutory',code:'EMPLOYEE_CANONICAL_SCOPE_REQUIRED'}]};
 const blockers=[],rules=[];
 for(const scheme of ['EPF','ESI','PT']){
  const scope=profile.schemes?.[scheme]?.statutory_scope_id;
  const resolved=resolveMaster('statutory',source.statutory_rules||[],{scheme,statutory_scope_id:scope},date);
  const ready=calculationReadiness(resolved,{statutory_profile_verified:profile.verified===true&&profile.effective_from<=date&&(!profile.effective_to||date<=profile.effective_to),adjustment_types:[]});
  blockers.push(...ready.blockers.map(b=>({...b,scheme,kind:'statutory'})));
  rules.push({scheme,status:ready.ready?'MASTER_RESOLVED':'BLOCKED_RULE',revision_id:resolved.revision_id,statutory_scope_id:scope||null,employee_deduction:null,employer_contribution:null});
 }
 // Scheme-specific legal calculation remains disabled; resolving a rate must
 // not be mistaken for a payable deduction.
 blockers.push({kind:'statutory',code:'STATUTORY_CALCULATION_NOT_ACTIVATED'});
 return {rules,blockers};
}
// Identification is a diagnostic, not a contribution/eligibility formula. No
// monthly timing, continuity, recovery or exemption semantics are inferred.
function profileReadiness(source){
 const profiles=source.statutory_profiles||[],links=source.statutory_rule_links||[];
 const from=source.source_from||source.row.period_from,to=source.source_to||source.row.period_to;
 const blockers=[],rules=[];
 for(const scheme of ['EPF','ESI','PT']){
  const block=code=>blockers.push({kind:'statutory',scheme,code});
  const candidates=profiles.filter(p=>p.scheme===scheme&&p.effective_from<=from&&(!p.effective_to||p.effective_to>=to));
  const rule={scheme,status:'BLOCKED_PROFILE',profile_id:null,revision_id:null,statutory_scope_id:null,employee_deduction:null,employer_contribution:null};
  if(candidates.length!==1){block(candidates.length?'AMBIGUOUS_EMPLOYEE_STATUTORY_PROFILE':'STATUTORY_PROFILE_PERIOD_COVERAGE_REQUIRED');rules.push(rule);continue;}
  const p=candidates[0];rule.profile_id=p.id;rule.statutory_scope_id=p.statutory_scope_id;
  if(p.verification_status!=='ADVISOR_VERIFIED')block('VERIFIED_EMPLOYEE_PROFILE_REQUIRED');
  if(!p.statutory_scope_id)block('EMPLOYEE_CANONICAL_SCOPE_REQUIRED');
  if(p.applicability==='UNRESOLVED')block('EMPLOYEE_STATUTORY_APPLICABILITY_REQUIRED');
  if(scheme!=='PT'){
   if(typeof p.enrolled!=='boolean')block('EMPLOYEE_ENROLMENT_EVIDENCE_REQUIRED');
   else if((source.pay_structures||[]).some(pay=>typeof pay[scheme==='EPF'?'epf_enrolment':'esi_enrolment']==='boolean'&&pay[scheme==='EPF'?'epf_enrolment':'esi_enrolment']!==p.enrolled))block('ENROLMENT_EVIDENCE_CONFLICT');
  }
  if(p.verification_status==='ADVISOR_VERIFIED'&&p.statutory_scope_id&&p.applicability==='NOT_APPLICABLE')rule.status='DOCUMENTED_NOT_APPLICABLE';
  if(p.verification_status==='ADVISOR_VERIFIED'&&p.statutory_scope_id&&p.applicability==='APPLICABLE'){
   const applicable=links.filter(l=>l.scheme===scheme&&l.statutory_scope_id===p.statutory_scope_id&&l.effective_from<=from&&l.effective_to>=to);
   if(applicable.length===1){rule.status='APPLICABLE_RULE_IDENTIFIED';rule.revision_id=applicable[0].id;}
   else {rule.status='BLOCKED_RULE';block(applicable.length?'AMBIGUOUS_EMPLOYEE_SCOPED_RULE':'STATUTORY_RULE_PERIOD_COVERAGE_REQUIRED');}
  }
  if(blockers.some(b=>b.scheme===scheme))rule.status='BLOCKED_PROFILE_OR_RULE';
  rules.push(rule);
 }
 blockers.push({kind:'statutory',code:'STATUTORY_CALCULATION_NOT_ACTIVATED'},{kind:'statutory',code:'STATUTORY_MONTH_RECONCILIATION_NOT_IMPLEMENTED'});
 return {rules,blockers};
}
module.exports={statutoryReadiness};
