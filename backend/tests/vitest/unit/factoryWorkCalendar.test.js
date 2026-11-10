import {test,expect} from 'vitest';
const {factory,office,leave}=require('../../helpers/payrollPreviewFixtures');
const {resolveSources}=require('../../../src/domain/payroll/sources');
const {calculatePreview}=require('../../../src/domain/payroll/preview');
const {permanentCalculation}=require('../../../src/domain/payroll/permanent');
function off(source,extra={}){return {id:'calendar',managed:true,is_off:true,holiday:false,status:'PUBLISHED',calendar_date:source.source_from,group_code:source.assignments[0].group_code,department:source.assignments[0].department,day_type:'Weekly Off',compensation_treatment:'UNPAID',...extra};}
test('scheduled day off permits missing attendance without inventing wage earnings',()=>{
 const source=factory();source.attendance=[];source.calendar=[off(source)];expect(resolveSources(source).blockers).toEqual([]);expect(calculatePreview(source).earnings).toEqual([]);
 source.calendar[0].is_off=false;expect(resolveSources(source).blockers.map(b=>b.code)).toContain('MISSING_LOCKED_ATTENDANCE');
});
test('off calendar never hides duplicate, unlocked or wrong-factory attendance or unresolved leave',()=>{
 const source=factory();source.calendar=[off(source)];source.attendance[0].sheet_status='Draft';expect(resolveSources(source).blockers.map(b=>b.code)).toContain('ATTENDANCE_NOT_LOCKED');
 source.attendance=[];source.leave=[leave(source.source_from,source.source_to,{approval_status:'Pending',pay_treatment:null,decided_at:null})];expect(resolveSources(source).blockers.map(b=>b.code)).toContain('UNFINALIZED_LEAVE');expect(resolveSources(source).blockers.map(b=>b.code)).toContain('MISSING_LOCKED_ATTENDANCE');
});
test('casual holiday premium on managed calendars requires an actual holiday and Local never gains holiday pay',()=>{
 const source=factory();source.calendar=[off(source,{is_off:false,day_type:'Scheduled Workday'})];source.attendance[0].holiday_pay_eligible=true;
 expect(calculatePreview(source).blockers.map(b=>b.code)).toContain('APPROVED_HOLIDAY_CALENDAR_REQUIRED');
 source.calendar[0].holiday=true;source.calendar[0].is_off=true;expect(calculatePreview(source).earnings.find(e=>e.code==='HOLIDAY_PREMIUM').amount).toBe('200.00');
 const local=factory('Local Daily-Wage Workers');local.calendar=[off(local,{holiday:true})];local.attendance[0].holiday_pay_eligible=true;expect(calculatePreview(local).blockers.map(b=>b.code)).toContain('LOCAL_HOLIDAY_FORBIDDEN');
});
test('paid off excludes absence but does not erase missing worked hours',()=>{
 const source=office('2091-02-01');source.policies[0].data.leave_weekly_off_method='EXCLUDE_PAID_CALENDAR_DAYS';
 const result=resolveSources(source);const d=result.days[0];d.factory=true;d.attendance={attendance_status:'Present',actual_hours:'4'};d.rule={standard_duty_hours:'8',treatment:{short_hours_method:'MISSING_HOURS'}};d.calendar=[off(source,{compensation_treatment:'PAID'})];
 const short=permanentCalculation(source,result.days);expect(short.deductions.find(e=>e.code==='LOP').amount).toBe('500.00');
 d.attendance.attendance_status='Absent';const absent=permanentCalculation(source,result.days);expect(absent.deductions.filter(e=>e.code==='LOP').every(e=>e.amount==='0.00')).toBe(true);
});
