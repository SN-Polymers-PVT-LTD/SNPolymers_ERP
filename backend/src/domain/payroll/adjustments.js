const D=require('./exact');const {dates}=require('./sources');
const signed=v=>v.startsWith('-')?D.sub(D.zero(),D.decimal(v.slice(1))):D.decimal(v);
function adjustmentCalculation(source){
 const earnings=[],deductions=[],applications=[],blockers=[];
 const months=[...new Set(dates(source.row.period_from,source.row.period_to).map(d=>d.slice(0,7)+'-01'))];
 for(const a of source.adjustments||[]){
  if(a.status==='REJECTED'||a.status==='PAUSED'||(a.kind==='ADVANCE'&&(a.status==='APPROVED'||a.version===1)&&months.every(m=>m<a.recovery_start_month)))continue;
  if(a.status!=='APPROVED'){blockers.push({kind:'adjustment',code:'ADJUSTMENT_APPROVAL_REQUIRED',reference:a.id});continue;}
  const prior=(source.adjustment_applications||[]).filter(p=>p.adjustment_id===a.id);
  if(a.kind!=='ADVANCE'){
   if(a.target_row_id!==source.row.id)continue;
   if(prior.length){blockers.push({kind:'adjustment',code:'ADJUSTMENT_ALREADY_APPLIED',reference:a.id});continue;}
   const value=signed(a.amount),line={code:a.kind,adjustment_type:a.kind,date:a.effective_date,amount:D.format(value),exact:D.reference(value),source_ids:[a.id],approval_version:a.version};
   earnings.push(line);applications.push({adjustment_id:a.id,version:a.version,contribution_month:a.effective_date.slice(0,7)+'-01',amount:a.amount,kind:a.kind});
  }else{
   let outstanding=D.sub(D.decimal(a.amount),D.sum(prior.map(p=>D.decimal(p.amount))));
   if(outstanding.n<0n){blockers.push({kind:'adjustment',code:'ADVANCE_BALANCE_INCONSISTENT',reference:a.id});continue;}
   for(const month of months){
    if(month<a.recovery_start_month||outstanding.n===0n)continue;
    const collected=D.sum(prior.filter(p=>p.contribution_month===month).map(p=>D.decimal(p.amount))),available=D.sub(D.decimal(a.installment),collected);
    if(available.n<0n){blockers.push({kind:'adjustment',code:'ADVANCE_PLAN_BELOW_ALREADY_RECOVERED',reference:a.id,date:month});continue;}
    const value=D.compare(available,outstanding)<0n?available:outstanding;
    if(value.n===0n)continue;
    deductions.push({code:'ADVANCE_RECOVERY',adjustment_type:'RECOVERY',salary_month:month,amount:D.format(value),exact:D.reference(value),source_ids:[a.id],approval_version:a.version});
    applications.push({adjustment_id:a.id,version:a.version,contribution_month:month,amount:D.format(value),kind:a.kind});outstanding=D.sub(outstanding,value);
   }
  }
 }
 return {earnings,deductions,applications,blockers};
}
module.exports={adjustmentCalculation,signed};
