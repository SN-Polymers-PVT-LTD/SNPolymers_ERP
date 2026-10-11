import React,{useState,useRef} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {useAuth} from '../../components/AuthContext';
import {Button,Select,Pagination} from '../../components/ui';
import {listPayrollRuns,getPayrollRun,previewPayrollRow} from '../../api/payrollPreviewApi';
const message=e=>e?.response?.data?.message||e.message;
export default function PayrollPreviews(){
 const {user}=useAuth(),allowed=['admin','accounts','ho','factory_manager'].includes(user?.role);
 const activeRow=useRef(null);
 const [page,setPage]=useState(1),[run,setRun]=useState(''),[rowPage,setRowPage]=useState(1),[shown,setShown]=useState(null);
 const runs=useQuery({queryKey:['payroll-preview-runs',page],enabled:allowed,queryFn:async()=>(await listPayrollRuns({page,limit:20})).data.selection});
 const detail=useQuery({queryKey:['payroll-preview-run',run,rowPage],enabled:allowed&&!!run,queryFn:async()=>(await getPayrollRun(run,{page:rowPage,limit:20})).data.draft});
 const preview=useMutation({mutationFn:({id,fingerprint})=>previewPayrollRow(id,fingerprint),onSuccess:r=>{if(activeRow.current===r.data.preview.row_id)setShown(r.data.preview);},onError:()=>setShown(null)});
 if(!allowed)return <p role="alert">Payroll preview access is required.</p>;
 return <div className="p-4 space-y-5 text-slate-200"><h1 className="text-2xl font-bold">Payroll salary previews</h1><p>Read-only estimates. Approval, locking, statutory posting and payment are disabled. Unresolved deductions leave final net salary unavailable.</p>
 {runs.isPending?<p role="status">Loading payroll runs…</p>:runs.isError?<div role="alert">{message(runs.error)} <Button onClick={()=>runs.refetch()}>Retry</Button></div>:<><Select label="Payroll run" value={run} options={[{value:'',label:'Select a draft run'},...runs.data.runs.map(r=>({value:r.id,label:`${r.group_code} / ${r.department} / ${r.period_from} – ${r.period_to}`}))]} onChange={e=>{activeRow.current=null;setRun(e.target.value);setRowPage(1);setShown(null);preview.reset();}}/>{!runs.data.runs.length&&<p>No accessible payroll draft runs.</p>}<Pagination currentPage={page} totalPages={Math.ceil(runs.data.total/20)} onPageChange={setPage}/></>}
 {run&&(detail.isPending?<p role="status">Loading employee rows…</p>:detail.isError?<div role="alert">{message(detail.error)} <Button onClick={()=>detail.refetch()}>Retry rows</Button></div>:<><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Employee reference</th><th>Period</th><th>Preview</th></tr></thead><tbody>{detail.data.rows.map(r=><tr key={r.id}><td>{r.employee_id}</td><td>{r.period_from} – {r.period_to}</td><td><Button disabled={preview.isPending} onClick={()=>{activeRow.current=r.id;setShown(null);preview.mutate({id:r.id});}}>Generate preview</Button></td></tr>)}</tbody></table></div>{!detail.data.rows.length&&<p>No employees in this draft run.</p>}<Pagination currentPage={rowPage} totalPages={Math.ceil(detail.data.total_rows/20)} onPageChange={setRowPage}/></>)}
 {preview.isPending&&<p role="status">Resolving historical sources and calculating…</p>}{preview.error&&<p role="alert">{message(preview.error)}</p>}
 {shown&&<section className="space-y-4"><h2 className="text-xl font-semibold">{shown.employee.employee_name} / {shown.employee.employee_code}</h2><p>{shown.status} · {shown.period_from} – {shown.period_to}</p><p>Gross after LOP: {shown.gross_after_lop??'Blocked'} · Final net: unavailable</p>
 <Button disabled={preview.isPending} onClick={()=>preview.mutate({id:shown.row_id,fingerprint:shown.source_fingerprint})}>Check preview freshness</Button><Button disabled={preview.isPending} onClick={()=>{setShown(null);preview.mutate({id:shown.row_id});}}>Generate fresh preview</Button>
 {['earnings','deductions'].map(kind=><div key={kind}><h3 className="font-bold capitalize">{kind}</h3>{!shown[kind].length?<p>No calculated {kind} lines. Statutory deductions remain unresolved.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Line</th><th>Date / month</th><th>Amount</th><th>Source references</th></tr></thead><tbody>{shown[kind].map((l,i)=><tr key={i}><td>{l.code}</td><td>{l.date||l.salary_month}</td><td>{l.amount??'Rounding unresolved'}</td><td className="break-all">{l.source_ids.join(', ')}</td></tr>)}</tbody></table></div>}</div>)}
 <h3 className="font-bold">Calculation blockers</h3><ul>{shown.blockers.map((b,i)=><li key={i}>{b.date?`${b.date}: `:''}{b.code}{b.field?` / ${b.field}`:''}{b.responsible_team?` — ${b.responsible_team}`:''}</li>)}</ul>
 <h3 className="font-bold">Monthly reconciliation</h3><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(shown.monthly_reconciliation,null,2)}</pre>
 <h3 className="font-bold">Statutory readiness and enrolment</h3><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({rules:shown.statutory,enrolment:shown.enrolment},null,2)}</pre>
 <details><summary>Policy revisions, source references and configuration warnings</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({fingerprint:shown.source_fingerprint,sources:shown.source_references,warnings:shown.configuration_warnings},null,2)}</pre></details></section>}
 </div>;
}
