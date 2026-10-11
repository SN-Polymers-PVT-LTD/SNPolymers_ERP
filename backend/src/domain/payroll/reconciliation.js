const D=require('./exact');const {dates}=require('./sources');
// A read-only plan, never a reservation or posting. All runs count across groups.
function reconcileMonth(source,bounds,entitlement,policy){
 const rows=source.month_rows.filter(r=>r.period_from<=bounds.to&&bounds.from<=r.period_to);
 const blockers=[];const seen=new Set();const plan=rows.map(r=>{const from=r.period_from>bounds.from?r.period_from:bounds.from,to=r.period_to<bounds.to?r.period_to:bounds.to;const ds=dates(from,to);for(const d of ds){if(seen.has(d))blockers.push({kind:'reconciliation',code:'OVERLAPPING_PAYROLL_PERIODS',date:d,reference:r.id});seen.add(d);}return {...r,from,to,days:ds.length};}).sort((a,b)=>a.from.localeCompare(b.from)||a.id.localeCompare(b.id));
 const count=dates(bounds.from,bounds.to).length;
 const split=plan.length>1||plan[0]?.days!==count;
 if(split&&seen.size!==count)blockers.push({kind:'reconciliation',code:'MONTH_ALLOCATION_INCOMPLETE',date:bounds.from});
 if(plan.some(r=>!r.is_permanent))blockers.push({kind:'reconciliation',code:'MIXED_MONTHLY_WAGE_GROUPS',date:bounds.from});
 const ledger=source.entitlements.filter(m=>m.salary_month===bounds.from);
 if(ledger.some(m=>D.compare(D.decimal(m.allocated_base),D.zero())!==0n||D.compare(D.decimal(m.lop_amount),D.zero())!==0n)||source.coverage.some(c=>c.period_from<=bounds.to&&bounds.from<=c.period_to))blockers.push({kind:'reconciliation',code:'POSTED_MONTH_REQUIRES_RECONCILIATION',date:bounds.from});
 let allocations=[];
 if(entitlement&&(!split||(policy?.split_period_allocation_method==='CALENDAR_WEIGHTED_WITH_RESIDUAL'&&policy.rounding.allocation.method!=='UNRESOLVED'))&&!blockers.length){
  const rule=policy?.rounding.allocation;
  if(split&&!['LINE','MONTH','AGGREGATE'].includes(rule.stage))blockers.push({kind:'policy',code:'ALLOCATION_ROUNDING_STAGE_UNSUPPORTED',date:bounds.from});
  else {
   let assigned=D.zero();
   allocations=plan.map((r,index)=>{let value=entitlement;if(split)value=index===plan.length-1?D.sub(entitlement,assigned):D.round(D.mul(entitlement,D.fraction(BigInt(r.days),BigInt(count))),rule);assigned=D.add(assigned,value);return {row_id:r.id,period_from:r.from,period_to:r.to,value,amount:D.format(value,Math.max(2,rule?.precision||0))};});
   if(allocations.some(a=>a.value.n<0n))blockers.push({kind:'reconciliation',code:'NEGATIVE_ALLOCATION',date:bounds.from});
  }
 }
 return {split,blockers,allocations,view:{salary_month:bounds.from,contractual_entitlement:entitlement?D.format(entitlement):null,covered_days:seen.size,calendar_days:count,posted_base:D.format(D.sum(ledger.map(m=>D.decimal(m.allocated_base)))),read_only_plan:true,allocations:allocations.map(({value,...rest})=>rest),unallocated_entitlement:entitlement?D.format(D.sub(entitlement,D.sum(allocations.map(a=>a.value)))):null}};
}
module.exports={reconcileMonth};
