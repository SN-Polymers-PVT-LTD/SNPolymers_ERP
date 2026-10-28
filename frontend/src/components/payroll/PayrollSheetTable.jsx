import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Pagination, Table, TableHeader, TableBody, TableRow, TableCell, Badge, Modal } from '../ui';
import { getSalaryRegister } from '../../api/payrollReportsApi';
import { autoRecalculatePayroll, getPayrollFreshness, getPayrollReviewQueue, actOnPayrollEmployees, refreshPayrollRun, deletePayrollRun } from '../../api/payrollReviewApi';
import PayrollBlockers from './PayrollBlockers';
const message=e=>e?.response?.data?.message||e.message;
const amount=value=>value??'Unavailable';

export default function PayrollSheetTable({run,user,onUpdated,onReviewRow,onDeleted}) {
 const canPrepare=run.created_by===user.id&&user.role===(['SNP Factory','Fabric Factory'].includes(run.department)?'factory_manager':'accounts');
 const client=useQueryClient();
 const [page,setPage]=useState(1),[selected,setSelected]=useState([]),[reason,setReason]=useState('');
 const [deleteOpen,setDeleteOpen]=useState(false),[deleteReason,setDeleteReason]=useState('');
 const autoAttempts=useRef(new Set());
 const [autoResults,setAutoResults]=useState([]);
 const [generation,setGeneration]=useState(run.generation||null),[results,setResults]=useState([]);
 const report=useQuery({queryKey:['payroll-sheet-register',user.id,user.role,run.id,page],queryFn:async()=>(await getSalaryRegister({run_id:run.id,page,limit:20})).data.register});
 const queue=useQuery({queryKey:['payroll-sheet-actions',user.id,user.role,run.id,page],queryFn:async()=>(await getPayrollReviewQueue({run_id:run.id,page,limit:20})).data.queue});
 const signature=(report.data?.rows||[]).map(row=>[row.id,row.current_version,row.revision,row.source_fingerprint].join(':')).join('|');
 const freshness=useQuery({queryKey:['payroll-sheet-freshness',user.id,user.role,run.id,page,signature],enabled:!!report.data,
  queryFn:async()=>(await getPayrollFreshness({run_id:run.id,page,limit:20})).data.freshness,
  staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:'always'});
 const reload=()=>{
  client.invalidateQueries({queryKey:['payroll-sheet-freshness']});
  client.invalidateQueries({queryKey:['payroll-sheet-register']});
  client.invalidateQueries({queryKey:['payroll-sheet-actions']});
  client.invalidateQueries({queryKey:['salary-register']});
  client.invalidateQueries({queryKey:['payroll-diagnostic-payslip']});
  onUpdated();
 };
 const populate=useMutation({mutationFn:()=>refreshPayrollRun(run.id),onSuccess:r=>{setGeneration(r.data.generation);setResults([]);reload();},onError:reload});
 const actions=useMutation({
  mutationFn:async input=>{
   const kind=typeof input==='string'?input:input.kind;
   const rows=typeof input==='string'?picked:input.rows;
   if((typeof input==='string'&&rows.length!==selected.length)||rows.some(row=>!row.available_actions?.includes(kind)))throw new Error('Salary evidence changed; refresh the payroll table before applying this action.');
   const combined=[];
   // Reuse the existing per-employee API limit; selection is current page only.
   for(let offset=0;offset<rows.length;offset+=50){
    const response=await actOnPayrollEmployees(rows.slice(offset,offset+50).map(row=>({row_id:row.id,request:{action:kind,expected_version:row.current_version,expected_review_version:row.review_version,...(kind==='calculate'?{reason:reason.trim()}:{source_fingerprint:row.source_fingerprint})}})));
    combined.push(...response.data.results);
   }
   return {kind,results:combined};
  },
  onSuccess:r=>{
   setResults(r.results);
   const succeeded=new Set(r.results.filter(item=>item.success).map(item=>item.row_id));
   setSelected(ids=>ids.filter(id=>!succeeded.has(id)));
   if(r.kind==='calculate')setGeneration(prev=>prev?{...prev,source_checks:(prev.source_checks||[]).filter(item=>!succeeded.has(item.row_id))}:prev);
   reload();
  },onError:reload
 });
 const deletion=useMutation({mutationFn:()=>deletePayrollRun(run.id,deleteReason.trim()),onSuccess:()=>{
  setDeleteOpen(false);
  client.invalidateQueries({queryKey:['payroll-review-queue']});
  client.invalidateQueries({queryKey:['payroll-preview-runs']});
  client.invalidateQueries({queryKey:['payroll-preview-run']});
  client.invalidateQueries({queryKey:['payroll-selected-run']});
  reload();
  onDeleted?.();
 }});
 const automatic=useMutation({mutationFn:()=>autoRecalculatePayroll({run_id:run.id,page,limit:20}),
  onSuccess:response=>{setAutoResults(response.data.automatic.results);reload();},onError:()=>{}});
 const autoMutate=automatic.mutate;
 const busy=populate.isPending||actions.isPending||deletion.isPending||automatic.isPending;
 const deleteBlocked=!!(run.progress?.accounts||run.progress?.ho||run.progress?.locked);
 const byId=new Map((queue.data?.rows||[]).map(row=>[row.id,row]));
 const checks=new Map((freshness.data?.checks||[]).map(item=>[item.row_id,item]));
 const sameEvidence=(row,actionRow)=>actionRow&&row.current_version===actionRow.current_version&&row.revision===actionRow.review_revision&&row.source_fingerprint===actionRow.source_fingerprint;
 const picked=(report.data?.rows||[]).filter(row=>selected.includes(row.id)&&sameEvidence(row,byId.get(row.id))).map(row=>byId.get(row.id));
 const eligible=(report.data?.rows||[]).filter(row=>canPrepare&&sameEvidence(row,byId.get(row.id))&&byId.get(row.id).available_actions?.some(action=>['calculate','submit'].includes(action)));
 const canCalculate=picked.length>0&&picked.length===selected.length&&picked.every(row=>row.available_actions?.includes('calculate'));
 const selectedReports=(report.data?.rows||[]).filter(row=>selected.includes(row.id));
 const ready=row=>(row.blockers||[]).length===0&&row.calculation_status!=='BLOCKED_CALCULATION'&&row.net_salary!=null;
 const sourceState=row=>{
  if(row.status==='LOCKED')return 'CURRENT';
  if(freshness.isFetching||freshness.isPending)return 'CHECKING';
  if(freshness.isError)return 'UNAVAILABLE';
  const check=checks.get(row.id);
  return check&&check.current_version===row.current_version&&check.review_revision===row.revision&&check.source_fingerprint===row.source_fingerprint?check.status:'UNAVAILABLE';
 };
 const readyToReview=row=>ready(row)&&sourceState(row)==='CURRENT';
 const affected=(report.data?.rows||[]).filter(row=>sourceState(row)==='CHANGED'&&canPrepare&&sameEvidence(row,byId.get(row.id))&&byId.get(row.id)?.available_actions?.includes('calculate')).map(row=>byId.get(row.id));
 const autoKey=(report.data?.rows||[]).filter(row=>['DRAFT','CALCULATED'].includes(row.status)&&['CHANGED','UNCALCULATED'].includes(sourceState(row))&&sameEvidence(row,byId.get(row.id))&&byId.get(row.id)?.available_actions?.includes('calculate')).map(row=>`${row.id}:${row.current_version}:${row.revision}:${checks.get(row.id)?.current_source_fingerprint||sourceState(row)}`).join('|');
 useEffect(()=>{
  if(!canPrepare||busy||!autoKey||autoAttempts.current.has(autoKey))return;
  autoAttempts.current.add(autoKey);autoMutate();
 },[canPrepare,busy,autoKey,autoMutate]);
 const canSubmit=selectedReports.every(readyToReview)&&picked.length>0&&picked.length===selected.length&&picked.every(row=>row.available_actions?.includes('submit')&&checks.get(row.id)?.status!=='CHANGED'&&checks.get(row.id)?.status!=='UNAVAILABLE');
 return <section aria-label="Payroll sheet table" className="glass-panel rounded-2xl border border-white/10 overflow-hidden space-y-4">
  <div className="p-5 space-y-3 border-b border-white/10">
   <div className="flex flex-wrap justify-between items-center gap-3">
    <div><h3 className="text-lg font-bold">Payroll calculation table</h3><p className="text-xs text-slate-400">{run.department} / {run.group_code} / {run.period_from} – {run.period_to}</p></div>
    {canPrepare&&<div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>populate.mutate()}>Refresh eligible employees</Button><Button variant="danger" disabled={busy||deleteBlocked} onClick={()=>{setDeleteReason('');deletion.reset();setDeleteOpen(true);}}>Delete draft sheet</Button></div>}
   </div>
   <p className="text-xs text-slate-400">Unsubmitted drafts update automatically when changed sources are detected on open or refocus. Submitted, returned and locked rows keep their saved calculations. Refresh also adds missing eligible employees. Submission and approval remain explicit decisions.</p>
   <Button size="sm" disabled={freshness.isFetching} onClick={()=>freshness.refetch()}>Check current sources</Button>
   {report.data&&<p role="status">On this page: {report.data.rows.filter(readyToReview).length} ready · {report.data.rows.filter(row=>!readyToReview(row)).length} need setup or calculation.</p>}
   {generation&&<div role="status" className="text-sm text-emerald-300">Added {generation.added} · Existing eligible rows {generation.retained} · Initial calculations saved {(generation.results||[]).filter(r=>r.success).length}</div>}
   {automatic.isPending&&<p role="status">Updating draft salaries using latest setup…</p>}
   {automatic.error&&<p role="alert">Automatic recalculation could not complete. <Button onClick={()=>automatic.mutate()}>Retry automatic recalculation</Button></p>}
   {autoResults.some(result=>result.status==='UPDATED')&&<p role="status">Updated using latest setup. Check the current calculation status and any remaining blockers.</p>}
   {autoResults.some(result=>['FAILED','UNAVAILABLE'].includes(result.status))&&<p role="alert">Some draft salaries could not update. Previous results remain unverified. <Button disabled={busy} onClick={()=>automatic.mutate()}>Retry automatic recalculation</Button></p>}
   {busy&&<p role="status">Processing payroll employees…</p>}
   {(populate.error||actions.error)&&<p role="alert" className="text-red-300">{message(populate.error||actions.error)}</p>}
   {!!generation?.issues?.length&&<div role="alert" className="text-xs text-amber-300 space-y-1"><p className="font-bold">Employees needing attention</p><ul>{generation.issues.map((issue,i)=><li key={issue.employee_id||i}>{issue.employee_name||'Sheet'} {issue.employee_code&&`(${issue.employee_code})`}: {issue.code} — {issue.message}</li>)}</ul></div>}
   {!!generation?.results?.some(r=>!r.success)&&<ul aria-label="Initial calculation failures" className="text-xs text-red-300">{generation.results.filter(r=>!r.success).map(r=><li key={r.row_id}>{r.row_id}: {r.code} — {r.message}</li>)}</ul>}
  </div>
  {report.isPending||queue.isPending?<p role="status" className="p-5">Loading calculated payroll table…</p>:report.isError||queue.isError?<div role="alert" className="p-5 text-red-300">{message(report.error||queue.error)} <Button onClick={()=>{report.refetch();queue.refetch();}}>Retry payroll table</Button></div>:<>
   <Table className="min-w-[1100px]">
    <TableHeader><TableRow hover={false}><TableCell isHeader><input type="checkbox" aria-label="Select all actionable payroll rows on this page" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(row=>selected.includes(row.id))} onChange={e=>setSelected(e.target.checked?eligible.map(row=>row.id):[])}/></TableCell><TableCell isHeader>Employee</TableCell><TableCell isHeader>Payable period</TableCell><TableCell isHeader align="right">Gross after LOP</TableCell><TableCell isHeader align="right">EPF / ESI / PT</TableCell><TableCell isHeader align="right">Net salary</TableCell><TableCell isHeader>Review status</TableCell><TableCell isHeader>Calculation / sources</TableCell><TableCell isHeader>Details</TableCell></TableRow></TableHeader>
    <TableBody>{report.data.rows.map(row=>{
     const actionRow=byId.get(row.id),check=checks.get(row.id),allowed=canPrepare&&sameEvidence(row,actionRow)&&actionRow.available_actions?.some(action=>['calculate','submit'].includes(action));
     return <TableRow key={row.id}>
      <TableCell><input type="checkbox" aria-label={`Select payroll ${row.employee_name}`} checked={selected.includes(row.id)} disabled={busy||!allowed} onChange={e=>setSelected(ids=>e.target.checked?[...ids,row.id]:ids.filter(id=>id!==row.id))}/></TableCell>
      <TableCell><strong>{row.employee_name}</strong><div className="text-xs text-slate-400">{row.employee_code}</div></TableCell>
      <TableCell>{row.period_from} – {row.period_to}</TableCell>
      <TableCell align="right" className="font-mono">{amount(row.gross_after_lop)}{row.status!=='LOCKED'&&sourceState(row)!=='CURRENT'&&<div className="text-xs text-amber-500">Previous result — not verified current</div>}</TableCell>
      <TableCell align="right" className="font-mono">{amount(row.epf)} / {amount(row.esi)} / {amount(row.pt)}</TableCell>
      <TableCell align="right" className="font-mono">{amount(row.net_salary)}</TableCell>
      <TableCell><Badge variant={row.status==='LOCKED'?'emerald':'amber'}>{row.status==='CALCULATED'?(sourceState(row)==='CHECKING'?'Checking sources':sourceState(row)==='CHANGED'?'Needs recalculation':sourceState(row)==='UNAVAILABLE'?'Unable to verify':ready(row)?'Ready for review':'Calculation blocked'):row.status}</Badge></TableCell>
      <TableCell><div>{sourceState(row)==='CHECKING'?'Checking current sources…':sourceState(row)==='CHANGED'?(['PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL'].includes(row.status)?'Inputs changed — return for recalculation':'Sources changed — recalculate'):sourceState(row)==='UNAVAILABLE'?'Unable to verify current sources':!ready(row)?'Needs setup / calculation blocked':row.calculation_status||row.evidence_status}</div><div className="text-xs text-slate-400">{row.status==='LOCKED'?'Immutable snapshot':sourceState(row)}</div>{sourceState(row)==='CHANGED'&&check?.reasons?.map(reason=><p key={reason} className="text-xs text-amber-500">{reason}</p>)}{sourceState(row)==='CHANGED'?<details className="text-xs"><summary>Previous calculation blockers</summary><PayrollBlockers blockers={row.blockers||[]}/></details>:<PayrollBlockers blockers={row.blockers||[]}/>}</TableCell>
      <TableCell><Button size="sm" disabled={busy} onClick={()=>onReviewRow?.(row.id)}>View payroll details</Button></TableCell>
     </TableRow>;
    })}</TableBody>
   </Table>
   {!report.data.rows.length&&<p className="p-5 text-sm text-slate-400">No employees populated. Check recorded category assignments and generation issues above.</p>}
   <div className="px-5"><Pagination currentPage={page} totalPages={Math.max(1,Math.ceil(report.data.total/20))} onPageChange={value=>{setPage(value);setSelected([]);setAutoResults([]);}}/></div>
   {canPrepare&&<div className="p-5 border-t border-white/10 space-y-3">
    <p className="text-sm">{picked.length} employees selected on this page.</p>
    <Input label="Recalculation reason" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="Explain an explicit recalculation of selected drafts"/>
    <div className="flex flex-wrap gap-3"><Button disabled={busy||!affected.length||!reason.trim()} onClick={()=>actions.mutate({kind:'calculate',rows:affected})}>Recalculate affected employees on this page</Button><Button disabled={busy||!canCalculate||!reason.trim()} onClick={()=>actions.mutate('calculate')}>Recalculate selected employees</Button><Button disabled={busy||!canSubmit} onClick={()=>actions.mutate('submit')}>Submit selected employees</Button></div>
    {!!results.length&&<ul aria-label="Payroll sheet action results" className="text-xs space-y-1">{results.map(r=><li key={r.row_id}>{r.row_id}: {r.success?'Applied':`Failed (${r.status})`} {r.error?.message||r.result?.code||''}</li>)}</ul>}
   </div>}
  </>}
  <Modal isOpen={deleteOpen} title="Delete draft payroll sheet" role="dialog" aria-modal="true" aria-label="Delete draft payroll sheet" size="md" closeDisabled={deletion.isPending} onClose={()=>{if(!deletion.isPending)setDeleteOpen(false);}}>
   <div className="space-y-4">
    <p className="text-sm">Delete {run.group_code} / {run.department} / {run.period_from} – {run.period_to}? All unsubmitted employee rows will be cancelled and the sheet removed from active views. Audit history is retained.</p>
    <p className="text-xs text-slate-500">Sheets with submitted, under-review or locked employees cannot be deleted.</p>
    <Input label="Sheet deletion reason" value={deleteReason} maxLength={2000} disabled={deletion.isPending} onChange={e=>setDeleteReason(e.target.value)}/>
    {deletion.error&&<p role="alert" className="text-red-600 dark:text-red-300">{message(deletion.error)}</p>}
    {deletion.isPending&&<p role="status">Deleting payroll sheet…</p>}
    <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={deletion.isPending} onClick={()=>setDeleteOpen(false)}>Keep sheet</Button><Button variant="danger" disabled={deletion.isPending||!deleteReason.trim()} onClick={()=>deletion.mutate()}>Confirm delete sheet</Button></div>
   </div>
  </Modal>
 </section>;
}
