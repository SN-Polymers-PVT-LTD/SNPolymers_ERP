import React,{useState} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {Button,Input,Select,Pagination} from '../ui';
import {getPayrollFoundationContext,createPayrollDraftRun,getPayrollDraftCandidates,addPayrollDraftEmployee} from '../../api/payrollReviewApi';
const message=e=>e?.response?.data?.message||e.message;
export default function PayrollDraftEditor({user,run,onRunChange,onUpdated}){
 const preparer=['accounts','factory_manager'].includes(user?.role),owned=!!run&&!!user?.id&&run.created_by===user.id;
 const [group,setGroup]=useState(''),[from,setFrom]=useState(owned?run.period_from:''),[to,setTo]=useState(owned?run.period_to:''),[cycle,setCycle]=useState('Monthly'),[candidate,setCandidate]=useState(''),[page,setPage]=useState(1),[added,setAdded]=useState(false);
 const context=useQuery({queryKey:['payroll-preparation-context',user?.id,user?.role],enabled:preparer&&!owned,queryFn:async()=>(await getPayrollFoundationContext()).data.context});
 const candidates=useQuery({queryKey:['payroll-preparation-candidates',user?.id,user?.role,run?.id,page],enabled:preparer&&owned,queryFn:async()=>(await getPayrollDraftCandidates(run.id,{page,limit:20})).data.selection});
 const create=useMutation({mutationFn:()=>{const selected=context.data.groups.find(g=>`${g.code}:${g.department}`===group);return createPayrollDraftRun({group_code:selected.code,department:selected.department,period_from:from,period_to:to,cycle});},onSuccess:r=>{onRunChange(r.data.run);onUpdated();}});
 const add=useMutation({mutationFn:()=>addPayrollDraftEmployee(run.id,{assignment_id:candidate,period_from:from,period_to:to}),onSuccess:()=>{setAdded(true);setCandidate('');onUpdated();candidates.refetch();}});
 if(!preparer)return null;
 const busy=create.isPending||add.isPending,valid=from&&to&&from<=to;
 return <section className="space-y-3 border border-slate-700 rounded p-3"><h2 className="font-bold">{owned?'Prepare employee drafts':'Create payroll sheet'}</h2>
 {owned?<><p>{run.group_code} / {run.department} / {run.period_from} – {run.period_to}. Add only evidenced assignment intervals.</p>
 {candidates.isPending?<p role="status">Loading evidenced employees…</p>:candidates.isError?<div role="alert">{message(candidates.error)} <Button onClick={()=>candidates.refetch()}>Retry candidates</Button></div>:<>
 <Select label="Evidenced employee assignment" value={candidate} options={[{value:'',label:'Select an employee interval'},...candidates.data.candidates.map(a=>({value:a.id,label:`${a.employee_name} / ${a.employee_code} / ${a.payable_from} – ${a.payable_to}`}))]} onChange={e=>{setCandidate(e.target.value);setAdded(false);const a=candidates.data.candidates.find(a=>a.id===e.target.value);if(a){setFrom(a.payable_from);setTo(a.payable_to);}}}/>
 {!candidates.data.candidates.length&&<p>No evidenced assignments for this group and period. Admin must record the historical sources.</p>}<Pagination currentPage={page} totalPages={Math.ceil(candidates.data.total_intervals/20)} onPageChange={p=>{setPage(p);setCandidate('');}}/>
 </>}</>:context.isPending?<p role="status">Loading payroll groups…</p>:context.isError?<div role="alert">{message(context.error)} <Button onClick={()=>context.refetch()}>Retry groups</Button></div>:<>
 <Select label="Payroll group / department" value={group} options={[{value:'',label:'Select an authorized payroll group'},...context.data.groups.filter(g=>user.role==='factory_manager'?['SNP Factory','Fabric Factory'].includes(g.department):['Head Office','Projects'].includes(g.department)).map(g=>({value:`${g.code}:${g.department}`,label:`${g.code} / ${g.department}`}))]} onChange={e=>setGroup(e.target.value)}/>
 <Select label="Payroll cycle" value={cycle} options={['Monthly','Fortnightly','Weekly','Custom'].map(v=>({value:v,label:v}))} onChange={e=>setCycle(e.target.value)}/>
 </>}
 <Input aria-label="Draft period from" label="Draft period from" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><Input aria-label="Draft period to" label="Draft period to" type="date" value={to} onChange={e=>setTo(e.target.value)}/>
 {owned?<><Button disabled={busy||!candidate||!valid} onClick={()=>add.mutate()}>Add employee draft</Button><Button disabled={busy} onClick={()=>onRunChange(null)}>Prepare a new sheet</Button></>:<Button disabled={busy||!group||!valid} onClick={()=>create.mutate()}>Create draft sheet</Button>}
 {added&&<p role="status">Employee draft added. Calculate and review it independently.</p>}{(create.error||add.error)&&<p role="alert">{message(create.error||add.error)}</p>}
 </section>;
}
