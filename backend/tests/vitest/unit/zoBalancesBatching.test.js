import {test,expect,vi,afterEach} from 'vitest';
const {supabase}=require('../../../src/db/supabase');
const {getZonalBalances}=require('../../../src/controllers/zoBalances.controller');
const mockRes=require('../../helpers/mockRes');
afterEach(()=>vi.restoreAllMocks());
function mockDatabase(failingBatch=false){
 const ids=Array.from({length:2501},(_,i)=>`synthetic-zo-${String(i).padStart(5,'0')}`),batches=[],filters=[];
 vi.spyOn(supabase,'from').mockImplementation(table=>{
  let selected=[];const chain={select:()=>chain,not:()=>chain,eq:(key,value)=>{if(table==='authorised_users')filters.push([key,value]);return chain;},in:(key,values)=>{selected=values;batches.push(values);return chain;},then:(resolve,reject)=>{
   let result={data:[]};
   if(table==='projects_master')result.data=ids.map(zo_user_id=>({zo_user_id}));
   if(table==='zo_balances')result.data=[{zo_user_id:ids[0],available_balance:'123.45'}];
   if(table==='authorised_users')result=failingBatch&&batches.length===2?{error:{message:'Synthetic batch failure'}}:{data:selected.map(mobile_number=>({mobile_number,display_name:mobile_number})).reverse()};
   return Promise.resolve(result).then(resolve,reject);
  }};return chain;
 });return{ids,batches,filters};
}
test('large mapped rosters use bounded URLs, preserve all users and globally sort results',async()=>{
 const {ids,batches,filters}=mockDatabase();const res=mockRes();await getZonalBalances({user:{role:'ho'},query:{}},res);
 expect(res.statusCode).toBe(200);expect(res.jsonData.balances).toHaveLength(ids.length);
 expect(batches).toHaveLength(26);expect(batches.every(b=>b.length<=100)).toBe(true);
 expect(filters.filter(([k,v])=>k==='role'&&v==='zo')).toHaveLength(26);expect(filters.filter(([k,v])=>k==='is_active'&&v===true)).toHaveLength(26);
 expect(res.jsonData.balances.map(b=>b.zo_user_id)).toEqual(ids);
 expect(res.jsonData.balances[0].available_balance).toBe(123.45);expect(res.jsonData.balances.at(-1).available_balance).toBe(0);
});
test('a failed lookup batch returns an error instead of a partial balance list',async()=>{
 mockDatabase(true);vi.spyOn(console,'error').mockImplementation(()=>{});const res=mockRes();await getZonalBalances({user:{role:'admin'},query:{}},res);
 expect(res.statusCode).toBe(500);expect(res.jsonData.success).toBe(false);expect(res.jsonData.balances).toBeUndefined();
});
