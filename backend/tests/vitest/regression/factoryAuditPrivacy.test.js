import {beforeAll,test,expect} from 'vitest';
const crypto=require('crypto');const {supabase}=require('../../../src/db/supabase');
const {requireLocalSupabase}=require('../../helpers/requireLocalSupabase');
const {getAuditLog,getRecentActivity}=require('../../../src/controllers/analytics.controller');
const mockRes=require('../../helpers/mockRes');
const marker='Synthetic factory audit privacy '+crypto.randomUUID();
const modules=['HR Factory OT Calculation','HR Factory Attendance Pay','HR Future Private Module'];
beforeAll(async()=>{await requireLocalSupabase();const {error}=await supabase.from('audit_log').insert(modules.map(module_name=>({user_id:'synthetic-privacy-actor',action:'CREATE_REVISION',module_name,record_identifier:marker,new_value:{reason:marker}})));if(error)throw error;});
test.each(modules)('HO cannot retrieve %s through explicit audit searches',async module_name=>{
 const res=mockRes();await getAuditLog({user:{role:'ho'},query:{module_name,record_identifier:marker}},res);
 expect(res.statusCode).toBe(200);expect(res.jsonData.data).toEqual([]);expect(res.jsonData.totalCount).toBe(0);
});
test('Admin retains full audit history and HO recent activity excludes all HR modules',async()=>{
 const admin=mockRes();await getAuditLog({user:{role:'admin'},query:{record_identifier:marker}},admin);
 expect(admin.statusCode).toBe(200);expect(admin.jsonData.data).toHaveLength(3);expect(admin.jsonData.data.every(a=>a.new_value.reason===marker)).toBe(true);
 const ho=mockRes();await getRecentActivity({user:{role:'ho'},query:{}},ho);expect(ho.statusCode).toBe(200);expect(ho.jsonData.activities.every(a=>!a.module_name?.startsWith('HR '))).toBe(true);
});
