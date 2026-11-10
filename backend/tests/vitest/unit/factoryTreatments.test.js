import {describe,test,expect} from 'vitest';
const {calculatePreview}=require('../../../src/domain/payroll/preview');
const {factoryDay}=require('../../../src/domain/payroll/factory');
const {factory,office,leave}=require('../../helpers/payrollPreviewFixtures');
const treatment={id:'treatment',holiday_salary_days:'26',short_hours_method:'MISSING_HOURS',management_stoppage_method:'RETAIN_NORMAL_PAY',holiday_method:'TOTAL_DAILY_ENTITLEMENT'};
function permanent(){
 const s=office('2091-02-01');s.pay_structures[0].guaranteed_monthly_gross='10000.00';Object.assign(s.assignments[0],{group_code:'SNP_PERMANENT',employee_category:'SNP Permanent Factory Labour',department:'SNP Factory'});
 s.policies[0].data.lop_fixed_divisor='30';s.policies[0].data.leave_weekly_off_method='EXCLUDE_PAID_CALENDAR_DAYS';
 s.factory_rules=[{id:'rule',employee_category:s.assignments[0].employee_category,effective_from:'2090-01-01',standard_duty_hours:'8',ot_enabled:false,holiday_pay_enabled:true,holiday_multiplier:'1.5',treatment}];
 s.attendance=Array.from({length:28},(_,i)=>{const date=`2091-02-${String(i+1).padStart(2,'0')}`;return {id:'a'+i,sheet_status:'Locked',attendance_date:date,employee_category:s.assignments[0].employee_category,department:'SNP Factory',pay_rule_revision_id:'rule',attendance_status:'Present',actual_hours:'8',ot_hours:'0',entry_timestamp:date+'T08:00:00Z',exit_timestamp:date+'T16:00:00Z'};});
 s.calendar=s.attendance.map(a=>({id:'c'+a.id,calendar_date:a.attendance_date,group_code:'SNP_PERMANENT',department:'SNP Factory',status:'PUBLISHED',day_type:'Working Day',compensation_treatment:'UNPAID'}));return s;
}
describe('confirmed factory attendance pay decisions',()=>{
 test('permanent short day charges only missing hours through published LOP, independent of OT days',()=>{
 const s=permanent();s.attendance[0].actual_hours='4';s.attendance[0].exit_timestamp='2091-02-01T12:00:00Z';const r=calculatePreview(s);
 expect(r.deductions.find(l=>l.code==='LOP').amount).toBe('166.67');expect(r.gross_after_lop).toBe('9833.33');expect(r.deductions[0].source_ids).toContain('treatment');
 });
 test('a whole month of partial worked days does not become the zero-entitlement exception',()=>{
 const s=permanent();s.policies[0].data.full_month_unpaid_treatment='NO_PAYABLE_ENTITLEMENT_ZERO';s.attendance.forEach(a=>a.actual_hours='4');const r=calculatePreview(s);
 expect(r.monthly_reconciliation[0].full_month_zero_exception).toBe(false);expect(r.deductions.find(l=>l.code==='LOP').amount).toBe('4666.67');
 });
 test('permanent management stoppage retains salary, with no extra daily wage or LOP',()=>{
 const s=permanent();Object.assign(s.attendance[0],{attendance_status:'Management Issue',actual_hours:'0',entry_timestamp:null,exit_timestamp:null});const r=calculatePreview(s);expect(r.gross_after_lop).toBe('10000.00');expect(r.deductions).toEqual([]);
 });
 test('permanent 1.5x holiday adds only 0.5x of the explicit daily basis',()=>{
 const s=permanent();s.attendance[0].holiday_pay_eligible=true;Object.assign(s.calendar[0],{day_type:'Paid Holiday',compensation_treatment:'PAID'});const r=calculatePreview(s);
 expect(r.earnings.find(l=>l.code==='HOLIDAY_PREMIUM').amount).toBe('192.31');expect(r.gross_after_lop).toBe('10192.31');
 s.calendar=[];expect(calculatePreview(s).blockers.map(b=>b.code)).toContain('APPROVED_HOLIDAY_CALENDAR_REQUIRED');
 });
 test.each(['SNP Casual Factory Labour','Fabric Factory Casual Factory Labour'])('%s short days pay worked hours; management stoppage pays full daily wage',category=>{
 const s=factory(category,category.startsWith('SNP')?'SNP Factory':'Fabric Factory');s.factory_rules[0].treatment=treatment;s.attendance[0].actual_hours='4';expect(calculatePreview(s).gross_after_lop).toBe('200.00');
 Object.assign(s.attendance[0],{attendance_status:'Management Issue',actual_hours:'0',entry_timestamp:null,exit_timestamp:null});expect(calculatePreview(s).gross_after_lop).toBe('400.00');
 });
 test('local double duty remains 2x, short double duty is proportional and beyond 24h is a warning',()=>{
 const s=factory('Local Daily-Wage Workers');s.factory_rules[0].treatment=treatment;Object.assign(s.attendance[0],{duty_type:'Double Duty',actual_hours:'24'});expect(calculatePreview(s).gross_after_lop).toBe('800.00');
 s.attendance[0].actual_hours='18';expect(calculatePreview(s).gross_after_lop).toBe('600.00');s.attendance[0].actual_hours='25';const r=calculatePreview(s);expect(r.gross_after_lop).toBe('800.00');expect(r.configuration_warnings.map(w=>w.code)).toContain('UNUSUAL_LOCAL_DUTY_DURATION');
 });
 test('HO-approved Paid medical leave pays without a certificate; local paid leave stays forbidden',()=>{
 const s=factory();s.factory_rules[0].treatment=treatment;const a=s.attendance[0];Object.assign(a,{attendance_status:'Medical Leave',actual_hours:'0',entry_timestamp:null,exit_timestamp:null,leave_request_id:'medical'});
 s.leave=[leave(a.attendance_date,a.attendance_date,{id:'medical',pay_treatment:'Paid',leave_type:'Medical Leave'})];
 expect(calculatePreview(s).gross_after_lop).toBe('400.00');expect(calculatePreview(s).blockers.map(b=>b.code)).not.toContain('MEDICAL_DOCUMENT_REQUIRED');
 s.attendance[0].employee_category='Local Daily-Wage Workers';s.assignments[0].employee_category='Local Daily-Wage Workers';s.factory_rules[0].employee_category='Local Daily-Wage Workers';s.wages[0].employee_category='Local Daily-Wage Workers';expect(calculatePreview(s).blockers.map(b=>b.code)).toContain('LOCAL_PAID_LEAVE_FORBIDDEN');
 });
 test('permanent medical leave follows HO treatment without certificates or duplicated deductions',()=>{
 const s=permanent(),a=s.attendance[0];Object.assign(a,{attendance_status:'Medical Leave',actual_hours:'0',entry_timestamp:null,exit_timestamp:null,leave_request_id:'medical'});
 s.leave=[leave(a.attendance_date,a.attendance_date,{id:'medical',pay_treatment:'Paid',leave_type:'Medical Leave'})];
 expect(calculatePreview(s).gross_after_lop).toBe('10000.00');expect(calculatePreview(s).deductions).toEqual([]);
 s.leave[0].pay_treatment='Unpaid';expect(calculatePreview(s).deductions.find(l=>l.code==='LOP').amount).toBe('333.33');
 s.leave[0].approval_status='Rejected';expect(calculatePreview(s).gross_after_lop).toBe('9666.67');
 s.leave[0].approval_status='Pending';expect(calculatePreview(s).gross_after_lop).toBeNull();
 });

});

test('legacy locked Local attendance retains its recorded shared rate after factory adoption',()=>{
 const s=factory('Local Daily-Wage Workers');s.attendance[0].master_scope_version=0;
 s.factory_rules[0].department=null;s.wages[0].department=null;
 s.wages.push({...s.wages[0],id:'new-snp',department:'SNP Factory',daily_wage:'900.00'});
 s.wages.push({...s.wages[0],id:'new-fabric',department:'Fabric Factory',daily_wage:'1200.00'});
 expect(calculatePreview(s).gross_after_lop).toBe('400.00');
});
test('factory scoped Local snapshots reject another factory revision',()=>{
 const s=factory('Local Daily-Wage Workers');s.attendance[0].master_scope_version=1;
 s.factory_rules[0].department='Fabric Factory';s.wages[0].department='Fabric Factory';
 const r=calculatePreview(s);expect(r.gross_after_lop).toBeNull();expect(r.blockers.map(b=>b.code)).toContain('MISSING_OR_OUTDATED_WAGE');
});
