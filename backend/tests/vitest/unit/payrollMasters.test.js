import {describe,test,expect} from 'vitest';
const {policy,statutory,pt}=require('../../helpers/payrollMasterFixtures');
const {validateMaster,resolveMaster,selectProfessionalTaxSlab}=require('../../../src/domain/payrollMasters');
const {create}=require('../../../src/validation/hrPayStructures.schema');
const published=(id,data)=>({id,status:'PUBLISHED',...data,data});
describe('Phase 2 pure master validation and historical resolution',()=>{
 test('invalid date, missing group and unknown kind fail explicitly',()=>{
  expect(resolveMaster('policies',[],{},'2090-01-01').error).toBe('PAYROLL_GROUP_REQUIRED');
  expect(resolveMaster('policies',[],{group_code:'HO_STAFF'},'2090-02-30').error).toBe('INVALID_DATE');
  expect(validateMaster('forged',{}).valid).toBe(false);
 });
 test('Fixed 30, explicit calendar days and independent proration/allocation resolve with exact ID',()=>{
  const fixed=published('fixed',policy());expect(resolveMaster('policies',[fixed],{group_code:'HO_STAFF'},'2091-02-10').data.lop_fixed_divisor).toBe('30');
  const actual=published('actual',policy({lop_method:'ACTUAL_CALENDAR_DAYS',lop_fixed_divisor:null,partial_month_proration_method:'FIXED_DIVISOR',partial_month_fixed_divisor:'30',split_period_allocation_method:'CALENDAR_WEIGHTED_WITH_RESIDUAL'}));
  const r=resolveMaster('policies',[actual],{group_code:'HO_STAFF'},'2091-10-10');expect(r.revision_id).toBe('actual');expect(r.data.partial_month_fixed_divisor).toBe('30');expect(r.data.sandwich_enabled).toBe(false);expect(r.configuration_warnings).toContainEqual({field:'full_month_unpaid_treatment',code:'UNRESOLVED'});
 });
 test.each(['0','-1','NaN','Infinity',30,'10000'])('invalid divisor %s rejected',v=>{expect(validateMaster('policies',policy({lop_fixed_divisor:v})).valid).toBe(false);});
 test('specific precedence, future dates, historical lookup, missing, ambiguous and draft exclusion',()=>{
  const global=published('global',policy());const specific=published('group',policy({group_code:'HO_STAFF',effective_from:'2092-01-01'}));
  expect(resolveMaster('policies',[global,specific],{group_code:'HO_STAFF'},'2091-10-10').revision_id).toBe('global');
  expect(resolveMaster('policies',[global,specific],{group_code:'HO_STAFF'},'2092-10-10').revision_id).toBe('group');
  expect(resolveMaster('policies',[specific],{group_code:'HO_STAFF'},'2091-10-10').error).toBe('MISSING_POLICY');
  expect(resolveMaster('policies',[global],{group_code:'SNP_CASUAL'},'2091-10-10').error).toBe('DAILY_WAGE_MASTER_REQUIRED');
  expect(resolveMaster('policies',[global,{...global,id:'duplicate'}],{group_code:'HO_STAFF'},'2091-10-10').error).toBe('AMBIGUOUS_POLICY');
  expect(resolveMaster('policies',[{...global,status:'DRAFT'}],{group_code:'HO_STAFF'},'2091-10-10').error).toBe('MISSING_POLICY');
 });
 test('statutory shares and exact wage-basis ceilings remain separate; unverified never resolves',()=>{
  const data=statutory(),r=published('stat',data);expect(validateMaster('statutory',data).blockers).toEqual([]);
  const resolved=resolveMaster('statutory',[r],data,'2091-02-01');expect(resolved.data.configuration.employee_rate).toBe('7.125');expect(resolved.data.configuration.employer_rate).toBe('9.375');expect(resolved.data.configuration.wage_ceiling).toBe('9876.54');
  expect(resolveMaster('statutory',[r],{scheme:'EPF'},'2091-02-01').error).toBe('STATUTORY_SCOPE_REQUIRED');
  expect(resolveMaster('statutory',[{...r,verification_status:'UNVERIFIED'}],data,'2091-02-01').error).toBe('MISSING_POLICY');
 });
 test.each(['-1','100.001','NaN',7])('reject invalid percentage %s',v=>{const data=statutory();data.configuration.employee_rate=v;expect(validateMaster('statutory',data).valid).toBe(false);});
 test('PT synthetic half-open slab selection including monthly exception and decimal boundaries',()=>{
  const data=pt(),r=resolveMaster('statutory',[published('pt',data)],data,'2091-02-01');
  expect(selectProfessionalTaxSlab(r,2,'9999.99').slab.deduction_amount).toBe('0');
  expect(selectProfessionalTaxSlab(r,2,'10000.00').slab.deduction_amount).toBe('137.00');
  expect(selectProfessionalTaxSlab(r,10,'10000.00').slab.deduction_amount).toBe('93.00');
  for(const mutation of [s=>s[0].upper_bound='10000.01',s=>s.splice(0,1),s=>s[0].deduction_amount='-1']){const bad=pt();mutation(bad.slabs);expect(validateMaster('statutory',bad).valid).toBe(false);}
 });
 test('unresolved rates and unsupported exemptions block publication-readiness',()=>{
  const s=statutory({verification_status:'UNVERIFIED',advisor_name:null,verification_reference:null,verified_on:null});s.configuration.employee_rate=null;s.configuration.conditions='PROFILE_EXEMPTIONS';
  expect(validateMaster('statutory',s).blockers.map(b=>b.code)).toEqual(expect.arrayContaining(['RATE_REQUIRED','ADVISOR_VERIFICATION_REQUIRED','UNSUPPORTED_OR_UNRESOLVED']));
 });
 test('enrolment flags preserved while forged EPF/ESI amounts or rates fail existing pay schema',()=>{
  const pay={employee_id:'d8f353ed-1ac4-4543-a608-bb57e54ef792',pay_basis:'Monthly salary',guaranteed_monthly_gross:1000,epf_enrolment:true,esi_enrolment:true};
  expect(create.body.parse(pay)).toMatchObject({epf_enrolment:true,esi_enrolment:true});for(const field of ['basic_salary','staff_welfare','other_fixed_components','epf_amount','esi_amount','epf_rate','esi_rate','employee_rate','employer_rate'])expect(create.body.safeParse({...pay,[field]:1}).success).toBe(false);
 });
 test('synthetic reference arithmetic uses exact integer fractions; February and October stay distinct',()=>{
  // Test-only reference examples, not a salary calculator or production rounding default.
  const round=(numerator,denominator)=>{const cents=(numerator*100n+denominator/2n)/denominator;return `${cents/100n}.${(cents%100n).toString().padStart(2,'0')}`;};
  expect(round(30000n*2n,30n)).toBe('2000.00');expect(round(30000n*2n,28n)).toBe('2142.86');expect(round(30000n*2n,31n)).toBe('1935.48');
  expect(30000n-30000n*28n/30n).toBe(2000n);expect(30000n-30000n*31n/30n).toBe(-1000n);
  expect(validateMaster('policies',policy()).configuration_warnings).toContainEqual({field:'full_month_unpaid_treatment',code:'UNRESOLVED'});
 });
});
