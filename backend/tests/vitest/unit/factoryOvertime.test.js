import {describe,test,expect} from 'vitest';
const {factoryDay}=require('../../../src/domain/payroll/factory');
const {calculatePreview}=require('../../../src/domain/payroll/preview');
const {office}=require('../../helpers/payrollPreviewFixtures');
const {fingerprint}=require('../../../src/domain/payroll/sources');
function day(extra={}){
 return {date:'2091-02-02',assignment:{employee_category:'SNP Permanent Factory Labour'},leave:[],
 attendance:{id:'attendance',sheet_status:'Locked',pay_rule_revision_id:'rule',attendance_status:'Present',actual_hours:'10',ot_hours:'2',entry_timestamp:'2091-02-02T00:00:00Z',exit_timestamp:'2091-02-02T10:00:00Z'},
 rule:{id:'rule',standard_duty_hours:'8',ot_enabled:true,ot_method:'Salary-derived hourly',ot_multiplier:'1',calculation:{id:'config',wage_basis:'MONTHLY_GROSS',salary_days:'26',rounding_convention:'DAILY_HOURLY_AMOUNT_2DP_HALF_UP'}},
 pay:{id:'pay',status:'Active',guaranteed_monthly_gross:'10000.00'},pay_applicability:{id:'applicability'},...extra};
}
describe('approved factory overtime arithmetic',()=>{
 test.each([['1','96.16'],['1.5','144.24'],['2','192.32']])('permanent document example at %sx',(multiplier,amount)=>{
 const d=day();d.rule.ot_multiplier=multiplier;const r=factoryDay(d,true);expect(r.blockers).toEqual([]);expect(r.lines[0].amount).toBe(amount);
 expect(r.lines[0].calculation.daily_rate).toBe('384.62');expect(r.lines[0].source_ids).toEqual(['attendance','rule','pay','applicability','config']);
 });
 test('24h and fractional overtime use approved hourly and amount rounding',()=>{
 const d=day();d.attendance.actual_hours='24';d.attendance.ot_hours='16';expect(factoryDay(d,true).lines[0].amount).toBe('769.28');
 d.attendance.ot_hours='0.3333';expect(factoryDay(d,true).lines[0].amount).toBe('16.03');
 });
 test.each([d=>d.rule.calculation=null,d=>d.rule.calculation.salary_days='0',d=>d.pay=null,d=>d.pay.status='Suspended',d=>d.pay_applicability=null,d=>d.rule.calculation.wage_basis='DAILY_WAGE'])('missing/invalid setup blocks without fabricated money (%#)',mutate=>{
 const d=day();mutate(d);const r=factoryDay(d,true);expect(r.lines).toEqual([]);expect(r.blockers.length).toBeGreaterThan(0);
 });
 test('disabled and zero OT do not require calculation setup',()=>{
 const d=day();d.rule.calculation=null;d.attendance.ot_hours='0';expect(factoryDay(d,true)).toEqual({lines:[],blockers:[]});
 d.attendance.ot_hours='2';d.rule.ot_enabled=false;expect(factoryDay(d,true)).toEqual({lines:[],blockers:[]});
 });
 test('local document rounding and legacy fixed hourly behavior',()=>{
 const d=day();d.assignment.employee_category='Local Daily-Wage Workers';d.attendance.actual_hours='14';d.attendance.duty_type='Single Duty';d.attendance.wage_revision_id='wage';d.wage={id:'wage',daily_wage:'350.00'};
 Object.assign(d.rule,{standard_duty_hours:'12',ot_method:'Derived from daily wage',calculation:{...d.rule.calculation,wage_basis:'DAILY_WAGE',salary_days:null}});
 expect(factoryDay(d,false).lines.map(l=>l.amount)).toEqual(['350.00','58.34']);d.rule.ot_method='Fixed Hourly';d.rule.ot_rate='29.17';d.rule.calculation=null;
 expect(factoryDay(d,false).lines.map(l=>l.amount)).toEqual(['350.00','58.34']);
 });
 test.each(['SNP Permanent Factory Labour','Fabric Factory Permanent Employees'])('%s uses dated gross, independent of the LOP divisor',category=>{
 const s=office('2091-02-01');Object.assign(s.assignments[0],{employee_category:category,department:category.startsWith('SNP')?'SNP Factory':'Fabric Factory'});
 s.policies[0].data.lop_fixed_divisor='30';s.pay_structures[0].guaranteed_monthly_gross='10000.00';s.factory_rules=[{...day().rule,employee_category:category,effective_from:'2090-01-01'}];
 s.attendance=Array.from({length:28},(_,i)=>{const date=`2091-02-${String(i+1).padStart(2,'0')}`;return {...day().attendance,id:'a'+i,attendance_date:date,employee_category:category,department:s.assignments[0].department,entry_timestamp:date+'T00:00:00Z',exit_timestamp:date+'T10:00:00Z'};});
 const before=fingerprint(s);let r=calculatePreview(s);expect(r.earnings.filter(l=>l.code==='OVERTIME')).toHaveLength(28);expect(r.earnings.find(l=>l.code==='OVERTIME').amount).toBe('96.16');
 s.pay_structures.push({...s.pay_structures[0],id:'pay2',guaranteed_monthly_gross:'20000.00'});s.pay_applicability[0].effective_to='2091-02-14';s.pay_applicability.push({...s.pay_applicability[0],id:'app2',pay_structure_id:'pay2',effective_from:'2091-02-15',effective_to:null});
 r=calculatePreview(s);expect(r.earnings.find(l=>l.code==='OVERTIME'&&l.date==='2091-02-15').amount).toBe('192.30');expect(fingerprint(s)).not.toBe(before);
 const changed=fingerprint(s);s.factory_rules[0].calculation.salary_days='30';expect(fingerprint(s)).not.toBe(changed);
 });
});
