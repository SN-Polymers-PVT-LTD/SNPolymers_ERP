const {resolveMaster,calculationReadiness}=require('../payrollMasters');
// A canonical rule is selectable only from an independently evidenced employee
// profile. Migration 109 deliberately returns null; enrolment alone never fills it.
function statutoryReadiness(source,date){
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
 // Profile verification and scheme-specific legal treatment have no live authoring
 // workflow yet; resolving a rate must not be mistaken for a payable deduction.
 blockers.push({kind:'statutory',code:'STATUTORY_CALCULATION_NOT_ACTIVATED'});
 return {rules,blockers};
}
module.exports={statutoryReadiness};
