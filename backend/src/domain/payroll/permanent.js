const D=require('./exact');const {month,dates}=require('./sources');
const {calculationReadiness}=require('../payrollMasters');const {reconcileMonth}=require('./reconciliation');
function permanentCalculation(source,days){
 const earnings=[],deductions=[],months=[],blockers=[],warnings=[];const block=(code,date,reference)=>blockers.push({kind:'policy',code,date,reference});
 const starts=[...new Set(dates(source.row.period_from,source.row.period_to).map(d=>d.slice(0,7)+'-01'))];
 for(const start of starts){
  const bounds=month(start),md=days.filter(d=>d.date>=bounds.from&&d.date<=bounds.to),paySources=[...new Set(md.map(d=>d.pay?.id).filter(Boolean))];
  const policies=[...new Set(md.map(d=>d.policy?.revision_id).filter(Boolean))],resolved=md[0]?.policy,policy=resolved?.data;
  const salary=paySources.length===1?md.find(d=>d.pay)?.pay:null;
  let entitlement=salary?D.decimal(salary.guaranteed_monthly_gross):null;
  const partial=md.length!==dates(bounds.from,bounds.to).length||new Set(md.map(d=>d.assignment.group_code)).size!==1;
  if(paySources.length!==1){block('SALARY_CHANGE_PRORATION_REQUIRED',start,paySources);entitlement=null;}
  if(policies.length!==1)block('AMBIGUOUS_MONTH_POLICY',start,policies);
  if(partial)block('PRORATION_DAY_CLASSIFICATION_REQUIRED',start);
  if(salary?.pay_basis==='Special package'){block('SPECIAL_PACKAGE_PERIOD_REQUIRED',start,salary.id);entitlement=null;}
  const components=salary?{BASIC:salary.basic_salary,STAFF_WELFARE:salary.staff_welfare,OTHER_FIXED:salary.other_fixed_components}:{};
  if(salary){const total=D.sum(Object.values(components).filter(v=>v!==null).map(D.decimal));if(D.compare(total,D.decimal(salary.guaranteed_monthly_gross))>0n)block('PAY_COMPONENTS_EXCEED_PACKAGE',start,salary.id);else components.PACKAGE_BALANCE=D.format(D.sub(D.decimal(salary.guaranteed_monthly_gross),total));}
  const unpaid=md.filter(day=>{
   const leave=day.leave[0],status=day.attendance?.attendance_status;
   return (day.factory&&status==='Absent')||!!(leave&&['Approved','Rejected'].includes(leave.approval_status)&&(leave.pay_treatment==='Unpaid'||leave.approval_status==='Rejected'));
  });
  const weekly=unpaid.some(d=>new Date(d.date+'T00:00:00Z').getUTCDay()===0||source.calendar.some(c=>c.calendar_date===d.date&&c.day_type==='Weekly Off'));
  const recon=reconcileMonth(source,bounds,entitlement,policy);blockers.push(...recon.blockers);
  const scenario={has_lop:unpaid.length>0,partial_month:partial,split_run:recon.split,full_month_unpaid:unpaid.length===md.length&&md.length>0,weekly_off_leave:weekly};
  const ready=calculationReadiness(resolved,scenario);blockers.push(...ready.blockers.map(b=>({...b,kind:'policy',date:start})));warnings.push(...ready.configuration_warnings.map(w=>({...w,date:start})));
  if(weekly)block('LEAVE_WEEKLY_OFF_CLASSIFICATION_REQUIRED',start);
  const chosen=recon.allocations.find(a=>a.row_id===source.row.id);
  if(chosen)earnings.push({code:'CONTRACTUAL_BASE',salary_month:start,amount:chosen.amount,exact:D.reference(chosen.value),source_ids:salary?[salary.id,...policies]:policies,contract_components:components});
  let literal=D.zero();const daily=[];
  for(const d of unpaid){if(!d.pay||!d.policy?.data)continue;
   const p=d.policy.data,divisor=p.lop_method==='FIXED_DIVISOR'?D.decimal(p.lop_fixed_divisor):D.fraction(BigInt(dates(bounds.from,bounds.to).length));
   let value=D.div(D.decimal(d.pay.guaranteed_monthly_gross),divisor);literal=D.add(literal,value);
   if(p.rounding.lop.stage==='DAILY'&&p.rounding.lop.method!=='UNRESOLVED')value=D.round(value,p.rounding.lop);
   daily.push({date:d.date,value,source_ids:[d.pay.id,d.policy.revision_id,...d.leave.map(l=>l.id),...(d.attendance?[d.attendance.id]:[])]});
  }
  let monthlyLop=null,currentLop=null;
  const rule=policy?.rounding.lop;
  if(!unpaid.length){monthlyLop=D.zero();currentLop=D.zero();}
  else if(rule?.method!=='UNRESOLVED'&&rule){
   monthlyLop=rule.stage==='DAILY'?D.sum(daily.map(d=>d.value)):D.round(D.sum(daily.map(d=>d.value)),rule);
   // Preserve month rounding and assign any residual to the last LOP-bearing row.
   const completePlan=!recon.blockers.length&&(!recon.split||recon.allocations.length>0);
   const raw=source.month_rows.filter(r=>r.is_permanent&&r.period_from<=bounds.to&&bounds.from<=r.period_to).sort((a,b)=>a.period_from.localeCompare(b.period_from)||a.id.localeCompare(b.id)).map(r=>({id:r.id,value:D.sum(daily.filter(d=>d.date>=r.period_from&&d.date<=r.period_to).map(d=>d.value))})).filter(r=>r.value.n!==0n);
   if(!completePlan)block('LOP_ALLOCATION_RECONCILIATION_REQUIRED',start);
   let assigned=D.zero();for(let i=0;completePlan&&i<raw.length;i++){const value=rule.stage==='DAILY'?raw[i].value:i===raw.length-1?D.sub(monthlyLop,assigned):D.round(raw[i].value,rule);assigned=D.add(assigned,value);if(value.n<0n)block('NEGATIVE_LOP_ALLOCATION',start,raw[i].id);if(raw[i].id===source.row.id)currentLop=value;}
   if(currentLop===null&&daily.every(d=>d.date<source.row.period_from||d.date>source.row.period_to))currentLop=D.zero();
  }
  if(currentLop&&currentLop.n!==0n)deductions.push({code:'LOP',salary_month:start,amount:D.format(currentLop,Math.max(2,rule?.precision||0)),exact:D.reference(currentLop),chargeable_dates:daily.filter(d=>d.date>=source.row.period_from&&d.date<=source.row.period_to).map(d=>d.date),source_ids:[...new Set(daily.flatMap(d=>d.source_ids))]});
  const candidate=salary?D.sub(D.decimal(salary.guaranteed_monthly_gross),literal):null;
  if(candidate&&candidate.n<0n)block('NEGATIVE_GROSS_FORBIDDEN',start);
  months.push({...recon.view,agreed_amount:salary?.guaranteed_monthly_gross||null,pay_basis:salary?.pay_basis||null,salary_segments:md.filter((d,i)=>i===0||d.pay?.id!==md[i-1].pay?.id).map(d=>({effective_from:d.date,pay_structure_id:d.pay?.id||null,monthly_gross:d.pay?.guaranteed_monthly_gross||null})),literal_lop:D.reference(literal),monthly_lop:monthlyLop?D.format(monthlyLop,Math.max(2,rule?.precision||0)):null,candidate_gross_after_literal_lop:candidate?D.amount(candidate,rule):null,policy_revision_ids:policies});
 }
 return {earnings,deductions,months,blockers,warnings};
}
module.exports={permanentCalculation};
