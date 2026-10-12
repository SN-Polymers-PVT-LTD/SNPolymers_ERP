import {describe,test,expect} from 'vitest';
const {interval}=require('../../helpers/payrollProfileFixtures');
const {statutoryReadiness}=require('../../../src/domain/payroll/statutory');
const schema=require('../../../src/validation/payrollProfiles.schema');
const scope='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profile=interval(scope,'2091-10-01','2091-10-31');
const source=()=>({row:{period_from:profile.effective_from,period_to:profile.effective_to},statutory_profile_history:{id:'history',version:1},statutory_profiles:Object.entries(profile.schemes).map(([scheme,data])=>({id:scheme,scheme,...data,verification_status:profile.verification_status,effective_from:profile.effective_from,effective_to:profile.effective_to})),statutory_rule_links:[{id:'rule',scheme:'EPF',statutory_scope_id:scope,effective_from:profile.effective_from,effective_to:profile.effective_to}],pay_structures:[{epf_enrolment:true,esi_enrolment:false}]});
describe('protected statutory profile contracts and readiness',()=>{
 test('requires all schemes, canonical mappings and explicit evidence; refuses money/rate or actor inputs',()=>{
  expect(schema.interval.safeParse(profile).success).toBe(true);
  const body={expected_version:0,intervals:[profile],evidence_reference:'Synthetic evidence'};
  for(const extra of [{employee_rate:'12'},{actor_id:scope},{final_net_salary:'100'}])expect(schema.save.body.safeParse({...body,...extra}).success).toBe(false);
  expect(schema.interval.safeParse({...profile,schemes:{EPF:profile.schemes.EPF}}).success).toBe(false);
  for(const bad of [{...profile,advisor_name:null},{...profile,effective_to:'2091-09-30'},{...profile,schemes:{...profile.schemes,PT:{...profile.schemes.PT,enrolled:true}}},{...profile,schemes:{...profile.schemes,EPF:{...profile.schemes.EPF,statutory_scope_id:null}}}])expect(schema.interval.safeParse(bad).success).toBe(false);
 });
 test('identifies employee-specific rules and documented nonapplicability without returning money',()=>{
  const result=statutoryReadiness(source());expect(result.rules.map(r=>r.status)).toEqual(['APPLICABLE_RULE_IDENTIFIED','DOCUMENTED_NOT_APPLICABLE','DOCUMENTED_NOT_APPLICABLE']);
  expect(result.blockers.map(b=>b.code)).toEqual(['STATUTORY_CALCULATION_NOT_ACTIVATED','STATUTORY_MONTH_RECONCILIATION_NOT_IMPLEMENTED']);expect(result.rules.every(r=>r.employee_deduction===null&&r.employer_contribution===null)).toBe(true);
 });
 test('does not override contradictory permanent-pay enrolment flags or treat unverified records as exemptions',()=>{
  const s=source();s.pay_structures[0].epf_enrolment=false;expect(statutoryReadiness(s).blockers.map(b=>b.code)).toContain('ENROLMENT_EVIDENCE_CONFLICT');
  s.statutory_profiles[1].verification_status='UNVERIFIED';const result=statutoryReadiness(s);expect(result.rules[1].status).toBe('BLOCKED_PROFILE_OR_RULE');expect(result.blockers.map(b=>b.code)).toContain('VERIFIED_EMPLOYEE_PROFILE_REQUIRED');
 });
 test('blocks gaps, midperiod changes, ambiguous profiles and rule scopes without choosing a legal timing method',()=>{
  const s=source();s.statutory_profiles[0].effective_to='2091-10-14';expect(statutoryReadiness(s).blockers.map(b=>b.code)).toContain('STATUTORY_PROFILE_PERIOD_COVERAGE_REQUIRED');
  const ambiguous=source();ambiguous.statutory_profiles.push({...ambiguous.statutory_profiles[0],id:'duplicate'});expect(statutoryReadiness(ambiguous).blockers.map(b=>b.code)).toContain('AMBIGUOUS_EMPLOYEE_STATUTORY_PROFILE');
  const wrongScope=source();wrongScope.statutory_rule_links[0].statutory_scope_id='unrelated';expect(statutoryReadiness(wrongScope).blockers.map(b=>b.code)).toContain('STATUTORY_RULE_PERIOD_COVERAGE_REQUIRED');
 });
});
