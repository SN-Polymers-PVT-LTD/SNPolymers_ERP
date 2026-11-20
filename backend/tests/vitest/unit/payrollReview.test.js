import {describe,test,expect} from 'vitest';
const {availableActions,previewChanges}=require('../../../src/domain/payroll/review');
const schema=require('../../../src/validation/payrollReview.schema');
const {calculatePreview}=require('../../../src/domain/payroll/preview');
const {office}=require('../../helpers/payrollPreviewFixtures');
const id='898b8514-b50e-4c7a-97c5-d4f267cafbc2';
describe('employee review contracts',()=>{
 test('factory and office creators have different submission paths, independent reviewers only',()=>{
  const row={status:'CALCULATED',created_by:'creator',submitted_by:'creator'};
  expect(availableActions(row,'factory_manager','creator',true)).toContain('submit');
  expect(availableActions(row,'accounts','creator',false)).toContain('submit');expect(availableActions(row,'accounts','creator',true)).toEqual([]);
  row.status='PENDING_ACCOUNTS_REVIEW';expect(availableActions(row,'accounts','reviewer',true)).toEqual(['forward','return']);expect(availableActions(row,'accounts','creator',true)).toEqual([]);
  row.status='PENDING_HO_APPROVAL';row.accounts_verified_by='accounts';expect(availableActions(row,'ho','ho',true)).toEqual(['approve_lock','return']);expect(availableActions(row,'admin','accounts',true)).toEqual([]);expect(availableActions(row,'ho','creator',true)).toEqual([]);
  expect(availableActions({...row,employee_self:true},'ho','ho',true)).toEqual([]);
 });
 test.each(['LOCKED','CANCELLED_DRAFT'])('%s has no modification or review controls',status=>{for(const role of ['admin','ho','accounts','factory_manager'])expect(availableActions({status,created_by:id},role,id,true)).toEqual([]);});
 test('strict requests forbid client calculations, overrides, unsupported rejection and missing reasons/tokens',()=>{
  const base={expected_version:1,expected_review_version:0};expect(schema.action.body.safeParse({...base,action:'calculate',reason:'Source review'}).success).toBe(true);
  for(const extra of [{action:'calculate',reason:''},{action:'return'},{action:'submit'},{action:'reject',reason:'No policy'},{action:'calculate',reason:'Test',calculation:{}},{action:'calculate',reason:'Test',actor_id:id},{action:'correct',reason:'Test',note:'Test',salary:'1'}])expect(schema.action.body.safeParse({...base,...extra}).success).toBe(false);
  expect(schema.bulk.body.safeParse({actions:Array.from({length:51},()=>({row_id:id,request:{...base,action:'cancel',reason:'Test'}}))}).success).toBe(false);
 });
 test('revision comparisons report changed earnings, sources and blockers without inventing approval',()=>{
  const before={earnings:[{amount:'100.00'}],deductions:[],gross_after_lop:'100.00',source_references:{pay:['old']},blockers:[]},after={...before,earnings:[{amount:'110.00'}],source_references:{pay:['new']},blockers:[{code:'PROFILE_REQUIRED'}]};
  expect(previewChanges(before,after).map(c=>c.field)).toEqual(['earnings','source_references','blockers']);expect(previewChanges(null,after)).toEqual([]);expect(previewChanges(after,after)).toEqual([]);
 });
 test('cancelled drafts do not double-count monthly entitlement in the reused engine',()=>{
  const source=office();source.month_rows.push({...source.month_rows[0],id:'cancelled',status:'CANCELLED_DRAFT'});const result=calculatePreview(source);expect(result.gross_after_lop).toBe('30000.00');expect(result.blockers.map(b=>b.code)).not.toContain('OVERLAPPING_PAYROLL_PERIODS');expect(result.monthly_reconciliation[0].allocations).toHaveLength(1);
 });
});
