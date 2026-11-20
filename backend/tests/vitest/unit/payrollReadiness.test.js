import {describe,test,expect} from 'vitest';
const crypto=require('crypto');
const {policy,statutory}=require('../../helpers/payrollMasterFixtures');
const {validateMaster,resolveMaster,calculationReadiness}=require('../../../src/domain/payrollMasters');
const published=(data,extra={})=>({id:crypto.randomUUID(),status:'PUBLISHED',...data,data,...extra});
const full={has_lop:false,partial_month:false,split_run:false,full_month_unpaid:false,weekly_off_leave:false};
const resolvePolicy=data=>resolveMaster('policies',[published(data)],{group_code:'HO_STAFF'},'2091-01-01');
describe('scenario-specific readiness without salary calculation',()=>{
 test('unresolved configuration warns without blocking an unaffected full month',()=>{
  const r=resolvePolicy(policy());expect(r.blockers).toEqual([]);expect(r.configuration_warnings.length).toBeGreaterThan(0);
  expect(calculationReadiness(r,full)).toMatchObject({ready:true,financial_workflows_enabled:false});
  expect(calculationReadiness(r).blockers).toContainEqual({field:'scenario',code:'CALCULATION_CONTEXT_REQUIRED'});
 });
 test.each([['has_lop','rounding.lop'],['partial_month','partial_month_proration_method'],['split_run','split_period_allocation_method'],['weekly_off_leave','leave_weekly_off_method']])('%s requires its independent rule', (flag,field)=>{
  expect(calculationReadiness(resolvePolicy(policy()),{...full,[flag]:true}).blockers).toContainEqual({field,code:'UNRESOLVED'});
 });
 test('full unpaid February/October requires its exception; executable calendar cannot be inferred from evidence text',()=>{
  const r=resolvePolicy(policy());expect(calculationReadiness(r,{...full,has_lop:true,full_month_unpaid:true}).blockers).toContainEqual({field:'full_month_unpaid_treatment',code:'UNRESOLVED'});
  const calendar=resolvePolicy(policy({partial_month_proration_method:'WORK_CALENDAR',work_calendar_reference:'Evidence only'}));
  expect(calculationReadiness(calendar,{...full,partial_month:true}).blockers).toContainEqual({field:'work_calendar_reference',code:'APPROVED_CALENDAR_REQUIRED'});
  expect(calculationReadiness(calendar,full).ready).toBe(true);
 });
 test('typed basis never inherits the legacy aggregate; each scheme retains its reviewed choices',()=>{
  const data=statutory();data.configuration.adjustment_basis={SALARY_ARREARS:'INCLUDE',BONUS:'EXCLUDE',REIMBURSEMENT:'UNRESOLVED',RECOVERY:'DEDUCTION_ONLY'};
  expect(validateMaster('statutory',data).valid).toBe(true);
  const scope_id=crypto.randomUUID(),r=resolveMaster('statutory',[published(data,{statutory_scope_id:scope_id})],{scheme:'EPF',statutory_scope_id:scope_id},'2091-01-01');
  const context={statutory_profile_verified:true,adjustment_types:[]};
  expect(calculationReadiness(r,context).ready).toBe(true);
  expect(calculationReadiness(r,{...context,adjustment_types:['SALARY_ARREARS','BONUS','RECOVERY']}).ready).toBe(true);
  expect(calculationReadiness(r,{...context,adjustment_types:['REIMBURSEMENT']}).ready).toBe(false);
  expect(calculationReadiness(r,{...context,adjustment_types:['ADJUSTMENTS']}).ready).toBe(false);
  data.configuration.included_components.push('ADJUSTMENTS');data.configuration.excluded_components=data.configuration.excluded_components.filter(x=>x!=='ADJUSTMENTS');
  expect(validateMaster('statutory',data).valid).toBe(false);
 });
 test('legacy records stay readable but affected adjustments and missing employee profiles fail closed',()=>{
  const data=statutory(),scope_id=crypto.randomUUID(),r=resolveMaster('statutory',[published(data,{statutory_scope_id:scope_id})],{scheme:'EPF',statutory_scope_id:scope_id},'2091-01-01');
  expect(calculationReadiness(r,{statutory_profile_verified:true,adjustment_types:['BONUS']}).blockers).toContainEqual({field:'adjustment_basis.BONUS',code:'ADJUSTMENT_CLASSIFICATION_REQUIRED'});
  expect(calculationReadiness(r,{adjustment_types:[]}).ready).toBe(false);
  const legacy=resolveMaster('statutory',[published(data)],data,'2091-01-01');
  expect(calculationReadiness(legacy,{statutory_profile_verified:true,adjustment_types:[]}).blockers).toContainEqual({field:'statutory_scope_id',code:'CANONICAL_SCOPE_REQUIRED'});
 });
 test('canonical IDs choose the registered revision despite duplicate display labels',()=>{
  const data=statutory(),id=crypto.randomUUID(),other=crypto.randomUUID(),rows=[published(data,{statutory_scope_id:id}),published(data,{statutory_scope_id:other})];
  expect(resolveMaster('statutory',rows,{scheme:'EPF',statutory_scope_id:id},'2091-01-01').revision_id).toBe(rows[0].id);
  expect(resolveMaster('statutory',rows,data,'2091-01-01').error).toBe('AMBIGUOUS_POLICY');
 });
});
