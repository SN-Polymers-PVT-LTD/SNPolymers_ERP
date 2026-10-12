import {afterEach,test,expect,vi} from 'vitest';
const {supabase}=require('../../../src/db/supabase');
const {listPayStructures}=require('../../../src/controllers/hrPayStructures.controller');
const mockRes=require('../../helpers/mockRes');
afterEach(()=>vi.restoreAllMocks());
function mockPages(pages){
 let page=0;
 const ranges=[];
 vi.spyOn(supabase,'from').mockImplementation(()=>{
  const b={};for(const method of ['select','in','order'])b[method]=()=>b;
  b.range=(from,to)=>{ranges.push([from,to]);return Promise.resolve(pages[page++]);};return b;
 });return ranges;
}
const employees=count=>Array.from({length:count},(_,i)=>({id:'employee-'+i,employee_code:String(i),pay_structures:[{guaranteed_monthly_gross:30000,epf_enrolment:true}]}));
test('complete directory retains employees and nested pay structures past the PostgREST cap',async()=>{
 const first=employees(1000),last={id:'new-employee',pay_structures:[{id:'new-pay',guaranteed_monthly_gross:100.10}]};
 const ranges=mockPages([{data:first,error:null},{data:[last],error:null}]),res=mockRes();await listPayStructures({},res);
 expect(res.statusCode).toBe(200);expect(res.jsonData.pay_structures).toHaveLength(1001);expect(res.jsonData.pay_structures.at(-1)).toEqual(last);expect(ranges).toEqual([[0,999],[1000,1999]]);
});
test('an exact batch boundary checks the empty next page',async()=>{
 const ranges=mockPages([{data:employees(1000),error:null},{data:[],error:null}]),res=mockRes();await listPayStructures({},res);
 expect(res.jsonData.pay_structures).toHaveLength(1000);expect(ranges).toHaveLength(2);
});
test('a later database error never returns an apparently complete partial directory',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});mockPages([{data:employees(1000),error:null},{data:null,error:{message:'test failure'}}]);const res=mockRes();await listPayStructures({},res);
 expect(res.statusCode).toBe(500);expect(res.jsonData.success).toBe(false);expect(res.jsonData.pay_structures).toBeUndefined();
});
