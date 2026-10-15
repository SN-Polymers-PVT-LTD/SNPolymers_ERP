import {describe,test,expect} from 'vitest';
const {office,factory,leave,rounded}=require('../../helpers/payrollPreviewFixtures');
const {calculatePreview}=require('../../../src/domain/payroll/preview');const {fingerprint}=require('../../../src/domain/payroll/sources');const D=require('../../../src/domain/payroll/exact');
const codes=r=>r.blockers.map(b=>b.code);
function policyEdit(s,extra){Object.assign(s.policies[0],extra);Object.assign(s.policies[0].data,extra);}
describe('exact monetary arithmetic',()=>{
 test('repeating fractions and all approved rounding directions preserve cents and tie parity',()=>{
  const third=D.div(D.decimal('1'),D.decimal('3'));expect(D.format(third)).toBeNull();expect(D.format(D.add(D.add(third,third),third))).toBe('1.00');
  for(const [method,value] of [['HALF_UP','1.01'],['HALF_EVEN','1.00'],['DOWN','1.00'],['UP','1.01']])expect(D.amount(D.decimal('1.005'),{...rounded,method})).toBe(value);
  expect(()=>D.decimal(0.1)).toThrow('EXACT_DECIMAL_REQUIRED');expect(()=>D.round(third,{method:'UNRESOLVED'})).toThrow('ROUNDING_POLICY_REQUIRED');
 });
});
describe('permanent salary previews / POL cases',()=>{
 test.each(['2091-02-01','2091-10-01','2092-02-01'])('POL-001/002 full %s pays one monthly gross, missing statute means no final net',start=>{
  const r=calculatePreview(office(start));expect(r.gross_after_lop).toBe('30000.00');expect(r.final_net_salary).toBeNull();expect(r.deductions).toEqual([]);expect(r.status).toBe('BLOCKED_STATUTORY');expect(r.financial_workflows_enabled).toBe(false);
 });
 test.each([['2091-02-01','2091-02-05','FIXED_DIVISOR','2000.00'],['2091-10-01','2091-10-02','FIXED_DIVISOR','2000.00'],['2091-02-01','2091-02-05','ACTUAL_CALENDAR_DAYS','2142.86'],['2091-10-01','2091-10-02','ACTUAL_CALENDAR_DAYS','1935.48']])('POL-003..006 %s %s %s has independent LOP', (start,from,method,amount)=>{
  const s=office(start);s.leave=[leave(from,from.slice(0,8)+String(Number(from.slice(8))+1).padStart(2,'0'))];policyEdit(s,{lop_method:method,lop_fixed_divisor:method==='FIXED_DIVISOR'?'30':null});const r=calculatePreview(s);expect(r.deductions[0].amount).toBe(amount);expect(r.status).toBe('BLOCKED_STATUTORY');
 });
 test('paid leave and no sandwich: isolated Friday/Monday evidence deducts only those dates',()=>{
  const s=office();s.leave=[leave('2091-02-02','2091-02-02',{pay_treatment:'Paid'}),leave('2091-02-09'),leave('2091-02-12')];
  const r=calculatePreview(s);expect(r.deductions[0].chargeable_dates).toEqual(['2091-02-09','2091-02-12']);expect(r.deductions[0].amount).toBe('2000.00');
 });
 test('overlapping rejected/approved leave is blocked and never deducted twice',()=>{
  const s=office();s.leave=[leave('2091-02-05'),leave('2091-02-05','2091-02-05',{id:'rejected',approval_status:'Rejected'})];const r=calculatePreview(s);expect(codes(r)).toContain('OVERLAPPING_LEAVE');expect(r.deductions[0].amount).toBe('1000.00');expect(r.gross_after_lop).toBeNull();
 });
 test.each([['2091-02-01','2000.00'],['2091-10-01','-1000.00']])('POL-007/008 full unpaid %s reports the anomaly and blocks without clamping', (start,candidate)=>{
  const s=office(start);s.leave=[leave(s.source_from,s.source_to)];const r=calculatePreview(s);expect(codes(r)).toContain('UNRESOLVED');expect(r.gross_after_lop).toBeNull();expect(r.monthly_reconciliation[0].candidate_gross_after_literal_lop).toBe(candidate);
 });
 test('pending leave, explicit Sunday, missing policy and unresolved rounding fail closed',()=>{
  for(const mutate of [s=>s.leave=[leave('2091-02-05','2091-02-05',{approval_status:'Pending',decided_at:null})],s=>s.leave=[leave('2091-02-04')],s=>s.policies=[],s=>{s.leave=[leave('2091-02-05')];policyEdit(s,{rounding:{...s.policies[0].data.rounding,lop:{method:'UNRESOLVED',precision:null,stage:'UNRESOLVED'}}});}]){const s=office();mutate(s);expect(calculatePreview(s).gross_after_lop).toBeNull();}
 });
 test('join/exit, special packages and dated salary changes remain explicit blocked scenarios',()=>{
  const join=office();join.assignments[0].employment_joined_on='2091-02-16';join.assignments[0].effective_from='2091-02-16';expect(codes(calculatePreview(join))).toContain('PRORATION_DAY_CLASSIFICATION_REQUIRED');
  const pkg=office();pkg.pay_structures[0].pay_basis='Special package';expect(codes(calculatePreview(pkg))).toContain('SPECIAL_PACKAGE_PERIOD_REQUIRED');expect(calculatePreview(pkg).gross_after_lop).toBeNull();
  const change=office();change.pay_applicability[0].effective_to='2091-02-15';change.pay_applicability.push({...change.pay_applicability[0],id:'next_app',pay_structure_id:'next',effective_from:'2091-02-16',effective_to:null});change.pay_structures.push({...change.pay_structures[0],id:'next',guaranteed_monthly_gross:'36000.00'});change.leave=[leave('2091-02-05'),leave('2091-02-20')];const r=calculatePreview(change);expect(codes(r)).toContain('SALARY_CHANGE_PRORATION_REQUIRED');expect(r.deductions[0].amount).toBe('2200.00');expect(r.monthly_reconciliation[0].salary_segments.map(d=>d.monthly_gross)).toEqual(['30000.00','36000.00']);
 });
 test('POL-009/010 an approved complete split preserves one entitlement and final residual; incomplete/overlapping plans block',()=>{
  const s=office('2091-10-01');policyEdit(s,{split_period_allocation_method:'CALENDAR_WEIGHTED_WITH_RESIDUAL'});s.row.period_to='2091-10-15';s.month_rows[0].period_to=s.row.period_to;s.month_rows.push({...s.month_rows[0],id:'second',period_from:'2091-10-16',period_to:'2091-10-31'});
  const r=calculatePreview(s);expect(r.earnings[0].amount).toBe('14516.13');expect(r.monthly_reconciliation[0].allocations.map(a=>a.amount)).toEqual(['14516.13','15483.87']);expect(r.monthly_reconciliation[0].unallocated_entitlement).toBe('0.00');
  const incomplete=structuredClone(s);incomplete.month_rows.pop();expect(codes(calculatePreview(incomplete))).toContain('MONTH_ALLOCATION_INCOMPLETE');
  s.month_rows[1].period_from='2091-10-15';expect(codes(calculatePreview(s))).toContain('OVERLAPPING_PAYROLL_PERIODS');
 });
 test('source fingerprints change with pay history, note version, leave decisions, policy or another run',()=>{
  const s=office(),before=fingerprint(s);expect(fingerprint({...s})).toBe(before);
  for(const mutate of [s=>s.row.current_version++,s=>s.history[1].version++,s=>s.leave.push(leave('2091-02-05')),s=>s.policies[0].data.lop_fixed_divisor='31',s=>s.month_rows[0].version++]){const next=structuredClone(s);mutate(next);expect(fingerprint(next)).not.toBe(before);}
 });
 test('historical identity stays eligible after present-day status changes; source revision mismatch is explicit',()=>{
  const s=office();s.employee.active_status='Exited';expect(calculatePreview(s).gross_after_lop).toBe('30000.00');s.draft_snapshot.pay_history_revision_id='old';expect(codes(calculatePreview(s))).toContain('PAY_HISTORY_OUTDATED');
 });
});
describe('factory SNP/Fabric Casual and Local',()=>{
 test.each([['SNP Casual Factory Labour','SNP Factory'],['Fabric Factory Casual Factory Labour','Fabric Factory']])('%s holiday is 1.5 total, OT is independent and wage revisions stay dated', (category,department)=>{
  const s=factory(category,department);s.attendance[0].holiday_pay_eligible=true;s.attendance[0].actual_hours='10';s.attendance[0].ot_hours='2';s.attendance[0].exit_timestamp='2091-02-02T10:00:00Z';const r=calculatePreview(s);expect(r.earnings.map(l=>l.amount)).toEqual(['400.00','200.00','100.00']);expect(r.gross_after_lop).toBe('700.00');
 });
 test.each(['SNP Factory','Fabric Factory'])('Local %s Double Duty is 2x, never extra OT or holiday',department=>{
  const s=factory('Local Daily-Wage Workers',department);s.attendance[0].duty_type='Double Duty';s.attendance[0].actual_hours='24';s.attendance[0].exit_timestamp='2091-02-03T00:00:00Z';expect(calculatePreview(s).earnings.map(l=>l.code)).toEqual(['DOUBLE_DUTY']);expect(calculatePreview(s).gross_after_lop).toBe('800.00');
  s.attendance[0].ot_hours='12';s.attendance[0].holiday_pay_eligible=true;expect(codes(calculatePreview(s))).toEqual(expect.arrayContaining(['DOUBLE_DUTY_OT_CONFLICT','LOCAL_HOLIDAY_FORBIDDEN']));expect(calculatePreview(s).gross_after_lop).toBeNull();
 });
 test('Local single duty OT and daily-wage-derived OT use effective standard hours and multiplier',()=>{
  const s=factory('Local Daily-Wage Workers');s.attendance[0].actual_hours='15';s.attendance[0].ot_hours='3';s.attendance[0].exit_timestamp='2091-02-02T15:00:00Z';s.factory_rules[0].ot_method='Derived from daily wage';s.factory_rules[0].ot_rate=null;s.factory_rules[0].ot_multiplier='1.5';expect(calculatePreview(s).gross_after_lop).toBe('550.00');
  s.attendance[0].ot_hours='1';s.factory_rules[0].ot_multiplier='1';expect(codes(calculatePreview(s))).toContain('FACTORY_ROUNDING_POLICY_REQUIRED');
 });
 test('absence is zero earned units, with no second LOP deduction',()=>{const s=factory();Object.assign(s.attendance[0],{attendance_status:'Absent',actual_hours:'0',entry_timestamp:null,exit_timestamp:null});const r=calculatePreview(s);expect(r.gross_after_lop).toBe('0.00');expect(r.deductions).toEqual([]);});
 test('missing/unlocked/null-factory/duplicated facts and stale masters block',()=>{
  for(const mutate of [s=>s.attendance=[],s=>s.attendance[0].sheet_status='Submitted',s=>s.attendance[0].department=null,s=>s.attendance.push({...s.attendance[0],id:'duplicate'}),s=>s.wages.push({...s.wages[0],id:'later',effective_from:'2091-02-01'})]){const s=factory();mutate(s);expect(calculatePreview(s).gross_after_lop).toBeNull();}
 });
 test('short hours, management stoppage, paid Casual leave and CO payouts require structured approved rules',()=>{
  for(const mutate of [s=>s.attendance[0].actual_hours='4',s=>s.attendance[0].attendance_status='Management Issue',s=>{s.attendance[0].attendance_status='Paid Leave';s.attendance[0].leave_request_id='paid';s.leave=[leave('2091-02-02','2091-02-02',{id:'paid',pay_treatment:'Paid'})];},s=>{s.attendance[0].attendance_status='Compensatory Off';s.attendance[0].entry_timestamp=null;s.attendance[0].exit_timestamp=null;}]){const s=factory();mutate(s);expect(calculatePreview(s).gross_after_lop).toBeNull();}
 });
 test('overnight duty belongs to its start date and overlapping next-day duty is blocked',()=>{
  const s=factory();s.attendance[0].actual_hours='24';s.attendance[0].ot_hours='16';s.attendance[0].exit_timestamp='2091-02-03T00:00:00Z';expect(calculatePreview(s).gross_after_lop).toBe('1200.00');s.attendance.push({...s.attendance[0],id:'overlap',attendance_date:'2091-02-01'});expect(codes(calculatePreview(s))).toContain('OVERLAPPING_DUTY_TIMESTAMPS');
 });
});

describe('extended source/period safeguards',()=>{
 test('daily wage changes apply only to their actual Locked attendance dates',()=>{
  const s=factory();s.source_to='2091-02-03';s.row.period_to=s.source_to;s.month_rows[0].period_to=s.source_to;
  s.wages.push({...s.wages[0],id:'next-wage',effective_from:'2091-02-03',daily_wage:'450.00'});
  s.attendance.push({...s.attendance[0],id:'second-duty',attendance_date:'2091-02-03',wage_revision_id:'next-wage',entry_timestamp:'2091-02-03T00:00:00Z',exit_timestamp:'2091-02-03T08:00:00Z'});
  const r=calculatePreview(s);expect(r.gross_after_lop).toBe('850.00');expect(r.earnings.map(l=>l.source_ids.at(-1))).toEqual(['wage','next-wage']);
 });
 test('POL-016 cross-month leave uses each calendar-month divisor without sandwich dates',()=>{
  const s=office('2091-10-01');s.source_to='2091-11-30';s.row.period_to=s.source_to;s.month_rows[0].period_to=s.source_to;
  policyEdit(s,{lop_method:'ACTUAL_CALENDAR_DAYS',lop_fixed_divisor:null});s.leave=[leave('2091-10-31','2091-11-01')];
  const r=calculatePreview(s);expect(r.deductions.map(l=>l.amount)).toEqual(['967.74','1000.00']);expect(r.monthly_reconciliation.map(m=>m.contractual_entitlement)).toEqual(['30000.00','30000.00']);
 });
 test('permanent CO uses prior 24-hour evidence, remains in guaranteed gross, and earns no extra rest wage',()=>{
  const s=office(),base=factory('SNP Permanent Factory Labour');s.run.group_code='SNP_PERMANENT';s.run.department='SNP Factory';Object.assign(s.assignments[0],{employee_category:'SNP Permanent Factory Labour',group_code:'SNP_PERMANENT',department:'SNP Factory'});s.month_rows[0].group_code='SNP_PERMANENT';s.factory_rules=base.factory_rules;
  s.attendance=require('../../../src/domain/payroll/sources').dates(s.source_from,s.source_to).map(date=>({...base.attendance[0],id:'duty_'+date,attendance_date:date,wage_revision_id:null,entry_timestamp:date+'T00:00:00Z',exit_timestamp:date+'T08:00:00Z'}));
  const prior=s.attendance.find(d=>d.attendance_date==='2091-02-02');Object.assign(prior,{actual_hours:'24',ot_hours:'16',exit_timestamp:'2091-02-03T00:00:00Z'});
  const rest=s.attendance.find(d=>d.attendance_date==='2091-02-03');Object.assign(rest,{attendance_status:'Compensatory Off',actual_hours:'0',ot_hours:'0',entry_timestamp:null,exit_timestamp:null});
  const r=calculatePreview(s);expect(r.gross_after_lop).toBe('30800.00');expect(r.deductions).toEqual([]);expect(r.earnings.filter(l=>l.date==='2091-02-03')).toEqual([]);
  prior.sheet_status='Submitted';expect(codes(calculatePreview(s))).toContain('COMP_OFF_EVIDENCE_REQUIRED');
 });
 test('approved split allocates documented LOP once and its month sum matches the contractual entitlement',()=>{
  const s=office('2091-10-01');policyEdit(s,{split_period_allocation_method:'CALENDAR_WEIGHTED_WITH_RESIDUAL'});s.row.period_to='2091-10-15';s.month_rows[0].period_to=s.row.period_to;s.month_rows.push({...s.month_rows[0],id:'second',period_from:'2091-10-16',period_to:'2091-10-31'});s.leave=[leave('2091-10-02'),leave('2091-10-22')];
  const first=calculatePreview(s);s.row.id='second';s.row.period_from='2091-10-16';s.row.period_to='2091-10-31';const second=calculatePreview(s);
  expect(first.deductions[0].amount).toBe('1000.00');expect(second.deductions[0].amount).toBe('1000.00');expect(D.format(D.add(D.decimal(first.gross_after_lop),D.decimal(second.gross_after_lop)))).toBe('28000.00');
 });
 test('canonical statutory master resolution never invents employee deductions',()=>{
  const {statutoryReadiness}=require('../../../src/domain/payroll/statutory'),{statutory,pt}=require('../../helpers/payrollMasterFixtures');
  const data=[statutory(),statutory({scheme:'ESI'}),pt()],scope='9e198a5e-df3a-41f1-ad43-76dd137b54b0';
  const source={statutory_profile:{verified:true,effective_from:'2090-01-01',schemes:Object.fromEntries(data.map(d=>[d.scheme,{statutory_scope_id:scope}]))},statutory_rules:data.map(d=>({id:d.scheme,status:'PUBLISHED',...d,data:d,statutory_scope_id:scope}))};
  const result=statutoryReadiness(source,'2091-02-01');expect(result.blockers.some(b=>b.code==='EMPLOYEE_CATEGORY_OR_PAY_ENROLMENT_REQUIRED')).toBe(true);expect(result.rules).toEqual([]);
 });
});
test('LOP DAILY and MONTH rounding remain independent and reproducible',()=>{
 const source=office();Object.assign(source.pay_structures[0],{guaranteed_monthly_gross:'100.10',basic_salary:null,staff_welfare:null,other_fixed_components:null});source.leave=[leave('2091-02-05','2091-02-06')];
 const monthly=calculatePreview(source);expect(monthly.deductions[0].amount).toBe('6.67');
 policyEdit(source,{rounding:{...source.policies[0].data.rounding,lop:{...rounded,stage:'DAILY'}}});expect(calculatePreview(source).deductions[0].amount).toBe('6.68');
});

test('LINE LOP rounding blocks rather than silently selecting daily or aggregate semantics',()=>{
 const source=office();Object.assign(source.pay_structures[0],{guaranteed_monthly_gross:'100.10',basic_salary:null,staff_welfare:null,other_fixed_components:null});source.leave=[leave('2091-02-05','2091-02-06')];
 policyEdit(source,{rounding:{...source.policies[0].data.rounding,lop:{...rounded,stage:'LINE'}}});
 const result=calculatePreview(source);expect(codes(result)).toContain('LOP_LINE_ROUNDING_UNSUPPORTED');expect(result.gross_after_lop).toBeNull();expect(result.deductions).toEqual([]);
 expect(result.monthly_reconciliation[0].monthly_lop).toBeNull();expect(result.monthly_reconciliation[0].candidate_gross_after_literal_lop).toBeNull();
 // An unused LOP configuration must not block a month with no LOP scenario.
 source.leave=[];expect(codes(calculatePreview(source))).not.toContain('LOP_LINE_ROUNDING_UNSUPPORTED');expect(calculatePreview(source).gross_after_lop).toBe('100.10');
});

test('unsupported LINE LOP cannot become rounded allocations in split runs',()=>{
 const source=office('2091-10-01');policyEdit(source,{split_period_allocation_method:'CALENDAR_WEIGHTED_WITH_RESIDUAL',rounding:{...source.policies[0].data.rounding,lop:{...rounded,stage:'LINE'}}});
 source.row.period_to='2091-10-15';source.month_rows[0].period_to=source.row.period_to;source.month_rows.push({...source.month_rows[0],id:'second',period_from:'2091-10-16',period_to:'2091-10-31'});source.leave=[leave('2091-10-02'),leave('2091-10-22')];
 for(const row of source.month_rows){Object.assign(source.row,{id:row.id,period_from:row.period_from,period_to:row.period_to});const result=calculatePreview(source);expect(codes(result)).toContain('LOP_LINE_ROUNDING_UNSUPPORTED');expect(result.deductions).toEqual([]);expect(result.gross_after_lop).toBeNull();expect(result.monthly_reconciliation[0].monthly_lop).toBeNull();}
});

test('blocked Special Package retains agreed component evidence without payable or duplicate earnings',()=>{
 const source=office();source.pay_structures[0].pay_basis='Special package';const result=calculatePreview(source);
 expect(codes(result)).toContain('SPECIAL_PACKAGE_PERIOD_REQUIRED');expect(result.earnings).toEqual([]);expect(result.known_earnings_total).toBe('0.00');expect(result.gross_after_lop).toBeNull();
 expect(result.monthly_reconciliation[0].contract_diagnostics).toEqual([{pay_structure_id:'pay',pay_basis:'Special package',agreed_amount:'30000.00',components:{BASIC:'10000.00',STAFF_WELFARE:'2000.00',OTHER_FIXED:null,PACKAGE_BALANCE:'18000.00'},diagnostic_only:true}]);
 source.pay_structures[0].pay_basis='Monthly salary';const monthly=calculatePreview(source);expect(monthly.earnings).toHaveLength(1);expect(monthly.known_earnings_total).toBe('30000.00');expect(monthly.monthly_reconciliation[0].contract_diagnostics[0].agreed_amount).toBe('30000.00');
});

test('dated Special Package components remain diagnostic when several salary sources block entitlement',()=>{
 const source=office();source.pay_structures[0].pay_basis='Special package';source.pay_applicability[0].effective_to='2091-02-15';source.pay_applicability.push({...source.pay_applicability[0],id:'next-app',pay_structure_id:'next-pay',effective_from:'2091-02-16',effective_to:null});source.pay_structures.push({...source.pay_structures[0],id:'next-pay',guaranteed_monthly_gross:'36000.00',other_fixed_components:'1000.00'});
 const result=calculatePreview(source);expect(codes(result)).toContain('SALARY_CHANGE_PRORATION_REQUIRED');expect(result.earnings).toEqual([]);expect(result.gross_after_lop).toBeNull();
 expect(result.monthly_reconciliation[0].contract_diagnostics.map(d=>[d.pay_structure_id,d.agreed_amount,d.components.PACKAGE_BALANCE])).toEqual([['pay','30000.00','18000.00'],['next-pay','36000.00','23000.00']]);
});
