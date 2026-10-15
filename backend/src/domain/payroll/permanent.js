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
  if(partial){
   const method=policy?.partial_month_proration_method,rounding=policy?.rounding.proration;
   const contiguous=md.length>0&&dates(md[0].date,md.at(-1).date).length===md.length&&new Set(md.map(d=>d.assignment.group_code)).size===1;
   if(!contiguous||!['FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS'].includes(method)||!rounding||rounding.method==='UNRESOLVED'){
    block('PRORATION_DAY_CLASSIFICATION_REQUIRED',start);entitlement=null;
   }else if(entitlement){
    const divisor=method==='ACTUAL_CALENDAR_DAYS'?D.fraction(BigInt(dates(bounds.from,bounds.to).length)):D.decimal(policy.partial_month_fixed_divisor);
    if(!['MONTH','AGGREGATE'].includes(rounding.stage)){block('PRORATION_ROUNDING_STAGE_UNSUPPORTED',start);entitlement=null;}
    else entitlement=D.round(D.mul(D.div(entitlement,divisor),D.fraction(BigInt(md.length))),rounding);
   }
  }
  if(salary?.pay_basis==='Special package'&&policy?.special_package_period!=='MONTHLY_CONFIRMED'){block('SPECIAL_PACKAGE_PERIOD_REQUIRED',start,salary.id);entitlement=null;}
  // Evidence survives a blocked entitlement, including dated salary changes.
  // These components describe the agreed amount; they are never earnings lines.
  const contractDiagnostics=paySources.map(id=>{
   const pay=source.pay_structures.find(p=>p.id===id),components={BASIC:pay.basic_salary,STAFF_WELFARE:pay.staff_welfare,OTHER_FIXED:pay.other_fixed_components};
   const total=D.sum(Object.values(components).filter(v=>v!==null).map(D.decimal));
   if(D.compare(total,D.decimal(pay.guaranteed_monthly_gross))>0n)block('PAY_COMPONENTS_EXCEED_PACKAGE',start,pay.id);
   else components.PACKAGE_BALANCE=D.format(D.sub(D.decimal(pay.guaranteed_monthly_gross),total));
   return {pay_structure_id:pay.id,pay_basis:pay.pay_basis,agreed_amount:pay.guaranteed_monthly_gross,components,diagnostic_only:true};
  });
  const components=salary?contractDiagnostics[0].components:{};
  const rawUnpaid=md.filter(day=>{
   const leave=day.leave[0],status=day.attendance?.attendance_status;
   return (day.factory&&status==='Absent')||!!(leave&&['Approved','Rejected'].includes(leave.approval_status)&&(leave.pay_treatment==='Unpaid'||leave.approval_status==='Rejected'));
  });
  let unpaid=rawUnpaid;
  if(policy?.leave_weekly_off_method==='EXCLUDE_PAID_CALENDAR_DAYS'){
   unpaid=rawUnpaid.filter(d=>{
    const calendar=source.calendar.filter(c=>c.calendar_date===d.date&&c.status==='PUBLISHED');
    if(calendar.length!==1||!['PAID','UNPAID'].includes(calendar[0].compensation_treatment)){block('LEAVE_CALENDAR_ENTITLEMENT_REQUIRED',d.date);return false;}
    const c=calendar[0];
    if((c.day_type==='Paid Holiday'&&c.compensation_treatment!=='PAID')||(c.day_type==='Unpaid Closure'&&c.compensation_treatment!=='UNPAID')){block('CONFLICTING_CALENDAR_ENTITLEMENT',d.date,c.id);return false;}
    return !(['Weekly Off','Paid Holiday'].includes(c.day_type)&&c.compensation_treatment==='PAID');
   });
  }
  const noPayableEntitlement=md.length>0&&unpaid.length===md.length&&md.every(d=>{const c=source.calendar.filter(c=>c.calendar_date===d.date&&c.status==='PUBLISHED');return c.length===1&&c[0].compensation_treatment==='UNPAID';});
  const zeroMonth=noPayableEntitlement&&policy?.full_month_unpaid_treatment==='NO_PAYABLE_ENTITLEMENT_ZERO';
  const weekly=policy?.leave_weekly_off_method!=='EXCLUDE_PAID_CALENDAR_DAYS'&&unpaid.some(d=>new Date(d.date+'T00:00:00Z').getUTCDay()===0||source.calendar.some(c=>c.calendar_date===d.date&&c.day_type==='Weekly Off'));
  const recon=reconcileMonth(source,bounds,entitlement,policy,md.map(d=>d.date),resolved?.revision_id);blockers.push(...recon.blockers);
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
  let monthlyLop=null,currentLop=null;const lopPlan=new Map();
  const rule=policy?.rounding.lop;
  const unsupportedLine=unpaid.length>0&&rule?.stage==='LINE';
  // No approved definition of a LOP line exists. Never reinterpret LINE as MONTH.
  if(unsupportedLine)block('LOP_LINE_ROUNDING_UNSUPPORTED',start,policies);
  if(!unpaid.length){monthlyLop=D.zero();currentLop=D.zero();}
  else if(rule?.method!=='UNRESOLVED'&&rule&&['DAILY','MONTH','AGGREGATE'].includes(rule.stage)){
   monthlyLop=rule.stage==='DAILY'?D.sum(daily.map(d=>d.value)):D.round(D.sum(daily.map(d=>d.value)),rule);
   // Preserve month rounding and assign any residual to the last LOP-bearing row.
   const completePlan=!recon.blockers.length&&(!recon.split||recon.allocations.length>0);
   const raw=source.month_rows.filter(r=>r.is_permanent&&r.period_from<=bounds.to&&bounds.from<=r.period_to).sort((a,b)=>a.period_from.localeCompare(b.period_from)||a.id.localeCompare(b.id)).map(r=>({id:r.id,value:D.sum(daily.filter(d=>d.date>=r.period_from&&d.date<=r.period_to).map(d=>d.value))})).filter(r=>r.value.n!==0n);
   if(!completePlan)block('LOP_ALLOCATION_RECONCILIATION_REQUIRED',start);
   let assigned=D.zero();for(let i=0;completePlan&&i<raw.length;i++){const value=rule.stage==='DAILY'?raw[i].value:i===raw.length-1?D.sub(monthlyLop,assigned):D.round(raw[i].value,rule);assigned=D.add(assigned,value);lopPlan.set(raw[i].id,value);if(value.n<0n)block('NEGATIVE_LOP_ALLOCATION',start,raw[i].id);if(raw[i].id===source.row.id)currentLop=value;}
   if(currentLop===null&&daily.every(d=>d.date<source.row.period_from||d.date>source.row.period_to))currentLop=D.zero();
  }
  if(zeroMonth){monthlyLop=entitlement;currentLop=chosen?.value||null;literal=entitlement||D.zero();}
  if(zeroMonth)for(const a of recon.allocations)lopPlan.set(a.row_id,a.value);
  // Independent final-net paise rounding could increase/decrease the monthly
  // total when split allocations contain sub-paise amounts. No net-residual
  // policy is approved: retain diagnostics and fail closed for finalization.
  if(source.financial_context&&recon.split&&[...recon.allocations.map(a=>a.value),...lopPlan.values()].some(v=>D.format(v,2)===null))block('SPLIT_NET_ROUNDING_RECONCILIATION_REQUIRED',start);
  for(const old of (source.month_allocations||[]).filter(a=>source.entitlements.some(m=>m.id===a.entitlement_id&&m.salary_month===start))){if(old.lop_amount===null||D.compare(D.decimal(old.lop_amount),lopPlan.get(old.salary_row_id)||D.zero())!==0n)block('LOCKED_LOP_ALLOCATION_CHANGED',start,old.salary_row_id);}
  if(currentLop&&currentLop.n!==0n)deductions.push({code:'LOP',salary_month:start,amount:D.format(currentLop,Math.max(2,rule?.precision||0))||D.format(currentLop,6),exact:D.reference(currentLop),chargeable_dates:daily.filter(d=>d.date>=source.row.period_from&&d.date<=source.row.period_to).map(d=>d.date),source_ids:[...new Set(daily.flatMap(d=>d.source_ids))]});
  const candidate=salary?D.sub(entitlement||D.decimal(salary.guaranteed_monthly_gross),literal):null;
  if(!zeroMonth&&candidate&&candidate.n<0n)block('NEGATIVE_GROSS_FORBIDDEN',start);
  months.push({...recon.view,agreed_amount:salary?.guaranteed_monthly_gross||null,pay_basis:salary?.pay_basis||null,contract_diagnostics:contractDiagnostics,employment_days:md.length,full_month_zero_exception:zeroMonth,salary_segments:md.filter((d,i)=>i===0||d.pay?.id!==md[i-1].pay?.id).map(d=>({effective_from:d.date,pay_structure_id:d.pay?.id||null,monthly_gross:d.pay?.guaranteed_monthly_gross||null})),literal_lop:D.reference(literal),monthly_lop:monthlyLop?D.format(monthlyLop,Math.max(2,rule?.precision||0)):null,candidate_gross_after_literal_lop:candidate&&!unsupportedLine?D.amount(candidate,rule):null,policy_revision_ids:policies});
 }
 return {earnings,deductions,months,blockers,warnings};
}
module.exports={permanentCalculation};
