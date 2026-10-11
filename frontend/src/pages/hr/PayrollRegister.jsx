import React,{useState} from 'react';
import {Link} from 'react-router-dom';
import {useQuery,useMutation} from '@tanstack/react-query';
import {useAuth} from '../../components/AuthContext';
import {Button,Input,Select,Pagination} from '../../components/ui';
import {getPayrollFoundationContext} from '../../api/payrollReviewApi';
import {getSalaryRegister,exportSalaryReport,getDiagnosticPayslip} from '../../api/payrollReportsApi';
import PayrollPayslip from '../../components/payroll/PayrollPayslip';
const statuses=['DRAFT','CALCULATED','PENDING_ACCOUNTS_REVIEW','PENDING_HO_APPROVAL','RETURNED_TO_CREATOR','CANCELLED_DRAFT','LOCKED'];
const message=e=>e?.response?.data?.message||e.message;
const amount=v=>v??'Unavailable';
function download(response,filename){
 const url=URL.createObjectURL(response.data),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function PayrollRegister(){
 const {user}=useAuth(),allowed=['admin','accounts','ho','factory_manager'].includes(user?.role);
 const [draft,setDraft]=useState({}),[filters,setFilters]=useState({}),[page,setPage]=useState(1),[employee,setEmployee]=useState('');
 const context=useQuery({queryKey:['payroll-report-context',user?.id,user?.role],enabled:allowed,queryFn:async()=>(await getPayrollFoundationContext()).data.context});
 const report=useQuery({queryKey:['salary-register',user?.id,user?.role,filters,page],enabled:allowed,queryFn:async()=>(await getSalaryRegister({...filters,page,limit:20})).data.register});
 const payslip=useQuery({queryKey:['payroll-diagnostic-payslip',user?.id,user?.role,employee],enabled:allowed&&!!employee,queryFn:async()=>(await getDiagnosticPayslip(employee)).data.payslip});
 const exporter=useMutation({mutationFn:async({format,kind})=>{
  try{const response=await exportSalaryReport({...filters,format,report:kind});download(response,`payroll-${kind}-diagnostic.${format}`);}
  catch(error){if(error.response?.data instanceof Blob){try{error.message=JSON.parse(await error.response.data.text()).message;}catch{/* retain transport message */}}throw error;}
 }});
 const groups=context.data?.groups||[],departments=[...new Set(groups.map(g=>g.department))];
 const counts=Object.fromEntries(statuses.map(s=>[s,(report.data?.summaries||[]).filter(r=>r.status===s).reduce((sum,r)=>sum+r.row_count,0)]));
 const update=(key,value)=>setDraft(d=>({...d,[key]:value}));
 if(!allowed)return <p role="alert">Payroll reporting access is required.</p>;
 return <div className="p-4 space-y-5 text-slate-200"><div className="payroll-report-controls space-y-3"><h1 className="text-2xl font-bold">Payroll salary register</h1><p>Saved diagnostic evidence, not approved liability. Sources have not been revalidated. Overlapping drafts may duplicate monthly entitlement. Date filters include whole overlapping salary rows; amounts are not prorated. Statutory deductions and net salary remain unavailable until financial prerequisites are complete.</p><Link to="/hr/payroll/review" className="underline">Preparation and employee review</Link>
 <form className="grid gap-3 md:grid-cols-3" onSubmit={e=>{e.preventDefault();setFilters(Object.fromEntries(Object.entries(draft).filter(([,v])=>v)));setPage(1);setEmployee('');exporter.reset();}}>
 <Input label="Employee name / code" value={draft.search||''} maxLength={120} onChange={e=>update('search',e.target.value)}/>
 <Select label="Department" value={draft.department||''} options={[{value:'',label:'All authorized departments'},...departments.map(d=>({value:d,label:d}))]} onChange={e=>{update('department',e.target.value);update('group_code','');}}/>
 <Select label="Payroll group" value={draft.group_code||''} options={[{value:'',label:'All groups'},...[...new Set(groups.filter(g=>!draft.department||g.department===draft.department).map(g=>g.code))].map(g=>({value:g,label:g}))]} onChange={e=>update('group_code',e.target.value)}/>
 <Input type="date" label="Period from" value={draft.from||''} onChange={e=>update('from',e.target.value)}/><Input type="date" label="Period to" value={draft.to||''} onChange={e=>update('to',e.target.value)}/>
 <Select label="Review status" value={draft.status||''} options={[{value:'',label:'All review states'},...statuses.map(s=>({value:s,label:s}))]} onChange={e=>update('status',e.target.value)}/><Button type="submit">Apply report filters</Button>
 </form>{context.isError&&<p role="alert">{message(context.error)} <Button onClick={()=>context.refetch()}>Retry report scopes</Button></p>}
 <div className="flex flex-wrap gap-3"><Button disabled={exporter.isPending||report.isPending||report.isError} onClick={()=>exporter.mutate({format:'xlsx',kind:'register'})}>Export Excel salary register</Button><Button disabled={exporter.isPending||report.isPending||report.isError} onClick={()=>exporter.mutate({format:'xlsx',kind:'departments'})}>Export department report</Button><Button disabled={exporter.isPending||report.isPending||report.isError} onClick={()=>exporter.mutate({format:'html',kind:'departments'})}>Download printable summary</Button></div>{exporter.isPending&&<p role="status">Preparing authorized export…</p>}{exporter.isSuccess&&<p role="status">Diagnostic export downloaded.</p>}{exporter.isError&&<p role="alert">{message(exporter.error)}</p>}
 </div>
 {report.isPending?<p role="status">Loading salary register…</p>:report.isError?<p role="alert">{message(report.error)} <Button onClick={()=>report.refetch()}>Retry salary register</Button></p>:<>
 <h2 className="font-bold">Preparation and review progress</h2><p>Draft {counts.DRAFT} · Calculated {counts.CALCULATED} · Pending Accounts {counts.PENDING_ACCOUNTS_REVIEW} · Pending HO {counts.PENDING_HO_APPROVAL} · Returned {counts.RETURNED_TO_CREATOR} · Locked {counts.LOCKED} · Withdrawn {counts.CANCELLED_DRAFT}</p>
 <h2 className="font-bold">Department totals by review state</h2><p>Totals cover every matching employee row, across all pages. Known subtotals may be incomplete and are diagnostic amounts only.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Department</th><th>Review state</th><th>Rows</th><th>Known gross subtotal</th><th>Complete gross total</th><th>Known LOP subtotal</th></tr></thead><tbody>{report.data.summaries.map(s=><tr key={`${s.department}:${s.status}`}><td>{s.department}</td><td>{s.status}</td><td>{s.row_count} ({s.gross_known_rows} with gross)</td><td>{amount(s.known_gross_total)}</td><td>{amount(s.gross_total)}</td><td>{amount(s.known_lop_total)}</td></tr>)}</tbody></table></div>
 <p>{report.data.total} matching employee rows · Generated {report.data.generated_at} · Payment status: {report.data.payment_status}</p>
 <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Employee</th><th>Department / group</th><th>Period</th><th>Known earnings</th><th>LOP</th><th>Gross after LOP</th><th>EPF / ESI / PT</th><th>Net salary</th><th>Review / payment</th><th>Evidence</th><th>Employee detail</th></tr></thead><tbody>{report.data.rows.map(r=><tr key={r.id}><td><span>{r.employee_name}</span><br/>{r.employee_code} / {r.employee_category}</td><td>{r.department} / {r.group_code}</td><td>{r.period_from} – {r.period_to}<br/>{r.cycle}</td><td>{amount(r.earnings_total)}</td><td>{amount(r.lop)}</td><td>{amount(r.gross_after_lop)}</td><td>{amount(r.epf)} / {amount(r.esi)} / {amount(r.pt)}</td><td>{amount(r.net_salary)}</td><td>{r.status} / {r.payment_status}<br/>{r.last_return_reason}</td><td>{r.evidence_status}<br/>Revision {r.revision??'none'} · {r.blockers.length} blockers</td><td><Link className="underline" to={`/hr/payroll/review?row=${r.id}`}>Breakdown and revision history</Link><br/><Button disabled={r.evidence_status!=='SAVED_DIAGNOSTIC'} onClick={()=>setEmployee(r.id)}>Diagnostic payslip</Button></td></tr>)}</tbody></table></div>
 {!report.data.rows.length&&<p>No employee rows match these filters.</p>}<Pagination currentPage={page} totalPages={Math.ceil(report.data.total/20)} onPageChange={setPage}/>
 </>}
 {employee&&<div className="payroll-print"><div className="payroll-report-controls"><Button onClick={()=>window.print()} disabled={!payslip.data}>Print diagnostic payslip</Button><Button onClick={()=>setEmployee('')}>Close diagnostic payslip</Button></div>{payslip.isPending?<p role="status">Loading diagnostic payslip…</p>:payslip.isError?<p role="alert">{message(payslip.error)} <Button onClick={()=>payslip.refetch()}>Retry diagnostic payslip</Button></p>:<PayrollPayslip payslip={payslip.data}/>}</div>}
 <style>{'@media print{body *{visibility:hidden}.payroll-print,.payroll-print *{visibility:visible}.payroll-print{position:absolute;left:0;top:0;width:100%;color:black;background:white}.payroll-report-controls,.payroll-report-controls *{display:none!important}.payroll-print details{display:none}.payroll-print section{color:black}}'}</style>
 </div>;
}
