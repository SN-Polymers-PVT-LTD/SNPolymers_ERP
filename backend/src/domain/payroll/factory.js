const D=require('./exact');
function factoryDay(day,permanent=false){
 const lines=[],blockers=[];const row=day.attendance,rule=day.rule;
 const block=code=>blockers.push({kind:'policy',code,date:day.date,reference:row?.id});
 const line=(code,value,details={},rounding)=>{
  const {source_ids:additionalSources=[],...evidence}=details;
  const amount=D.amount(value,rounding);
  lines.push({code,date:day.date,amount,exact:D.reference(value),source_ids:[row.id,rule.id,...(day.wage?[day.wage.id]:[]),...additionalSources],...evidence});
  if(amount===null)block('FACTORY_ROUNDING_POLICY_REQUIRED');
 };
 if(!row||row.sheet_status!=='Locked'||!rule||row.pay_rule_revision_id!==rule.id||(!permanent&&(!day.wage||day.wage.id!==row.wage_revision_id)))return {lines,blockers};
 const treatment=rule.treatment;
 const local=day.assignment.employee_category==='Local Daily-Wage Workers';
 const leave=day.leave[0];
 if(['Medical Leave','Paid Leave','Unpaid Leave'].includes(row.attendance_status)){
  if(!leave||!['Approved','Rejected'].includes(leave.approval_status)||!['Paid','Unpaid'].includes(leave.pay_treatment)||(leave.approval_status==='Rejected'&&leave.pay_treatment!=='Unpaid'))block('LEAVE_PAYMENT_UNRESOLVED');
  else if(local&&leave.pay_treatment!=='Unpaid')block('LOCAL_PAID_LEAVE_FORBIDDEN');
  else if(leave.pay_treatment==='Paid'){
   if(!permanent){
    if(!treatment)block('PAID_DAILY_LEAVE_BASIS_REQUIRED');
    else line('DAILY_WAGE',D.decimal(day.wage.daily_wage),{source_ids:[treatment.id,leave.id],calculation:{treatment:'Approved paid leave'}});
   }
  }
  return {lines,blockers};
 }
 if(row.attendance_status==='Compensatory Off'){if(!permanent)block('COMP_OFF_PAY_RULE_REQUIRED');return {lines,blockers};}
 if(row.attendance_status==='Absent')return {lines,blockers};
 if(row.attendance_status==='Management Issue'){
  if(treatment?.management_stoppage_method!=='RETAIN_NORMAL_PAY')block('STRUCTURED_STOPPAGE_RULE_REQUIRED');
  else if(!permanent)line('DAILY_WAGE',D.decimal(day.wage.daily_wage),{source_ids:[treatment.id],calculation:{treatment:'Management stoppage: normal daily pay retained'}});
  return {lines,blockers};
 }
 if(row.attendance_status!=='Present'){block('ATTENDANCE_CLASSIFICATION_REQUIRED');return {lines,blockers};}
 const hours=D.decimal(row.actual_hours),standard=D.decimal(rule.standard_duty_hours),ot=D.decimal(row.ot_hours);
 if(!row.entry_timestamp||!row.exit_timestamp||D.compare(hours,D.zero())<=0n){block('DUTY_TIMESTAMPS_REQUIRED');return {lines,blockers};}
 if(!local&&D.compare(hours,D.decimal('24'))>0n){block('MAX_DUTY_DURATION_RULE_REQUIRED');return {lines,blockers};}
 const double=local&&row.duty_type==='Double Duty';
 const expectedHours=double?D.mul(standard,D.decimal('2')):standard;
 const short=D.compare(hours,expectedHours)<0n;
 if(short&&treatment?.short_hours_method!=='MISSING_HOURS'){block('STRUCTURED_SHORT_HOURS_RULE_REQUIRED');return {lines,blockers};}
 if(local&&!['Single Duty','Double Duty'].includes(row.duty_type))block('LOCAL_DUTY_TYPE_REQUIRED');
 if(local&&row.holiday_pay_eligible)block('LOCAL_HOLIDAY_FORBIDDEN');
 if(double&&D.compare(ot,D.zero())!==0n)block('DOUBLE_DUTY_OT_CONFLICT');
 // Stored classification controls the multiplier; no inference from duration.
 if(!permanent&&!blockers.length){
  let value=D.mul(D.decimal(day.wage.daily_wage),D.decimal(double?rule.double_duty_multiplier:'1'));
  if(short)value=D.mul(value,D.div(hours,expectedHours));
  if(short||double)value=D.round(value,{method:'HALF_UP',precision:2});
  line(double?'DOUBLE_DUTY':'DAILY_WAGE',value,short?{source_ids:[treatment.id],calculation:{treatment:'Only worked hours paid',worked_hours:row.actual_hours,normal_hours:D.format(expectedHours)}}:{});
 }
 if(row.holiday_pay_eligible){
  if(!rule.holiday_pay_enabled)block('HOLIDAY_RULE_REQUIRED');
  else if(permanent){
   if(short)block('HOLIDAY_FULL_DUTY_REQUIRED');
   else if(!treatment?.holiday_salary_days||treatment.holiday_method!=='TOTAL_DAILY_ENTITLEMENT'||!day.pay)block('PERMANENT_HOLIDAY_BASE_REQUIRED');
   else if(day.calendar?.length!==1||day.calendar[0].status!=='PUBLISHED'||day.calendar[0].day_type!=='Paid Holiday'||day.calendar[0].compensation_treatment!=='PAID')block('APPROVED_HOLIDAY_CALENDAR_REQUIRED');
   else{
    const multiplier=D.decimal(rule.holiday_multiplier),rounding={method:'HALF_UP',precision:2};
    if(D.compare(multiplier,D.decimal('1'))<0n)block('INVALID_HOLIDAY_MULTIPLIER');
    else{const daily=D.round(D.div(D.decimal(day.pay.guaranteed_monthly_gross),D.decimal(treatment.holiday_salary_days)),rounding);
     line('HOLIDAY_PREMIUM',D.mul(daily,D.sub(multiplier,D.decimal('1'))),{source_ids:[treatment.id,day.pay.id,day.pay_applicability.id,day.calendar[0].id],calculation:{treatment:'Holiday total entitlement; normal day already in monthly salary',daily_rate:D.format(daily),multiplier:rule.holiday_multiplier}},rounding);}
   }
  }
  else if(!local&&day.calendar?.some(c=>c.managed)&&!day.calendar.some(c=>c.managed&&c.holiday===true)){block('APPROVED_HOLIDAY_CALENDAR_REQUIRED');}
  else if(!local){const multiplier=D.decimal(rule.holiday_multiplier);if(D.compare(multiplier,D.decimal('1'))<0n)block('INVALID_HOLIDAY_MULTIPLIER');else line('HOLIDAY_PREMIUM',D.mul(D.decimal(day.wage.daily_wage),D.sub(multiplier,D.decimal('1'))));}
 }
 if(rule.ot_enabled&&!double&&D.compare(ot,D.zero())>0n){
  const config=rule.calculation;
  const rounding={method:'HALF_UP',precision:2};
  const expected=rule.ot_method==='Salary-derived hourly'?'MONTHLY_GROSS':rule.ot_method==='Derived from daily wage'?'DAILY_WAGE':'FIXED_HOURLY';
  const valid=config&&config.wage_basis===expected&&config.rounding_convention==='DAILY_HOURLY_AMOUNT_2DP_HALF_UP';
  let rate,daily,base;const ids=[];
  if(config&&!valid){block('FACTORY_OT_CONFIGURATION_REQUIRED');return {lines,blockers};}
  if(rule.ot_method==='Fixed Hourly')rate=D.decimal(rule.ot_rate);
  else if(rule.ot_method==='Derived from daily wage'&&!permanent){
   daily=D.decimal(day.wage.daily_wage);base=D.div(daily,standard);
   rate=valid?D.round(D.mul(D.round(base,rounding),D.decimal(rule.ot_multiplier)),rounding):D.mul(base,D.decimal(rule.ot_multiplier));
  }else if(rule.ot_method==='Salary-derived hourly'&&permanent){
   if(!valid||!config.salary_days||!/^\d+(\.\d+)?$/.test(config.salary_days)||D.compare(D.decimal(config.salary_days),D.zero())<=0n){block('SALARY_DERIVED_OT_BASIS_REQUIRED');return {lines,blockers};}
   if(!day.pay||['Draft','Suspended'].includes(day.pay.status)||typeof day.pay.guaranteed_monthly_gross!=='string'||!day.pay_applicability){block('INVALID_PAY_SOURCE');return {lines,blockers};}
   daily=D.round(D.div(D.decimal(day.pay.guaranteed_monthly_gross),D.decimal(config.salary_days)),rounding);
   base=D.round(D.div(daily,standard),rounding);
   rate=D.round(D.mul(base,D.decimal(rule.ot_multiplier)),rounding);
   ids.push(day.pay.id,day.pay_applicability.id);
  }else block('SALARY_DERIVED_OT_BASIS_REQUIRED');
  if(rate){
   if(valid)ids.push(config.id);
   const evidence={hours:row.ot_hours,standard_duty_hours:rule.standard_duty_hours,...(expected==='MONTHLY_GROSS'?{monthly_gross:day.pay.guaranteed_monthly_gross}:{}),hourly_rate:D.format(rate)||null,multiplier:rule.ot_method==='Fixed Hourly'?'1':rule.ot_multiplier,
    ...(daily?{daily_rate:D.format(daily),salary_days:config?.salary_days??null}:{}),
    ...(valid?{rounding:'Half up to two decimals at daily, hourly and amount stages'}:{})};
   line('OVERTIME',D.mul(ot,rate),{source_ids:ids,calculation:evidence},valid?rounding:undefined);
  }
 }
 return {lines,blockers,...(local&&D.compare(hours,D.decimal('24'))>0n?{warnings:[{code:'UNUSUAL_LOCAL_DUTY_DURATION',date:day.date,message:'Local duty exceeds 24 hours; verify the recorded times. Double duty remains 2x without extra OT.'}]}:{})};
}
module.exports={factoryDay};
