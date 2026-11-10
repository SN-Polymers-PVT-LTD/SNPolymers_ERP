import React, {useState} from 'react';
import {Link} from 'react-router-dom';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '../AuthContext';
import {Button,Input,Select,TextArea,Modal,Badge,Pagination,Table,TableHeader,TableBody,TableRow,TableCell} from '../ui';
import {getBankBalances,getBeneficiaries} from '../../api/acctRequisitionsApi';
import {getPayrollAccountsSheet,submitPayrollAccountsSheet,saveSalaryPaymentDetails,actOnSalary,resubmitSalaryPayment,recordSalaryPayment} from '../../api/payrollAccountsApi';
import BulkNeftExportButton from '../acctRequisition/BulkNeftExportButton';
import SalaryPreview from './SalaryPreview';
import {formatINR,payrollGroupName} from '../../utils/payrollDisplay';

const labels={WITH_ACCOUNTS:'With Accounts',WITH_HO:'With HO',RETURNED:'Returned to preparer',PAYMENT_RETURN:'Payment details returned',HOLD:'On hold',APPROVED:'Approved'};
const selectionKey=row=>`${row.delivery_id}:${row.delivery_version}`;
const errorText=e=>e?.response?.data?.message||e.message;
const positive=row=>!/^0(?:\.0+)?$/.test(String(row.salary.final_net_salary));

export default function PayrollAccountsSheet({sheetId,ho=false}){
 const {user}=useAuth(),client=useQueryClient();
 const accounts=!ho&&['accounts','admin'].includes(user?.role);
 const [page,setPage]=useState(1),[selected,setSelected]=useState([]),[dialog,setDialog]=useState(null),[notice,setNotice]=useState('');
 const [form,setForm]=useState({}),[search,setSearch]=useState(''),[failures,setFailures]=useState([]);
 const query=useQuery({queryKey:['payroll-accounts-sheet',user?.id,sheetId,page],queryFn:async()=>(await getPayrollAccountsSheet(sheetId,{page,limit:20})).data.payroll});
 const banks=useQuery({queryKey:['acctBankBalances'],queryFn:async()=>(await getBankBalances()).data.bankBalances||[]});
 const beneficiaries=useQuery({queryKey:['salary-beneficiaries',search],enabled:dialog?.kind==='payment',queryFn:async()=>(await getBeneficiaries({search,limit:50})).data});
 const refresh=()=>{
  for(const key of ['payroll-accounts-sheet','acctSheet','acctSheets','acctHoSheets','acctHoQueue','acctBankBalances','payroll-review-queue','payroll-employee-review','salary-register','payroll-sheet-register','payroll-sheet-freshness'])client.invalidateQueries({queryKey:[key]});
 };
 const mutation=useMutation({mutationFn:async input=>{
  const task=typeof input==='string'?input:input.kind;
  if(task==='send'){await submitPayrollAccountsSheet(sheetId);return {message:'Salary sheet sent to HO.'};}
  const chosen=task==='approve'?rows.filter(r=>selected.includes(selectionKey(r))):[input.row||dialog?.row];
  if(task==='defaults'){
   const targets=rows.filter(r=>r.active&&['WITH_ACCOUNTS','PAYMENT_RETURN'].includes(r.disposition)&&positive(r)&&r.beneficiary_id&&(!r.debit_bank_ac_type||!r.payment_mode));
   const errors=[];
   for(const r of targets)try{await saveSalaryPaymentDetails(r.delivery_id,{expected_version:r.delivery_version,bank:r.debit_bank_ac_type||form.bank,mode:r.payment_mode||form.mode,beneficiary_id:r.beneficiary_id,cheque_no:r.cheque_no||null,cheque_date:r.cheque_date||null});}catch(e){errors.push(`${r.employee_name}: ${errorText(e)}`);}
   return {message:`Payment defaults applied to ${targets.length-errors.length} employees.`,errors};
  }
  const errors=[];
  for(const row of chosen)try{
   if(task==='payment')await saveSalaryPaymentDetails(row.delivery_id,{expected_version:row.delivery_version,bank:form.bank,mode:form.mode,beneficiary_id:form.beneficiary_id,cheque_no:form.mode==='Cheque'?form.cheque_no:null,cheque_date:form.mode==='Cheque'?form.cheque_date:null});
   else if(task==='resubmit')await resubmitSalaryPayment(row.delivery_id,row.delivery_version);
   else if(task==='paid')await recordSalaryPayment(row.delivery_id,{paid_on:form.paid_on,reference:form.reference});
   else await actOnSalary(row.delivery_id,{expected_version:row.delivery_version,action:task==='approve'?'Approve':form.action, ...(form.reason?.trim()?{reason:form.reason.trim()}:{})});
  }catch(e){errors.push(`${row.employee_name}: ${errorText(e)}`);}
  return {message:errors.length?'Some salaries need attention.':'Changes saved.',errors};
 },onSuccess:result=>{setNotice(result.message);setFailures(result.errors||[]);if(!result.errors?.length){setDialog(null);setSelected([]);}refresh();},onError:refresh});
 const rows=query.data?.rows||[],busy=mutation.isPending;
 const open=(kind,row)=>{mutation.reset();setFailures([]);setSearch(kind==='payment'&&!row.beneficiary_id?row.employee_name:'');setDialog({kind,row});setForm(kind==='payment'?{bank:row.debit_bank_ac_type||'',mode:row.payment_mode||'NEFT',beneficiary_id:row.beneficiary_id||'',cheque_no:row.cheque_no||'',cheque_date:row.cheque_date||''}:kind==='defaults'?{bank:'',mode:'NEFT'}:kind==='paid'?{paid_on:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),reference:''}:{action:'ReturnSalary',reason:''});};
 if(query.isPending)return <p role="status">Loading salary sheet…</p>;
 if(query.isError)return <div role="alert">{errorText(query.error)} <Button onClick={()=>query.refetch()}>Retry salary sheet</Button></div>;
 const {sheet,run}=query.data;
 const finalizationDisabled=query.data.financial_finalization_enabled===false;
 const eligible=rows.filter(r=>r.active&&['WITH_HO','HOLD'].includes(r.disposition)&&!r.source_stale&&r.independent_reviewer!==false&&r.payment_details_current!==false);
 const neft=rows.filter(r=>r.disposition==='APPROVED'&&positive(r)&&r.payment_mode==='Bulk NEFT');
 const paymentReady=r=>!positive(r)||!!(r.beneficiary_id&&r.beneficiary_ac_no&&r.debit_bank_ac_type&&r.payment_mode);
 const active=rows.filter(r=>r.active);
 const canSend=accounts&&sheet.sheet_status==='Open'&&(query.data.summary?.active??active.length)>0&&!(query.data.summary?.payment_missing)&&active.every(r=>r.disposition==='WITH_ACCOUNTS'&&!r.source_stale&&r.independent_accounts!==false&&r.payment_details_current!==false&&paymentReady(r));
 const picked=eligible.filter(r=>selected.includes(selectionKey(r)));
 // The API already applies the page offset.
 const current=rows;
 const modalError=mutation.isError&&errorText(mutation.error);
 const fieldsReady=dialog?.kind==='defaults'?!!form.bank:dialog?.kind==='payment'?!!(form.bank&&form.beneficiary_id&&(form.mode!=='Cheque'||form.cheque_no&&form.cheque_date)):dialog?.kind==='paid'?!!(form.paid_on&&form.reference?.trim()):!!form.reason?.trim();
 return <div className="max-w-7xl mx-auto space-y-6 text-slate-100">
  <header className="flex flex-wrap justify-between items-start gap-4">
   <div><p className="text-xs text-amber-400 font-bold uppercase tracking-widest">Payroll · {sheet.sheet_number}</p><h1 className="text-3xl font-bold mt-2">{run.department} salaries</h1><p className="text-sm text-slate-400 mt-2">{payrollGroupName(run.group_code)}{run.group_code?' · ':''}{run.period_from} to {run.period_to} · {query.data.total??rows.length} salary entries</p></div>
   <Link to={ho?'/acct-requisitions/ho-queue':'/acct-requisitions'}><Button variant="glass">Back to sheets</Button></Link>
  </header>
  <div className="glass-panel rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
   <p className="text-sm max-w-xl">{accounts?'Check employee payment details, then send this sheet to HO. Salary amounts come from payroll.':'Approve full salaries or return them with a reason. Approval records the bank debit; Accounts records payment separately.'}</p>
   <div className="flex flex-wrap gap-3">{accounts&&sheet.sheet_status==='Open'&&<><Button variant="glass" disabled={busy||banks.isError} onClick={()=>open('defaults')}>Payment defaults</Button><Button variant="yellow" disabled={busy||!canSend} onClick={()=>mutation.mutate('send')}>Send to HO</Button></>}{ho&&<Button variant="yellow" disabled={busy||!picked.length||finalizationDisabled} onClick={()=>mutation.mutate('approve')}>Approve selected ({picked.length})</Button>}</div>
  </div>
  {ho&&finalizationDisabled&&<p role="status" className="text-sm text-amber-300">Final salary approval is disabled in this environment. Returns and holds remain available.</p>}
  {accounts&&sheet.sheet_status!=='Open'&&<p className="text-sm text-slate-600 dark:text-slate-300">{rows.some(r=>r.disposition==='PAYMENT_RETURN')?'Next: correct the returned payment details below, then resend to HO.':rows.some(r=>r.disposition==='APPROVED'&&!r.payment&&positive(r))?'Next: record payment below after completing the bank transfer.':rows.some(r=>['WITH_HO','HOLD'].includes(r.disposition))?'Next: HO reviews this sheet in the Accounts approval queue.':rows.every(r=>r.disposition==='APPROVED')?'Payments on this page are recorded. View saved results in the Payroll Register.':'Returned salaries are corrected from Payroll. Their earlier records stay available here.'} <Link className="underline" to="/hr/payroll/register">Open Payroll Register</Link></p>}
  {notice&&<p role="status" className="text-sm text-emerald-300">{notice}</p>}
  {(mutation.isError||!!failures.length)&&<div role="alert" className="p-4 rounded-xl border border-red-500/30 text-red-300 space-y-2">{mutation.isError&&errorText(mutation.error)}{failures.map(f=><p key={f}>{f}</p>)}</div>}
  {accounts&&sheet.sheet_status==='Open'&&!canSend&&<p className="text-sm text-amber-300">Complete missing payment details. Return any salary marked “Needs update” to its preparer.</p>}
  <div className="glass-panel rounded-2xl overflow-hidden"><div className="overflow-x-auto"><Table><TableHeader><TableRow hover={false}>
   {ho&&<TableCell isHeader><input aria-label="Select all salaries ready for approval on this page" type="checkbox" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(r=>selected.includes(selectionKey(r)))} onChange={e=>setSelected(e.target.checked?eligible.map(selectionKey):[])}/></TableCell>}
   {['Employee','Take-home pay','Payment details','Status','Actions'].map(x=><TableCell key={x} isHeader>{x}</TableCell>)}
  </TableRow></TableHeader><TableBody>{current.map(row=><TableRow key={row.delivery_id}>
   {ho&&<TableCell><input aria-label={`Select ${row.employee_name}`} type="checkbox" disabled={busy||!eligible.includes(row)} checked={selected.includes(selectionKey(row))} onChange={e=>setSelected(ids=>e.target.checked?[...ids,selectionKey(row)]:ids.filter(id=>id!==selectionKey(row)))}/></TableCell>}
   <TableCell><div className="font-semibold">{row.employee_name}</div><div className="text-xs text-slate-400 mt-1">{row.employee_code}</div><div className="text-xs mt-1">{row.period_from} to {row.period_to}</div></TableCell>
   <TableCell><span className="font-semibold whitespace-nowrap">{formatINR(row.salary.final_net_salary)}</span></TableCell>
   <TableCell>{!positive(row)?'No payout required':<><div>{row.beneficiary_name||'Beneficiary needed'}</div><div className="text-xs text-slate-400 mt-1">{row.beneficiary_ac_no?`Account ending ${row.beneficiary_ac_no.slice(-4)}`:''}</div><div className="text-xs mt-1">{row.debit_bank_ac_type||'Choose debit bank'} · {row.payment_mode||'Choose mode'}</div></>}</TableCell>
   <TableCell><Badge variant={row.disposition==='APPROVED'?'emerald':row.disposition==='RETURNED'?'rose':'amber'}>{labels[row.disposition]}</Badge>{row.source_stale&&row.active&&<p className="mt-2 text-amber-300 text-xs">Needs update — salary inputs changed</p>}{ho&&row.independent_reviewer===false&&<p className="mt-2 text-xs text-amber-300">Independent reviewer required</p>}{accounts&&row.independent_accounts===false&&<p className="mt-2 text-xs text-amber-300">Another Accounts user must send this salary</p>}{row.active&&row.disposition!=='APPROVED'&&row.payment_details_current===false&&<p className="mt-2 text-xs text-amber-300">Payment details need checking</p>}{row.ho_remarks&&<p className="mt-2 text-xs">{row.ho_remarks}</p>}{row.disposition==='APPROVED'&&<p className="mt-2 text-xs">{!positive(row)?'No payment required':row.payment?`Paid on ${row.payment.paid_on} · ${row.payment.reference}`:'Payment not recorded'}</p>}</TableCell>
   <TableCell><div className="flex flex-wrap gap-2 min-w-36"><Button variant="glass" size="sm" disabled={busy} onClick={()=>open('salary',row)}>View salary</Button>
    {accounts&&row.active&&['WITH_ACCOUNTS','PAYMENT_RETURN'].includes(row.disposition)&&positive(row)&&<Button size="sm" variant="yellow" disabled={busy} onClick={()=>open('payment',row)}>Payment details</Button>}
    {accounts&&row.disposition==='PAYMENT_RETURN'&&<Button size="sm" disabled={busy||!paymentReady(row)} onClick={()=>mutation.mutate({kind:'resubmit',row})}>Resend to HO</Button>}
    {accounts&&row.disposition==='WITH_ACCOUNTS'&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>open('return',row)}>Return salary</Button>}
    {ho&&row.active&&['WITH_HO','HOLD'].includes(row.disposition)&&<Button size="sm" variant="glass" disabled={busy} onClick={()=>open('decision',row)}>Return or hold</Button>}
    {accounts&&row.disposition==='APPROVED'&&positive(row)&&!row.payment&&<Button size="sm" variant="yellow" disabled={busy} onClick={()=>open('paid',row)}>Record payment</Button>}
   </div></TableCell>
  </TableRow>)}</TableBody></Table></div>{!rows.length&&<p className="p-6">No salaries on this sheet.</p>}<Pagination currentPage={page} totalPages={Math.ceil((query.data.total??rows.length)/20)} onPageChange={p=>{setPage(p);setSelected([]);}}/></div>
  {accounts&&neft.length>0&&<BulkNeftExportButton sheetId={sheetId} items={neft} onExported={refresh}/>}
  {dialog&&<Modal title={dialog.kind==='salary'?'Salary details':dialog.kind==='payment'?'Employee payment details':dialog.kind==='defaults'?'Payment defaults':dialog.kind==='paid'?'Record salary payment':'Return or hold salary'} subtitle={dialog.row?`${dialog.row.employee_name} · ${dialog.row.employee_code}`:sheet.sheet_number} size={dialog.kind==='salary'?'lg':'md'} onClose={()=>{if(!busy)setDialog(null);}} closeDisabled={busy} role="dialog" aria-modal="true" aria-label="Salary sheet details" footer={dialog.kind==='salary'?null:<><Button variant="glass" disabled={busy} onClick={()=>setDialog(null)}>Cancel</Button><Button variant="yellow" disabled={busy||!fieldsReady} loading={busy} onClick={()=>mutation.mutate(dialog.kind==='decision'||dialog.kind==='return'?'decision':dialog.kind)}>Save {dialog.kind==='defaults'?'defaults':dialog.kind==='paid'?'payment':''}</Button></>}>
   <div className="space-y-4">
    {dialog.kind==='salary'?<SalaryPreview preview={dialog.row.beneficiary_ac_no ? {...dialog.row.salary,beneficiary:{status:'RECORDED',beneficiary_name:dialog.row.beneficiary_name,masked_account_number:`****${dialog.row.beneficiary_ac_no.slice(-4)}`,ifsc:dialog.row.beneficiary_ifsc,bank_name:dialog.row.beneficiary_bank_name}} : dialog.row.salary} beneficiaryContext={dialog.row.beneficiary_ac_no?'payment':'employee'} inModal isSnapshot/>:<>
     {dialog.kind==='payment'&&<><Input label="Find employee beneficiary" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search employee name or account number"/><p className="text-sm text-slate-500">Choose the saved recipient for {dialog.row.employee_name}. Check the account ending before saving.</p>{search&&<Button variant="glass" size="sm" onClick={()=>setSearch('')}>Show all saved beneficiaries</Button>}{!beneficiaries.isPending&&!beneficiaries.isError&&!(beneficiaries.data?.beneficiaries||[]).length&&<p role="status">No matching beneficiary. Try another name or add one in Beneficiary Master.</p>}<Select label="Employee beneficiary" value={form.beneficiary_id} onChange={e=>setForm({...form,beneficiary_id:e.target.value})} options={[{value:'',label:'Select saved beneficiary'},...(dialog.row.beneficiary_id&&!(beneficiaries.data?.beneficiaries||[]).some(b=>b.id===dialog.row.beneficiary_id)?[{value:dialog.row.beneficiary_id,label:dialog.row.beneficiary_name||'Previously selected employee beneficiary'}]:[]),...(beneficiaries.data?.beneficiaries||[]).map(b=>({value:b.id,label:`${b.beneficiary_name} · Account ending ${b.account_number.slice(-4)}`}))]}/>{beneficiaries.isPending&&<p role="status">Finding beneficiaries…</p>}{beneficiaries.isError&&<p role="alert">Could not load beneficiaries. <Button onClick={()=>beneficiaries.refetch()}>Retry</Button></p>}<Link className="text-sm underline" to="/acct-requisitions/beneficiary-master">Add a beneficiary in Beneficiary Master</Link></>}
     {['payment','defaults'].includes(dialog.kind)&&<><Select label="Debit bank" value={form.bank} onChange={e=>setForm({...form,bank:e.target.value})} options={[{value:'',label:'Choose bank'},...(banks.data||[]).map(b=>({value:b.bank_name,label:b.bank_name}))]}/><Select label="Payment mode" value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})} options={(dialog.kind==='defaults'?['NEFT','Bulk NEFT','RTGS']:['NEFT','Bulk NEFT','RTGS','Cheque']).map(m=>({value:m,label:m}))}/>{banks.isError&&<p role="alert">Could not load banks. <Button onClick={()=>banks.refetch()}>Retry</Button></p>}{form.mode==='Cheque'&&<><Input label="Cheque number" value={form.cheque_no} onChange={e=>setForm({...form,cheque_no:e.target.value})}/><Input label="Cheque date" type="date" value={form.cheque_date} onChange={e=>setForm({...form,cheque_date:e.target.value})}/></>}{dialog.kind==='defaults'&&<p className="text-sm text-slate-400">Applies to employees on this page with a saved beneficiary and missing bank or payment mode. Existing payment choices stay as entered.</p>}</>}
     {['decision','return'].includes(dialog.kind)&&<>{dialog.kind==='decision'&&<Select label="What needs to happen?" value={form.action} onChange={e=>setForm({...form,action:e.target.value})} options={[{value:'ReturnSalary',label:'Return salary calculation to preparer'},{value:'ReturnPayment',label:'Return payment details to Accounts'},{value:'Hold',label:'Hold salary for later review'}]}/>}<TextArea aria-label="Reason" label="Reason" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} maxLength={2000} rows={3}/></>}
     {dialog.kind==='paid'&&<><p className="font-semibold">{formatINR(dialog.row.salary.final_net_salary)}</p><p className="text-sm">Record a completed bank transfer. This does not initiate a transfer or debit the bank balance again.</p><Input type="date" label="Paid on" value={form.paid_on} onChange={e=>setForm({...form,paid_on:e.target.value})}/><Input label="Bank reference" value={form.reference} maxLength={200} onChange={e=>setForm({...form,reference:e.target.value})}/></>}
    </>}
    {modalError&&<p role="alert" className="text-red-300">{modalError}</p>}{failures.map(f=><p role="alert" key={f} className="text-red-300">{f}</p>)}
   </div>
  </Modal>}
 </div>;
}
