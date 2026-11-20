import {test,expect} from 'vitest';
const {validateMaster,resolveMaster}=require('../../../src/domain/payrollMasters');
const {policy}=require('../../helpers/payrollMasterFixtures');
test('ongoing policy validates and resolves without an invented upper date',()=>{
 const data=policy({effective_to:null});expect(validateMaster('policies',data).valid).toBe(true);
 expect(resolveMaster('policies',[{id:'ongoing',status:'PUBLISHED',group_code:null,effective_from:data.effective_from,effective_to:null,data}],{group_code:'SNP_PERMANENT'},'2095-01-01').revision_id).toBe('ongoing');
 expect(validateMaster('policies',policy({effective_to:'2089-01-01'})).valid).toBe(false);
});

test('blank end dates from an already open editor normalize to ongoing',()=>{
 const result=validateMaster('policies',policy({effective_to:''}));expect(result.valid).toBe(true);expect(result.data.effective_to).toBeNull();
});
