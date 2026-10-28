import React,{useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Button,Input,Select} from '../ui';
import {getPayrollSalaryContext,savePayrollSalary,initializePayrollAssignment} from '../../api/hrPayStructuresApi';
import {salaryContextKey} from './salaryContextKey';
export default function PayrollSalaryDates({employee,revisions=[]}){
 const client=useQueryClient();
 const [from,setFrom]=useState(''),[reason,setReason]=useState(''),[existing,setExisting]=useState('');
 const context=useQuery({queryKey:salaryContextKey(employee.id),queryFn:async()=>(await getPayrollSalaryContext(employee.id)).data.result});
 const save=useMutation({mutationFn:kind=>kind==='assignment'?initializePayrollAssignment({employee_id:employee.id,effective_from:from,reason}):savePayrollSalary({employee_id:employee.id,existing_id:existing,effective_from:from,expected_version:context.data.version,pay:null,reason}),onSuccess:()=>{
  client.invalidateQueries({queryKey:salaryContextKey(employee.id)});client.invalidateQueries({queryKey:['hr-pay-structures',employee.id]});client.invalidateQueries({queryKey:['payroll-sheet-register']});
 }});
 return <section aria-label="Payroll effective dates" className="rounded-xl border border-amber-500/30 p-4 space-y-3">
  <h3 className="font-semibold">Payroll effective dates</h3>
  {context.isPending?<p role="status">Loading salary dates…</p>:context.isError?<p role="alert">Unable to load salary dates. <Button onClick={()=>context.refetch()}>Retry salary dates</Button></p>:<>
   {context.data?.intervals.map(i=><p key={i.effective_from}>Salary applies from {i.effective_from} to {i.effective_to||'ongoing'}.</p>)}
   {!!context.data?.version&&<p className="text-xs">Create a salary revision below to append a new effective period. Existing history is retained. Review Accounts deduction setup if enrolment changes.</p>}
   {(!context.data?.version||!context.data?.assignment_version)&&<>
    <p>Confirm when the recorded salary and assignment actually applied. No dates are inferred from attendance.</p>
    <Input label="Setup applies from" type="date" required min={employee.joining_date||undefined} value={from} onChange={e=>setFrom(e.target.value)}/>
    <Input label="Salary setup reason" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/>
    {!context.data?.assignment_version&&<div className="space-y-2"><p>Assignment to confirm: {employee.employee_category} / {employee.department}.</p><Button disabled={!from||!reason.trim()||save.isPending} onClick={()=>save.mutate('assignment')}>Confirm initial payroll assignment</Button></div>}
    {!context.data?.version&&revisions.some(r=>['Active','Superseded'].includes(r.status))&&<>
     <Select label="Existing salary to link" value={existing} options={[{value:'',label:'Choose the salary valid for these dates'},...revisions.filter(r=>['Active','Superseded'].includes(r.status)).map(r=>({value:r.id,label:`Revision ${r.revision_number}: ${r.pay_basis} · ₹${r.guaranteed_monthly_gross}`}))]} onChange={e=>setExisting(e.target.value)}/>
     <Button disabled={!existing||!from||!reason.trim()||save.isPending} onClick={()=>save.mutate('salary')}>Confirm existing salary dates</Button>
    </>}
   </>}
  </>}
  {save.isSuccess&&<p role="status">Effective dates saved. Recalculate existing payroll explicitly to use the updated source.</p>}
  {save.isError&&<p role="alert">{save.error.response?.data?.message||save.error.message}</p>}
 </section>;
}
