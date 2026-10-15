const D=require('./exact');
function factoryDay(day,permanent=false){
 const lines=[],blockers=[];const row=day.attendance,rule=day.rule;
 const block=code=>blockers.push({kind:'policy',code,date:day.date,reference:row?.id});
 const line=(code,value)=>{const amount=D.amount(value);lines.push({code,date:day.date,amount,exact:D.reference(value),source_ids:[row.id,rule.id,...(day.wage?[day.wage.id]:[])]});if(amount===null)block('FACTORY_ROUNDING_POLICY_REQUIRED');};
 if(!row||row.sheet_status!=='Locked'||!rule||row.pay_rule_revision_id!==rule.id||(!permanent&&(!day.wage||day.wage.id!==row.wage_revision_id)))return {lines,blockers};
 const local=day.assignment.employee_category==='Local Daily-Wage Workers';
 const leave=day.leave[0];
 if(['Medical Leave','Paid Leave','Unpaid Leave'].includes(row.attendance_status)){
  if(!leave||leave.approval_status!=='Approved'||!['Paid','Unpaid'].includes(leave.pay_treatment))block('LEAVE_PAYMENT_UNRESOLVED');
  else if(local&&leave.pay_treatment!=='Unpaid')block('LOCAL_PAID_LEAVE_FORBIDDEN');
  else if(!permanent&&leave.pay_treatment==='Paid')block('PAID_DAILY_LEAVE_BASIS_REQUIRED');
  return {lines,blockers};
 }
 if(row.attendance_status==='Compensatory Off'){if(!permanent)block('COMP_OFF_PAY_RULE_REQUIRED');return {lines,blockers};}
 if(row.attendance_status==='Absent')return {lines,blockers};
 if(row.attendance_status==='Management Issue'){block('STRUCTURED_STOPPAGE_RULE_REQUIRED');return {lines,blockers};}
 if(row.attendance_status!=='Present'){block('ATTENDANCE_CLASSIFICATION_REQUIRED');return {lines,blockers};}
 const hours=D.decimal(row.actual_hours),standard=D.decimal(rule.standard_duty_hours),ot=D.decimal(row.ot_hours);
 if(!row.entry_timestamp||!row.exit_timestamp||D.compare(hours,D.zero())<=0n){block('DUTY_TIMESTAMPS_REQUIRED');return {lines,blockers};}
 if(D.compare(hours,D.decimal('24'))>0n){block('MAX_DUTY_DURATION_RULE_REQUIRED');return {lines,blockers};}
 if(D.compare(hours,standard)<0n){block('STRUCTURED_SHORT_HOURS_RULE_REQUIRED');return {lines,blockers};}
 const double=local&&row.duty_type==='Double Duty';
 if(local&&!['Single Duty','Double Duty'].includes(row.duty_type))block('LOCAL_DUTY_TYPE_REQUIRED');
 if(local&&row.holiday_pay_eligible)block('LOCAL_HOLIDAY_FORBIDDEN');
 if(double&&D.compare(ot,D.zero())!==0n)block('DOUBLE_DUTY_OT_CONFLICT');
 // Stored classification controls the multiplier; no inference from duration.
 if(!permanent&&!blockers.length)line(double?'DOUBLE_DUTY':'DAILY_WAGE',D.mul(D.decimal(day.wage.daily_wage),D.decimal(double?rule.double_duty_multiplier:'1')));
 if(row.holiday_pay_eligible){
  if(!rule.holiday_pay_enabled)block('HOLIDAY_RULE_REQUIRED');
  else if(permanent)block('PERMANENT_HOLIDAY_BASE_REQUIRED');
  else if(!local){const multiplier=D.decimal(rule.holiday_multiplier);if(D.compare(multiplier,D.decimal('1'))<0n)block('INVALID_HOLIDAY_MULTIPLIER');else line('HOLIDAY_PREMIUM',D.mul(D.decimal(day.wage.daily_wage),D.sub(multiplier,D.decimal('1'))));}
 }
 if(rule.ot_enabled&&!double&&D.compare(ot,D.zero())>0n){
  let rate;
  if(rule.ot_method==='Fixed Hourly')rate=D.decimal(rule.ot_rate);
  else if(rule.ot_method==='Derived from daily wage'&&!permanent)rate=D.mul(D.div(D.decimal(day.wage.daily_wage),standard),D.decimal(rule.ot_multiplier));
  else block('SALARY_DERIVED_OT_BASIS_REQUIRED');
  if(rate)line('OVERTIME',D.mul(ot,rate));
 }
 return {lines,blockers};
}
module.exports={factoryDay};
