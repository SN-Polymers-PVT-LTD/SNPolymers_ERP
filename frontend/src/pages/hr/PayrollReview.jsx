import React,{useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '../../components/AuthContext';
import {Button,Select,Pagination,Input,TextArea} from '../../components/ui';
import SalaryPreview from '../../components/payroll/SalaryPreview';
import PayrollDraftEditor from '../../components/payroll/PayrollDraftEditor';
import {getPayrollReviewQueue,getPayrollEmployeeReview,actOnPayrollEmployee,actOnPayrollEmployees} from '../../api/payrollReviewApi';
const labels={calculate:'Save calculation revision',correct:'Save correction',submit:'Submit employee',forward:'Verify and forward',return:'Return for correction',approve_lock:'Check final lock',cancel:'Withdraw draft'};
const states=['DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED'];
const errorMessage=e=>e?.response?.data?.message||e?.response?.data?.result?.code||e.message;
export default function PayrollReview(){
 const {user}=useAuth(),allowed=['admin','accounts','ho','factory_manager'].includes(user?.role),client=useQueryClient();
 const [page,setPage]=useState(1),[status,setStatus]=useState(''),[rowId,setRowId]=useState(''),[selected,setSelected]=useState([]),[reason,setReason]=useState(''),[note,setNote]=useState(''),[assignment,setAssignment]=useState(''),[results,setResults]=useState([]),[lockBlockers,setLockBlockers]=useState([]);
 const [editingRun,setEditingRun]=useState(null);
 const queue=useQuery({queryKey:['payroll-review-queue',user?.id,user?.role,page,status],enabled:allowed,queryFn:async()=>(await getPayrollReviewQueue({page,limit:20,...(status?{status}:{})})).data.queue});
 const detail=useQuery({queryKey:['payroll-employee-review',user?.id,user?.role,rowId],enabled:allowed&&!!rowId,queryFn:async()=>(await getPayrollEmployeeReview(rowId)).data.review});
 const refresh=()=>{client.invalidateQueries({queryKey:['payroll-review-queue']});client.invalidateQueries({queryKey:['payroll-employee-review']});client.invalidateQueries({queryKey:['payroll-preview-run']});};
 const requestFor=(row,action,fp)=>({action,expected_version:row.current_version,expected_review_version:row.review_version,...(['calculate','correct','return','cancel'].includes(action)?{reason:reason.trim()}:{}),...(action==='correct'?{note:note.trim(),...(assignment?{assignment_id:assignment}:{})}:{}),...(['submit','forward','approve_lock'].includes(action)?{source_fingerprint:fp||row.source_fingerprint}:{})});
 const action=useMutation({mutationFn:({row,action:kind,fp})=>actOnPayrollEmployee(row.id,requestFor(row,kind,fp)),onMutate:()=>{setResults([]);setLockBlockers([]);},onSuccess:r=>{setResults([{row_id:r.data.result.row.id,success:true,status:200}]);setLockBlockers([]);refresh();},onError:e=>{setLockBlockers(e.response?.data?.result?.blockers||[]);refresh();}});
 const bulk=useMutation({mutationFn:kind=>actOnPayrollEmployees(queue.data.rows.filter(r=>selected.includes(r.id)).map(r=>({row_id:r.id,request:requestFor(r,kind)}))),onMutate:()=>{setResults([]);setLockBlockers([]);},onSuccess:r=>{setResults(r.data.results);setSelected(prev=>prev.filter(id=>!r.data.results.some(r=>r.row_id===id&&r.success)));refresh();}});
 const busy=action.isPending||bulk.isPending,needsReason=kind=>['calculate','correct','return','cancel'].includes(kind),picked=queue.data?.rows.filter(r=>selected.includes(r.id))||[];
 const bulkActions=['submit','forward','return','approve_lock','cancel'].filter(kind=>picked.length&&picked.every(r=>(r.available_actions||[]).includes(kind)));
 if(!allowed)return <p role="alert">Payroll review access is required.</p>;
 return <div className="p-4 space-y-5 text-slate-200"><h1 className="text-2xl font-bold">Payroll employee review</h1><p>Employee decisions are independent. Review does not authorize payment. Financial finalization remains disabled until statutory and monthly reconciliation prerequisites are complete.</p>
 <PayrollDraftEditor key={`${user.id}:${editingRun?.id||'new'}`} user={user} run={editingRun} onRunChange={setEditingRun} onUpdated={refresh}/>
 <Select label="Employee status" value={status} options={[{value:'',label:'All accessible employees'},...states.map(s=>({value:s,label:s}))]} onChange={e=>{setStatus(e.target.value);setPage(1);setSelected([]);}}/>
 {queue.isPending?<p role="status">Loading employee review queue…</p>:queue.isError?<div role="alert">{errorMessage(queue.error)} <Button onClick={()=>queue.refetch()}>Retry queue</Button></div>:<>
 <h2 className="font-bold">Parent sheet progress</h2>{queue.data.sheets.map(s=><div key={s.id}><p>{s.group_code} / {s.period_from} – {s.period_to}: {s.progress.status} · Locked {s.progress.locked}/{s.progress.total} · Accounts {s.progress.accounts} · HO {s.progress.ho} · Returned {s.progress.returned} · Draft {s.progress.draft} · Withdrawn {s.progress.cancelled}</p>{s.created_by===user.id&&['accounts','factory_manager'].includes(user.role)&&<Button onClick={()=>setEditingRun(s)}>Prepare employee drafts in this sheet</Button>}</div>)}
 <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Select employee</th><th>Employee / period</th><th>Review state</th><th>Return reason</th><th>Review</th></tr></thead><tbody>{queue.data.rows.map(r=><tr key={r.id}><td><input type="checkbox" aria-label={`Select ${r.employee_name}`} checked={selected.includes(r.id)} disabled={busy||!(r.available_actions||[]).length} onChange={e=>setSelected(old=>e.target.checked?[...old,r.id]:old.filter(id=>id!==r.id))}/></td><td>{r.employee_name} / {r.employee_code}<br/>{r.period_from} – {r.period_to}</td><td>{r.status}<br/>Content {r.current_version}, review {r.review_version}</td><td>{r.last_return_reason||'—'}</td><td><Button disabled={busy} onClick={()=>{setRowId(r.id);setReason('');setNote('');setAssignment('');setLockBlockers([]);action.reset();}}>Review employee</Button></td></tr>)}</tbody></table></div>
 {!queue.data.rows.length&&<p>No employees in this review queue.</p>}<Pagination currentPage={page} totalPages={Math.ceil(queue.data.total/20)} onPageChange={p=>{setPage(p);setSelected([]);}}/>
 </>}
 <TextArea aria-label="Action / correction reason" label="Action / correction reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/>
 {!!picked.length&&<div><p>{picked.length} employees selected. Each action reports its own result.</p>{bulkActions.map(kind=><Button key={kind} disabled={busy||(needsReason(kind)&&!reason.trim())} onClick={()=>bulk.mutate(kind)}>{labels[kind]} for selected employees</Button>)}</div>}
 {busy&&<p role="status">Applying employee actions…</p>}{(action.error||bulk.error)&&<p role="alert">{errorMessage(action.error||bulk.error)}</p>}
 {!!results.length&&<ul aria-label="Employee action results">{results.map((r,i)=><li key={`${r.row_id}-${i}`}>{r.row_id}: {r.success?'Applied':`Failed (${r.status})`} {r.error?.message||r.result?.code||''}{r.result?.blockers?.map(b=>` / ${b.code}`).join('')}</li>)}</ul>}
 {!!lockBlockers.length&&<div role="alert">Final lock blocked: {lockBlockers.map(b=>b.code).join(', ')}</div>}
 {rowId&&(detail.isPending?<p role="status">Loading employee history…</p>:detail.isError?<div role="alert">{errorMessage(detail.error)} <Button onClick={()=>detail.refetch()}>Retry employee</Button></div>:<>
 <h2 className="text-xl font-bold">Employee review: {detail.data.row.status}</h2>{detail.data.row.last_return_reason&&<p>Last return ({detail.data.row.last_return_stage}): {detail.data.row.last_return_reason}</p>}
 {detail.data.employee_self&&!detail.data.available_actions.length&&<p>An independent reviewer is required for your employee salary.</p>}
 {detail.data.source_stale&&<p role="alert">Sources changed since the saved calculation. Return and recalculate before forwarding or final locking.</p>}
 <Input aria-label="Correction note" label="Correction note" value={note} onChange={e=>setNote(e.target.value)} maxLength={2000}/>
 <Select label="Evidenced assignment for correction" value={assignment} options={[{value:'',label:'Keep current assignment'},...(detail.data.assignment_candidates||[]).map(a=>({value:a.id,label:`${a.group_code} / ${a.effective_from} – ${a.effective_to||'ongoing'}`}))]} onChange={e=>setAssignment(e.target.value)}/>
 <div>{detail.data.available_actions.map(kind=><Button key={kind} disabled={busy||(needsReason(kind)&&!reason.trim())} onClick={()=>action.mutate({row:detail.data.row,action:kind,fp:detail.data.revisions.at(-1)?.source_fingerprint})}>{labels[kind]}</Button>)}</div>
 <p>Current authoritative salary diagnostic. Payment status: {detail.data.payment_status}.</p><SalaryPreview preview={detail.data.current_preview}/>
 <details><summary>Changes since saved calculation</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(detail.data.changes_since_saved,null,2)}</pre></details>
 <h3 className="font-bold">Submission and calculation revisions</h3>{detail.data.revisions.map(v=><details key={v.revision}><summary>Revision {v.revision} / content {v.content_version} · {v.created_at} · {v.reason}</summary><p>Prepared by {v.created_by}. Correction note: {v.content_note||'—'}</p><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(v.changes,null,2)}</pre><SalaryPreview preview={v.calculation_snapshot}/></details>)}
 <details><summary>Correction content and reviewer action history</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({content:detail.data.content_versions,actions:detail.data.actions},null,2)}</pre></details>
 </>)}
 </div>;
}
